import type { DatabaseConnection } from '../../db/connect'
import type { JsonValue } from '../../db/schema'
import type { AppRuntimeConfig } from '../../utils/runtime'
import type { JobHandler } from '../jobs/job-queue'
import { createStripeBillingCatalog } from './billing-catalog'
import { applySafetyStripeProjection, billingReconciliationRevision } from './billing-event-store'
import { readExactStripeSubscriptionState } from './billing-webhook-state'
import type { StripeBillingClient } from './stripe-client'

export const billingReconciliationSafetyJobType = 'billing.reconciliation-safety' as const
export const billingReconciliationSafetyIntervalMs = 24 * 60 * 60 * 1_000
export const billingReconciliationSafetyMaxAttempts = 12

type BillingReconciliationSafetyPayload = Readonly<{
  cursor: string | null
  cycleStartedAt: string
}>

type BillingReconciliationSafetyRow = Readonly<{
  billingSubscriptionId: string
  stripeCustomerId: string
  stripeSubscriptionId: string
  userId: string
}>

export type BillingReconciliationSafetyJobState = 'idle' | 'scheduled' | 'covered-active' | 'covered-future'

export function ensureBillingReconciliationSafetyJob(
  connection: DatabaseConnection,
  now = new Date()
): BillingReconciliationSafetyJobState {
  const eligible = connection.sqlite
    .prepare(
      `select 1
       from billing_subscriptions
       where status in ('active', 'past_due', 'unpaid')
         and stripe_subscription_id is not null
       limit 1`
    )
    .get()
  if (!eligible) return 'idle'

  const runAfter = new Date(now.getTime() + billingReconciliationSafetyIntervalMs)
  return connection.sqlite
    .transaction(() => {
      const existing = connection.sqlite
        .prepare(
          `select status, run_after as runAfter
           from job_queue
           where type = ?
             and status in ('queued', 'running')
             and attempts < max_attempts
             and json_valid(payload)
             and json_type(payload, '$.cycleStartedAt') = 'text'
             and json_type(payload, '$.cursor') in ('null', 'text')
             and json_remove(payload, '$.cursor', '$.cycleStartedAt') = '{}'
           order by id
           limit 1`
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

export function createBillingReconciliationSafetyHandler(context: {
  connection: DatabaseConnection
  client: StripeBillingClient
  config: AppRuntimeConfig
  now?: () => Date
}): JobHandler {
  const catalog = createStripeBillingCatalog(context.config.stripe)
  return async (payload: JsonValue) => {
    const parsed = parseSafetyPayload(payload)
    const row = nextSafetyRow(context.connection, parsed.cursor)
    const now = context.now?.() ?? new Date()
    if (!row) {
      const nextCycle = new Date(now.getTime() + billingReconciliationSafetyIntervalMs)
      enqueueSafetyJob(context.connection, { cursor: null, cycleStartedAt: nextCycle.toISOString() }, nextCycle, now)
      return
    }

    const expectedRevision = billingReconciliationRevision(context.connection, row.userId)
    const state = await readExactStripeSubscriptionState(
      context.client,
      catalog,
      row.stripeCustomerId,
      row.stripeSubscriptionId
    )
    applySafetyStripeProjection(context.connection, {
      userId: row.userId,
      stripeCustomerId: row.stripeCustomerId,
      expectedRevision,
      catalog,
      ...state
    })
    enqueueSafetyJob(
      context.connection,
      {
        cursor: row.billingSubscriptionId,
        cycleStartedAt: parsed.cycleStartedAt
      },
      now
    )
  }
}

function nextSafetyRow(connection: DatabaseConnection, cursor: string | null): BillingReconciliationSafetyRow | null {
  const row = connection.sqlite
    .prepare(
      `select
         billing_subscriptions.id as billingSubscriptionId,
         billing_subscriptions.stripe_subscription_id as stripeSubscriptionId,
         billing_customers.stripe_customer_id as stripeCustomerId,
         organization.personal_owner_user_id as userId
       from billing_subscriptions
       inner join billing_customers
         on billing_customers.id = billing_subscriptions.billing_customer_id
       inner join organization
         on organization.id = billing_subscriptions.organization_id
       where billing_subscriptions.status in ('active', 'past_due', 'unpaid')
         and billing_subscriptions.stripe_subscription_id is not null
         and organization.personal_owner_user_id is not null
         and (? is null or billing_subscriptions.id > ?)
       order by billing_subscriptions.id
       limit 1`
    )
    .get(cursor, cursor) as BillingReconciliationSafetyRow | undefined
  return row ?? null
}

function enqueueSafetyJob(
  connection: DatabaseConnection,
  payload: BillingReconciliationSafetyPayload,
  runAfter: Date,
  createdAt = new Date()
): void {
  const encoded = JSON.stringify(payload)
  connection.sqlite
    .prepare(
      `insert into job_queue (type, payload, max_attempts, run_after, created_at, updated_at)
       select ?, ?, ?, ?, ?, ?
       where not exists (
         select 1
         from job_queue
         where type = ?
           and status in ('queued', 'running')
           and payload = ?
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

function parseSafetyPayload(payload: JsonValue): BillingReconciliationSafetyPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('Invalid billing reconciliation safety payload')
  }
  const value = payload as Record<string, JsonValue>
  if (
    Object.keys(value).sort().join(',') !== 'cursor,cycleStartedAt' ||
    (value.cursor !== null && (typeof value.cursor !== 'string' || !value.cursor)) ||
    typeof value.cycleStartedAt !== 'string' ||
    !value.cycleStartedAt ||
    new Date(value.cycleStartedAt).toISOString() !== value.cycleStartedAt
  ) {
    throw new TypeError('Invalid billing reconciliation safety payload')
  }
  return {
    cursor: value.cursor,
    cycleStartedAt: value.cycleStartedAt
  }
}
