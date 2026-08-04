import { randomUUID } from 'node:crypto'
import type { DatabaseConnection } from '../db/connect'
import { externalBillingRetentionPurpose, stripeBillingRetentionPolicy } from '../db/schema/billing'
import { consumeAccountDeletionBillingProof } from './payments/account-deletion-billing-proof'
import { billingAccountDeletionPendingError } from './payments/billing-account-deletion'
import { enqueueBillingNotificationDelivery } from './payments/billing-notification-delivery'
import { fileCleanupMaxAttempts, fileCleanupSchedulingMarginMs, fileUploadTokenTtlMs } from './storage/file-service'
import { deferFileStorageReconciliation } from './storage/file-storage-binding'

export type DeletingAccount = Readonly<{
  id: string
  email: string
}>

export type AccountDeletionCheckpoint =
  'billing-detached' | 'private-data-deleted' | 'family-plan-deleted' | 'auth-records-deleted'

export type AccountDeletionResult = Readonly<{
  status: 'deleted' | 'already-deleted'
  detachedBillingSubjects: number
  deletedFiles: number
}>

type AccountDeletionOptions = Readonly<{
  billingProof?: string | null
  requireBillingProof?: boolean
  deletedAt?: string
  checkpoint?: (checkpoint: AccountDeletionCheckpoint) => void
}>

type BillingContinuityRow = Readonly<{
  stripeCustomerId: string
  stripeSubscriptionId: string | null
  status: string | null
  currentPeriodEnd: string | null
  projectionOrderMs: number | null
  updatedAt: string
}>

type BillingAttemptContinuityRow = Readonly<{
  attemptId: string
  stripeCustomerId: string | null
  state: string
  updatedAt: string
}>

/**
 * Deletes all current user-owned application/authentication rows in one
 * synchronous SQLite transaction. This is called from Better Auth 1.6.23's
 * documented beforeDelete hook because the configured adapter deliberately
 * cannot wrap its async callback in better-sqlite3's synchronous transaction.
 *
 * Provider I/O is excluded. File metadata is removed here and an orphan-cleanup
 * job is committed with it. A non-secret storage binding and reconciliation
 * watermark preserve enough lifecycle state to retry object cleanup without
 * retaining filenames or owner object keys.
 */
export function deleteAccountAtomically(
  connection: DatabaseConnection,
  account: DeletingAccount,
  options: AccountDeletionOptions = {}
): AccountDeletionResult {
  const deletedAt = options.deletedAt ?? new Date().toISOString()

  const result = connection.sqlite
    .transaction((): AccountDeletionResult => {
      const exists = connection.sqlite.prepare('select 1 from user where id = ?').get(account.id)
      if (!exists) {
        return {
          status: 'already-deleted',
          detachedBillingSubjects: 0,
          deletedFiles: 0
        }
      }

      assertBillingAccountDeletionFence(
        connection,
        account.id,
        options.billingProof,
        options.requireBillingProof ?? false
      )

      const billing = connection.sqlite
        .prepare(
          `
          select
            customer.stripe_customer_id as stripeCustomerId,
            subscription.stripe_subscription_id as stripeSubscriptionId,
            subscription.status,
            subscription.current_period_end as currentPeriodEnd,
            subscription.projection_order_ms as projectionOrderMs,
            coalesce(subscription.updated_at, customer.updated_at) as updatedAt
          from organization
          join billing_customers customer on customer.organization_id = organization.id
          left join billing_subscriptions subscription on subscription.organization_id = organization.id
          where organization.personal_owner_user_id = ?
        `
        )
        .all(account.id) as BillingContinuityRow[]

      const checkoutAttempts = connection.sqlite
        .prepare(
          `
          select
            attempt.id as attemptId,
            customer.stripe_customer_id as stripeCustomerId,
            attempt.state,
            attempt.updated_at as updatedAt
          from organization
          join billing_checkout_attempts attempt on attempt.organization_id = organization.id
          left join billing_customers customer on customer.organization_id = organization.id
          where organization.personal_owner_user_id = ?
            and attempt.state in ('pending', 'open', 'reconciliation_required')
        `
        )
        .all(account.id) as BillingAttemptContinuityRow[]

      const insertDetachedBillingSubject = connection.sqlite.prepare(`
      insert into detached_billing_subjects (
        id,
        provider,
        provider_reference,
        provider_customer_reference,
        provider_status,
        provider_status_expires_at,
        provider_event_created_at,
        status_updated_at,
        deleted_at,
        retention_purpose,
        retention_policy,
        purge_after
      ) values (?, 'stripe', ?, ?, ?, ?, ?, ?, ?, ?, ?, null)
      on conflict(provider, provider_reference) do update set
        provider_customer_reference = coalesce(excluded.provider_customer_reference, provider_customer_reference),
        provider_status = excluded.provider_status,
        provider_status_expires_at = excluded.provider_status_expires_at,
        provider_event_created_at = coalesce(excluded.provider_event_created_at, provider_event_created_at),
        status_updated_at = excluded.status_updated_at,
        deleted_at = min(detached_billing_subjects.deleted_at, excluded.deleted_at),
        retention_purpose = excluded.retention_purpose,
        retention_policy = excluded.retention_policy
    `)

      let detachedBillingSubjects = 0
      for (const subscription of billing) {
        if (!subscription.stripeSubscriptionId) continue
        insertDetachedBillingSubject.run(
          `detached_billing_${randomUUID()}`,
          subscription.stripeSubscriptionId,
          subscription.stripeCustomerId,
          subscription.status,
          subscription.currentPeriodEnd,
          subscription.projectionOrderMs === null ? null : Math.floor(subscription.projectionOrderMs / 1_000),
          subscription.updatedAt,
          deletedAt,
          externalBillingRetentionPurpose,
          stripeBillingRetentionPolicy
        )
        detachedBillingSubjects += 1
      }

      for (const attempt of checkoutAttempts) {
        insertDetachedBillingSubject.run(
          `detached_billing_${randomUUID()}`,
          `attempt:${attempt.attemptId}`,
          attempt.stripeCustomerId,
          `checkout_${attempt.state}`,
          null,
          null,
          attempt.updatedAt,
          deletedAt,
          externalBillingRetentionPurpose,
          stripeBillingRetentionPolicy
        )
        detachedBillingSubjects += 1
      }

      if (detachedBillingSubjects === 0 && billing[0]) {
        insertDetachedBillingSubject.run(
          `detached_billing_${randomUUID()}`,
          `customer:${billing[0].stripeCustomerId}`,
          billing[0].stripeCustomerId,
          'customer_retained',
          null,
          null,
          billing[0].updatedAt,
          deletedAt,
          externalBillingRetentionPurpose,
          stripeBillingRetentionPolicy
        )
        detachedBillingSubjects = 1
      }

      options.checkpoint?.('billing-detached')
      connection.sqlite.prepare('delete from ai_generation_leases where owner_user_id = ?').run(account.id)
      connection.sqlite.prepare('delete from ai_conversations where owner_user_id = ?').run(account.id)
      connection.sqlite.prepare('delete from ai_usage_buckets where owner_user_id = ?').run(account.id)
      connection.sqlite.prepare('delete from projects where owner_user_id = ?').run(account.id)

      const ownedFileState = connection.sqlite
        .prepare('select max(upload_expires_at) as latestUploadExpiresAt from files where owner_id = ?')
        .get(account.id) as { latestUploadExpiresAt: string | null }
      const deletedFiles = connection.sqlite.prepare('delete from files where owner_id = ?').run(account.id).changes
      if (deletedFiles > 0) {
        const deletedAtMs = Date.parse(deletedAt)
        const latestCapabilityExpiry = Math.min(
          ownedFileState.latestUploadExpiresAt ? Date.parse(ownedFileState.latestUploadExpiresAt) : deletedAtMs,
          deletedAtMs + fileUploadTokenTtlMs
        )
        const runAfter = new Date(
          Math.max(deletedAtMs, latestCapabilityExpiry) + fileCleanupSchedulingMarginMs
        ).toISOString()
        deferFileStorageReconciliation(connection, runAfter)
        connection.sqlite
          .prepare(
            "insert into job_queue (type, payload, max_attempts, run_after) values ('files.cleanup-orphans', '{}', ?, ?)"
          )
          .run(fileCleanupMaxAttempts, runAfter)
      }
      options.checkpoint?.('private-data-deleted')

      const familyDissolutionRecipients = (
        connection.sqlite
          .prepare(
            `select distinct member.user_id as userId
             from organization
             inner join member
               on member.organization_id = organization.id
              and member.role = 'member'
              and member.user_id <> organization.personal_owner_user_id
             where organization.personal_owner_user_id = ?
             order by member.user_id`
          )
          .all(account.id) as Array<{ userId: string }>
      ).map((row) => row.userId)
      for (const recipientUserId of familyDissolutionRecipients) {
        enqueueBillingNotificationDelivery(
          connection,
          {
            episodeKey: JSON.stringify(['manager_account_deletion', account.id]),
            kind: 'family_dissolved',
            recipientUserId
          },
          new Date(deletedAt)
        )
      }

      connection.sqlite
        .prepare(
          `
          update session
          set active_organization_id = null
          where active_organization_id in (
            select id from organization where personal_owner_user_id = ?
          )
        `
        )
        .run(account.id)
      connection.sqlite.prepare('delete from organization where personal_owner_user_id = ?').run(account.id)
      connection.sqlite.prepare('delete from member where user_id = ?').run(account.id)
      connection.sqlite.prepare('delete from invitation where inviter_id = ?').run(account.id)
      connection.sqlite.prepare('delete from invitation where lower(email) = lower(?)').run(account.email)
      options.checkpoint?.('family-plan-deleted')

      connection.sqlite
        .prepare(
          `
          delete from verification
          where value = ?
            or case
              when json_valid(value) then lower(json_extract(value, '$.email'))
              else null
            end = lower(?)
        `
        )
        .run(account.id, account.email)
      connection.sqlite.prepare('delete from session where user_id = ?').run(account.id)
      connection.sqlite.prepare('delete from account where user_id = ?').run(account.id)
      connection.sqlite.prepare('delete from user where id = ?').run(account.id)
      options.checkpoint?.('auth-records-deleted')

      return {
        status: 'deleted',
        detachedBillingSubjects,
        deletedFiles
      }
    })
    .immediate()

  return result
}

type BillingDeletionFenceRow = Readonly<{
  billingDeletionPending: number
  billingCustomerId: string | null
  stripeCustomerId: string | null
  billingSubscriptionId: string | null
  stripeSubscriptionId: string | null
  status: string | null
}>

type BillingDeletionRequestFenceRow = Readonly<{
  billingCustomerId: string
  billingSubscriptionId: string | null
  expectedStripeCustomerId: string
  expectedStripeSubscriptionId: string | null
  state: string
}>

function assertBillingAccountDeletionFence(
  connection: DatabaseConnection,
  userId: string,
  billingProof: string | null | undefined,
  requireBillingProof: boolean
): void {
  const projection = connection.sqlite
    .prepare(
      `
      select
        organization.billing_deletion_pending as billingDeletionPending,
        customer.id as billingCustomerId,
        customer.stripe_customer_id as stripeCustomerId,
        subscription.id as billingSubscriptionId,
        subscription.stripe_subscription_id as stripeSubscriptionId,
        subscription.status
      from organization
      left join billing_customers customer on customer.organization_id = organization.id
      left join billing_subscriptions subscription on subscription.organization_id = organization.id
      where organization.personal_owner_user_id = ?
      limit 1
    `
    )
    .get(userId) as BillingDeletionFenceRow | undefined
  const request = connection.sqlite
    .prepare(
      `
      select
        billing_customer_id as billingCustomerId,
        billing_subscription_id as billingSubscriptionId,
        expected_stripe_customer_id as expectedStripeCustomerId,
        expected_stripe_subscription_id as expectedStripeSubscriptionId,
        state
      from billing_account_deletion_requests
      where user_id = ?
    `
    )
    .get(userId) as BillingDeletionRequestFenceRow | undefined

  const proofRequired = requireBillingProof || Boolean(billingProof)
  const openCheckout = connection.sqlite
    .prepare(
      `select 1
       from organization
       join billing_checkout_attempts attempt on attempt.organization_id = organization.id
       where organization.personal_owner_user_id = ?
         and attempt.state in ('pending', 'open', 'reconciliation_required')
       limit 1`
    )
    .get(userId)
  if (proofRequired && openCheckout) throw billingAccountDeletionPendingError()

  if (proofRequired && projection?.billingDeletionPending !== 1) {
    throw billingAccountDeletionPendingError()
  }

  if (!projection?.billingCustomerId) {
    if (request) throw billingAccountDeletionPendingError()
    if (proofRequired && !consumeAccountDeletionBillingProof(userId, billingProof)) {
      throw billingAccountDeletionPendingError()
    }
    return
  }
  if (!consumeAccountDeletionBillingProof(userId, billingProof)) {
    throw billingAccountDeletionPendingError()
  }
  if (!request || request.state !== 'cancellation_confirmed') {
    throw billingAccountDeletionPendingError()
  }

  const hasLocallyLiveSubscription = Boolean(
    projection.billingSubscriptionId &&
    projection.status &&
    !['none', 'canceled', 'incomplete_expired'].includes(projection.status)
  )
  if (!hasLocallyLiveSubscription) return
  if (
    !projection.stripeSubscriptionId ||
    request.billingCustomerId !== projection.billingCustomerId ||
    request.expectedStripeCustomerId !== projection.stripeCustomerId ||
    request.billingSubscriptionId !== projection.billingSubscriptionId ||
    request.expectedStripeSubscriptionId !== projection.stripeSubscriptionId
  ) {
    throw billingAccountDeletionPendingError()
  }
}
