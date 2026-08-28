import { z } from 'zod'
import type { JobHandler, JobPayload } from '../jobs/job-queue'
import type { BillingStripeConnection } from '../payments/stripe/public-contract'
import { publicJoinMagicLinkBody, type PublicJoinMagicLinkBody } from './public-join-auth'
import { readPublicJoinAttempt } from './public-join'

export const publicJoinClaimJobType = 'membership.public-join-claim' as const
export const publicJoinClaimJobMaxAttempts = 12
export const publicJoinClaimJobSafetyLimit = 25

const jobPayloadSchema = z.object({ attemptId: z.string().trim().min(1).max(128) }).strict()

export function enqueuePublicJoinClaimJob(
  connection: BillingStripeConnection,
  attemptId: string,
  now = new Date()
): boolean {
  const payload = JSON.stringify({ attemptId })
  const timestamp = now.toISOString()
  const inserted = connection.sqlite
    .prepare(
      `insert into job_queue (type, payload, max_attempts, run_after, created_at, updated_at)
       select ?, ?, ?, ?, ?, ? where not exists (
         select 1 from job_queue where type = ? and status in ('queued', 'running')
           and attempts < max_attempts and json_valid(payload)
           and json_extract(payload, '$.attemptId') = ?
           and json_remove(payload, '$.attemptId') = '{}'
       )`
    )
    .run(
      publicJoinClaimJobType,
      payload,
      publicJoinClaimJobMaxAttempts,
      timestamp,
      timestamp,
      timestamp,
      publicJoinClaimJobType,
      attemptId
    )
  return inserted.changes === 1
}

export function ensurePublicJoinClaimJobs(
  connection: BillingStripeConnection,
  now = new Date(),
  limit = publicJoinClaimJobSafetyLimit
): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > publicJoinClaimJobSafetyLimit) {
    throw new TypeError('Invalid public join claim safety limit')
  }
  const timestamp = now.toISOString()
  const rows = connection.sqlite
    .prepare(
      `select attempt.id from public_join_attempts attempt
       where attempt.state = 'paid' and attempt.claim_email_sent_at is null
         and attempt.claim_expires_at > ?
         and not exists (
           select 1 from job_queue job where job.type = ? and job.status in ('queued', 'running')
             and job.attempts < job.max_attempts and json_valid(job.payload)
             and json_extract(job.payload, '$.attemptId') = attempt.id
             and json_remove(job.payload, '$.attemptId') = '{}'
         )
       order by attempt.created_at, attempt.id limit ?`
    )
    .all(timestamp, publicJoinClaimJobType, limit) as Array<{ id: string }>
  let scheduled = 0
  for (const row of rows) {
    if (enqueuePublicJoinClaimJob(connection, row.id, now)) scheduled += 1
  }
  return scheduled
}

export function createPublicJoinClaimJobHandler(
  context: Readonly<{
    connection: BillingStripeConnection
    issueMagicLink: (body: PublicJoinMagicLinkBody) => Promise<void>
    secret: string
    now?: () => Date
  }>
): JobHandler {
  return async (payload: JobPayload) => {
    const parsed = jobPayloadSchema.safeParse(payload)
    if (!parsed.success) throw new Error('Invalid public join claim payload')
    const attempt = readPublicJoinAttempt(context.connection, parsed.data.attemptId)
    if (!attempt || attempt.state !== 'paid' || attempt.claimEmailSentAt) return
    const now = context.now?.() ?? new Date()
    if (!attempt.claimExpiresAt || now.getTime() >= Date.parse(attempt.claimExpiresAt)) return

    await context.issueMagicLink(publicJoinMagicLinkBody(attempt, context.secret))
    const updated = context.connection.sqlite
      .prepare(
        `update public_join_attempts set claim_email_sent_at = ?, updated_at = ?
         where id = ? and state = 'paid' and claim_email_sent_at is null and claim_expires_at = ?`
      )
      .run(now.toISOString(), now.toISOString(), attempt.id, attempt.claimExpiresAt)
    if (updated.changes === 1) return
    if (readPublicJoinAttempt(context.connection, attempt.id)?.claimEmailSentAt) return
    throw new Error('Public join claim delivery state changed')
  }
}
