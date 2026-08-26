import type Stripe from 'stripe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  billingDetachedSubscriptionCancellationJobType,
  billingDetachedSubscriptionCancellationMaxAttempts,
  createBillingDetachedSubscriptionCancellationHandler,
  ensureBillingDetachedSubscriptionCancellationJobs
} from '../../server/services/payments/stripe/detached-subscription-cancellation'
import { ensureBillingStripeJobs } from '../../server/services/payments/stripe/jobs'
import {
  createBillingStripeRuntimeFixture,
  seedBillingCustomer,
  seedBillingSubscription,
  seedDetachedSubject,
  type BillingStripeRuntimeFixture
} from './runtime-fixture'

const fixtures: BillingStripeRuntimeFixture[] = []
const now = new Date('2026-07-15T12:00:00.000Z')

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.sqlite.close()
})

describe('Billing Stripe durable jobs', () => {
  it('ensures missing safety coverage for detached subjects, transitions, and active subscriptions', () => {
    const fixture = runtimeFixture('ensure')
    seedBillingCustomer(fixture)
    seedBillingSubscription(fixture)
    seedDetachedSubject(fixture, {
      providerReference: 'sub_detached_ensure',
      customerReference: 'cus_detached_ensure',
      status: 'active'
    })
    insertTransition(fixture)

    expect(ensureBillingStripeJobs(fixture.connection, now)).toEqual({
      accountDeletionCancellation: 0,
      detachedSubscriptionCancellation: 1,
      graceExpiry: 0,
      emailVerification: 0,
      webhookReconciliation: 0,
      reconciliationSafety: 'scheduled',
      transitionConvergence: 1,
      notificationDelivery: 0
    })
    expect(ensureBillingStripeJobs(fixture.connection, now)).toEqual({
      accountDeletionCancellation: 0,
      detachedSubscriptionCancellation: 0,
      graceExpiry: 0,
      emailVerification: 0,
      webhookReconciliation: 0,
      reconciliationSafety: 'covered-future',
      transitionConvergence: 0,
      notificationDelivery: 0
    })
    expect(
      fixture.sqlite.prepare(`select type, count(*) as count from job_queue group by type order by type`).all()
    ).toEqual([
      { type: 'billing.detached-subscription-cancellation', count: 1 },
      { type: 'billing.reconciliation-safety', count: 1 },
      { type: 'billing.transition-convergence', count: 1 }
    ])
  })

  it('cancels and confirms an exact detached subscription with stable idempotency', async () => {
    const fixture = runtimeFixture('detached_cancel')
    const subjectId = seedDetachedSubject(fixture, {
      providerReference: 'sub_detached_cancel',
      customerReference: 'cus_detached_cancel',
      status: 'active'
    })
    const retrieve = vi
      .fn()
      .mockResolvedValueOnce(detachedSubscription('active'))
      .mockResolvedValueOnce(detachedSubscription('canceled'))
    expect(ensureBillingDetachedSubscriptionCancellationJobs(fixture.connection, now)).toBe(1)
    expect(ensureBillingDetachedSubscriptionCancellationJobs(fixture.connection, now)).toBe(0)
    expect(
      fixture.sqlite
        .prepare('select payload, max_attempts as maxAttempts from job_queue where type = ?')
        .get(billingDetachedSubscriptionCancellationJobType)
    ).toEqual({
      payload: JSON.stringify({ subjectId }),
      maxAttempts: billingDetachedSubscriptionCancellationMaxAttempts
    })
    const cancel = vi.fn(async () => {
      throw new Error('lost Stripe cancellation response')
    })
    const handler = createBillingDetachedSubscriptionCancellationHandler(
      fixture.connection,
      () => ({ subscriptions: { retrieve, cancel } }) as never,
      () => now
    )

    await handler({ subjectId })
    await handler({ subjectId })
    expect(cancel).toHaveBeenCalledWith(
      'sub_detached_cancel',
      { invoice_now: false, prorate: false },
      { idempotencyKey: `billing-detached-cancellation:${subjectId}` }
    )
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(retrieve).toHaveBeenCalledTimes(2)
    expect(
      fixture.sqlite
        .prepare(
          `select provider_status as status, status_updated_at as updatedAt
       from detached_billing_subjects where id = ?`
        )
        .get(subjectId)
    ).toEqual({ status: 'canceled', updatedAt: now.toISOString() })
  })

  it('does not cancel a detached reference when the exact provider customer differs', async () => {
    const fixture = runtimeFixture('detached_mismatch')
    const subjectId = seedDetachedSubject(fixture, {
      providerReference: 'sub_detached_cancel',
      customerReference: 'cus_detached_cancel',
      status: 'active'
    })
    const cancel = vi.fn()
    expect(ensureBillingDetachedSubscriptionCancellationJobs(fixture.connection, now)).toBe(1)
    expect(ensureBillingDetachedSubscriptionCancellationJobs(fixture.connection, now)).toBe(0)
    fixture.sqlite
      .prepare(
        `update job_queue set attempts = max_attempts
       where type = ? and json_extract(payload, '$.subjectId') = ?`
      )
      .run(billingDetachedSubscriptionCancellationJobType, subjectId)
    expect(ensureBillingDetachedSubscriptionCancellationJobs(fixture.connection, now)).toBe(1)
    expect(ensureBillingDetachedSubscriptionCancellationJobs(fixture.connection, now)).toBe(0)
    expect(
      fixture.sqlite
        .prepare(`select attempts from job_queue where type = ? order by id`)
        .all(billingDetachedSubscriptionCancellationJobType)
    ).toEqual([{ attempts: billingDetachedSubscriptionCancellationMaxAttempts }, { attempts: 0 }])
    const handler = createBillingDetachedSubscriptionCancellationHandler(
      fixture.connection,
      () =>
        ({
          subscriptions: {
            retrieve: vi.fn(async () => ({
              ...detachedSubscription('active'),
              customer: 'cus_other'
            })),
            cancel
          }
        }) as never,
      () => now
    )

    await expect(handler({ subjectId })).rejects.toThrow('Detached Stripe cancellation is not confirmed')
    expect(cancel).not.toHaveBeenCalled()
    expect(
      fixture.sqlite
        .prepare(`select provider_status as status from detached_billing_subjects where id = ?`)
        .get(subjectId)
    ).toEqual({ status: 'active' })
  })
})

function runtimeFixture(suffix: string): BillingStripeRuntimeFixture {
  const fixture = createBillingStripeRuntimeFixture(`purchaser_jobs_${suffix}`)
  fixtures.push(fixture)
  return fixture
}

function insertTransition(fixture: BillingStripeRuntimeFixture): void {
  fixture.sqlite
    .prepare(
      `insert into billing_subscription_transitions (
       id, purchaser_user_id, billing_subscription_id, kind, source_plan_key, source_cadence,
       target_plan_key, target_cadence, effective_at, idempotency_key,
       captured_billing_revision, state, revision, updated_at
     ) values ('transition_jobs', ?, ?, 'cadence_change', 'family', 'monthly',
               'family', 'annual', '2026-08-01T00:00:00.000Z', 'transition_jobs_idempotency',
               0, 'pending', 0, '2026-07-15T11:00:00.000Z')`
    )
    .run(fixture.purchaserUserId, `billing_subscription_${fixture.purchaserUserId}`)
}

function detachedSubscription(status: 'active' | 'canceled'): Stripe.Subscription {
  return {
    id: 'sub_detached_cancel',
    object: 'subscription',
    customer: 'cus_detached_cancel',
    status
  } as Stripe.Subscription
}
