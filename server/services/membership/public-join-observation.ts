import { isMembershipDuesOfferingKey } from '../../../shared/billing'
import type { PublicJoinAttempt } from '../../db/schema/public-join'
import type { StripeEventObservation } from '../payments/stripe/webhook'
import { isExactPaidInitialInvoice } from '../payments/stripe/webhook-state'
import type { BillingStripeConnection } from '../payments/stripe/public-contract'
import { publicJoinClaimExpiryMs, readPublicJoinAttempt } from './public-join'
import { enqueuePublicJoinClaimJob } from './public-join-job'

export function applyPublicJoinObservationInTransaction(
  connection: BillingStripeConnection,
  observation: StripeEventObservation,
  now: Date
): boolean {
  const attempt = publicJoinAttemptForObservation(connection, observation)
  if (!attempt || attempt.claimedUserId || attempt.state === 'active' || attempt.state === 'claimed') return false

  if (observation.providerState.kind === 'checkout') {
    applyPublicJoinCheckoutObservation(connection, attempt, observation, now)
    return true
  }
  applyPublicJoinProjectionObservation(connection, attempt, observation, now)
  return true
}

function applyPublicJoinCheckoutObservation(
  connection: BillingStripeConnection,
  attempt: PublicJoinAttempt,
  observation: StripeEventObservation,
  now: Date
): void {
  const providerState = observation.providerState
  if (providerState.kind !== 'checkout') {
    markReconciliation(connection, attempt.id, 'public_join_checkout_conflict', observation, now)
    return
  }
  const session = providerState.session
  const offering = `${attempt.planKey}.${attempt.cadence}`
  if (
    !session ||
    observation.attemptId !== attempt.id ||
    !observation.stripeSessionId ||
    (attempt.stripeSessionId && attempt.stripeSessionId !== observation.stripeSessionId) ||
    !isMembershipDuesOfferingKey(offering) ||
    providerState.checkoutOffering !== offering
  ) {
    markReconciliation(connection, attempt.id, 'public_join_checkout_conflict', observation, now)
    return
  }

  if (observation.checkoutState === 'expired' || observation.checkoutState === 'failed') {
    connection.sqlite
      .prepare(
        `update public_join_attempts set stripe_session_id = ?, state = ?, reconciliation_reason = null,
           updated_at = ? where id = ? and claimed_user_id is null`
      )
      .run(
        observation.stripeSessionId,
        observation.checkoutState === 'expired' ? 'expired' : 'failed',
        now.toISOString(),
        attempt.id
      )
    return
  }

  const projection = observation.projection
  const subscription = providerState.subscription
  const email = normalizedEmail(session.customer_details?.email)
  if (
    observation.checkoutState !== 'completed' ||
    observation.reconciliationReason ||
    !projection ||
    projection.reconciliationRequired ||
    projection.status !== 'active' ||
    projection.planKey !== attempt.planKey ||
    projection.cadence !== attempt.cadence ||
    projection.stripePriceId !== attempt.stripePriceId ||
    !observation.stripeCustomerId ||
    !subscription ||
    !isExactPaidInitialInvoice(subscription, observation.stripeCustomerId) ||
    !email
  ) {
    markReconciliation(
      connection,
      attempt.id,
      observation.reconciliationReason ?? 'public_join_payment_unverified',
      observation,
      now
    )
    return
  }

  const timestamp = now.toISOString()
  connection.sqlite
    .prepare(
      `update public_join_attempts set stripe_session_id = ?, state = 'paid',
         stripe_customer_id = ?, stripe_subscription_id = ?, stripe_subscription_item_id = ?,
         subscription_status = ?, current_period_start = ?, current_period_end = ?,
         cancel_at_period_end = ?, projection_order_ms = ?, projection_event_id = ?,
         reconciliation_reason = null, email = ?, claim_expires_at = ?, updated_at = ?
       where id = ? and claimed_user_id is null`
    )
    .run(
      observation.stripeSessionId,
      observation.stripeCustomerId,
      projection.stripeSubscriptionId,
      projection.stripeSubscriptionItemId,
      projection.status,
      projection.currentPeriodStart,
      projection.currentPeriodEnd,
      projection.cancelAtPeriodEnd ? 1 : 0,
      observation.eventCreatedAt * 1_000,
      observation.eventId,
      email,
      new Date(now.getTime() + publicJoinClaimExpiryMs).toISOString(),
      timestamp,
      attempt.id
    )
  enqueuePublicJoinClaimJob(connection, attempt.id, now)
}

function applyPublicJoinProjectionObservation(
  connection: BillingStripeConnection,
  attempt: PublicJoinAttempt,
  observation: StripeEventObservation,
  now: Date
): void {
  const projection = observation.projection
  if (
    !projection ||
    !observation.stripeCustomerId ||
    (attempt.stripeCustomerId && attempt.stripeCustomerId !== observation.stripeCustomerId) ||
    (attempt.stripeSubscriptionId && projection.stripeSubscriptionId !== attempt.stripeSubscriptionId) ||
    projection.planKey !== attempt.planKey ||
    projection.cadence !== attempt.cadence ||
    projection.stripePriceId !== attempt.stripePriceId ||
    projection.reconciliationRequired
  ) {
    markReconciliation(
      connection,
      attempt.id,
      observation.reconciliationReason ?? 'public_join_projection_conflict',
      observation,
      now
    )
    return
  }
  const eventOrderMs = observation.eventCreatedAt * 1_000
  if (eventOrderMs < attempt.projectionOrderMs) return
  connection.sqlite
    .prepare(
      `update public_join_attempts set stripe_customer_id = coalesce(stripe_customer_id, ?),
         stripe_subscription_id = ?, stripe_subscription_item_id = ?, subscription_status = ?,
         current_period_start = ?, current_period_end = ?, cancel_at_period_end = ?,
         projection_order_ms = ?, projection_event_id = ?, updated_at = ? where id = ? and claimed_user_id is null`
    )
    .run(
      observation.stripeCustomerId,
      projection.stripeSubscriptionId,
      projection.stripeSubscriptionItemId,
      projection.status,
      projection.currentPeriodStart,
      projection.currentPeriodEnd,
      projection.cancelAtPeriodEnd ? 1 : 0,
      eventOrderMs,
      observation.eventId,
      now.toISOString(),
      attempt.id
    )
}

function publicJoinAttemptForObservation(
  connection: BillingStripeConnection,
  observation: StripeEventObservation
): PublicJoinAttempt | null {
  if (observation.attemptId) {
    const byAttempt = readPublicJoinAttempt(connection, observation.attemptId)
    if (byAttempt) return byAttempt
  }
  if (!observation.stripeCustomerId) return null
  const row = connection.sqlite
    .prepare(
      `select id from public_join_attempts where stripe_customer_id = ? and claimed_user_id is null
       order by created_at desc limit 2`
    )
    .all(observation.stripeCustomerId) as Array<{ id: string }>
  return row.length === 1 ? readPublicJoinAttempt(connection, row[0]!.id) : null
}

function markReconciliation(
  connection: BillingStripeConnection,
  attemptId: string,
  reason: string,
  observation: StripeEventObservation,
  now: Date
): void {
  connection.sqlite
    .prepare(
      `update public_join_attempts set state = 'reconciliation_required', reconciliation_reason = ?,
         stripe_session_id = coalesce(stripe_session_id, ?),
         stripe_customer_id = coalesce(stripe_customer_id, ?), updated_at = ?
       where id = ? and claimed_user_id is null`
    )
    .run(reason, observation.stripeSessionId, observation.stripeCustomerId, now.toISOString(), attemptId)
}

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return normalized.length >= 3 && normalized.length <= 320 && normalized.includes('@') ? normalized : null
}
