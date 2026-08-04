import type Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import { deleteAccountAtomically } from '../server/services/account-deletion'
import {
  accountDeletionBillingPendingCode,
  prepareBillingAccountDeletionForConnection
} from '../server/services/payments/billing-account-deletion'
import { createStripeBillingCatalog } from '../server/services/payments/billing-catalog'
import {
  billingAccountDeletionCancellationJobType,
  createBillingAccountDeletionCancellationJobHandler,
  ensureBillingAccountDeletionCancellationJobs
} from '../server/services/payments/billing-account-deletion-job'
import {
  billingAccountDeletionCancellationDelayMs,
  billingAccountDeletionCancellationMaxAttempts
} from '../server/services/payments/billing-account-deletion-store'
import {
  billingNotificationDeliveryJobType,
  createBillingNotificationDeliveryHandler
} from '../server/services/payments/billing-notification-delivery'
import type { StripeBillingClient } from '../server/services/payments/stripe-client'
import {
  createWorkspaceInvitationFixture,
  seedVerifiedBilling,
  type SignedInFixtureUser,
  type WorkspaceInvitationFixture
} from './helpers/workspace-invitation-fixture'

describe('billing-aware account deletion', () => {
  it('keeps the local deletion path provider-free when there is no live subscription', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-without-billing@example.test')
    const getClient = vi.fn<() => StripeBillingClient>()

    try {
      const billingProof = await prepareBillingAccountDeletionForConnection(
        fixture.connection,
        owner.user.id,
        getClient
      )
      expect(getClient).not.toHaveBeenCalled()
      expect(deleteAccountAtomically(fixture.connection, owner.user, { billingProof })).toMatchObject({
        status: 'deleted'
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('durably fences billing, expires an exact customerless Checkout, and only then permits deletion', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-open-checkout@example.test')
    const attempt = seedCheckoutAttempt(fixture, owner, {
      id: 'billing_attempt_delete_open',
      sessionId: 'cs_delete_open',
      state: 'open'
    })
    const stripe = stripeDeletionClient({
      subscriptionId: 'sub_unused',
      customerId: 'cus_unused',
      checkoutSession: checkoutSession(attempt, {
        id: 'cs_delete_open',
        status: 'open'
      })
    })

    try {
      const billingProof = await prepareBillingAccountDeletionForConnection(
        fixture.connection,
        owner.user.id,
        () => stripe.client
      )

      expect(stripe.expireCheckout).toHaveBeenCalledWith(
        'cs_delete_open',
        {},
        { idempotencyKey: 'billing-checkout-account-deletion:expire:billing_attempt_delete_open' }
      )
      expect(stripe.retrieveCheckout).toHaveBeenCalledWith('cs_delete_open', { expand: ['line_items'] })
      expect(readCheckoutAttemptState(fixture, attempt.id)).toBe('expired')
      expect(readBillingDeletionFence(fixture, owner.workspace.id)).toBe(1)
      expect(stripe.cancel).not.toHaveBeenCalled()
      expect(deleteAccountAtomically(fixture.connection, owner.user, { billingProof }).status).toBe('deleted')
    } finally {
      fixture.cleanup()
    }
  })

  it('replays the exact idempotent Checkout creation before expiring a customerless pending attempt', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-pending-checkout@example.test')
    const attempt = seedCheckoutAttempt(fixture, owner, {
      id: 'billing_attempt_delete_pending',
      sessionId: null,
      state: 'pending'
    })
    const stripe = stripeDeletionClient({
      subscriptionId: 'sub_unused',
      customerId: 'cus_unused',
      checkoutSession: checkoutSession(attempt, {
        id: 'cs_delete_replayed',
        status: 'open'
      })
    })

    try {
      const billingProof = await prepareBillingAccountDeletionForConnection(
        fixture.connection,
        owner.user.id,
        () => stripe.client
      )

      expect(stripe.createCheckout).toHaveBeenCalledWith(
        {
          mode: 'subscription',
          client_reference_id: attempt.id,
          line_items: [{ price: attempt.stripePriceId, quantity: 1 }],
          success_url: attempt.successUrl,
          cancel_url: attempt.cancelUrl,
          expand: ['line_items'],
          metadata: { billing_attempt_id: attempt.id },
          subscription_data: { metadata: { billing_attempt_id: attempt.id } }
        },
        { idempotencyKey: attempt.idempotencyKey }
      )
      expect(stripe.expireCheckout).toHaveBeenCalledWith(
        'cs_delete_replayed',
        {},
        { idempotencyKey: 'billing-checkout-account-deletion:expire:billing_attempt_delete_pending' }
      )
      expect(readCheckoutAttemptState(fixture, attempt.id)).toBe('expired')
      expect(deleteAccountAtomically(fixture.connection, owner.user, { billingProof }).status).toBe('deleted')
    } finally {
      fixture.cleanup()
    }
  })

  it('discovers and expires an old pending Checkout instead of replaying creation outside its reuse window', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-old-pending-checkout@example.test')
    const now = Date.now()
    const attempt = seedCheckoutAttempt(fixture, owner, {
      id: 'billing_attempt_delete_old_pending',
      sessionId: null,
      state: 'pending',
      createdAt: new Date(now - 2 * 60 * 60 * 1_000),
      reuseUntil: new Date(now - 60 * 60 * 1_000)
    })
    const session = checkoutSession(attempt, {
      id: 'cs_delete_old_pending',
      status: 'open'
    })
    const stripe = stripeDeletionClient({
      subscriptionId: 'sub_unused',
      customerId: 'cus_unused',
      checkoutSession: session,
      checkoutDiscoverySessions: [session]
    })

    try {
      const billingProof = await prepareBillingAccountDeletionForConnection(
        fixture.connection,
        owner.user.id,
        () => stripe.client
      )

      expect(stripe.listCheckout).toHaveBeenCalledOnce()
      expect(stripe.createCheckout).not.toHaveBeenCalled()
      expect(stripe.expireCheckout).toHaveBeenCalledWith(
        'cs_delete_old_pending',
        {},
        { idempotencyKey: 'billing-checkout-account-deletion:expire:billing_attempt_delete_old_pending' }
      )
      expect(readCheckoutAttemptState(fixture, attempt.id)).toBe('expired')
      expect(deleteAccountAtomically(fixture.connection, owner.user, { billingProof }).status).toBe('deleted')
    } finally {
      fixture.cleanup()
    }
  })

  it('keeps identity and the durable fence when pending Checkout discovery is ambiguous', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-ambiguous-pending-checkout@example.test')
    const attempt = seedCheckoutAttempt(fixture, owner, {
      id: 'billing_attempt_delete_ambiguous_pending',
      sessionId: null,
      state: 'pending'
    })
    const stripe = stripeDeletionClient({
      subscriptionId: 'sub_unused',
      customerId: 'cus_unused',
      checkoutDiscoverySessions: [
        checkoutSession(attempt, { id: 'cs_delete_ambiguous_one', status: 'open' }),
        checkoutSession(attempt, { id: 'cs_delete_ambiguous_two', status: 'open' })
      ]
    })

    try {
      await expect(
        prepareBillingAccountDeletionForConnection(fixture.connection, owner.user.id, () => stripe.client)
      ).rejects.toMatchObject({
        statusCode: 503,
        data: { code: accountDeletionBillingPendingCode }
      })

      expect(stripe.createCheckout).not.toHaveBeenCalled()
      expect(stripe.expireCheckout).not.toHaveBeenCalled()
      expect(countUsers(fixture, owner.user.id)).toBe(1)
      expect(readCheckoutAttemptState(fixture, attempt.id)).toBe('pending')
      expect(readBillingDeletionFence(fixture, owner.workspace.id)).toBe(1)
    } finally {
      fixture.cleanup()
    }
  })

  it('keeps identity and the durable fence when exact Checkout neutralization is unavailable', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-checkout-unavailable@example.test')
    const attempt = seedCheckoutAttempt(fixture, owner, {
      id: 'billing_attempt_delete_unavailable',
      sessionId: 'cs_delete_unavailable',
      state: 'open'
    })
    const stripe = stripeDeletionClient({
      subscriptionId: 'sub_unused',
      customerId: 'cus_unused',
      checkoutRetrieveError: new Error('secret Checkout read diagnostic')
    })

    try {
      await expect(
        prepareBillingAccountDeletionForConnection(fixture.connection, owner.user.id, () => stripe.client)
      ).rejects.toMatchObject({
        statusCode: 503,
        data: { code: accountDeletionBillingPendingCode }
      })

      expect(countUsers(fixture, owner.user.id)).toBe(1)
      expect(readCheckoutAttemptState(fixture, attempt.id)).toBe('open')
      expect(readBillingDeletionFence(fixture, owner.workspace.id)).toBe(1)
      expect(() =>
        deleteAccountAtomically(fixture.connection, owner.user, {
          billingProof: 'untrusted-proof'
        })
      ).toThrow(expect.objectContaining({ statusCode: 503 }))
    } finally {
      fixture.cleanup()
    }
  })

  it('cancels the exact subscription when Checkout completes while deletion is expiring it', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-checkout-completion-race@example.test')
    const attempt = seedCheckoutAttempt(fixture, owner, {
      id: 'billing_attempt_delete_completion_race',
      sessionId: 'cs_delete_completion_race',
      state: 'open'
    })
    const stripe = stripeDeletionClient({
      subscriptionId: 'sub_delete_completion_race',
      customerId: 'cus_delete_completion_race',
      checkoutSession: checkoutSession(attempt, {
        id: 'cs_delete_completion_race',
        status: 'open'
      }),
      checkoutStatusAfterExpire: 'complete',
      cancelError: new Error('lost cancellation response')
    })

    try {
      const billingProof = await prepareBillingAccountDeletionForConnection(
        fixture.connection,
        owner.user.id,
        () => stripe.client
      )

      expect(stripe.expireCheckout).toHaveBeenCalledWith(
        'cs_delete_completion_race',
        {},
        {
          idempotencyKey: 'billing-checkout-account-deletion:expire:billing_attempt_delete_completion_race'
        }
      )
      expect(stripe.cancel).toHaveBeenCalledWith(
        'sub_delete_completion_race',
        { invoice_now: false, prorate: false },
        { idempotencyKey: 'billing-checkout-account-deletion:cancel:billing_attempt_delete_completion_race' }
      )
      expect(stripe.retrieve).toHaveBeenCalledWith('sub_delete_completion_race')
      expect(readCheckoutAttemptState(fixture, attempt.id)).toBe('completed')
      expect(
        fixture.sqlite
          .prepare('select stripe_customer_id as stripeCustomerId from billing_customers where organization_id = ?')
          .get(owner.workspace.id)
      ).toEqual({ stripeCustomerId: 'cus_delete_completion_race' })
      expect(readDeletionRequest(fixture)).toMatchObject({
        expectedStripeCustomerId: 'cus_delete_completion_race',
        state: 'cancellation_confirmed'
      })
      expect(deleteAccountAtomically(fixture.connection, owner.user, { billingProof }).status).toBe('deleted')
    } finally {
      fixture.cleanup()
    }
  })

  it('keeps a completed Checkout retryable until exact subscription cancellation is confirmed', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-checkout-cancellation-retry@example.test')
    const attempt = seedCheckoutAttempt(fixture, owner, {
      id: 'billing_attempt_delete_cancellation_retry',
      sessionId: 'cs_delete_cancellation_retry',
      state: 'open'
    })
    const first = stripeDeletionClient({
      subscriptionId: 'sub_delete_cancellation_retry',
      customerId: 'cus_delete_cancellation_retry',
      checkoutSession: checkoutSession(attempt, {
        id: 'cs_delete_cancellation_retry',
        status: 'open'
      }),
      checkoutStatusAfterExpire: 'complete'
    })
    first.cancel.mockRejectedValue(new Error('cancellation failed before Stripe applied it'))

    try {
      await expect(
        prepareBillingAccountDeletionForConnection(fixture.connection, owner.user.id, () => first.client)
      ).rejects.toMatchObject({
        statusCode: 503,
        data: { code: accountDeletionBillingPendingCode }
      })

      expect(readCheckoutAttemptState(fixture, attempt.id)).toBe('open')
      expect(countUsers(fixture, owner.user.id)).toBe(1)
      expect(readBillingDeletionFence(fixture, owner.workspace.id)).toBe(1)

      const recovered = stripeDeletionClient({
        subscriptionId: 'sub_delete_cancellation_retry',
        customerId: 'cus_delete_cancellation_retry',
        checkoutSession: {
          ...checkoutSession(attempt, {
            id: 'cs_delete_cancellation_retry',
            status: 'complete'
          }),
          customer: 'cus_delete_cancellation_retry',
          subscription: 'sub_delete_cancellation_retry'
        }
      })
      const billingProof = await prepareBillingAccountDeletionForConnection(
        fixture.connection,
        owner.user.id,
        () => recovered.client
      )

      const cancellationArguments = [
        'sub_delete_cancellation_retry',
        { invoice_now: false, prorate: false },
        {
          idempotencyKey: 'billing-checkout-account-deletion:cancel:billing_attempt_delete_cancellation_retry'
        }
      ] as const
      expect(first.cancel).toHaveBeenCalledWith(...cancellationArguments)
      expect(recovered.cancel).toHaveBeenCalledWith(...cancellationArguments)
      expect(readCheckoutAttemptState(fixture, attempt.id)).toBe('completed')
      expect(deleteAccountAtomically(fixture.connection, owner.user, { billingProof }).status).toBe('deleted')
    } finally {
      fixture.cleanup()
    }
  })

  it('does not cancel a completed Checkout subscription until exact customer identity is verified', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-checkout-subscription-mismatch@example.test')
    const attempt = seedCheckoutAttempt(fixture, owner, {
      id: 'billing_attempt_delete_subscription_mismatch',
      sessionId: 'cs_delete_subscription_mismatch',
      state: 'open'
    })
    const stripe = stripeDeletionClient({
      subscriptionId: 'sub_delete_subscription_mismatch',
      customerId: 'cus_delete_subscription_mismatch',
      retrievedCustomerId: 'cus_different_subscription_owner',
      checkoutSession: {
        ...checkoutSession(attempt, {
          id: 'cs_delete_subscription_mismatch',
          status: 'complete'
        }),
        customer: 'cus_delete_subscription_mismatch',
        subscription: 'sub_delete_subscription_mismatch'
      }
    })

    try {
      await expect(
        prepareBillingAccountDeletionForConnection(fixture.connection, owner.user.id, () => stripe.client)
      ).rejects.toMatchObject({
        statusCode: 503,
        data: { code: accountDeletionBillingPendingCode }
      })
      expect(stripe.cancel).not.toHaveBeenCalled()
      expect(countUsers(fixture, owner.user.id)).toBe(1)
      expect(readBillingDeletionFence(fixture, owner.workspace.id)).toBe(1)
    } finally {
      fixture.cleanup()
    }
  })

  it('creates one durable request, immediately cancels without refund, verifies exact Stripe identity, and reuses confirmation', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-live-billing@example.test')
    const billing = seedVerifiedBilling(fixture, owner, { plan: 'family' })
    const stripe = stripeDeletionClient({
      subscriptionId: billing.stripeSubscriptionId,
      customerId: billing.stripeCustomerId
    })

    try {
      await prepareBillingAccountDeletionForConnection(fixture.connection, owner.user.id, () => stripe.client)
      const billingProof = await prepareBillingAccountDeletionForConnection(
        fixture.connection,
        owner.user.id,
        () => stripe.client
      )

      const request = readDeletionRequest(fixture)
      expect(request).toMatchObject({
        userId: owner.user.id,
        organizationId: owner.workspace.id,
        billingSubscriptionId: billing.subscriptionId,
        billingCustomerId: billing.customerId,
        expectedStripeSubscriptionId: billing.stripeSubscriptionId,
        expectedStripeCustomerId: billing.stripeCustomerId,
        capturedBillingRevision: 0,
        state: 'cancellation_confirmed',
        reason: null,
        cancellationConfirmedAt: expect.any(String)
      })
      expect(stripe.cancel).toHaveBeenCalledTimes(1)
      expect(stripe.cancel).toHaveBeenCalledWith(
        billing.stripeSubscriptionId,
        { invoice_now: false, prorate: false },
        { idempotencyKey: `billing-account-deletion:${request.id}` }
      )
      expect(stripe.retrieve).toHaveBeenCalledTimes(1)
      expect(stripe.retrieve).toHaveBeenCalledWith(billing.stripeSubscriptionId)
      expect(stripe.deleteCustomer).not.toHaveBeenCalled()

      const job = readDeletionJob(fixture)
      expect(job).toMatchObject({
        type: billingAccountDeletionCancellationJobType,
        status: 'queued',
        attempts: 0,
        maxAttempts: billingAccountDeletionCancellationMaxAttempts
      })
      expect(JSON.parse(job.payload)).toEqual({ requestId: request.id })

      expect(deleteAccountAtomically(fixture.connection, owner.user, { billingProof })).toMatchObject({
        status: 'deleted'
      })
      expect(countUsers(fixture, owner.user.id)).toBe(0)
    } finally {
      fixture.cleanup()
    }
  })

  it('retains identity on an indeterminate provider result and lets the worker confirm without deleting the user', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-retry-billing@example.test')
    const billing = seedVerifiedBilling(fixture, owner, { plan: 'personal', cadence: 'monthly' })
    const indeterminate = stripeDeletionClient({
      subscriptionId: billing.stripeSubscriptionId,
      customerId: billing.stripeCustomerId,
      cancelError: new Error('secret cancel diagnostic'),
      retrieveError: new Error('secret retrieve diagnostic')
    })

    try {
      await expect(
        prepareBillingAccountDeletionForConnection(fixture.connection, owner.user.id, () => indeterminate.client)
      ).rejects.toMatchObject({
        statusCode: 503,
        data: {
          code: accountDeletionBillingPendingCode,
          message: 'Account deletion is awaiting billing confirmation. Please retry.'
        }
      })
      expect(countUsers(fixture, owner.user.id)).toBe(1)
      expect(readDeletionRequest(fixture)).toMatchObject({
        state: 'pending',
        reason: null,
        cancellationConfirmedAt: null
      })
      const notification = fixture.sqlite
        .prepare('select payload from job_queue where type = ?')
        .get(billingNotificationDeliveryJobType) as { payload: string }
      expect(Object.keys(JSON.parse(notification.payload)).sort()).toEqual([
        'authorityReference',
        'effectiveAt',
        'kind',
        'notificationKey',
        'recipientUserId'
      ])
      expect(notification.payload).not.toMatch(/@|(?:sub|cus|price|in|evt)_[a-z0-9_]+/i)
      const messages: Array<{ subject: string; to: string }> = []
      await createBillingNotificationDeliveryHandler({
        appName: fixture.config.public.appName,
        connection: fixture.connection,
        sender: {
          async send(message) {
            messages.push(message)
          }
        }
      })(JSON.parse(notification.payload))
      expect(messages).toMatchObject([
        {
          subject: 'Account deletion is waiting for billing cancellation',
          to: owner.user.email
        }
      ])

      const requestId = readDeletionRequest(fixture).id
      const recovered = stripeDeletionClient({
        subscriptionId: billing.stripeSubscriptionId,
        customerId: billing.stripeCustomerId
      })
      const handler = createBillingAccountDeletionCancellationJobHandler(fixture.connection, () => recovered.client)
      await handler({ requestId })
      await handler({ requestId })

      expect(readDeletionRequest(fixture)).toMatchObject({
        state: 'cancellation_confirmed',
        reason: null,
        cancellationConfirmedAt: expect.any(String)
      })
      expect(recovered.cancel).toHaveBeenCalledTimes(1)
      expect(recovered.retrieve).toHaveBeenCalledTimes(1)
      expect(recovered.deleteCustomer).not.toHaveBeenCalled()
      expect(countUsers(fixture, owner.user.id)).toBe(1)

      const billingProof = await prepareBillingAccountDeletionForConnection(
        fixture.connection,
        owner.user.id,
        () => recovered.client
      )
      expect(deleteAccountAtomically(fixture.connection, owner.user, { billingProof }).status).toBe('deleted')
    } finally {
      fixture.cleanup()
    }
  })

  it('lets the worker adopt one recognized live customer subscription and leaves deletion for a fresh request', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-missing-subscription-reference@example.test')
    const billing = seedVerifiedBilling(fixture, owner, { plan: 'personal', cadence: 'monthly' })
    const catalog = createStripeBillingCatalog(fixture.config.stripe)
    fixture.sqlite
      .prepare(
        `update billing_subscriptions
         set stripe_subscription_id = null
         where id = ?`
      )
      .run(billing.subscriptionId)
    const unavailable = stripeDeletionClient({
      subscriptionId: billing.stripeSubscriptionId,
      customerId: billing.stripeCustomerId,
      listError: new Error('temporary customer subscription read failure')
    })

    try {
      await expect(
        prepareBillingAccountDeletionForConnection(fixture.connection, owner.user.id, () => unavailable.client, catalog)
      ).rejects.toMatchObject({
        statusCode: 503,
        data: { code: accountDeletionBillingPendingCode }
      })
      expect(readDeletionRequest(fixture)).toMatchObject({
        billingSubscriptionId: null,
        expectedStripeSubscriptionId: null,
        state: 'reconciliation_required'
      })

      const recovered = stripeDeletionClient({
        subscriptionId: billing.stripeSubscriptionId,
        customerId: billing.stripeCustomerId,
        listCanceledAfterCancel: true,
        listedSubscriptions: [
          projectedStripeSubscription(
            billing.stripeSubscriptionId,
            billing.stripeCustomerId,
            'active',
            fixture.config.stripe.personalMonthlyPriceId
          )
        ]
      })
      const requestId = readDeletionRequest(fixture).id
      const handler = createBillingAccountDeletionCancellationJobHandler(
        fixture.connection,
        () => recovered.client,
        catalog
      )

      await expect(handler({ requestId })).resolves.toBeUndefined()
      expect(recovered.cancel).toHaveBeenCalledWith(
        billing.stripeSubscriptionId,
        { invoice_now: false, prorate: false },
        { idempotencyKey: `billing-account-deletion:${requestId}` }
      )
      expect(recovered.retrieve).toHaveBeenCalledWith(billing.stripeSubscriptionId)
      expect(readDeletionRequest(fixture)).toMatchObject({
        billingSubscriptionId: billing.subscriptionId,
        expectedStripeSubscriptionId: billing.stripeSubscriptionId,
        state: 'cancellation_confirmed',
        reason: null
      })
      expect(
        fixture.sqlite
          .prepare(
            `select
               stripe_subscription_id as stripeSubscriptionId,
               stripe_subscription_item_id as stripeSubscriptionItemId
             from billing_subscriptions
             where id = ?`
          )
          .get(billing.subscriptionId)
      ).toEqual({
        stripeSubscriptionId: billing.stripeSubscriptionId,
        stripeSubscriptionItemId: `si_${billing.stripeSubscriptionId}`
      })
      expect(countUsers(fixture, owner.user.id)).toBe(1)

      const billingProof = await prepareBillingAccountDeletionForConnection(
        fixture.connection,
        owner.user.id,
        () => recovered.client,
        catalog
      )
      expect(deleteAccountAtomically(fixture.connection, owner.user, { billingProof }).status).toBe('deleted')
      expect(fixture.sqlite.prepare('select * from detached_billing_subjects').get()).toMatchObject({
        provider_reference: billing.stripeSubscriptionId
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('keeps missing-reference recovery fail-closed for ambiguous or unrecognized customer listings', async () => {
    const scenarios = [
      {
        name: 'truncated',
        reason: 'customer_subscription_state_unknown',
        subscriptions: (subscriptionId: string, customerId: string, priceId: string) => [
          projectedStripeSubscription(subscriptionId, customerId, 'active', priceId)
        ],
        hasMore: true
      },
      {
        name: 'multiple-live',
        reason: 'customer_subscription_state_unknown',
        subscriptions: (subscriptionId: string, customerId: string, priceId: string) => [
          projectedStripeSubscription(subscriptionId, customerId, 'active', priceId),
          projectedStripeSubscription(`${subscriptionId}_other`, customerId, 'active', priceId)
        ]
      },
      {
        name: 'customer-mismatch',
        reason: 'customer_subscription_state_unknown',
        subscriptions: (subscriptionId: string, _customerId: string, priceId: string) => [
          projectedStripeSubscription(subscriptionId, 'cus_different_owner', 'active', priceId)
        ]
      },
      {
        name: 'unknown-price',
        reason: 'customer_subscription_state_unknown',
        subscriptions: (subscriptionId: string, customerId: string) => [
          projectedStripeSubscription(subscriptionId, customerId, 'active', 'price_unrecognized')
        ]
      }
    ] as const

    for (const [index, scenario] of scenarios.entries()) {
      const fixture = createWorkspaceInvitationFixture()
      const owner = await fixture.signIn(`delete-missing-reference-${index}@example.test`)
      const billing = seedVerifiedBilling(fixture, owner, { plan: 'personal', cadence: 'monthly' })
      const catalog = createStripeBillingCatalog(fixture.config.stripe)
      fixture.sqlite
        .prepare(
          `update billing_subscriptions
           set stripe_subscription_id = null
           where id = ?`
        )
        .run(billing.subscriptionId)
      const stripe = stripeDeletionClient({
        subscriptionId: billing.stripeSubscriptionId,
        customerId: billing.stripeCustomerId,
        listedSubscriptions: scenario.subscriptions(
          billing.stripeSubscriptionId,
          billing.stripeCustomerId,
          fixture.config.stripe.personalMonthlyPriceId
        ),
        listHasMore: 'hasMore' in scenario ? scenario.hasMore : false
      })

      try {
        await expect(
          prepareBillingAccountDeletionForConnection(fixture.connection, owner.user.id, () => stripe.client, catalog)
        ).rejects.toMatchObject({
          statusCode: 503,
          data: { code: accountDeletionBillingPendingCode }
        })
        expect(readDeletionRequest(fixture), scenario.name).toMatchObject({
          billingSubscriptionId: null,
          expectedStripeSubscriptionId: null,
          state: 'reconciliation_required',
          reason: scenario.reason,
          cancellationConfirmedAt: null
        })
        expect(
          fixture.sqlite
            .prepare(
              `select stripe_subscription_id as subscriptionId,
                      stripe_subscription_item_id as itemId
               from billing_subscriptions
               where id = ?`
            )
            .get(billing.subscriptionId)
        ).toEqual({ subscriptionId: null, itemId: billing.stripeSubscriptionItemId })
        expect(stripe.cancel).not.toHaveBeenCalled()
        expect(stripe.retrieve).toHaveBeenCalledTimes(scenario.name === 'unknown-price' ? 1 : 0)
        expect(countUsers(fixture, owner.user.id)).toBe(1)
      } finally {
        fixture.cleanup()
      }
    }
  })

  it('converges when the cancellation response is lost but exact retrieval proves cancellation', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-lost-cancel-response@example.test')
    const billing = seedVerifiedBilling(fixture, owner, { plan: 'personal', cadence: 'monthly' })
    const stripe = stripeDeletionClient({
      subscriptionId: billing.stripeSubscriptionId,
      customerId: billing.stripeCustomerId,
      cancelError: new Error('indeterminate cancellation response')
    })

    try {
      const billingProof = await prepareBillingAccountDeletionForConnection(
        fixture.connection,
        owner.user.id,
        () => stripe.client
      )
      expect(stripe.cancel).toHaveBeenCalledOnce()
      expect(stripe.retrieve).toHaveBeenCalledOnce()
      expect(readDeletionRequest(fixture)).toMatchObject({
        state: 'cancellation_confirmed',
        reason: null,
        cancellationConfirmedAt: expect.any(String)
      })
      expect(deleteAccountAtomically(fixture.connection, owner.user, { billingProof }).status).toBe('deleted')
    } finally {
      fixture.cleanup()
    }
  })

  it('proves deletion safety without enumerating more than 100 terminal subscriptions', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-terminal-history@example.test')
    const billing = seedVerifiedBilling(fixture, owner, { plan: 'personal', cadence: 'monthly' })
    const stripe = stripeDeletionClient({
      subscriptionId: billing.stripeSubscriptionId,
      customerId: billing.stripeCustomerId,
      listedSubscriptions: Array.from({ length: 125 }, (_, index) =>
        stripeSubscription(
          `sub_terminal_history_${index}`,
          billing.stripeCustomerId,
          index % 2 === 0 ? 'canceled' : 'incomplete_expired'
        )
      )
    })

    try {
      await expect(
        prepareBillingAccountDeletionForConnection(fixture.connection, owner.user.id, () => stripe.client)
      ).resolves.toMatch(/^account_delete_proof_/)
    } finally {
      fixture.cleanup()
    }
  })

  it('fails closed on a mismatched Stripe customer and never treats reconciliation as deletion success', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-mismatched-billing@example.test')
    const billing = seedVerifiedBilling(fixture, owner, { plan: 'personal', cadence: 'weekly' })
    const stripe = stripeDeletionClient({
      subscriptionId: billing.stripeSubscriptionId,
      customerId: 'cus_wrong_account'
    })

    try {
      await expect(
        prepareBillingAccountDeletionForConnection(fixture.connection, owner.user.id, () => stripe.client)
      ).rejects.toMatchObject({
        statusCode: 503,
        data: { code: accountDeletionBillingPendingCode }
      })
      expect(readDeletionRequest(fixture)).toMatchObject({
        state: 'reconciliation_required',
        reason: 'stripe_customer_mismatch',
        cancellationConfirmedAt: null
      })
      expect(countUsers(fixture, owner.user.id)).toBe(1)
      expect(() => deleteAccountAtomically(fixture.connection, owner.user)).toThrow(
        expect.objectContaining({
          statusCode: 503,
          body: expect.objectContaining({ code: accountDeletionBillingPendingCode })
        })
      )
      expect(stripe.deleteCustomer).not.toHaveBeenCalled()
    } finally {
      fixture.cleanup()
    }
  })

  it('fails closed on ambiguous or malformed nonterminal subscription reads', async () => {
    const scenarios = [
      {
        name: 'truncated',
        reason: 'customer_has_live_subscription',
        list: (subscriptionId: string, customerId: string) => ({
          subscriptions: [stripeSubscription(subscriptionId, customerId, 'active')],
          hasMore: true
        })
      },
      {
        name: 'duplicate',
        reason: 'customer_subscription_state_unknown',
        list: (subscriptionId: string, customerId: string) => ({
          subscriptions: [
            stripeSubscription(subscriptionId, customerId, 'active'),
            stripeSubscription(subscriptionId, customerId, 'active')
          ]
        })
      },
      {
        name: 'customer-mismatch',
        reason: 'customer_subscription_state_unknown',
        list: (subscriptionId: string) => ({
          subscriptions: [stripeSubscription(subscriptionId, 'cus_different_customer', 'active')]
        })
      },
      {
        name: 'terminal-before-exact-retrieve',
        reason: 'customer_subscription_state_unknown',
        list: (subscriptionId: string, customerId: string) => ({
          subscriptions: [stripeSubscription(subscriptionId, customerId, 'active')]
        })
      }
    ] as const

    for (const [index, scenario] of scenarios.entries()) {
      const fixture = createWorkspaceInvitationFixture()
      const owner = await fixture.signIn(`delete-list-${index}@example.test`)
      const billing = seedVerifiedBilling(fixture, owner, { plan: 'personal', cadence: 'monthly' })
      const list = scenario.list(billing.stripeSubscriptionId, billing.stripeCustomerId)
      const stripe = stripeDeletionClient({
        subscriptionId: billing.stripeSubscriptionId,
        customerId: billing.stripeCustomerId,
        listedSubscriptions: list.subscriptions,
        listHasMore: 'hasMore' in list ? list.hasMore : false
      })

      try {
        await expect(
          prepareBillingAccountDeletionForConnection(fixture.connection, owner.user.id, () => stripe.client)
        ).rejects.toMatchObject({
          statusCode: 503,
          data: { code: accountDeletionBillingPendingCode }
        })
        expect(readDeletionRequest(fixture), scenario.name).toMatchObject({
          state: 'reconciliation_required',
          reason: scenario.reason,
          cancellationConfirmedAt: null
        })
        expect(countUsers(fixture, owner.user.id)).toBe(1)
      } finally {
        fixture.cleanup()
      }
    }
  })

  it('rechecks the durable fence inside the local transaction when billing changes after confirmation', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-race-fence@example.test')
    const billing = seedVerifiedBilling(fixture, owner, { plan: 'family', cadence: 'annual' })
    const stripe = stripeDeletionClient({
      subscriptionId: billing.stripeSubscriptionId,
      customerId: billing.stripeCustomerId
    })

    try {
      expect(() => deleteAccountAtomically(fixture.connection, owner.user)).toThrow(
        expect.objectContaining({ statusCode: 503 })
      )
      const billingProof = await prepareBillingAccountDeletionForConnection(
        fixture.connection,
        owner.user.id,
        () => stripe.client
      )
      fixture.sqlite
        .prepare(
          `update billing_subscriptions
           set stripe_subscription_id = 'sub_replaced_after_confirmation',
               stripe_subscription_item_id = 'si_replaced_after_confirmation',
               revision = revision + 1
           where organization_id = ?`
        )
        .run(owner.workspace.id)

      expect(() => deleteAccountAtomically(fixture.connection, owner.user, { billingProof })).toThrow(
        expect.objectContaining({ statusCode: 503 })
      )
      expect(countUsers(fixture, owner.user.id)).toBe(1)
    } finally {
      fixture.cleanup()
    }
  })

  it('reopens a confirmed deletion request when a replacement local subscription becomes active', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-replacement-subscription@example.test')
    const billing = seedVerifiedBilling(fixture, owner, { plan: 'personal', cadence: 'monthly' })
    const initial = stripeDeletionClient({
      subscriptionId: billing.stripeSubscriptionId,
      customerId: billing.stripeCustomerId
    })

    try {
      await prepareBillingAccountDeletionForConnection(fixture.connection, owner.user.id, () => initial.client)
      fixture.sqlite
        .prepare(
          `update billing_subscriptions
           set stripe_subscription_id = 'sub_replacement_before_delete',
               stripe_subscription_item_id = 'si_replacement_before_delete',
               status = 'active',
               revision = revision + 1
           where organization_id = ?`
        )
        .run(owner.workspace.id)

      const replacement = stripeDeletionClient({
        subscriptionId: 'sub_replacement_before_delete',
        customerId: billing.stripeCustomerId
      })
      const billingProof = await prepareBillingAccountDeletionForConnection(
        fixture.connection,
        owner.user.id,
        () => replacement.client
      )

      expect(replacement.cancel).toHaveBeenCalledWith(
        'sub_replacement_before_delete',
        { invoice_now: false, prorate: false },
        expect.objectContaining({ idempotencyKey: expect.stringMatching(/^billing-account-deletion:/) })
      )
      expect(readDeletionRequest(fixture)).toMatchObject({
        expectedStripeSubscriptionId: 'sub_replacement_before_delete',
        capturedBillingRevision: 1,
        state: 'cancellation_confirmed',
        reason: null,
        cancellationConfirmedAt: expect.any(String)
      })
      expect(deleteAccountAtomically(fixture.connection, owner.user, { billingProof }).status).toBe('deleted')
    } finally {
      fixture.cleanup()
    }
  })

  it('re-enters reconciliation when a later customer sweep finds a different live subscription', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-dashboard-replacement@example.test')
    const billing = seedVerifiedBilling(fixture, owner, { plan: 'personal', cadence: 'annual' })
    const initial = stripeDeletionClient({
      subscriptionId: billing.stripeSubscriptionId,
      customerId: billing.stripeCustomerId
    })

    try {
      await prepareBillingAccountDeletionForConnection(fixture.connection, owner.user.id, () => initial.client)
      const replacement = stripeDeletionClient({
        subscriptionId: billing.stripeSubscriptionId,
        customerId: billing.stripeCustomerId,
        listedSubscriptions: [
          stripeSubscription(billing.stripeSubscriptionId, billing.stripeCustomerId, 'canceled'),
          stripeSubscription('sub_dashboard_replacement', billing.stripeCustomerId, 'active')
        ]
      })

      await expect(
        prepareBillingAccountDeletionForConnection(fixture.connection, owner.user.id, () => replacement.client)
      ).rejects.toMatchObject({
        statusCode: 503,
        data: { code: accountDeletionBillingPendingCode }
      })
      expect(replacement.cancel).not.toHaveBeenCalled()
      expect(readDeletionRequest(fixture)).toMatchObject({
        state: 'reconciliation_required',
        reason: 'customer_has_live_subscription',
        cancellationConfirmedAt: null
      })
      expect(countUsers(fixture, owner.user.id)).toBe(1)
    } finally {
      fixture.cleanup()
    }
  })

  it('restores a missing cancellation job once and lets the existing handler confirm the request', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-missing-job@example.test')
    const billing = seedVerifiedBilling(fixture, owner, { plan: 'personal', cadence: 'monthly' })
    const unavailable = stripeDeletionClient({
      subscriptionId: billing.stripeSubscriptionId,
      customerId: billing.stripeCustomerId,
      cancelError: new Error('initial cancellation unavailable'),
      retrieveError: new Error('initial retrieval unavailable')
    })

    try {
      await expect(
        prepareBillingAccountDeletionForConnection(fixture.connection, owner.user.id, () => unavailable.client)
      ).rejects.toMatchObject({
        statusCode: 503,
        data: { code: accountDeletionBillingPendingCode }
      })
      const request = readDeletionRequest(fixture)
      fixture.sqlite.prepare('delete from job_queue where type = ?').run(billingAccountDeletionCancellationJobType)
      const now = new Date()

      expect(ensureBillingAccountDeletionCancellationJobs(fixture.connection, now)).toBe(1)
      expect(ensureBillingAccountDeletionCancellationJobs(fixture.connection, now)).toBe(0)
      expect(readDeletionJobs(fixture)).toEqual([
        expect.objectContaining({
          attempts: 0,
          maxAttempts: billingAccountDeletionCancellationMaxAttempts,
          payload: JSON.stringify({ requestId: request.id }),
          status: 'queued'
        })
      ])

      const recovered = stripeDeletionClient({
        subscriptionId: billing.stripeSubscriptionId,
        customerId: billing.stripeCustomerId
      })
      const handler = createBillingAccountDeletionCancellationJobHandler(fixture.connection, () => recovered.client)
      await expect(handler({ requestId: request.id })).resolves.toBeUndefined()
      expect(readDeletionRequest(fixture)).toMatchObject({
        state: 'cancellation_confirmed',
        reason: null,
        cancellationConfirmedAt: expect.any(String)
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('preserves an exhausted job and schedules one fresh bounded recovery generation', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-exhausted-job@example.test')
    const billing = seedVerifiedBilling(fixture, owner, { plan: 'family', cadence: 'annual' })
    const unavailable = stripeDeletionClient({
      subscriptionId: billing.stripeSubscriptionId,
      customerId: billing.stripeCustomerId,
      cancelError: new Error('terminal cancellation failure'),
      retrieveError: new Error('terminal retrieval failure')
    })

    try {
      await expect(
        prepareBillingAccountDeletionForConnection(fixture.connection, owner.user.id, () => unavailable.client)
      ).rejects.toMatchObject({
        statusCode: 503,
        data: { code: accountDeletionBillingPendingCode }
      })
      const request = readDeletionRequest(fixture)
      fixture.sqlite
        .prepare(
          `update billing_account_deletion_requests
           set state = 'reconciliation_required',
               reason = 'stripe_cancellation_unconfirmed',
               revision = revision + 1
           where id = ?`
        )
        .run(request.id)
      fixture.sqlite
        .prepare(
          `update job_queue
           set status = 'failed',
               attempts = max_attempts,
               last_error = 'JOB_HANDLER_FAILED'
           where type = ?`
        )
        .run(billingAccountDeletionCancellationJobType)
      const now = new Date()

      expect(ensureBillingAccountDeletionCancellationJobs(fixture.connection, now)).toBe(1)
      expect(ensureBillingAccountDeletionCancellationJobs(fixture.connection, now)).toBe(0)
      const jobs = readDeletionJobs(fixture)
      expect(jobs).toHaveLength(2)
      expect(jobs[0]).toMatchObject({
        attempts: billingAccountDeletionCancellationMaxAttempts,
        lastError: 'JOB_HANDLER_FAILED',
        maxAttempts: billingAccountDeletionCancellationMaxAttempts,
        status: 'failed'
      })
      expect(jobs[1]).toMatchObject({
        attempts: 0,
        lastError: null,
        maxAttempts: billingAccountDeletionCancellationMaxAttempts,
        payload: JSON.stringify({ requestId: request.id }),
        runAfter: new Date(now.getTime() + billingAccountDeletionCancellationDelayMs).toISOString(),
        status: 'queued'
      })

      const recovered = stripeDeletionClient({
        subscriptionId: billing.stripeSubscriptionId,
        customerId: billing.stripeCustomerId
      })
      const handler = createBillingAccountDeletionCancellationJobHandler(fixture.connection, () => recovered.client)
      await expect(handler({ requestId: request.id })).resolves.toBeUndefined()
      expect(readDeletionRequest(fixture)).toMatchObject({
        state: 'cancellation_confirmed',
        reason: null,
        cancellationConfirmedAt: expect.any(String)
      })
      expect(ensureBillingAccountDeletionCancellationJobs(fixture.connection, now)).toBe(0)
    } finally {
      fixture.cleanup()
    }
  })
})

function stripeDeletionClient(input: {
  subscriptionId: string
  customerId: string
  cancelError?: Error
  checkoutDiscoverySessions?: Stripe.Checkout.Session[]
  checkoutRetrieveError?: Error
  checkoutSession?: Stripe.Checkout.Session
  checkoutStatusAfterExpire?: Stripe.Checkout.Session.Status
  retrievedCustomerId?: string
  retrieveError?: Error
  listedSubscriptions?: Stripe.Subscription[]
  listHasMore?: boolean
  listError?: Error
  listCanceledAfterCancel?: boolean
}) {
  const retrievedCustomerId = input.retrievedCustomerId ?? input.customerId
  const subscription = stripeSubscription(input.subscriptionId, retrievedCustomerId, 'canceled')
  const activeSubscription = stripeSubscription(input.subscriptionId, retrievedCustomerId, 'active')
  let canceled = false
  let checkoutSessionValue = input.checkoutSession
  const cancel = vi.fn(async () => {
    canceled = true
    if (input.cancelError) throw input.cancelError
    return subscription
  })
  const retrieve = vi.fn(async (subscriptionId: string) => {
    if (input.retrieveError) throw input.retrieveError
    const listed = input.listedSubscriptions?.find((candidate) => candidate.id === subscriptionId)
    if (!canceled && listed) return listed
    return input.checkoutSession && !canceled ? activeSubscription : subscription
  })
  const list = vi.fn(async (parameters: Stripe.SubscriptionListParams) => {
    if (input.listError) throw input.listError
    const available =
      canceled && input.listCanceledAfterCancel ? [subscription] : (input.listedSubscriptions ?? [subscription])
    const matching = available.filter((candidate) => candidate.status === parameters.status)
    const limit = parameters.limit ?? 10
    const data = matching.slice(0, limit)
    return {
      object: 'list' as const,
      data,
      has_more: input.listHasMore ?? data.length < matching.length,
      url: '/v1/subscriptions'
    }
  })
  const createCheckout = vi.fn(async () => {
    if (!checkoutSessionValue) throw new Error('Checkout creation was not configured')
    return checkoutSessionValue
  })
  const listCheckout = vi.fn(async () => ({
    object: 'list' as const,
    data: input.checkoutDiscoverySessions ?? [],
    has_more: false,
    url: '/v1/checkout/sessions'
  }))
  const retrieveCheckout = vi.fn(async () => {
    if (input.checkoutRetrieveError) throw input.checkoutRetrieveError
    if (!checkoutSessionValue) throw new Error('Checkout retrieval was not configured')
    return checkoutSessionValue
  })
  const expireCheckout = vi.fn(async () => {
    if (!checkoutSessionValue) throw new Error('Checkout expiration was not configured')
    checkoutSessionValue = {
      ...checkoutSessionValue,
      status: input.checkoutStatusAfterExpire ?? 'expired',
      subscription: (input.checkoutStatusAfterExpire ?? 'expired') === 'complete' ? input.subscriptionId : null,
      customer: (input.checkoutStatusAfterExpire ?? 'expired') === 'complete' ? input.customerId : null,
      url: null
    }
    return checkoutSessionValue
  })
  const deleteCustomer = vi.fn(async () => undefined)
  return {
    cancel,
    createCheckout,
    deleteCustomer,
    expireCheckout,
    list,
    listCheckout,
    retrieve,
    retrieveCheckout,
    client: {
      checkout: {
        sessions: {
          create: createCheckout,
          expire: expireCheckout,
          list: listCheckout,
          retrieve: retrieveCheckout
        }
      },
      customers: { del: deleteCustomer },
      subscriptions: { cancel, list, retrieve }
    } as unknown as StripeBillingClient
  }
}

type SeededCheckoutAttempt = Readonly<{
  id: string
  idempotencyKey: string
  stripePriceId: string
  successUrl: string
  cancelUrl: string
}>

function seedCheckoutAttempt(
  fixture: WorkspaceInvitationFixture,
  owner: SignedInFixtureUser,
  input: Readonly<{
    id: string
    sessionId: string | null
    state: 'pending' | 'open'
    createdAt?: Date
    reuseUntil?: Date
  }>
): SeededCheckoutAttempt {
  const createdAt = input.createdAt ?? new Date()
  const reuseUntil = input.reuseUntil ?? new Date(createdAt.getTime() + 60 * 60 * 1_000)
  const attempt = {
    id: input.id,
    idempotencyKey: `checkout_${input.id}`,
    stripePriceId: fixture.config.stripe.personalMonthlyPriceId,
    successUrl: `${fixture.config.public.appUrl}/account/billing?checkout=success`,
    cancelUrl: `${fixture.config.public.appUrl}/account/billing?checkout=cancelled`
  }
  fixture.sqlite
    .prepare(
      `insert into billing_checkout_attempts (
         id, organization_id, billing_customer_id, plan_key, cadence, stripe_price_id,
         stripe_session_id, idempotency_key, state, success_url, cancel_url,
         reuse_until, created_at, updated_at
       ) values (?, ?, null, 'personal', 'monthly', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      attempt.id,
      owner.workspace.id,
      attempt.stripePriceId,
      input.sessionId,
      attempt.idempotencyKey,
      input.state,
      attempt.successUrl,
      attempt.cancelUrl,
      reuseUntil.toISOString(),
      createdAt.toISOString(),
      createdAt.toISOString()
    )
  return attempt
}

function checkoutSession(
  attempt: SeededCheckoutAttempt,
  input: Readonly<{
    id: string
    status: Stripe.Checkout.Session.Status
  }>
): Stripe.Checkout.Session {
  return {
    id: input.id,
    object: 'checkout.session',
    mode: 'subscription',
    status: input.status,
    payment_status: input.status === 'complete' ? 'paid' : 'unpaid',
    client_reference_id: attempt.id,
    metadata: { billing_attempt_id: attempt.id },
    customer: null,
    subscription: null,
    line_items: {
      object: 'list',
      data: [
        {
          id: `li_${input.id}`,
          object: 'item',
          price: { id: attempt.stripePriceId },
          quantity: 1
        } as Stripe.LineItem
      ],
      has_more: false,
      url: `/v1/checkout/sessions/${input.id}/line_items`
    },
    url: input.status === 'open' ? `https://checkout.stripe.test/session/${input.id}` : null
  } as Stripe.Checkout.Session
}

function readCheckoutAttemptState(fixture: WorkspaceInvitationFixture, attemptId: string): string {
  return (
    fixture.sqlite.prepare('select state from billing_checkout_attempts where id = ?').get(attemptId) as {
      state: string
    }
  ).state
}

function readBillingDeletionFence(fixture: WorkspaceInvitationFixture, organizationId: string): number {
  return (
    fixture.sqlite
      .prepare('select billing_deletion_pending as pending from organization where id = ?')
      .get(organizationId) as { pending: number }
  ).pending
}

function stripeSubscription(id: string, customer: string, status: Stripe.Subscription.Status): Stripe.Subscription {
  return {
    id,
    object: 'subscription',
    customer,
    status
  } as Stripe.Subscription
}

function projectedStripeSubscription(
  id: string,
  customer: string,
  status: Stripe.Subscription.Status,
  priceId: string
): Stripe.Subscription {
  return {
    ...stripeSubscription(id, customer, status),
    cancel_at_period_end: false,
    items: {
      object: 'list',
      data: [
        {
          id: `si_${id}`,
          object: 'subscription_item',
          current_period_start: 1_784_000_000,
          current_period_end: 1_786_678_400,
          price: { id: priceId },
          quantity: 1
        } as Stripe.SubscriptionItem
      ],
      has_more: false,
      url: '/v1/subscription_items'
    }
  } as Stripe.Subscription
}

function readDeletionRequest(fixture: WorkspaceInvitationFixture) {
  return fixture.sqlite
    .prepare(
      `select
        id,
        user_id as userId,
        organization_id as organizationId,
        billing_subscription_id as billingSubscriptionId,
        billing_customer_id as billingCustomerId,
        expected_stripe_subscription_id as expectedStripeSubscriptionId,
        expected_stripe_customer_id as expectedStripeCustomerId,
        captured_billing_revision as capturedBillingRevision,
        state,
        reason,
        cancellation_confirmed_at as cancellationConfirmedAt
       from billing_account_deletion_requests`
    )
    .get() as {
    id: string
    userId: string
    organizationId: string
    billingSubscriptionId: string | null
    billingCustomerId: string
    expectedStripeSubscriptionId: string | null
    expectedStripeCustomerId: string
    capturedBillingRevision: number
    state: string
    reason: string | null
    cancellationConfirmedAt: string | null
  }
}

function readDeletionJob(fixture: WorkspaceInvitationFixture) {
  return fixture.sqlite
    .prepare('select type, status, payload, attempts, max_attempts as maxAttempts from job_queue where type = ?')
    .get(billingAccountDeletionCancellationJobType) as {
    type: string
    status: string
    payload: string
    attempts: number
    maxAttempts: number
  }
}

function readDeletionJobs(fixture: WorkspaceInvitationFixture) {
  return fixture.sqlite
    .prepare(
      `select
         id,
         status,
         payload,
         attempts,
         max_attempts as maxAttempts,
         run_after as runAfter,
         last_error as lastError
       from job_queue
       where type = ?
       order by id`
    )
    .all(billingAccountDeletionCancellationJobType) as Array<{
    attempts: number
    id: number
    lastError: string | null
    maxAttempts: number
    payload: string
    runAfter: string | null
    status: string
  }>
}

function countUsers(fixture: WorkspaceInvitationFixture, userId: string) {
  return (fixture.sqlite.prepare('select count(*) as count from user where id = ?').get(userId) as { count: number })
    .count
}
