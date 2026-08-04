import { createHash } from 'node:crypto'
import type { DatabaseConnection } from '../../db/connect'

export const billingFamilyLifecycleSignalJobType = 'billing.family-lifecycle-signal' as const
export const billingFamilyLifecycleSignalMaxAttempts = 12

export type BillingFamilyLifecycleSignalAction =
  'payment_attention' | 'payment_grace_started' | 'renewal_ending' | 'coverage_ended'

export function hashBillingFamilyLifecycleEpisodeKey(episodeKey: string): string {
  if (!episodeKey) throw new TypeError('Invalid billing Family lifecycle episode key')
  return createHash('sha256').update(episodeKey).digest('hex')
}

export function enqueueBillingFamilyLifecycleSignal(
  connection: DatabaseConnection,
  input: Readonly<{
    action: BillingFamilyLifecycleSignalAction
    billingSubscriptionId: string
    billingTransitionId?: string | null
    episodeKey: string
  }>,
  now = new Date()
): void {
  if (!input.billingSubscriptionId || !input.episodeKey) {
    throw new TypeError('Invalid billing Family lifecycle signal')
  }
  const episodeKey = hashBillingFamilyLifecycleEpisodeKey(input.episodeKey)
  const payload = JSON.stringify({
    action: input.action,
    billingSubscriptionId: input.billingSubscriptionId,
    billingTransitionId: input.billingTransitionId ?? null,
    episodeKey
  })
  connection.sqlite
    .prepare(
      `
      insert into job_queue (type, payload, max_attempts, run_after, created_at, updated_at)
      select ?, ?, ?, ?, ?, ?
      where not exists (
        select 1
        from job_queue
        where type = ?
          and status in ('queued', 'running', 'succeeded')
          and json_valid(payload)
          and json_extract(payload, '$.action') = ?
          and json_extract(payload, '$.billingSubscriptionId') = ?
          and json_extract(payload, '$.billingTransitionId') is ?
          and json_extract(payload, '$.episodeKey') = ?
          and json_remove(
            payload,
            '$.action',
            '$.billingSubscriptionId',
            '$.billingTransitionId',
            '$.episodeKey'
          ) = '{}'
      )
    `
    )
    .run(
      billingFamilyLifecycleSignalJobType,
      payload,
      billingFamilyLifecycleSignalMaxAttempts,
      now.toISOString(),
      now.toISOString(),
      now.toISOString(),
      billingFamilyLifecycleSignalJobType,
      input.action,
      input.billingSubscriptionId,
      input.billingTransitionId ?? null,
      episodeKey
    )
}
