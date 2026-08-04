import type Stripe from 'stripe'
import type { BillingCadence, BillingOfferingKey } from '../../../shared/billing'
import type { DatabaseConnection } from '../../db/connect'
import { conflictError, forbiddenError, upstreamServiceError } from '../../utils/errors'
import type { AppRuntimeConfig } from '../../utils/runtime'
import { createStripeBillingCatalog, type StripeBillingCatalog } from './billing-catalog'
import { applyVerifiedBillingTransitionProjection } from './billing-event-store'
import { projectStripeSubscription, stripeId } from './billing-projection'
import { resolveLiveStripeSubscription, retrieveExactStripeSubscription } from './billing-subscription-discovery'
import type { StripeBillingClient } from './stripe-client'
import {
  markBillingTransitionReconciliation,
  recordAuthorizedBillingTransition,
  recheckBillingTransitionAuthority,
  reserveBillingTransition,
  type BillingTransitionReservation,
  type BillingTransitionReservationResult
} from './billing-transition-store'

export type BillingTransitionContext = Readonly<{
  connection: DatabaseConnection
  client: StripeBillingClient
  config: AppRuntimeConfig
}>

export async function executeBillingTransition(
  context: BillingTransitionContext,
  userId: string,
  targetOffering: BillingOfferingKey,
  now = new Date()
): Promise<void> {
  const catalog = createStripeBillingCatalog(context.config.stripe)
  const reservationResult = reserveBillingTransition(context.connection, {
    userId,
    targetOffering,
    now
  })
  if (reservationResult.outcome !== 'reserved') throwReservationError(reservationResult)

  let expected = reservationResult.reservation
  const sourceOffering =
    `${expected.transition.sourcePlanKey}.${expected.transition.sourceCadence}` as BillingOfferingKey
  const sourceStripePriceId = catalog.priceIdForOffering(sourceOffering)
  const targetStripePriceId = catalog.priceIdForOffering(targetOffering)
  if (expected.subscription.stripePriceId !== sourceStripePriceId) {
    markBillingTransitionReconciliation(context.connection, expected, 'local_source_price_diverged')
    throw conflictError('The current subscription must be reconciled before it can be changed')
  }

  const source = await providerCall(context, userId, expected, 'Stripe billing state is temporarily unavailable', () =>
    context.client.subscriptions.retrieve(expected.subscription.stripeSubscriptionId!, {
      expand: ['latest_invoice']
    })
  )
  expected = requireAuthorityAfterProviderCall(context.connection, userId, expected)
  if (!isExpectedSourceSubscription(source, expected, sourceStripePriceId)) {
    markBillingTransitionReconciliation(context.connection, expected, 'source_subscription_diverged')
    throw conflictError('The current subscription must be reconciled before it can be changed')
  }

  if (expected.transition.kind === 'personal_to_family') {
    await executeImmediatePersonalToFamily(
      context,
      userId,
      expected,
      sourceStripePriceId,
      targetStripePriceId,
      catalog,
      now
    )
    return
  }

  await executeScheduledTransition(context, userId, expected, sourceStripePriceId, targetStripePriceId)
}

async function executeScheduledTransition(
  context: BillingTransitionContext,
  userId: string,
  initial: BillingTransitionReservation,
  sourceStripePriceId: string,
  targetStripePriceId: string
) {
  let expected = initial
  const schedule = await providerCall(
    context,
    userId,
    expected,
    'Stripe billing scheduling is temporarily unavailable',
    () =>
      context.client.subscriptionSchedules.create(
        { from_subscription: expected.subscription.stripeSubscriptionId! },
        { idempotencyKey: `${expected.transition.idempotencyKey}_schedule_create` }
      )
  )
  expected = requireAuthorityAfterProviderCall(context.connection, userId, expected, {
    stripeSubscriptionScheduleId: providerScheduleId(schedule)
  })
  if (!isExpectedCreatedSchedule(schedule, expected, sourceStripePriceId)) {
    markBillingTransitionReconciliation(context.connection, expected, 'schedule_creation_diverged', {
      stripeSubscriptionScheduleId: providerScheduleId(schedule)
    })
    throw conflictError('The subscription schedule must be reconciled')
  }

  expected = requireRecordedProviderState(
    context.connection,
    userId,
    expected,
    {
      stripeSubscriptionScheduleId: schedule.id
    },
    { stripeSubscriptionScheduleId: schedule.id }
  )

  const periodStart = epochSeconds(expected.subscription.currentPeriodStart!)
  const periodEnd = epochSeconds(expected.subscription.currentPeriodEnd!)
  const scheduleUpdate: Stripe.SubscriptionScheduleUpdateParams = {
    end_behavior: 'release',
    proration_behavior: 'none',
    phases: [
      {
        start_date: periodStart,
        end_date: periodEnd,
        items: [{ price: sourceStripePriceId, quantity: 1 }],
        proration_behavior: 'none'
      },
      {
        start_date: periodEnd,
        duration: cadenceDuration(expected.transition.targetCadence),
        items: [{ price: targetStripePriceId, quantity: 1 }],
        proration_behavior: 'none'
      }
    ]
  }
  const configured = await providerCall(
    context,
    userId,
    expected,
    'Stripe billing scheduling is temporarily unavailable',
    () =>
      context.client.subscriptionSchedules.update(schedule.id, scheduleUpdate, {
        idempotencyKey: `${expected.transition.idempotencyKey}_schedule_configure`
      })
  )
  expected = requireAuthorityAfterProviderCall(context.connection, userId, expected, {
    stripeSubscriptionScheduleId: schedule.id
  })
  if (!isExpectedConfiguredSchedule(configured, expected, schedule.id, sourceStripePriceId, targetStripePriceId)) {
    markBillingTransitionReconciliation(context.connection, expected, 'schedule_configuration_diverged', {
      stripeSubscriptionScheduleId: schedule.id
    })
    throw conflictError('The subscription schedule must be reconciled')
  }

  requireRecordedProviderState(
    context.connection,
    userId,
    expected,
    {
      state: 'scheduled',
      stateReason: null,
      stripeSubscriptionScheduleId: schedule.id
    },
    { stripeSubscriptionScheduleId: schedule.id }
  )
}

async function executeImmediatePersonalToFamily(
  context: BillingTransitionContext,
  userId: string,
  initial: BillingTransitionReservation,
  sourceStripePriceId: string,
  targetStripePriceId: string,
  catalog: StripeBillingCatalog,
  now: Date
) {
  let expected = initial
  const resetBillingCycle = expected.transition.sourceCadence !== expected.transition.targetCadence
  const update: Stripe.SubscriptionUpdateParams = {
    items: [
      {
        id: expected.subscription.stripeSubscriptionItemId!,
        price: targetStripePriceId,
        quantity: 1
      }
    ],
    payment_behavior: 'pending_if_incomplete',
    proration_behavior: 'always_invoice',
    ...(resetBillingCycle ? { billing_cycle_anchor: 'now' as const } : {}),
    expand: ['latest_invoice']
  }
  const result = await providerCall(context, userId, expected, 'Stripe billing change is temporarily unavailable', () =>
    context.client.subscriptions.update(expected.subscription.stripeSubscriptionId!, update, {
      idempotencyKey: expected.transition.idempotencyKey
    })
  )
  expected = requireAuthorityAfterProviderCall(context.connection, userId, expected)

  const pending = pendingUpdateCorrelation(
    result,
    expected,
    sourceStripePriceId,
    targetStripePriceId,
    resetBillingCycle,
    now
  )
  if (pending) {
    requireRecordedProviderState(context.connection, userId, expected, {
      state: 'action_required',
      stateReason: 'payment_resolution_required',
      stripePendingInvoiceId: pending.invoiceId,
      stripePendingUpdateExpiresAt: pending.expiresAt
    })
    return
  }

  if (!isExpectedAppliedSubscription(result, expected, targetStripePriceId)) {
    markBillingTransitionReconciliation(context.connection, expected, 'applied_update_diverged')
    throw conflictError('The billing change must be reconciled')
  }

  const currentRead = await providerCall(
    context,
    userId,
    expected,
    'Stripe billing state is temporarily unavailable',
    async () => ({
      exact: await retrieveExactStripeSubscription(
        context.client,
        expected.customer.stripeCustomerId,
        expected.subscription.stripeSubscriptionId!,
        ['latest_invoice']
      ),
      live: await resolveLiveStripeSubscription(context.client, expected.customer.stripeCustomerId)
    })
  )
  expected = requireAuthorityAfterProviderCall(context.connection, userId, expected)
  const current =
    currentRead.exact.outcome === 'found' &&
    currentRead.live.outcome === 'found' &&
    currentRead.live.subscription.id === expected.subscription.stripeSubscriptionId
      ? currentRead.exact.subscription
      : null
  if (!current || !isExpectedAppliedSubscription(current, expected, targetStripePriceId)) {
    markBillingTransitionReconciliation(context.connection, expected, 'current_subscription_diverged')
    throw conflictError('The billing change must be reconciled')
  }

  const projection = projectStripeSubscription(current, expected.customer.stripeCustomerId, catalog)
  if (
    !applyVerifiedBillingTransitionProjection(context.connection, {
      userId,
      expected,
      targetStripePriceId,
      projection
    })
  ) {
    markBillingTransitionReconciliation(context.connection, expected, 'local_transition_apply_conflict')
    throw conflictError('Billing state changed; retry reconciliation')
  }
}

async function providerCall<T>(
  context: BillingTransitionContext,
  userId: string,
  expected: BillingTransitionReservation,
  message: string,
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation()
  } catch {
    recheckBillingTransitionAuthority(context.connection, userId, expected)
    markBillingTransitionReconciliation(context.connection, expected, 'provider_transition_indeterminate')
    throw upstreamServiceError(502, message)
  }
}

function requireAuthorityAfterProviderCall(
  connection: DatabaseConnection,
  userId: string,
  expected: BillingTransitionReservation,
  providerReferences: Readonly<{
    stripePendingInvoiceId?: string | null
    stripePendingUpdateExpiresAt?: string | null
    stripeSubscriptionScheduleId?: string | null
  }> = {}
): BillingTransitionReservation {
  const result = recheckBillingTransitionAuthority(connection, userId, expected)
  if (result.outcome === 'authorized') return result.reservation
  markBillingTransitionReconciliation(connection, expected, 'local_transition_authority_changed', providerReferences)
  if (result.outcome === 'authority_lost') {
    throw forbiddenError('Billing authority changed during the Stripe operation')
  }
  throw conflictError('Billing state changed during the Stripe operation')
}

function requireRecordedProviderState(
  connection: DatabaseConnection,
  userId: string,
  expected: BillingTransitionReservation,
  update: Parameters<typeof recordAuthorizedBillingTransition>[3],
  providerReferences: Readonly<{
    stripePendingInvoiceId?: string | null
    stripePendingUpdateExpiresAt?: string | null
    stripeSubscriptionScheduleId?: string | null
  }> = {}
): BillingTransitionReservation {
  const result = recordAuthorizedBillingTransition(connection, userId, expected, update)
  if (result.outcome === 'authorized') return result.reservation
  markBillingTransitionReconciliation(connection, expected, 'local_transition_authority_changed', providerReferences)
  if (result.outcome === 'authority_lost') {
    throw forbiddenError('Billing authority changed during the Stripe operation')
  }
  throw conflictError('Billing state changed during the Stripe operation')
}

function throwReservationError(result: Exclude<BillingTransitionReservationResult, { outcome: 'reserved' }>): never {
  if (result.outcome === 'authority_lost') {
    throw forbiddenError('Only the billing owner can change the subscription')
  }
  if (result.outcome === 'same_offering') {
    throw conflictError('The selected billing offering is already active')
  }
  throw conflictError('The current subscription cannot be changed')
}

function isExpectedSourceSubscription(
  subscription: Stripe.Subscription,
  expected: BillingTransitionReservation,
  sourceStripePriceId: string
): boolean {
  return (
    isManagedSubscription(subscription, expected, sourceStripePriceId) &&
    subscription.pending_update === null &&
    providerScheduleId(subscription.schedule) === null &&
    subscription.items.data[0]!.current_period_start === epochSeconds(expected.subscription.currentPeriodStart!) &&
    subscription.items.data[0]!.current_period_end === epochSeconds(expected.subscription.currentPeriodEnd!)
  )
}

function isExpectedAppliedSubscription(
  subscription: Stripe.Subscription,
  expected: BillingTransitionReservation,
  targetStripePriceId: string
): boolean {
  const item = subscription.items.data[0]
  const invoice = expandedInvoice(subscription.latest_invoice)
  return Boolean(
    isManagedSubscription(subscription, expected, targetStripePriceId) &&
    subscription.pending_update === null &&
    providerScheduleId(subscription.schedule) === null &&
    item &&
    item.current_period_end > item.current_period_start &&
    isExpectedInvoice(invoice, expected, 'paid')
  )
}

function isManagedSubscription(
  subscription: Stripe.Subscription,
  expected: BillingTransitionReservation,
  stripePriceId: string
): boolean {
  const item = subscription.items.data[0]
  return Boolean(
    subscription.id === expected.subscription.stripeSubscriptionId &&
    stripeId(subscription.customer) === expected.customer.stripeCustomerId &&
    subscription.status === 'active' &&
    subscription.collection_method === 'charge_automatically' &&
    subscription.cancel_at === null &&
    !subscription.cancel_at_period_end &&
    subscription.pause_collection === null &&
    subscription.trial_end === null &&
    Array.isArray(subscription.discounts) &&
    subscription.discounts.length === 0 &&
    Array.isArray(subscription.billing_schedules) &&
    subscription.billing_schedules.length === 0 &&
    subscription.items.has_more === false &&
    subscription.items.data.length === 1 &&
    item?.id === expected.subscription.stripeSubscriptionItemId &&
    item.price.id === stripePriceId &&
    item.quantity === 1 &&
    Array.isArray(item.discounts) &&
    item.discounts.length === 0
  )
}

function pendingUpdateCorrelation(
  subscription: Stripe.Subscription,
  expected: BillingTransitionReservation,
  sourceStripePriceId: string,
  targetStripePriceId: string,
  resetBillingCycle: boolean,
  now: Date
): Readonly<{ invoiceId: string; expiresAt: string }> | null {
  const pending = subscription.pending_update
  const pendingItem = pending?.subscription_items?.[0]
  const invoice = expandedInvoice(subscription.latest_invoice)
  if (
    !pending ||
    !isManagedSubscription(subscription, expected, sourceStripePriceId) ||
    providerScheduleId(subscription.schedule) !== null ||
    subscription.items.data[0]!.current_period_start !== epochSeconds(expected.subscription.currentPeriodStart!) ||
    subscription.items.data[0]!.current_period_end !== epochSeconds(expected.subscription.currentPeriodEnd!) ||
    !pending.subscription_items ||
    pending.subscription_items.length !== 1 ||
    pendingItem?.id !== expected.subscription.stripeSubscriptionItemId ||
    pendingItem.price.id !== targetStripePriceId ||
    pendingItem.quantity !== 1 ||
    !Number.isInteger(pending.expires_at) ||
    pending.expires_at <= Math.floor(now.getTime() / 1_000) ||
    (resetBillingCycle ? !Number.isInteger(pending.billing_cycle_anchor) : pending.billing_cycle_anchor !== null) ||
    !isExpectedInvoice(invoice, expected, 'open')
  ) {
    return null
  }
  return {
    invoiceId: invoice!.id,
    expiresAt: new Date(pending.expires_at * 1_000).toISOString()
  }
}

function isExpectedInvoice(
  invoice: Stripe.Invoice | null,
  expected: BillingTransitionReservation,
  status: 'open' | 'paid'
): boolean {
  return Boolean(
    invoice &&
    invoice.status === status &&
    stripeId(invoice.customer) === expected.customer.stripeCustomerId &&
    invoice.billing_reason === 'subscription_update' &&
    invoice.parent?.type === 'subscription_details' &&
    stripeId(invoice.parent.subscription_details?.subscription ?? null) === expected.subscription.stripeSubscriptionId
  )
}

function isExpectedCreatedSchedule(
  schedule: Stripe.SubscriptionSchedule,
  expected: BillingTransitionReservation,
  sourceStripePriceId: string
): boolean {
  const periodStart = epochSeconds(expected.subscription.currentPeriodStart!)
  const periodEnd = epochSeconds(expected.subscription.currentPeriodEnd!)
  return (
    isExpectedScheduleIdentity(schedule, expected, null) &&
    schedule.current_phase?.start_date === periodStart &&
    schedule.current_phase.end_date === periodEnd &&
    schedule.phases.length === 1 &&
    isExpectedSchedulePhase(schedule.phases[0]!, periodStart, periodEnd, sourceStripePriceId, null)
  )
}

function isExpectedConfiguredSchedule(
  schedule: Stripe.SubscriptionSchedule,
  expected: BillingTransitionReservation,
  scheduleId: string,
  sourceStripePriceId: string,
  targetStripePriceId: string
): boolean {
  const periodStart = epochSeconds(expected.subscription.currentPeriodStart!)
  const periodEnd = epochSeconds(expected.subscription.currentPeriodEnd!)
  const targetPeriodEnd = cadencePeriodEnd(periodEnd, expected.transition.targetCadence)
  const targetPhase = schedule.phases[1]
  return Boolean(
    isExpectedScheduleIdentity(schedule, expected, scheduleId) &&
    schedule.current_phase?.start_date === periodStart &&
    schedule.current_phase.end_date === periodEnd &&
    schedule.phases.length === 2 &&
    isExpectedSchedulePhase(schedule.phases[0]!, periodStart, periodEnd, sourceStripePriceId, 'none') &&
    targetPhase &&
    isExpectedSchedulePhase(targetPhase, periodEnd, targetPeriodEnd, targetStripePriceId, 'none')
  )
}

function isExpectedScheduleIdentity(
  schedule: Stripe.SubscriptionSchedule,
  expected: BillingTransitionReservation,
  expectedScheduleId: string | null
): boolean {
  return (
    schedule.id.length > 0 &&
    (!expectedScheduleId || schedule.id === expectedScheduleId) &&
    stripeId(schedule.customer) === expected.customer.stripeCustomerId &&
    stripeId(schedule.subscription) === expected.subscription.stripeSubscriptionId &&
    schedule.status === 'active' &&
    schedule.end_behavior === 'release' &&
    schedule.released_at === null &&
    schedule.released_subscription === null &&
    schedule.canceled_at === null &&
    schedule.completed_at === null
  )
}

function isExpectedSchedulePhase(
  phase: Stripe.SubscriptionSchedule.Phase,
  startDate: number,
  endDate: number,
  stripePriceId: string,
  prorationBehavior: 'none' | null
): boolean {
  const item = phase.items[0]
  return Boolean(
    phase.start_date === startDate &&
    phase.end_date === endDate &&
    phase.items.length === 1 &&
    stripeId(item?.price ?? null) === stripePriceId &&
    item?.quantity === 1 &&
    Array.isArray(item?.discounts) &&
    item.discounts.length === 0 &&
    phase.add_invoice_items.length === 0 &&
    (phase.discounts === null || phase.discounts.length === 0) &&
    phase.trial_end === null &&
    (prorationBehavior === null || phase.proration_behavior === prorationBehavior)
  )
}

function expandedInvoice(value: Stripe.Subscription['latest_invoice']): Stripe.Invoice | null {
  return value && typeof value !== 'string' && value.object === 'invoice' ? value : null
}

function providerScheduleId(value: Stripe.Subscription['schedule'] | Stripe.SubscriptionSchedule): string | null {
  if (!value) return null
  return typeof value === 'string' ? value : value.id
}

function cadenceDuration(cadence: BillingCadence): Stripe.SubscriptionScheduleUpdateParams.Phase.Duration {
  if (cadence === 'weekly') return { interval: 'week', interval_count: 1 }
  if (cadence === 'monthly') return { interval: 'month', interval_count: 1 }
  return { interval: 'year', interval_count: 1 }
}

function cadencePeriodEnd(start: number, cadence: BillingCadence): number {
  if (cadence === 'weekly') return start + 7 * 24 * 60 * 60

  const date = new Date(start * 1_000)
  const monthOffset = cadence === 'monthly' ? 1 : 12
  const targetMonthIndex = date.getUTCMonth() + monthOffset
  const targetYear = date.getUTCFullYear() + Math.floor(targetMonthIndex / 12)
  const targetMonth = targetMonthIndex % 12
  const lastTargetDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  return Math.floor(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(date.getUTCDate(), lastTargetDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds()
    ) / 1_000
  )
}

function epochSeconds(value: string): number {
  return Math.floor(Date.parse(value) / 1_000)
}
