import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { getBillingOffering, type BillingOfferingKey } from '../../../shared/billing'
import type { DatabaseConnection } from '../../db/connect'
import {
  getBillingCustomerForOrganization,
  getBillingSubscriptionForOrganization,
  getBillingTransitionById,
  getOpenBillingTransition,
  getOpenCheckoutAttempt,
  getOwnedBillingOrganization
} from '../../db/repositories/billing'
import { hasExternalFamilyMembership } from '../../db/repositories/family-authority'
import {
  billingSubscriptionTransitions,
  type BillingCustomer,
  type BillingSubscription,
  type BillingSubscriptionTransition
} from '../../db/schema'
import { enqueueBillingFamilyLifecycleSignal } from './billing-family-lifecycle-signal'
import { enqueueBillingTransitionConvergenceJob } from './billing-transition-convergence'
import { deriveBillingTransition } from './billing-transition-policy'

export type BillingTransitionReservation = Readonly<{
  transition: BillingSubscriptionTransition
  customer: BillingCustomer
  subscription: BillingSubscription
}>

export type BillingTransitionReservationResult =
  | Readonly<{ outcome: 'reserved'; reservation: BillingTransitionReservation }>
  | Readonly<{
      outcome: 'authority_lost' | 'conflicting_operation' | 'not_changeable' | 'same_offering'
    }>

export type BillingTransitionAuthorityResult =
  | Readonly<{ outcome: 'authorized'; reservation: BillingTransitionReservation }>
  | Readonly<{ outcome: 'authority_lost' | 'state_changed' }>

type TransitionProviderUpdate = Partial<
  Pick<
    BillingSubscriptionTransition,
    | 'effectiveAt'
    | 'state'
    | 'stateReason'
    | 'stripePendingInvoiceId'
    | 'stripePendingUpdateExpiresAt'
    | 'stripeSubscriptionScheduleId'
  >
>

export function reserveBillingTransition(
  connection: DatabaseConnection,
  input: Readonly<{
    userId: string
    targetOffering: BillingOfferingKey
    now: Date
  }>
): BillingTransitionReservationResult {
  return connection.sqlite
    .transaction(() => {
      const owner = getOwnedBillingOrganization(connection, input.userId)
      if (!owner || hasExternalFamilyMembership(connection, input.userId)) {
        return { outcome: 'authority_lost' as const }
      }
      if (owner.billingDeletionPending) {
        return { outcome: 'conflicting_operation' as const }
      }
      if (getOpenCheckoutAttempt(connection, owner.id) || getOpenBillingTransition(connection, owner.id)) {
        return { outcome: 'conflicting_operation' as const }
      }

      const customer = getBillingCustomerForOrganization(connection, owner.id)
      const subscription = getBillingSubscriptionForOrganization(connection, owner.id)
      if (!customer || !isLocallyChangeableSubscription(subscription, customer)) {
        return { outcome: 'not_changeable' as const }
      }

      const sourceOffering = getBillingOffering(`${subscription.planKey}.${subscription.cadence}`)
      if (!sourceOffering) return { outcome: 'not_changeable' as const }
      const decision = deriveBillingTransition(sourceOffering.plan, sourceOffering.cadence, input.targetOffering)
      if (!decision) return { outcome: 'same_offering' as const }

      const currentPeriodStartMs = Date.parse(subscription.currentPeriodStart!)
      const currentPeriodEndMs = Date.parse(subscription.currentPeriodEnd!)
      if (
        !Number.isFinite(currentPeriodStartMs) ||
        !Number.isFinite(currentPeriodEndMs) ||
        currentPeriodEndMs <= currentPeriodStartMs ||
        currentPeriodEndMs <= input.now.getTime()
      ) {
        return { outcome: 'not_changeable' as const }
      }

      const target = getBillingOffering(input.targetOffering)!
      if (decision.kind === 'family_to_personal') {
        connection.sqlite
          .prepare(
            `update invitation
             set status = 'canceled'
             where organization_id = ? and status = 'pending'`
          )
          .run(owner.id)
      }

      const timestamp = input.now.toISOString()
      const [transition] = connection.db
        .insert(billingSubscriptionTransitions)
        .values({
          id: `billing_transition_${randomUUID()}`,
          organizationId: owner.id,
          billingSubscriptionId: subscription.id,
          kind: decision.kind,
          sourcePlanKey: sourceOffering.plan,
          sourceCadence: sourceOffering.cadence,
          targetPlanKey: target.plan,
          targetCadence: target.cadence,
          effectiveAt: decision.mechanism === 'subscription_schedule' ? subscription.currentPeriodEnd : null,
          idempotencyKey: `billing_change_${randomUUID()}`,
          capturedBillingRevision: subscription.revision,
          state: 'pending',
          revision: 0,
          createdAt: timestamp,
          updatedAt: timestamp
        })
        .returning()
        .all()

      if (!transition) throw new Error('Failed to reserve billing transition')
      return {
        outcome: 'reserved' as const,
        reservation: { transition, customer, subscription }
      }
    })
    .immediate()
}

export function recheckBillingTransitionAuthority(
  connection: DatabaseConnection,
  userId: string,
  expected: BillingTransitionReservation
): BillingTransitionAuthorityResult {
  return connection.sqlite.transaction(() => readBillingTransitionAuthority(connection, userId, expected)).immediate()
}

export function recordAuthorizedBillingTransition(
  connection: DatabaseConnection,
  userId: string,
  expected: BillingTransitionReservation,
  update: TransitionProviderUpdate
): BillingTransitionAuthorityResult {
  return connection.sqlite
    .transaction(() => {
      const authority = readBillingTransitionAuthority(connection, userId, expected)
      if (authority.outcome !== 'authorized') return authority

      const live = authority.reservation.transition
      const [transition] = connection.db
        .update(billingSubscriptionTransitions)
        .set({
          ...update,
          revision: live.revision + 1,
          updatedAt: new Date().toISOString()
        })
        .where(
          and(
            eq(billingSubscriptionTransitions.id, live.id),
            eq(billingSubscriptionTransitions.revision, live.revision)
          )
        )
        .returning()
        .all()
      if (!transition) return { outcome: 'state_changed' as const }

      enqueueTransitionLifecycleJobs(connection, transition)
      return {
        outcome: 'authorized' as const,
        reservation: {
          transition,
          customer: authority.reservation.customer,
          subscription: authority.reservation.subscription
        }
      }
    })
    .immediate()
}

function enqueueTransitionLifecycleJobs(
  connection: DatabaseConnection,
  transition: BillingSubscriptionTransition
): void {
  const runAfterValue =
    transition.state === 'scheduled'
      ? transition.effectiveAt
      : transition.state === 'action_required'
        ? transition.stripePendingUpdateExpiresAt
        : null
  if (runAfterValue) {
    const runAfter = new Date(runAfterValue)
    if (!Number.isFinite(runAfter.getTime())) {
      throw new TypeError('Invalid billing transition convergence deadline')
    }
    enqueueBillingTransitionConvergenceJob(connection, transition.id, runAfter)
  }

  if (transition.kind === 'family_to_personal' && transition.state === 'scheduled') {
    enqueueBillingFamilyLifecycleSignal(connection, {
      action: 'renewal_ending',
      billingSubscriptionId: transition.billingSubscriptionId,
      billingTransitionId: transition.id,
      episodeKey: transition.id
    })
  }
  if (transition.kind === 'personal_to_family' && transition.state === 'action_required') {
    enqueueBillingFamilyLifecycleSignal(connection, {
      action: 'payment_attention',
      billingSubscriptionId: transition.billingSubscriptionId,
      billingTransitionId: transition.id,
      episodeKey: transition.id
    })
  }
}

export function markBillingTransitionReconciliation(
  connection: DatabaseConnection,
  expected: BillingTransitionReservation,
  reason: string,
  providerReferences: Readonly<{
    stripePendingInvoiceId?: string | null
    stripePendingUpdateExpiresAt?: string | null
    stripeSubscriptionScheduleId?: string | null
  }> = {}
): BillingSubscriptionTransition | null {
  return connection.sqlite
    .transaction(() => {
      const live = getBillingTransitionById(connection, expected.transition.id)
      if (!live || live.revision !== expected.transition.revision) return null

      const [updated] = connection.db
        .update(billingSubscriptionTransitions)
        .set({
          state: 'reconciliation_required',
          stateReason: reason,
          ...providerReferences,
          revision: live.revision + 1,
          updatedAt: new Date().toISOString()
        })
        .where(
          and(
            eq(billingSubscriptionTransitions.id, live.id),
            eq(billingSubscriptionTransitions.revision, live.revision)
          )
        )
        .returning()
        .all()
      return updated ?? null
    })
    .immediate()
}

function readBillingTransitionAuthority(
  connection: DatabaseConnection,
  userId: string,
  expected: BillingTransitionReservation
): BillingTransitionAuthorityResult {
  const owner = getOwnedBillingOrganization(connection, userId)
  if (!owner || owner.id !== expected.transition.organizationId || hasExternalFamilyMembership(connection, userId)) {
    return { outcome: 'authority_lost' }
  }
  if (owner.billingDeletionPending) return { outcome: 'state_changed' }

  const transition = getBillingTransitionById(connection, expected.transition.id)
  const openTransition = getOpenBillingTransition(connection, owner.id)
  const customer = getBillingCustomerForOrganization(connection, owner.id)
  const subscription = getBillingSubscriptionForOrganization(connection, owner.id)
  if (
    !transition ||
    transition.revision !== expected.transition.revision ||
    transition.organizationId !== expected.transition.organizationId ||
    transition.billingSubscriptionId !== expected.transition.billingSubscriptionId ||
    transition.capturedBillingRevision !== expected.transition.capturedBillingRevision ||
    transition.kind !== expected.transition.kind ||
    transition.sourcePlanKey !== expected.transition.sourcePlanKey ||
    transition.sourceCadence !== expected.transition.sourceCadence ||
    transition.targetPlanKey !== expected.transition.targetPlanKey ||
    transition.targetCadence !== expected.transition.targetCadence ||
    openTransition?.id !== transition.id ||
    getOpenCheckoutAttempt(connection, owner.id) !== null ||
    !customer ||
    customer.id !== expected.customer.id ||
    customer.stripeCustomerId !== expected.customer.stripeCustomerId ||
    !subscription ||
    !sameCapturedSubscription(subscription, expected.subscription)
  ) {
    return { outcome: 'state_changed' }
  }

  return {
    outcome: 'authorized',
    reservation: { transition, customer, subscription }
  }
}

function isLocallyChangeableSubscription(
  subscription: BillingSubscription | null,
  customer: BillingCustomer
): subscription is BillingSubscription & {
  cadence: NonNullable<BillingSubscription['cadence']>
  currentPeriodEnd: string
  currentPeriodStart: string
  planKey: NonNullable<BillingSubscription['planKey']>
  stripePriceId: string
  stripeSubscriptionId: string
  stripeSubscriptionItemId: string
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
    current.organizationId === expected.organizationId &&
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
