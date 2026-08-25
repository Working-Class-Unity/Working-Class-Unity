import type Stripe from 'stripe'
import type { JobHandler, JobPayload } from '../../jobs/job-queue'
import { createStripeBillingCatalog } from './catalog'
import type { BillingStripeRuntimeConfiguration } from './configuration'
import type { BillingStripeConnection, BillingStripeIntegration, BillingStripeLifecycleEffect } from './public-contract'
import {
  getBillingCustomerForPurchaser,
  getBillingSubscriptionForPurchaser,
  getOpenBillingTransition,
  getOpenCheckoutAttempt,
  isBillingDeletionPending
} from './repository'
import { commitBillingProjectionInTransaction, type BillingProjectionCommit } from './state-store'
import type { StripeBillingClient } from './stripe-client'
import { isExactManagedSubscription, isExactRenewalInvoice } from './webhook-lifecycle'
import { readExactStripeSubscriptionState } from './webhook-state'

export const billingReconciliationSafetyJobType = 'billing.reconciliation-safety' as const
export const billingReconciliationSafetyIntervalMs = 24 * 60 * 60 * 1_000
export const billingReconciliationSafetyMaxAttempts = 12

type BillingReconciliationSafetyPayload = Readonly<{ cursor: string | null; cycleStartedAt: string }>
type BillingReconciliationSafetyRow = Readonly<{
  billingSubscriptionId: string
  purchaserUserId: string
  stripeCustomerId: string
  stripeSubscriptionId: string
}>

export type BillingReconciliationSafetyJobState = 'idle' | 'scheduled' | 'covered-active' | 'covered-future'

export function ensureBillingReconciliationSafetyJob(
  connection: BillingStripeConnection,
  now = new Date()
): BillingReconciliationSafetyJobState {
  const eligible = connection.sqlite
    .prepare(
      `select 1 from billing_subscriptions
       where status in ('active', 'past_due', 'unpaid') and stripe_subscription_id is not null limit 1`
    )
    .get()
  if (!eligible) return 'idle'
  const runAfter = new Date(now.getTime() + billingReconciliationSafetyIntervalMs)
  return connection.sqlite
    .transaction(() => {
      const existing = connection.sqlite
        .prepare(
          `select status, run_after as runAfter from job_queue
         where type = ? and status in ('queued', 'running') and attempts < max_attempts
           and json_valid(payload) and json_type(payload, '$.cycleStartedAt') = 'text'
           and json_type(payload, '$.cursor') in ('null', 'text')
           and json_remove(payload, '$.cursor', '$.cycleStartedAt') = '{}'
         order by id limit 1`
        )
        .get(billingReconciliationSafetyJobType) as
        { status: 'queued' | 'running'; runAfter: string | null } | undefined
      if (existing) {
        return existing.status === 'queued' &&
          existing.runAfter &&
          Date.parse(existing.runAfter) > now.getTime() + 1_000
          ? ('covered-future' as const)
          : ('covered-active' as const)
      }
      enqueueSafetyJob(connection, { cursor: null, cycleStartedAt: runAfter.toISOString() }, runAfter, now)
      return 'scheduled' as const
    })
    .immediate()
}

export function createBillingReconciliationSafetyHandler(
  context: Readonly<{
    connection: BillingStripeConnection
    client: StripeBillingClient
    config: BillingStripeRuntimeConfiguration
    integration?: BillingStripeIntegration<BillingStripeConnection, unknown>
    now?: () => Date
  }>
): JobHandler {
  const catalog = createStripeBillingCatalog(context.config.stripe.prices)
  return async (payload: JobPayload) => {
    const parsed = parseSafetyPayload(payload)
    const row = nextSafetyRow(context.connection, parsed.cursor)
    const now = context.now?.() ?? new Date()
    if (!row) {
      const nextCycle = new Date(now.getTime() + billingReconciliationSafetyIntervalMs)
      enqueueSafetyJob(context.connection, { cursor: null, cycleStartedAt: nextCycle.toISOString() }, nextCycle, now)
      return
    }

    const captured = captureSafetyAuthority(context.connection, row)
    if (!captured) {
      enqueueSafetyJob(
        context.connection,
        { cursor: row.billingSubscriptionId, cycleStartedAt: parsed.cycleStartedAt },
        now
      )
      return
    }
    const provider = await readExactStripeSubscriptionState(
      context.client,
      catalog,
      row.stripeCustomerId,
      row.stripeSubscriptionId
    )
    const normalized = safetyProjection(captured.subscription, provider, row.stripeCustomerId, catalog)

    const applied = context.connection.sqlite
      .transaction(() => {
        if (
          isBillingDeletionPending(context.connection, row.purchaserUserId) ||
          getOpenCheckoutAttempt(context.connection, row.purchaserUserId) ||
          getOpenBillingTransition(context.connection, row.purchaserUserId)
        )
          return false
        const customer = getBillingCustomerForPurchaser(context.connection, row.purchaserUserId)
        const subscription = getBillingSubscriptionForPurchaser(context.connection, row.purchaserUserId)
        if (
          !customer ||
          customer.id !== captured.customerId ||
          customer.stripeCustomerId !== row.stripeCustomerId ||
          !subscription ||
          subscription.id !== row.billingSubscriptionId ||
          subscription.revision !== captured.subscription.revision ||
          subscription.stripeSubscriptionId !== row.stripeSubscriptionId
        )
          return false
        return (
          commitBillingProjectionInTransaction(context.connection, context.integration, {
            purchaserUserId: row.purchaserUserId,
            stripeCustomerId: row.stripeCustomerId,
            expectedRevision: subscription.revision,
            projection: normalized.projection,
            cause: 'reconciliation_safety',
            verifiedAt: now,
            projectionOrderMs: subscription.projectionOrderMs,
            projectionEventId: subscription.projectionEventId,
            effects: normalized.effects
          }).outcome === 'applied'
        )
      })
      .immediate()
    if (!applied) throw new Error('Billing reconciliation safety authority changed')
    enqueueSafetyJob(
      context.connection,
      { cursor: row.billingSubscriptionId, cycleStartedAt: parsed.cycleStartedAt },
      now
    )
  }
}

function safetyProjection(
  current: NonNullable<ReturnType<typeof getBillingSubscriptionForPurchaser>>,
  provider: Awaited<ReturnType<typeof readExactStripeSubscriptionState>>,
  stripeCustomerId: string,
  catalog: ReturnType<typeof createStripeBillingCatalog>
): Readonly<{ projection: BillingProjectionCommit; effects: readonly BillingStripeLifecycleEffect[] }> {
  let projection: BillingProjectionCommit = provider.projection
  const effects: BillingStripeLifecycleEffect[] = []
  const preserveGrace = () => {
    projection = {
      ...projection,
      graceInvoiceId: current.graceInvoiceId,
      graceStartedAt: current.graceStartedAt,
      graceEndsAt: current.graceEndsAt
    }
  }
  const failClosed = (reason: string) => {
    projection = { ...projection, reconciliationRequired: true, reconciliationReason: reason }
    preserveGrace()
  }

  if (projection.reconciliationRequired) {
    preserveGrace()
  } else if (
    !provider.subscription ||
    !isExactManagedSubscription(provider.subscription, stripeCustomerId, projection, catalog)
  ) {
    failClosed('safety_subscription_shape_mismatch')
  } else if (provider.subscription.pending_update || provider.schedule || stripeId(provider.subscription.schedule)) {
    failClosed('safety_untracked_transition')
  } else if (current.graceInvoiceId) {
    const invoice = expandedInvoice(provider.subscription.latest_invoice)
    if (
      projection.status === 'active' &&
      invoice?.id === current.graceInvoiceId &&
      isExactRenewalInvoice(invoice, provider.subscription, 'paid')
    ) {
      projection = { ...projection, graceInvoiceId: null, graceStartedAt: null, graceEndsAt: null }
    } else if (projection.status === 'past_due' || projection.status === 'unpaid') {
      preserveGrace()
    } else if (projection.status === 'canceled' || projection.status === 'incomplete_expired') {
      projection = { ...projection, graceInvoiceId: null, graceStartedAt: null, graceEndsAt: null }
    } else {
      failClosed('safety_recovery_evidence_mismatch')
    }
  } else if (projection.status === 'past_due' || projection.status === 'unpaid') {
    failClosed('missing_authenticated_failure_invoice')
  }

  if (!projection.reconciliationRequired && current.planKey === 'family') {
    if (!current.cancelAtPeriodEnd && projection.status === 'active' && projection.cancelAtPeriodEnd) {
      effects.push({
        action: 'renewal_ending',
        episodeKey: `${provider.subscription!.id}:cancel_at_period_end:${provider.subscription!.cancel_at ?? 'period_end'}`,
        effectiveAt: projection.currentPeriodEnd,
        transitionId: null
      })
    }
    if (
      !['canceled', 'incomplete_expired'].includes(current.status) &&
      ['canceled', 'incomplete_expired'].includes(projection.status)
    ) {
      effects.push({
        action: 'coverage_ended',
        episodeKey: `${provider.subscription!.id}:terminal:${provider.subscription!.status}:${provider.subscription!.ended_at ?? provider.subscription!.canceled_at ?? 'observed'}`,
        effectiveAt: projection.currentPeriodEnd,
        transitionId: null
      })
    }
  }
  return { projection, effects }
}

function captureSafetyAuthority(
  connection: BillingStripeConnection,
  row: BillingReconciliationSafetyRow
): Readonly<{
  customerId: string
  subscription: NonNullable<ReturnType<typeof getBillingSubscriptionForPurchaser>>
}> | null {
  return connection.sqlite
    .transaction(() => {
      if (
        isBillingDeletionPending(connection, row.purchaserUserId) ||
        getOpenCheckoutAttempt(connection, row.purchaserUserId) ||
        getOpenBillingTransition(connection, row.purchaserUserId)
      )
        return null
      const customer = getBillingCustomerForPurchaser(connection, row.purchaserUserId)
      const subscription = getBillingSubscriptionForPurchaser(connection, row.purchaserUserId)
      if (
        !customer ||
        customer.stripeCustomerId !== row.stripeCustomerId ||
        !subscription ||
        subscription.id !== row.billingSubscriptionId ||
        subscription.stripeSubscriptionId !== row.stripeSubscriptionId
      )
        return null
      return { customerId: customer.id, subscription }
    })
    .immediate()
}

function nextSafetyRow(
  connection: BillingStripeConnection,
  cursor: string | null
): BillingReconciliationSafetyRow | null {
  const row = connection.sqlite
    .prepare(
      `select subscription.id as billingSubscriptionId,
              subscription.purchaser_user_id as purchaserUserId,
              subscription.stripe_subscription_id as stripeSubscriptionId,
              customer.stripe_customer_id as stripeCustomerId
       from billing_subscriptions subscription
       inner join billing_customers customer on customer.id = subscription.billing_customer_id
       where subscription.status in ('active', 'past_due', 'unpaid')
         and subscription.stripe_subscription_id is not null
         and (? is null or subscription.id > ?)
       order by subscription.id limit 1`
    )
    .get(cursor, cursor) as BillingReconciliationSafetyRow | undefined
  return row ?? null
}

function enqueueSafetyJob(
  connection: BillingStripeConnection,
  payload: BillingReconciliationSafetyPayload,
  runAfter: Date,
  createdAt = new Date()
): void {
  const encoded = JSON.stringify(payload)
  connection.sqlite
    .prepare(
      `insert into job_queue (type, payload, max_attempts, run_after, created_at, updated_at)
       select ?, ?, ?, ?, ?, ? where not exists (
         select 1 from job_queue where type = ? and status in ('queued', 'running')
           and attempts < max_attempts and payload = ?
       )`
    )
    .run(
      billingReconciliationSafetyJobType,
      encoded,
      billingReconciliationSafetyMaxAttempts,
      runAfter.toISOString(),
      createdAt.toISOString(),
      createdAt.toISOString(),
      billingReconciliationSafetyJobType,
      encoded
    )
}

function parseSafetyPayload(payload: JobPayload): BillingReconciliationSafetyPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('Invalid Billing reconciliation safety payload')
  }
  const value = payload as Record<string, JobPayload>
  if (
    Object.keys(value).sort().join(',') !== 'cursor,cycleStartedAt' ||
    (value.cursor !== null && (typeof value.cursor !== 'string' || !value.cursor)) ||
    typeof value.cycleStartedAt !== 'string' ||
    !value.cycleStartedAt ||
    new Date(value.cycleStartedAt).toISOString() !== value.cycleStartedAt
  )
    throw new TypeError('Invalid Billing reconciliation safety payload')
  return { cursor: value.cursor, cycleStartedAt: value.cycleStartedAt }
}

function expandedInvoice(value: string | Stripe.Invoice | null): Stripe.Invoice | null {
  return value && typeof value !== 'string' && value.object === 'invoice' ? value : null
}

function stripeId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') return value.id
  return null
}
