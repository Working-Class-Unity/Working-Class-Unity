import { z } from 'zod'
import type { DatabaseConnection } from '../../db/connect'
import { getBillingTransitionById } from '../../db/repositories/billing'
import type { JsonValue } from '../../db/schema'
import type { AppRuntimeConfig } from '../../utils/runtime'
import type { JobHandler } from '../jobs/job-queue'
import { createStripeBillingCatalog } from './billing-catalog'
import { applyStripeTransitionConvergence, billingReconciliationRevision } from './billing-event-store'
import { readExactStripeSubscriptionState } from './billing-webhook-state'
import type { StripeBillingClient } from './stripe-client'

export const billingTransitionConvergenceJobType = 'billing.transition-convergence' as const
export const billingTransitionConvergenceMaxAttempts = 12
export const billingTransitionConvergenceSafetyLimit = 25
export const billingTransitionPendingRecoveryDelayMs = 5 * 60 * 1_000

const billingTransitionConvergencePayloadSchema = z
  .object({
    transitionId: z.string().trim().min(1).max(128)
  })
  .strict()

type BillingTransitionConvergenceAuthority = Readonly<{
  transitionId: string
  userId: string
  billingSubscriptionId: string
  stripeCustomerId: string
  stripeSubscriptionId: string
  stripeSubscriptionScheduleId: string | null
  state: 'pending' | 'action_required' | 'scheduled' | 'reconciliation_required'
  updatedAt: string
  expectedBillingRevision: string
}>

export function enqueueBillingTransitionConvergenceJob(
  connection: DatabaseConnection,
  transitionId: string,
  runAfter: Date,
  now = new Date()
): boolean {
  if (!transitionId || !Number.isFinite(runAfter.getTime()) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Invalid billing transition convergence job')
  }

  const payload = JSON.stringify({ transitionId })
  const inserted = connection.sqlite
    .prepare(
      `insert into job_queue (type, payload, max_attempts, run_after, created_at, updated_at)
       select ?, ?, ?, ?, ?, ?
       where not exists (
         select 1
         from job_queue
         where type = ?
           and status in ('queued', 'running')
           and attempts < max_attempts
           and json_valid(payload)
           and json_extract(payload, '$.transitionId') = ?
           and json_remove(payload, '$.transitionId') = '{}'
       )`
    )
    .run(
      billingTransitionConvergenceJobType,
      payload,
      billingTransitionConvergenceMaxAttempts,
      runAfter.toISOString(),
      now.toISOString(),
      now.toISOString(),
      billingTransitionConvergenceJobType,
      transitionId
    )
  return inserted.changes === 1
}

export function ensureBillingTransitionConvergenceJobs(
  connection: DatabaseConnection,
  now = new Date(),
  limit = billingTransitionConvergenceSafetyLimit
): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > billingTransitionConvergenceSafetyLimit) {
    throw new TypeError('Invalid billing transition convergence safety limit')
  }

  return connection.sqlite
    .transaction(() => {
      const rows = connection.sqlite
        .prepare(
          `select
             billing_subscription_transitions.id,
             billing_subscription_transitions.state,
             billing_subscription_transitions.updated_at as updatedAt,
             case billing_subscription_transitions.state
               when 'scheduled' then billing_subscription_transitions.effective_at
               when 'action_required' then billing_subscription_transitions.stripe_pending_update_expires_at
               else null
             end as runAfter
           from billing_subscription_transitions
           where billing_subscription_transitions.state in (
             'pending',
             'action_required',
             'scheduled',
             'reconciliation_required'
           )
             and (
               billing_subscription_transitions.state in ('pending', 'reconciliation_required')
               or case billing_subscription_transitions.state
                 when 'scheduled' then billing_subscription_transitions.effective_at
                 else billing_subscription_transitions.stripe_pending_update_expires_at
               end is not null
             )
             and not exists (
               select 1
               from job_queue
               where job_queue.type = ?
                 and job_queue.status in ('queued', 'running')
                 and job_queue.attempts < job_queue.max_attempts
                 and json_valid(job_queue.payload)
                 and json_extract(job_queue.payload, '$.transitionId') =
                   billing_subscription_transitions.id
                 and json_remove(job_queue.payload, '$.transitionId') = '{}'
             )
           order by
             coalesce(runAfter, billing_subscription_transitions.updated_at),
             billing_subscription_transitions.id
           limit ?`
        )
        .all(billingTransitionConvergenceJobType, limit) as Array<{
        id: string
        runAfter: string | null
        state: BillingTransitionConvergenceAuthority['state']
        updatedAt: string
      }>

      let scheduled = 0
      for (const row of rows) {
        const runAfterMs =
          row.state === 'pending'
            ? Date.parse(row.updatedAt) + billingTransitionPendingRecoveryDelayMs
            : row.runAfter
              ? Date.parse(row.runAfter)
              : now.getTime()
        if (!Number.isFinite(runAfterMs)) continue
        if (enqueueBillingTransitionConvergenceJob(connection, row.id, new Date(runAfterMs), now)) {
          scheduled += 1
        }
      }
      return scheduled
    })
    .immediate()
}

export function createBillingTransitionConvergenceHandler(context: {
  connection: DatabaseConnection
  client: StripeBillingClient
  config: AppRuntimeConfig
  now?: () => Date
}): JobHandler {
  const catalog = createStripeBillingCatalog(context.config.stripe)
  return async (payload: JsonValue) => {
    const parsed = billingTransitionConvergencePayloadSchema.safeParse(payload)
    if (!parsed.success) throw new Error('Invalid billing transition convergence job payload')

    const authority = readBillingTransitionConvergenceAuthority(context.connection, parsed.data.transitionId)
    if (!authority) return

    const state = await readExactStripeSubscriptionState(
      context.client,
      catalog,
      authority.stripeCustomerId,
      authority.stripeSubscriptionId,
      authority.stripeSubscriptionScheduleId
    )
    const observedAt = context.now?.() ?? new Date()
    applyStripeTransitionConvergence(context.connection, {
      userId: authority.userId,
      transitionId: authority.transitionId,
      stripeCustomerId: authority.stripeCustomerId,
      expectedBillingRevision: authority.expectedBillingRevision,
      catalog,
      observedAt,
      ...state
    })

    const transition = getBillingTransitionById(context.connection, authority.transitionId)
    if (!transition) return
    if (transition.state === 'reconciliation_required') {
      throw new Error('Billing transition requires further reconciliation')
    }
    if (transition.state === 'pending') {
      const updatedAt = Date.parse(transition.updatedAt)
      if (Number.isFinite(updatedAt) && observedAt.getTime() - updatedAt >= billingTransitionPendingRecoveryDelayMs) {
        markTimedOutBillingTransitionReconciliation(
          context.connection,
          authority,
          transition.revision,
          'transition_provider_operation_incomplete',
          observedAt
        )
        throw new Error('Billing transition requires further reconciliation')
      }
      throw new Error('Billing transition provider operation is still pending')
    }
    if (transition.state === 'action_required') {
      const expiresAt = Date.parse(transition.stripePendingUpdateExpiresAt ?? '')
      if (Number.isFinite(expiresAt) && expiresAt > observedAt.getTime()) return
      throw new Error('Billing transition has not converged')
    }
    if (transition.state === 'scheduled') {
      const effectiveAt = Date.parse(transition.effectiveAt ?? '')
      if (Number.isFinite(effectiveAt) && effectiveAt > observedAt.getTime()) return
      throw new Error('Billing transition has not converged')
    }
  }
}

function readBillingTransitionConvergenceAuthority(
  connection: DatabaseConnection,
  transitionId: string
): BillingTransitionConvergenceAuthority | null {
  const row = connection.sqlite
    .prepare(
      `select
         billing_subscription_transitions.id as transitionId,
         billing_subscription_transitions.stripe_subscription_schedule_id as stripeSubscriptionScheduleId,
         billing_subscription_transitions.state,
         billing_subscription_transitions.updated_at as updatedAt,
         billing_subscriptions.id as billingSubscriptionId,
         organization.personal_owner_user_id as userId,
         billing_customers.stripe_customer_id as stripeCustomerId,
         billing_subscriptions.stripe_subscription_id as stripeSubscriptionId
       from billing_subscription_transitions
       inner join billing_subscriptions
         on billing_subscriptions.id = billing_subscription_transitions.billing_subscription_id
       inner join billing_customers
         on billing_customers.id = billing_subscriptions.billing_customer_id
       inner join organization
         on organization.id = billing_subscription_transitions.organization_id
       where billing_subscription_transitions.id = ?
         and billing_subscription_transitions.state in (
           'pending',
           'action_required',
           'scheduled',
           'reconciliation_required'
         )
         and organization.personal_owner_user_id is not null
         and billing_customers.stripe_customer_id is not null
         and billing_subscriptions.stripe_subscription_id is not null`
    )
    .get(transitionId) as Omit<BillingTransitionConvergenceAuthority, 'expectedBillingRevision'> | undefined
  if (!row) return null
  return {
    ...row,
    expectedBillingRevision: billingReconciliationRevision(connection, row.userId)
  }
}

function markTimedOutBillingTransitionReconciliation(
  connection: DatabaseConnection,
  authority: BillingTransitionConvergenceAuthority,
  expectedTransitionRevision: number,
  reason: string,
  now: Date
): boolean {
  return connection.sqlite
    .transaction(() => {
      if (billingReconciliationRevision(connection, authority.userId) !== authority.expectedBillingRevision) {
        return false
      }
      const transition = connection.sqlite
        .prepare(
          `update billing_subscription_transitions
           set state = 'reconciliation_required', state_reason = ?,
               revision = revision + 1, updated_at = ?
           where id = ? and revision = ? and state = 'pending'`
        )
        .run(reason, now.toISOString(), authority.transitionId, expectedTransitionRevision)
      if (transition.changes !== 1) return false

      const subscription = connection.sqlite
        .prepare(
          `update billing_subscriptions
           set reconciliation_required = 1, reconciliation_reason = ?,
               revision = revision + 1, updated_at = ?
           where id = ? and stripe_subscription_id = ?`
        )
        .run(reason, now.toISOString(), authority.billingSubscriptionId, authority.stripeSubscriptionId)
      if (subscription.changes !== 1) {
        throw new Error('Billing transition subscription changed during reconciliation')
      }
      return true
    })
    .immediate()
}
