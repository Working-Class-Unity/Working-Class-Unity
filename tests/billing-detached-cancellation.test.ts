import type Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import { createStripeBillingCatalog } from '../server/services/payments/billing-catalog'
import {
  billingDetachedSubscriptionCancellationJobType,
  billingDetachedSubscriptionCancellationMaxAttempts,
  createBillingDetachedSubscriptionCancellationHandler,
  ensureBillingDetachedSubscriptionCancellationJobs
} from '../server/services/payments/billing-detached-subscription-cancellation'
import { applyStripeEventObservation } from '../server/services/payments/billing-event-store'
import type { CurrentBillingProjection } from '../server/services/payments/billing-projection'
import type { StripeBillingClient } from '../server/services/payments/stripe-client'
import {
  createWorkspaceInvitationFixture,
  type WorkspaceInvitationFixture
} from './helpers/workspace-invitation-fixture'

describe('detached late Checkout cancellation', () => {
  it('retains no identity in the job and converges a lost no-refund cancellation response by exact retrieval', async () => {
    const fixture = createWorkspaceInvitationFixture()
    seedDetachedAttempt(fixture, 'detached_attempt_late', 'billing_attempt_late')
    const subscription = stripeSubscription('sub_late_checkout', 'cus_late_checkout', 'active', 'billing_attempt_late')
    const session = checkoutSession('cs_late_checkout', 'billing_attempt_late', subscription)

    try {
      expect(
        applyStripeEventObservation(fixture.connection, {
          eventId: 'evt_late_checkout',
          eventType: 'checkout.session.completed',
          eventCreatedAt: 1_785_000_000,
          objectId: session.id,
          catalog: createStripeBillingCatalog(fixture.config.stripe),
          attemptId: 'billing_attempt_late',
          stripeCustomerId: 'cus_late_checkout',
          stripeSessionId: session.id,
          checkoutState: 'completed',
          projection: projection(subscription),
          reconciliationReason: null,
          providerState: {
            kind: 'checkout',
            session,
            subscription,
            schedule: null,
            checkoutOffering: 'personal.monthly'
          }
        })
      ).toEqual({ duplicate: false, target: 'detached' })

      const subject = fixture.sqlite
        .prepare(
          `select id, provider_reference as providerReference,
                  provider_customer_reference as customerId, provider_status as status
           from detached_billing_subjects
           where provider_reference = 'sub_late_checkout'`
        )
        .get() as {
        id: string
        providerReference: string
        customerId: string
        status: string
      }
      expect(subject).toMatchObject({
        providerReference: 'sub_late_checkout',
        customerId: 'cus_late_checkout',
        status: 'active'
      })

      const job = fixture.sqlite
        .prepare('select type, payload, max_attempts as maxAttempts from job_queue where type = ?')
        .get(billingDetachedSubscriptionCancellationJobType) as {
        type: string
        payload: string
        maxAttempts: number
      }
      expect(job).toEqual({
        type: billingDetachedSubscriptionCancellationJobType,
        payload: JSON.stringify({ subjectId: subject.id }),
        maxAttempts: billingDetachedSubscriptionCancellationMaxAttempts
      })

      const cancel = vi.fn(async () => {
        throw new Error('lost Stripe cancellation response')
      })
      const retrieve = vi
        .fn()
        .mockResolvedValueOnce(
          stripeSubscription('sub_late_checkout', 'cus_late_checkout', 'active', 'billing_attempt_late')
        )
        .mockResolvedValue(
          stripeSubscription('sub_late_checkout', 'cus_late_checkout', 'canceled', 'billing_attempt_late')
        )
      const handler = createBillingDetachedSubscriptionCancellationHandler(fixture.connection, () => {
        return { subscriptions: { cancel, retrieve } } as unknown as StripeBillingClient
      })

      await expect(handler({ subjectId: subject.id })).resolves.toBeUndefined()
      await expect(handler({ subjectId: subject.id })).resolves.toBeUndefined()
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(cancel).toHaveBeenCalledWith(
        'sub_late_checkout',
        { invoice_now: false, prorate: false },
        { idempotencyKey: `billing-detached-cancellation:${subject.id}` }
      )
      expect(retrieve).toHaveBeenCalledTimes(2)
      expect(retrieve).toHaveBeenCalledWith('sub_late_checkout')
      expect(
        fixture.sqlite
          .prepare('select provider_status as status from detached_billing_subjects where id = ?')
          .get(subject.id)
      ).toEqual({ status: 'canceled' })
    } finally {
      fixture.cleanup()
    }
  })

  it('regenerates one bounded job for a nonterminal detached subscription and fails closed on identity mismatch', async () => {
    const fixture = createWorkspaceInvitationFixture()
    seedDetachedSubscription(fixture, {
      id: 'detached_subscription_retry',
      subscriptionId: 'sub_detached_retry',
      customerId: 'cus_detached_retry',
      status: 'active'
    })
    const now = new Date('2026-07-28T12:00:00.000Z')

    try {
      expect(ensureBillingDetachedSubscriptionCancellationJobs(fixture.connection, now)).toBe(1)
      expect(ensureBillingDetachedSubscriptionCancellationJobs(fixture.connection, now)).toBe(0)

      const cancel = vi.fn(async () => stripeSubscription('sub_detached_retry', 'cus_detached_retry', 'canceled', null))
      const retrieve = vi.fn(async () => stripeSubscription('sub_detached_retry', 'cus_different', 'canceled', null))
      const handler = createBillingDetachedSubscriptionCancellationHandler(fixture.connection, () => {
        return { subscriptions: { cancel, retrieve } } as unknown as StripeBillingClient
      })

      await expect(handler({ subjectId: 'detached_subscription_retry' })).rejects.toThrow(
        'Detached Stripe cancellation is not confirmed'
      )
      expect(cancel).not.toHaveBeenCalled()
      expect(
        fixture.sqlite
          .prepare('select provider_status as status from detached_billing_subjects where id = ?')
          .get('detached_subscription_retry')
      ).toEqual({ status: 'active' })
    } finally {
      fixture.cleanup()
    }
  })
})

function seedDetachedAttempt(fixture: WorkspaceInvitationFixture, id: string, attemptId: string) {
  const now = new Date().toISOString()
  fixture.sqlite
    .prepare(
      `insert into detached_billing_subjects (
         id, provider, provider_reference, provider_customer_reference, provider_status,
         provider_status_expires_at, provider_event_created_at, status_updated_at, deleted_at,
         retention_purpose, retention_policy, purge_after
       ) values (?, 'stripe', ?, null, 'checkout_open', null, null, ?, ?,
                 'external_billing_reconciliation', 'stripe_billing_lifecycle', null)`
    )
    .run(id, `attempt:${attemptId}`, now, now)
}

function seedDetachedSubscription(
  fixture: WorkspaceInvitationFixture,
  input: Readonly<{
    id: string
    subscriptionId: string
    customerId: string
    status: string
  }>
) {
  const now = new Date().toISOString()
  fixture.sqlite
    .prepare(
      `insert into detached_billing_subjects (
         id, provider, provider_reference, provider_customer_reference, provider_status,
         provider_status_expires_at, provider_event_created_at, status_updated_at, deleted_at,
         retention_purpose, retention_policy, purge_after
       ) values (?, 'stripe', ?, ?, ?, null, null, ?, ?,
                 'external_billing_reconciliation', 'stripe_billing_lifecycle', null)`
    )
    .run(input.id, input.subscriptionId, input.customerId, input.status, now, now)
}

function checkoutSession(id: string, attemptId: string, subscription: Stripe.Subscription): Stripe.Checkout.Session {
  return {
    id,
    object: 'checkout.session',
    mode: 'subscription',
    status: 'complete',
    payment_status: 'paid',
    client_reference_id: attemptId,
    metadata: { billing_attempt_id: attemptId },
    customer: subscription.customer,
    subscription: subscription.id
  } as Stripe.Checkout.Session
}

function stripeSubscription(
  id: string,
  customer: string,
  status: Stripe.Subscription.Status,
  attemptId: string | null
): Stripe.Subscription {
  return {
    id,
    object: 'subscription',
    customer,
    status,
    metadata: attemptId ? { billing_attempt_id: attemptId } : {}
  } as Stripe.Subscription
}

function projection(subscription: Stripe.Subscription): CurrentBillingProjection {
  return {
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionItemId: 'si_late_checkout',
    status: subscription.status,
    planKey: 'personal',
    cadence: 'monthly',
    stripePriceId: 'price_personal_monthly',
    currentPeriodStart: '2026-07-01T00:00:00.000Z',
    currentPeriodEnd: '2026-08-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    reconciliationRequired: false,
    reconciliationReason: null
  }
}
