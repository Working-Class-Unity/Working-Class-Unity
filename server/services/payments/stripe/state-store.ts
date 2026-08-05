import { randomUUID } from 'node:crypto'
import type { CurrentBillingProjection } from './projection'
import {
  authorizePurchaserBilling,
  synchronizePurchaserBilling,
  type BillingStripeConnection,
  type BillingStripeIntegration,
  type BillingStripeLifecycleEffect,
  type BillingStripeProjectionSnapshot,
  type BillingStripeStateCommitCause,
  type BillingStripeTransitionSnapshot
} from './public-contract'
import { getBillingCustomerForPurchaser, getBillingSubscriptionForPurchaser } from './repository'
import type { BillingSubscription } from '../../../db/schema/billing'
import { isBillingOfferingKey } from '../../../../shared/billing'
import { enqueueBillingStripeNotification } from './notification-delivery'

export type BillingProjectionCommit = CurrentBillingProjection &
  Readonly<{
    graceInvoiceId?: string | null
    graceStartedAt?: string | null
    graceEndsAt?: string | null
  }>

export type BillingProjectionCommitResult =
  | Readonly<{ outcome: 'applied'; snapshot: BillingStripeProjectionSnapshot }>
  | Readonly<{ outcome: 'authority_lost' | 'state_changed'; snapshot: null }>

export type BillingProjectionCommitInput = Readonly<{
  purchaserUserId: string
  stripeCustomerId: string
  expectedRevision: number
  projection: BillingProjectionCommit
  cause: BillingStripeStateCommitCause
  verifiedAt: Date
  projectionOrderMs?: number
  projectionEventId?: string | null
  transition?: BillingStripeTransitionSnapshot | null
  effects?: readonly BillingStripeLifecycleEffect[]
}>

export function commitBillingProjection(
  connection: BillingStripeConnection,
  integration: BillingStripeIntegration<BillingStripeConnection, unknown> | undefined,
  input: BillingProjectionCommitInput
): BillingProjectionCommitResult {
  return connection.sqlite
    .transaction(() => commitBillingProjectionInTransaction(connection, integration, input))
    .immediate()
}

export function commitBillingProjectionInTransaction(
  connection: BillingStripeConnection,
  integration: BillingStripeIntegration<BillingStripeConnection, unknown> | undefined,
  input: BillingProjectionCommitInput
): BillingProjectionCommitResult {
  const customer = getBillingCustomerForPurchaser(connection, input.purchaserUserId)
  if (!customer || customer.stripeCustomerId !== input.stripeCustomerId) {
    return { outcome: 'authority_lost', snapshot: null }
  }
  const live = getBillingSubscriptionForPurchaser(connection, input.purchaserUserId)
  if ((live?.revision ?? 0) !== input.expectedRevision || (live && live.billingCustomerId !== customer.id)) {
    return { outcome: 'state_changed', snapshot: null }
  }

  const before = projectionSnapshot(input.purchaserUserId, customer.stripeCustomerId, live)
  let projection = normalizedProjection(input.projection)
  const proposedAfter = projectionTargetSnapshot(
    input.purchaserUserId,
    live?.id ?? null,
    projection,
    input.expectedRevision + 1,
    live
  )
  const authorization = authorizePurchaserBilling(connection, integration, {
    kind: 'projection',
    purchaserUserId: input.purchaserUserId,
    source: input.cause,
    before,
    after: proposedAfter
  })
  if (authorization !== 'authorized') {
    projection = {
      ...projection,
      reconciliationRequired: true,
      reconciliationReason: 'integration_authority_conflict'
    }
  }

  const timestamp = input.verifiedAt.toISOString()
  const grace = nextGrace(live, projection)
  if (live) {
    const result = connection.sqlite
      .prepare(
        `update billing_subscriptions set
           stripe_subscription_id = ?, stripe_subscription_item_id = ?, status = ?, plan_key = ?, cadence = ?,
           stripe_price_id = ?, current_period_start = ?, current_period_end = ?, cancel_at_period_end = ?,
           grace_invoice_id = ?, grace_started_at = ?, grace_ends_at = ?, last_verified_at = ?,
           projection_order_ms = ?, projection_event_id = ?, reconciliation_required = ?,
           reconciliation_reason = ?, revision = revision + 1, updated_at = ?
         where id = ? and purchaser_user_id = ? and billing_customer_id = ? and revision = ?`
      )
      .run(
        projection.stripeSubscriptionId,
        projection.stripeSubscriptionItemId,
        projection.status,
        projection.planKey,
        projection.cadence,
        projection.stripePriceId,
        projection.currentPeriodStart,
        projection.currentPeriodEnd,
        projection.cancelAtPeriodEnd ? 1 : 0,
        grace.invoiceId,
        grace.startedAt,
        grace.endsAt,
        timestamp,
        input.projectionOrderMs ?? live.projectionOrderMs,
        input.projectionEventId ?? live.projectionEventId,
        projection.reconciliationRequired ? 1 : 0,
        projection.reconciliationReason,
        timestamp,
        live.id,
        input.purchaserUserId,
        customer.id,
        input.expectedRevision
      )
    if (result.changes !== 1) return { outcome: 'state_changed', snapshot: null }
  } else {
    if (input.expectedRevision !== 0) return { outcome: 'state_changed', snapshot: null }
    const id = `billing_subscription_${randomUUID()}`
    connection.sqlite
      .prepare(
        `insert into billing_subscriptions (
           id, purchaser_user_id, billing_customer_id, stripe_subscription_id, stripe_subscription_item_id,
           status, plan_key, cadence, stripe_price_id, current_period_start, current_period_end,
           cancel_at_period_end, grace_invoice_id, grace_started_at, grace_ends_at, last_verified_at,
           projection_order_ms, projection_event_id, reconciliation_required, reconciliation_reason,
           revision, created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(
        id,
        input.purchaserUserId,
        customer.id,
        projection.stripeSubscriptionId,
        projection.stripeSubscriptionItemId,
        projection.status,
        projection.planKey,
        projection.cadence,
        projection.stripePriceId,
        projection.currentPeriodStart,
        projection.currentPeriodEnd,
        projection.cancelAtPeriodEnd ? 1 : 0,
        grace.invoiceId,
        grace.startedAt,
        grace.endsAt,
        timestamp,
        input.projectionOrderMs ?? 0,
        input.projectionEventId ?? null,
        projection.reconciliationRequired ? 1 : 0,
        projection.reconciliationReason,
        timestamp,
        timestamp
      )
  }

  const committed = getBillingSubscriptionForPurchaser(connection, input.purchaserUserId)
  if (!committed) throw new Error('Billing projection commit did not persist a subscription')
  const after = projectionSnapshot(input.purchaserUserId, customer.stripeCustomerId, committed)
  const effects = mergeLifecycleEffects(before, after, input.effects ?? [])
  synchronizePurchaserBilling(connection, integration, {
    kind: 'state_committed',
    purchaserUserId: input.purchaserUserId,
    cause: input.cause,
    before,
    after,
    transition: input.transition ?? null,
    effects
  })
  for (const effect of effects) {
    if (effect.action !== 'payment_attention' && effect.action !== 'payment_grace_started') continue
    enqueueBillingStripeNotification(
      connection,
      {
        kind: 'payment_attention',
        purchaserUserId: input.purchaserUserId,
        episodeKey: JSON.stringify([effect.action, effect.episodeKey, effect.transitionId])
      },
      input.verifiedAt
    )
  }
  return { outcome: 'applied', snapshot: after }
}

function mergeLifecycleEffects(
  before: BillingStripeProjectionSnapshot,
  after: BillingStripeProjectionSnapshot,
  supplied: readonly BillingStripeLifecycleEffect[]
): readonly BillingStripeLifecycleEffect[] {
  if (after.reconciliationRequired) return Object.freeze([])
  const effects = [...supplied]
  const hasAction = (action: BillingStripeLifecycleEffect['action']) =>
    effects.some((effect) => effect.action === action)
  if (
    !after.reconciliationRequired &&
    !hasAction('payment_grace_started') &&
    ['past_due', 'unpaid'].includes(after.status) &&
    !before.paymentGraceActive &&
    after.paymentGraceActive
  ) {
    effects.push({
      action: 'payment_grace_started',
      episodeKey: JSON.stringify([
        'payment_grace_started',
        after.billingSubscriptionId,
        after.graceStartedAt,
        after.graceEndsAt
      ]),
      effectiveAt: after.graceStartedAt,
      transitionId: null
    })
  }
  if (
    !after.reconciliationRequired &&
    !hasAction('renewal_ending') &&
    before.offering?.startsWith('family.') &&
    !before.cancelAtPeriodEnd &&
    after.status === 'active' &&
    after.cancelAtPeriodEnd
  ) {
    effects.push({
      action: 'renewal_ending',
      episodeKey: JSON.stringify(['renewal_ending', after.billingSubscriptionId, after.currentPeriodEnd]),
      effectiveAt: after.currentPeriodEnd,
      transitionId: null
    })
  }
  if (
    !after.reconciliationRequired &&
    !hasAction('coverage_ended') &&
    before.offering?.startsWith('family.') &&
    !['canceled', 'incomplete_expired', 'none'].includes(before.status) &&
    ['canceled', 'incomplete_expired'].includes(after.status)
  ) {
    effects.push({
      action: 'coverage_ended',
      episodeKey: JSON.stringify(['coverage_ended', after.billingSubscriptionId, after.currentPeriodEnd]),
      effectiveAt: after.currentPeriodEnd,
      transitionId: null
    })
  }
  return Object.freeze(effects)
}

export function projectionSnapshot(
  purchaserUserId: string,
  _stripeCustomerId: string | null,
  subscription: BillingSubscription | null
): BillingStripeProjectionSnapshot {
  const offering =
    subscription?.planKey && subscription.cadence ? `${subscription.planKey}.${subscription.cadence}` : null
  return Object.freeze({
    billingSubscriptionId: subscription?.id ?? null,
    purchaserUserId,
    status: subscription?.status ?? 'none',
    offering: offering && isBillingOfferingKey(offering) ? offering : null,
    currentPeriodStart: subscription?.currentPeriodStart ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    paymentGraceActive: subscription?.graceInvoiceId !== null && subscription?.graceInvoiceId !== undefined,
    graceStartedAt: subscription?.graceStartedAt ?? null,
    graceEndsAt: subscription?.graceEndsAt ?? null,
    reconciliationRequired: subscription?.reconciliationRequired ?? false,
    revision: subscription?.revision ?? 0
  })
}

function projectionTargetSnapshot(
  purchaserUserId: string,
  billingSubscriptionId: string | null,
  projection: BillingProjectionCommit,
  revision: number,
  live: BillingSubscription | null
): BillingStripeProjectionSnapshot {
  const offering = projection.planKey && projection.cadence ? `${projection.planKey}.${projection.cadence}` : null
  const grace = nextGrace(live, projection)
  return Object.freeze({
    billingSubscriptionId,
    purchaserUserId,
    status: projection.status,
    offering: offering && isBillingOfferingKey(offering) ? offering : null,
    currentPeriodStart: projection.currentPeriodStart,
    currentPeriodEnd: projection.currentPeriodEnd,
    cancelAtPeriodEnd: projection.cancelAtPeriodEnd,
    paymentGraceActive: grace.invoiceId !== null,
    graceStartedAt: grace.startedAt,
    graceEndsAt: grace.endsAt,
    reconciliationRequired: projection.reconciliationRequired,
    revision
  })
}

function normalizedProjection(projection: BillingProjectionCommit): BillingProjectionCommit {
  if (!projection.reconciliationRequired) return projection
  return {
    ...projection,
    reconciliationReason: projection.reconciliationReason || 'provider_projection_ambiguous'
  }
}

function nextGrace(live: BillingSubscription | null, projection: BillingProjectionCommit) {
  const paymentAttention =
    projection.status === 'past_due' || projection.status === 'unpaid' || projection.reconciliationRequired
  return {
    invoiceId: paymentAttention ? (projection.graceInvoiceId ?? live?.graceInvoiceId ?? null) : null,
    startedAt: paymentAttention ? (projection.graceStartedAt ?? live?.graceStartedAt ?? null) : null,
    endsAt: paymentAttention ? (projection.graceEndsAt ?? live?.graceEndsAt ?? null) : null
  }
}
