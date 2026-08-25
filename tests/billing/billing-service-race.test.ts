import type Stripe from 'stripe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureBillingStripeAccountDeletion } from '../../server/services/payments/stripe/account-deletion-store'
import {
  createBillingStripePortal,
  getBillingStripeState,
  reconcileBillingStripe,
  type BillingStripeServiceContext
} from '../../server/services/payments/stripe/billing-service'
import type { BillingStripeRuntimeConfiguration } from '../../server/services/payments/stripe/configuration'
import {
  createBillingStripeRuntimeFixture,
  seedBillingCustomer,
  seedBillingSubscription,
  seedCheckoutAttempt,
  type BillingStripeRuntimeFixture
} from './runtime-fixture'

const fixtures: BillingStripeRuntimeFixture[] = []
const now = new Date('2026-07-15T12:00:00.000Z')
const configuration = {
  enabled: true,
  appName: 'Reconciliation Test',
  appUrl: 'https://app.example.test',
  stripe: {
    secretKey: 'rk_test_reconciliation',
    webhookSecret: 'whsec_reconciliation',
    portalConfigurationId: 'bpc_reconciliation',
    prices: {
      'personal.weekly': 'price_personal_weekly',
      'personal.monthly': 'price_personal_monthly',
      'personal.annual': 'price_personal_annual',
      'family.monthly': 'price_family_monthly',
      'family.annual': 'price_family_annual'
    }
  }
} as const satisfies BillingStripeRuntimeConfiguration

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.sqlite.close()
})

describe('Billing manual reconciliation races', () => {
  it("does not expose another purchaser's billing state or Portal", async () => {
    const fixture = runtimeFixture('purchaser_isolation')
    const customerId = seedBillingCustomer(fixture, 'cus_service_purchaser_isolation')
    seedBillingSubscription(fixture, { customerId })
    const otherPurchaserUserId = 'purchaser_service_isolated'
    fixture.sqlite
      .prepare('insert into user (id, email) values (?, ?)')
      .run(otherPurchaserUserId, `${otherPurchaserUserId}@example.test`)
    const create = vi.fn()

    expect(getBillingStripeState(fixture.connection, otherPurchaserUserId, undefined, now)).toMatchObject({
      subscription: {
        state: 'none',
        offering: null
      },
      capabilities: {
        canCheckout: true,
        canManage: false,
        canReconcile: false
      }
    })
    await expect(
      createBillingStripePortal(
        serviceContext(fixture, {
          billingPortal: { sessions: { create } }
        }),
        otherPurchaserUserId
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'No manageable billing account exists'
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('keeps customer-only history fail-closed while retaining reconciliation authority', () => {
    const fixture = runtimeFixture('customer_only')
    seedBillingCustomer(fixture, 'cus_service_customer_only')

    expect(getBillingStripeState(fixture.connection, fixture.purchaserUserId, undefined, now)).toMatchObject({
      subscription: {
        state: 'reconciliation_required',
        checkoutPending: false
      },
      capabilities: {
        canCheckout: false,
        canManage: false,
        canReconcile: true
      }
    })
  })

  it.each(['checkout', 'deletion'] as const)(
    'refuses to commit provider state when a %s fence appears during provider I/O',
    async (race) => {
      const fixture = createBillingStripeRuntimeFixture(`purchaser_reconcile_${race}`)
      fixtures.push(fixture)
      seedBillingCustomer(fixture)
      let injected = false
      const provider = stripeProvider(() => {
        if (injected) return
        injected = true
        if (race === 'checkout') {
          seedCheckoutAttempt(fixture, {
            id: `attempt_reconcile_${race}`,
            customerId: `billing_customer_${fixture.purchaserUserId}`
          })
        } else {
          captureBillingStripeAccountDeletion(fixture.connection, fixture.purchaserUserId, now)
        }
      })
      const context: BillingStripeServiceContext = {
        connection: fixture.connection,
        client: provider as never,
        config: configuration
      }

      await expect(reconcileBillingStripe(context, fixture.purchaserUserId, now)).rejects.toMatchObject({
        statusCode: 409,
        statusMessage: 'Billing state changed; retry reconciliation'
      })
      expect(
        (
          fixture.sqlite
            .prepare('select count(*) as count from billing_subscriptions where purchaser_user_id = ?')
            .get(fixture.purchaserUserId) as { count: number }
        ).count
      ).toBe(0)
    }
  )

  it('fails Portal and reconciliation safely when provider state is unusable or unavailable', async () => {
    const fixture = runtimeFixture('provider_failure')
    const customerId = seedBillingCustomer(fixture, 'cus_service_failure')
    seedBillingSubscription(fixture, { customerId })

    await expect(
      createBillingStripePortal(
        serviceContext(fixture, {
          billingPortal: { sessions: { create: vi.fn(async () => ({ url: 'http://billing.invalid/session' })) } }
        }),
        fixture.purchaserUserId
      )
    ).rejects.toMatchObject({
      statusCode: 502,
      statusMessage: 'Stripe returned an unusable billing portal'
    })
    await expect(
      createBillingStripePortal(
        serviceContext(fixture, {
          billingPortal: {
            sessions: {
              create: vi.fn(async () => {
                throw new Error('private portal detail')
              })
            }
          }
        }),
        fixture.purchaserUserId
      )
    ).rejects.toMatchObject({
      statusCode: 502,
      statusMessage: 'Stripe billing management is temporarily unavailable'
    })
    await expect(
      reconcileBillingStripe(
        serviceContext(fixture, {
          subscriptions: {
            list: vi.fn(async () => {
              throw new Error('private reconciliation detail')
            })
          }
        }),
        fixture.purchaserUserId,
        now
      )
    ).rejects.toMatchObject({
      statusCode: 502,
      statusMessage: 'Stripe billing state is temporarily unavailable'
    })
    expect(
      fixture.sqlite
        .prepare('select count(*) as count from billing_subscriptions where purchaser_user_id = ?')
        .get(fixture.purchaserUserId)
    ).toEqual({ count: 1 })
  })

  it('rejects a raw customer-only Portal before provider I/O', async () => {
    const fixture = runtimeFixture('portal_customer_only')
    seedBillingCustomer(fixture, 'cus_service_portal_customer_only')
    const create = vi.fn()

    await expect(
      createBillingStripePortal(
        serviceContext(fixture, {
          billingPortal: { sessions: { create } }
        }),
        fixture.purchaserUserId
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'No manageable billing account exists'
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('keeps Portal available during reconciliation-required local subscription state', async () => {
    const fixture = runtimeFixture('portal_reconciliation')
    const customerId = seedBillingCustomer(fixture, 'cus_service_portal_reconciliation')
    seedBillingSubscription(fixture, {
      customerId,
      reconciliationRequired: true,
      reconciliationReason: 'provider_projection_ambiguous'
    })
    const create = vi.fn(
      async () =>
        ({
          id: 'bps_reconciliation',
          object: 'billing_portal.session',
          url: 'https://billing.stripe.test/session/reconciliation'
        }) as Stripe.BillingPortal.Session
    )

    await expect(
      createBillingStripePortal(
        serviceContext(fixture, {
          billingPortal: { sessions: { create } }
        }),
        fixture.purchaserUserId
      )
    ).resolves.toEqual({
      url: 'https://billing.stripe.test/session/reconciliation'
    })
    expect(create).toHaveBeenCalledWith({
      customer: 'cus_service_portal_reconciliation',
      configuration: 'bpc_reconciliation',
      return_url: 'https://app.example.test/account'
    })
  })

  it('clears reconciliation only from an unambiguous current provider read', async () => {
    const clear = runtimeFixture('reconciliation_clear')
    const clearCustomer = seedBillingCustomer(clear, 'cus_service_reconciliation_clear')
    seedBillingSubscription(clear, {
      customerId: clearCustomer,
      stripeSubscriptionId: 'sub_service_reconciliation_clear',
      stripeSubscriptionItemId: 'si_service_reconciliation_clear',
      reconciliationRequired: true,
      reconciliationReason: 'provider_projection_ambiguous'
    })
    const exact = providerSubscription({
      id: 'sub_service_reconciliation_clear',
      customer: 'cus_service_reconciliation_clear',
      itemId: 'si_service_reconciliation_clear'
    })
    await expect(
      reconcileBillingStripe(
        serviceContext(clear, {
          subscriptions: {
            retrieve: vi.fn(async () => exact),
            list: vi.fn(
              async (parameters: Stripe.SubscriptionListParams) =>
                ({
                  object: 'list',
                  data: parameters.status === 'active' ? [exact] : [],
                  has_more: false,
                  url: '/v1/subscriptions'
                }) as Stripe.ApiList<Stripe.Subscription>
            )
          }
        }),
        clear.purchaserUserId,
        now
      )
    ).resolves.toMatchObject({
      subscription: { state: 'active' }
    })
    expect(
      clear.sqlite
        .prepare(
          `select reconciliation_required as reconciliationRequired,
              reconciliation_reason as reconciliationReason
       from billing_subscriptions`
        )
        .get()
    ).toEqual({ reconciliationRequired: 0, reconciliationReason: null })

    const ambiguous = runtimeFixture('reconciliation_ambiguous')
    const ambiguousCustomer = seedBillingCustomer(ambiguous, 'cus_service_reconciliation_ambiguous')
    seedBillingSubscription(ambiguous, {
      customerId: ambiguousCustomer,
      stripeSubscriptionId: 'sub_service_reconciliation_ambiguous',
      stripeSubscriptionItemId: 'si_service_reconciliation_ambiguous',
      reconciliationRequired: true,
      reconciliationReason: 'provider_projection_ambiguous'
    })
    const expected = providerSubscription({
      id: 'sub_service_reconciliation_ambiguous',
      customer: 'cus_service_reconciliation_ambiguous',
      itemId: 'si_service_reconciliation_ambiguous'
    })
    const competing = providerSubscription({
      id: 'sub_service_reconciliation_competing',
      customer: 'cus_service_reconciliation_ambiguous',
      itemId: 'si_service_reconciliation_competing'
    })
    await expect(
      reconcileBillingStripe(
        serviceContext(ambiguous, {
          subscriptions: {
            retrieve: vi.fn(async () => expected),
            list: vi.fn(
              async (parameters: Stripe.SubscriptionListParams) =>
                ({
                  object: 'list',
                  data: parameters.status === 'active' ? [expected, competing] : [],
                  has_more: false,
                  url: '/v1/subscriptions'
                }) as Stripe.ApiList<Stripe.Subscription>
            )
          }
        }),
        ambiguous.purchaserUserId,
        now
      )
    ).resolves.toMatchObject({
      subscription: { state: 'reconciliation_required' }
    })
    expect(
      ambiguous.sqlite
        .prepare(
          `select reconciliation_required as reconciliationRequired,
              reconciliation_reason as reconciliationReason
       from billing_subscriptions`
        )
        .get()
    ).toEqual({
      reconciliationRequired: 1,
      reconciliationReason: 'multiple_live_subscriptions'
    })
  })

  it('persists the captured local subscription when Stripe verifies that exact subscription is terminal', async () => {
    const fixture = runtimeFixture('terminal_exact')
    const customerId = seedBillingCustomer(fixture, 'cus_service_terminal_exact')
    seedBillingSubscription(fixture, {
      customerId,
      stripeSubscriptionId: 'sub_service_terminal_exact',
      stripeSubscriptionItemId: 'si_service_terminal_exact'
    })
    const subscription = providerSubscription({
      id: 'sub_service_terminal_exact',
      customer: 'cus_service_terminal_exact',
      status: 'canceled',
      itemId: 'si_service_terminal_exact'
    })
    const retrieve = vi.fn(async (id: string) => {
      expect(id).toBe('sub_service_terminal_exact')
      return subscription
    })
    const list = vi.fn(
      async () =>
        ({
          object: 'list',
          data: [],
          has_more: false,
          url: '/v1/subscriptions'
        }) as Stripe.ApiList<Stripe.Subscription>
    )

    await expect(
      reconcileBillingStripe(
        serviceContext(fixture, {
          subscriptions: { retrieve, list }
        }),
        fixture.purchaserUserId,
        now
      )
    ).resolves.toMatchObject({
      subscription: { state: 'terminal' },
      capabilities: { canCheckout: true }
    })
    expect(retrieve).toHaveBeenCalledWith('sub_service_terminal_exact')
    expect(
      fixture.sqlite
        .prepare(
          `select status, stripe_subscription_id as stripeSubscriptionId,
              reconciliation_required as reconciliationRequired, revision
       from billing_subscriptions where purchaser_user_id = ?`
        )
        .get(fixture.purchaserUserId)
    ).toEqual({
      status: 'canceled',
      stripeSubscriptionId: 'sub_service_terminal_exact',
      reconciliationRequired: 0,
      revision: 1
    })
  })

  it('rejects a stale manual projection when local billing state changes during provider I/O', async () => {
    const fixture = runtimeFixture('stale_projection')
    const customerId = seedBillingCustomer(fixture, 'cus_service_stale_projection')
    seedBillingSubscription(fixture, {
      customerId,
      stripeSubscriptionId: 'sub_service_stale_projection',
      stripeSubscriptionItemId: 'si_service_stale_projection'
    })
    const subscription = providerSubscription({
      id: 'sub_service_stale_projection',
      customer: 'cus_service_stale_projection',
      itemId: 'si_service_stale_projection'
    })
    let changed = false
    const list = vi.fn(async (parameters: Stripe.SubscriptionListParams) => {
      if (!changed) {
        changed = true
        fixture.sqlite
          .prepare('update billing_subscriptions set revision = revision + 1 where purchaser_user_id = ?')
          .run(fixture.purchaserUserId)
      }
      return {
        object: 'list',
        data: parameters.status === 'active' ? [subscription] : [],
        has_more: false,
        url: '/v1/subscriptions'
      } as Stripe.ApiList<Stripe.Subscription>
    })

    await expect(
      reconcileBillingStripe(
        serviceContext(fixture, {
          subscriptions: { retrieve: vi.fn(async () => subscription), list }
        }),
        fixture.purchaserUserId,
        now
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'Billing state changed; retry reconciliation'
    })
    expect(
      fixture.sqlite
        .prepare(
          `select status, revision, reconciliation_required as reconciliationRequired
       from billing_subscriptions where purchaser_user_id = ?`
        )
        .get(fixture.purchaserUserId)
    ).toEqual({
      status: 'active',
      revision: 1,
      reconciliationRequired: 0
    })
  })

  it('withholds a Portal URL when a deletion fence appears during provider I/O', async () => {
    const fixture = runtimeFixture('portal_fence')
    const customerId = seedBillingCustomer(fixture, 'cus_service_portal_fence')
    seedBillingSubscription(fixture, { customerId })
    const create = vi.fn(async () => {
      expect(fixture.sqlite.inTransaction).toBe(false)
      captureBillingStripeAccountDeletion(fixture.connection, fixture.purchaserUserId, now)
      return { url: 'https://billing.stripe.test/session/fenced' }
    })

    await expect(
      createBillingStripePortal(
        serviceContext(fixture, {
          billingPortal: { sessions: { create } }
        }),
        fixture.purchaserUserId
      )
    ).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Billing authority changed during Portal creation'
    })
    expect(create).toHaveBeenCalledOnce()
    expect(
      fixture.sqlite
        .prepare('select state from billing_account_deletion_requests where purchaser_user_id = ?')
        .get(fixture.purchaserUserId)
    ).toEqual({ state: 'pending' })
  })

  it('blocks Portal before provider I/O once account deletion is fenced', async () => {
    const fixture = runtimeFixture('portal_pre_fence')
    seedBillingCustomer(fixture, 'cus_service_portal_pre_fence')
    captureBillingStripeAccountDeletion(fixture.connection, fixture.purchaserUserId, now)
    const create = vi.fn()

    await expect(
      createBillingStripePortal(
        serviceContext(fixture, {
          billingPortal: { sessions: { create } }
        }),
        fixture.purchaserUserId
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'Billing is locked while account deletion is pending'
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('withholds a Portal URL when application authority disappears during provider I/O', async () => {
    const fixture = runtimeFixture('portal_post_authority')
    const customerId = seedBillingCustomer(fixture, 'cus_service_portal_post_authority')
    seedBillingSubscription(fixture, { customerId })
    let authorized = true
    const create = vi.fn(async () => {
      authorized = false
      return {
        id: 'bps_authority_lost',
        object: 'billing_portal.session',
        url: 'https://billing.stripe.test/session/authority-lost'
      } as Stripe.BillingPortal.Session
    })

    await expect(
      createBillingStripePortal(
        {
          ...serviceContext(fixture, { billingPortal: { sessions: { create } } }),
          integration: {
            authorizePurchaserBilling: () => (authorized ? 'authorized' : 'authority_lost'),
            synchronizePurchaserBilling: () => undefined
          }
        },
        fixture.purchaserUserId
      )
    ).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Billing authority changed during portal'
    })
    expect(create).toHaveBeenCalledOnce()
  })

  it('rejects wrong-purchaser Portal authority before provider I/O', async () => {
    const fixture = runtimeFixture('portal_authority')
    const customerId = seedBillingCustomer(fixture, 'cus_service_portal_authority')
    seedBillingSubscription(fixture, { customerId })
    const create = vi.fn()
    await expect(
      createBillingStripePortal(
        {
          ...serviceContext(fixture, { billingPortal: { sessions: { create } } }),
          integration: {
            authorizePurchaserBilling: () => 'authority_lost',
            synchronizePurchaserBilling: () => undefined
          }
        },
        fixture.purchaserUserId
      )
    ).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Billing authority changed during portal'
    })
    expect(create).not.toHaveBeenCalled()
  })
})

function runtimeFixture(suffix: string): BillingStripeRuntimeFixture {
  const fixture = createBillingStripeRuntimeFixture(`purchaser_service_${suffix}`)
  fixtures.push(fixture)
  return fixture
}

function serviceContext(
  fixture: BillingStripeRuntimeFixture,
  client: Record<string, unknown>
): BillingStripeServiceContext {
  return {
    connection: fixture.connection,
    client: client as never,
    config: configuration
  }
}

function stripeProvider(onFirstList: () => void) {
  const provider = providerSubscription()
  return {
    subscriptions: {
      async list(parameters: Stripe.SubscriptionListParams) {
        onFirstList()
        return {
          object: 'list',
          data: parameters.status === 'active' ? [provider] : [],
          has_more: false,
          url: '/v1/subscriptions'
        } as Stripe.ApiList<Stripe.Subscription>
      },
      async retrieve(id: string) {
        expect(id).toBe(provider.id)
        return provider
      }
    }
  }
}

function providerSubscription(
  input: Readonly<{
    id?: string
    customer?: string
    status?: Stripe.Subscription.Status
    itemId?: string
  }> = {}
): Stripe.Subscription {
  return {
    id: input.id ?? 'sub_reconciled',
    object: 'subscription',
    customer: input.customer ?? 'cus_test',
    status: input.status ?? 'active',
    cancel_at_period_end: false,
    items: {
      object: 'list',
      data: [
        {
          id: input.itemId ?? 'si_reconciled',
          object: 'subscription_item',
          price: { id: 'price_family_monthly', object: 'price' },
          quantity: 1,
          current_period_start: Date.parse('2026-07-01T00:00:00.000Z') / 1_000,
          current_period_end: Date.parse('2026-08-01T00:00:00.000Z') / 1_000
        } as Stripe.SubscriptionItem
      ],
      has_more: false,
      url: `/v1/subscription_items?subscription=${input.id ?? 'sub_reconciled'}`
    }
  } as Stripe.Subscription
}
