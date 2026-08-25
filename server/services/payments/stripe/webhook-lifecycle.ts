import type Stripe from 'stripe'
import type { StripeBillingCatalog } from './catalog'
import { graceWindowFromFirstFailure } from './dunning'
import type { CurrentBillingProjection } from './projection'
import type { BillingStripeLifecycleEffect } from './public-contract'
import { getBillingSubscriptionForPurchaser, getCheckoutAttemptById, getOpenBillingTransition } from './repository'
import type { BillingSubscription, BillingSubscriptionTransition } from '../../../db/schema/billing'
import type { BillingOfferingKey } from '../../../../shared/billing'
import type { StripeEventObservation } from './webhook'
import type { StripeWebhookEventType } from './webhook-reference'
import { isExactPaidInitialInvoice, type StripeWebhookProviderState } from './webhook-state'

export const missingAuthenticatedFailureInvoiceReason = 'missing_authenticated_failure_invoice'

export type BillingStripeGraceMutation =
  | Readonly<{ kind: 'default' | 'preserve' | 'clear' }>
  | Readonly<{ kind: 'set'; invoiceId: string; startedAt: string; endsAt: string }>

export type BillingStripeTransitionMutation = Readonly<{
  transition: BillingSubscriptionTransition
  state: 'action_required' | 'scheduled' | 'reconciliation_required' | 'applied' | 'failed' | 'canceled'
  reason: string | null
  stripePendingInvoiceId?: string | null
  stripePendingUpdateExpiresAt?: string | null
  stripeSubscriptionScheduleId?: string | null
}>

export type BillingStripeWebhookLifecycle = Readonly<{
  projection: CurrentBillingProjection
  grace: BillingStripeGraceMutation
  transition: BillingStripeTransitionMutation | null
  effects: readonly BillingStripeLifecycleEffect[]
}>

export function resolveBillingStripeWebhookLifecycle(
  connection: { sqlite: BillingSubscriptionConnection },
  purchaserUserId: string,
  observation: StripeEventObservation
): BillingStripeWebhookLifecycle {
  const providerProjection = observation.projection!
  const current = getBillingSubscriptionForPurchaser(connection, purchaserUserId)
  const transition = getOpenBillingTransition(connection, purchaserUserId)
  const checkoutAttempt = observation.attemptId ? getCheckoutAttemptById(connection, observation.attemptId) : null
  const subscription = providerSubscription(observation.providerState)

  if (observation.reconciliationReason || providerProjection.reconciliationRequired) {
    const reason =
      observation.reconciliationReason ?? providerProjection.reconciliationReason ?? 'ambiguous_provider_projection'
    return reconciliationLifecycle(providerProjection, reason, transition)
  }

  if (
    subscription &&
    !isExactManagedSubscription(subscription, observation.stripeCustomerId, providerProjection, observation.catalog)
  ) {
    return reconciliationLifecycle(providerProjection, 'managed_subscription_shape_mismatch', transition)
  }

  if (
    checkoutAttempt &&
    checkoutAttempt.state !== 'completed' &&
    subscription &&
    providerProjection.status === 'active' &&
    observation.stripeCustomerId &&
    !isExactPaidInitialInvoice(subscription, observation.stripeCustomerId)
  ) {
    return reconciliationLifecycle(providerProjection, 'checkout_initial_invoice_unverified', transition)
  }

  if (
    current &&
    providerProjection.status !== 'none' &&
    (providerProjection.stripeSubscriptionId !== current.stripeSubscriptionId ||
      providerProjection.stripeSubscriptionItemId !== current.stripeSubscriptionItemId)
  ) {
    return reconciliationLifecycle(providerProjection, 'local_subscription_identity_conflict', transition)
  }

  if (transition) {
    return resolveOpenTransitionLifecycle(current, transition, observation, providerProjection, subscription)
  }
  if (subscription?.pending_update) {
    return reconciliationLifecycle(providerProjection, 'untracked_pending_subscription_update')
  }
  if (stripeId(subscription?.schedule ?? null) || providerSchedule(observation.providerState)) {
    return reconciliationLifecycle(providerProjection, 'untracked_subscription_schedule')
  }

  const dunning = resolveDunningLifecycle(current, observation, providerProjection)
  if (dunning) return dunning

  const effects: BillingStripeLifecycleEffect[] = []
  if (
    current?.planKey === 'family' &&
    !current.cancelAtPeriodEnd &&
    providerProjection.status === 'active' &&
    providerProjection.cancelAtPeriodEnd
  ) {
    effects.push(effect('renewal_ending', observation.eventId, providerProjection.currentPeriodEnd, null))
  }
  if (
    current?.planKey === 'family' &&
    !isTerminalProjectionStatus(current.status) &&
    isTerminalProjectionStatus(providerProjection.status)
  ) {
    effects.push(effect('coverage_ended', observation.eventId, providerProjection.currentPeriodEnd, null))
  }
  return {
    projection: providerProjection,
    grace: isTerminalProjectionStatus(providerProjection.status) ? { kind: 'clear' } : { kind: 'default' },
    transition: null,
    effects
  }
}

function resolveOpenTransitionLifecycle(
  current: BillingSubscription | null,
  transition: BillingSubscriptionTransition,
  observation: StripeEventObservation,
  projection: CurrentBillingProjection,
  subscription: Stripe.Subscription | null
): BillingStripeWebhookLifecycle {
  if (
    !current ||
    !subscription ||
    current.id !== transition.billingSubscriptionId ||
    current.stripeSubscriptionId !== subscription.id ||
    current.stripeSubscriptionItemId !== subscription.items.data[0]?.id ||
    current.planKey !== transition.sourcePlanKey ||
    current.cadence !== transition.sourceCadence
  ) {
    return reconciliationLifecycle(projection, 'transition_subscription_identity_conflict', transition)
  }
  return transition.kind === 'personal_to_family'
    ? resolveImmediateTransitionLifecycle(current, transition, observation, projection, subscription)
    : resolveScheduledTransitionLifecycle(current, transition, observation, projection, subscription)
}

function resolveImmediateTransitionLifecycle(
  current: BillingSubscription,
  transition: BillingSubscriptionTransition,
  observation: StripeEventObservation,
  projection: CurrentBillingProjection,
  subscription: Stripe.Subscription
): BillingStripeWebhookLifecycle {
  const sourcePriceId = transitionPriceId(observation.catalog, transition, 'source')
  const targetPriceId = transitionPriceId(observation.catalog, transition, 'target')
  const offering = projectionOffering(projection)
  const sourceOffering = transitionOffering(transition, 'source')
  const targetOffering = transitionOffering(transition, 'target')
  if (stripeId(subscription.schedule)) {
    return reconciliationLifecycle(projection, 'immediate_transition_has_schedule', transition)
  }

  if (offering === targetOffering) {
    const invoice = expandedInvoice(subscription.latest_invoice)
    if (
      subscription.pending_update !== null ||
      !isExactTransitionInvoice(
        invoice,
        current,
        stripeId(subscription.customer),
        transition.stripePendingInvoiceId,
        'subscription_update',
        'paid'
      ) ||
      (observation.providerState.kind === 'invoice' && observation.objectId !== invoice?.id) ||
      observation.eventType === 'customer.subscription.pending_update_expired'
    ) {
      return reconciliationLifecycle(projection, 'applied_transition_evidence_mismatch', transition)
    }
    return {
      projection,
      grace: { kind: 'clear' },
      transition: transitionMutation(transition, 'applied', null),
      effects: []
    }
  }

  if (offering !== sourceOffering || subscription.items.data[0]?.price.id !== sourcePriceId) {
    return reconciliationLifecycle(projection, 'immediate_transition_offering_mismatch', transition)
  }
  const pending = exactPendingUpdateEvidence(subscription, current, targetPriceId)
  if (pending) {
    if (
      observation.eventType === 'customer.subscription.pending_update_expired' ||
      observation.eventType === 'customer.subscription.pending_update_applied' ||
      (transition.stripePendingInvoiceId && transition.stripePendingInvoiceId !== pending.invoiceId) ||
      (transition.stripePendingUpdateExpiresAt && transition.stripePendingUpdateExpiresAt !== pending.expiresAt)
    ) {
      return reconciliationLifecycle(projection, 'pending_transition_reference_conflict', transition)
    }
    const changed =
      transition.state !== 'action_required' ||
      transition.stripePendingInvoiceId !== pending.invoiceId ||
      transition.stripePendingUpdateExpiresAt !== pending.expiresAt
    return {
      projection,
      grace: { kind: 'default' },
      transition: changed
        ? {
            transition,
            state: 'action_required',
            reason: 'payment_resolution_required',
            stripePendingInvoiceId: pending.invoiceId,
            stripePendingUpdateExpiresAt: pending.expiresAt
          }
        : null,
      effects: changed ? [effect('payment_attention', transition.id, pending.expiresAt, transition.id)] : []
    }
  }
  if (subscription.pending_update) {
    return reconciliationLifecycle(projection, 'pending_transition_shape_mismatch', transition)
  }
  if (
    observation.eventType === 'customer.subscription.pending_update_expired' &&
    transition.stripePendingInvoiceId &&
    isExactTransitionInvoice(
      expandedInvoice(subscription.latest_invoice),
      current,
      stripeId(subscription.customer),
      transition.stripePendingInvoiceId,
      'subscription_update',
      'void'
    )
  ) {
    return {
      projection,
      grace: { kind: 'default' },
      transition: transitionMutation(transition, 'failed', 'pending_update_expired'),
      effects: []
    }
  }
  return transition.state === 'pending'
    ? { projection, grace: { kind: 'default' }, transition: null, effects: [] }
    : reconciliationLifecycle(projection, 'pending_transition_disappeared', transition)
}

function resolveScheduledTransitionLifecycle(
  current: BillingSubscription,
  transition: BillingSubscriptionTransition,
  observation: StripeEventObservation,
  projection: CurrentBillingProjection,
  subscription: Stripe.Subscription
): BillingStripeWebhookLifecycle {
  if (subscription.pending_update) {
    return reconciliationLifecycle(projection, 'scheduled_transition_has_pending_update', transition)
  }
  const sourceOffering = transitionOffering(transition, 'source')
  const targetOffering = transitionOffering(transition, 'target')
  const offering = projectionOffering(projection)
  const schedule = providerSchedule(observation.providerState)
  const attachedScheduleId = stripeId(subscription.schedule)
  const expectedScheduleId = transition.stripeSubscriptionScheduleId

  if (!expectedScheduleId) {
    if (schedule || attachedScheduleId) {
      return reconciliationLifecycle(projection, 'unrecorded_transition_schedule', transition)
    }
    return transition.state === 'pending' && offering === sourceOffering
      ? { projection, grace: { kind: 'default' }, transition: null, effects: [] }
      : reconciliationLifecycle(projection, 'missing_transition_schedule', transition)
  }
  if (
    !schedule ||
    schedule.id !== expectedScheduleId ||
    (attachedScheduleId && attachedScheduleId !== expectedScheduleId) ||
    !isExactScheduleIdentity(schedule, current, stripeId(subscription.customer))
  ) {
    return reconciliationLifecycle(projection, 'transition_schedule_reference_conflict', transition)
  }
  const scheduleShape = exactScheduleShape(schedule, transition, observation.catalog, current)
  if (offering === targetOffering) {
    if (
      scheduleShape !== 'configured' ||
      !['active', 'completed', 'released'].includes(schedule.status) ||
      (isScheduleTerminalEvent(observation.eventType) &&
        !scheduleEventMatchesStatus(observation.eventType, schedule.status))
    ) {
      return reconciliationLifecycle(projection, 'scheduled_transition_apply_mismatch', transition)
    }
    return {
      projection,
      grace: { kind: 'clear' },
      transition: transitionMutation(transition, 'applied', null),
      effects:
        transition.kind === 'family_to_personal'
          ? [effect('coverage_ended', transition.id, transition.effectiveAt, transition.id)]
          : []
    }
  }
  if (offering !== sourceOffering) {
    return reconciliationLifecycle(projection, 'scheduled_transition_offering_mismatch', transition)
  }
  if (observation.eventType === 'subscription_schedule.aborted' && schedule.status === 'canceled') {
    return transitionResult(projection, transition, 'failed', 'subscription_schedule_aborted')
  }
  if (observation.eventType === 'subscription_schedule.canceled' && schedule.status === 'canceled') {
    return transitionResult(projection, transition, 'canceled', 'subscription_schedule_canceled')
  }
  if (observation.eventType === 'subscription_schedule.released' && schedule.status === 'released') {
    return transitionResult(projection, transition, 'canceled', 'subscription_schedule_released_early')
  }
  if (isScheduleTerminalEvent(observation.eventType)) {
    return reconciliationLifecycle(projection, 'schedule_terminal_state_mismatch', transition)
  }
  if (scheduleShape === 'created' && transition.state === 'pending') {
    return { projection, grace: { kind: 'default' }, transition: null, effects: [] }
  }
  if (scheduleShape !== 'configured' || !['active', 'not_started'].includes(schedule.status)) {
    return reconciliationLifecycle(projection, 'configured_schedule_shape_mismatch', transition)
  }
  const changed = transition.state !== 'scheduled'
  return {
    projection,
    grace: { kind: 'default' },
    transition: changed
      ? { transition, state: 'scheduled', reason: null, stripeSubscriptionScheduleId: expectedScheduleId }
      : null,
    effects: changed ? [effect('renewal_ending', transition.id, transition.effectiveAt, transition.id)] : []
  }
}

function resolveDunningLifecycle(
  current: BillingSubscription | null,
  observation: StripeEventObservation,
  projection: CurrentBillingProjection
): BillingStripeWebhookLifecycle | null {
  if (observation.providerState.kind !== 'invoice') {
    if (current?.graceInvoiceId && projection.status === 'active') {
      return reconciliationLifecycle(projection, 'active_recovery_without_paid_invoice')
    }
    if (projection.status === 'past_due' || projection.status === 'unpaid') {
      return reconciliationLifecycle(projection, missingAuthenticatedFailureInvoiceReason)
    }
    return null
  }
  const invoice = observation.providerState.invoice
  const subscription = observation.providerState.subscription
  if (!invoice || !subscription) return reconciliationLifecycle(projection, 'renewal_invoice_evidence_missing')

  if (observation.eventType === 'invoice.payment_action_required') {
    if (
      !isExactRenewalInvoice(invoice, subscription, 'open') ||
      (projection.status !== 'past_due' && projection.status !== 'unpaid')
    )
      return reconciliationLifecycle(projection, 'renewal_failure_evidence_mismatch')
    if (current?.graceInvoiceId && current.graceInvoiceId !== invoice.id) {
      return reconciliationLifecycle(projection, 'renewal_failure_invoice_conflict')
    }
    return {
      projection,
      grace: { kind: 'preserve' },
      transition: null,
      effects: current ? [effect('payment_attention', invoice.id, null, null)] : []
    }
  }
  if (observation.eventType === 'invoice.payment_failed') {
    if (
      !isExactRenewalInvoice(invoice, subscription, 'open') ||
      (projection.status !== 'past_due' && projection.status !== 'unpaid')
    )
      return reconciliationLifecycle(projection, 'renewal_failure_evidence_mismatch')
    if (current?.graceInvoiceId && current.graceInvoiceId !== invoice.id) {
      return reconciliationLifecycle(projection, 'renewal_failure_invoice_conflict')
    }
    const window = graceWindowFromFirstFailure(new Date(observation.eventCreatedAt * 1_000))
    if (
      current?.graceInvoiceId === invoice.id &&
      current.graceStartedAt &&
      Date.parse(current.graceStartedAt) <= Date.parse(window.startedAt)
    ) {
      return { projection, grace: { kind: 'preserve' }, transition: null, effects: [] }
    }
    return {
      projection,
      grace: { kind: 'set', invoiceId: invoice.id, startedAt: window.startedAt, endsAt: window.endsAt },
      transition: null,
      effects: current?.graceInvoiceId ? [] : [effect('payment_grace_started', invoice.id, window.startedAt, null)]
    }
  }
  if (observation.eventType === 'invoice.paid') {
    if (current?.graceInvoiceId) {
      if (
        current.graceInvoiceId !== invoice.id ||
        projection.status !== 'active' ||
        !isExactRenewalInvoice(invoice, subscription, 'paid')
      )
        return reconciliationLifecycle(projection, 'paid_recovery_invoice_conflict')
      return { projection, grace: { kind: 'clear' }, transition: null, effects: [] }
    }
    if (invoice.status !== 'paid' || invoice.amount_remaining !== 0) {
      return reconciliationLifecycle(projection, 'paid_invoice_evidence_mismatch')
    }
    return { projection, grace: { kind: 'clear' }, transition: null, effects: [] }
  }
  return null
}

export function isExactManagedSubscription(
  subscription: Stripe.Subscription,
  expectedCustomerId: string | null,
  projection: CurrentBillingProjection,
  catalog: StripeBillingCatalog
): boolean {
  const item = subscription.items.data[0]
  const offering = item ? catalog.offeringForPriceId(item.price.id) : null
  const cancelAtIsExact =
    subscription.status !== 'active'
      ? true
      : subscription.cancel_at_period_end
        ? subscription.cancel_at === item?.current_period_end
        : subscription.cancel_at === null
  return Boolean(
    expectedCustomerId &&
    subscription.object === 'subscription' &&
    subscription.id === projection.stripeSubscriptionId &&
    stripeId(subscription.customer) === expectedCustomerId &&
    subscription.collection_method === 'charge_automatically' &&
    cancelAtIsExact &&
    subscription.pause_collection === null &&
    subscription.trial_end === null &&
    Array.isArray(subscription.discounts) &&
    subscription.discounts.length === 0 &&
    Array.isArray(subscription.billing_schedules) &&
    subscription.billing_schedules.length === 0 &&
    subscription.items.has_more === false &&
    subscription.items.data.length === 1 &&
    item?.id === projection.stripeSubscriptionItemId &&
    item.price.id === projection.stripePriceId &&
    offering === projectionOffering(projection) &&
    item.quantity === 1 &&
    Array.isArray(item.discounts) &&
    item.discounts.length === 0 &&
    Number.isSafeInteger(item.current_period_start) &&
    Number.isSafeInteger(item.current_period_end) &&
    item.current_period_end > item.current_period_start
  )
}

function exactPendingUpdateEvidence(
  subscription: Stripe.Subscription,
  current: BillingSubscription,
  targetPriceId: string
): Readonly<{ invoiceId: string; expiresAt: string }> | null {
  const pending = subscription.pending_update
  const item = pending?.subscription_items?.[0]
  const invoice = expandedInvoice(subscription.latest_invoice)
  if (
    !pending ||
    !pending.subscription_items ||
    pending.subscription_items.length !== 1 ||
    item?.id !== current.stripeSubscriptionItemId ||
    item.price.id !== targetPriceId ||
    item.quantity !== 1 ||
    !Array.isArray(item.discounts) ||
    item.discounts.length !== 0 ||
    pending.discount !== null ||
    (pending.discounts !== null && pending.discounts.length !== 0) ||
    pending.trial_end !== null ||
    pending.trial_from_plan !== false ||
    !Number.isSafeInteger(pending.expires_at) ||
    pending.expires_at <= 0 ||
    !isExactTransitionInvoice(invoice, current, stripeId(subscription.customer), null, 'subscription_update', 'open')
  )
    return null
  return { invoiceId: invoice!.id, expiresAt: new Date(pending.expires_at * 1_000).toISOString() }
}

function isExactTransitionInvoice(
  invoice: Stripe.Invoice | null,
  current: BillingSubscription,
  expectedCustomerId: string | null,
  expectedInvoiceId: string | null,
  billingReason: Stripe.Invoice.BillingReason,
  status: Stripe.Invoice.Status
): boolean {
  return Boolean(
    invoice &&
    (!expectedInvoiceId || invoice.id === expectedInvoiceId) &&
    expectedCustomerId &&
    stripeId(invoice.customer) === expectedCustomerId &&
    invoice.billing_reason === billingReason &&
    invoice.collection_method === 'charge_automatically' &&
    invoice.status === status &&
    invoiceSubscriptionId(invoice) === current.stripeSubscriptionId &&
    (status === 'paid'
      ? invoice.amount_remaining === 0
      : status === 'open'
        ? invoice.attempted && invoice.attempt_count >= 1 && invoice.amount_remaining > 0
        : status === 'void')
  )
}

export function isExactRenewalInvoice(
  invoice: Stripe.Invoice,
  subscription: Stripe.Subscription,
  status: 'open' | 'paid'
): boolean {
  return Boolean(
    invoice.object === 'invoice' &&
    stripeId(invoice.customer) === stripeId(subscription.customer) &&
    invoiceSubscriptionId(invoice) === subscription.id &&
    invoice.billing_reason === 'subscription_cycle' &&
    invoice.collection_method === 'charge_automatically' &&
    invoice.status === status &&
    invoice.attempted &&
    invoice.attempt_count >= 1 &&
    (status === 'open' ? invoice.amount_remaining > 0 : invoice.amount_remaining === 0)
  )
}

function isExactScheduleIdentity(
  schedule: Stripe.SubscriptionSchedule,
  current: BillingSubscription,
  expectedCustomerId: string | null
): boolean {
  const subscriptionId = stripeId(schedule.subscription) ?? stripeId(schedule.released_subscription)
  return Boolean(
    schedule.object === 'subscription_schedule' &&
    expectedCustomerId &&
    stripeId(schedule.customer) === expectedCustomerId &&
    subscriptionId === current.stripeSubscriptionId &&
    schedule.end_behavior === 'release'
  )
}

function exactScheduleShape(
  schedule: Stripe.SubscriptionSchedule,
  transition: BillingSubscriptionTransition,
  catalog: StripeBillingCatalog,
  current: BillingSubscription
): 'created' | 'configured' | 'mismatch' {
  const sourcePriceId = transitionPriceId(catalog, transition, 'source')
  const targetPriceId = transitionPriceId(catalog, transition, 'target')
  const sourceStart = timestampSeconds(current.currentPeriodStart)
  const sourceEnd = timestampSeconds(current.currentPeriodEnd)
  if (!sourceStart || !sourceEnd || sourceEnd <= sourceStart) return 'mismatch'
  const source = schedule.phases[0]
  if (!source || !isExactSchedulePhase(source, sourcePriceId, sourceStart, sourceEnd, schedule.phases.length === 1)) {
    return 'mismatch'
  }
  if (schedule.phases.length === 1) return 'created'
  const target = schedule.phases[1]
  if (!target || schedule.phases.length !== 2 || !isExactSchedulePhase(target, targetPriceId, sourceEnd, null, false))
    return 'mismatch'
  return 'configured'
}

function isExactSchedulePhase(
  phase: Stripe.SubscriptionSchedule.Phase,
  priceId: string,
  expectedStart: number,
  expectedEnd: number | null,
  allowCreationProration: boolean
): boolean {
  const item = phase.items[0]
  return Boolean(
    phase.start_date === expectedStart &&
    (expectedEnd === null ? phase.end_date > phase.start_date : phase.end_date === expectedEnd) &&
    phase.items.length === 1 &&
    item &&
    stripeId(item.price) === priceId &&
    item.quantity === 1 &&
    Array.isArray(item.discounts) &&
    item.discounts.length === 0 &&
    Array.isArray(phase.add_invoice_items) &&
    phase.add_invoice_items.length === 0 &&
    (phase.discounts === null || phase.discounts.length === 0) &&
    phase.trial_end === null &&
    (phase.proration_behavior === 'none' ||
      (allowCreationProration && phase.proration_behavior === 'create_prorations'))
  )
}

export function transitionConvergenceEventType(
  transition: BillingSubscriptionTransition,
  projection: CurrentBillingProjection,
  subscription: Stripe.Subscription | null,
  schedule: Stripe.SubscriptionSchedule | null,
  observedAt: Date
): StripeWebhookEventType {
  if (transition.kind === 'personal_to_family') {
    const expiresAt = Date.parse(transition.stripePendingUpdateExpiresAt ?? '')
    if (
      projectionOffering(projection) === transitionOffering(transition, 'source') &&
      !subscription?.pending_update &&
      Number.isFinite(expiresAt) &&
      observedAt.getTime() >= expiresAt
    )
      return 'customer.subscription.pending_update_expired'
    return 'customer.subscription.updated'
  }
  if (schedule?.status === 'canceled') return 'subscription_schedule.canceled'
  if (schedule?.status === 'released') return 'subscription_schedule.released'
  if (schedule?.status === 'completed') return 'subscription_schedule.completed'
  return 'customer.subscription.updated'
}

function transitionResult(
  projection: CurrentBillingProjection,
  transition: BillingSubscriptionTransition,
  state: BillingStripeTransitionMutation['state'],
  reason: string
): BillingStripeWebhookLifecycle {
  return {
    projection,
    grace: { kind: 'default' },
    transition: transitionMutation(transition, state, reason),
    effects: []
  }
}

function transitionMutation(
  transition: BillingSubscriptionTransition,
  state: BillingStripeTransitionMutation['state'],
  reason: string | null
): BillingStripeTransitionMutation {
  return { transition, state, reason }
}

function reconciliationLifecycle(
  projection: CurrentBillingProjection,
  reason: string,
  transition?: BillingSubscriptionTransition | null
): BillingStripeWebhookLifecycle {
  return {
    projection: { ...projection, reconciliationRequired: true, reconciliationReason: reason },
    grace: { kind: 'preserve' },
    transition: transition ? transitionMutation(transition, 'reconciliation_required', reason) : null,
    effects: []
  }
}

function effect(
  action: BillingStripeLifecycleEffect['action'],
  episodeKey: string,
  effectiveAt: string | null,
  transitionId: string | null
): BillingStripeLifecycleEffect {
  return Object.freeze({ action, episodeKey, effectiveAt, transitionId })
}

function providerSubscription(state: StripeWebhookProviderState): Stripe.Subscription | null {
  return 'subscription' in state ? state.subscription : null
}

function providerSchedule(state: StripeWebhookProviderState): Stripe.SubscriptionSchedule | null {
  return 'schedule' in state ? state.schedule : null
}

function transitionOffering(transition: BillingSubscriptionTransition, side: 'source' | 'target'): BillingOfferingKey {
  return (
    side === 'source'
      ? `${transition.sourcePlanKey}.${transition.sourceCadence}`
      : `${transition.targetPlanKey}.${transition.targetCadence}`
  ) as BillingOfferingKey
}

function transitionPriceId(
  catalog: StripeBillingCatalog,
  transition: BillingSubscriptionTransition,
  side: 'source' | 'target'
): string {
  return catalog.priceIdForOffering(transitionOffering(transition, side))
}

function projectionOffering(projection: CurrentBillingProjection): BillingOfferingKey | null {
  return projection.planKey && projection.cadence
    ? (`${projection.planKey}.${projection.cadence}` as BillingOfferingKey)
    : null
}

function expandedInvoice(value: string | Stripe.Invoice | null): Stripe.Invoice | null {
  return value && typeof value !== 'string' && value.object === 'invoice' ? value : null
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  return invoice.parent?.type === 'subscription_details'
    ? stripeId(invoice.parent.subscription_details?.subscription ?? null)
    : null
}

function timestampSeconds(value: string | null): number | null {
  if (!value) return null
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && milliseconds % 1_000 === 0 ? milliseconds / 1_000 : null
}

function isScheduleTerminalEvent(type: StripeWebhookEventType): boolean {
  return [
    'subscription_schedule.completed',
    'subscription_schedule.canceled',
    'subscription_schedule.released',
    'subscription_schedule.aborted'
  ].includes(type)
}

function scheduleEventMatchesStatus(type: StripeWebhookEventType, status: Stripe.SubscriptionSchedule.Status): boolean {
  if (type === 'subscription_schedule.completed') return status === 'completed'
  if (type === 'subscription_schedule.released') return status === 'released'
  if (type === 'subscription_schedule.canceled' || type === 'subscription_schedule.aborted') {
    return status === 'canceled'
  }
  return true
}

function isTerminalProjectionStatus(status: CurrentBillingProjection['status']): boolean {
  return status === 'canceled' || status === 'incomplete_expired'
}

function stripeId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') return value.id
  return null
}

type BillingSubscriptionConnection = Parameters<typeof getBillingSubscriptionForPurchaser>[0]['sqlite']
