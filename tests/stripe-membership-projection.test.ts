import type Stripe from 'stripe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readWebsiteMembershipAccess } from '../server/services/membership/member-access'
import { createStripeBillingCatalog } from '../server/services/payments/stripe/catalog'
import { applyStripeEventObservation } from '../server/services/payments/stripe/event-store'
import type { StripeEventObservation } from '../server/services/payments/stripe/webhook'
import { processStripeWebhookEvent } from '../server/services/payments/stripe/webhook'
import type { BillingStripeRuntimeConfiguration } from '../server/services/payments/stripe/configuration'
import {
  createBillingStripeRuntimeFixture,
  seedAccountStripeMembership,
  type BillingStripeRuntimeFixture
} from './billing/runtime-fixture'

const fixtures: BillingStripeRuntimeFixture[] = []
const prices = {
  'personal.weekly': '',
  'personal.monthly': 'price_member',
  'personal.annual': '',
  'family.monthly': 'price_solidarity',
  'family.annual': ''
} as const
const configuration = {
  enabled: true,
  appName: 'Membership projection test',
  appUrl: 'https://app.example.test',
  stripe: {
    secretKey: 'rk_test_membership_projection',
    webhookSecret: 'whsec_membership_projection',
    portalConfigurationId: 'bpc_membership_projection',
    prices
  }
} as const satisfies BillingStripeRuntimeConfiguration
const catalog = createStripeBillingCatalog(prices)

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.sqlite.close()
  vi.restoreAllMocks()
})

describe('Stripe-first membership status projection', () => {
  it.each([
    ['supporter', 'active', false, 'none'],
    ['member', 'active', true, 'active'],
    ['solidarity', 'active', true, 'active'],
    ['member', 'past_due', false, 'suspended'],
    ['member', 'unpaid', false, 'suspended'],
    ['member', 'canceled', false, 'terminal']
  ] as const)('maps %s with Stripe %s to the expected access', (tier, status, granted, state) => {
    const fixture = runtimeFixture(`${tier}_${status}`)
    seedMembership(fixture, tier)

    expect(
      applyStripeEventObservation(fixture.connection, undefined, observation(fixture, tier, status, 100), now(100))
    ).toEqual({ duplicate: false, target: 'live' })
    expect(readWebsiteMembershipAccess(fixture.connection, fixture.purchaserUserId, prices)).toMatchObject({
      granted,
      state
    })
    expect(projectedStatus(fixture)).toMatchObject({ status, projectionOrderMs: 100_000 })
  })

  it.each(['customer', 'price', 'quantity', 'tier'] as const)(
    'fails closed for a mismatched subscription %s',
    (mismatch) => {
      const fixture = runtimeFixture(`mismatch_${mismatch}`)
      seedMembership(fixture, 'member')
      const current = subscription(fixture, 'member', 'active')
      if (mismatch === 'customer') current.customer = 'cus_other'
      if (mismatch === 'price') current.items.data[0]!.price = { id: 'price_other', object: 'price' } as Stripe.Price
      if (mismatch === 'quantity') current.items.data[0]!.quantity = 2
      if (mismatch === 'tier') current.metadata.wcu_membership_tier = 'solidarity'

      applyStripeEventObservation(
        fixture.connection,
        undefined,
        observation(fixture, 'member', 'active', 100, { subscription: current }),
        now(100)
      )
      expect(projectedStatus(fixture).status).toBeNull()
      expect(readWebsiteMembershipAccess(fixture.connection, fixture.purchaserUserId, prices)).toMatchObject({
        granted: false,
        state: 'reconciliation_required'
      })
    }
  )

  it('fails closed for equal-time conflicting provider reads', () => {
    const fixture = runtimeFixture('equal_order')
    seedMembership(fixture, 'member')
    applyStripeEventObservation(
      fixture.connection,
      undefined,
      observation(fixture, 'member', 'canceled', 200),
      now(200)
    )
    applyStripeEventObservation(fixture.connection, undefined, observation(fixture, 'member', 'active', 200), now(201))
    expect(projectedStatus(fixture).status).toBeNull()
  })

  it('deduplicates delivery and never lets an older observation restore access', () => {
    const fixture = runtimeFixture('ordering')
    seedMembership(fixture, 'member')
    const canceled = observation(fixture, 'member', 'canceled', 200)
    expect(applyStripeEventObservation(fixture.connection, undefined, canceled, now(200)).duplicate).toBe(false)
    expect(applyStripeEventObservation(fixture.connection, undefined, canceled, now(201)).duplicate).toBe(true)

    applyStripeEventObservation(fixture.connection, undefined, observation(fixture, 'member', 'active', 100), now(202))
    expect(projectedStatus(fixture)).toMatchObject({ status: null, projectionOrderMs: 200_000 })
    expect(readWebsiteMembershipAccess(fixture.connection, fixture.purchaserUserId, prices).granted).toBe(false)
  })

  it('uses the existing webhook fresh-read path for an exact linked subscription', async () => {
    const fixture = runtimeFixture('fresh_webhook')
    seedMembership(fixture, 'solidarity')
    const current = subscription(fixture, 'solidarity', 'past_due')
    const retrieve = vi.fn(async () => current)
    const list = vi.fn(async (parameters: Stripe.SubscriptionListParams) =>
      stripePage(parameters.status === 'past_due' ? [current] : [])
    )

    await expect(
      processStripeWebhookEvent(
        fixture.connection,
        { subscriptions: { retrieve, list } } as never,
        configuration,
        undefined,
        {
          id: 'evt_fresh_webhook',
          type: 'customer.subscription.updated',
          created: 300,
          data: { object: { id: current.id } }
        } as Stripe.Event
      )
    ).resolves.toEqual({ duplicate: false, target: 'live' })

    expect(retrieve).toHaveBeenCalled()
    expect(list).toHaveBeenCalled()
    expect(projectedStatus(fixture).status).toBe('past_due')
    expect(readWebsiteMembershipAccess(fixture.connection, fixture.purchaserUserId, prices).granted).toBe(false)

    retrieve.mockResolvedValueOnce({ ...current, id: 'sub_other' })
    await processStripeWebhookEvent(
      fixture.connection,
      { subscriptions: { retrieve, list } } as never,
      configuration,
      undefined,
      {
        id: 'evt_subscription_mismatch',
        type: 'customer.subscription.updated',
        created: 400,
        data: { object: { id: current.id } }
      } as Stripe.Event
    )
    expect(projectedStatus(fixture).status).toBeNull()
  })
})

function runtimeFixture(suffix: string): BillingStripeRuntimeFixture {
  const fixture = createBillingStripeRuntimeFixture(`purchaser_membership_projection_${suffix}`)
  fixtures.push(fixture)
  return fixture
}

function seedMembership(fixture: BillingStripeRuntimeFixture, tier: 'supporter' | 'member' | 'solidarity'): void {
  seedAccountStripeMembership(fixture, {
    stripeCustomerId: `cus_${fixture.purchaserUserId}`,
    stripeSubscriptionId: `sub_${fixture.purchaserUserId}`,
    stripePriceId:
      tier === 'supporter'
        ? 'price_1U9I17GqgHVbR26t3GDDF3Jg'
        : tier === 'member'
          ? prices['personal.monthly']
          : prices['family.monthly'],
    tier
  })
}

function observation(
  fixture: BillingStripeRuntimeFixture,
  tier: 'supporter' | 'member' | 'solidarity',
  status: Stripe.Subscription.Status,
  created: number,
  overrides: { subscription?: Stripe.Subscription } = {}
): StripeEventObservation {
  const current = overrides.subscription ?? subscription(fixture, tier, status)
  return {
    eventId: `evt_${fixture.purchaserUserId}_${created}_${status}`,
    eventType: 'customer.subscription.updated',
    eventCreatedAt: created,
    objectId: current.id,
    catalog,
    attemptId: null,
    stripeCustomerId: typeof current.customer === 'string' ? current.customer : current.customer.id,
    stripeSessionId: null,
    checkoutState: null,
    projection: null,
    reconciliationReason: null,
    providerState: { kind: 'subscription', subscription: current, schedule: null }
  }
}

function subscription(
  fixture: BillingStripeRuntimeFixture,
  tier: 'supporter' | 'member' | 'solidarity',
  status: Stripe.Subscription.Status
): Stripe.Subscription {
  const row = fixture.sqlite
    .prepare(
      `select stripe_customer_id as customerId, stripe_subscription_id as subscriptionId,
              stripe_price_id as priceId
       from account_stripe_memberships where user_id = ?`
    )
    .get(fixture.purchaserUserId) as { customerId: string; priceId: string; subscriptionId: string }
  return {
    id: row.subscriptionId,
    object: 'subscription',
    customer: row.customerId,
    status,
    metadata: { wcu_membership_tier: tier },
    cancel_at_period_end: false,
    schedule: null,
    items: {
      object: 'list',
      data: [
        {
          id: `si_${row.subscriptionId}`,
          object: 'subscription_item',
          current_period_start: 1,
          current_period_end: 2,
          quantity: 1,
          price: { id: row.priceId, object: 'price' }
        } as Stripe.SubscriptionItem
      ],
      has_more: false,
      url: `/v1/subscription_items?subscription=${row.subscriptionId}`
    }
  } as Stripe.Subscription
}

function projectedStatus(fixture: BillingStripeRuntimeFixture) {
  return fixture.sqlite
    .prepare(
      `select stripe_status as status, projection_order_ms as projectionOrderMs,
              projection_event_id as projectionEventId, last_verified_at as lastVerifiedAt
       from account_stripe_memberships where user_id = ?`
    )
    .get(fixture.purchaserUserId) as {
    lastVerifiedAt: string | null
    projectionEventId: string | null
    projectionOrderMs: number
    status: string | null
  }
}

function stripePage(data: Stripe.Subscription[]): Stripe.ApiList<Stripe.Subscription> {
  return { object: 'list', data, has_more: false, url: '/v1/subscriptions' }
}

function now(seconds: number): Date {
  return new Date(seconds * 1_000)
}
