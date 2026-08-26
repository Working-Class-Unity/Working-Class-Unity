import { randomUUID } from 'node:crypto'
import { getBillingOffering, isBillingOfferingKey, type BillingOfferingKey } from '../../../../shared/billing'
import {
  authorizePurchaserBilling,
  synchronizePurchaserBilling,
  type BillingStripeConnection,
  type BillingStripeIntegration,
  type BillingStripeLifecycleEffect,
  type BillingStripeTransitionSnapshot
} from './public-contract'
import {
  getBillingCustomerForPurchaser,
  getBillingSubscriptionForPurchaser,
  getBillingTransitionById,
  getOpenBillingTransition,
  getOpenCheckoutAttempt,
  isBillingDeletionPending
} from './repository'
import type { BillingCustomer, BillingSubscription, BillingSubscriptionTransition } from '../../../db/schema/billing'
import { commitBillingProjectionInTransaction, projectionSnapshot, type BillingProjectionCommit } from './state-store'
import { deriveBillingTransition } from './transition-policy'
import { enqueueBillingStripeNotification } from './notification-delivery'

export const billingTransitionConvergenceJobType = 'billing.transition-convergence' as const

export type BillingTransitionReservation = Readonly<{
  transition: BillingSubscriptionTransition
  customer: BillingCustomer
  subscription: BillingSubscription
}>

export type BillingTransitionReservationResult =
  | Readonly<{ outcome: 'reserved'; reservation: BillingTransitionReservation }>
  | Readonly<{ outcome: 'authority_lost' | 'conflicting_operation' | 'not_changeable' | 'same_offering' }>

export type BillingTransitionAuthorityResult =
  | Readonly<{ outcome: 'authorized'; reservation: BillingTransitionReservation }>
  | Readonly<{ outcome: 'authority_lost' | 'state_changed' }>

export type TransitionProviderUpdate = Readonly<{
  effectiveAt?: string | null
  state?: BillingSubscriptionTransition['state']
  stateReason?: string | null
  stripePendingInvoiceId?: string | null
  stripePendingUpdateExpiresAt?: string | null
  stripeSubscriptionScheduleId?: string | null
}>

export function reserveBillingTransition(
  connection: BillingStripeConnection,
  integration: BillingStripeIntegration<BillingStripeConnection, unknown> | undefined,
  input: Readonly<{ purchaserUserId: string; targetOffering: BillingOfferingKey; now: Date }>
): BillingTransitionReservationResult {
  return connection.sqlite
    .transaction(() => {
      if (isBillingDeletionPending(connection, input.purchaserUserId)) {
        return { outcome: 'conflicting_operation' as const }
      }
      if (
        getOpenCheckoutAttempt(connection, input.purchaserUserId) ||
        getOpenBillingTransition(connection, input.purchaserUserId)
      ) {
        return { outcome: 'conflicting_operation' as const }
      }
      const customer = getBillingCustomerForPurchaser(connection, input.purchaserUserId)
      const subscription = getBillingSubscriptionForPurchaser(connection, input.purchaserUserId)
      if (!customer || !isLocallyChangeableSubscription(subscription, customer)) {
        return { outcome: 'not_changeable' as const }
      }
      const sourceKey = `${subscription.planKey}.${subscription.cadence}`
      if (!isBillingOfferingKey(sourceKey)) return { outcome: 'not_changeable' as const }
      const source = getBillingOffering(sourceKey)!
      const decision = deriveBillingTransition(source.plan, source.cadence, input.targetOffering)
      if (!decision) return { outcome: 'same_offering' as const }
      const target = getBillingOffering(input.targetOffering)!
      const start = Date.parse(subscription.currentPeriodStart)
      const end = Date.parse(subscription.currentPeriodEnd)
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end <= input.now.getTime()) {
        return { outcome: 'not_changeable' as const }
      }
      const authorization = authorizePurchaserBilling(connection, integration, {
        kind: 'change',
        purchaserUserId: input.purchaserUserId,
        sourceOffering: sourceKey,
        targetOffering: input.targetOffering
      })
      if (authorization === 'authority_lost') return { outcome: 'authority_lost' as const }
      if (authorization !== 'authorized') return { outcome: 'not_changeable' as const }

      const id = `billing_transition_${randomUUID()}`
      const timestamp = input.now.toISOString()
      connection.sqlite
        .prepare(
          `insert into billing_subscription_transitions (
           id, purchaser_user_id, billing_subscription_id, kind, source_plan_key, source_cadence,
           target_plan_key, target_cadence, effective_at, stripe_subscription_schedule_id,
           stripe_pending_invoice_id, stripe_pending_update_expires_at, idempotency_key,
           captured_billing_revision, state, state_reason, revision, created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, null, null, null, ?, ?, 'pending', null, 0, ?, ?)`
        )
        .run(
          id,
          input.purchaserUserId,
          subscription.id,
          decision.kind,
          source.plan,
          source.cadence,
          target.plan,
          target.cadence,
          decision.mechanism === 'subscription_schedule' ? subscription.currentPeriodEnd : null,
          `billing_change_${randomUUID()}`,
          subscription.revision,
          timestamp,
          timestamp
        )
      const transition = getBillingTransitionById(connection, id)
      if (!transition) throw new Error('Failed to reserve Billing transition')
      synchronizePurchaserBilling(connection, integration, {
        kind: 'transition_reserved',
        purchaserUserId: input.purchaserUserId,
        billingSubscriptionId: subscription.id,
        transitionId: transition.id,
        transitionKind: transition.kind,
        sourceOffering: sourceKey,
        targetOffering: input.targetOffering,
        capturedBillingRevision: subscription.revision
      })
      return { outcome: 'reserved' as const, reservation: Object.freeze({ transition, customer, subscription }) }
    })
    .immediate()
}

export function recheckBillingTransitionAuthority(
  connection: BillingStripeConnection,
  integration: BillingStripeIntegration<BillingStripeConnection, unknown> | undefined,
  purchaserUserId: string,
  expected: BillingTransitionReservation
): BillingTransitionAuthorityResult {
  return connection.sqlite
    .transaction(() => readAuthority(connection, integration, purchaserUserId, expected))
    .immediate()
}

export function recordAuthorizedBillingTransition(
  connection: BillingStripeConnection,
  integration: BillingStripeIntegration<BillingStripeConnection, unknown> | undefined,
  purchaserUserId: string,
  expected: BillingTransitionReservation,
  update: TransitionProviderUpdate
): BillingTransitionAuthorityResult {
  return connection.sqlite
    .transaction(() => {
      const authority = readAuthority(connection, integration, purchaserUserId, expected)
      if (authority.outcome !== 'authorized') return authority
      const live = authority.reservation.transition
      const result = connection.sqlite
        .prepare(
          `update billing_subscription_transitions set
           effective_at = ?, state = ?, state_reason = ?, stripe_pending_invoice_id = ?,
           stripe_pending_update_expires_at = ?, stripe_subscription_schedule_id = ?,
           revision = revision + 1, updated_at = ?
         where id = ? and revision = ?`
        )
        .run(
          update.effectiveAt === undefined ? live.effectiveAt : update.effectiveAt,
          update.state ?? live.state,
          update.stateReason === undefined ? live.stateReason : update.stateReason,
          update.stripePendingInvoiceId === undefined ? live.stripePendingInvoiceId : update.stripePendingInvoiceId,
          update.stripePendingUpdateExpiresAt === undefined
            ? live.stripePendingUpdateExpiresAt
            : update.stripePendingUpdateExpiresAt,
          update.stripeSubscriptionScheduleId === undefined
            ? live.stripeSubscriptionScheduleId
            : update.stripeSubscriptionScheduleId,
          new Date().toISOString(),
          live.id,
          live.revision
        )
      if (result.changes !== 1) return { outcome: 'state_changed' as const }
      const transition = getBillingTransitionById(connection, live.id)!
      enqueueTransitionConvergence(connection, transition)
      const effect = transitionLifecycleEffect(transition)
      if (effect) {
        const snapshot = projectionSnapshot(
          purchaserUserId,
          authority.reservation.customer.stripeCustomerId,
          authority.reservation.subscription
        )
        synchronizePurchaserBilling(connection, integration, {
          kind: 'state_committed',
          purchaserUserId,
          cause: 'transition',
          before: snapshot,
          after: snapshot,
          transition: normalizedTransitionSnapshot(transition),
          effects: Object.freeze([effect])
        })
        if (effect.action === 'payment_attention') {
          enqueueBillingStripeNotification(connection, {
            kind: 'payment_attention',
            purchaserUserId,
            episodeKey: JSON.stringify([effect.action, effect.episodeKey, effect.transitionId])
          })
        }
      }
      return {
        outcome: 'authorized' as const,
        reservation: Object.freeze({
          transition,
          customer: authority.reservation.customer,
          subscription: authority.reservation.subscription
        })
      }
    })
    .immediate()
}

export function applyAuthorizedBillingTransitionProjection(
  connection: BillingStripeConnection,
  integration: BillingStripeIntegration<BillingStripeConnection, unknown> | undefined,
  purchaserUserId: string,
  expected: BillingTransitionReservation,
  projection: BillingProjectionCommit,
  now = new Date()
): boolean {
  const rejected = Symbol('billing-transition-projection-rejected')
  try {
    return connection.sqlite
      .transaction(() => {
        const authority = readAuthority(connection, integration, purchaserUserId, expected)
        if (authority.outcome !== 'authorized') return false
        const transitionUpdate = connection.sqlite
          .prepare(
            `update billing_subscription_transitions
         set state = 'applied', state_reason = null, revision = revision + 1, updated_at = ?
         where id = ? and revision = ? and state in ('pending', 'action_required', 'scheduled')`
          )
          .run(now.toISOString(), authority.reservation.transition.id, authority.reservation.transition.revision)
        if (transitionUpdate.changes !== 1) return false
        const committedTransition = getBillingTransitionById(connection, authority.reservation.transition.id)
        if (!committedTransition) throw new Error('Applied Billing transition disappeared')
        const effects: BillingStripeLifecycleEffect[] = []
        const committed = commitBillingProjectionInTransaction(connection, integration, {
          purchaserUserId,
          stripeCustomerId: authority.reservation.customer.stripeCustomerId,
          expectedRevision: authority.reservation.subscription.revision,
          projection,
          cause: 'transition',
          verifiedAt: now,
          transition: normalizedTransitionSnapshot(committedTransition),
          effects
        })
        if (committed.outcome !== 'applied') throw rejected
        return true
      })
      .immediate()
  } catch (error) {
    if (error === rejected) return false
    throw error
  }
}

export function markBillingTransitionReconciliation(
  connection: BillingStripeConnection,
  expected: BillingTransitionReservation,
  reason: string,
  references: Pick<
    TransitionProviderUpdate,
    'stripePendingInvoiceId' | 'stripePendingUpdateExpiresAt' | 'stripeSubscriptionScheduleId'
  > = {}
): BillingSubscriptionTransition | null {
  return connection.sqlite
    .transaction(() => {
      const live = getBillingTransitionById(connection, expected.transition.id)
      if (!live || live.revision !== expected.transition.revision) return null
      const result = connection.sqlite
        .prepare(
          `update billing_subscription_transitions set state = 'reconciliation_required', state_reason = ?,
           stripe_pending_invoice_id = ?, stripe_pending_update_expires_at = ?, stripe_subscription_schedule_id = ?,
           revision = revision + 1, updated_at = ? where id = ? and revision = ?`
        )
        .run(
          reason,
          references.stripePendingInvoiceId ?? live.stripePendingInvoiceId,
          references.stripePendingUpdateExpiresAt ?? live.stripePendingUpdateExpiresAt,
          references.stripeSubscriptionScheduleId ?? live.stripeSubscriptionScheduleId,
          new Date().toISOString(),
          live.id,
          live.revision
        )
      return result.changes === 1 ? getBillingTransitionById(connection, live.id) : null
    })
    .immediate()
}

function readAuthority(
  connection: BillingStripeConnection,
  integration: BillingStripeIntegration<BillingStripeConnection, unknown> | undefined,
  purchaserUserId: string,
  expected: BillingTransitionReservation
): BillingTransitionAuthorityResult {
  if (isBillingDeletionPending(connection, purchaserUserId)) return { outcome: 'state_changed' }
  const transition = getBillingTransitionById(connection, expected.transition.id)
  const open = getOpenBillingTransition(connection, purchaserUserId)
  const customer = getBillingCustomerForPurchaser(connection, purchaserUserId)
  const subscription = getBillingSubscriptionForPurchaser(connection, purchaserUserId)
  if (
    !transition ||
    transition.purchaserUserId !== purchaserUserId ||
    transition.revision !== expected.transition.revision ||
    transition.billingSubscriptionId !== expected.transition.billingSubscriptionId ||
    transition.capturedBillingRevision !== expected.transition.capturedBillingRevision ||
    transition.kind !== expected.transition.kind ||
    transition.sourcePlanKey !== expected.transition.sourcePlanKey ||
    transition.sourceCadence !== expected.transition.sourceCadence ||
    transition.targetPlanKey !== expected.transition.targetPlanKey ||
    transition.targetCadence !== expected.transition.targetCadence ||
    open?.id !== transition.id ||
    getOpenCheckoutAttempt(connection, purchaserUserId) ||
    !customer ||
    customer.id !== expected.customer.id ||
    customer.stripeCustomerId !== expected.customer.stripeCustomerId ||
    !subscription ||
    !sameCapturedSubscription(subscription, expected.subscription)
  ) {
    return { outcome: 'state_changed' }
  }
  const sourceOffering = `${transition.sourcePlanKey}.${transition.sourceCadence}`
  const targetOffering = `${transition.targetPlanKey}.${transition.targetCadence}`
  if (!isBillingOfferingKey(sourceOffering) || !isBillingOfferingKey(targetOffering)) {
    return { outcome: 'state_changed' }
  }
  const authorization = authorizePurchaserBilling(connection, integration, {
    kind: 'change',
    purchaserUserId,
    sourceOffering,
    targetOffering
  })
  if (authorization === 'authority_lost') return { outcome: 'authority_lost' }
  if (authorization !== 'authorized') return { outcome: 'state_changed' }
  return { outcome: 'authorized', reservation: Object.freeze({ transition, customer, subscription }) }
}

function isLocallyChangeableSubscription(
  subscription: BillingSubscription | null,
  customer: BillingCustomer
): subscription is BillingSubscription & {
  planKey: NonNullable<BillingSubscription['planKey']>
  cadence: NonNullable<BillingSubscription['cadence']>
  stripePriceId: string
  stripeSubscriptionId: string
  stripeSubscriptionItemId: string
  currentPeriodStart: string
  currentPeriodEnd: string
} {
  return Boolean(
    subscription &&
    subscription.billingCustomerId === customer.id &&
    subscription.status === 'active' &&
    subscription.planKey &&
    subscription.cadence &&
    subscription.stripePriceId &&
    subscription.stripeSubscriptionId &&
    subscription.stripeSubscriptionItemId &&
    subscription.currentPeriodStart &&
    subscription.currentPeriodEnd &&
    !subscription.cancelAtPeriodEnd &&
    !subscription.reconciliationRequired &&
    !subscription.graceInvoiceId &&
    !subscription.graceStartedAt &&
    !subscription.graceEndsAt
  )
}

function sameCapturedSubscription(current: BillingSubscription, expected: BillingSubscription): boolean {
  return (
    current.id === expected.id &&
    current.purchaserUserId === expected.purchaserUserId &&
    current.billingCustomerId === expected.billingCustomerId &&
    current.stripeSubscriptionId === expected.stripeSubscriptionId &&
    current.stripeSubscriptionItemId === expected.stripeSubscriptionItemId &&
    current.status === 'active' &&
    current.planKey === expected.planKey &&
    current.cadence === expected.cadence &&
    current.stripePriceId === expected.stripePriceId &&
    current.currentPeriodStart === expected.currentPeriodStart &&
    current.currentPeriodEnd === expected.currentPeriodEnd &&
    current.revision === expected.revision &&
    !current.cancelAtPeriodEnd &&
    !current.reconciliationRequired
  )
}

function enqueueTransitionConvergence(
  connection: BillingStripeConnection,
  transition: BillingSubscriptionTransition
): void {
  const runAfter =
    transition.state === 'scheduled'
      ? transition.effectiveAt
      : transition.state === 'action_required'
        ? transition.stripePendingUpdateExpiresAt
        : null
  if (!runAfter) return
  if (!Number.isFinite(Date.parse(runAfter))) throw new TypeError('Invalid Billing transition convergence deadline')
  const timestamp = new Date().toISOString()
  const payload = JSON.stringify({ transitionId: transition.id })
  connection.sqlite
    .prepare(
      `insert into job_queue (type, payload, max_attempts, run_after, created_at, updated_at)
       select ?, ?, 12, ?, ?, ?
       where not exists (
         select 1 from job_queue where type = ? and status in ('queued', 'running')
           and json_extract(payload, '$.transitionId') = ?
       )`
    )
    .run(
      billingTransitionConvergenceJobType,
      payload,
      runAfter,
      timestamp,
      timestamp,
      billingTransitionConvergenceJobType,
      transition.id
    )
}

function transitionLifecycleEffect(transition: BillingSubscriptionTransition): BillingStripeLifecycleEffect | null {
  if (transition.kind === 'personal_to_family' && transition.state === 'action_required') {
    return Object.freeze({
      action: 'payment_attention',
      episodeKey: transition.id,
      effectiveAt: transition.stripePendingUpdateExpiresAt,
      transitionId: transition.id
    })
  }
  return null
}

export function normalizedTransitionSnapshot(
  transition: BillingSubscriptionTransition
): BillingStripeTransitionSnapshot {
  const sourceOffering = `${transition.sourcePlanKey}.${transition.sourceCadence}`
  const targetOffering = `${transition.targetPlanKey}.${transition.targetCadence}`
  if (!isBillingOfferingKey(sourceOffering) || !isBillingOfferingKey(targetOffering)) {
    throw new Error('Billing transition offering is malformed')
  }
  return Object.freeze({
    id: transition.id,
    kind: transition.kind,
    sourceOffering,
    targetOffering,
    state: transition.state,
    effectiveAt: transition.effectiveAt
  })
}
