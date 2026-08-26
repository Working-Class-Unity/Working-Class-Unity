import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { isTemporaryPhoneEmail } from '../../../../shared/account-identity'
import type { BillingEmailVerification } from '../../../db/schema/billing'
import { createBillingEmailVerificationEmail, type TransactionalEmailSender } from '../../email'
import type { JobHandler, JobPayload } from '../../jobs/job-queue'
import {
  ensureWebsiteAccountIdentityInTransaction,
  recordWebsiteAccountIdentityReviewInTransaction
} from '../../membership/account-identity'
import type { ImportedStripeBillingPrices } from '../../membership/imported-stripe-billing'
import type { BillingStripeConnection } from './public-contract'

export const billingEmailVerificationJobType = 'billing.email-verification' as const
export const billingEmailVerificationMaxAttempts = 12
export const billingEmailVerificationSafetyLimit = 25
export const billingEmailVerificationExpiryMs = 24 * 60 * 60 * 1_000

const emailSchema = z.email().max(320)
const jobPayloadSchema = z.object({ verificationId: z.string().trim().min(1).max(128) }).strict()
const consumeInputSchema = z
  .object({
    verificationId: z.string().trim().min(1).max(128),
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/)
  })
  .strict()

type BillingEmailVerificationJobPayload = z.infer<typeof jobPayloadSchema>

export type BillingEmailVerificationConsumeOutcome = 'verified' | 'conflict' | 'expired' | 'ignored'

export function reserveBillingEmailVerificationInTransaction(
  connection: BillingStripeConnection,
  input: Readonly<{
    billingCheckoutAttemptId: string
    email: string
    purchaserUserId: string
    stripeSessionId: string
  }>,
  now = new Date()
): string | null {
  const email = normalizedEmail(input.email)
  if (!email || !Number.isFinite(now.getTime())) return null
  const user = connection.sqlite
    .prepare('select email, email_verified as emailVerified from user where id = ?')
    .get(input.purchaserUserId) as { email: string; emailVerified: number } | undefined
  if (!user || user.emailVerified === 1 || !isTemporaryPhoneEmail(user.email)) return null

  const attempt = connection.sqlite
    .prepare(
      `select id, purchaser_user_id as purchaserUserId, stripe_session_id as stripeSessionId
       from billing_checkout_attempts
       where id = ? and purchaser_user_id = ? and stripe_session_id = ? and state = 'completed'
         and ((plan_key = 'personal' and cadence = 'monthly') or
              (plan_key = 'family' and cadence = 'monthly'))`
    )
    .get(input.billingCheckoutAttemptId, input.purchaserUserId, input.stripeSessionId) as
    { id: string; purchaserUserId: string; stripeSessionId: string } | undefined
  if (!attempt) return null

  const existing = readVerificationForAttempt(connection, input.billingCheckoutAttemptId)
  if (existing) {
    if (
      existing.purchaserUserId !== input.purchaserUserId ||
      existing.stripeSessionId !== input.stripeSessionId ||
      existing.email !== email
    ) {
      throw new Error('Billing email verification authority conflict')
    }
    if (existing.status === 'pending') enqueueBillingEmailVerificationJob(connection, existing.id, now)
    return existing.id
  }

  const verificationId = `billing_email_verification_${randomUUID()}`
  const timestamp = now.toISOString()
  connection.sqlite
    .prepare(
      `insert into billing_email_verifications (
         id, purchaser_user_id, billing_checkout_attempt_id, stripe_session_id,
         email, status, expires_at, created_at, updated_at
       ) values (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
    )
    .run(
      verificationId,
      input.purchaserUserId,
      input.billingCheckoutAttemptId,
      input.stripeSessionId,
      email,
      new Date(now.getTime() + billingEmailVerificationExpiryMs).toISOString(),
      timestamp,
      timestamp
    )
  enqueueBillingEmailVerificationJob(connection, verificationId, now)
  return verificationId
}

export function ensureBillingEmailVerificationJobs(
  connection: BillingStripeConnection,
  now = new Date(),
  limit = billingEmailVerificationSafetyLimit
): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > billingEmailVerificationSafetyLimit) {
    throw new TypeError('Invalid Billing email-verification safety limit')
  }
  return connection.sqlite
    .transaction(() => {
      const timestamp = now.toISOString()
      connection.sqlite
        .prepare(
          `update billing_email_verifications
           set status = 'expired', consumed_at = ?, updated_at = ?
           where status = 'pending' and expires_at <= ?`
        )
        .run(timestamp, timestamp, timestamp)
      const rows = connection.sqlite
        .prepare(
          `select verification.id
           from billing_email_verifications verification
           where verification.status = 'pending' and verification.expires_at > ?
             and not exists (
               select 1 from job_queue job
               where job.type = ? and job.status in ('queued', 'running')
                 and job.attempts < job.max_attempts and json_valid(job.payload)
                 and json_extract(job.payload, '$.verificationId') = verification.id
                 and json_remove(job.payload, '$.verificationId') = '{}'
             )
           order by verification.created_at, verification.id limit ?`
        )
        .all(timestamp, billingEmailVerificationJobType, limit) as Array<{ id: string }>
      let scheduled = 0
      for (const row of rows) {
        if (enqueueBillingEmailVerificationJob(connection, row.id, now)) scheduled += 1
      }
      return scheduled
    })
    .immediate()
}

export function createBillingEmailVerificationDeliveryHandler(
  context: Readonly<{
    appName: string
    appUrl: string
    connection: BillingStripeConnection
    secret: string
    sender: TransactionalEmailSender
    now?: () => Date
  }>
): JobHandler {
  return async (payload: JobPayload) => {
    const parsed = jobPayloadSchema.safeParse(payload)
    if (!parsed.success) throw new Error('Invalid Billing email-verification payload')
    const verification = readVerificationById(context.connection, parsed.data.verificationId)
    if (!verification || verification.status !== 'pending') return

    const now = context.now?.() ?? new Date()
    if (now.getTime() >= Date.parse(verification.expiresAt)) {
      markExpired(context.connection, verification, now)
      return
    }
    const url = verificationUrl(context.appUrl, verification, context.secret)
    await context.sender.send(
      createBillingEmailVerificationEmail({
        appName: context.appName,
        to: verification.email,
        url,
        verificationId: verification.id
      })
    )
    const timestamp = now.toISOString()
    const updated = context.connection.sqlite
      .prepare(
        `update billing_email_verifications
         set status = 'sent', sent_at = ?, updated_at = ?
         where id = ? and status = 'pending' and email = ? and expires_at = ?`
      )
      .run(timestamp, timestamp, verification.id, verification.email, verification.expiresAt)
    if (updated.changes === 1) return
    if (readVerificationById(context.connection, verification.id)?.status === 'sent') return
    throw new Error('Billing email verification delivery state changed')
  }
}

export function consumeBillingEmailVerification(
  connection: BillingStripeConnection,
  input: Readonly<{
    secret: string
    stripePrices: ImportedStripeBillingPrices
    token: string
    verificationId: string
    now?: Date
  }>
): BillingEmailVerificationConsumeOutcome {
  const parsed = consumeInputSchema.safeParse({ verificationId: input.verificationId, token: input.token })
  if (!parsed.success || !input.secret) return 'ignored'
  const now = input.now ?? new Date()
  if (!Number.isFinite(now.getTime())) return 'ignored'

  return connection.sqlite
    .transaction(() => {
      const verification = readVerificationById(connection, parsed.data.verificationId)
      if (
        !verification ||
        verification.status !== 'sent' ||
        !tokenMatches(verification, input.secret, parsed.data.token)
      ) {
        return 'ignored' as const
      }
      if (now.getTime() >= Date.parse(verification.expiresAt)) {
        markExpired(connection, verification, now)
        return 'expired' as const
      }

      const user = connection.sqlite
        .prepare(
          `select id, email, email_verified as emailVerified,
                  phone_number as phoneNumber, phone_number_verified as phoneNumberVerified
           from user where id = ?`
        )
        .get(verification.purchaserUserId) as
        | {
            id: string
            email: string
            emailVerified: number
            phoneNumber: string | null
            phoneNumberVerified: number
          }
        | undefined
      if (!user) return 'ignored' as const

      const conflictingUser = connection.sqlite
        .prepare('select id from user where id <> ? and lower(trim(email)) = ? limit 1')
        .get(user.id, verification.email)
      const verifiedDifferentEmail = user.emailVerified === 1 && normalizedEmail(user.email) !== verification.email
      if (conflictingUser || verifiedDifferentEmail) {
        markConsumed(connection, verification, 'conflict', now)
        recordWebsiteAccountIdentityReviewInTransaction(connection, {
          identifier: verification.email,
          observedAt: now,
          reason: 'conflicting_verified_email',
          reviewHashKey: input.secret,
          userId: user.id
        })
        return 'conflict' as const
      }

      const updated = connection.sqlite
        .prepare(
          `update user set email = ?, email_verified = 1, updated_at = ?
           where id = ? and email = ? and email_verified = ?`
        )
        .run(verification.email, Math.floor(now.getTime() / 1_000), user.id, user.email, user.emailVerified)
      if (updated.changes !== 1) throw new Error('Billing email verification account changed')
      ensureWebsiteAccountIdentityInTransaction(
        connection,
        {
          id: user.id,
          email: verification.email,
          emailVerified: true,
          phoneNumber: user.phoneNumber,
          phoneNumberVerified: user.phoneNumberVerified === 1
        },
        { observedAt: now, reviewHashKey: input.secret, stripePrices: input.stripePrices }
      )
      markConsumed(connection, verification, 'consumed', now)
      return 'verified' as const
    })
    .immediate()
}

function enqueueBillingEmailVerificationJob(
  connection: BillingStripeConnection,
  verificationId: string,
  now: Date
): boolean {
  const payload: BillingEmailVerificationJobPayload = { verificationId }
  const encoded = JSON.stringify(payload)
  const timestamp = now.toISOString()
  const inserted = connection.sqlite
    .prepare(
      `insert into job_queue (type, payload, max_attempts, run_after, created_at, updated_at)
       select ?, ?, ?, ?, ?, ? where not exists (
         select 1 from job_queue where type = ? and status in ('queued', 'running')
           and attempts < max_attempts and json_valid(payload)
           and json_extract(payload, '$.verificationId') = ?
           and json_remove(payload, '$.verificationId') = '{}'
       )`
    )
    .run(
      billingEmailVerificationJobType,
      encoded,
      billingEmailVerificationMaxAttempts,
      timestamp,
      timestamp,
      timestamp,
      billingEmailVerificationJobType,
      verificationId
    )
  return inserted.changes === 1
}

function verificationUrl(appUrl: string, verification: BillingEmailVerification, secret: string): string {
  const url = new URL('/api/account/billing/verify-email', appUrl)
  url.searchParams.set('id', verification.id)
  url.searchParams.set('token', verificationToken(verification, secret))
  return url.toString()
}

function verificationToken(verification: BillingEmailVerification, secret: string): string {
  return createHmac('sha256', secret)
    .update(
      JSON.stringify([
        verification.id,
        verification.purchaserUserId,
        verification.billingCheckoutAttemptId,
        verification.stripeSessionId,
        verification.email,
        verification.expiresAt
      ])
    )
    .digest('base64url')
}

function tokenMatches(verification: BillingEmailVerification, secret: string, token: string): boolean {
  const expected = Buffer.from(verificationToken(verification, secret))
  const received = Buffer.from(token)
  return expected.length === received.length && timingSafeEqual(expected, received)
}

function normalizedEmail(value: string): string | null {
  const normalized = value.trim().toLowerCase()
  return emailSchema.safeParse(normalized).success ? normalized : null
}

function readVerificationForAttempt(
  connection: BillingStripeConnection,
  billingCheckoutAttemptId: string
): BillingEmailVerification | null {
  return readVerification(
    connection,
    'select * from billing_email_verifications where billing_checkout_attempt_id = ?',
    billingCheckoutAttemptId
  )
}

function readVerificationById(
  connection: BillingStripeConnection,
  verificationId: string
): BillingEmailVerification | null {
  return readVerification(connection, 'select * from billing_email_verifications where id = ?', verificationId)
}

function readVerification(
  connection: BillingStripeConnection,
  sql: string,
  value: string
): BillingEmailVerification | null {
  const row = connection.sqlite.prepare(sql).get(value) as Record<string, unknown> | undefined
  if (!row) return null
  const mapped = Object.fromEntries(
    Object.entries(row).map(([key, entry]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      entry
    ])
  )
  return mapped as BillingEmailVerification
}

function markExpired(connection: BillingStripeConnection, verification: BillingEmailVerification, now: Date): void {
  const timestamp = now.toISOString()
  connection.sqlite
    .prepare(
      `update billing_email_verifications
       set status = 'expired', consumed_at = ?, updated_at = ?
       where id = ? and status in ('pending', 'sent') and consumed_at is null`
    )
    .run(timestamp, timestamp, verification.id)
}

function markConsumed(
  connection: BillingStripeConnection,
  verification: BillingEmailVerification,
  status: 'consumed' | 'conflict',
  now: Date
): void {
  const timestamp = now.toISOString()
  const updated = connection.sqlite
    .prepare(
      `update billing_email_verifications
       set status = ?, consumed_at = ?, updated_at = ?
       where id = ? and status = 'sent' and email = ? and consumed_at is null`
    )
    .run(status, timestamp, timestamp, verification.id, verification.email)
  if (updated.changes !== 1) throw new Error('Billing email verification state changed')
}
