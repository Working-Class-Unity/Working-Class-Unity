import type { JobHandler, JobPayload } from '../../jobs/job-queue'
import { z } from 'zod'
import { createStripeBillingCatalog } from './catalog'
import type { BillingStripeRuntimeConfiguration } from './configuration'
import { applyBillingStripeTransitionConvergence } from './event-store'
import type { BillingStripeConnection, BillingStripeIntegration } from './public-contract'
import {
  getBillingCustomerForPurchaser,
  getBillingSubscriptionForPurchaser,
  getBillingTransitionById,
  getOpenCheckoutAttempt,
  isBillingDeletionPending
} from './repository'
import { commitBillingProjectionInTransaction } from './state-store'
import type { StripeBillingClient } from './stripe-client'
import { transitionConvergenceEventType } from './webhook-lifecycle'
import { readExactStripeSubscriptionState } from './webhook-state'

export const billingTransitionConvergenceJobType = 'billing.transition-convergence' as const
export const billingTransitionConvergenceMaxAttempts = 12
export const billingTransitionConvergenceSafetyLimit = 25
export const billingTransitionPendingRecoveryDelayMs = 5 * 60 * 1_000

const payloadSchema = z.object({ transitionId: z.string().trim().min(1).max(128) }).strict()

type TransitionAuthority = Readonly<{
  transitionId: string
  purchaserUserId: string
  billingSubscriptionId: string
  stripeCustomerId: string
  stripeSubscriptionId: string
  stripeSubscriptionScheduleId: string | null
  transitionRevision: number
  billingRevision: number
  state: 'pending' | 'action_required' | 'scheduled' | 'reconciliation_required'
  updatedAt: string
}>

export function enqueueBillingTransitionConvergenceJob(
  connection: BillingStripeConnection,
  transitionId: string,
  runAfter: Date,
  now = new Date()
): boolean {
  if (!transitionId || !Number.isFinite(runAfter.getTime()) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Invalid Billing transition convergence job')
  }
  const payload = JSON.stringify({ transitionId })
  const inserted = connection.sqlite
    .prepare(
      `insert into job_queue (type, payload, max_attempts, run_after, created_at, updated_at)
       select ?, ?, ?, ?, ?, ? where not exists (
         select 1 from job_queue where type = ? and status in ('queued', 'running')
           and attempts < max_attempts and json_valid(payload)
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
  connection: BillingStripeConnection,
  now = new Date(),
  limit = billingTransitionConvergenceSafetyLimit
): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > billingTransitionConvergenceSafetyLimit) {
    throw new TypeError('Invalid Billing transition convergence safety limit')
  }
  return connection.sqlite
    .transaction(() => {
      const rows = connection.sqlite
        .prepare(
          `select transition_row.id, transition_row.state, transition_row.updated_at as updatedAt,
                case transition_row.state
                  when 'scheduled' then transition_row.effective_at
                  when 'action_required' then transition_row.stripe_pending_update_expires_at
                  else null end as runAfter
         from billing_subscription_transitions transition_row
         where transition_row.state in ('pending', 'action_required', 'scheduled', 'reconciliation_required')
           and (transition_row.state in ('pending', 'reconciliation_required') or
                case transition_row.state when 'scheduled' then transition_row.effective_at
                  else transition_row.stripe_pending_update_expires_at end is not null)
           and not exists (
             select 1 from job_queue job where job.type = ? and job.status in ('queued', 'running')
               and job.attempts < job.max_attempts and json_valid(job.payload)
               and json_extract(job.payload, '$.transitionId') = transition_row.id
               and json_remove(job.payload, '$.transitionId') = '{}'
           )
         order by coalesce(runAfter, transition_row.updated_at), transition_row.id limit ?`
        )
        .all(billingTransitionConvergenceJobType, limit) as Array<{
        id: string
        state: TransitionAuthority['state']
        updatedAt: string
        runAfter: string | null
      }>
      let scheduled = 0
      for (const row of rows) {
        const runAfterMs =
          row.state === 'pending'
            ? Date.parse(row.updatedAt) + billingTransitionPendingRecoveryDelayMs
            : row.runAfter
              ? Date.parse(row.runAfter)
              : now.getTime()
        if (
          Number.isFinite(runAfterMs) &&
          enqueueBillingTransitionConvergenceJob(connection, row.id, new Date(runAfterMs), now)
        )
          scheduled += 1
      }
      return scheduled
    })
    .immediate()
}

export function createBillingTransitionConvergenceHandler(
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
    const parsed = payloadSchema.safeParse(payload)
    if (!parsed.success) throw new Error('Invalid Billing transition convergence payload')
    const authority = readAuthority(context.connection, parsed.data.transitionId)
    if (!authority) return

    const provider = await readExactStripeSubscriptionState(
      context.client,
      catalog,
      authority.stripeCustomerId,
      authority.stripeSubscriptionId,
      authority.stripeSubscriptionScheduleId
    )
    const observedAt = context.now?.() ?? new Date()
    const transition = getBillingTransitionById(context.connection, authority.transitionId)
    if (!transition || transition.revision !== authority.transitionRevision) {
      throw new Error('Billing transition authority changed before convergence')
    }
    const eventType = transitionConvergenceEventType(
      transition,
      provider.projection,
      provider.subscription,
      provider.schedule,
      observedAt
    )
    const applied = applyBillingStripeTransitionConvergence(context.connection, context.integration, {
      purchaserUserId: authority.purchaserUserId,
      transitionId: authority.transitionId,
      expectedTransitionRevision: authority.transitionRevision,
      expectedBillingRevision: authority.billingRevision,
      now: observedAt,
      observation: {
        eventId: `transition-convergence:${authority.transitionId}`,
        eventType,
        eventCreatedAt: Math.floor(observedAt.getTime() / 1_000),
        objectId:
          eventType.startsWith('subscription_schedule.') && provider.schedule
            ? provider.schedule.id
            : (provider.subscription?.id ?? authority.stripeSubscriptionId),
        catalog,
        attemptId: null,
        stripeCustomerId: authority.stripeCustomerId,
        stripeSessionId: null,
        checkoutState: null,
        projection: provider.projection,
        reconciliationReason: provider.projection.reconciliationReason,
        providerState: {
          kind: 'subscription',
          subscription: provider.subscription,
          schedule: provider.schedule
        }
      }
    })
    if (!applied) throw new Error('Billing transition authority changed during convergence')

    const current = getBillingTransitionById(context.connection, authority.transitionId)
    if (!current) return
    if (current.state === 'reconciliation_required') {
      throw new Error('Billing transition requires further reconciliation')
    }
    if (current.state === 'pending') {
      const updatedAt = Date.parse(current.updatedAt)
      if (Number.isFinite(updatedAt) && observedAt.getTime() - updatedAt >= billingTransitionPendingRecoveryDelayMs) {
        markTimedOutTransition(context.connection, context.integration, current.id, observedAt)
        throw new Error('Billing transition requires further reconciliation')
      }
      throw new Error('Billing transition provider operation is still pending')
    }
    if (current.state === 'action_required') {
      const expiresAt = Date.parse(current.stripePendingUpdateExpiresAt ?? '')
      if (Number.isFinite(expiresAt) && expiresAt > observedAt.getTime()) return
      throw new Error('Billing transition has not converged')
    }
    if (current.state === 'scheduled') {
      const effectiveAt = Date.parse(current.effectiveAt ?? '')
      if (Number.isFinite(effectiveAt) && effectiveAt > observedAt.getTime()) return
      throw new Error('Billing transition has not converged')
    }
  }
}

function readAuthority(connection: BillingStripeConnection, transitionId: string): TransitionAuthority | null {
  const row = connection.sqlite
    .prepare(
      `select transition_row.id as transitionId,
              transition_row.purchaser_user_id as purchaserUserId,
              transition_row.billing_subscription_id as billingSubscriptionId,
              transition_row.stripe_subscription_schedule_id as stripeSubscriptionScheduleId,
              transition_row.revision as transitionRevision,
              transition_row.state, transition_row.updated_at as updatedAt,
              subscription.revision as billingRevision,
              subscription.stripe_subscription_id as stripeSubscriptionId,
              customer.stripe_customer_id as stripeCustomerId
       from billing_subscription_transitions transition_row
       inner join billing_subscriptions subscription on subscription.id = transition_row.billing_subscription_id
       inner join billing_customers customer on customer.id = subscription.billing_customer_id
       where transition_row.id = ?
         and transition_row.state in ('pending', 'action_required', 'scheduled', 'reconciliation_required')
         and subscription.stripe_subscription_id is not null`
    )
    .get(transitionId) as TransitionAuthority | undefined
  if (
    !row ||
    isBillingDeletionPending(connection, row.purchaserUserId) ||
    getOpenCheckoutAttempt(connection, row.purchaserUserId)
  )
    return null
  return row
}

function markTimedOutTransition(
  connection: BillingStripeConnection,
  integration: BillingStripeIntegration<BillingStripeConnection, unknown> | undefined,
  transitionId: string,
  now: Date
): void {
  connection.sqlite
    .transaction(() => {
      const transition = getBillingTransitionById(connection, transitionId)
      if (
        !transition ||
        transition.state !== 'pending' ||
        isBillingDeletionPending(connection, transition.purchaserUserId) ||
        getOpenCheckoutAttempt(connection, transition.purchaserUserId)
      )
        return
      const customer = getBillingCustomerForPurchaser(connection, transition.purchaserUserId)
      const subscription = getBillingSubscriptionForPurchaser(connection, transition.purchaserUserId)
      if (!customer || !subscription || subscription.id !== transition.billingSubscriptionId) return
      const updated = connection.sqlite
        .prepare(
          `update billing_subscription_transitions
         set state = 'reconciliation_required', state_reason = 'transition_provider_operation_incomplete',
             revision = revision + 1, updated_at = ?
         where id = ? and revision = ? and state = 'pending'`
        )
        .run(now.toISOString(), transition.id, transition.revision)
      if (updated.changes !== 1) return
      const committedTransition = getBillingTransitionById(connection, transition.id)!
      const result = commitBillingProjectionInTransaction(connection, integration, {
        purchaserUserId: transition.purchaserUserId,
        stripeCustomerId: customer.stripeCustomerId,
        expectedRevision: subscription.revision,
        projection: {
          stripeSubscriptionId: subscription.stripeSubscriptionId,
          stripeSubscriptionItemId: subscription.stripeSubscriptionItemId,
          status: subscription.status,
          planKey: subscription.planKey,
          cadence: subscription.cadence,
          stripePriceId: subscription.stripePriceId,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          reconciliationRequired: true,
          reconciliationReason: 'transition_provider_operation_incomplete',
          graceInvoiceId: subscription.graceInvoiceId,
          graceStartedAt: subscription.graceStartedAt,
          graceEndsAt: subscription.graceEndsAt
        },
        cause: 'transition_convergence',
        verifiedAt: now,
        projectionOrderMs: subscription.projectionOrderMs,
        projectionEventId: subscription.projectionEventId,
        transition: {
          id: committedTransition.id,
          kind: committedTransition.kind,
          sourceOffering: `${committedTransition.sourcePlanKey}.${committedTransition.sourceCadence}`,
          targetOffering: `${committedTransition.targetPlanKey}.${committedTransition.targetCadence}`,
          state: committedTransition.state,
          effectiveAt: committedTransition.effectiveAt
        }
      })
      if (result.outcome !== 'applied') throw new Error('Billing transition timeout state changed')
    })
    .immediate()
}
