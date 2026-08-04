import { randomUUID } from 'node:crypto'
import type { DatabaseConnection } from '../../db/connect'
import { getOpenCheckoutAttempt } from '../../db/repositories/billing'
import type { BillingCheckoutAttempt } from '../../db/schema'
import type { CurrentBillingProjection } from './billing-projection'
import { enqueueBillingNotificationDelivery } from './billing-notification-delivery'

export const billingAccountDeletionCancellationJobType = 'billing.account-deletion-cancellation' as const
export const billingAccountDeletionCancellationMaxAttempts = 12
export const billingAccountDeletionCancellationDelayMs = 60_000
export const billingAccountDeletionCancellationSafetyBatchSize = 25

export type BillingAccountDeletionRequestState = 'pending' | 'reconciliation_required' | 'cancellation_confirmed'

export type BillingAccountDeletionRequest = Readonly<{
  id: string
  userId: string
  organizationId: string
  billingSubscriptionId: string | null
  billingCustomerId: string
  expectedStripeSubscriptionId: string | null
  expectedStripeCustomerId: string
  capturedBillingRevision: number
  state: BillingAccountDeletionRequestState
  reason: string | null
  cancellationConfirmedAt: string | null
  revision: number
}>

export type BillingAccountDeletionCapture =
  | Readonly<{ kind: 'not-required' }>
  | Readonly<{ kind: 'confirmed'; request: BillingAccountDeletionRequest }>
  | Readonly<{ kind: 'customer-verification-required'; request: BillingAccountDeletionRequest }>
  | Readonly<{ kind: 'cancellation-required'; request: BillingAccountDeletionRequest; blocked: boolean }>

type BillingAccountDeletionFence = Readonly<{
  organizationId: string
  checkoutAttempt: BillingCheckoutAttempt | null
}>

export const billingAccountDeletionReconciliationReasons = Object.freeze({
  billingProjectionChanged: 'billing_projection_changed',
  customerHasLiveSubscription: 'customer_has_live_subscription',
  customerSubscriptionStateUnknown: 'customer_subscription_state_unknown',
  customerSubscriptionVerificationRequired: 'customer_subscription_verification_required',
  customerSubscriptionVerificationUnavailable: 'customer_subscription_verification_unavailable',
  missingSubscriptionReference: 'subscription_reference_missing',
  stripeCancellationUnconfirmed: 'stripe_cancellation_unconfirmed',
  stripeCustomerMismatch: 'stripe_customer_mismatch',
  stripeSubscriptionMismatch: 'stripe_subscription_mismatch'
} as const)

const terminalLocalSubscriptionStatuses = new Set(['none', 'canceled', 'incomplete_expired'])

export function beginBillingAccountDeletionFence(
  connection: DatabaseConnection,
  userId: string
): BillingAccountDeletionFence | null {
  return connection.sqlite
    .transaction(() => {
      const owner = connection.sqlite
        .prepare(
          `select organization.id
           from organization
           join member
             on member.organization_id = organization.id
            and member.user_id = ?
            and member.role = 'owner'
           where organization.personal_owner_user_id = ?
           limit 1`
        )
        .get(userId, userId) as { id: string } | undefined
      if (!owner) return null

      connection.sqlite.prepare('update organization set billing_deletion_pending = 1 where id = ?').run(owner.id)
      return {
        organizationId: owner.id,
        checkoutAttempt: getOpenCheckoutAttempt(connection, owner.id)
      }
    })
    .immediate()
}

type BillingProjectionRow = Readonly<{
  organizationId: string
  billingCustomerId: string | null
  stripeCustomerId: string | null
  billingSubscriptionId: string | null
  stripeSubscriptionId: string | null
  subscriptionStatus: string | null
  billingRevision: number | null
}>

type RawDeletionRequest = Readonly<{
  id: string
  user_id: string
  organization_id: string
  billing_subscription_id: string | null
  billing_customer_id: string
  expected_stripe_subscription_id: string | null
  expected_stripe_customer_id: string
  captured_billing_revision: number
  state: BillingAccountDeletionRequestState
  reason: string | null
  cancellation_confirmed_at: string | null
  revision: number
}>

export function captureBillingAccountDeletionRequest(
  connection: DatabaseConnection,
  userId: string,
  now = new Date()
): BillingAccountDeletionCapture {
  return connection.sqlite
    .transaction((): BillingAccountDeletionCapture => {
      const projection = readBillingProjection(connection, userId)
      let request = getBillingAccountDeletionRequestForUser(connection, userId)
      const cancellationRequired = projectionRequiresCancellation(projection)

      if (request) {
        const projectionMatches = requestMatchesProjection(request, projection)
        if (request.state === 'cancellation_confirmed' && projectionMatches) {
          return { kind: 'confirmed', request }
        }

        let blocked = false
        if (!projectionMatches) {
          if (projection?.billingCustomerId && projection.stripeCustomerId) {
            request = recaptureBillingAccountDeletionProjection(connection, request, projection, now)
            blocked = cancellationRequired && !(projection.billingSubscriptionId && projection.stripeSubscriptionId)
          } else {
            request = markBillingAccountDeletionReconciliation(
              connection,
              request,
              billingAccountDeletionReconciliationReasons.billingProjectionChanged,
              now
            )
            blocked = true
          }
        }
        enqueueCancellationJob(connection, request.id, now)
        enqueueDeletionPendingNotification(connection, request, now)
        return cancellationRequired
          ? { kind: 'cancellation-required', request, blocked }
          : { kind: 'customer-verification-required', request }
      }

      if (!projection?.billingCustomerId || !projection.stripeCustomerId) {
        return { kind: 'not-required' }
      }

      const hasExactSubscription = Boolean(projection.billingSubscriptionId && projection.stripeSubscriptionId)
      const cancellationCanRun = cancellationRequired && hasExactSubscription
      const id = `billing_delete_${randomUUID()}`
      connection.sqlite
        .prepare(
          `
          insert into billing_account_deletion_requests (
            id,
            user_id,
            organization_id,
            billing_subscription_id,
            billing_customer_id,
            expected_stripe_subscription_id,
            expected_stripe_customer_id,
            captured_billing_revision,
            state,
            reason,
            cancellation_confirmed_at,
            revision,
            created_at,
            updated_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, 0, ?, ?)
        `
        )
        .run(
          id,
          userId,
          projection.organizationId,
          hasExactSubscription ? projection.billingSubscriptionId : null,
          projection.billingCustomerId,
          hasExactSubscription ? projection.stripeSubscriptionId : null,
          projection.stripeCustomerId,
          projection.billingRevision ?? 0,
          cancellationCanRun ? 'pending' : 'reconciliation_required',
          cancellationCanRun
            ? null
            : cancellationRequired
              ? billingAccountDeletionReconciliationReasons.missingSubscriptionReference
              : billingAccountDeletionReconciliationReasons.customerSubscriptionVerificationRequired,
          now.toISOString(),
          now.toISOString()
        )
      enqueueCancellationJob(connection, id, now)
      request = getBillingAccountDeletionRequest(connection, id)
      if (!request) throw new Error('Billing account deletion request was not persisted')
      enqueueDeletionPendingNotification(connection, request, now)
      return cancellationRequired
        ? {
            kind: 'cancellation-required',
            request,
            blocked: !hasExactSubscription
          }
        : {
            kind: 'customer-verification-required',
            request
          }
    })
    .immediate()
}

export function getBillingAccountDeletionRequest(
  connection: DatabaseConnection,
  requestId: string
): BillingAccountDeletionRequest | null {
  const row = connection.sqlite
    .prepare(
      `
      select
        id,
        user_id,
        organization_id,
        billing_subscription_id,
        billing_customer_id,
        expected_stripe_subscription_id,
        expected_stripe_customer_id,
        captured_billing_revision,
        state,
        reason,
        cancellation_confirmed_at,
        revision
      from billing_account_deletion_requests
      where id = ?
    `
    )
    .get(requestId) as RawDeletionRequest | undefined
  return row ? deletionRequestFromRow(row) : null
}

export function getBillingAccountDeletionRequestForUser(
  connection: DatabaseConnection,
  userId: string
): BillingAccountDeletionRequest | null {
  const row = connection.sqlite
    .prepare(
      `
      select
        id,
        user_id,
        organization_id,
        billing_subscription_id,
        billing_customer_id,
        expected_stripe_subscription_id,
        expected_stripe_customer_id,
        captured_billing_revision,
        state,
        reason,
        cancellation_confirmed_at,
        revision
      from billing_account_deletion_requests
      where user_id = ?
    `
    )
    .get(userId) as RawDeletionRequest | undefined
  return row ? deletionRequestFromRow(row) : null
}

export function markBillingAccountDeletionReconciliation(
  connection: DatabaseConnection,
  request: BillingAccountDeletionRequest,
  reason: (typeof billingAccountDeletionReconciliationReasons)[keyof typeof billingAccountDeletionReconciliationReasons],
  now = new Date()
): BillingAccountDeletionRequest {
  connection.sqlite
    .prepare(
      `
      update billing_account_deletion_requests
      set
        state = 'reconciliation_required',
        reason = ?,
        cancellation_confirmed_at = null,
        revision = revision + 1,
        updated_at = ?
      where id = ?
        and revision = ?
    `
    )
    .run(reason, now.toISOString(), request.id, request.revision)
  return getBillingAccountDeletionRequest(connection, request.id) ?? request
}

export function reconcileBillingAccountDeletionAfterCustomerCheck(
  connection: DatabaseConnection,
  requestId: string,
  reason:
    | typeof billingAccountDeletionReconciliationReasons.customerHasLiveSubscription
    | typeof billingAccountDeletionReconciliationReasons.customerSubscriptionStateUnknown
    | typeof billingAccountDeletionReconciliationReasons.customerSubscriptionVerificationUnavailable,
  now = new Date()
): BillingAccountDeletionRequest | null {
  return connection.sqlite
    .transaction(() => {
      const request = getBillingAccountDeletionRequest(connection, requestId)
      if (!request) return null
      connection.sqlite
        .prepare(
          `
          update billing_account_deletion_requests
          set
            state = 'reconciliation_required',
            reason = ?,
            cancellation_confirmed_at = null,
            revision = revision + 1,
            updated_at = ?
          where id = ?
        `
        )
        .run(reason, now.toISOString(), request.id)
      enqueueCancellationJob(connection, request.id, now)
      return getBillingAccountDeletionRequest(connection, request.id)
    })
    .immediate()
}

export function confirmBillingAccountDeletionCustomerHasNoLiveSubscriptions(
  connection: DatabaseConnection,
  requestId: string,
  now = new Date()
): BillingAccountDeletionRequest | null {
  return connection.sqlite
    .transaction(() => {
      const request = getBillingAccountDeletionRequest(connection, requestId)
      if (!request) return null
      const customerStillMatches = connection.sqlite
        .prepare(
          `
          select 1
          from billing_customers
          where id = ?
            and organization_id = ?
            and stripe_customer_id = ?
        `
        )
        .get(request.billingCustomerId, request.organizationId, request.expectedStripeCustomerId)
      if (!customerStillMatches) {
        connection.sqlite
          .prepare(
            `
            update billing_account_deletion_requests
            set
              state = 'reconciliation_required',
              reason = ?,
              cancellation_confirmed_at = null,
              revision = revision + 1,
              updated_at = ?
            where id = ?
          `
          )
          .run(
            billingAccountDeletionReconciliationReasons.customerSubscriptionStateUnknown,
            now.toISOString(),
            request.id
          )
        enqueueCancellationJob(connection, request.id, now)
        return getBillingAccountDeletionRequest(connection, request.id)
      }
      if (request.state === 'cancellation_confirmed') return request

      connection.sqlite
        .prepare(
          `
          update billing_account_deletion_requests
          set
            state = 'cancellation_confirmed',
            reason = null,
            cancellation_confirmed_at = ?,
            revision = revision + 1,
            updated_at = ?
          where id = ?
        `
        )
        .run(now.toISOString(), now.toISOString(), request.id)
      return getBillingAccountDeletionRequest(connection, request.id)
    })
    .immediate()
}

export function confirmBillingAccountDeletionCancellation(
  connection: DatabaseConnection,
  request: BillingAccountDeletionRequest,
  now = new Date()
): BillingAccountDeletionRequest | null {
  return connection.sqlite
    .transaction(() => {
      const current = getBillingAccountDeletionRequest(connection, request.id)
      if (!current || current.state === 'cancellation_confirmed') return current
      if (
        current.revision !== request.revision ||
        !current.billingSubscriptionId ||
        !current.expectedStripeSubscriptionId
      ) {
        return current
      }

      const correlation = connection.sqlite
        .prepare(
          `
          select 1
          from billing_subscriptions
          where id = ?
            and organization_id = ?
            and billing_customer_id = ?
            and stripe_subscription_id = ?
        `
        )
        .get(
          current.billingSubscriptionId,
          current.organizationId,
          current.billingCustomerId,
          current.expectedStripeSubscriptionId
        )
      if (!correlation) {
        return markBillingAccountDeletionReconciliation(
          connection,
          current,
          billingAccountDeletionReconciliationReasons.billingProjectionChanged,
          now
        )
      }

      connection.sqlite
        .prepare(
          `
          update billing_account_deletion_requests
          set
            state = 'cancellation_confirmed',
            reason = null,
            cancellation_confirmed_at = ?,
            revision = revision + 1,
            updated_at = ?
          where id = ?
            and revision = ?
            and state <> 'cancellation_confirmed'
        `
        )
        .run(now.toISOString(), now.toISOString(), current.id, current.revision)
      return getBillingAccountDeletionRequest(connection, current.id)
    })
    .immediate()
}

export function adoptBillingAccountDeletionSubscription(
  connection: DatabaseConnection,
  request: BillingAccountDeletionRequest,
  projection: CurrentBillingProjection,
  now = new Date()
): BillingAccountDeletionRequest {
  const currentPeriodStart = Date.parse(projection.currentPeriodStart ?? '')
  const currentPeriodEnd = Date.parse(projection.currentPeriodEnd ?? '')
  if (
    projection.reconciliationRequired ||
    !projection.stripeSubscriptionId ||
    !projection.stripeSubscriptionItemId ||
    !['active', 'past_due', 'unpaid'].includes(projection.status) ||
    !projection.planKey ||
    !projection.cadence ||
    !projection.stripePriceId ||
    !Number.isFinite(currentPeriodStart) ||
    !Number.isFinite(currentPeriodEnd) ||
    currentPeriodEnd <= currentPeriodStart
  ) {
    return request
  }

  return connection.sqlite
    .transaction(() => {
      const current = getBillingAccountDeletionRequest(connection, request.id)
      if (
        !current ||
        current.revision !== request.revision ||
        current.billingSubscriptionId ||
        current.expectedStripeSubscriptionId
      ) {
        return current ?? request
      }
      const local = connection.sqlite
        .prepare(
          `select subscription.id, subscription.revision
           from billing_subscriptions subscription
           inner join billing_customers customer
             on customer.id = subscription.billing_customer_id
           inner join organization
             on organization.id = subscription.organization_id
           where subscription.organization_id = ?
             and subscription.billing_customer_id = ?
             and subscription.stripe_subscription_id is null
             and subscription.status not in ('none', 'canceled', 'incomplete_expired')
             and subscription.revision = ?
             and customer.organization_id = ?
             and customer.stripe_customer_id = ?
             and organization.personal_owner_user_id = ?`
        )
        .get(
          current.organizationId,
          current.billingCustomerId,
          current.capturedBillingRevision,
          current.organizationId,
          current.expectedStripeCustomerId,
          current.userId
        ) as { id: string; revision: number } | undefined
      if (!local) return current

      const subscription = connection.sqlite
        .prepare(
          `update billing_subscriptions
           set stripe_subscription_id = ?,
               stripe_subscription_item_id = ?,
               status = ?,
               plan_key = ?,
               cadence = ?,
               stripe_price_id = ?,
               current_period_start = ?,
               current_period_end = ?,
               cancel_at_period_end = ?,
               reconciliation_required = 0,
               reconciliation_reason = null,
               revision = revision + 1,
               updated_at = ?
           where id = ?
             and revision = ?
             and stripe_subscription_id is null`
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
          now.toISOString(),
          local.id,
          local.revision
        )
      if (subscription.changes !== 1) return current

      const deletionRequest = connection.sqlite
        .prepare(
          `update billing_account_deletion_requests
           set billing_subscription_id = ?,
               expected_stripe_subscription_id = ?,
               captured_billing_revision = ?,
               state = 'pending',
               reason = null,
               cancellation_confirmed_at = null,
               revision = revision + 1,
               updated_at = ?
           where id = ?
             and revision = ?
             and billing_subscription_id is null
             and expected_stripe_subscription_id is null`
        )
        .run(
          local.id,
          projection.stripeSubscriptionId,
          local.revision + 1,
          now.toISOString(),
          current.id,
          current.revision
        )
      if (deletionRequest.changes !== 1) {
        throw new Error('Billing account deletion request changed during subscription adoption')
      }
      return getBillingAccountDeletionRequest(connection, current.id) ?? current
    })
    .immediate()
}

export function billingAccountDeletionIdempotencyKey(requestId: string): string {
  return `billing-account-deletion:${requestId}`
}

/**
 * Replaces missing or terminal cancellation work without mutating deletion
 * authority. Failed rows remain inspectable; each safety pass creates at most
 * one fresh bounded job per unresolved request and at most one page overall.
 */
export function ensureBillingAccountDeletionCancellationJobs(
  connection: DatabaseConnection,
  now = new Date(),
  limit = billingAccountDeletionCancellationSafetyBatchSize
): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > billingAccountDeletionCancellationSafetyBatchSize) {
    throw new TypeError('Invalid billing account deletion cancellation safety limit')
  }

  return connection.sqlite
    .transaction(() => {
      const requests = connection.sqlite
        .prepare(
          `
          select request.id
          from billing_account_deletion_requests request
          where request.state in ('pending', 'reconciliation_required')
            and not exists (
              select 1
              from job_queue job
              where job.type = ?
                and (
                  job.status = 'running'
                  or (job.status = 'queued' and job.attempts < job.max_attempts)
                )
                and json_valid(job.payload)
                and json_extract(job.payload, '$.requestId') = request.id
                and json_remove(job.payload, '$.requestId') = '{}'
            )
          order by request.id
          limit ?
        `
        )
        .all(billingAccountDeletionCancellationJobType, limit) as Array<{ id: string }>

      let scheduled = 0
      for (const request of requests) {
        if (enqueueCancellationJob(connection, request.id, now)) scheduled += 1
      }
      return scheduled
    })
    .immediate()
}

function readBillingProjection(connection: DatabaseConnection, userId: string): BillingProjectionRow | null {
  return (
    (connection.sqlite
      .prepare(
        `
        select
          organization.id as organizationId,
          customer.id as billingCustomerId,
          customer.stripe_customer_id as stripeCustomerId,
          subscription.id as billingSubscriptionId,
          subscription.stripe_subscription_id as stripeSubscriptionId,
          subscription.status as subscriptionStatus,
          subscription.revision as billingRevision
        from organization
        left join billing_customers customer on customer.organization_id = organization.id
        left join billing_subscriptions subscription on subscription.organization_id = organization.id
        where organization.personal_owner_user_id = ?
        limit 1
      `
      )
      .get(userId) as BillingProjectionRow | undefined) ?? null
  )
}

function projectionRequiresCancellation(projection: BillingProjectionRow | null): boolean {
  return Boolean(
    projection?.billingSubscriptionId &&
    projection.subscriptionStatus &&
    !terminalLocalSubscriptionStatuses.has(projection.subscriptionStatus)
  )
}

function requestMatchesProjection(
  request: BillingAccountDeletionRequest,
  projection: BillingProjectionRow | null
): boolean {
  if (!projection?.billingCustomerId || !projection.stripeCustomerId) return false
  if (
    request.organizationId !== projection.organizationId ||
    request.billingCustomerId !== projection.billingCustomerId ||
    request.expectedStripeCustomerId !== projection.stripeCustomerId
  ) {
    return false
  }
  if (!request.expectedStripeSubscriptionId || !request.billingSubscriptionId) {
    return !projection.stripeSubscriptionId && !projection.billingSubscriptionId
  }
  return (
    request.billingSubscriptionId === projection.billingSubscriptionId &&
    request.expectedStripeSubscriptionId === projection.stripeSubscriptionId
  )
}

function recaptureBillingAccountDeletionProjection(
  connection: DatabaseConnection,
  request: BillingAccountDeletionRequest,
  projection: BillingProjectionRow,
  now: Date
): BillingAccountDeletionRequest {
  if (!projection.billingCustomerId || !projection.stripeCustomerId) {
    return markBillingAccountDeletionReconciliation(
      connection,
      request,
      billingAccountDeletionReconciliationReasons.billingProjectionChanged,
      now
    )
  }

  const cancellationRequired = projectionRequiresCancellation(projection)
  const hasExactSubscription = Boolean(projection.billingSubscriptionId && projection.stripeSubscriptionId)
  const cancellationCanRun = cancellationRequired && hasExactSubscription
  connection.sqlite
    .prepare(
      `
      update billing_account_deletion_requests
      set
        organization_id = ?,
        billing_subscription_id = ?,
        billing_customer_id = ?,
        expected_stripe_subscription_id = ?,
        expected_stripe_customer_id = ?,
        captured_billing_revision = ?,
        state = ?,
        reason = ?,
        cancellation_confirmed_at = null,
        revision = revision + 1,
        updated_at = ?
      where id = ?
        and revision = ?
    `
    )
    .run(
      projection.organizationId,
      hasExactSubscription ? projection.billingSubscriptionId : null,
      projection.billingCustomerId,
      hasExactSubscription ? projection.stripeSubscriptionId : null,
      projection.stripeCustomerId,
      projection.billingRevision ?? 0,
      cancellationCanRun ? 'pending' : 'reconciliation_required',
      cancellationCanRun
        ? null
        : cancellationRequired
          ? billingAccountDeletionReconciliationReasons.missingSubscriptionReference
          : billingAccountDeletionReconciliationReasons.customerSubscriptionVerificationRequired,
      now.toISOString(),
      request.id,
      request.revision
    )
  return getBillingAccountDeletionRequest(connection, request.id) ?? request
}

function enqueueCancellationJob(connection: DatabaseConnection, requestId: string, now: Date): boolean {
  const payload = JSON.stringify({ requestId })
  const inserted = connection.sqlite
    .prepare(
      `
      insert into job_queue (type, payload, max_attempts, run_after, created_at, updated_at)
      select ?, ?, ?, ?, ?, ?
      where not exists (
        select 1
        from job_queue
        where type = ?
          and (
            status = 'running'
            or (status = 'queued' and attempts < max_attempts)
          )
          and json_valid(payload)
          and json_extract(payload, '$.requestId') = ?
          and json_remove(payload, '$.requestId') = '{}'
      )
    `
    )
    .run(
      billingAccountDeletionCancellationJobType,
      payload,
      billingAccountDeletionCancellationMaxAttempts,
      new Date(now.getTime() + billingAccountDeletionCancellationDelayMs).toISOString(),
      now.toISOString(),
      now.toISOString(),
      billingAccountDeletionCancellationJobType,
      requestId
    )
  return inserted.changes === 1
}

function enqueueDeletionPendingNotification(
  connection: DatabaseConnection,
  request: BillingAccountDeletionRequest,
  now: Date
): void {
  if (request.state === 'cancellation_confirmed') return
  enqueueBillingNotificationDelivery(
    connection,
    {
      authorityReference: request.id,
      episodeKey: request.id,
      kind: 'deletion_cancellation_pending',
      recipientUserId: request.userId
    },
    now
  )
}

function deletionRequestFromRow(row: RawDeletionRequest): BillingAccountDeletionRequest {
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    billingSubscriptionId: row.billing_subscription_id,
    billingCustomerId: row.billing_customer_id,
    expectedStripeSubscriptionId: row.expected_stripe_subscription_id,
    expectedStripeCustomerId: row.expected_stripe_customer_id,
    capturedBillingRevision: row.captured_billing_revision,
    state: row.state,
    reason: row.reason,
    cancellationConfirmedAt: row.cancellation_confirmed_at,
    revision: row.revision
  }
}
