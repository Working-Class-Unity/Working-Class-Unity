import type { DatabaseConnection } from '../db/connect'
import { deleteBillingStripeAccountData } from './payments/stripe/account-deletion'
import { fileCleanupMaxAttempts, fileCleanupSchedulingMarginMs, fileUploadTokenTtlMs } from './storage/file-service'
import { deferFileStorageReconciliation } from './storage/file-storage-binding'

export type DeletingAccount = Readonly<{
  id: string
  email: string
}>

export type AccountDeletionCheckpoint = 'billing-data-deleted' | 'private-data-deleted' | 'auth-records-deleted'

export type AccountDeletionResult = Readonly<{
  status: 'deleted' | 'already-deleted'
  detachedBillingSubjects: number
  deletedFiles: number
}>

type AccountDeletionOptions = Readonly<{
  deletedAt?: string
  checkpoint?: (checkpoint: AccountDeletionCheckpoint) => void
}>

/**
 * Deletes all user-owned application and authentication rows in one
 * synchronous SQLite transaction. Stripe provider I/O must complete before
 * this function runs; the Billing proof context prevents deletion when that
 * provider fence is missing or stale.
 *
 * File metadata is removed here and an orphan-cleanup job is committed with
 * it. The storage reconciliation watermark delays object cleanup until any
 * outstanding upload capability has expired without retaining a user's object
 * keys or filenames.
 */
export function deleteAccountAtomically(
  connection: DatabaseConnection,
  account: DeletingAccount,
  options: AccountDeletionOptions = {}
): AccountDeletionResult {
  const deletedAt = options.deletedAt ?? new Date().toISOString()

  return connection.sqlite
    .transaction((): AccountDeletionResult => {
      if (!connection.sqlite.prepare('select 1 from user where id = ?').get(account.id)) {
        return {
          status: 'already-deleted',
          detachedBillingSubjects: 0,
          deletedFiles: 0
        }
      }

      const detachedBillingSubjectsBefore = countDetachedBillingSubjects(connection)
      deleteBillingStripeAccountData(connection, account.id, new Date(deletedAt))
      options.checkpoint?.('billing-data-deleted')

      connection.sqlite.prepare('delete from ai_generation_leases where owner_user_id = ?').run(account.id)
      connection.sqlite.prepare('delete from ai_conversations where owner_user_id = ?').run(account.id)
      connection.sqlite.prepare('delete from ai_usage_buckets where owner_user_id = ?').run(account.id)

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

      connection.sqlite
        .prepare(
          `delete from verification
           where value = ?
             or case
               when json_valid(value) then lower(json_extract(value, '$.email'))
               else null
             end = lower(?)`
        )
        .run(account.id, account.email)
      connection.sqlite.prepare('delete from session where user_id = ?').run(account.id)
      connection.sqlite.prepare('delete from account where user_id = ?').run(account.id)
      connection.sqlite.prepare('delete from user where id = ?').run(account.id)
      options.checkpoint?.('auth-records-deleted')

      return {
        status: 'deleted',
        detachedBillingSubjects: countDetachedBillingSubjects(connection) - detachedBillingSubjectsBefore,
        deletedFiles
      }
    })
    .immediate()
}

function countDetachedBillingSubjects(connection: DatabaseConnection): number {
  return (
    connection.sqlite.prepare('select count(*) as count from detached_billing_subjects').get() as { count: number }
  ).count
}
