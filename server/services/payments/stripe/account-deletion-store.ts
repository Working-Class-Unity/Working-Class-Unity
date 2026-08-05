import { randomUUID } from 'node:crypto'
import type { BillingStripeConnection } from './public-contract'
import {
  getBillingAccountDeletionRequest,
  getBillingCustomerForPurchaser,
  getBillingSubscriptionForPurchaser,
  getOpenCheckoutAttempt
} from './repository'
import type { BillingAccountDeletionRequest } from '../../../db/schema/billing'
import { enqueueBillingStripeNotification } from './notification-delivery'

export const billingAccountDeletionCancellationMaxAttempts = 12
export const billingAccountDeletionCancellationDelayMs = 60_000
export const billingAccountDeletionCancellationSafetyBatchSize = 25

export type BillingStripeAccountDeletionCapture = Readonly<{
  request: BillingAccountDeletionRequest
  hasOpenCheckout: boolean
}>

export function captureBillingStripeAccountDeletion(
  connection: BillingStripeConnection,
  purchaserUserId: string,
  now = new Date()
): BillingStripeAccountDeletionCapture {
  return connection.sqlite
    .transaction(() => {
      const customer = getBillingCustomerForPurchaser(connection, purchaserUserId)
      const subscription = getBillingSubscriptionForPurchaser(connection, purchaserUserId)
      const existing = getBillingAccountDeletionRequest(connection, purchaserUserId)
      const timestamp = now.toISOString()
      const expectedSubscriptionId = subscription?.stripeSubscriptionId ?? null
      const expectedCustomerId = customer?.stripeCustomerId ?? null
      const billingSubscriptionId = subscription?.id ?? null
      const billingCustomerId = customer?.id ?? null
      const capturedRevision = subscription?.revision ?? 0

      if (existing) {
        const sameCapture =
          existing.billingSubscriptionId === billingSubscriptionId &&
          existing.billingCustomerId === billingCustomerId &&
          existing.expectedStripeSubscriptionId === expectedSubscriptionId &&
          existing.expectedStripeCustomerId === expectedCustomerId &&
          existing.capturedBillingRevision === capturedRevision
        if (!sameCapture) {
          connection.sqlite
            .prepare(
              `update billing_account_deletion_requests set
               billing_subscription_id = ?, billing_customer_id = ?, expected_stripe_subscription_id = ?,
               expected_stripe_customer_id = ?, captured_billing_revision = ?, state = 'pending', reason = null,
               cancellation_confirmed_at = null, revision = revision + 1, updated_at = ?
             where id = ? and purchaser_user_id = ?`
            )
            .run(
              billingSubscriptionId,
              billingCustomerId,
              expectedSubscriptionId,
              expectedCustomerId,
              capturedRevision,
              timestamp,
              existing.id,
              purchaserUserId
            )
        }
      } else {
        connection.sqlite
          .prepare(
            `insert into billing_account_deletion_requests (
             id, purchaser_user_id, billing_subscription_id, billing_customer_id,
             expected_stripe_subscription_id, expected_stripe_customer_id, captured_billing_revision,
             state, reason, cancellation_confirmed_at, revision, created_at, updated_at
           ) values (?, ?, ?, ?, ?, ?, ?, 'pending', null, null, 0, ?, ?)`
          )
          .run(
            `billing_deletion_${randomUUID()}`,
            purchaserUserId,
            billingSubscriptionId,
            billingCustomerId,
            expectedSubscriptionId,
            expectedCustomerId,
            capturedRevision,
            timestamp,
            timestamp
          )
      }

      const request = getBillingAccountDeletionRequest(connection, purchaserUserId)
      if (!request) throw new Error('Billing deletion fence was not persisted')
      if (request.state !== 'cancellation_confirmed') {
        enqueueBillingAccountDeletionCancellationJob(connection, request.id, now)
      }
      return Object.freeze({ request, hasOpenCheckout: getOpenCheckoutAttempt(connection, purchaserUserId) !== null })
    })
    .immediate()
}

export function markBillingStripeAccountDeletionReconciliation(
  connection: BillingStripeConnection,
  expected: BillingAccountDeletionRequest,
  reason: string,
  now = new Date()
): boolean {
  return connection.sqlite
    .transaction(() => {
      const updated = connection.sqlite
        .prepare(
          `update billing_account_deletion_requests
         set state = 'reconciliation_required', reason = ?, cancellation_confirmed_at = null,
             revision = revision + 1, updated_at = ?
         where id = ? and purchaser_user_id = ? and revision = ?
           and billing_customer_id is ? and billing_subscription_id is ?
           and expected_stripe_customer_id is ? and expected_stripe_subscription_id is ?
           and captured_billing_revision = ?`
        )
        .run(
          reason,
          now.toISOString(),
          expected.id,
          expected.purchaserUserId,
          expected.revision,
          expected.billingCustomerId,
          expected.billingSubscriptionId,
          expected.expectedStripeCustomerId,
          expected.expectedStripeSubscriptionId,
          expected.capturedBillingRevision
        )
      if (updated.changes !== 1) return false
      enqueueBillingAccountDeletionCancellationJob(connection, expected.id, now)
      enqueueBillingStripeNotification(
        connection,
        {
          kind: 'deletion_cancellation_pending',
          purchaserUserId: expected.purchaserUserId,
          episodeKey: expected.id,
          authorityReference: expected.id
        },
        now
      )
      return true
    })
    .immediate()
}

export function confirmBillingStripeAccountDeletion(
  connection: BillingStripeConnection,
  expected: BillingAccountDeletionRequest,
  now = new Date()
): BillingAccountDeletionRequest | null {
  return connection.sqlite
    .transaction(() => {
      const live = getBillingAccountDeletionRequest(connection, expected.purchaserUserId)
      const customer = getBillingCustomerForPurchaser(connection, expected.purchaserUserId)
      const subscription = getBillingSubscriptionForPurchaser(connection, expected.purchaserUserId)
      if (
        !live ||
        live.id !== expected.id ||
        live.revision !== expected.revision ||
        live.billingCustomerId !== (customer?.id ?? null) ||
        live.expectedStripeCustomerId !== (customer?.stripeCustomerId ?? null) ||
        live.billingSubscriptionId !== (subscription?.id ?? null) ||
        live.expectedStripeSubscriptionId !== (subscription?.stripeSubscriptionId ?? null) ||
        live.capturedBillingRevision !== (subscription?.revision ?? 0) ||
        getOpenCheckoutAttempt(connection, expected.purchaserUserId)
      ) {
        return null
      }
      const timestamp = now.toISOString()
      const updated = connection.sqlite
        .prepare(
          `update billing_account_deletion_requests
         set state = 'cancellation_confirmed', reason = null, cancellation_confirmed_at = ?,
             revision = revision + 1, updated_at = ?
         where id = ? and revision = ?`
        )
        .run(timestamp, timestamp, live.id, live.revision)
      return updated.changes === 1 ? getBillingAccountDeletionRequest(connection, expected.purchaserUserId) : null
    })
    .immediate()
}

export function ensureBillingAccountDeletionCancellationJobs(
  connection: BillingStripeConnection,
  now = new Date(),
  limit = billingAccountDeletionCancellationSafetyBatchSize
): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > billingAccountDeletionCancellationSafetyBatchSize) {
    throw new TypeError('Invalid Billing account deletion cancellation safety limit')
  }
  const requests = connection.sqlite
    .prepare(
      `select id from billing_account_deletion_requests
       where state in ('pending', 'reconciliation_required') order by id limit ?`
    )
    .all(limit) as Array<{ id: string }>
  let enqueued = 0
  for (const request of requests) {
    if (enqueueBillingAccountDeletionCancellationJob(connection, request.id, now)) enqueued += 1
  }
  return enqueued
}

export function enqueueBillingAccountDeletionCancellationJob(
  connection: BillingStripeConnection,
  requestId: string,
  now = new Date()
): boolean {
  if (!requestId || !Number.isFinite(now.getTime())) {
    throw new TypeError('Invalid Billing account deletion cancellation job')
  }
  const payload = JSON.stringify({ requestId })
  const timestamp = now.toISOString()
  const result = connection.sqlite
    .prepare(
      `insert into job_queue (type, payload, max_attempts, run_after, created_at, updated_at)
       select 'billing.account-deletion-cancellation', ?, ?, ?, ?, ?
       where not exists (
         select 1 from job_queue where type = 'billing.account-deletion-cancellation'
           and status in ('queued', 'running') and attempts < max_attempts
           and json_valid(payload) and json_extract(payload, '$.requestId') = ?
           and json_remove(payload, '$.requestId') = '{}'
       )`
    )
    .run(
      payload,
      billingAccountDeletionCancellationMaxAttempts,
      new Date(now.getTime() + billingAccountDeletionCancellationDelayMs).toISOString(),
      timestamp,
      timestamp,
      requestId
    )
  return result.changes === 1
}

export function enqueueBillingStripeDeletionPendingNotification(
  connection: BillingStripeConnection,
  purchaserUserId: string,
  now = new Date()
): boolean {
  const request = getBillingAccountDeletionRequest(connection, purchaserUserId)
  if (!request || request.state === 'cancellation_confirmed') return false
  return enqueueBillingStripeNotification(
    connection,
    {
      kind: 'deletion_cancellation_pending',
      purchaserUserId,
      episodeKey: request.id,
      authorityReference: request.id
    },
    now
  )
}
