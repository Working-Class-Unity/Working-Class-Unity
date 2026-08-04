import type Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import { hashBillingFamilyLifecycleEpisodeKey } from '../server/services/payments/billing-family-lifecycle-signal'
import { getBillingStateForConnection } from '../server/services/payments/billing-service'
import { processStripeWebhookEventForConnection } from '../server/services/payments/billing-webhook'
import {
  billingWebhookReconciliationJobType,
  enqueueBillingWebhookReconciliation,
  ensureBillingWebhookReconciliationJobs
} from '../server/services/payments/billing-webhook-reference'
import type { StripeBillingClient } from '../server/services/payments/stripe-client'
import type { AppRuntimeConfig } from '../server/utils/runtime'
import {
  createWorkspaceInvitationFixture,
  type SignedInFixtureUser,
  type WorkspaceInvitationFixture
} from './helpers/workspace-invitation-fixture'

const subscriptionDiscoveryReadCount = 7

describe('Stripe current-state webhook projection', () => {
  it.each(['checkout.session.completed', 'checkout.session.async_payment_succeeded'] as const)(
    'atomically associates %s and deduplicates concurrent delivery',
    async (eventType) => {
      const fixture = createWorkspaceInvitationFixture()
      const owner = await fixture.signIn('webhook-checkout@example.test', 'Webhook Checkout')
      seedCheckoutAttempt(fixture, owner, 'billing_attempt_checkout')
      const provider = subscriptionProvider([
        [checkoutSubscription('sub_checkout', 'cus_checkout')],
        [checkoutSubscription('sub_checkout', 'cus_checkout')]
      ])
      const event = stripeEvent('evt_checkout_complete', 200, eventType, {
        id: 'cs_checkout',
        mode: 'subscription',
        status: 'complete',
        client_reference_id: 'billing_attempt_checkout',
        customer: 'cus_checkout',
        metadata: { billing_attempt_id: 'billing_attempt_checkout' }
      })

      try {
        const results = await Promise.all([
          processStripeWebhookEventForConnection(fixture.connection, provider.client, config(), event),
          processStripeWebhookEventForConnection(fixture.connection, provider.client, config(), event)
        ])

        expect(results.map((result) => result.duplicate).sort()).toEqual([false, true])
        expect(count(fixture, 'billing_events')).toBe(1)
        expect(count(fixture, 'billing_customers')).toBe(1)
        expect(count(fixture, 'billing_subscriptions')).toBe(1)
        expect(
          fixture.sqlite
            .prepare(
              `select state, stripe_session_id as stripeSessionId,
                    billing_customer_id as billingCustomerId
             from billing_checkout_attempts where id = ?`
            )
            .get('billing_attempt_checkout')
        ).toEqual({
          state: 'completed',
          stripeSessionId: 'cs_checkout',
          billingCustomerId: expect.stringMatching(/^billing_customer_/)
        })
        expect(getBillingStateForConnection(fixture.connection, owner.user.id).entitlement).toEqual({
          granted: true,
          source: 'manager',
          state: 'active',
          plan: 'family',
          cadence: 'monthly'
        })
      } finally {
        fixture.cleanup()
      }
    }
  )

  it('fails closed when completed Checkout payment is still unpaid despite an active subscription', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-checkout-unpaid@example.test', 'Webhook Checkout Unpaid')
    seedCheckoutAttempt(fixture, owner, 'billing_attempt_checkout_unpaid')
    const provider = subscriptionProvider([[checkoutSubscription('sub_checkout_unpaid', 'cus_checkout_unpaid')]])
    const event = stripeEvent('evt_checkout_unpaid', 225, 'checkout.session.completed', {
      id: 'cs_checkout_unpaid',
      mode: 'subscription',
      status: 'complete',
      payment_status: 'unpaid',
      client_reference_id: 'billing_attempt_checkout_unpaid',
      customer: 'cus_checkout_unpaid',
      metadata: { billing_attempt_id: 'billing_attempt_checkout_unpaid' }
    })

    try {
      await expect(
        processStripeWebhookEventForConnection(fixture.connection, provider.client, config(), event)
      ).resolves.toEqual({ duplicate: false, target: 'live' })
      expect(
        fixture.sqlite
          .prepare('select state from billing_checkout_attempts where id = ?')
          .get('billing_attempt_checkout_unpaid')
      ).toEqual({ state: 'reconciliation_required' })
      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'active',
        reconciliation_required: 1
      })
      expect(getBillingStateForConnection(fixture.connection, owner.user.id).entitlement.granted).toBe(false)
      expect(count(fixture, 'billing_events')).toBe(1)
    } finally {
      fixture.cleanup()
    }
  })

  it('fails closed when asynchronous Checkout success lacks an expanded paid initial invoice', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-checkout-no-invoice@example.test', 'Webhook Checkout No Invoice')
    seedCheckoutAttempt(fixture, owner, 'billing_attempt_checkout_no_invoice')
    const provider = subscriptionProvider([
      [stripeSubscription('sub_checkout_no_invoice', 'cus_checkout_no_invoice', 'active')]
    ])
    const event = stripeEvent('evt_checkout_no_invoice', 226, 'checkout.session.async_payment_succeeded', {
      id: 'cs_checkout_no_invoice',
      mode: 'subscription',
      status: 'complete',
      payment_status: 'paid',
      client_reference_id: 'billing_attempt_checkout_no_invoice',
      customer: 'cus_checkout_no_invoice',
      metadata: { billing_attempt_id: 'billing_attempt_checkout_no_invoice' }
    })

    try {
      await expect(
        processStripeWebhookEventForConnection(fixture.connection, provider.client, config(), event)
      ).resolves.toEqual({ duplicate: false, target: 'live' })
      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'active',
        reconciliation_required: 1
      })
      expect(getBillingStateForConnection(fixture.connection, owner.user.id).entitlement.granted).toBe(false)
      expect(count(fixture, 'billing_events')).toBe(1)
    } finally {
      fixture.cleanup()
    }
  })

  it('fails closed when asynchronous Checkout success has a paid invoice for another subscription', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-checkout-wrong-invoice@example.test', 'Webhook Checkout Wrong Invoice')
    seedCheckoutAttempt(fixture, owner, 'billing_attempt_checkout_wrong_invoice')
    const subscription = checkoutSubscription('sub_checkout_wrong_invoice', 'cus_checkout_wrong_invoice')
    subscription.latest_invoice = initialInvoice(
      'in_checkout_wrong_invoice',
      'cus_checkout_wrong_invoice',
      'sub_other',
      'paid'
    )
    const provider = subscriptionProvider([[subscription]])
    const event = stripeEvent('evt_checkout_wrong_invoice', 227, 'checkout.session.async_payment_succeeded', {
      id: 'cs_checkout_wrong_invoice',
      mode: 'subscription',
      status: 'complete',
      payment_status: 'paid',
      client_reference_id: 'billing_attempt_checkout_wrong_invoice',
      customer: 'cus_checkout_wrong_invoice',
      metadata: { billing_attempt_id: 'billing_attempt_checkout_wrong_invoice' }
    })

    try {
      await expect(
        processStripeWebhookEventForConnection(fixture.connection, provider.client, config(), event)
      ).resolves.toEqual({ duplicate: false, target: 'live' })
      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'active',
        reconciliation_required: 1
      })
      expect(getBillingStateForConnection(fixture.connection, owner.user.id).entitlement.granted).toBe(false)
    } finally {
      fixture.cleanup()
    }
  })

  it('does not grant an active subscription reported after asynchronous Checkout payment failure', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-checkout-failed-active@example.test', 'Webhook Checkout Failed Active')
    seedCheckoutAttempt(fixture, owner, 'billing_attempt_checkout_failed_active')
    const subscription = stripeSubscription('sub_checkout_failed_active', 'cus_checkout_failed_active', 'active')
    subscription.latest_invoice = initialInvoice(
      'in_checkout_failed_active',
      'cus_checkout_failed_active',
      'sub_checkout_failed_active',
      'void'
    )
    const provider = subscriptionProvider([[subscription]])
    const event = stripeEvent('evt_checkout_failed_active', 228, 'checkout.session.async_payment_failed', {
      id: 'cs_checkout_failed_active',
      mode: 'subscription',
      status: 'complete',
      payment_status: 'unpaid',
      client_reference_id: 'billing_attempt_checkout_failed_active',
      customer: 'cus_checkout_failed_active',
      metadata: { billing_attempt_id: 'billing_attempt_checkout_failed_active' }
    })

    try {
      await expect(
        processStripeWebhookEventForConnection(fixture.connection, provider.client, config(), event)
      ).resolves.toEqual({ duplicate: false, target: 'live' })
      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'active',
        reconciliation_required: 1
      })
      expect(getBillingStateForConnection(fixture.connection, owner.user.id).entitlement.granted).toBe(false)
      expect(count(fixture, 'billing_events')).toBe(1)
    } finally {
      fixture.cleanup()
    }
  })

  it('completes the correlated attempt when a subscription event arrives before Checkout completion', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-subscription-first@example.test', 'Webhook Subscription First')
    seedCheckoutAttempt(fixture, owner, 'billing_attempt_subscription_first')
    const provider = subscriptionProvider([[checkoutSubscription('sub_subscription_first', 'cus_subscription_first')]])
    const event = stripeEvent('evt_subscription_first', 250, 'customer.subscription.created', {
      id: 'sub_subscription_first',
      customer: 'cus_subscription_first',
      metadata: { billing_attempt_id: 'billing_attempt_subscription_first' }
    })

    try {
      await expect(
        processStripeWebhookEventForConnection(fixture.connection, provider.client, config(), event)
      ).resolves.toEqual({ duplicate: false, target: 'live' })
      expect(
        fixture.sqlite
          .prepare('select state from billing_checkout_attempts where id = ?')
          .get('billing_attempt_subscription_first')
      ).toEqual({ state: 'completed' })
      expect(getBillingStateForConnection(fixture.connection, owner.user.id).entitlement.granted).toBe(true)
    } finally {
      fixture.cleanup()
    }
  })

  it('fails closed when a correlated subscription event precedes paid initial-invoice evidence', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-subscription-unpaid@example.test', 'Webhook Subscription Unpaid')
    seedCheckoutAttempt(fixture, owner, 'billing_attempt_subscription_unpaid')
    const provider = subscriptionProvider([
      [stripeSubscription('sub_subscription_unpaid', 'cus_subscription_unpaid', 'active')]
    ])
    const event = stripeEvent('evt_subscription_unpaid', 251, 'customer.subscription.created', {
      id: 'sub_subscription_unpaid',
      customer: 'cus_subscription_unpaid',
      metadata: { billing_attempt_id: 'billing_attempt_subscription_unpaid' }
    })

    try {
      await expect(
        processStripeWebhookEventForConnection(fixture.connection, provider.client, config(), event)
      ).resolves.toEqual({ duplicate: false, target: 'live' })
      expect(
        fixture.sqlite
          .prepare('select state from billing_checkout_attempts where id = ?')
          .get('billing_attempt_subscription_unpaid')
      ).toEqual({ state: 'reconciliation_required' })
      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'active',
        reconciliation_required: 1,
        reconciliation_reason: 'checkout_initial_invoice_unverified'
      })
      expect(getBillingStateForConnection(fixture.connection, owner.user.id).entitlement.granted).toBe(false)
    } finally {
      fixture.cleanup()
    }
  })

  it('retains delayed billing evidence and fails closed when a newer Checkout is still open', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-late@example.test', 'Webhook Late')
    seedCheckoutAttempt(fixture, owner, 'billing_attempt_late', 'failed')
    seedCheckoutAttempt(fixture, owner, 'billing_attempt_newer')
    const provider = subscriptionProvider([[checkoutSubscription('sub_late', 'cus_late')]])
    const event = stripeEvent('evt_late', 275, 'customer.subscription.updated', {
      id: 'sub_late',
      customer: 'cus_late',
      metadata: { billing_attempt_id: 'billing_attempt_late' }
    })

    try {
      await expect(
        processStripeWebhookEventForConnection(fixture.connection, provider.client, config(), event)
      ).resolves.toEqual({ duplicate: false, target: 'live' })
      expect(fixture.sqlite.prepare('select id, state from billing_checkout_attempts order by id').all()).toEqual([
        { id: 'billing_attempt_late', state: 'completed' },
        { id: 'billing_attempt_newer', state: 'reconciliation_required' }
      ])
      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'active',
        reconciliation_required: 1,
        reconciliation_reason: 'overlapping_checkout_attempt'
      })
      expect(getBillingStateForConnection(fixture.connection, owner.user.id).entitlement.granted).toBe(false)
    } finally {
      fixture.cleanup()
    }
  })

  it('fails closed when an unattributed live subscription overlaps an open Checkout', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-unattributed@example.test', 'Webhook Unattributed')
    seedCustomer(fixture, owner, 'cus_unattributed')
    seedCheckoutAttempt(fixture, owner, 'billing_attempt_unattributed')
    const provider = subscriptionProvider([[stripeSubscription('sub_unattributed', 'cus_unattributed', 'active')]])
    const event = stripeEvent('evt_unattributed', 280, 'customer.subscription.created', {
      id: 'sub_unattributed',
      customer: 'cus_unattributed',
      metadata: {}
    })

    try {
      await expect(
        processStripeWebhookEventForConnection(fixture.connection, provider.client, config(), event)
      ).resolves.toEqual({ duplicate: false, target: 'live' })
      expect(
        fixture.sqlite
          .prepare('select state from billing_checkout_attempts where id = ?')
          .get('billing_attempt_unattributed')
      ).toEqual({ state: 'reconciliation_required' })
      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'active',
        reconciliation_required: 1,
        reconciliation_reason: 'overlapping_checkout_attempt'
      })
      expect(getBillingStateForConnection(fixture.connection, owner.user.id).entitlement.granted).toBe(false)
    } finally {
      fixture.cleanup()
    }
  })

  it('fails closed when Checkout reports completion without a current subscription', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-missing-sub@example.test', 'Webhook Missing Subscription')
    seedCheckoutAttempt(fixture, owner, 'billing_attempt_missing_sub')
    const provider = subscriptionProvider([[]])
    const event = stripeEvent('evt_missing_sub', 290, 'checkout.session.completed', {
      id: 'cs_missing_sub',
      mode: 'subscription',
      status: 'complete',
      client_reference_id: 'billing_attempt_missing_sub',
      customer: 'cus_missing_sub',
      metadata: { billing_attempt_id: 'billing_attempt_missing_sub' }
    })

    try {
      await processStripeWebhookEventForConnection(fixture.connection, provider.client, config(), event)
      expect(
        fixture.sqlite
          .prepare('select state from billing_checkout_attempts where id = ?')
          .get('billing_attempt_missing_sub')
      ).toEqual({ state: 'reconciliation_required' })
      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'ambiguous',
        reconciliation_required: 1,
        reconciliation_reason: 'checkout_completed_without_subscription'
      })
      expect(getBillingStateForConnection(fixture.connection, owner.user.id).entitlement.granted).toBe(false)
    } finally {
      fixture.cleanup()
    }
  })

  it('receipts malformed current state without trusting an uncorrelated Checkout reference', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-malformed@example.test', 'Webhook Malformed')
    seedCheckoutAttempt(fixture, owner, 'billing_attempt_malformed')
    const provider = subscriptionProvider([])

    try {
      for (const invalidEvent of [
        stripeEvent('', 291, 'customer.subscription.updated', {}),
        stripeEvent('evt_missing_type', 291, '' as Stripe.Event.Type, {}),
        stripeEvent('evt_fractional_created', 291.5, 'customer.subscription.updated', {}),
        stripeEvent('evt_negative_created', -1, 'customer.subscription.updated', {})
      ]) {
        await expect(
          processStripeWebhookEventForConnection(fixture.connection, provider.client, config(), invalidEvent)
        ).rejects.toMatchObject({ statusCode: 400 })
      }

      const malformedCheckout = stripeEvent('evt_malformed_checkout', 292, 'checkout.session.completed', {
        id: 'cs_malformed',
        mode: 'payment',
        status: 'complete',
        client_reference_id: 'billing_attempt_malformed',
        customer: 'cus_malformed'
      })
      await expect(
        processStripeWebhookEventForConnection(fixture.connection, provider.client, config(), malformedCheckout)
      ).resolves.toEqual({ duplicate: false, target: 'ignored' })

      expect(provider.list).not.toHaveBeenCalled()
      expect(
        fixture.sqlite
          .prepare('select state, stripe_session_id as stripeSessionId from billing_checkout_attempts where id = ?')
          .get('billing_attempt_malformed')
      ).toEqual({ state: 'pending', stripeSessionId: null })
      expect(count(fixture, 'billing_customers')).toBe(0)
      expect(count(fixture, 'billing_subscriptions')).toBe(0)
      expect(count(fixture, 'billing_events')).toBe(1)
    } finally {
      fixture.cleanup()
    }
  })

  it('marks a correlated subscription event with no customer for reconciliation', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-missing-customer@example.test', 'Webhook Missing Customer')
    seedCheckoutAttempt(fixture, owner, 'billing_attempt_missing_customer')
    const provider = subscriptionProvider([])
    const event = stripeEvent('evt_missing_customer', 293, 'customer.subscription.updated', {
      id: 'sub_missing_customer',
      customer: { malformed: true },
      metadata: { billing_attempt_id: 'billing_attempt_missing_customer' }
    })

    try {
      await expect(
        processStripeWebhookEventForConnection(fixture.connection, provider.client, config(), event)
      ).resolves.toEqual({ duplicate: false, target: 'live' })
      expect(provider.list).not.toHaveBeenCalled()
      expect(
        fixture.sqlite
          .prepare('select state from billing_checkout_attempts where id = ?')
          .get('billing_attempt_missing_customer')
      ).toEqual({ state: 'reconciliation_required' })
      expect(count(fixture, 'billing_customers')).toBe(0)
      expect(count(fixture, 'billing_subscriptions')).toBe(0)
    } finally {
      fixture.cleanup()
    }
  })

  it('expires the correlated Checkout without reading subscription state', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-expired@example.test', 'Webhook Expired')
    seedCheckoutAttempt(fixture, owner, 'billing_attempt_expired')
    const provider = subscriptionProvider([])
    const event = stripeEvent('evt_checkout_expired', 294, 'checkout.session.expired', {
      id: 'cs_expired',
      mode: 'subscription',
      status: 'expired',
      client_reference_id: 'billing_attempt_expired',
      metadata: { billing_attempt_id: 'billing_attempt_expired' },
      customer: { id: 'cus_expired' }
    })

    try {
      await expect(
        processStripeWebhookEventForConnection(fixture.connection, provider.client, config(), event)
      ).resolves.toEqual({ duplicate: false, target: 'live' })
      expect(provider.list).not.toHaveBeenCalled()
      expect(
        fixture.sqlite
          .prepare(
            `select state, stripe_session_id as stripeSessionId,
                    billing_customer_id as billingCustomerId
             from billing_checkout_attempts where id = ?`
          )
          .get('billing_attempt_expired')
      ).toEqual({
        state: 'expired',
        stripeSessionId: 'cs_expired',
        billingCustomerId: expect.stringMatching(/^billing_customer_/)
      })
      expect(count(fixture, 'billing_subscriptions')).toBe(0)
    } finally {
      fixture.cleanup()
    }
  })

  it('fails a correlated asynchronous Checkout without requiring a Customer projection', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-async-failed@example.test', 'Webhook Async Failed')
    seedCheckoutAttempt(fixture, owner, 'billing_attempt_async_failed')
    const provider = subscriptionProvider([])
    const event = stripeEvent('evt_checkout_async_failed', 295, 'checkout.session.async_payment_failed', {
      id: 'cs_async_failed',
      mode: 'subscription',
      status: 'complete',
      client_reference_id: 'billing_attempt_async_failed',
      metadata: { billing_attempt_id: 'billing_attempt_async_failed' }
    })

    try {
      await expect(
        processStripeWebhookEventForConnection(fixture.connection, provider.client, config(), event)
      ).resolves.toEqual({ duplicate: false, target: 'live' })
      expect(provider.list).not.toHaveBeenCalled()
      expect(
        fixture.sqlite
          .prepare(
            `select state, stripe_session_id as stripeSessionId,
                    billing_customer_id as billingCustomerId
             from billing_checkout_attempts where id = ?`
          )
          .get('billing_attempt_async_failed')
      ).toEqual({
        state: 'failed',
        stripeSessionId: 'cs_async_failed',
        billingCustomerId: null
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('does not overwrite local authority when Checkout reports a conflicting session or customer', async () => {
    const sessionFixture = createWorkspaceInvitationFixture()
    const sessionOwner = await sessionFixture.signIn('webhook-session-conflict@example.test', 'Session Conflict')
    seedCheckoutAttempt(sessionFixture, sessionOwner, 'billing_attempt_session_conflict')
    seedCustomer(sessionFixture, sessionOwner, 'cus_session_conflict')
    sessionFixture.sqlite
      .prepare(
        `update billing_checkout_attempts
         set billing_customer_id = ?, stripe_session_id = 'cs_original', state = 'open'
         where id = ?`
      )
      .run(`billing_customer_${sessionOwner.user.id}`, 'billing_attempt_session_conflict')
    const sessionProvider = subscriptionProvider([
      [stripeSubscription('sub_session_conflict', 'cus_session_conflict', 'active')]
    ])

    try {
      await processStripeWebhookEventForConnection(
        sessionFixture.connection,
        sessionProvider.client,
        config(),
        stripeEvent('evt_session_conflict', 295, 'checkout.session.completed', {
          id: 'cs_conflicting',
          mode: 'subscription',
          status: 'complete',
          client_reference_id: 'billing_attempt_session_conflict',
          metadata: { billing_attempt_id: 'billing_attempt_session_conflict' },
          customer: 'cus_session_conflict'
        })
      )
      expect(
        sessionFixture.sqlite
          .prepare('select state, stripe_session_id as stripeSessionId from billing_checkout_attempts where id = ?')
          .get('billing_attempt_session_conflict')
      ).toEqual({ state: 'reconciliation_required', stripeSessionId: 'cs_original' })
      expect(count(sessionFixture, 'billing_subscriptions')).toBe(0)
    } finally {
      sessionFixture.cleanup()
    }

    const customerFixture = createWorkspaceInvitationFixture()
    const customerOwner = await customerFixture.signIn('webhook-customer-conflict@example.test', 'Customer Conflict')
    seedCheckoutAttempt(customerFixture, customerOwner, 'billing_attempt_customer_conflict')
    seedCustomer(customerFixture, customerOwner, 'cus_original')
    const customerProvider = subscriptionProvider([[stripeSubscription('sub_other', 'cus_other', 'active')]])

    try {
      await processStripeWebhookEventForConnection(
        customerFixture.connection,
        customerProvider.client,
        config(),
        stripeEvent('evt_customer_conflict', 296, 'checkout.session.completed', {
          id: 'cs_customer_conflict',
          mode: 'subscription',
          status: 'complete',
          client_reference_id: 'billing_attempt_customer_conflict',
          metadata: { billing_attempt_id: 'billing_attempt_customer_conflict' },
          customer: 'cus_other'
        })
      )
      expect(
        customerFixture.sqlite
          .prepare('select state, billing_customer_id as billingCustomerId from billing_checkout_attempts where id = ?')
          .get('billing_attempt_customer_conflict')
      ).toEqual({ state: 'reconciliation_required', billingCustomerId: null })
      expect(
        customerFixture.sqlite.prepare('select stripe_customer_id as stripeCustomerId from billing_customers').all()
      ).toEqual([{ stripeCustomerId: 'cus_original' }])
      expect(count(customerFixture, 'billing_subscriptions')).toBe(0)
    } finally {
      customerFixture.cleanup()
    }
  })

  it('leaves provider failures retryable because the receipt is committed last', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-retry@example.test', 'Webhook Retry')
    seedCustomer(fixture, owner, 'cus_retry')
    const provider = subscriptionProvider([
      new Error('private provider failure'),
      [stripeSubscription('sub_retry', 'cus_retry', 'past_due')]
    ])
    const event = stripeEvent('evt_retry', 300, 'customer.subscription.updated', {
      id: 'sub_retry',
      customer: 'cus_retry'
    })

    try {
      await expect(
        processStripeWebhookEventForConnection(fixture.connection, provider.client, config(), event)
      ).rejects.toMatchObject({ statusCode: 502 })
      expect(count(fixture, 'billing_events')).toBe(0)
      expect(count(fixture, 'billing_subscriptions')).toBe(0)

      await expect(
        processStripeWebhookEventForConnection(fixture.connection, provider.client, config(), event)
      ).resolves.toEqual({ duplicate: false, target: 'live' })
      expect(count(fixture, 'billing_events')).toBe(1)
      expect(getBillingStateForConnection(fixture.connection, owner.user.id).entitlement).toMatchObject({
        granted: false,
        state: 'reconciliation_required'
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('replaces an exhausted webhook retry generation only while its receipt is unresolved', () => {
    const fixture = createWorkspaceInvitationFixture()
    const now = new Date('2026-07-28T12:00:00.000Z')
    const reference = {
      eventId: 'evt_exhausted_retry',
      eventType: 'checkout.session.expired',
      eventCreatedAt: 1_783_920_002,
      objectId: 'cs_exhausted_retry'
    } as const

    try {
      enqueueBillingWebhookReconciliation(fixture.connection, reference, now)
      fixture.sqlite
        .prepare(
          `update job_queue
           set status = 'failed', attempts = max_attempts, last_error = 'JOB_HANDLER_FAILED'
           where type = ?`
        )
        .run(billingWebhookReconciliationJobType)

      expect(ensureBillingWebhookReconciliationJobs(fixture.connection, now)).toBe(1)
      expect(ensureBillingWebhookReconciliationJobs(fixture.connection, now)).toBe(0)
      expect(
        fixture.sqlite
          .prepare(
            `select status, attempts, max_attempts as maxAttempts, payload, run_after as runAfter
             from job_queue
             where type = ?
             order by id`
          )
          .all(billingWebhookReconciliationJobType)
      ).toEqual([
        {
          status: 'failed',
          attempts: 12,
          maxAttempts: 12,
          payload: JSON.stringify(reference),
          runAfter: new Date(now.getTime() + 60_000).toISOString()
        },
        {
          status: 'queued',
          attempts: 0,
          maxAttempts: 12,
          payload: JSON.stringify(reference),
          runAfter: new Date(now.getTime() + 60_000).toISOString()
        }
      ])

      fixture.sqlite
        .prepare(
          `update job_queue
           set status = 'failed', attempts = max_attempts, last_error = 'JOB_HANDLER_FAILED'
           where type = ?`
        )
        .run(billingWebhookReconciliationJobType)
      fixture.sqlite
        .prepare(
          `insert into billing_events (stripe_event_id, event_type, provider_created_at, processed_at)
           values (?, ?, ?, ?)`
        )
        .run(reference.eventId, reference.eventType, reference.eventCreatedAt, now.toISOString())
      expect(ensureBillingWebhookReconciliationJobs(fixture.connection, now)).toBe(0)
    } finally {
      fixture.cleanup()
    }
  })

  it('fails closed when older or equal triggers observe conflicting current provider state', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-order@example.test', 'Webhook Order')
    seedCustomer(fixture, owner, 'cus_order')
    const provider = subscriptionProvider([
      [stripeSubscription('sub_order', 'cus_order', 'active')],
      [stripeSubscription('sub_order', 'cus_order', 'unpaid')],
      [stripeSubscription('sub_order', 'cus_order', 'past_due')]
    ])

    try {
      await project(fixture, provider.client, 'evt_newer', 500, 'cus_order')
      await project(fixture, provider.client, 'evt_older', 400, 'cus_order')
      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'active',
        projection_order_ms: 500_000,
        reconciliation_required: 1,
        reconciliation_reason: 'older_event_current_state_conflict'
      })
      expect(getBillingStateForConnection(fixture.connection, owner.user.id).entitlement.granted).toBe(false)

      await project(fixture, provider.client, 'evt_equal_conflict', 500, 'cus_order')
      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'active',
        projection_order_ms: 500_000,
        reconciliation_required: 1,
        reconciliation_reason: 'equal_event_order_conflict'
      })
      expect(getBillingStateForConnection(fixture.connection, owner.user.id).entitlement.granted).toBe(false)
    } finally {
      fixture.cleanup()
    }
  })

  it('treats older and equal observations of the same provider state as corroborating evidence', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-matched-order@example.test', 'Webhook Matched Order')
    seedCustomer(fixture, owner, 'cus_matched_order')
    const sameSubscription = stripeSubscription('sub_matched_order', 'cus_matched_order', 'active')
    const provider = subscriptionProvider([[sameSubscription], [sameSubscription], [sameSubscription]])

    try {
      await project(fixture, provider.client, 'evt_matched_new', 550, 'cus_matched_order')
      await project(fixture, provider.client, 'evt_matched_old', 549, 'cus_matched_order')
      await project(fixture, provider.client, 'evt_matched_equal', 550, 'cus_matched_order')

      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'active',
        projection_order_ms: 550_000,
        projection_event_id: 'evt_matched_new',
        reconciliation_required: 0,
        reconciliation_reason: null
      })
      expect(count(fixture, 'billing_events')).toBe(3)
      expect(getBillingStateForConnection(fixture.connection, owner.user.id).entitlement).toMatchObject({
        granted: true,
        state: 'active'
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('never chooses among multiple live subscriptions in the bounded provider snapshot', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-ambiguous@example.test', 'Webhook Ambiguous')
    seedCustomer(fixture, owner, 'cus_ambiguous')
    const provider = subscriptionProvider([
      [
        stripeSubscription('sub_first', 'cus_ambiguous', 'active'),
        stripeSubscription('sub_second', 'cus_ambiguous', 'trialing')
      ]
    ])

    try {
      await project(fixture, provider.client, 'evt_ambiguous', 600, 'cus_ambiguous')
      expect(subscriptionRow(fixture)).toMatchObject({
        stripe_subscription_id: null,
        status: 'ambiguous',
        plan_key: null,
        reconciliation_required: 1,
        reconciliation_reason: 'multiple_live_subscriptions'
      })
      const state = getBillingStateForConnection(fixture.connection, owner.user.id)
      expect(state.entitlement.granted).toBe(false)
      expect(state.subscription).toMatchObject({ state: 'reconciliation_required' })
      expect(state.capabilities).toMatchObject({
        canCheckout: false,
        canManage: false,
        canReconcile: true
      })
      expect(provider.list.mock.calls).toEqual(
        ['active', 'incomplete', 'trialing'].map((status) => [
          {
            customer: 'cus_ambiguous',
            status,
            limit: 2
          },
          {
            timeout: 5_000,
            maxNetworkRetries: 0
          }
        ])
      )
    } finally {
      fixture.cleanup()
    }
  })

  it('requires reconciliation when a bounded Stripe status read reports more results', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-truncated@example.test', 'Webhook Truncated')
    seedCustomer(fixture, owner, 'cus_truncated')
    const provider = subscriptionProvider([[stripeSubscription('sub_truncated', 'cus_truncated', 'active')]], {
      hasMore: true
    })

    try {
      await project(fixture, provider.client, 'evt_truncated', 648, 'cus_truncated')
      expect(subscriptionRow(fixture)).toMatchObject({
        stripe_subscription_id: null,
        status: 'ambiguous',
        plan_key: null,
        reconciliation_required: 1,
        reconciliation_reason: 'multiple_live_subscriptions'
      })
      expect(getBillingStateForConnection(fixture.connection, owner.user.id)).toMatchObject({
        entitlement: { granted: false },
        subscription: { state: 'reconciliation_required' },
        capabilities: {
          canCheckout: false,
          canManage: false,
          canReconcile: true
        }
      })
      expect(provider.list).toHaveBeenCalledOnce()
    } finally {
      fixture.cleanup()
    }
  })

  it('fails closed for an unknown status or noncanonical family subscription shape', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-shape@example.test', 'Webhook Shape')
    seedCustomer(fixture, owner, 'cus_shape')
    const wrongPrice = stripeSubscription('sub_shape', 'cus_shape', 'active')
    wrongPrice.items.data[0]!.price = { id: 'price_other', object: 'price' } as Stripe.Price
    const wrongQuantity = stripeSubscription('sub_shape', 'cus_shape', 'active')
    wrongQuantity.items.data[0]!.quantity = 2
    const unknownStatus = {
      ...stripeSubscription('sub_shape', 'cus_shape', 'active'),
      status: 'future_provider_status'
    } as unknown as Stripe.Subscription
    const provider = subscriptionProvider([[wrongPrice], [wrongQuantity], [unknownStatus]])

    try {
      await project(fixture, provider.client, 'evt_wrong_price', 649, 'cus_shape')
      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'active',
        plan_key: null,
        reconciliation_required: 1,
        reconciliation_reason: 'unrecognized_subscription_price'
      })
      expect(getBillingStateForConnection(fixture.connection, owner.user.id).entitlement.granted).toBe(false)

      await project(fixture, provider.client, 'evt_wrong_quantity', 650, 'cus_shape')
      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'active',
        plan_key: null,
        reconciliation_required: 1,
        reconciliation_reason: 'unexpected_subscription_quantity'
      })
      expect(getBillingStateForConnection(fixture.connection, owner.user.id).entitlement.granted).toBe(false)

      await project(fixture, provider.client, 'evt_unknown_status', 651, 'cus_shape')
      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'ambiguous',
        plan_key: null,
        reconciliation_required: 1,
        reconciliation_reason: 'unknown_subscription_state'
      })
      expect(getBillingStateForConnection(fixture.connection, owner.user.id).entitlement.granted).toBe(false)
    } finally {
      fixture.cleanup()
    }
  })

  it('fails closed for mismatched customers or ambiguous subscription item lists', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-provider-shape@example.test', 'Webhook Provider Shape')
    seedCustomer(fixture, owner, 'cus_provider_shape')
    const mismatchedCustomer = stripeSubscription('sub_customer_mismatch', 'cus_other', 'active')
    const paginatedItems = stripeSubscription('sub_paginated_items', 'cus_provider_shape', 'active')
    paginatedItems.items.has_more = true
    const missingItems = stripeSubscription('sub_missing_items', 'cus_provider_shape', 'active')
    missingItems.items.data = []
    const provider = subscriptionProvider([[mismatchedCustomer], [paginatedItems], [missingItems]])

    try {
      await expect(
        project(fixture, provider.client, 'evt_customer_mismatch', 652, 'cus_provider_shape')
      ).resolves.toEqual({ duplicate: false, target: 'ignored' })
      expect(subscriptionRow(fixture)).toBeUndefined()

      await project(fixture, provider.client, 'evt_paginated_items', 653, 'cus_provider_shape')
      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'ambiguous',
        reconciliation_required: 1,
        reconciliation_reason: 'unexpected_subscription_items'
      })

      await project(fixture, provider.client, 'evt_missing_items', 654, 'cus_provider_shape')
      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'ambiguous',
        reconciliation_required: 1,
        reconciliation_reason: 'unexpected_subscription_items'
      })
      expect(getBillingStateForConnection(fixture.connection, owner.user.id).entitlement.granted).toBe(false)
    } finally {
      fixture.cleanup()
    }
  })

  it('retains a late personal provider activation as a covered-member reconciliation conflict', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('webhook-family-manager@example.test', 'Webhook Family Manager')
    const relative = await fixture.signIn('webhook-family-relative@example.test', 'Webhook Family Relative')
    seedCustomer(fixture, relative, 'cus_covered_relative')
    fixture.sqlite
      .prepare('insert into member (id, organization_id, user_id, role, created_at) values (?, ?, ?, ?, ?)')
      .run('member_covered_relative', manager.workspace.id, relative.user.id, 'member', Date.now())
    const provider = subscriptionProvider([
      [stripeSubscription('sub_late_personal', 'cus_covered_relative', 'active')],
      [stripeSubscription('sub_late_personal', 'cus_covered_relative', 'unpaid')]
    ])
    const event = stripeEvent('evt_late_personal', 655, 'customer.subscription.updated', {
      id: 'sub_late_personal',
      customer: 'cus_covered_relative'
    })

    try {
      await expect(
        processStripeWebhookEventForConnection(fixture.connection, provider.client, config(), event)
      ).resolves.toEqual({ duplicate: false, target: 'live' })
      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'active',
        reconciliation_required: 1,
        reconciliation_reason: 'family_authority_conflict'
      })
      expect(getBillingStateForConnection(fixture.connection, relative.user.id)).toMatchObject({
        entitlement: { granted: false },
        relationship: { kind: 'member' },
        subscription: { state: 'reconciliation_required' },
        capabilities: { canCheckout: false, canManage: false, canLeaveFamily: true }
      })
      await expect(
        processStripeWebhookEventForConnection(fixture.connection, provider.client, config(), event)
      ).resolves.toEqual({ duplicate: true, target: 'ignored' })
      expect(count(fixture, 'billing_events')).toBe(1)

      await expect(
        processStripeWebhookEventForConnection(
          fixture.connection,
          provider.client,
          config(),
          stripeEvent('evt_late_personal_equal_conflict', 655, 'customer.subscription.updated', {
            id: 'sub_late_personal',
            customer: 'cus_covered_relative'
          })
        )
      ).resolves.toEqual({ duplicate: false, target: 'live' })
      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'active',
        reconciliation_required: 1,
        reconciliation_reason: 'equal_event_order_conflict'
      })
      expect(count(fixture, 'billing_events')).toBe(2)
      expect(getBillingStateForConnection(fixture.connection, relative.user.id)).toMatchObject({
        entitlement: { granted: false },
        relationship: { kind: 'member' },
        subscription: { state: 'reconciliation_required' },
        capabilities: {
          canCheckout: false,
          canManage: false,
          canReconcile: false,
          canLeaveFamily: true
        }
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('does not revive a terminal covered-member attempt from uncorrelated malformed Checkout evidence', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('webhook-terminal-family-manager@example.test', 'Terminal Family Manager')
    const relative = await fixture.signIn('webhook-terminal-family-relative@example.test', 'Terminal Family Relative')
    seedCheckoutAttempt(fixture, relative, 'billing_attempt_terminal_covered', 'expired')
    fixture.sqlite
      .prepare('insert into member (id, organization_id, user_id, role, created_at) values (?, ?, ?, ?, ?)')
      .run('member_terminal_covered', manager.workspace.id, relative.user.id, 'member', Date.now())
    const provider = subscriptionProvider([])

    try {
      await expect(
        processStripeWebhookEventForConnection(
          fixture.connection,
          provider.client,
          config(),
          stripeEvent('evt_terminal_covered_malformed', 656, 'checkout.session.completed', {
            id: 'cs_terminal_covered',
            mode: 'payment',
            status: 'complete',
            client_reference_id: 'billing_attempt_terminal_covered'
          })
        )
      ).resolves.toEqual({ duplicate: false, target: 'ignored' })

      expect(provider.list).not.toHaveBeenCalled()
      expect(
        fixture.sqlite
          .prepare('select state from billing_checkout_attempts where id = ?')
          .get('billing_attempt_terminal_covered')
      ).toEqual({ state: 'expired' })
      expect(count(fixture, 'billing_events')).toBe(1)
      expect(getBillingStateForConnection(fixture.connection, relative.user.id)).toMatchObject({
        entitlement: { granted: false },
        relationship: { kind: 'member' },
        subscription: { state: 'reconciliation_required' },
        capabilities: {
          canCheckout: false,
          canManage: false,
          canReconcile: false,
          canLeaveFamily: true
        }
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('correlates the exact terminal subscription and rejects omitted quantity for access', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-terminal@example.test', 'Webhook Terminal')
    seedCustomer(fixture, owner, 'cus_terminal')
    const canceled = stripeSubscription('sub_canceled', 'cus_terminal', 'canceled')
    const incompleteExpired = stripeSubscription('sub_incomplete_expired', 'cus_terminal', 'incomplete_expired')
    const defaultQuantity = stripeSubscription('sub_default_quantity', 'cus_terminal', 'active')
    delete defaultQuantity.items.data[0]!.quantity
    const provider = subscriptionProvider([[canceled, incompleteExpired], [defaultQuantity]])

    try {
      await project(fixture, provider.client, 'evt_terminal_only', 655, 'cus_terminal')
      expect(subscriptionRow(fixture)).toMatchObject({
        stripe_subscription_id: 'sub_canceled',
        status: 'canceled',
        plan_key: 'family',
        reconciliation_required: 0,
        reconciliation_reason: null
      })

      await project(fixture, provider.client, 'evt_default_quantity', 656, 'cus_terminal')
      expect(subscriptionRow(fixture)).toMatchObject({
        stripe_subscription_id: 'sub_default_quantity',
        status: 'active',
        plan_key: 'family',
        cadence: 'monthly',
        cancel_at_period_end: 0,
        reconciliation_required: 1,
        reconciliation_reason: 'managed_subscription_shape_mismatch'
      })
      expect(getBillingStateForConnection(fixture.connection, owner.user.id)).toMatchObject({
        subscription: { state: 'reconciliation_required', renewalEnabled: false },
        entitlement: {
          granted: false,
          state: 'reconciliation_required'
        }
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('updates detached billing continuity monotonically and flags an equal-time conflict', async () => {
    const fixture = createWorkspaceInvitationFixture()
    seedDetachedSubject(fixture, {
      id: 'detached_subscription',
      providerReference: 'sub_detached',
      customerId: 'cus_detached',
      status: 'active',
      eventCreatedAt: 700
    })
    seedDetachedSubject(fixture, {
      id: 'detached_attempt',
      providerReference: 'attempt:billing_attempt_detached',
      customerId: null,
      status: 'checkout_open',
      eventCreatedAt: null
    })
    const provider = subscriptionProvider([
      [stripeSubscription('sub_detached', 'cus_detached', 'past_due')],
      [stripeSubscription('sub_detached', 'cus_detached', 'active')],
      [stripeSubscription('sub_detached', 'cus_detached', 'unpaid')]
    ])

    try {
      await expect(project(fixture, provider.client, 'evt_detached_new', 702, 'cus_detached')).resolves.toEqual({
        duplicate: false,
        target: 'detached'
      })
      expect(detachedSubject(fixture, 'detached_subscription')).toMatchObject({
        provider_status: 'past_due',
        provider_event_created_at: 702
      })

      await expect(project(fixture, provider.client, 'evt_detached_old', 701, 'cus_detached')).resolves.toEqual({
        duplicate: false,
        target: 'detached'
      })
      expect(detachedSubject(fixture, 'detached_subscription')).toMatchObject({
        provider_status: 'past_due',
        provider_event_created_at: 702
      })

      await expect(project(fixture, provider.client, 'evt_detached_equal', 702, 'cus_detached')).resolves.toEqual({
        duplicate: false,
        target: 'detached'
      })
      expect(detachedSubject(fixture, 'detached_subscription')).toMatchObject({
        provider_status: 'reconciliation_required',
        provider_status_expires_at: null,
        provider_event_created_at: 702
      })

      await expect(
        processStripeWebhookEventForConnection(
          fixture.connection,
          provider.client,
          config(),
          stripeEvent('evt_detached_attempt', 703, 'checkout.session.expired', {
            id: 'cs_detached',
            mode: 'subscription',
            status: 'expired',
            client_reference_id: 'billing_attempt_detached',
            metadata: { billing_attempt_id: 'billing_attempt_detached' }
          })
        )
      ).resolves.toEqual({ duplicate: false, target: 'detached' })
      expect(detachedSubject(fixture, 'detached_attempt')).toMatchObject({
        provider_customer_reference: null,
        provider_status: 'expired',
        provider_event_created_at: 703
      })
      expect(count(fixture, 'billing_customers')).toBe(0)
      expect(count(fixture, 'billing_subscriptions')).toBe(0)
    } finally {
      fixture.cleanup()
    }
  })

  it.each(['refund.created', 'charge.dispute.created'] as const)(
    'uses exact current state for %s without suspending a still-active subscription',
    async (eventType) => {
      const fixture = createWorkspaceInvitationFixture()
      const owner = await fixture.signIn(`webhook-${eventType}@example.test`, 'Webhook Risk')
      seedCustomer(fixture, owner, 'cus_risk')
      const active = stripeSubscription('sub_risk', 'cus_risk', 'active')

      try {
        await project(fixture, subscriptionProvider([[active]]).client, 'evt_risk_seed', 800, 'cus_risk')
        const objectId = eventType === 'refund.created' ? 're_risk' : 'dp_risk'
        await expect(
          processStripeWebhookEventForConnection(
            fixture.connection,
            financialRiskProvider(active, eventType),
            config(),
            stripeEvent(`evt_${objectId}`, 801, eventType, { id: objectId })
          )
        ).resolves.toEqual({ duplicate: false, target: 'live' })

        expect(subscriptionRow(fixture)).toMatchObject({
          status: 'active',
          reconciliation_required: 0,
          reconciliation_reason: null,
          projection_event_id: `evt_${objectId}`
        })
        expect(getBillingStateForConnection(fixture.connection, owner.user.id).entitlement).toMatchObject({
          granted: true,
          state: 'active'
        })
      } finally {
        fixture.cleanup()
      }
    }
  )

  it('anchors the first exact renewal failure once and clears only on the same paid invoice', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-dunning@example.test', 'Webhook Dunning')
    seedCustomer(fixture, owner, 'cus_dunning')
    const active = stripeSubscription('sub_dunning', 'cus_dunning', 'active')
    const pastDue = stripeSubscription('sub_dunning', 'cus_dunning', 'past_due')
    const failedInvoice = renewalInvoice('in_dunning', pastDue, 'open')

    try {
      await project(fixture, subscriptionProvider([[active]]).client, 'evt_dunning_seed', 900, 'cus_dunning')
      await processStripeWebhookEventForConnection(
        fixture.connection,
        invoiceProvider(pastDue, failedInvoice),
        config(),
        stripeEvent('evt_dunning_failed', 901, 'invoice.payment_failed', { id: failedInvoice.id })
      )
      const first = subscriptionRow(fixture)
      expect(first).toMatchObject({
        status: 'past_due',
        grace_invoice_id: 'in_dunning',
        grace_started_at: new Date(901_000).toISOString(),
        grace_ends_at: new Date(901_000 + 14 * 24 * 60 * 60 * 1_000).toISOString(),
        reconciliation_required: 0
      })

      await processStripeWebhookEventForConnection(
        fixture.connection,
        invoiceProvider(pastDue, failedInvoice),
        config(),
        stripeEvent('evt_dunning_repeat', 902, 'invoice.payment_failed', { id: failedInvoice.id })
      )
      expect(subscriptionRow(fixture)).toMatchObject({
        grace_invoice_id: first.grace_invoice_id,
        grace_started_at: first.grace_started_at,
        grace_ends_at: first.grace_ends_at
      })
      expect(
        fixture.sqlite
          .prepare(
            `select count(*) as count from job_queue
             where type = 'billing.family-lifecycle-signal'
               and json_extract(payload, '$.action') = 'payment_grace_started'`
          )
          .get()
      ).toEqual({ count: 1 })

      const paidInvoice = renewalInvoice('in_dunning', active, 'paid')
      await processStripeWebhookEventForConnection(
        fixture.connection,
        invoiceProvider(active, paidInvoice),
        config(),
        stripeEvent('evt_dunning_paid', 903, 'invoice.paid', { id: paidInvoice.id })
      )
      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'active',
        grace_invoice_id: null,
        grace_started_at: null,
        grace_ends_at: null,
        reconciliation_required: 0
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('moves a same-invoice grace anchor to the earliest payment failure delivered out of order', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-dunning-reverse@example.test', 'Webhook Dunning Reverse')
    seedCustomer(fixture, owner, 'cus_dunning_reverse')
    const active = stripeSubscription('sub_dunning_reverse', 'cus_dunning_reverse', 'active')
    const pastDue = stripeSubscription('sub_dunning_reverse', 'cus_dunning_reverse', 'past_due')
    const failedInvoice = renewalInvoice('in_dunning_reverse', pastDue, 'open')

    try {
      await project(
        fixture,
        subscriptionProvider([[active]]).client,
        'evt_dunning_reverse_seed',
        900,
        'cus_dunning_reverse'
      )
      await processStripeWebhookEventForConnection(
        fixture.connection,
        invoiceProvider(pastDue, failedInvoice),
        config(),
        stripeEvent('evt_dunning_later_failure', 902, 'invoice.payment_failed', { id: failedInvoice.id })
      )
      await processStripeWebhookEventForConnection(
        fixture.connection,
        invoiceProvider(pastDue, failedInvoice),
        config(),
        stripeEvent('evt_dunning_earlier_failure', 901, 'invoice.payment_failed', { id: failedInvoice.id })
      )

      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'past_due',
        grace_invoice_id: failedInvoice.id,
        grace_started_at: new Date(901_000).toISOString(),
        grace_ends_at: new Date(901_000 + 14 * 24 * 60 * 60 * 1_000).toISOString(),
        reconciliation_required: 0
      })
      expect(
        fixture.sqlite
          .prepare(
            `select count(*) as count from job_queue
             where type = 'billing.family-lifecycle-signal'
               and json_extract(payload, '$.action') = 'payment_grace_started'`
          )
          .get()
      ).toEqual({ count: 1 })
    } finally {
      fixture.cleanup()
    }
  })

  it('anchors an older authenticated failure after a newer past-due subscription observation', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-dunning-cross-event@example.test', 'Webhook Dunning Cross Event')
    seedCustomer(fixture, owner, 'cus_dunning_cross_event')
    const active = stripeSubscription('sub_dunning_cross_event', 'cus_dunning_cross_event', 'active')
    const pastDue = stripeSubscription('sub_dunning_cross_event', 'cus_dunning_cross_event', 'past_due')
    const failedInvoice = renewalInvoice('in_dunning_cross_event', pastDue, 'open')

    try {
      await project(
        fixture,
        subscriptionProvider([[active]]).client,
        'evt_dunning_cross_event_seed',
        900,
        'cus_dunning_cross_event'
      )
      await project(
        fixture,
        subscriptionProvider([[pastDue]]).client,
        'evt_dunning_cross_event_subscription',
        902,
        'cus_dunning_cross_event'
      )
      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'past_due',
        grace_invoice_id: null,
        reconciliation_required: 1,
        reconciliation_reason: 'missing_authenticated_failure_invoice',
        projection_order_ms: 902_000,
        projection_event_id: 'evt_dunning_cross_event_subscription'
      })

      await processStripeWebhookEventForConnection(
        fixture.connection,
        invoiceProvider(pastDue, failedInvoice),
        config(),
        stripeEvent('evt_dunning_cross_event_failure', 901, 'invoice.payment_failed', {
          id: failedInvoice.id
        })
      )

      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'past_due',
        grace_invoice_id: failedInvoice.id,
        grace_started_at: new Date(901_000).toISOString(),
        grace_ends_at: new Date(901_000 + 14 * 24 * 60 * 60 * 1_000).toISOString(),
        reconciliation_required: 0,
        reconciliation_reason: null,
        projection_order_ms: 902_000,
        projection_event_id: 'evt_dunning_cross_event_subscription'
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('does not let an older authenticated failure replace a materially newer subscription projection', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-dunning-newer-state@example.test', 'Webhook Dunning Newer State')
    seedCustomer(fixture, owner, 'cus_dunning_newer_state')
    const active = stripeSubscription('sub_dunning_newer_state', 'cus_dunning_newer_state', 'active')
    const pastDue = stripeSubscription('sub_dunning_newer_state', 'cus_dunning_newer_state', 'past_due')
    const newerPastDue = { ...pastDue, cancel_at_period_end: true } as Stripe.Subscription
    const failedInvoice = renewalInvoice('in_dunning_newer_state', pastDue, 'open')

    try {
      await project(
        fixture,
        subscriptionProvider([[active]]).client,
        'evt_dunning_newer_state_seed',
        900,
        'cus_dunning_newer_state'
      )
      await project(
        fixture,
        subscriptionProvider([[newerPastDue]]).client,
        'evt_dunning_newer_state_subscription',
        902,
        'cus_dunning_newer_state'
      )
      await processStripeWebhookEventForConnection(
        fixture.connection,
        invoiceProvider(pastDue, failedInvoice),
        config(),
        stripeEvent('evt_dunning_newer_state_failure', 901, 'invoice.payment_failed', {
          id: failedInvoice.id
        })
      )

      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'past_due',
        cancel_at_period_end: 1,
        grace_invoice_id: null,
        reconciliation_required: 1,
        reconciliation_reason: 'older_event_current_state_conflict',
        projection_order_ms: 902_000,
        projection_event_id: 'evt_dunning_newer_state_subscription'
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('does not start grace from payment-action-required before an authenticated payment failure', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-action-required@example.test', 'Webhook Action Required')
    seedCustomer(fixture, owner, 'cus_action_required')
    const active = stripeSubscription('sub_action_required', 'cus_action_required', 'active')
    const pastDue = stripeSubscription('sub_action_required', 'cus_action_required', 'past_due')
    const failedInvoice = renewalInvoice('in_action_required', pastDue, 'open')

    try {
      await project(
        fixture,
        subscriptionProvider([[active]]).client,
        'evt_action_required_seed',
        950,
        'cus_action_required'
      )
      await processStripeWebhookEventForConnection(
        fixture.connection,
        invoiceProvider(pastDue, failedInvoice),
        config(),
        stripeEvent('evt_action_required', 951, 'invoice.payment_action_required', { id: failedInvoice.id })
      )
      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'past_due',
        grace_invoice_id: null,
        grace_started_at: null,
        grace_ends_at: null,
        reconciliation_required: 0,
        reconciliation_reason: null
      })
      expect(getBillingStateForConnection(fixture.connection, owner.user.id).entitlement).toMatchObject({
        granted: false,
        state: 'reconciliation_required'
      })
      expect(
        fixture.sqlite
          .prepare(
            `select count(*) as count from job_queue
             where type = 'billing.family-lifecycle-signal'
               and json_extract(payload, '$.action') = 'payment_attention'
               and json_extract(payload, '$.episodeKey') = ?`
          )
          .get(hashBillingFamilyLifecycleEpisodeKey(failedInvoice.id))
      ).toEqual({ count: 1 })

      await processStripeWebhookEventForConnection(
        fixture.connection,
        invoiceProvider(pastDue, failedInvoice),
        config(),
        stripeEvent('evt_action_required_failure', 952, 'invoice.payment_failed', { id: failedInvoice.id })
      )
      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'past_due',
        grace_invoice_id: failedInvoice.id,
        grace_started_at: new Date(952_000).toISOString(),
        grace_ends_at: new Date(952_000 + 14 * 24 * 60 * 60 * 1_000).toISOString(),
        reconciliation_required: 0
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('acknowledges an unrelated event repeatedly without provider work or a durable receipt', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('webhook-ignore@example.test', 'Webhook Ignore')
    seedCheckoutAttempt(fixture, owner, 'billing_attempt_ignore')
    const provider = subscriptionProvider([])
    const event = stripeEvent('evt_irrelevant', 700, 'customer.created', {
      id: 'cus_untrusted',
      customer: 'cus_untrusted',
      metadata: { billing_attempt_id: 'billing_attempt_ignore' }
    })

    try {
      for (let delivery = 0; delivery < 2; delivery += 1) {
        await expect(
          processStripeWebhookEventForConnection(fixture.connection, provider.client, config(), event)
        ).resolves.toEqual({ duplicate: false, target: 'ignored' })
      }
      expect(provider.list).not.toHaveBeenCalled()
      expect(count(fixture, 'billing_events')).toBe(0)
      expect(count(fixture, 'billing_customers')).toBe(0)
      expect(
        fixture.sqlite.prepare('select state from billing_checkout_attempts where id = ?').get('billing_attempt_ignore')
      ).toEqual({ state: 'pending' })
    } finally {
      fixture.cleanup()
    }
  })
})

async function project(
  fixture: WorkspaceInvitationFixture,
  client: StripeBillingClient,
  eventId: string,
  created: number,
  customerId: string
) {
  const current = providerContexts.get(client)?.peek()
  const subscriptionId = current instanceof Error || !current?.[0] ? `sub_${eventId}` : current[0].id
  return processStripeWebhookEventForConnection(
    fixture.connection,
    client,
    config(),
    stripeEvent(eventId, created, 'customer.subscription.updated', {
      id: subscriptionId,
      customer: customerId
    })
  )
}

function subscriptionProvider(sequence: Array<Stripe.Subscription[] | Error>, options: { hasMore?: boolean } = {}) {
  let sequenceIndex = 0
  let currentSnapshot: Stripe.Subscription[] | null = null
  let discoveryReadCount = 0
  const discoveryCandidateIds = new Set<string>()
  const peek = () => sequence[Math.min(sequenceIndex, sequence.length - 1)] ?? []
  const take = () => {
    const value = peek()
    sequenceIndex += 1
    if (value instanceof Error) throw value
    currentSnapshot = value
    return value
  }
  const current = () => currentSnapshot ?? take()
  const clear = () => {
    currentSnapshot = null
    discoveryReadCount = 0
    discoveryCandidateIds.clear()
  }
  const list = vi.fn(async (parameters: Stripe.SubscriptionListParams) => {
    const value = current()
    const matching = value.filter((subscription) => subscription.status === parameters.status)
    const limit = parameters.limit ?? 10
    const data = matching.slice(0, limit)
    const hasMore = options.hasMore ?? data.length < matching.length
    discoveryReadCount += 1
    for (const subscription of data) discoveryCandidateIds.add(subscription.id)
    if (
      hasMore ||
      discoveryCandidateIds.size > 1 ||
      (discoveryReadCount === subscriptionDiscoveryReadCount && discoveryCandidateIds.size === 0)
    ) {
      clear()
    }
    return {
      object: 'list',
      data,
      has_more: hasMore,
      url: '/v1/subscriptions'
    } as Stripe.ApiList<Stripe.Subscription>
  })
  const retrieve = vi.fn(async (id: string) => {
    const value = current()
    const raw = stripeEventObjects.get(id)?.object ?? {}
    const matched = value.find((subscription) => subscription.id === id)
    if (matched && raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)) {
      matched.metadata = raw.metadata as Stripe.Metadata
    }
    const result = matched
      ? ({
          ...matched,
          metadata:
            raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
              ? raw.metadata
              : matched.metadata
        } as Stripe.Subscription)
      : ({
          ...raw,
          id,
          object: 'subscription'
        } as Stripe.Subscription)
    if (discoveryReadCount === subscriptionDiscoveryReadCount) clear()
    return result
  })
  const retrieveSession = vi.fn(async (id: string) => {
    const recorded = stripeEventObjects.get(id)
    const raw = recorded?.object ?? {}
    const value = current()
    const subscription = value[0] ?? null
    if (!subscription) clear()
    const item = subscription?.items.data[0]
    const checkoutItem =
      item ??
      ({
        id: `si_${id}`,
        price: { id: 'price_family_monthly_webhook', object: 'price' },
        quantity: 1
      } as Stripe.SubscriptionItem)
    return {
      ...raw,
      id,
      object: 'checkout.session',
      subscription: subscription?.id ?? null,
      payment_status:
        raw.payment_status ??
        (recorded?.type === 'checkout.session.async_payment_failed'
          ? 'unpaid'
          : recorded?.type === 'checkout.session.expired'
            ? 'unpaid'
            : 'paid'),
      line_items: {
        object: 'list',
        data: [
          {
            id: `li_${id}`,
            object: 'item',
            price: checkoutItem.price,
            quantity: checkoutItem.quantity
          } as Stripe.LineItem
        ],
        has_more: false,
        url: `/v1/checkout/sessions/${id}/line_items`
      }
    } as Stripe.Checkout.Session
  })
  const client = {
    checkout: { sessions: { retrieve: retrieveSession } },
    subscriptions: { list, retrieve }
  } as unknown as StripeBillingClient
  providerContexts.set(client, { peek })
  return {
    list,
    retrieve,
    retrieveSession,
    client
  }
}

function stripeSubscription(id: string, customer: string, status: Stripe.Subscription.Status): Stripe.Subscription {
  return {
    id,
    object: 'subscription',
    customer,
    status,
    collection_method: 'charge_automatically',
    cancel_at: null,
    cancel_at_period_end: false,
    pause_collection: null,
    trial_end: null,
    discounts: [],
    billing_schedules: [],
    schedule: null,
    pending_update: null,
    latest_invoice: null,
    metadata: {},
    items: {
      object: 'list',
      data: [
        {
          id: `si_${id}`,
          object: 'subscription_item',
          current_period_start: 1_783_920_000,
          current_period_end: 1_786_512_000,
          quantity: 1,
          price: { id: 'price_family_monthly_webhook', object: 'price' },
          discounts: []
        } as Stripe.SubscriptionItem
      ],
      has_more: false,
      url: `/v1/subscription_items?subscription=${id}`
    }
  } as Stripe.Subscription
}

function checkoutSubscription(id: string, customer: string): Stripe.Subscription {
  const subscription = stripeSubscription(id, customer, 'active')
  subscription.latest_invoice = initialInvoice(`in_${id}`, customer, id, 'paid')
  return subscription
}

function initialInvoice(
  id: string,
  customer: string,
  subscriptionId: string,
  status: 'open' | 'paid' | 'void'
): Stripe.Invoice {
  return {
    id,
    object: 'invoice',
    customer,
    status,
    billing_reason: 'subscription_create',
    collection_method: 'charge_automatically',
    attempted: true,
    attempt_count: 1,
    amount_remaining: status === 'open' ? 1_000 : 0,
    parent: {
      type: 'subscription_details',
      quote_details: null,
      subscription_details: {
        metadata: null,
        subscription: subscriptionId
      }
    }
  } as Stripe.Invoice
}

function stripeEvent(
  id: string,
  created: number,
  type: Stripe.Event.Type,
  object: Record<string, unknown>
): Stripe.Event {
  const objectId = typeof object.id === 'string' ? object.id : null
  if (objectId) stripeEventObjects.set(objectId, { type, object })
  return {
    id,
    object: 'event',
    api_version: '2026-06-24.dahlia',
    created,
    data: { object },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type
  } as Stripe.Event
}

const stripeEventObjects = new Map<string, Readonly<{ type: Stripe.Event.Type; object: Record<string, unknown> }>>()
const providerContexts = new WeakMap<StripeBillingClient, Readonly<{ peek: () => Stripe.Subscription[] | Error }>>()

function invoiceProvider(subscription: Stripe.Subscription, invoice: Stripe.Invoice): StripeBillingClient {
  const list = vi.fn(async (parameters: Stripe.SubscriptionListParams) => ({
    object: 'list',
    data: parameters.status === subscription.status ? [subscription] : [],
    has_more: false,
    url: '/v1/subscriptions'
  }))
  return {
    invoices: { retrieve: vi.fn(async () => invoice) },
    subscriptions: {
      list,
      retrieve: vi.fn(async (id: string) => {
        expect(id).toBe(subscription.id)
        return subscription
      })
    }
  } as unknown as StripeBillingClient
}

function financialRiskProvider(
  subscription: Stripe.Subscription,
  eventType: 'refund.created' | 'charge.dispute.created'
): StripeBillingClient {
  const invoice = renewalInvoice('in_risk', subscription, 'paid')
  const providerObject =
    eventType === 'refund.created'
      ? ({
          id: 're_risk',
          object: 'refund',
          status: 'succeeded',
          charge: 'ch_risk',
          payment_intent: 'pi_risk'
        } as Stripe.Refund)
      : ({
          id: 'dp_risk',
          object: 'dispute',
          status: 'needs_response',
          charge: 'ch_risk',
          payment_intent: 'pi_risk'
        } as Stripe.Dispute)
  return {
    refunds: { retrieve: vi.fn(async () => providerObject as Stripe.Refund) },
    disputes: { retrieve: vi.fn(async () => providerObject as Stripe.Dispute) },
    charges: {
      retrieve: vi.fn(
        async () =>
          ({
            id: 'ch_risk',
            object: 'charge',
            customer: 'cus_risk',
            payment_intent: 'pi_risk'
          }) as Stripe.Charge
      )
    },
    invoicePayments: {
      list: vi.fn(
        async () =>
          ({
            object: 'list',
            data: [
              {
                id: 'ip_risk',
                object: 'invoice_payment',
                invoice: invoice.id,
                payment: { type: 'payment_intent', payment_intent: 'pi_risk' }
              } as Stripe.InvoicePayment
            ],
            has_more: false,
            url: '/v1/invoice_payments'
          }) as Stripe.ApiList<Stripe.InvoicePayment>
      )
    },
    invoices: { retrieve: vi.fn(async () => invoice) },
    subscriptions: {
      retrieve: vi.fn(async (id: string) => {
        expect(id).toBe(subscription.id)
        return subscription
      }),
      list: vi.fn(
        async (parameters: Stripe.SubscriptionListParams) =>
          ({
            object: 'list',
            data: parameters.status === subscription.status ? [subscription] : [],
            has_more: false,
            url: '/v1/subscriptions'
          }) as Stripe.ApiList<Stripe.Subscription>
      )
    }
  } as unknown as StripeBillingClient
}

function renewalInvoice(id: string, subscription: Stripe.Subscription, status: 'open' | 'paid'): Stripe.Invoice {
  return {
    id,
    object: 'invoice',
    customer: stripeCustomerId(subscription),
    status,
    billing_reason: 'subscription_cycle',
    collection_method: 'charge_automatically',
    attempted: true,
    attempt_count: 1,
    amount_remaining: status === 'open' ? 1_000 : 0,
    parent: {
      type: 'subscription_details',
      quote_details: null,
      subscription_details: {
        metadata: null,
        subscription: subscription.id
      }
    }
  } as Stripe.Invoice
}

function stripeCustomerId(subscription: Stripe.Subscription): string {
  return typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id
}

function config(): AppRuntimeConfig {
  return {
    modules: { billing: { enabled: true } },
    stripe: {
      secretKey: 'sk_test_server',
      webhookSecret: 'whsec_server',
      portalConfigurationId: 'bpc_webhook',
      personalWeeklyPriceId: 'price_personal_weekly_webhook',
      personalMonthlyPriceId: 'price_personal_monthly_webhook',
      personalAnnualPriceId: 'price_personal_annual_webhook',
      familyMonthlyPriceId: 'price_family_monthly_webhook',
      familyAnnualPriceId: 'price_family_annual_webhook'
    }
  } as unknown as AppRuntimeConfig
}

function seedCheckoutAttempt(
  fixture: WorkspaceInvitationFixture,
  owner: SignedInFixtureUser,
  attemptId: string,
  state: 'pending' | 'failed' | 'expired' = 'pending'
) {
  fixture.sqlite
    .prepare(
      `insert into billing_checkout_attempts (
        id, organization_id, plan_key, cadence, stripe_price_id, idempotency_key, state,
        success_url, cancel_url, reuse_until, created_at, updated_at
      ) values (?, ?, 'family', 'monthly', 'price_family_monthly_webhook', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      attemptId,
      owner.workspace.id,
      `checkout_${attemptId}`,
      state,
      'https://app.example.test/account/billing?checkout=success',
      'https://app.example.test/account/billing?checkout=cancelled',
      '2026-07-14T00:00:00.000Z',
      '2026-07-13T00:00:00.000Z',
      '2026-07-13T00:00:00.000Z'
    )
}

function seedCustomer(fixture: WorkspaceInvitationFixture, owner: SignedInFixtureUser, stripeCustomerId: string) {
  fixture.sqlite
    .prepare(
      `insert into billing_customers (id, organization_id, stripe_customer_id, created_at, updated_at)
       values (?, ?, ?, '2026-07-13T00:00:00.000Z', '2026-07-13T00:00:00.000Z')`
    )
    .run(`billing_customer_${owner.user.id}`, owner.workspace.id, stripeCustomerId)
}

function seedDetachedSubject(
  fixture: WorkspaceInvitationFixture,
  input: Readonly<{
    id: string
    providerReference: string
    customerId: string | null
    status: string
    eventCreatedAt: number | null
  }>
) {
  fixture.sqlite
    .prepare(
      `insert into detached_billing_subjects (
        id, provider, provider_reference, provider_customer_reference, provider_status,
        provider_status_expires_at, provider_event_created_at, status_updated_at, deleted_at,
        retention_purpose, retention_policy, purge_after
      ) values (?, 'stripe', ?, ?, ?, null, ?, ?, ?,
                'external_billing_reconciliation', 'stripe_billing_lifecycle', null)`
    )
    .run(
      input.id,
      input.providerReference,
      input.customerId,
      input.status,
      input.eventCreatedAt,
      '2026-07-13T00:00:00.000Z',
      '2026-07-13T00:00:00.000Z'
    )
}

function detachedSubject(fixture: WorkspaceInvitationFixture, id: string) {
  return fixture.sqlite.prepare('select * from detached_billing_subjects where id = ?').get(id)
}

function subscriptionRow(fixture: WorkspaceInvitationFixture) {
  return fixture.sqlite.prepare('select * from billing_subscriptions').get()
}

function count(fixture: WorkspaceInvitationFixture, table: string) {
  return (fixture.sqlite.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count
}
