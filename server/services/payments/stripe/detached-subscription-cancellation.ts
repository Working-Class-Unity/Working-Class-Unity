import type Stripe from 'stripe'
import type { JobHandler, JobPayload } from '../../jobs/job-queue'
import { z } from 'zod'
import type { BillingStripeConnection } from './public-contract'
import type { StripeBillingClient } from './stripe-client'

export const billingDetachedSubscriptionCancellationJobType = 'billing.detached-subscription-cancellation' as const
export const billingDetachedSubscriptionCancellationMaxAttempts = 12
export const billingDetachedSubscriptionCancellationSafetyLimit = 25

const terminalStatuses = new Set(['canceled', 'incomplete_expired'])
const payloadSchema = z.object({ subjectId: z.string().trim().min(1).max(128) }).strict()

type DetachedCancellationAuthority = Readonly<{
  id: string
  stripeCustomerId: string
  stripeSubscriptionId: string
  status: string
}>

export function enqueueBillingDetachedSubscriptionCancellation(
  connection: BillingStripeConnection,
  subjectId: string,
  now = new Date()
): boolean {
  if (!subjectId || !Number.isFinite(now.getTime())) {
    throw new TypeError('Invalid detached Stripe cancellation job')
  }
  const payload = JSON.stringify({ subjectId })
  const timestamp = now.toISOString()
  const inserted = connection.sqlite
    .prepare(
      `insert into job_queue (type, payload, max_attempts, run_after, created_at, updated_at)
       select ?, ?, ?, ?, ?, ?
       where not exists (
         select 1 from job_queue
         where type = ? and status in ('queued', 'running') and attempts < max_attempts
           and json_valid(payload) and json_extract(payload, '$.subjectId') = ?
           and json_remove(payload, '$.subjectId') = '{}'
       )`
    )
    .run(
      billingDetachedSubscriptionCancellationJobType,
      payload,
      billingDetachedSubscriptionCancellationMaxAttempts,
      timestamp,
      timestamp,
      timestamp,
      billingDetachedSubscriptionCancellationJobType,
      subjectId
    )
  return inserted.changes === 1
}

export function ensureBillingDetachedSubscriptionCancellationJobs(
  connection: BillingStripeConnection,
  now = new Date(),
  limit = billingDetachedSubscriptionCancellationSafetyLimit
): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > billingDetachedSubscriptionCancellationSafetyLimit) {
    throw new TypeError('Invalid detached Stripe cancellation safety limit')
  }
  return connection.sqlite
    .transaction(() => {
      const subjects = connection.sqlite
        .prepare(
          `select subject.id
         from detached_billing_subjects subject
         where subject.provider = 'stripe'
           and subject.provider_reference glob 'sub_*'
           and subject.provider_customer_reference is not null
           and subject.provider_status not in ('canceled', 'incomplete_expired')
           and not exists (
             select 1 from job_queue job
             where job.type = ? and job.status in ('queued', 'running')
               and job.attempts < job.max_attempts and json_valid(job.payload)
               and json_extract(job.payload, '$.subjectId') = subject.id
               and json_remove(job.payload, '$.subjectId') = '{}'
           )
         order by subject.status_updated_at, subject.id limit ?`
        )
        .all(billingDetachedSubscriptionCancellationJobType, limit) as Array<{ id: string }>
      let scheduled = 0
      for (const subject of subjects) {
        if (enqueueBillingDetachedSubscriptionCancellation(connection, subject.id, now)) scheduled += 1
      }
      return scheduled
    })
    .immediate()
}

export function createBillingDetachedSubscriptionCancellationHandler(
  connection: BillingStripeConnection,
  getClient: () => Pick<StripeBillingClient, 'subscriptions'>,
  now: () => Date = () => new Date()
): JobHandler {
  return async (payload: JobPayload) => {
    const parsed = payloadSchema.safeParse(payload)
    if (!parsed.success) throw new Error('Invalid detached Stripe cancellation job payload')
    const authority = readAuthority(connection, parsed.data.subjectId)
    if (!authority || terminalStatuses.has(authority.status)) return

    let client: Pick<StripeBillingClient, 'subscriptions'>
    try {
      client = getClient()
    } catch {
      throw new Error('Detached Stripe cancellation is not confirmed')
    }

    let subscription: Stripe.Subscription
    try {
      subscription = await client.subscriptions.retrieve(authority.stripeSubscriptionId)
    } catch {
      throw new Error('Detached Stripe cancellation is not confirmed')
    }
    requireExactAuthority(subscription, authority)
    if (!terminalStatuses.has(subscription.status)) {
      try {
        await client.subscriptions.cancel(
          authority.stripeSubscriptionId,
          { invoice_now: false, prorate: false },
          { idempotencyKey: `billing-detached-cancellation:${authority.id}` }
        )
      } catch {
        // The exact read below converges a lost cancellation response.
      }
      try {
        subscription = await client.subscriptions.retrieve(authority.stripeSubscriptionId)
      } catch {
        throw new Error('Detached Stripe cancellation is not confirmed')
      }
      requireExactAuthority(subscription, authority)
      if (!terminalStatuses.has(subscription.status)) {
        throw new Error('Detached Stripe cancellation is not confirmed')
      }
    }

    const updated = connection.sqlite
      .prepare(
        `update detached_billing_subjects set provider_status = ?, status_updated_at = ?
         where id = ? and provider = 'stripe' and provider_reference = ?
           and provider_customer_reference = ?
           and provider_status not in ('canceled', 'incomplete_expired')`
      )
      .run(
        subscription.status,
        now().toISOString(),
        authority.id,
        authority.stripeSubscriptionId,
        authority.stripeCustomerId
      )
    if (updated.changes === 1) return
    const current = readAuthority(connection, authority.id)
    if (current && terminalStatuses.has(current.status)) return
    throw new Error('Detached Stripe cancellation is not confirmed')
  }
}

function readAuthority(connection: BillingStripeConnection, subjectId: string): DetachedCancellationAuthority | null {
  const row = connection.sqlite
    .prepare(
      `select id, provider_reference as stripeSubscriptionId,
              provider_customer_reference as stripeCustomerId, provider_status as status
       from detached_billing_subjects
       where id = ? and provider = 'stripe'
         and provider_reference glob 'sub_*'
         and provider_customer_reference is not null`
    )
    .get(subjectId) as DetachedCancellationAuthority | undefined
  return row ?? null
}

function requireExactAuthority(subscription: Stripe.Subscription, authority: DetachedCancellationAuthority): void {
  if (
    subscription?.id !== authority.stripeSubscriptionId ||
    stripeId(subscription.customer) !== authority.stripeCustomerId
  ) {
    throw new Error('Detached Stripe cancellation is not confirmed')
  }
}

function stripeId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') return value.id
  return null
}
