import { randomUUID } from 'node:crypto'
import type Stripe from 'stripe'
import type { BillingOfferingKey } from '../../../shared/billing'
import type { DatabaseConnection } from '../../db/connect'
import {
  getBillingCustomerByStripeId,
  getBillingCustomerForOrganization,
  getBillingEventByStripeId,
  getBillingSubscriptionForOrganization,
  getBillingTransitionById,
  getCheckoutAttemptById,
  getDetachedStripeBillingSubject,
  getOpenBillingTransition,
  getOpenCheckoutAttempt,
  listDetachedStripeBillingSubjectsForCustomer
} from '../../db/repositories/billing'
import { hasExternalFamilyMembership } from '../../db/repositories/family-authority'
import type { BillingCustomer, BillingSubscription, BillingSubscriptionTransition } from '../../db/schema'
import { graceWindowFromFirstFailure } from './billing-dunning'
import { enqueueBillingDetachedSubscriptionCancellation } from './billing-detached-subscription-cancellation'
import { enqueueBillingFamilyLifecycleSignal } from './billing-family-lifecycle-signal'
import type { StripeBillingCatalog } from './billing-catalog'
import type { BillingTransitionReservation } from './billing-transition-store'
import {
  currentProjectionFingerprint,
  persistedProjectionFingerprint,
  stripeId,
  type CurrentBillingProjection
} from './billing-projection'
import type { StripeWebhookEventType } from './billing-webhook-reference'
import { isExactPaidInitialInvoice, type StripeWebhookProviderState } from './billing-webhook-state'

export type StripeEventObservation = Readonly<{
  eventId: string
  eventType: StripeWebhookEventType
  eventCreatedAt: number
  objectId: string
  catalog: StripeBillingCatalog
  attemptId: string | null
  stripeCustomerId: string | null
  stripeSessionId: string | null
  checkoutState: 'completed' | 'expired' | 'failed' | null
  projection: CurrentBillingProjection | null
  reconciliationReason: string | null
  providerState: StripeWebhookProviderState
}>

export type StripeEventApplication = Readonly<{
  duplicate: boolean
  target: 'live' | 'detached' | 'ignored'
}>

export function applyStripeEventObservation(
  connection: DatabaseConnection,
  observation: StripeEventObservation
): StripeEventApplication {
  return connection.sqlite
    .transaction(() => {
      if (getBillingEventByStripeId(connection, observation.eventId)) {
        return { duplicate: true, target: 'ignored' } as const
      }

      const target = applyLiveObservation(connection, observation)
        ? 'live'
        : applyDetachedObservation(connection, observation)
          ? 'detached'
          : 'ignored'

      connection.sqlite
        .prepare(
          `insert into billing_events (
            stripe_event_id, event_type, provider_created_at, processed_at
          ) values (?, ?, ?, ?)`
        )
        .run(observation.eventId, observation.eventType, observation.eventCreatedAt, new Date().toISOString())

      return { duplicate: false, target } as const
    })
    .immediate()
}

export function applyManualStripeProjection(
  connection: DatabaseConnection,
  input: Readonly<{
    userId: string
    stripeCustomerId: string
    expectedRevision: string
    projection: CurrentBillingProjection
  }>
): boolean {
  return connection.sqlite
    .transaction(() => {
      if (hasExternalFamilyMembership(connection, input.userId)) return false

      const owner = connection.sqlite
        .prepare(
          `select o.id
           from organization o
           join member m on m.organization_id = o.id
           where o.personal_owner_user_id = ? and m.user_id = ? and m.role = 'owner'`
        )
        .get(input.userId, input.userId) as { id: string } | undefined
      if (!owner) return false

      const customer = getBillingCustomerForOrganization(connection, owner.id)
      if (!customer || customer.stripeCustomerId !== input.stripeCustomerId) return false

      if (billingReconciliationRevision(connection, input.userId) !== input.expectedRevision) {
        return false
      }

      const current = getBillingSubscriptionForOrganization(connection, owner.id)
      // A manual read observes Stripe's current state but has no provider event
      // ordering key. Keep the last verified provider order so the next newer
      // webhook remains authoritative while duplicate/equal events compare the
      // freshly reconciled projection instead of restoring stale state.
      writeProjection(connection, customer, input.projection, current?.projectionOrderMs ?? 0, null)
      if (input.projection.status !== 'none' && !input.projection.reconciliationRequired) {
        const openAttempt = getOpenCheckoutAttempt(connection, owner.id)
        if (openAttempt) {
          markOrganizationReconciliation(connection, owner.id, 'overlapping_checkout_attempt')
        }
      }
      return true
    })
    .immediate()
}

export function applySafetyStripeProjection(
  connection: DatabaseConnection,
  input: Readonly<{
    userId: string
    stripeCustomerId: string
    expectedRevision: string
    catalog: StripeBillingCatalog
    projection: CurrentBillingProjection
    subscription: Stripe.Subscription | null
    schedule: Stripe.SubscriptionSchedule | null
  }>
): boolean {
  return connection.sqlite
    .transaction(() => {
      if (
        hasExternalFamilyMembership(connection, input.userId) ||
        billingReconciliationRevision(connection, input.userId) !== input.expectedRevision
      ) {
        return false
      }

      const owner = connection.sqlite
        .prepare(
          `select o.id
           from organization o
           join member m on m.organization_id = o.id
           where o.personal_owner_user_id = ? and m.user_id = ? and m.role = 'owner'`
        )
        .get(input.userId, input.userId) as { id: string } | undefined
      if (!owner || getOpenCheckoutAttempt(connection, owner.id) || getOpenBillingTransition(connection, owner.id)) {
        return false
      }

      const customer = getBillingCustomerForOrganization(connection, owner.id)
      const current = getBillingSubscriptionForOrganization(connection, owner.id)
      if (
        !customer ||
        customer.stripeCustomerId !== input.stripeCustomerId ||
        !current ||
        !current.stripeSubscriptionId ||
        (!input.projection.reconciliationRequired &&
          input.projection.stripeSubscriptionId !== current.stripeSubscriptionId)
      ) {
        return false
      }

      let projection = input.projection
      let grace: GraceProjectionMutation = { kind: 'default' }
      if (!projection.reconciliationRequired) {
        if (
          !input.subscription ||
          !isExactManagedSubscription(input.subscription, input.stripeCustomerId, projection, input.catalog)
        ) {
          projection = failClosedProjection(projection, 'safety_subscription_shape_mismatch')
          grace = { kind: 'preserve' }
        } else if (input.subscription.pending_update || input.schedule || stripeId(input.subscription.schedule)) {
          projection = failClosedProjection(projection, 'safety_untracked_transition')
          grace = { kind: 'preserve' }
        } else if (current.graceInvoiceId) {
          const invoice = expandedInvoice(input.subscription.latest_invoice)
          if (
            projection.status === 'active' &&
            invoice?.id === current.graceInvoiceId &&
            isExactRenewalInvoice(invoice, input.subscription, 'paid')
          ) {
            grace = { kind: 'clear' }
          } else if (projection.status === 'past_due' || projection.status === 'unpaid') {
            grace = { kind: 'preserve' }
          } else if (isTerminalProjectionStatus(projection.status)) {
            grace = { kind: 'clear' }
          } else {
            projection = failClosedProjection(projection, 'safety_recovery_evidence_mismatch')
            grace = { kind: 'preserve' }
          }
        } else if (projection.status === 'past_due' || projection.status === 'unpaid') {
          projection = failClosedProjection(projection, missingAuthenticatedFailureInvoiceReason)
          grace = { kind: 'preserve' }
        } else if (isTerminalProjectionStatus(projection.status)) {
          grace = { kind: 'clear' }
        }
      } else {
        grace = { kind: 'preserve' }
      }

      const cancellationEdge =
        current.planKey === 'family' &&
        !current.cancelAtPeriodEnd &&
        projection.status === 'active' &&
        projection.cancelAtPeriodEnd &&
        !projection.reconciliationRequired
      const terminalEdge =
        current.planKey === 'family' &&
        !isTerminalProjectionStatus(current.status) &&
        isTerminalProjectionStatus(projection.status) &&
        !projection.reconciliationRequired
      const episodeKey =
        cancellationEdge && input.subscription
          ? `${input.subscription.id}:cancel_at_period_end:${input.subscription.cancel_at ?? 'period_end'}`
          : terminalEdge && input.subscription
            ? `${input.subscription.id}:terminal:${input.subscription.status}:${input.subscription.ended_at ?? input.subscription.canceled_at ?? 'observed'}`
            : null

      writeProjection(
        connection,
        customer,
        projection,
        current.projectionOrderMs,
        episodeKey ?? current.projectionEventId,
        grace
      )
      if (episodeKey) {
        enqueueBillingFamilyLifecycleSignal(connection, {
          action: cancellationEdge ? 'renewal_ending' : 'coverage_ended',
          billingSubscriptionId: current.id,
          billingTransitionId: null,
          episodeKey
        })
      }
      return true
    })
    .immediate()
}

export function applyStripeTransitionConvergence(
  connection: DatabaseConnection,
  input: Readonly<{
    userId: string
    transitionId: string
    stripeCustomerId: string
    expectedBillingRevision: string
    catalog: StripeBillingCatalog
    projection: CurrentBillingProjection
    subscription: Stripe.Subscription | null
    schedule: Stripe.SubscriptionSchedule | null
    observedAt: Date
  }>
): boolean {
  return connection.sqlite
    .transaction(() => {
      if (
        hasExternalFamilyMembership(connection, input.userId) ||
        billingReconciliationRevision(connection, input.userId) !== input.expectedBillingRevision
      ) {
        return false
      }

      const owner = connection.sqlite
        .prepare(
          `select o.id
           from organization o
           join member m on m.organization_id = o.id
           where o.personal_owner_user_id = ? and m.user_id = ? and m.role = 'owner'`
        )
        .get(input.userId, input.userId) as { id: string } | undefined
      const customer = owner ? getBillingCustomerForOrganization(connection, owner.id) : null
      const current = owner ? getBillingSubscriptionForOrganization(connection, owner.id) : null
      const transition = owner ? getOpenBillingTransition(connection, owner.id) : null
      if (
        !owner ||
        !customer ||
        customer.stripeCustomerId !== input.stripeCustomerId ||
        !current ||
        !transition ||
        transition.id !== input.transitionId ||
        !['pending', 'action_required', 'scheduled', 'reconciliation_required'].includes(transition.state) ||
        getOpenCheckoutAttempt(connection, owner.id)
      ) {
        return false
      }

      const eventType = transitionConvergenceEventType(
        transition,
        input.projection,
        input.subscription,
        input.schedule,
        input.observedAt
      )
      const observation: StripeEventObservation = {
        eventId: `transition-convergence:${transition.id}`,
        eventType,
        eventCreatedAt: Math.floor(input.observedAt.getTime() / 1_000),
        objectId:
          eventType.startsWith('subscription_schedule.') && input.schedule
            ? input.schedule.id
            : (input.subscription?.id ?? current.stripeSubscriptionId ?? transition.id),
        catalog: input.catalog,
        attemptId: null,
        stripeCustomerId: input.stripeCustomerId,
        stripeSessionId: null,
        checkoutState: null,
        projection: input.projection,
        reconciliationReason: input.projection.reconciliationReason,
        providerState: {
          kind: 'subscription',
          subscription: input.subscription,
          schedule: input.schedule
        }
      }
      const lifecycle = resolveStripeWebhookLifecycle(connection, customer, observation)
      if (currentProjectionFingerprint(lifecycle.projection) !== persistedProjectionFingerprint(current)) {
        writeProjection(
          connection,
          customer,
          lifecycle.projection,
          current.projectionOrderMs,
          current.projectionEventId,
          lifecycle.grace
        )
      } else {
        applyMatchedGraceMutation(connection, current, lifecycle.grace)
      }
      applyStripeWebhookLifecycleEffects(connection, lifecycle)
      return true
    })
    .immediate()
}

export function applyVerifiedBillingTransitionProjection(
  connection: DatabaseConnection,
  input: Readonly<{
    userId: string
    expected: BillingTransitionReservation
    targetStripePriceId: string
    projection: CurrentBillingProjection
  }>
): boolean {
  return connection.sqlite
    .transaction(() => {
      const { expected, projection } = input
      if (
        hasExternalFamilyMembership(connection, input.userId) ||
        projection.reconciliationRequired ||
        projection.status !== 'active' ||
        projection.planKey !== expected.transition.targetPlanKey ||
        projection.cadence !== expected.transition.targetCadence ||
        projection.stripePriceId !== input.targetStripePriceId ||
        projection.stripeSubscriptionId !== expected.subscription.stripeSubscriptionId ||
        projection.stripeSubscriptionItemId !== expected.subscription.stripeSubscriptionItemId ||
        !projection.currentPeriodStart ||
        !projection.currentPeriodEnd ||
        projection.cancelAtPeriodEnd
      ) {
        return false
      }

      const owner = connection.sqlite
        .prepare(
          `select o.id
           from organization o
           join member m on m.organization_id = o.id
           where o.personal_owner_user_id = ? and m.user_id = ? and m.role = 'owner'`
        )
        .get(input.userId, input.userId) as { id: string } | undefined
      const transition = getBillingTransitionById(connection, expected.transition.id)
      const openTransition = owner ? getOpenBillingTransition(connection, owner.id) : null
      const customer = owner ? getBillingCustomerForOrganization(connection, owner.id) : null
      const subscription = owner ? getBillingSubscriptionForOrganization(connection, owner.id) : null
      if (
        !owner ||
        owner.id !== expected.transition.organizationId ||
        !transition ||
        transition.id !== openTransition?.id ||
        transition.revision !== expected.transition.revision ||
        transition.state !== 'pending' ||
        transition.capturedBillingRevision !== expected.transition.capturedBillingRevision ||
        !customer ||
        customer.id !== expected.customer.id ||
        customer.stripeCustomerId !== expected.customer.stripeCustomerId ||
        !subscription ||
        subscription.id !== expected.subscription.id ||
        subscription.revision !== expected.subscription.revision ||
        subscription.billingCustomerId !== expected.subscription.billingCustomerId ||
        subscription.stripeSubscriptionId !== expected.subscription.stripeSubscriptionId ||
        subscription.stripeSubscriptionItemId !== expected.subscription.stripeSubscriptionItemId ||
        subscription.planKey !== expected.transition.sourcePlanKey ||
        subscription.cadence !== expected.transition.sourceCadence ||
        subscription.status !== 'active' ||
        subscription.cancelAtPeriodEnd ||
        subscription.reconciliationRequired ||
        getOpenCheckoutAttempt(connection, owner.id)
      ) {
        return false
      }

      const updated = connection.sqlite
        .prepare(
          `update billing_subscription_transitions
           set state = 'applied', state_reason = null, revision = revision + 1, updated_at = ?
           where id = ? and revision = ? and state = 'pending'`
        )
        .run(new Date().toISOString(), transition.id, transition.revision)
      if (updated.changes !== 1) return false

      writeProjection(connection, customer, projection, subscription.projectionOrderMs, null)
      return true
    })
    .immediate()
}

export function billingReconciliationRevision(connection: DatabaseConnection, userId: string): string {
  const owner = connection.sqlite
    .prepare(
      `select o.id
       from organization o
       join member m on m.organization_id = o.id
       where o.personal_owner_user_id = ? and m.user_id = ? and m.role = 'owner'`
    )
    .get(userId, userId) as { id: string } | undefined
  if (!owner) return JSON.stringify(['missing-owner'])

  const customer = getBillingCustomerForOrganization(connection, owner.id)
  const snapshot = getBillingSubscriptionForOrganization(connection, owner.id)
  const attempt = getOpenCheckoutAttempt(connection, owner.id)
  const transition = getOpenBillingTransition(connection, owner.id)
  const externalMembership = hasExternalFamilyMembership(connection, userId)
  return JSON.stringify([
    externalMembership,
    customer ? [customer.id, customer.stripeCustomerId] : null,
    snapshot ? [snapshot.revision, snapshot.projectionOrderMs, persistedProjectionFingerprint(snapshot)] : null,
    attempt
      ? [
          attempt.id,
          attempt.billingCustomerId,
          attempt.stripeSessionId,
          attempt.state,
          attempt.reuseUntil,
          attempt.updatedAt
        ]
      : null,
    transition
      ? [
          transition.id,
          transition.billingSubscriptionId,
          transition.kind,
          transition.sourcePlanKey,
          transition.sourceCadence,
          transition.targetPlanKey,
          transition.targetCadence,
          transition.effectiveAt,
          transition.stripeSubscriptionScheduleId,
          transition.stripePendingInvoiceId,
          transition.stripePendingUpdateExpiresAt,
          transition.capturedBillingRevision,
          transition.state,
          transition.revision
        ]
      : null
  ])
}

type GraceProjectionMutation =
  | Readonly<{ kind: 'default' | 'preserve' | 'clear' }>
  | Readonly<{ kind: 'set'; invoiceId: string; startedAt: string; endsAt: string }>

type BillingTransitionLifecycleEffect = Readonly<{
  transition: BillingSubscriptionTransition
  state: 'action_required' | 'scheduled' | 'reconciliation_required' | 'applied' | 'failed' | 'canceled'
  reason: string | null
  stripePendingInvoiceId?: string | null
  stripePendingUpdateExpiresAt?: string | null
  stripeSubscriptionScheduleId?: string | null
}>

type BillingFamilyLifecycleEffect = Readonly<{
  action: 'payment_attention' | 'payment_grace_started' | 'renewal_ending' | 'coverage_ended'
  billingSubscriptionId: string
  billingTransitionId: string | null
  episodeKey: string
}>

type StripeWebhookLifecycleResolution = Readonly<{
  projection: CurrentBillingProjection
  grace: GraceProjectionMutation
  transition: BillingTransitionLifecycleEffect | null
  signals: readonly BillingFamilyLifecycleEffect[]
}>

function resolveStripeWebhookLifecycle(
  connection: DatabaseConnection,
  customer: BillingCustomer,
  observation: StripeEventObservation
): StripeWebhookLifecycleResolution {
  const providerProjection = observation.projection!
  const current = getBillingSubscriptionForOrganization(connection, customer.organizationId)
  const transition = getOpenBillingTransition(connection, customer.organizationId)
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

  const checkoutAttempt = observation.attemptId ? getCheckoutAttemptById(connection, observation.attemptId) : null
  if (
    checkoutAttempt &&
    checkoutAttempt.organizationId === customer.organizationId &&
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

  const signals: BillingFamilyLifecycleEffect[] = []
  if (
    current &&
    current.planKey === 'family' &&
    !current.cancelAtPeriodEnd &&
    providerProjection.status === 'active' &&
    providerProjection.cancelAtPeriodEnd
  ) {
    signals.push({
      action: 'renewal_ending',
      billingSubscriptionId: current.id,
      billingTransitionId: null,
      episodeKey: observation.eventId
    })
  }
  if (
    current &&
    current.planKey === 'family' &&
    !isTerminalProjectionStatus(current.status) &&
    isTerminalProjectionStatus(providerProjection.status)
  ) {
    signals.push({
      action: 'coverage_ended',
      billingSubscriptionId: current.id,
      billingTransitionId: null,
      episodeKey: observation.eventId
    })
  }

  return {
    projection: providerProjection,
    grace: isTerminalProjectionStatus(providerProjection.status) ? { kind: 'clear' } : { kind: 'default' },
    transition: null,
    signals
  }
}

function applyStripeWebhookLifecycleEffects(
  connection: DatabaseConnection,
  lifecycle: StripeWebhookLifecycleResolution
): void {
  if (lifecycle.transition) {
    const effect = lifecycle.transition
    const updated = connection.sqlite
      .prepare(
        `update billing_subscription_transitions
         set state = ?, state_reason = ?,
             stripe_pending_invoice_id = coalesce(?, stripe_pending_invoice_id),
             stripe_pending_update_expires_at = coalesce(?, stripe_pending_update_expires_at),
             stripe_subscription_schedule_id = coalesce(?, stripe_subscription_schedule_id),
             revision = revision + 1, updated_at = ?
         where id = ? and revision = ?`
      )
      .run(
        effect.state,
        effect.reason,
        effect.stripePendingInvoiceId ?? null,
        effect.stripePendingUpdateExpiresAt ?? null,
        effect.stripeSubscriptionScheduleId ?? null,
        new Date().toISOString(),
        effect.transition.id,
        effect.transition.revision
      )
    if (updated.changes !== 1) {
      markOrganizationReconciliation(connection, effect.transition.organizationId, 'transition_convergence_conflict')
      return
    }
  }

  for (const signal of lifecycle.signals) {
    enqueueBillingFamilyLifecycleSignal(connection, signal)
  }
}

function resolveOpenTransitionLifecycle(
  current: BillingSubscription | null,
  transition: BillingSubscriptionTransition,
  observation: StripeEventObservation,
  projection: CurrentBillingProjection,
  subscription: Stripe.Subscription | null
): StripeWebhookLifecycleResolution {
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

  if (transition.kind === 'personal_to_family') {
    return resolveImmediateTransitionLifecycle(current, transition, observation, projection, subscription)
  }
  return resolveScheduledTransitionLifecycle(current, transition, observation, projection, subscription)
}

function resolveImmediateTransitionLifecycle(
  current: BillingSubscription,
  transition: BillingSubscriptionTransition,
  observation: StripeEventObservation,
  projection: CurrentBillingProjection,
  subscription: Stripe.Subscription
): StripeWebhookLifecycleResolution {
  const sourcePriceId = transitionPriceId(observation.catalog, transition, 'source')
  const targetPriceId = transitionPriceId(observation.catalog, transition, 'target')
  const offering = projectionOffering(projection)
  const sourceOffering = transitionOffering(transition, 'source')
  const targetOffering = transitionOffering(transition, 'target')
  const scheduleId = stripeId(subscription.schedule)
  if (scheduleId) {
    return reconciliationLifecycle(projection, 'immediate_transition_has_schedule', transition)
  }

  if (offering === targetOffering) {
    const invoice = expandedInvoice(subscription.latest_invoice)
    if (
      subscription.pending_update !== null ||
      !isExactTransitionInvoice(invoice, current, transition.stripePendingInvoiceId, 'subscription_update', 'paid') ||
      (observation.providerState.kind === 'invoice' && observation.objectId !== invoice?.id) ||
      observation.eventType === 'customer.subscription.pending_update_expired'
    ) {
      return reconciliationLifecycle(projection, 'applied_transition_evidence_mismatch', transition)
    }
    return {
      projection,
      grace: { kind: 'clear' },
      transition: transitionEffect(transition, 'applied', null),
      signals: []
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
    return {
      projection,
      grace: { kind: 'default' },
      transition:
        transition.state === 'action_required' &&
        transition.stripePendingInvoiceId === pending.invoiceId &&
        transition.stripePendingUpdateExpiresAt === pending.expiresAt
          ? null
          : {
              transition,
              state: 'action_required',
              reason: 'payment_resolution_required',
              stripePendingInvoiceId: pending.invoiceId,
              stripePendingUpdateExpiresAt: pending.expiresAt
            },
      signals: []
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
      transition.stripePendingInvoiceId,
      'subscription_update',
      'void'
    )
  ) {
    return {
      projection,
      grace: { kind: 'default' },
      transition: transitionEffect(transition, 'failed', 'pending_update_expired'),
      signals: []
    }
  }

  if (transition.state === 'pending') {
    return { projection, grace: { kind: 'default' }, transition: null, signals: [] }
  }
  return reconciliationLifecycle(projection, 'pending_transition_disappeared', transition)
}

function resolveScheduledTransitionLifecycle(
  current: BillingSubscription,
  transition: BillingSubscriptionTransition,
  observation: StripeEventObservation,
  projection: CurrentBillingProjection,
  subscription: Stripe.Subscription
): StripeWebhookLifecycleResolution {
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
      ? { projection, grace: { kind: 'default' }, transition: null, signals: [] }
      : reconciliationLifecycle(projection, 'missing_transition_schedule', transition)
  }

  if (
    !schedule ||
    schedule.id !== expectedScheduleId ||
    (attachedScheduleId && attachedScheduleId !== expectedScheduleId) ||
    !isExactScheduleIdentity(schedule, current)
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
    const signals =
      transition.kind === 'family_to_personal'
        ? [
            {
              action: 'coverage_ended' as const,
              billingSubscriptionId: current.id,
              billingTransitionId: transition.id,
              episodeKey: transition.id
            }
          ]
        : []
    return {
      projection,
      grace: { kind: 'clear' },
      transition: transitionEffect(transition, 'applied', null),
      signals
    }
  }

  if (offering !== sourceOffering) {
    return reconciliationLifecycle(projection, 'scheduled_transition_offering_mismatch', transition)
  }

  if (observation.eventType === 'subscription_schedule.aborted' && schedule.status === 'canceled') {
    return {
      projection,
      grace: { kind: 'default' },
      transition: transitionEffect(transition, 'failed', 'subscription_schedule_aborted'),
      signals: []
    }
  }
  if (observation.eventType === 'subscription_schedule.canceled' && schedule.status === 'canceled') {
    return {
      projection,
      grace: { kind: 'default' },
      transition: transitionEffect(transition, 'canceled', 'subscription_schedule_canceled'),
      signals: []
    }
  }
  if (observation.eventType === 'subscription_schedule.released' && schedule.status === 'released') {
    return {
      projection,
      grace: { kind: 'default' },
      transition: transitionEffect(transition, 'canceled', 'subscription_schedule_released_early'),
      signals: []
    }
  }
  if (isScheduleTerminalEvent(observation.eventType)) {
    return reconciliationLifecycle(projection, 'schedule_terminal_state_mismatch', transition)
  }

  if (scheduleShape === 'created' && transition.state === 'pending') {
    return { projection, grace: { kind: 'default' }, transition: null, signals: [] }
  }
  if (scheduleShape !== 'configured' || !['active', 'not_started'].includes(schedule.status)) {
    return reconciliationLifecycle(projection, 'configured_schedule_shape_mismatch', transition)
  }

  return {
    projection,
    grace: { kind: 'default' },
    transition:
      transition.state === 'scheduled'
        ? null
        : {
            transition,
            state: 'scheduled',
            reason: null,
            stripeSubscriptionScheduleId: expectedScheduleId
          },
    signals: []
  }
}

function resolveDunningLifecycle(
  current: BillingSubscription | null,
  observation: StripeEventObservation,
  projection: CurrentBillingProjection
): StripeWebhookLifecycleResolution | null {
  if (observation.providerState.kind !== 'invoice') {
    if (current?.graceInvoiceId && projection.status === 'active' && !isTerminalProjectionStatus(projection.status)) {
      return reconciliationLifecycle(projection, 'active_recovery_without_paid_invoice')
    }
    if (projection.status === 'past_due' || projection.status === 'unpaid') {
      return reconciliationLifecycle(projection, missingAuthenticatedFailureInvoiceReason)
    }
    return null
  }

  const invoice = observation.providerState.invoice
  const subscription = observation.providerState.subscription
  if (!invoice || !subscription) return null

  if (observation.eventType === 'invoice.payment_action_required') {
    if (
      !isExactRenewalInvoice(invoice, subscription, 'open') ||
      (projection.status !== 'past_due' && projection.status !== 'unpaid')
    ) {
      return reconciliationLifecycle(projection, 'renewal_failure_evidence_mismatch')
    }
    if (current?.graceInvoiceId && current.graceInvoiceId !== invoice.id) {
      return reconciliationLifecycle(projection, 'renewal_failure_invoice_conflict')
    }
    return {
      projection,
      grace: { kind: 'preserve' },
      transition: null,
      signals: current
        ? [
            {
              action: 'payment_attention',
              billingSubscriptionId: current.id,
              billingTransitionId: null,
              episodeKey: invoice.id
            }
          ]
        : []
    }
  }

  if (observation.eventType === 'invoice.payment_failed') {
    if (
      !isExactRenewalInvoice(invoice, subscription, 'open') ||
      (projection.status !== 'past_due' && projection.status !== 'unpaid')
    ) {
      return reconciliationLifecycle(projection, 'renewal_failure_evidence_mismatch')
    }
    if (current?.graceInvoiceId && current.graceInvoiceId !== invoice.id) {
      return reconciliationLifecycle(projection, 'renewal_failure_invoice_conflict')
    }

    const window = graceWindowFromFirstFailure(new Date(observation.eventCreatedAt * 1_000))
    if (
      current?.graceInvoiceId === invoice.id &&
      current.graceStartedAt &&
      Date.parse(current.graceStartedAt) <= Date.parse(window.startedAt)
    ) {
      return {
        projection,
        grace: { kind: 'preserve' },
        transition: null,
        signals: []
      }
    }
    const signals: BillingFamilyLifecycleEffect[] = current
      ? current.graceInvoiceId
        ? []
        : [
            {
              action: 'payment_grace_started',
              billingSubscriptionId: current.id,
              billingTransitionId: null,
              episodeKey: invoice.id
            }
          ]
      : []
    return {
      projection,
      grace: {
        kind: 'set',
        invoiceId: invoice.id,
        startedAt: window.startedAt,
        endsAt: window.endsAt
      },
      transition: null,
      signals
    }
  }

  if (observation.eventType === 'invoice.paid') {
    if (current?.graceInvoiceId) {
      if (
        current.graceInvoiceId !== invoice.id ||
        projection.status !== 'active' ||
        !isExactRenewalInvoice(invoice, subscription, 'paid')
      ) {
        return reconciliationLifecycle(projection, 'paid_recovery_invoice_conflict')
      }
      return { projection, grace: { kind: 'clear' }, transition: null, signals: [] }
    }
    if (invoice.status !== 'paid' || invoice.amount_remaining !== 0) {
      return reconciliationLifecycle(projection, 'paid_invoice_evidence_mismatch')
    }
    return { projection, grace: { kind: 'clear' }, transition: null, signals: [] }
  }

  return null
}

function providerSubscription(state: StripeWebhookProviderState): Stripe.Subscription | null {
  return 'subscription' in state ? state.subscription : null
}

function providerSchedule(state: StripeWebhookProviderState): Stripe.SubscriptionSchedule | null {
  return 'schedule' in state ? state.schedule : null
}

function isExactManagedSubscription(
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
    !isExactTransitionInvoice(invoice, current, null, 'subscription_update', 'open')
  ) {
    return null
  }
  return {
    invoiceId: invoice!.id,
    expiresAt: new Date(pending.expires_at * 1_000).toISOString()
  }
}

function isExactTransitionInvoice(
  invoice: Stripe.Invoice | null,
  current: BillingSubscription,
  expectedInvoiceId: string | null,
  billingReason: Stripe.Invoice.BillingReason,
  status: Stripe.Invoice.Status
): boolean {
  return Boolean(
    invoice &&
    (!expectedInvoiceId || invoice.id === expectedInvoiceId) &&
    stripeId(invoice.customer) !== null &&
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

function isExactRenewalInvoice(
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

function isExactScheduleIdentity(schedule: Stripe.SubscriptionSchedule, current: BillingSubscription): boolean {
  const subscriptionId = stripeId(schedule.subscription) ?? stripeId(schedule.released_subscription)
  return Boolean(
    schedule.object === 'subscription_schedule' &&
    stripeId(schedule.customer) !== null &&
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
  if (schedule.phases.length !== 2 || !target || !isExactSchedulePhase(target, targetPriceId, sourceEnd, null, false)) {
    return 'mismatch'
  }
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

function transitionConvergenceEventType(
  transition: BillingSubscriptionTransition,
  projection: CurrentBillingProjection,
  subscription: Stripe.Subscription | null,
  schedule: Stripe.SubscriptionSchedule | null,
  observedAt: Date
): StripeWebhookEventType {
  if (transition.kind === 'personal_to_family') {
    const expiresAt = transition.stripePendingUpdateExpiresAt
      ? Date.parse(transition.stripePendingUpdateExpiresAt)
      : Number.NaN
    if (
      projectionOffering(projection) === transitionOffering(transition, 'source') &&
      !subscription?.pending_update &&
      Number.isFinite(expiresAt) &&
      observedAt.getTime() >= expiresAt
    ) {
      return 'customer.subscription.pending_update_expired'
    }
    return 'customer.subscription.updated'
  }

  if (schedule?.status === 'canceled') return 'subscription_schedule.canceled'
  if (schedule?.status === 'released') return 'subscription_schedule.released'
  if (schedule?.status === 'completed') return 'subscription_schedule.completed'
  return 'customer.subscription.updated'
}

function transitionEffect(
  transition: BillingSubscriptionTransition,
  state: BillingTransitionLifecycleEffect['state'],
  reason: string | null
): BillingTransitionLifecycleEffect {
  return { transition, state, reason }
}

function reconciliationLifecycle(
  projection: CurrentBillingProjection,
  reason: string,
  transition?: BillingSubscriptionTransition | null
): StripeWebhookLifecycleResolution {
  return {
    projection: failClosedProjection(projection, reason),
    grace: { kind: 'preserve' },
    transition: transition ? transitionEffect(transition, 'reconciliation_required', reason) : null,
    signals: []
  }
}

function failClosedProjection(projection: CurrentBillingProjection, reason: string): CurrentBillingProjection {
  return {
    ...projection,
    reconciliationRequired: true,
    reconciliationReason: reason
  }
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

function markTransitionReconciliation(
  connection: DatabaseConnection,
  transition: BillingSubscriptionTransition,
  reason: string
): void {
  connection.sqlite
    .prepare(
      `update billing_subscription_transitions
       set state = 'reconciliation_required', state_reason = ?, revision = revision + 1, updated_at = ?
       where id = ? and revision = ?`
    )
    .run(reason, new Date().toISOString(), transition.id, transition.revision)
}

function applyLiveObservation(connection: DatabaseConnection, observation: StripeEventObservation): boolean {
  const attempt = observation.attemptId ? getCheckoutAttemptById(connection, observation.attemptId) : null
  let customer = observation.stripeCustomerId
    ? getBillingCustomerByStripeId(connection, observation.stripeCustomerId)
    : null

  if (attempt && observation.reconciliationReason) {
    markAttemptReconciliation(connection, attempt, observation.reconciliationReason)
    if (!observation.stripeCustomerId) return true
  }

  if (
    attempt?.stripeSessionId &&
    observation.stripeSessionId &&
    attempt.stripeSessionId !== observation.stripeSessionId
  ) {
    markAttemptReconciliation(connection, attempt, 'checkout_session_conflict')
    return true
  }

  if (attempt && observation.stripeCustomerId) {
    customer = associateAttemptCustomer(connection, attempt.organizationId, attempt.id, observation.stripeCustomerId)
    if (!customer) {
      markAttemptReconciliation(connection, attempt, 'customer_association_conflict')
      return true
    }
  }

  if (attempt && observation.stripeSessionId) {
    if (attempt.stripeSessionId && attempt.stripeSessionId !== observation.stripeSessionId) {
      markOrganizationReconciliation(connection, attempt.organizationId, 'checkout_session_conflict')
    } else {
      connection.sqlite
        .prepare(
          `update billing_checkout_attempts
           set stripe_session_id = ?, state = ?, updated_at = ?
           where id = ?`
        )
        .run(
          observation.stripeSessionId,
          attempt.state === 'reconciliation_required'
            ? attempt.state
            : observation.checkoutState === 'expired'
              ? 'expired'
              : observation.checkoutState === 'failed'
                ? 'failed'
                : attempt.state,
          new Date().toISOString(),
          attempt.id
        )
    }
  } else if (attempt && (observation.checkoutState === 'expired' || observation.checkoutState === 'failed')) {
    connection.sqlite
      .prepare('update billing_checkout_attempts set state = ?, updated_at = ? where id = ?')
      .run(
        attempt.state === 'reconciliation_required' ? attempt.state : observation.checkoutState,
        new Date().toISOString(),
        attempt.id
      )
  }

  const organizationId = customer?.organizationId ?? attempt?.organizationId
  if (!organizationId) return false

  if (customer && attempt && customer.organizationId !== attempt.organizationId) {
    markAttemptReconciliation(connection, attempt, 'customer_organization_conflict')
    return true
  }

  if (customer && observation.projection) {
    const lifecycle = resolveStripeWebhookLifecycle(connection, customer, observation)
    const effectiveObservation = { ...observation, projection: lifecycle.projection }
    const projectionResult = applyOrderedProjection(connection, customer, effectiveObservation, lifecycle.grace)
    const projection = lifecycle.projection
    if (projectionResult === 'applied' || projectionResult === 'matched') {
      applyStripeWebhookLifecycleEffects(connection, lifecycle)
    } else if (projectionResult === 'conflict' && lifecycle.transition) {
      markTransitionReconciliation(connection, lifecycle.transition.transition, 'equal_event_order_conflict')
    }

    if (projection.reconciliationRequired) {
      if (attempt) {
        markAttemptReconciliation(
          connection,
          attempt,
          projection.reconciliationReason ?? 'ambiguous_provider_projection'
        )
      }
    } else if (
      attempt &&
      projection.status !== 'none' &&
      (projectionResult === 'applied' || projectionResult === 'matched') &&
      (attempt.planKey !== projection.planKey ||
        attempt.cadence !== projection.cadence ||
        attempt.stripePriceId !== projection.stripePriceId)
    ) {
      markAttemptReconciliation(connection, attempt, 'checkout_subscription_offering_conflict')
    } else if (projection.status !== 'none' && (projectionResult === 'applied' || projectionResult === 'matched')) {
      if (attempt && observation.checkoutState !== 'failed') {
        connection.sqlite
          .prepare("update billing_checkout_attempts set state = 'completed', updated_at = ? where id = ?")
          .run(new Date().toISOString(), attempt.id)
      }

      const competingAttempt = getOpenCheckoutAttempt(connection, customer.organizationId)
      if (competingAttempt && competingAttempt.id !== attempt?.id) {
        markOrganizationReconciliation(connection, customer.organizationId, 'overlapping_checkout_attempt')
      }
    } else if (
      observation.checkoutState === 'completed' &&
      projection.status === 'none' &&
      (projectionResult === 'applied' || projectionResult === 'matched')
    ) {
      if (attempt) {
        markAttemptReconciliation(connection, attempt, 'checkout_completed_without_subscription')
      } else {
        markOrganizationReconciliation(connection, customer.organizationId, 'checkout_completed_without_subscription')
      }
    }
  }

  return true
}

function associateAttemptCustomer(
  connection: DatabaseConnection,
  organizationId: string,
  attemptId: string,
  stripeCustomerId: string
): BillingCustomer | null {
  const organizationCustomer = getBillingCustomerForOrganization(connection, organizationId)
  const providerCustomer = getBillingCustomerByStripeId(connection, stripeCustomerId)

  if (
    (organizationCustomer && organizationCustomer.stripeCustomerId !== stripeCustomerId) ||
    (providerCustomer && providerCustomer.organizationId !== organizationId)
  ) {
    return null
  }

  const customer =
    organizationCustomer ?? providerCustomer ?? insertBillingCustomer(connection, organizationId, stripeCustomerId)

  const attempt = getCheckoutAttemptById(connection, attemptId)
  if (!attempt || (attempt.billingCustomerId && attempt.billingCustomerId !== customer.id)) return null

  connection.sqlite
    .prepare('update billing_checkout_attempts set billing_customer_id = ?, updated_at = ? where id = ?')
    .run(customer.id, new Date().toISOString(), attemptId)
  return customer
}

function insertBillingCustomer(
  connection: DatabaseConnection,
  organizationId: string,
  stripeCustomerId: string
): BillingCustomer {
  const now = new Date().toISOString()
  const id = `billing_customer_${randomUUID()}`
  connection.sqlite
    .prepare(
      `insert into billing_customers (
        id, organization_id, stripe_customer_id, created_at, updated_at
      ) values (?, ?, ?, ?, ?)`
    )
    .run(id, organizationId, stripeCustomerId, now, now)
  return getBillingCustomerForOrganization(connection, organizationId)!
}

type OrderedProjectionResult = 'applied' | 'matched' | 'conflict'
const missingAuthenticatedFailureInvoiceReason = 'missing_authenticated_failure_invoice'

function applyOrderedProjection(
  connection: DatabaseConnection,
  customer: BillingCustomer,
  observation: StripeEventObservation,
  grace: GraceProjectionMutation = { kind: 'default' }
): OrderedProjectionResult {
  const projection = protectCoveredMemberProjection(connection, customer.organizationId, observation.projection!)
  const orderMs = observation.eventCreatedAt * 1_000
  const current = getBillingSubscriptionForOrganization(connection, customer.organizationId)
  const projectionFingerprint = currentProjectionFingerprint(projection)

  if (current && orderMs < current.projectionOrderMs) {
    if (projectionFingerprint !== persistedProjectionFingerprint(current)) {
      if (isOlderAuthenticatedFailureResolution(current, projection, grace)) {
        applyOlderAuthenticatedFailureGrace(connection, current, grace)
        return 'matched'
      }
      markOrganizationReconciliation(connection, customer.organizationId, 'older_event_current_state_conflict')
      return 'conflict'
    }
    applyMatchedGraceMutation(connection, current, grace)
    return 'matched'
  }

  if (
    current &&
    orderMs === current.projectionOrderMs &&
    projectionFingerprint !== persistedProjectionFingerprint(current)
  ) {
    markOrganizationReconciliation(connection, customer.organizationId, 'equal_event_order_conflict')
    return 'conflict'
  }

  if (
    current &&
    orderMs === current.projectionOrderMs &&
    projectionFingerprint === persistedProjectionFingerprint(current)
  ) {
    applyMatchedGraceMutation(connection, current, grace)
    return 'matched'
  }

  writeProjection(connection, customer, projection, orderMs, observation.eventId, grace)
  return 'applied'
}

function isOlderAuthenticatedFailureResolution(
  current: BillingSubscription,
  projection: CurrentBillingProjection,
  mutation: GraceProjectionMutation
): mutation is Extract<GraceProjectionMutation, { kind: 'set' }> {
  if (
    mutation.kind !== 'set' ||
    !current.reconciliationRequired ||
    current.reconciliationReason !== missingAuthenticatedFailureInvoiceReason ||
    projection.reconciliationRequired
  ) {
    return false
  }

  return (
    currentProjectionFingerprint({
      ...projection,
      reconciliationRequired: true,
      reconciliationReason: missingAuthenticatedFailureInvoiceReason
    }) === persistedProjectionFingerprint(current)
  )
}

function applyOlderAuthenticatedFailureGrace(
  connection: DatabaseConnection,
  current: BillingSubscription,
  mutation: Extract<GraceProjectionMutation, { kind: 'set' }>
) {
  const now = new Date().toISOString()
  connection.sqlite
    .prepare(
      `update billing_subscriptions
       set grace_invoice_id = ?, grace_started_at = ?, grace_ends_at = ?,
           reconciliation_required = 0, reconciliation_reason = null,
           last_verified_at = ?, revision = revision + 1, updated_at = ?
       where id = ?
         and reconciliation_required = 1
         and reconciliation_reason = ?`
    )
    .run(
      mutation.invoiceId,
      mutation.startedAt,
      mutation.endsAt,
      now,
      now,
      current.id,
      missingAuthenticatedFailureInvoiceReason
    )
}

function applyMatchedGraceMutation(
  connection: DatabaseConnection,
  current: BillingSubscription,
  mutation: GraceProjectionMutation
) {
  if (mutation.kind !== 'set') return
  if (
    current.graceInvoiceId === mutation.invoiceId &&
    current.graceStartedAt &&
    Date.parse(current.graceStartedAt) <= Date.parse(mutation.startedAt)
  ) {
    return
  }

  const now = new Date().toISOString()
  connection.sqlite
    .prepare(
      `update billing_subscriptions
       set grace_invoice_id = ?, grace_started_at = ?, grace_ends_at = ?,
           last_verified_at = ?, revision = revision + 1, updated_at = ?
       where id = ?`
    )
    .run(mutation.invoiceId, mutation.startedAt, mutation.endsAt, now, now, current.id)
}

function writeProjection(
  connection: DatabaseConnection,
  customer: BillingCustomer,
  projection: CurrentBillingProjection,
  orderMs: number,
  eventId: string | null,
  grace: GraceProjectionMutation = { kind: 'default' }
) {
  const now = new Date().toISOString()
  const existing = getBillingSubscriptionForOrganization(connection, customer.organizationId)
  const protectedProjection = protectCoveredMemberProjection(connection, customer.organizationId, projection)
  const graceValues = projectionGraceValues(existing, protectedProjection, grace)
  const values = [
    protectedProjection.stripeSubscriptionId,
    protectedProjection.stripeSubscriptionItemId,
    protectedProjection.status,
    protectedProjection.planKey,
    protectedProjection.cadence,
    protectedProjection.stripePriceId,
    protectedProjection.currentPeriodStart,
    protectedProjection.currentPeriodEnd,
    protectedProjection.cancelAtPeriodEnd ? 1 : 0,
    graceValues.invoiceId,
    graceValues.startedAt,
    graceValues.endsAt,
    now,
    orderMs,
    eventId,
    protectedProjection.reconciliationRequired ? 1 : 0,
    protectedProjection.reconciliationReason,
    now
  ]

  if (existing) {
    connection.sqlite
      .prepare(
        `update billing_subscriptions set
          stripe_subscription_id = ?, stripe_subscription_item_id = ?, status = ?, plan_key = ?, cadence = ?,
          stripe_price_id = ?, current_period_start = ?, current_period_end = ?, cancel_at_period_end = ?,
          grace_invoice_id = ?, grace_started_at = ?, grace_ends_at = ?, last_verified_at = ?,
          projection_order_ms = ?, projection_event_id = ?, reconciliation_required = ?,
          reconciliation_reason = ?, revision = revision + 1, updated_at = ?
        where id = ?`
      )
      .run(...values, existing.id)
    return
  }

  connection.sqlite
    .prepare(
      `insert into billing_subscriptions (
        id, organization_id, billing_customer_id, stripe_subscription_id, stripe_subscription_item_id,
        status, plan_key, cadence, stripe_price_id, current_period_start, current_period_end,
        cancel_at_period_end, grace_invoice_id, grace_started_at, grace_ends_at, last_verified_at,
        projection_order_ms, projection_event_id, reconciliation_required, reconciliation_reason,
        created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(`billing_subscription_${randomUUID()}`, customer.organizationId, customer.id, ...values.slice(0, -1), now, now)
}

function projectionGraceValues(
  existing: BillingSubscription | null,
  projection: CurrentBillingProjection,
  mutation: GraceProjectionMutation
): Readonly<{ invoiceId: string | null; startedAt: string | null; endsAt: string | null }> {
  if (mutation.kind === 'set') {
    return {
      invoiceId: mutation.invoiceId,
      startedAt: mutation.startedAt,
      endsAt: mutation.endsAt
    }
  }
  if (mutation.kind === 'clear') {
    return { invoiceId: null, startedAt: null, endsAt: null }
  }
  const preserve =
    mutation.kind === 'preserve' ||
    (mutation.kind === 'default' && (projection.status === 'past_due' || projection.status === 'unpaid'))
  return preserve
    ? {
        invoiceId: existing?.graceInvoiceId ?? null,
        startedAt: existing?.graceStartedAt ?? null,
        endsAt: existing?.graceEndsAt ?? null
      }
    : { invoiceId: null, startedAt: null, endsAt: null }
}

function protectCoveredMemberProjection(
  connection: DatabaseConnection,
  organizationId: string,
  projection: CurrentBillingProjection
): CurrentBillingProjection {
  if (!projectionReservesBillingAuthority(projection)) return projection

  const owner = connection.sqlite
    .prepare('select personal_owner_user_id as userId from organization where id = ?')
    .get(organizationId) as { userId: string | null } | undefined
  if (!owner?.userId || !hasExternalFamilyMembership(connection, owner.userId)) return projection

  return {
    ...projection,
    reconciliationRequired: true,
    reconciliationReason: 'family_authority_conflict'
  }
}

function projectionReservesBillingAuthority(projection: CurrentBillingProjection): boolean {
  return (
    projection.reconciliationRequired ||
    projection.cancelAtPeriodEnd ||
    !['none', 'canceled', 'incomplete_expired'].includes(projection.status)
  )
}

function markOrganizationReconciliation(connection: DatabaseConnection, organizationId: string, reason: string) {
  const now = new Date().toISOString()
  connection.sqlite
    .prepare(
      `update billing_subscriptions
       set reconciliation_required = 1, reconciliation_reason = ?, revision = revision + 1, updated_at = ?
       where organization_id = ?`
    )
    .run(reason, now, organizationId)
  connection.sqlite
    .prepare(
      `update billing_checkout_attempts
       set state = 'reconciliation_required', updated_at = ?
       where organization_id = ? and state in ('pending', 'open', 'reconciliation_required')`
    )
    .run(now, organizationId)
}

function markAttemptReconciliation(
  connection: DatabaseConnection,
  attempt: { id: string; organizationId: string },
  reason: string
) {
  const openAttempt = getOpenCheckoutAttempt(connection, attempt.organizationId)
  if (!openAttempt) {
    connection.sqlite
      .prepare("update billing_checkout_attempts set state = 'reconciliation_required', updated_at = ? where id = ?")
      .run(new Date().toISOString(), attempt.id)
  }
  markOrganizationReconciliation(connection, attempt.organizationId, reason)
}

function applyDetachedObservation(connection: DatabaseConnection, observation: StripeEventObservation): boolean {
  const subjects = new Map<string, ReturnType<typeof getDetachedStripeBillingSubject>>()
  let attemptSubject: ReturnType<typeof getDetachedStripeBillingSubject> = null
  if (observation.attemptId) {
    const subject = getDetachedStripeBillingSubject(connection, {
      providerReference: `attempt:${observation.attemptId}`
    })
    if (subject) {
      attemptSubject = subject
      subjects.set(subject.id, subject)
    }
  }
  if (observation.stripeCustomerId) {
    for (const subject of listDetachedStripeBillingSubjectsForCustomer(connection, observation.stripeCustomerId)) {
      subjects.set(subject.id, subject)
    }
  }
  if (subjects.size === 0) return false

  for (const subject of subjects.values()) {
    if (!subject) continue
    if (subject.providerEventCreatedAt !== null && observation.eventCreatedAt < subject.providerEventCreatedAt) {
      continue
    }

    const nextCustomerId = observation.stripeCustomerId ?? subject.providerCustomerReference
    const nextStatus = observation.projection?.status ?? observation.checkoutState ?? subject.providerStatus
    const nextExpiry = observation.projection?.currentPeriodEnd ?? subject.providerStatusExpiresAt
    const equalConflict =
      subject.providerEventCreatedAt === observation.eventCreatedAt &&
      (subject.providerCustomerReference !== nextCustomerId ||
        subject.providerStatus !== nextStatus ||
        subject.providerStatusExpiresAt !== nextExpiry)
    connection.sqlite
      .prepare(
        `update detached_billing_subjects set
          provider_customer_reference = coalesce(?, provider_customer_reference),
          provider_status = ?, provider_status_expires_at = ?, provider_event_created_at = ?,
          status_updated_at = ?
        where id = ?`
      )
      .run(
        nextCustomerId,
        equalConflict ? 'reconciliation_required' : nextStatus,
        equalConflict ? null : nextExpiry,
        observation.eventCreatedAt,
        new Date().toISOString(),
        subject.id
      )
  }
  if (attemptSubject) {
    retainLateDetachedCheckoutSubscription(connection, attemptSubject, observation)
  }
  return true
}

function retainLateDetachedCheckoutSubscription(
  connection: DatabaseConnection,
  attemptSubject: NonNullable<ReturnType<typeof getDetachedStripeBillingSubject>>,
  observation: StripeEventObservation
): void {
  const attemptId = observation.attemptId
  const subscription = observation.providerState.subscription
  const subscriptionId = subscription?.id
  const customerId = subscription ? stripeId(subscription.customer) : null
  if (
    !attemptId ||
    !subscription ||
    !subscriptionId ||
    !customerId ||
    observation.stripeCustomerId !== customerId ||
    (observation.projection?.stripeSubscriptionId && observation.projection.stripeSubscriptionId !== subscriptionId)
  ) {
    return
  }

  const session = observation.providerState.kind === 'checkout' ? observation.providerState.session : null
  const checkoutCorrelated = Boolean(
    session &&
    session.id === observation.stripeSessionId &&
    session.client_reference_id === attemptId &&
    session.metadata?.billing_attempt_id === attemptId &&
    stripeId(session.customer) === customerId &&
    stripeId(session.subscription) === subscriptionId
  )
  const subscriptionCorrelated = subscription.metadata?.billing_attempt_id === attemptId
  if (!checkoutCorrelated && !subscriptionCorrelated) return

  const now = new Date().toISOString()
  connection.sqlite
    .prepare(
      `insert into detached_billing_subjects (
         id, provider, provider_reference, provider_customer_reference, provider_status,
         provider_status_expires_at, provider_event_created_at, status_updated_at, deleted_at,
         retention_purpose, retention_policy, purge_after
       ) values (?, 'stripe', ?, ?, ?, ?, ?, ?, ?, ?, ?, null)
       on conflict(provider, provider_reference) do nothing`
    )
    .run(
      `detached_billing_${randomUUID()}`,
      subscriptionId,
      customerId,
      subscription.status,
      observation.projection?.currentPeriodEnd ?? null,
      observation.eventCreatedAt,
      now,
      attemptSubject.deletedAt,
      attemptSubject.retentionPurpose,
      attemptSubject.retentionPolicy
    )

  const subject = getDetachedStripeBillingSubject(connection, {
    providerReference: subscriptionId
  })
  if (subject && !['canceled', 'incomplete_expired'].includes(subject.providerStatus)) {
    enqueueBillingDetachedSubscriptionCancellation(connection, subject.id, new Date(now))
  }
}
