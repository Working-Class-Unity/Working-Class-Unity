import { createHash } from 'node:crypto'
import type Stripe from 'stripe'
import { z } from 'zod'
import type { JobHandler, JobPayload } from '../../jobs/job-queue'
import { isMembershipDuesOfferingKey } from '../../../../shared/billing'
import type { BillingSubscription } from '../../../db/schema/billing'
import { createStripeBillingCatalog } from './catalog'
import type { BillingStripePriceConfiguration } from './configuration'
import { billingGracePeriodMs } from './dunning'
import { projectStripeSubscription, stripeId, type CurrentBillingProjection } from './projection'
import type { BillingStripeConnection, BillingStripeIntegration } from './public-contract'
import {
  getBillingCustomerForPurchaser,
  getBillingSubscriptionById,
  getOpenBillingTransition,
  getOpenCheckoutAttempt,
  isBillingDeletionPending
} from './repository'
import { commitBillingProjection } from './state-store'
import type { StripeBillingClient } from './stripe-client'

export const billingGraceExpiryJobType = 'billing.grace-expiry' as const
export const billingGraceExpiryMaxAttempts = 12
export const billingGraceExpirySafetyLimit = 25

const terminalStatuses = new Set<Stripe.Subscription.Status>(['canceled', 'incomplete_expired'])
const paymentFailureStatuses = new Set<Stripe.Subscription.Status>(['past_due', 'unpaid'])
const payloadSchema = z
  .object({
    billingSubscriptionId: z.string().trim().min(1).max(128),
    stripeSubscriptionId: z.string().trim().regex(/^sub_/).max(255),
    graceInvoiceId: z.string().trim().regex(/^in_/).max(255),
    graceStartedAt: z.string().trim().min(1).max(64),
    graceEndsAt: z.string().trim().min(1).max(64)
  })
  .strict()

type GraceExpiryPayload = z.infer<typeof payloadSchema>

type GraceExpiryAuthority = Readonly<{
  subscription: BillingSubscription
  stripeCustomerId: string
  graceEndsAtMs: number
}>

export function enqueueBillingGraceExpiryJob(
  connection: BillingStripeConnection,
  payload: GraceExpiryPayload,
  now = new Date()
): boolean {
  const parsed = payloadSchema.safeParse(payload)
  const runAfterMs = Date.parse(payload.graceEndsAt)
  if (!parsed.success || !Number.isFinite(runAfterMs) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Invalid Billing grace-expiry job')
  }
  const encoded = JSON.stringify(parsed.data)
  const inserted = connection.sqlite
    .prepare(
      `insert into job_queue (type, payload, max_attempts, run_after, created_at, updated_at)
       select ?, ?, ?, ?, ?, ? where not exists (
         select 1 from job_queue where type = ? and status in ('queued', 'running')
           and attempts < max_attempts and json_valid(payload)
           and json_extract(payload, '$.billingSubscriptionId') = ?
           and json_extract(payload, '$.stripeSubscriptionId') = ?
           and json_extract(payload, '$.graceInvoiceId') = ?
           and json_extract(payload, '$.graceStartedAt') = ?
           and json_extract(payload, '$.graceEndsAt') = ?
           and json_remove(payload, '$.billingSubscriptionId', '$.stripeSubscriptionId',
                           '$.graceInvoiceId', '$.graceStartedAt', '$.graceEndsAt') = '{}'
       )`
    )
    .run(
      billingGraceExpiryJobType,
      encoded,
      billingGraceExpiryMaxAttempts,
      parsed.data.graceEndsAt,
      now.toISOString(),
      now.toISOString(),
      billingGraceExpiryJobType,
      parsed.data.billingSubscriptionId,
      parsed.data.stripeSubscriptionId,
      parsed.data.graceInvoiceId,
      parsed.data.graceStartedAt,
      parsed.data.graceEndsAt
    )
  return inserted.changes === 1
}

export function ensureBillingGraceExpiryJobs(
  connection: BillingStripeConnection,
  now = new Date(),
  limit = billingGraceExpirySafetyLimit
): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > billingGraceExpirySafetyLimit) {
    throw new TypeError('Invalid Billing grace-expiry safety limit')
  }
  return connection.sqlite
    .transaction(() => {
      const rows = connection.sqlite
        .prepare(
          `select subscription.id as billingSubscriptionId,
                  subscription.stripe_subscription_id as stripeSubscriptionId,
                  subscription.grace_invoice_id as graceInvoiceId,
                  subscription.grace_started_at as graceStartedAt,
                  subscription.grace_ends_at as graceEndsAt
           from billing_subscriptions subscription
           where subscription.status in ('past_due', 'unpaid')
             and subscription.reconciliation_required = 0
             and subscription.stripe_subscription_id is not null
             and subscription.grace_invoice_id is not null
             and subscription.grace_started_at is not null
             and subscription.grace_ends_at is not null
             and ((subscription.plan_key = 'personal' and subscription.cadence = 'monthly') or
                  (subscription.plan_key = 'family' and subscription.cadence = 'monthly'))
             and not exists (
               select 1 from billing_account_deletion_requests deletion
               where deletion.purchaser_user_id = subscription.purchaser_user_id
             )
             and not exists (
               select 1 from billing_checkout_attempts checkout_attempt
               where checkout_attempt.purchaser_user_id = subscription.purchaser_user_id
                 and checkout_attempt.state in ('pending', 'open', 'reconciliation_required')
             )
             and not exists (
               select 1 from billing_subscription_transitions transition_row
               where transition_row.purchaser_user_id = subscription.purchaser_user_id
                 and transition_row.state in ('pending', 'action_required', 'scheduled', 'reconciliation_required')
             )
             and not exists (
               select 1 from job_queue job
               where job.type = ? and job.status in ('queued', 'running')
                 and job.attempts < job.max_attempts and json_valid(job.payload)
                 and json_extract(job.payload, '$.billingSubscriptionId') = subscription.id
                 and json_extract(job.payload, '$.stripeSubscriptionId') = subscription.stripe_subscription_id
                 and json_extract(job.payload, '$.graceInvoiceId') = subscription.grace_invoice_id
                 and json_extract(job.payload, '$.graceStartedAt') = subscription.grace_started_at
                 and json_extract(job.payload, '$.graceEndsAt') = subscription.grace_ends_at
                 and json_remove(job.payload, '$.billingSubscriptionId', '$.stripeSubscriptionId',
                                 '$.graceInvoiceId', '$.graceStartedAt', '$.graceEndsAt') = '{}'
             )
           order by subscription.grace_ends_at, subscription.id limit ?`
        )
        .all(billingGraceExpiryJobType, limit) as GraceExpiryPayload[]
      let scheduled = 0
      for (const row of rows) {
        if (validGraceWindow(row) && enqueueBillingGraceExpiryJob(connection, row, now)) scheduled += 1
      }
      return scheduled
    })
    .immediate()
}

export function createBillingGraceExpiryHandler(
  context: Readonly<{
    connection: BillingStripeConnection
    client: Pick<StripeBillingClient, 'subscriptions'>
    prices: BillingStripePriceConfiguration
    integration?: BillingStripeIntegration<BillingStripeConnection, unknown>
    now?: () => Date
  }>
): JobHandler {
  const catalog = createStripeBillingCatalog(context.prices)
  return async (payload: JobPayload) => {
    const parsed = payloadSchema.safeParse(payload)
    if (!parsed.success) throw new Error('Invalid Billing grace-expiry payload')
    let authority = readGraceExpiryAuthority(context.connection, parsed.data)
    if (!authority) return

    const observedAt = context.now?.() ?? new Date()
    if (observedAt.getTime() < authority.graceEndsAtMs) return

    let provider: Stripe.Subscription
    try {
      provider = await context.client.subscriptions.retrieve(authority.subscription.stripeSubscriptionId!)
    } catch {
      throw new Error('Billing grace expiry is not confirmed')
    }
    let projection = exactProjection(provider, authority, catalog)

    if (paymentFailureStatuses.has(provider.status)) {
      const current = readGraceExpiryAuthority(context.connection, parsed.data)
      if (!current || !sameAuthority(authority, current)) return
      authority = current
      try {
        await context.client.subscriptions.cancel(
          authority.subscription.stripeSubscriptionId!,
          { invoice_now: false, prorate: false },
          { idempotencyKey: graceExpiryIdempotencyKey(parsed.data) }
        )
      } catch {
        // An exact read below converges a lost Stripe cancellation response.
      }
      try {
        provider = await context.client.subscriptions.retrieve(authority.subscription.stripeSubscriptionId!)
      } catch {
        throw new Error('Billing grace expiry is not confirmed')
      }
      projection = exactProjection(provider, authority, catalog)
      if (!terminalStatuses.has(provider.status)) {
        throw new Error('Billing grace expiry is not confirmed')
      }
    }

    if (!terminalStatuses.has(provider.status) && provider.status !== 'active') {
      throw new Error('Billing grace expiry is not confirmed')
    }
    commitExactProjection(context, parsed.data, authority, projection, observedAt)
  }
}

function readGraceExpiryAuthority(
  connection: BillingStripeConnection,
  payload: GraceExpiryPayload
): GraceExpiryAuthority | null {
  const subscription = getBillingSubscriptionById(connection, payload.billingSubscriptionId)
  if (
    !subscription ||
    subscription.stripeSubscriptionId !== payload.stripeSubscriptionId ||
    subscription.graceInvoiceId !== payload.graceInvoiceId ||
    subscription.graceStartedAt !== payload.graceStartedAt ||
    subscription.graceEndsAt !== payload.graceEndsAt ||
    (subscription.status !== 'past_due' && subscription.status !== 'unpaid') ||
    subscription.reconciliationRequired ||
    !subscription.stripeSubscriptionItemId ||
    !subscription.stripePriceId ||
    !isMembershipDuesOfferingKey(`${subscription.planKey}.${subscription.cadence}`) ||
    !validGraceWindow(payload) ||
    isBillingDeletionPending(connection, subscription.purchaserUserId) ||
    getOpenCheckoutAttempt(connection, subscription.purchaserUserId) ||
    getOpenBillingTransition(connection, subscription.purchaserUserId)
  ) {
    return null
  }
  const customer = getBillingCustomerForPurchaser(connection, subscription.purchaserUserId)
  if (!customer || customer.id !== subscription.billingCustomerId) return null
  return Object.freeze({
    subscription,
    stripeCustomerId: customer.stripeCustomerId,
    graceEndsAtMs: Date.parse(payload.graceEndsAt)
  })
}

function exactProjection(
  provider: Stripe.Subscription,
  authority: GraceExpiryAuthority,
  catalog: ReturnType<typeof createStripeBillingCatalog>
): CurrentBillingProjection {
  const subscription = authority.subscription
  if (
    provider?.object !== 'subscription' ||
    provider.id !== subscription.stripeSubscriptionId ||
    stripeId(provider.customer) !== authority.stripeCustomerId ||
    stripeId(provider.schedule ?? null) ||
    provider.pending_update
  ) {
    throw new Error('Billing grace expiry is not confirmed')
  }
  const projection = projectStripeSubscription(provider, authority.stripeCustomerId, catalog)
  if (
    projection.reconciliationRequired ||
    projection.stripeSubscriptionId !== subscription.stripeSubscriptionId ||
    projection.stripeSubscriptionItemId !== subscription.stripeSubscriptionItemId ||
    projection.stripePriceId !== subscription.stripePriceId ||
    projection.planKey !== subscription.planKey ||
    projection.cadence !== subscription.cadence
  ) {
    throw new Error('Billing grace expiry is not confirmed')
  }
  return projection
}

function commitExactProjection(
  context: Readonly<{
    connection: BillingStripeConnection
    integration?: BillingStripeIntegration<BillingStripeConnection, unknown>
  }>,
  payload: GraceExpiryPayload,
  authority: GraceExpiryAuthority,
  projection: CurrentBillingProjection,
  observedAt: Date
): void {
  let expected = authority.subscription
  const providerTerminal = terminalStatuses.has(projection.status as Stripe.Subscription.Status)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = commitBillingProjection(context.connection, context.integration, {
      purchaserUserId: expected.purchaserUserId,
      stripeCustomerId: authority.stripeCustomerId,
      expectedRevision: expected.revision,
      projection,
      cause: 'grace_expiry',
      verifiedAt: observedAt
    })
    if (result.outcome === 'applied') return
    const current = getBillingSubscriptionById(context.connection, payload.billingSubscriptionId)
    if (
      result.outcome === 'authority_lost' ||
      !current ||
      current.purchaserUserId !== expected.purchaserUserId ||
      current.billingCustomerId !== expected.billingCustomerId ||
      current.stripeSubscriptionId !== payload.stripeSubscriptionId ||
      current.stripeSubscriptionItemId !== projection.stripeSubscriptionItemId ||
      current.stripePriceId !== projection.stripePriceId ||
      (!providerTerminal &&
        (current.graceInvoiceId !== payload.graceInvoiceId ||
          current.graceStartedAt !== payload.graceStartedAt ||
          current.graceEndsAt !== payload.graceEndsAt ||
          (current.status !== 'past_due' && current.status !== 'unpaid') ||
          current.reconciliationRequired)) ||
      isBillingDeletionPending(context.connection, current.purchaserUserId) ||
      getOpenCheckoutAttempt(context.connection, current.purchaserUserId) ||
      getOpenBillingTransition(context.connection, current.purchaserUserId)
    ) {
      break
    }
    expected = current
  }
  throw new Error('Billing grace expiry is not confirmed')
}

function validGraceWindow(payload: Pick<GraceExpiryPayload, 'graceStartedAt' | 'graceEndsAt'>): boolean {
  const startedAt = Date.parse(payload.graceStartedAt)
  const endsAt = Date.parse(payload.graceEndsAt)
  return Number.isFinite(startedAt) && Number.isFinite(endsAt) && endsAt - startedAt === billingGracePeriodMs
}

function sameAuthority(left: GraceExpiryAuthority, right: GraceExpiryAuthority): boolean {
  return (
    left.stripeCustomerId === right.stripeCustomerId &&
    left.subscription.id === right.subscription.id &&
    left.subscription.revision === right.subscription.revision &&
    left.subscription.status === right.subscription.status &&
    left.subscription.graceInvoiceId === right.subscription.graceInvoiceId &&
    left.subscription.graceStartedAt === right.subscription.graceStartedAt &&
    left.subscription.graceEndsAt === right.subscription.graceEndsAt
  )
}

function graceExpiryIdempotencyKey(payload: GraceExpiryPayload): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([payload.stripeSubscriptionId, payload.graceInvoiceId, payload.graceStartedAt]))
    .digest('hex')
  return `billing-grace-expiry:${digest}`
}
