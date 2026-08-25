import type Stripe from 'stripe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BillingStripeRuntimeConfiguration } from '../../server/services/payments/stripe/configuration'
import type { StripeBillingClient } from '../../server/services/payments/stripe/stripe-client'
import { processStripeWebhookEvent } from '../../server/services/payments/stripe/webhook'
import {
  createBillingStripeRuntimeFixture,
  seedBillingCustomer,
  seedCheckoutAttempt,
  type BillingStripeRuntimeFixture
} from './runtime-fixture'

const fixtures: BillingStripeRuntimeFixture[] = []
const webhookReadOptions = { timeout: 5_000, maxNetworkRetries: 0 } as const

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.sqlite.close()
})

describe('Stripe Checkout webhook end-to-end projection', () => {
  it.each(['checkout.session.completed', 'checkout.session.async_payment_succeeded'] as const)(
    'atomically associates %s and deduplicates concurrent delivery',
    async (eventType) => {
      const fixture = runtimeFixture(`checkout_success_${eventType.replaceAll('.', '_')}`)
      const attemptId = seedCheckoutAttempt(fixture, { id: `attempt_${eventType.replaceAll('.', '_')}` })
      const subscription = providerSubscription({
        id: `sub_${eventType.replaceAll('.', '_')}`,
        customer: `cus_${eventType.replaceAll('.', '_')}`,
        latestInvoice: initialInvoice(
          `in_${eventType.replaceAll('.', '_')}`,
          `cus_${eventType.replaceAll('.', '_')}`,
          `sub_${eventType.replaceAll('.', '_')}`
        )
      })
      const session = checkoutSession({
        id: `cs_${eventType.replaceAll('.', '_')}`,
        attemptId,
        customer: subscription.customer as string,
        subscription: subscription.id,
        paymentStatus: 'paid'
      })
      const provider = currentProvider(session, subscription)
      const event = stripeEvent(`evt_${eventType.replaceAll('.', '_')}`, eventType, session.id)

      const results = await Promise.all([
        processStripeWebhookEvent(fixture.connection, provider.client, configuration, undefined, event),
        processStripeWebhookEvent(fixture.connection, provider.client, configuration, undefined, event)
      ])

      expect(results.map((result) => result.duplicate).sort()).toEqual([false, true])
      expect(checkoutAttempt(fixture, attemptId)).toEqual({
        state: 'completed',
        stripeSessionId: session.id,
        billingCustomerId: expect.stringMatching(/^billing_customer_/)
      })
      expect(subscriptionRow(fixture)).toMatchObject({
        stripeSubscriptionId: subscription.id,
        status: 'active',
        planKey: 'family',
        cadence: 'monthly',
        reconciliationRequired: 0
      })
      expect(receiptCount(fixture)).toBe(1)
    }
  )

  it('fails closed when completed Checkout payment is still unpaid despite an active subscription', async () => {
    const fixture = runtimeFixture('checkout_unpaid')
    const attemptId = seedCheckoutAttempt(fixture, { id: 'attempt_checkout_unpaid' })
    const subscription = providerSubscription({
      id: 'sub_checkout_unpaid',
      customer: 'cus_checkout_unpaid',
      latestInvoice: initialInvoice('in_checkout_unpaid', 'cus_checkout_unpaid', 'sub_checkout_unpaid')
    })
    const session = checkoutSession({
      id: 'cs_checkout_unpaid',
      attemptId,
      customer: 'cus_checkout_unpaid',
      subscription: subscription.id,
      paymentStatus: 'unpaid'
    })

    await expect(
      processStripeWebhookEvent(
        fixture.connection,
        currentProvider(session, subscription).client,
        configuration,
        undefined,
        stripeEvent('evt_checkout_unpaid', 'checkout.session.completed', session.id)
      )
    ).resolves.toEqual({ duplicate: false, target: 'live' })

    expect(checkoutAttempt(fixture, attemptId)).toMatchObject({ state: 'reconciliation_required' })
    expect(subscriptionRow(fixture)).toMatchObject({
      status: 'active',
      reconciliationRequired: 1,
      reconciliationReason: 'unexpected_checkout_shape'
    })
    expect(grantsEntitlement(fixture)).toBe(false)
  })

  it('fails closed when asynchronous Checkout success lacks an expanded paid initial invoice', async () => {
    const fixture = runtimeFixture('checkout_no_invoice')
    const attemptId = seedCheckoutAttempt(fixture, { id: 'attempt_checkout_no_invoice' })
    const subscription = providerSubscription({
      id: 'sub_checkout_no_invoice',
      customer: 'cus_checkout_no_invoice'
    })
    const session = checkoutSession({
      id: 'cs_checkout_no_invoice',
      attemptId,
      customer: 'cus_checkout_no_invoice',
      subscription: subscription.id,
      paymentStatus: 'paid'
    })

    await expect(
      processStripeWebhookEvent(
        fixture.connection,
        currentProvider(session, subscription).client,
        configuration,
        undefined,
        stripeEvent('evt_checkout_no_invoice', 'checkout.session.async_payment_succeeded', session.id)
      )
    ).resolves.toEqual({ duplicate: false, target: 'live' })

    expect(checkoutAttempt(fixture, attemptId)).toMatchObject({ state: 'reconciliation_required' })
    expect(subscriptionRow(fixture)).toMatchObject({
      status: 'active',
      reconciliationRequired: 1,
      reconciliationReason: 'checkout_initial_invoice_unverified'
    })
    expect(grantsEntitlement(fixture)).toBe(false)
  })

  it('fails closed when asynchronous Checkout success has a paid invoice for another subscription', async () => {
    const fixture = runtimeFixture('checkout_wrong_invoice')
    const attemptId = seedCheckoutAttempt(fixture, { id: 'attempt_checkout_wrong_invoice' })
    const subscription = providerSubscription({
      id: 'sub_checkout_wrong_invoice',
      customer: 'cus_checkout_wrong_invoice',
      latestInvoice: initialInvoice('in_checkout_wrong_invoice', 'cus_checkout_wrong_invoice', 'sub_other')
    })
    const session = checkoutSession({
      id: 'cs_checkout_wrong_invoice',
      attemptId,
      customer: 'cus_checkout_wrong_invoice',
      subscription: subscription.id,
      paymentStatus: 'paid'
    })

    await expect(
      processStripeWebhookEvent(
        fixture.connection,
        currentProvider(session, subscription).client,
        configuration,
        undefined,
        stripeEvent('evt_checkout_wrong_invoice', 'checkout.session.async_payment_succeeded', session.id)
      )
    ).resolves.toEqual({ duplicate: false, target: 'live' })

    expect(subscriptionRow(fixture)).toMatchObject({
      status: 'active',
      reconciliationRequired: 1,
      reconciliationReason: 'checkout_initial_invoice_unverified'
    })
    expect(grantsEntitlement(fixture)).toBe(false)
  })

  it('does not grant an active subscription reported after asynchronous Checkout payment failure', async () => {
    const fixture = runtimeFixture('checkout_failed_active')
    const attemptId = seedCheckoutAttempt(fixture, { id: 'attempt_checkout_failed_active' })
    const subscription = providerSubscription({
      id: 'sub_checkout_failed_active',
      customer: 'cus_checkout_failed_active',
      latestInvoice: initialInvoice(
        'in_checkout_failed_active',
        'cus_checkout_failed_active',
        'sub_checkout_failed_active',
        'void'
      )
    })
    const session = checkoutSession({
      id: 'cs_checkout_failed_active',
      attemptId,
      customer: 'cus_checkout_failed_active',
      subscription: subscription.id,
      paymentStatus: 'unpaid'
    })

    await expect(
      processStripeWebhookEvent(
        fixture.connection,
        currentProvider(session, subscription).client,
        configuration,
        undefined,
        stripeEvent('evt_checkout_failed_active', 'checkout.session.async_payment_failed', session.id)
      )
    ).resolves.toEqual({ duplicate: false, target: 'live' })

    expect(checkoutAttempt(fixture, attemptId)).toMatchObject({ state: 'reconciliation_required' })
    expect(subscriptionRow(fixture)).toMatchObject({
      status: 'active',
      reconciliationRequired: 1,
      reconciliationReason: 'checkout_initial_payment_failed'
    })
    expect(grantsEntitlement(fixture)).toBe(false)
  })

  it('completes the correlated attempt when a subscription event arrives before Checkout completion', async () => {
    const fixture = runtimeFixture('subscription_first')
    const attemptId = seedCheckoutAttempt(fixture, { id: 'attempt_subscription_first' })
    const subscription = providerSubscription({
      id: 'sub_subscription_first',
      customer: 'cus_subscription_first',
      metadata: { billing_attempt_id: attemptId },
      latestInvoice: initialInvoice('in_subscription_first', 'cus_subscription_first', 'sub_subscription_first')
    })

    await expect(
      processStripeWebhookEvent(
        fixture.connection,
        currentProvider(null, subscription).client,
        configuration,
        undefined,
        stripeEvent('evt_subscription_first', 'customer.subscription.created', subscription.id)
      )
    ).resolves.toEqual({ duplicate: false, target: 'live' })

    expect(checkoutAttempt(fixture, attemptId)).toMatchObject({ state: 'completed' })
    expect(subscriptionRow(fixture)).toMatchObject({
      status: 'active',
      reconciliationRequired: 0
    })
    expect(grantsEntitlement(fixture)).toBe(true)
  })

  it('fails closed when a correlated subscription event precedes paid initial-invoice evidence', async () => {
    const fixture = runtimeFixture('subscription_unpaid')
    const attemptId = seedCheckoutAttempt(fixture, { id: 'attempt_subscription_unpaid' })
    const subscription = providerSubscription({
      id: 'sub_subscription_unpaid',
      customer: 'cus_subscription_unpaid',
      metadata: { billing_attempt_id: attemptId }
    })

    await expect(
      processStripeWebhookEvent(
        fixture.connection,
        currentProvider(null, subscription).client,
        configuration,
        undefined,
        stripeEvent('evt_subscription_unpaid', 'customer.subscription.created', subscription.id)
      )
    ).resolves.toEqual({ duplicate: false, target: 'live' })

    expect(checkoutAttempt(fixture, attemptId)).toMatchObject({ state: 'reconciliation_required' })
    expect(subscriptionRow(fixture)).toMatchObject({
      status: 'active',
      reconciliationRequired: 1,
      reconciliationReason: 'checkout_initial_invoice_unverified'
    })
    expect(grantsEntitlement(fixture)).toBe(false)
  })

  it('fails closed when Checkout reports completion without a current subscription', async () => {
    const fixture = runtimeFixture('checkout_missing_subscription')
    const attemptId = seedCheckoutAttempt(fixture, { id: 'attempt_checkout_missing_subscription' })
    const session = checkoutSession({
      id: 'cs_checkout_missing_subscription',
      attemptId,
      customer: 'cus_checkout_missing_subscription',
      subscription: null,
      paymentStatus: 'paid'
    })
    const provider = currentProvider(session, null)

    await expect(
      processStripeWebhookEvent(
        fixture.connection,
        provider.client,
        configuration,
        undefined,
        stripeEvent('evt_checkout_missing_subscription', 'checkout.session.completed', session.id)
      )
    ).resolves.toEqual({ duplicate: false, target: 'live' })

    expect(provider.retrieveSubscription).not.toHaveBeenCalled()
    expect(provider.listSubscriptions).not.toHaveBeenCalled()
    expect(checkoutAttempt(fixture, attemptId)).toMatchObject({
      state: 'reconciliation_required',
      stripeSessionId: session.id,
      billingCustomerId: expect.stringMatching(/^billing_customer_/)
    })
    expect(subscriptionRow(fixture)).toMatchObject({
      stripeSubscriptionId: null,
      status: 'ambiguous',
      reconciliationRequired: 1,
      reconciliationReason: 'checkout_completed_without_subscription'
    })
    expect(grantsEntitlement(fixture)).toBe(false)
  })

  it('receipts malformed current state without trusting an uncorrelated Checkout reference', async () => {
    const fixture = runtimeFixture('checkout_malformed')
    const attemptId = seedCheckoutAttempt(fixture, { id: 'attempt_checkout_malformed' })
    const malformedSession = checkoutSession({
      id: 'cs_checkout_malformed',
      attemptId,
      customer: 'cus_checkout_malformed',
      subscription: null,
      paymentStatus: 'paid'
    })
    malformedSession.mode = 'payment'
    malformedSession.metadata = {}
    const provider = currentProvider(malformedSession, null)

    for (const invalidEvent of [
      { ...stripeEvent('evt_missing_id', 'customer.subscription.updated', 'sub_invalid'), id: '' },
      { ...stripeEvent('evt_missing_type', 'customer.subscription.updated', 'sub_invalid'), type: '' },
      { ...stripeEvent('evt_fractional_created', 'customer.subscription.updated', 'sub_invalid'), created: 1.5 },
      { ...stripeEvent('evt_negative_created', 'customer.subscription.updated', 'sub_invalid'), created: -1 }
    ] as Stripe.Event[]) {
      await expect(
        processStripeWebhookEvent(fixture.connection, provider.client, configuration, undefined, invalidEvent)
      ).rejects.toMatchObject({ statusCode: 400 })
    }

    await expect(
      processStripeWebhookEvent(
        fixture.connection,
        provider.client,
        configuration,
        undefined,
        stripeEvent('evt_checkout_malformed', 'checkout.session.completed', malformedSession.id)
      )
    ).resolves.toEqual({ duplicate: false, target: 'ignored' })

    expect(checkoutAttempt(fixture, attemptId)).toEqual({
      state: 'pending',
      stripeSessionId: null,
      billingCustomerId: null
    })
    expect(subscriptionRow(fixture)).toBeUndefined()
    expect(provider.retrieveSubscription).not.toHaveBeenCalled()
    expect(provider.listSubscriptions).not.toHaveBeenCalled()
    expect(receiptCount(fixture)).toBe(1)
  })

  it('marks a correlated subscription event with no customer for reconciliation', async () => {
    const fixture = runtimeFixture('subscription_missing_customer')
    const attemptId = seedCheckoutAttempt(fixture, { id: 'attempt_subscription_missing_customer' })
    const subscription = providerSubscription({
      id: 'sub_subscription_missing_customer',
      customer: 'cus_placeholder',
      metadata: { billing_attempt_id: attemptId }
    })
    subscription.customer = { malformed: true } as unknown as Stripe.Customer
    const provider = currentProvider(null, subscription)

    await expect(
      processStripeWebhookEvent(
        fixture.connection,
        provider.client,
        configuration,
        undefined,
        stripeEvent('evt_subscription_missing_customer', 'customer.subscription.updated', subscription.id)
      )
    ).resolves.toEqual({ duplicate: false, target: 'live' })

    expect(checkoutAttempt(fixture, attemptId)).toMatchObject({ state: 'reconciliation_required' })
    expect(subscriptionRow(fixture)).toBeUndefined()
    expect(provider.listSubscriptions).not.toHaveBeenCalled()
    expect(receiptCount(fixture)).toBe(1)
  })

  it('does not overwrite local authority when Checkout reports a conflicting session or customer', async () => {
    const sessionFixture = runtimeFixture('checkout_session_conflict')
    const sessionCustomerId = seedBillingCustomer(sessionFixture, 'cus_checkout_session_conflict')
    const sessionAttemptId = seedCheckoutAttempt(sessionFixture, {
      id: 'attempt_checkout_session_conflict',
      customerId: sessionCustomerId,
      stripeSessionId: 'cs_checkout_original'
    })
    const sessionSubscription = providerSubscription({
      id: 'sub_checkout_session_conflict',
      customer: 'cus_checkout_session_conflict',
      latestInvoice: initialInvoice(
        'in_checkout_session_conflict',
        'cus_checkout_session_conflict',
        'sub_checkout_session_conflict'
      )
    })
    const conflictingSession = checkoutSession({
      id: 'cs_checkout_conflicting',
      attemptId: sessionAttemptId,
      customer: 'cus_checkout_session_conflict',
      subscription: sessionSubscription.id,
      paymentStatus: 'paid'
    })

    await processStripeWebhookEvent(
      sessionFixture.connection,
      currentProvider(conflictingSession, sessionSubscription).client,
      configuration,
      undefined,
      stripeEvent('evt_checkout_session_conflict', 'checkout.session.completed', conflictingSession.id)
    )
    expect(checkoutAttempt(sessionFixture, sessionAttemptId)).toEqual({
      state: 'reconciliation_required',
      stripeSessionId: 'cs_checkout_original',
      billingCustomerId: sessionCustomerId
    })
    expect(subscriptionRow(sessionFixture)).toBeUndefined()

    const customerFixture = runtimeFixture('checkout_customer_conflict')
    seedBillingCustomer(customerFixture, 'cus_checkout_original')
    const customerAttemptId = seedCheckoutAttempt(customerFixture, { id: 'attempt_checkout_customer_conflict' })
    const customerSubscription = providerSubscription({
      id: 'sub_checkout_customer_conflict',
      customer: 'cus_checkout_other',
      latestInvoice: initialInvoice(
        'in_checkout_customer_conflict',
        'cus_checkout_other',
        'sub_checkout_customer_conflict'
      )
    })
    const conflictingCustomer = checkoutSession({
      id: 'cs_checkout_customer_conflict',
      attemptId: customerAttemptId,
      customer: 'cus_checkout_other',
      subscription: customerSubscription.id,
      paymentStatus: 'paid'
    })

    await processStripeWebhookEvent(
      customerFixture.connection,
      currentProvider(conflictingCustomer, customerSubscription).client,
      configuration,
      undefined,
      stripeEvent('evt_checkout_customer_conflict', 'checkout.session.completed', conflictingCustomer.id)
    )
    expect(checkoutAttempt(customerFixture, customerAttemptId)).toEqual({
      state: 'reconciliation_required',
      stripeSessionId: null,
      billingCustomerId: null
    })
    expect(
      customerFixture.sqlite.prepare('select stripe_customer_id as stripeCustomerId from billing_customers').all()
    ).toEqual([{ stripeCustomerId: 'cus_checkout_original' }])
    expect(subscriptionRow(customerFixture)).toBeUndefined()
  })

  it('fails closed for an unknown status or noncanonical family subscription shape', async () => {
    const wrongPrice = providerSubscription({ id: 'sub_wrong_price', customer: 'cus_wrong_price' })
    wrongPrice.items.data[0]!.price = { id: 'price_unknown', object: 'price' } as Stripe.Price
    const wrongQuantity = providerSubscription({ id: 'sub_wrong_quantity', customer: 'cus_wrong_quantity' })
    wrongQuantity.items.data[0]!.quantity = 2
    const unknownStatus = providerSubscription({ id: 'sub_unknown_status', customer: 'cus_unknown_status' })
    unknownStatus.status = 'provider_future_status' as Stripe.Subscription.Status
    const unmanagedCollection = providerSubscription({
      id: 'sub_unmanaged_collection',
      customer: 'cus_unmanaged_collection'
    })
    unmanagedCollection.collection_method = 'send_invoice'

    for (const [suffix, subscription, reconciliationReason] of [
      ['wrong_price', wrongPrice, 'unrecognized_subscription_price'],
      ['wrong_quantity', wrongQuantity, 'unexpected_subscription_quantity'],
      ['unknown_status', unknownStatus, 'unknown_subscription_state'],
      ['unmanaged_collection', unmanagedCollection, 'managed_subscription_shape_mismatch']
    ] as const) {
      const fixture = runtimeFixture(`subscription_shape_${suffix}`)
      seedBillingCustomer(fixture, subscription.customer as string)
      await expect(
        processStripeWebhookEvent(
          fixture.connection,
          currentProvider(null, subscription).client,
          configuration,
          undefined,
          stripeEvent(`evt_subscription_shape_${suffix}`, 'customer.subscription.updated', subscription.id)
        )
      ).resolves.toEqual({ duplicate: false, target: 'live' })
      expect(subscriptionRow(fixture)).toMatchObject({
        reconciliationRequired: 1,
        reconciliationReason
      })
      expect(grantsEntitlement(fixture)).toBe(false)
    }
  })

  it('fails closed for mismatched customers or ambiguous subscription item lists', async () => {
    const mismatchFixture = runtimeFixture('subscription_customer_mismatch')
    seedBillingCustomer(mismatchFixture, 'cus_subscription_expected')
    const mismatched = providerSubscription({
      id: 'sub_subscription_customer_mismatch',
      customer: 'cus_subscription_other'
    })
    await expect(
      processStripeWebhookEvent(
        mismatchFixture.connection,
        currentProvider(null, mismatched).client,
        configuration,
        undefined,
        stripeEvent('evt_subscription_customer_mismatch', 'customer.subscription.updated', mismatched.id)
      )
    ).resolves.toEqual({ duplicate: false, target: 'ignored' })
    expect(subscriptionRow(mismatchFixture)).toBeUndefined()
    expect(
      mismatchFixture.sqlite.prepare('select stripe_customer_id as stripeCustomerId from billing_customers').all()
    ).toEqual([{ stripeCustomerId: 'cus_subscription_expected' }])

    const paginatedItems = providerSubscription({
      id: 'sub_subscription_paginated_items',
      customer: 'cus_subscription_paginated_items'
    })
    paginatedItems.items.has_more = true
    const missingItems = providerSubscription({
      id: 'sub_subscription_missing_items',
      customer: 'cus_subscription_missing_items'
    })
    missingItems.items.data = []
    for (const [suffix, subscription] of [
      ['paginated_items', paginatedItems],
      ['missing_items', missingItems]
    ] as const) {
      const fixture = runtimeFixture(`subscription_items_${suffix}`)
      seedBillingCustomer(fixture, subscription.customer as string)
      await processStripeWebhookEvent(
        fixture.connection,
        currentProvider(null, subscription).client,
        configuration,
        undefined,
        stripeEvent(`evt_subscription_items_${suffix}`, 'customer.subscription.updated', subscription.id)
      )
      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'ambiguous',
        reconciliationRequired: 1,
        reconciliationReason: 'unexpected_subscription_items'
      })
      expect(grantsEntitlement(fixture)).toBe(false)
    }
  })

  it('correlates the exact terminal subscription and rejects omitted quantity for access', async () => {
    const fixture = runtimeFixture('subscription_terminal_and_omitted_quantity')
    seedBillingCustomer(fixture, 'cus_subscription_terminal')
    const terminal = providerSubscription({
      id: 'sub_subscription_terminal',
      customer: 'cus_subscription_terminal'
    })
    terminal.status = 'canceled'

    await processStripeWebhookEvent(
      fixture.connection,
      currentProvider(null, terminal).client,
      configuration,
      undefined,
      stripeEvent('evt_subscription_terminal', 'customer.subscription.updated', terminal.id)
    )
    expect(subscriptionRow(fixture)).toMatchObject({
      stripeSubscriptionId: terminal.id,
      status: 'canceled',
      planKey: 'family',
      reconciliationRequired: 0,
      reconciliationReason: null
    })

    const omittedQuantity = providerSubscription({
      id: 'sub_subscription_omitted_quantity',
      customer: 'cus_subscription_terminal'
    })
    delete omittedQuantity.items.data[0]!.quantity
    await processStripeWebhookEvent(
      fixture.connection,
      currentProvider(null, omittedQuantity).client,
      configuration,
      undefined,
      {
        ...stripeEvent('evt_subscription_omitted_quantity', 'customer.subscription.updated', omittedQuantity.id),
        created: 1_785_000_001
      } as Stripe.Event
    )
    expect(subscriptionRow(fixture)).toMatchObject({
      stripeSubscriptionId: omittedQuantity.id,
      status: 'active',
      planKey: null,
      reconciliationRequired: 1,
      reconciliationReason: 'unexpected_subscription_quantity'
    })
    expect(grantsEntitlement(fixture)).toBe(false)
  })
})

function runtimeFixture(suffix: string): BillingStripeRuntimeFixture {
  const fixture = createBillingStripeRuntimeFixture(`purchaser_webhook_${suffix}`)
  fixtures.push(fixture)
  return fixture
}

function currentProvider(
  session: Stripe.Checkout.Session | null,
  subscription: Stripe.Subscription | null
): Readonly<{
  client: StripeBillingClient
  retrieveSession: ReturnType<typeof vi.fn>
  retrieveSubscription: ReturnType<typeof vi.fn>
  listSubscriptions: ReturnType<typeof vi.fn>
}> {
  const retrieveSession = vi.fn(async (id: string, parameters: unknown, options: unknown) => {
    expect(session).not.toBeNull()
    expect(id).toBe(session!.id)
    expect(parameters).toEqual({ expand: ['line_items'] })
    expect(options).toEqual(webhookReadOptions)
    return session
  })
  const retrieveSubscription = vi.fn(async (id: string, parameters?: unknown, options?: unknown) => {
    expect(subscription).not.toBeNull()
    expect(id).toBe(subscription!.id)
    if (options) expect(options).toEqual(webhookReadOptions)
    if (parameters !== undefined) {
      expect(parameters).toEqual(
        Object.prototype.hasOwnProperty.call(parameters, 'expand') ? { expand: ['latest_invoice', 'schedule'] } : {}
      )
    }
    return subscription
  })
  const listSubscriptions = vi.fn(async (parameters: Stripe.SubscriptionListParams, options?: unknown) => {
    expect(subscription).not.toBeNull()
    expect(parameters).toMatchObject({ customer: subscription!.customer, limit: 2 })
    if (options) expect(options).toEqual(webhookReadOptions)
    return {
      object: 'list',
      data: parameters.status === subscription!.status ? [subscription!] : [],
      has_more: false,
      url: '/v1/subscriptions'
    } as Stripe.ApiList<Stripe.Subscription>
  })
  return {
    client: {
      checkout: { sessions: { retrieve: retrieveSession } },
      subscriptions: { retrieve: retrieveSubscription, list: listSubscriptions }
    } as unknown as StripeBillingClient,
    retrieveSession,
    retrieveSubscription,
    listSubscriptions
  }
}

function providerSubscription(
  input: Readonly<{
    id: string
    customer: string
    metadata?: Stripe.Metadata
    latestInvoice?: Stripe.Invoice | null
  }>
): Stripe.Subscription {
  return {
    id: input.id,
    object: 'subscription',
    customer: input.customer,
    status: 'active',
    collection_method: 'charge_automatically',
    cancel_at: null,
    cancel_at_period_end: false,
    pause_collection: null,
    trial_end: null,
    discounts: [],
    billing_schedules: [],
    schedule: null,
    pending_update: null,
    latest_invoice: input.latestInvoice ?? null,
    metadata: input.metadata ?? {},
    items: {
      object: 'list',
      data: [
        {
          id: `si_${input.id}`,
          object: 'subscription_item',
          current_period_start: 1_783_920_000,
          current_period_end: 1_786_512_000,
          quantity: 1,
          price: { id: 'price_family_monthly', object: 'price' },
          discounts: []
        } as Stripe.SubscriptionItem
      ],
      has_more: false,
      url: `/v1/subscription_items?subscription=${input.id}`
    }
  } as Stripe.Subscription
}

function checkoutSession(
  input: Readonly<{
    id: string
    attemptId: string
    customer: string | null
    subscription: string | null
    paymentStatus: Stripe.Checkout.Session.PaymentStatus
  }>
): Stripe.Checkout.Session {
  return {
    id: input.id,
    object: 'checkout.session',
    mode: 'subscription',
    status: 'complete',
    payment_status: input.paymentStatus,
    client_reference_id: input.attemptId,
    customer: input.customer,
    subscription: input.subscription,
    metadata: { billing_attempt_id: input.attemptId },
    line_items: {
      object: 'list',
      data: [
        {
          id: `li_${input.id}`,
          object: 'item',
          price: { id: 'price_family_monthly', object: 'price' },
          quantity: 1
        } as Stripe.LineItem
      ],
      has_more: false,
      url: `/v1/checkout/sessions/${input.id}/line_items`
    }
  } as Stripe.Checkout.Session
}

function initialInvoice(
  id: string,
  customer: string,
  subscription: string,
  status: 'paid' | 'void' = 'paid'
): Stripe.Invoice {
  return {
    id,
    object: 'invoice',
    customer,
    status,
    collection_method: 'charge_automatically',
    billing_reason: 'subscription_create',
    attempted: true,
    attempt_count: 1,
    amount_remaining: 0,
    parent: {
      type: 'subscription_details',
      quote_details: null,
      subscription_details: { metadata: null, subscription }
    }
  } as Stripe.Invoice
}

function stripeEvent(id: string, type: Stripe.Event.Type, objectId: string): Stripe.Event {
  return {
    id,
    object: 'event',
    type,
    created: 1_785_000_000,
    data: { object: { id: objectId } }
  } as Stripe.Event
}

function checkoutAttempt(fixture: BillingStripeRuntimeFixture, attemptId: string) {
  return fixture.sqlite
    .prepare(
      `select state, stripe_session_id as stripeSessionId,
            billing_customer_id as billingCustomerId
     from billing_checkout_attempts where id = ?`
    )
    .get(attemptId)
}

function subscriptionRow(fixture: BillingStripeRuntimeFixture) {
  return fixture.sqlite
    .prepare(
      `select stripe_subscription_id as stripeSubscriptionId, status,
            plan_key as planKey, cadence,
            reconciliation_required as reconciliationRequired,
            reconciliation_reason as reconciliationReason
     from billing_subscriptions`
    )
    .get()
}

function grantsEntitlement(fixture: BillingStripeRuntimeFixture): boolean {
  const row = subscriptionRow(fixture) as
    | {
        status: string
        reconciliationRequired: number
      }
    | undefined
  return Boolean(row && row.status === 'active' && row.reconciliationRequired === 0)
}

function receiptCount(fixture: BillingStripeRuntimeFixture): number {
  return (fixture.sqlite.prepare('select count(*) as count from billing_events').get() as { count: number }).count
}

const configuration = {
  enabled: true,
  appName: 'Webhook Checkout',
  appUrl: 'https://app.example.test',
  stripe: {
    secretKey: 'rk_test_webhook_checkout',
    webhookSecret: 'whsec_webhook_checkout',
    portalConfigurationId: 'bpc_webhook_checkout',
    prices: {
      'personal.weekly': 'price_personal_weekly',
      'personal.monthly': 'price_personal_monthly',
      'personal.annual': 'price_personal_annual',
      'family.monthly': 'price_family_monthly',
      'family.annual': 'price_family_annual'
    }
  }
} as const satisfies BillingStripeRuntimeConfiguration
