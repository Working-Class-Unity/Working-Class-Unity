import type { DatabaseConnection } from '../db/connect'
import { deleteBillingStripeAccountData } from './payments/stripe/account-deletion'

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
 * Dormant AI and Files rows are removed for privacy. The basic release has no
 * user-file provider or Files worker, so deletion creates no storage work.
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

      const deletedFiles = connection.sqlite.prepare('delete from files where owner_id = ?').run(account.id).changes
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
