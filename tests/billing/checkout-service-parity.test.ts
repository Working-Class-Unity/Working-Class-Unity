import type Stripe from 'stripe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createBillingStripeCheckout,
  reconcileBillingStripe,
  type BillingStripeServiceContext
} from '../../server/services/payments/stripe/billing-service'
import type { BillingStripeRuntimeConfiguration } from '../../server/services/payments/stripe/configuration'
import { ensureBillingCheckout, reconcileBillingCheckoutAttempt } from '../../server/services/payments/stripe/checkout'
import {
  getBillingCustomerForPurchaser,
  getOpenCheckoutAttempt
} from '../../server/services/payments/stripe/repository'
import type { StripeBillingClient } from '../../server/services/payments/stripe/stripe-client'
import {
  createBillingStripeRuntimeFixture,
  seedBillingCustomer,
  seedBillingSubscription,
  seedCheckoutAttempt,
  type BillingStripeRuntimeFixture
} from './runtime-fixture'

const fixtures: BillingStripeRuntimeFixture[] = []
const now = new Date('2026-07-31T12:00:00.000Z')

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.sqlite.close()
})

describe('Checkout service extraction parity', () => {
  it.each([
    ['personal.weekly', 'personal', 'weekly', 'price_personal_weekly'],
    ['personal.monthly', 'personal', 'monthly', 'price_personal_monthly'],
    ['personal.annual', 'personal', 'annual', 'price_personal_annual'],
    ['family.monthly', 'family', 'monthly', 'price_family_monthly'],
    ['family.annual', 'family', 'annual', 'price_family_annual']
  ] as const)(
    'derives the durable Checkout exclusively from the %s server catalog entry',
    async (offering, plan, cadence, priceId) => {
      const fixture = runtimeFixture(`catalog_${offering}`)
      const provider = checkoutProvider()

      await expect(
        ensureBillingCheckout(checkoutContext(fixture, provider.client), fixture.purchaserUserId, null, offering, now)
      ).resolves.toEqual({ url: checkoutUrl })
      expect(provider.create.mock.calls[0]?.[0]).toMatchObject({
        line_items: [{ price: priceId, quantity: 1 }]
      })
      expect(
        fixture.sqlite
          .prepare(
            `select plan_key as plan, cadence, stripe_price_id as priceId
         from billing_checkout_attempts`
          )
          .get()
      ).toEqual({ plan, cadence, priceId })
    }
  )

  it('creates one durable server-owned Checkout attempt across concurrent and sequential retries', async () => {
    const fixture = runtimeFixture('concurrent')
    const provider = checkoutProvider({ deferCreates: true })
    const context = checkoutContext(fixture, provider.client)

    const first = ensureBillingCheckout(context, fixture.purchaserUserId, null, 'family.monthly', now)
    await vi.waitFor(() => expect(provider.create).toHaveBeenCalledTimes(1))
    const concurrent = ensureBillingCheckout(context, fixture.purchaserUserId, null, 'family.monthly', now)
    await vi.waitFor(() => expect(provider.create).toHaveBeenCalledTimes(2))
    provider.releaseCreates()

    await expect(Promise.all([first, concurrent])).resolves.toEqual([{ url: checkoutUrl }, { url: checkoutUrl }])
    await expect(ensureBillingCheckout(context, fixture.purchaserUserId, null, 'family.monthly', now)).resolves.toEqual(
      { url: checkoutUrl }
    )

    expect(provider.create).toHaveBeenCalledTimes(2)
    expect(provider.retrieve).toHaveBeenCalledOnce()
    const idempotencyKeys = new Set(provider.create.mock.calls.map(([, options]) => options?.idempotencyKey))
    expect(idempotencyKeys.size).toBe(1)
    expect(provider.create.mock.calls[0]?.[0]).toMatchObject({
      mode: 'subscription',
      line_items: [{ price: 'price_family_monthly', quantity: 1 }],
      success_url: 'https://app.example.test/account?checkout=success',
      cancel_url: 'https://app.example.test/account?checkout=cancelled'
    })
    expect(attemptRows(fixture)).toEqual([expect.objectContaining({ state: 'open', stripeSessionId: 'cs_checkout_1' })])
  })

  it('reuses the same logical Checkout after an indeterminate provider failure', async () => {
    const fixture = runtimeFixture('indeterminate')
    const provider = checkoutProvider({ failFirstCreateAfterPersist: true })
    const context = checkoutContext(fixture, provider.client)

    await expect(
      ensureBillingCheckout(context, fixture.purchaserUserId, null, 'family.monthly', now)
    ).rejects.toMatchObject({ statusCode: 502 })
    expect(attemptRows(fixture)).toEqual([expect.objectContaining({ state: 'pending', stripeSessionId: null })])

    await expect(ensureBillingCheckout(context, fixture.purchaserUserId, null, 'family.monthly', now)).resolves.toEqual(
      { url: checkoutUrl }
    )
    expect(provider.create).toHaveBeenCalledTimes(2)
    expect(new Set(provider.create.mock.calls.map(([, options]) => options?.idempotencyKey)).size).toBe(1)
    expect(attemptRows(fixture)).toEqual([expect.objectContaining({ state: 'open', stripeSessionId: 'cs_checkout_1' })])
  })

  it.each([
    ['a non-subscription session', { mode: 'payment' }],
    ['a mismatched client reference', { client_reference_id: 'attempt_foreign' }],
    ['mismatched attempt metadata', { metadata: { billing_attempt_id: 'attempt_foreign' } }],
    ['a mismatched line-item Price', { line_items: checkoutLineItems('price_foreign', 1) }],
    ['a non-unit line-item quantity', { line_items: checkoutLineItems('price_family_monthly', 2) }],
    ['a completed session', { status: 'complete' }],
    ['a missing redirect URL', { url: null }],
    ['an insecure redirect URL', { url: 'http://checkout.stripe.test/session/cs_checkout_1' }],
    ['a malformed redirect URL', { url: 'not a URL' }]
  ] satisfies ReadonlyArray<readonly [string, Partial<Stripe.Checkout.Session>]>)(
    'fails closed when Stripe creates %s',
    async (_description, update) => {
      const fixture = runtimeFixture(`unusable_${String(update.mode ?? update.status ?? update.url ?? 'shape')}`)
      const provider = checkoutProvider({ createUpdate: update })

      await expect(
        ensureBillingCheckout(
          checkoutContext(fixture, provider.client),
          fixture.purchaserUserId,
          null,
          'family.monthly',
          now
        )
      ).rejects.toMatchObject({ statusCode: 502 })
      expect(attemptRows(fixture)).toEqual([
        expect.objectContaining({ state: 'reconciliation_required', stripeSessionId: 'cs_checkout_1' })
      ])
    }
  )

  it('keeps an open attempt intact when Stripe session retrieval is temporarily unavailable', async () => {
    const fixture = runtimeFixture('retrieve_failure')
    const provider = checkoutProvider()
    const context = checkoutContext(fixture, provider.client)
    await ensureBillingCheckout(context, fixture.purchaserUserId, null, 'family.monthly', now)
    provider.failNextRetrieve()

    await expect(
      ensureBillingCheckout(context, fixture.purchaserUserId, null, 'family.monthly', now)
    ).rejects.toMatchObject({ statusCode: 502 })
    expect(attemptRows(fixture)).toEqual([expect.objectContaining({ state: 'open', stripeSessionId: 'cs_checkout_1' })])
  })

  it('retires an expired Checkout and creates one new durable attempt', async () => {
    const fixture = runtimeFixture('expired_replacement')
    const provider = checkoutProvider()
    const context = checkoutContext(fixture, provider.client)
    await ensureBillingCheckout(context, fixture.purchaserUserId, null, 'family.monthly', now)
    provider.updateSession('cs_checkout_1', { status: 'expired', url: null })

    await expect(
      ensureBillingCheckout(context, fixture.purchaserUserId, null, 'family.monthly', new Date(now.getTime() + 1_000))
    ).resolves.toEqual({ url: checkoutUrl.replace('cs_checkout_1', 'cs_checkout_2') })

    expect(attemptRows(fixture)).toEqual([
      expect.objectContaining({ state: 'expired', stripeSessionId: 'cs_checkout_1' }),
      expect.objectContaining({ state: 'open', stripeSessionId: 'cs_checkout_2' })
    ])
    expect(new Set(provider.create.mock.calls.map(([, options]) => options?.idempotencyKey)).size).toBe(2)
  })

  it('requires reconciliation when a retrieved Checkout is complete but billing is unverified', async () => {
    const fixture = runtimeFixture('complete_unverified')
    const provider = checkoutProvider()
    const context = checkoutContext(fixture, provider.client)
    await ensureBillingCheckout(context, fixture.purchaserUserId, null, 'family.monthly', now)
    provider.updateSession('cs_checkout_1', { status: 'complete', customer: 'cus_complete', url: null })

    await expect(
      ensureBillingCheckout(context, fixture.purchaserUserId, null, 'family.monthly', now)
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(attemptRows(fixture)).toEqual([
      expect.objectContaining({ state: 'reconciliation_required', stripeSessionId: 'cs_checkout_1' })
    ])
  })

  it('does not overwrite a newer completed attempt with a stale Checkout retrieval', async () => {
    const fixture = runtimeFixture('stale_retrieval')
    const provider = checkoutProvider()
    const context = checkoutContext(fixture, provider.client)
    await ensureBillingCheckout(context, fixture.purchaserUserId, null, 'family.monthly', now)
    provider.onNextRetrieve(() => {
      fixture.sqlite
        .prepare("update billing_checkout_attempts set state = 'completed' where purchaser_user_id = ?")
        .run(fixture.purchaserUserId)
    })

    await expect(
      ensureBillingCheckout(context, fixture.purchaserUserId, null, 'family.monthly', now)
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(attemptRows(fixture)).toEqual([
      expect.objectContaining({ state: 'completed', stripeSessionId: 'cs_checkout_1' })
    ])
    expect(tableCount(fixture, 'detached_billing_subjects')).toBe(0)
  })

  it('allows a new Checkout from terminal history while reusing the retained Stripe customer', async () => {
    const fixture = runtimeFixture('terminal_history')
    const customerId = seedBillingCustomer(fixture, 'cus_terminal_history')
    seedBillingSubscription(fixture, {
      customerId,
      status: 'canceled'
    })
    const provider = checkoutProvider()

    await expect(
      createBillingStripeCheckout(
        serviceContext(fixture, provider.client),
        fixture.purchaserUserId,
        'family.monthly',
        now
      )
    ).resolves.toEqual({ url: checkoutUrl })

    expect(provider.create.mock.calls[0]?.[0]).toMatchObject({ customer: 'cus_terminal_history' })
    expect(attemptRows(fixture)).toEqual([expect.objectContaining({ billingCustomerId: customerId, state: 'open' })])
  })

  it('rejects a second Checkout before provider I/O when the purchaser is already entitled', async () => {
    const fixture = runtimeFixture('already_entitled')
    const customerId = seedBillingCustomer(fixture, 'cus_already_entitled')
    seedBillingSubscription(fixture, { customerId })
    const provider = checkoutProvider()

    await expect(
      createBillingStripeCheckout(
        serviceContext(fixture, provider.client),
        fixture.purchaserUserId,
        'family.monthly',
        now
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'The current billing account must be managed or reconciled'
    })
    expect(provider.create).not.toHaveBeenCalled()
    expect(provider.retrieve).not.toHaveBeenCalled()
    expect(attemptRows(fixture)).toEqual([])
  })

  it('rejects Checkout before provider I/O when an imported Stripe dues subscription is not yet projected', async () => {
    const fixture = runtimeFixture('imported_entitled')
    const provider = checkoutProvider()
    seedImportedMembership(fixture, 'entitled')

    await expect(
      createBillingStripeCheckout(
        serviceContext(fixture, provider.client),
        fixture.purchaserUserId,
        'family.monthly',
        now
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'An existing Stripe membership must be reconciled before starting another subscription'
    })
    expect(provider.create).not.toHaveBeenCalled()
    expect(provider.retrieve).not.toHaveBeenCalled()
    expect(attemptRows(fixture)).toEqual([])
  })

  it.each(['none', 'canceled', 'active'] as const)(
    'rejects Checkout with a local %s projection when imported Stripe dues remain active',
    async (status) => {
      const fixture = runtimeFixture(`imported_with_local_${status}`)
      const customerId = seedBillingCustomer(fixture, `cus_local_${status}`)
      seedBillingSubscription(
        fixture,
        status === 'none'
          ? {
              customerId,
              stripeSubscriptionId: null,
              stripeSubscriptionItemId: null,
              status,
              planKey: null,
              cadence: null,
              stripePriceId: null,
              currentPeriodStart: null,
              currentPeriodEnd: null
            }
          : {
              customerId,
              stripeSubscriptionId: `sub_local_${status}`,
              stripeSubscriptionItemId: `si_local_${status}`,
              status,
              planKey: 'personal',
              cadence: 'monthly',
              stripePriceId: 'price_personal_monthly',
              currentPeriodStart: '2026-06-01T00:00:00.000Z',
              currentPeriodEnd: status === 'active' ? '2026-08-01T00:00:00.000Z' : '2026-07-01T00:00:00.000Z'
            }
      )
      seedImportedMembership(fixture, `with_local_${status}`)
      const provider = checkoutProvider()

      await expect(
        createBillingStripeCheckout(
          serviceContext(fixture, provider.client),
          fixture.purchaserUserId,
          'family.monthly',
          now
        )
      ).rejects.toMatchObject({
        statusCode: 409,
        statusMessage: 'An existing Stripe membership must be reconciled before starting another subscription'
      })
      expect(provider.create).not.toHaveBeenCalled()
      expect(provider.retrieve).not.toHaveBeenCalled()
      expect(attemptRows(fixture)).toEqual([])
    }
  )

  it('rejects Checkout before provider I/O while canonical identity review is pending', async () => {
    const fixture = runtimeFixture('identity_review_pending')
    const provider = checkoutProvider()
    fixture.sqlite
      .prepare(
        `insert into identity_link_reviews
           (id, user_id, reason, identifier_hash, status)
         values (
           'identity_review_22222222-2222-4222-8222-222222222222',
           ?, 'ambiguous_verified_email', ?, 'open'
         )`
      )
      .run(fixture.purchaserUserId, 'b'.repeat(64))

    await expect(
      createBillingStripeCheckout(
        serviceContext(fixture, provider.client),
        fixture.purchaserUserId,
        'personal.monthly',
        now
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'Account identity must be reviewed before starting another subscription'
    })
    expect(provider.create).not.toHaveBeenCalled()
    expect(provider.retrieve).not.toHaveBeenCalled()
    expect(attemptRows(fixture)).toEqual([])
  })

  it('reuses an established Customer only after an unambiguous empty provider projection', async () => {
    const fixture = runtimeFixture('empty_projection_customer')
    const customerId = seedBillingCustomer(fixture, 'cus_empty_projection')
    seedBillingSubscription(fixture, {
      customerId,
      stripeSubscriptionId: null,
      stripeSubscriptionItemId: null,
      status: 'none',
      planKey: null,
      cadence: null,
      stripePriceId: null,
      currentPeriodStart: null,
      currentPeriodEnd: null
    })
    const provider = checkoutProvider()

    await expect(
      createBillingStripeCheckout(
        serviceContext(fixture, provider.client),
        fixture.purchaserUserId,
        'personal.monthly',
        now
      )
    ).resolves.toEqual({ url: checkoutUrl })
    expect(provider.create.mock.calls[0]?.[0]).toMatchObject({
      customer: 'cus_empty_projection',
      line_items: [{ price: 'price_personal_monthly', quantity: 1 }]
    })
    expect(attemptRows(fixture)).toEqual([expect.objectContaining({ billingCustomerId: customerId, state: 'open' })])
  })

  it('rechecks eligibility after reservation and before provider I/O', async () => {
    const fixture = runtimeFixture('eligibility_changed_after_reservation')
    const provider = checkoutProvider()
    let eligibilityChecks = 0
    const context = {
      ...checkoutContext(fixture, provider.client),
      assertCheckoutAllowed() {
        eligibilityChecks += 1
        if (eligibilityChecks === 3) throw new Error('Checkout identity review became pending')
      }
    }

    await expect(ensureBillingCheckout(context, fixture.purchaserUserId, null, 'family.monthly', now)).rejects.toThrow(
      'Checkout identity review became pending'
    )
    expect(eligibilityChecks).toBe(3)
    expect(provider.create).not.toHaveBeenCalled()
    expect(provider.retrieve).not.toHaveBeenCalled()
    expect(attemptRows(fixture)).toEqual([expect.objectContaining({ state: 'pending' })])
  })

  it('does not return Checkout when eligibility changes during provider I/O', async () => {
    const fixture = runtimeFixture('eligibility_changed_during_provider')
    const provider = checkoutProvider({ deferCreates: true })
    let blocked = false
    const context = {
      ...checkoutContext(fixture, provider.client),
      assertCheckoutAllowed() {
        if (blocked) throw new Error('Checkout identity review became pending during provider I/O')
      }
    }

    const checkout = ensureBillingCheckout(context, fixture.purchaserUserId, null, 'family.monthly', now)
    await vi.waitFor(() => expect(provider.create).toHaveBeenCalledOnce())
    blocked = true
    provider.releaseCreates()

    await expect(checkout).rejects.toThrow('Checkout identity review became pending during provider I/O')
    expect(provider.create).toHaveBeenCalledOnce()
    expect(attemptRows(fixture)).toEqual([expect.objectContaining({ state: 'pending', stripeSessionId: null })])
  })

  it('rejects an asynchronous authorization callback and rolls back the Checkout reservation', async () => {
    const fixture = runtimeFixture('async_authorization')
    const provider = checkoutProvider()
    const context: BillingStripeServiceContext = {
      ...checkoutContext(fixture, provider.client),
      integration: {
        authorizePurchaserBilling: (() => Promise.resolve('authorized')) as never,
        synchronizePurchaserBilling: () => undefined
      }
    }

    await expect(ensureBillingCheckout(context, fixture.purchaserUserId, null, 'family.monthly', now)).rejects.toThrow(
      'Billing Stripe authorization callback must return a closed synchronous result'
    )
    expect(provider.create).not.toHaveBeenCalled()
    expect(attemptRows(fixture)).toEqual([])
  })
})

describe('Checkout reconciliation extraction parity', () => {
  it('fails closed when reconciliation finds more than one matching Checkout', async () => {
    const scenario = await openCheckoutScenario('multiple')
    const attempt = requireOpenAttempt(scenario.fixture)
    scenario.provider.replaceListedSessions([
      scenario.provider.session('cs_checkout_1')!,
      { ...scenario.provider.session('cs_checkout_1')!, id: 'cs_checkout_duplicate' }
    ])

    await expect(
      reconcileBillingCheckoutAttempt(scenario.context, scenario.fixture.purchaserUserId, attempt, now)
    ).resolves.toEqual({ customer: null, blocked: true })
    expect(attemptRows(scenario.fixture)[0]).toMatchObject({ state: 'reconciliation_required' })
  })

  it.each([
    ['expired', new Date('2026-08-01T00:00:01.000Z'), 'failed', false],
    ['valid', now, 'open', false]
  ] as const)(
    'keeps a not-found %s attempt bounded by its reconciliation window',
    async (suffix, reconciliationTime, expectedState, blocked) => {
      const scenario = await openCheckoutScenario(`not_found_${suffix}`)
      scenario.provider.replaceListedSessions([])
      if (suffix === 'expired') {
        scenario.fixture.sqlite
          .prepare(
            `update billing_checkout_attempts
           set created_at = '2026-07-01T00:00:00.000Z', reuse_until = '2026-07-02T00:00:00.000Z'`
          )
          .run()
      }
      const attempt = requireOpenAttempt(scenario.fixture)

      await expect(
        reconcileBillingCheckoutAttempt(scenario.context, scenario.fixture.purchaserUserId, attempt, reconciliationTime)
      ).resolves.toMatchObject({ blocked })
      expect(attemptRows(scenario.fixture)[0]).toMatchObject({ state: expectedState })
    }
  )

  it('preserves local state when Stripe Checkout discovery is temporarily unavailable', async () => {
    const scenario = await openCheckoutScenario('list_failure')
    const attempt = requireOpenAttempt(scenario.fixture)
    scenario.provider.failNextList()

    await expect(
      reconcileBillingCheckoutAttempt(scenario.context, scenario.fixture.purchaserUserId, attempt, now)
    ).rejects.toMatchObject({ statusCode: 502 })
    expect(attemptRows(scenario.fixture)[0]).toMatchObject({ state: 'open' })
  })

  it('rejects reconciliation when ownership disappears during Checkout discovery', async () => {
    const fixture = runtimeFixture('discovery_authority')
    const provider = checkoutProvider()
    let authorized = true
    const context: BillingStripeServiceContext = {
      ...checkoutContext(fixture, provider.client),
      integration: {
        authorizePurchaserBilling: () => (authorized ? 'authorized' : 'authority_lost'),
        synchronizePurchaserBilling: () => undefined
      }
    }
    await ensureBillingCheckout(context, fixture.purchaserUserId, null, 'family.monthly', now)
    provider.onNextList(() => {
      authorized = false
    })
    const attempt = requireOpenAttempt(fixture)

    await expect(reconcileBillingCheckoutAttempt(context, fixture.purchaserUserId, attempt, now)).rejects.toMatchObject(
      { statusCode: 403 }
    )
    expect(attemptRows(fixture)[0]).toMatchObject({ state: 'open' })
  })

  it.each([
    ['a non-subscription session', { mode: 'payment' }],
    ['an open session without a safe URL', { status: 'open', url: 'http://checkout.stripe.test/session' }],
    ['a completed session without a Customer', { status: 'complete', customer: null, url: null }],
    ['an unexpected session state', { status: null, url: null }]
  ] satisfies ReadonlyArray<readonly [string, Partial<Stripe.Checkout.Session>]>)(
    'keeps reconciliation closed for %s',
    async (_description, update) => {
      const scenario = await openCheckoutScenario(`invalid_${String(update.mode ?? update.status ?? 'state')}`)
      scenario.provider.updateSession('cs_checkout_1', update)
      const attempt = requireOpenAttempt(scenario.fixture)

      await expect(
        reconcileBillingCheckoutAttempt(scenario.context, scenario.fixture.purchaserUserId, attempt, now)
      ).resolves.toEqual({ customer: null, blocked: true })
      expect(attemptRows(scenario.fixture)[0]).toMatchObject({ state: 'reconciliation_required' })
    }
  )

  it('accepts an expired Checkout observation without creating billing authority', async () => {
    const scenario = await openCheckoutScenario('observed_expired')
    scenario.provider.updateSession('cs_checkout_1', { status: 'expired', url: null })
    const attempt = requireOpenAttempt(scenario.fixture)

    await expect(
      reconcileBillingCheckoutAttempt(scenario.context, scenario.fixture.purchaserUserId, attempt, now)
    ).resolves.toEqual({ customer: null, blocked: false })
    expect(attemptRows(scenario.fixture)[0]).toMatchObject({ state: 'expired' })
    expect(tableCount(scenario.fixture, 'billing_customers')).toBe(0)
  })

  it('recovers one completed Checkout from reconciliation without choosing among sessions', async () => {
    const scenario = await openCheckoutScenario('observed_complete')
    scenario.provider.updateSession('cs_checkout_1', {
      status: 'complete',
      customer: 'cus_checkout_complete',
      url: null
    })
    const attempt = requireOpenAttempt(scenario.fixture)

    await expect(
      reconcileBillingCheckoutAttempt(scenario.context, scenario.fixture.purchaserUserId, attempt, now)
    ).resolves.toMatchObject({
      blocked: false,
      customer: { stripeCustomerId: 'cus_checkout_complete' }
    })
    expect(attemptRows(scenario.fixture)[0]).toMatchObject({ state: 'completed' })
  })

  it('refuses to attach a completed Checkout to a different local Customer', async () => {
    const scenario = await openCheckoutScenario('customer_conflict')
    seedBillingCustomer(scenario.fixture, 'cus_existing')
    scenario.provider.updateSession('cs_checkout_1', {
      status: 'complete',
      customer: 'cus_foreign',
      url: null
    })
    const attempt = requireOpenAttempt(scenario.fixture)

    await expect(
      reconcileBillingCheckoutAttempt(scenario.context, scenario.fixture.purchaserUserId, attempt, now)
    ).resolves.toEqual({ customer: null, blocked: true })
    expect(attemptRows(scenario.fixture)[0]).toMatchObject({
      state: 'reconciliation_required',
      billingCustomerId: null
    })
    expect(customerRows(scenario.fixture)).toEqual([{ stripeCustomerId: 'cus_existing' }])
  })

  it('fails closed when Stripe becomes active while reconciliation observes an open Checkout', async () => {
    const fixture = runtimeFixture('provider_overlap')
    const checkout = checkoutProvider()
    const context = serviceContext(fixture, {
      ...checkout.client,
      subscriptions: subscriptionProvider('cus_overlap').subscriptions
    } as StripeBillingClient)
    seedBillingCustomer(fixture, 'cus_overlap')
    const customer = getBillingCustomerForPurchaser(fixture.connection, fixture.purchaserUserId)
    if (!customer) throw new Error('Expected seeded Billing Customer')
    await ensureBillingCheckout(context, fixture.purchaserUserId, customer, 'family.monthly', now)

    await expect(reconcileBillingStripe(context, fixture.purchaserUserId, now)).resolves.toMatchObject({
      subscription: { state: 'reconciliation_required', checkoutPending: false },
      capabilities: { canCheckout: false }
    })
    expect(attemptRows(fixture)[0]).toMatchObject({ state: 'reconciliation_required' })
    expect(subscriptionRows(fixture)).toEqual([
      expect.objectContaining({
        status: 'active',
        reconciliationRequired: 1,
        reconciliationReason: 'overlapping_checkout_attempt'
      })
    ])
  })

  it('keeps reconciliation closed while a second Checkout remains open beside a subscription', async () => {
    const fixture = runtimeFixture('local_subscription_overlap')
    const customerId = seedBillingCustomer(fixture, 'cus_local_subscription_overlap')
    seedBillingSubscription(fixture, { customerId })
    seedCheckoutAttempt(fixture, {
      id: 'attempt_local_subscription_overlap',
      customerId,
      state: 'reconciliation_required'
    })
    const subscriptionList = vi.fn()
    const checkoutList = vi.fn(
      async () =>
        ({
          object: 'list',
          data: [],
          has_more: false,
          url: '/v1/checkout/sessions'
        }) as Stripe.ApiList<Stripe.Checkout.Session>
    )

    await expect(
      reconcileBillingStripe(
        serviceContext(fixture, {
          checkout: { sessions: { list: checkoutList } },
          subscriptions: { list: subscriptionList }
        } as unknown as StripeBillingClient),
        fixture.purchaserUserId,
        now
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'Checkout state still requires reconciliation'
    })
    expect(checkoutList).toHaveBeenCalledOnce()
    expect(subscriptionList).not.toHaveBeenCalled()
    expect(attemptRows(fixture)[0]).toMatchObject({ state: 'reconciliation_required' })
    expect(subscriptionRows(fixture)[0]).toMatchObject({
      status: 'active',
      reconciliationRequired: 0
    })
  })
})

async function openCheckoutScenario(suffix: string) {
  const fixture = runtimeFixture(suffix)
  const provider = checkoutProvider()
  const context = checkoutContext(fixture, provider.client)
  await ensureBillingCheckout(context, fixture.purchaserUserId, null, 'family.monthly', now)
  return { fixture, provider, context }
}

function seedImportedMembership(fixture: BillingStripeRuntimeFixture, suffix: string): void {
  fixture.sqlite.exec(`
    insert into people (id) values ('person_imported_${suffix}');
    insert into person_accounts (person_id, user_id)
      values ('person_imported_${suffix}', '${fixture.purchaserUserId}');
    insert into stripe_customers (id, person_id)
      values ('cus_imported_${suffix}', 'person_imported_${suffix}');
    insert into stripe_subscriptions (
      id, customer_id, status, current_period_start, current_period_end
    ) values (
      'sub_imported_${suffix}', 'cus_imported_${suffix}', 'active',
      '2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
    );
    insert into stripe_subscription_items (id, subscription_id, price_id)
      values ('si_imported_${suffix}', 'sub_imported_${suffix}', 'price_personal_monthly');
  `)
}

function runtimeFixture(suffix: string): BillingStripeRuntimeFixture {
  const fixture = createBillingStripeRuntimeFixture(`purchaser_checkout_parity_${suffix.replace(/[^a-z0-9]/gi, '_')}`)
  fixtures.push(fixture)
  return fixture
}

function checkoutContext(
  fixture: BillingStripeRuntimeFixture,
  client: StripeBillingClient
): BillingStripeServiceContext {
  return serviceContext(fixture, client)
}

function serviceContext(
  fixture: BillingStripeRuntimeFixture,
  client: StripeBillingClient
): BillingStripeServiceContext {
  return { connection: fixture.connection, client, config: configuration }
}

function checkoutProvider(
  input: Readonly<{
    deferCreates?: boolean
    failFirstCreateAfterPersist?: boolean
    createUpdate?: Partial<Stripe.Checkout.Session>
  }> = {}
) {
  const sessions = new Map<string, Stripe.Checkout.Session>()
  const sessionByIdempotency = new Map<string, Stripe.Checkout.Session>()
  let listedSessions: Stripe.Checkout.Session[] | null = null
  let createSequence = 0
  let failCreate = input.failFirstCreateAfterPersist === true
  let failRetrieve = false
  let failList = false
  let nextRetrieveHook: (() => void) | null = null
  let nextListHook: (() => void) | null = null
  let createRelease: (() => void) | null = null
  const createGate = input.deferCreates
    ? new Promise<void>((resolve) => {
        createRelease = resolve
      })
    : null

  const create = vi.fn(async (parameters: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions) => {
    if (createGate) await createGate
    const key = String(options?.idempotencyKey)
    let session = sessionByIdempotency.get(key)
    if (!session) {
      createSequence += 1
      session = {
        ...checkoutSession(parameters.client_reference_id!, `cs_checkout_${createSequence}`, {
          customer: typeof parameters.customer === 'string' ? parameters.customer : null,
          priceId: parameters.line_items?.[0]?.price as string
        }),
        ...input.createUpdate
      } as Stripe.Checkout.Session
      sessionByIdempotency.set(key, session)
      sessions.set(session.id, session)
    }
    if (failCreate) {
      failCreate = false
      throw new Error('lost Checkout create response')
    }
    return session
  })
  const retrieve = vi.fn(async (id: string) => {
    if (failRetrieve) {
      failRetrieve = false
      throw new Error('Checkout retrieval unavailable')
    }
    nextRetrieveHook?.()
    nextRetrieveHook = null
    const session = sessions.get(id)
    if (!session) throw new Error('unknown Checkout Session')
    return session
  })
  const list = vi.fn(async () => {
    if (failList) {
      failList = false
      throw new Error('Checkout discovery unavailable')
    }
    nextListHook?.()
    nextListHook = null
    return {
      object: 'list',
      data: listedSessions ?? [...sessions.values()],
      has_more: false,
      url: '/v1/checkout/sessions'
    } as Stripe.ApiList<Stripe.Checkout.Session>
  })
  const client = {
    checkout: { sessions: { create, retrieve, list } }
  } as unknown as StripeBillingClient
  return {
    client,
    create,
    retrieve,
    list,
    releaseCreates() {
      createRelease?.()
    },
    failNextRetrieve() {
      failRetrieve = true
    },
    failNextList() {
      failList = true
    },
    onNextRetrieve(hook: () => void) {
      nextRetrieveHook = hook
    },
    onNextList(hook: () => void) {
      nextListHook = hook
    },
    replaceListedSessions(next: Stripe.Checkout.Session[]) {
      listedSessions = next
    },
    updateSession(id: string, update: Partial<Stripe.Checkout.Session>) {
      const current = sessions.get(id)
      if (!current) throw new Error(`Unknown Checkout Session ${id}`)
      const updated = { ...current, ...update } as Stripe.Checkout.Session
      sessions.set(id, updated)
      for (const [key, value] of sessionByIdempotency) {
        if (value.id === id) sessionByIdempotency.set(key, updated)
      }
    },
    session(id: string) {
      return sessions.get(id)
    }
  }
}

function subscriptionProvider(customerId: string) {
  const subscription = providerSubscription(customerId)
  return {
    subscriptions: {
      list: vi.fn(
        async (parameters: Stripe.SubscriptionListParams) =>
          ({
            object: 'list',
            data: parameters.status === 'active' ? [subscription] : [],
            has_more: false,
            url: '/v1/subscriptions'
          }) as Stripe.ApiList<Stripe.Subscription>
      ),
      retrieve: vi.fn(async () => subscription)
    }
  }
}

function providerSubscription(customerId: string): Stripe.Subscription {
  return {
    id: 'sub_overlap',
    object: 'subscription',
    customer: customerId,
    status: 'active',
    cancel_at_period_end: false,
    items: {
      object: 'list',
      data: [
        {
          id: 'si_overlap',
          object: 'subscription_item',
          price: { id: 'price_family_monthly', object: 'price' },
          quantity: 1,
          current_period_start: 1_783_920_000,
          current_period_end: 1_786_512_000
        } as Stripe.SubscriptionItem
      ],
      has_more: false,
      url: '/v1/subscription_items?subscription=sub_overlap'
    }
  } as Stripe.Subscription
}

function checkoutSession(
  attemptId: string,
  id: string,
  input: Readonly<{ customer?: string | null; priceId?: string }> = {}
): Stripe.Checkout.Session {
  return {
    id,
    object: 'checkout.session',
    mode: 'subscription',
    status: 'open',
    payment_status: 'unpaid',
    client_reference_id: attemptId,
    customer: input.customer ?? null,
    subscription: null,
    metadata: { billing_attempt_id: attemptId },
    line_items: checkoutLineItems(input.priceId ?? 'price_family_monthly', 1),
    url: checkoutUrl.replace('cs_checkout_1', id)
  } as Stripe.Checkout.Session
}

function checkoutLineItems(priceId: string, quantity: number): Stripe.ApiList<Stripe.LineItem> {
  return {
    object: 'list',
    data: [
      {
        id: 'li_checkout',
        object: 'item',
        price: { id: priceId, object: 'price' },
        quantity
      } as Stripe.LineItem
    ],
    has_more: false,
    url: '/v1/checkout/sessions/cs_checkout/line_items'
  }
}

function requireOpenAttempt(fixture: BillingStripeRuntimeFixture) {
  const attempt = getOpenCheckoutAttempt(fixture.connection, fixture.purchaserUserId)
  if (!attempt) throw new Error('Expected an open Checkout attempt')
  return attempt
}

function attemptRows(fixture: BillingStripeRuntimeFixture) {
  return fixture.sqlite
    .prepare(
      `select id, billing_customer_id as billingCustomerId,
            stripe_session_id as stripeSessionId, idempotency_key as idempotencyKey, state
     from billing_checkout_attempts order by created_at, id`
    )
    .all()
}

function customerRows(fixture: BillingStripeRuntimeFixture) {
  return fixture.sqlite
    .prepare('select stripe_customer_id as stripeCustomerId from billing_customers order by id')
    .all()
}

function subscriptionRows(fixture: BillingStripeRuntimeFixture) {
  return fixture.sqlite
    .prepare(
      `select status, reconciliation_required as reconciliationRequired,
            reconciliation_reason as reconciliationReason
     from billing_subscriptions order by id`
    )
    .all()
}

function tableCount(fixture: BillingStripeRuntimeFixture, table: string): number {
  return (fixture.sqlite.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count
}

const checkoutUrl = 'https://checkout.stripe.test/session/cs_checkout_1'
const configuration = {
  enabled: true,
  appName: 'Checkout Parity',
  appUrl: 'https://app.example.test',
  stripe: {
    secretKey: 'rk_test_checkout_parity',
    webhookSecret: 'whsec_checkout_parity',
    portalConfigurationId: 'bpc_checkout_parity',
    prices: {
      'personal.weekly': 'price_personal_weekly',
      'personal.monthly': 'price_personal_monthly',
      'personal.annual': 'price_personal_annual',
      'family.monthly': 'price_family_monthly',
      'family.annual': 'price_family_annual'
    }
  }
} as const satisfies BillingStripeRuntimeConfiguration
