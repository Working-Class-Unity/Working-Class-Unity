import type Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import { createStripeBillingCatalog } from '../../server/services/payments/stripe/catalog'
import {
  billingGracePeriodMs,
  evaluateStripeSubscriptionAccess,
  graceWindowFromFirstFailure
} from '../../server/services/payments/stripe/dunning'
import { readCurrentStripeProjection } from '../../server/services/payments/stripe/projection'
import type { BillingOfferingKey } from '../../shared/billing'
import type { StripeBillingClient } from '../../server/services/payments/stripe/stripe-client'

const stripePrices = {
  'personal.weekly': 'price_personal_weekly_projection',
  'personal.monthly': 'price_personal_monthly_projection',
  'personal.annual': 'price_personal_annual_projection',
  'family.monthly': 'price_family_monthly_projection',
  'family.annual': 'price_family_annual_projection'
} as const

const offeringCases = [
  ['personal.weekly', stripePrices['personal.weekly'], 'personal', 'weekly'],
  ['personal.monthly', stripePrices['personal.monthly'], 'personal', 'monthly'],
  ['personal.annual', stripePrices['personal.annual'], 'personal', 'annual'],
  ['family.monthly', stripePrices['family.monthly'], 'family', 'monthly'],
  ['family.annual', stripePrices['family.annual'], 'family', 'annual']
] as const

describe('Stripe billing projection', () => {
  it.each(offeringCases)('maps %s through the one private catalog', async (offering, priceId, plan, cadence) => {
    const provider = subscriptionProvider([stripeSubscription(priceId)])

    const projection = await readCurrentStripeProjection(
      provider.client,
      'cus_projection',
      createStripeBillingCatalog(stripePrices)
    )

    expect(projection).toMatchObject({
      stripeSubscriptionId: 'sub_projection',
      stripeSubscriptionItemId: 'si_projection',
      status: 'active',
      planKey: plan,
      cadence,
      stripePriceId: priceId,
      reconciliationRequired: false
    })
    expect(`${projection.planKey}.${projection.cadence}`).toBe(offering satisfies BillingOfferingKey)
    expect(provider.retrieve).toHaveBeenCalledWith('sub_projection')
  })

  it('fails closed for trialing, unknown Price, and unknown provider status', async () => {
    const catalog = createStripeBillingCatalog(stripePrices)
    const trialing = await readCurrentStripeProjection(
      subscriptionProvider([stripeSubscription(stripePrices['personal.monthly'], 'trialing')]).client,
      'cus_projection',
      catalog
    )
    const unknownPrice = await readCurrentStripeProjection(
      subscriptionProvider([stripeSubscription('price_unknown')]).client,
      'cus_projection',
      catalog
    )
    const unknownStatus = await readCurrentStripeProjection(
      subscriptionProvider([
        {
          ...stripeSubscription(stripePrices['family.annual']),
          status: 'provider_future_status'
        } as unknown as Stripe.Subscription
      ]).client,
      'cus_projection',
      catalog,
      undefined,
      'sub_projection'
    )

    expect(trialing).toMatchObject({
      status: 'trialing',
      planKey: 'personal',
      cadence: 'monthly',
      reconciliationRequired: true,
      reconciliationReason: 'unsupported_subscription_status:trialing'
    })
    expect(unknownPrice).toMatchObject({
      planKey: null,
      cadence: null,
      reconciliationRequired: true,
      reconciliationReason: 'unrecognized_subscription_price'
    })
    expect(unknownStatus).toMatchObject({
      status: 'ambiguous',
      reconciliationRequired: true,
      reconciliationReason: 'unknown_subscription_status'
    })
  })

  it('distinguishes no relationship from one exactly retrieved terminal subscription', async () => {
    const catalog = createStripeBillingCatalog(stripePrices)
    const none = await readCurrentStripeProjection(subscriptionProvider([]).client, 'cus_projection', catalog)
    const terminal = await readCurrentStripeProjection(
      subscriptionProvider([stripeSubscription(stripePrices['personal.annual'], 'canceled', 'sub_terminal')]).client,
      'cus_projection',
      catalog,
      undefined,
      'sub_terminal'
    )

    expect(none).toMatchObject({
      status: 'none',
      stripeSubscriptionId: null,
      planKey: null,
      cadence: null,
      reconciliationRequired: false
    })
    expect(terminal).toMatchObject({
      status: 'canceled',
      stripeSubscriptionId: 'sub_terminal',
      planKey: 'personal',
      cadence: 'annual',
      reconciliationRequired: false
    })
  })

  it('ignores terminal history unless an exact terminal identity was captured', async () => {
    const catalog = createStripeBillingCatalog(stripePrices)
    const history = [
      stripeSubscription(stripePrices['personal.monthly'], 'canceled', 'sub_old'),
      stripeSubscription(stripePrices['family.annual'], 'incomplete_expired', 'sub_expected')
    ]

    await expect(
      readCurrentStripeProjection(subscriptionProvider(history).client, 'cus_projection', catalog)
    ).resolves.toMatchObject({
      status: 'none',
      stripeSubscriptionId: null,
      reconciliationRequired: false
    })
    await expect(
      readCurrentStripeProjection(
        subscriptionProvider(history).client,
        'cus_projection',
        catalog,
        undefined,
        'sub_expected'
      )
    ).resolves.toMatchObject({
      status: 'incomplete_expired',
      stripeSubscriptionId: 'sub_expected',
      planKey: 'family',
      cadence: 'annual',
      reconciliationRequired: false
    })
  })

  it('does not let terminal history hide one live subscription', async () => {
    const catalog = createStripeBillingCatalog(stripePrices)
    const projection = await readCurrentStripeProjection(
      subscriptionProvider([
        stripeSubscription(stripePrices['personal.monthly'], 'canceled', 'sub_old'),
        stripeSubscription(stripePrices['family.monthly'], 'active', 'sub_current')
      ]).client,
      'cus_projection',
      catalog,
      undefined,
      'sub_old'
    )

    expect(projection).toMatchObject({
      status: 'active',
      stripeSubscriptionId: 'sub_current',
      planKey: 'family',
      cadence: 'monthly',
      reconciliationRequired: false
    })
  })

  it('grants past-due access only inside one validated 60-day grace window', () => {
    const firstFailure = new Date('2026-07-01T12:00:00.000Z')
    const grace = graceWindowFromFirstFailure(firstFailure)
    const snapshot = {
      status: 'past_due',
      reconciliationRequired: false,
      graceInvoiceId: 'in_projection',
      graceStartedAt: grace.startedAt,
      graceEndsAt: grace.endsAt
    } as const

    expect(Date.parse(grace.endsAt) - Date.parse(grace.startedAt)).toBe(billingGracePeriodMs)
    expect(evaluateStripeSubscriptionAccess(snapshot, new Date(Date.parse(grace.endsAt) - 1))).toMatchObject({
      state: 'grace',
      granted: true,
      graceDeadline: grace.endsAt
    })
    expect(evaluateStripeSubscriptionAccess(snapshot, new Date(grace.endsAt))).toMatchObject({
      state: 'suspended',
      granted: false,
      graceDeadline: grace.endsAt
    })
    expect(
      evaluateStripeSubscriptionAccess({
        ...snapshot,
        graceInvoiceId: null,
        graceStartedAt: null,
        graceEndsAt: null
      })
    ).toMatchObject({
      state: 'reconciliation_required',
      granted: false,
      reconciliationReason: 'missing_or_invalid_grace_anchor'
    })
  })
})

function subscriptionProvider(subscriptions: Stripe.Subscription[]) {
  const list = vi.fn(async (parameters: Stripe.SubscriptionListParams) => {
    const matching = subscriptions.filter((subscription) => subscription.status === parameters.status)
    const limit = parameters.limit ?? 10
    const data = matching.slice(0, limit)
    return {
      object: 'list' as const,
      data,
      has_more: data.length < matching.length,
      url: '/v1/subscriptions'
    }
  })
  const retrieve = vi.fn(async (id: string) => {
    const subscription = subscriptions.find((candidate) => candidate.id === id)
    if (!subscription) throw new Error('subscription not found')
    return subscription
  })
  return {
    list,
    retrieve,
    client: { subscriptions: { list, retrieve } } as unknown as StripeBillingClient
  }
}

function stripeSubscription(
  priceId: string,
  status: Stripe.Subscription.Status = 'active',
  id = 'sub_projection'
): Stripe.Subscription {
  return {
    id,
    object: 'subscription',
    customer: 'cus_projection',
    status,
    items: {
      object: 'list',
      data: [
        {
          id: 'si_projection',
          object: 'subscription_item',
          current_period_start: 1_783_920_000,
          current_period_end: 1_786_512_000,
          quantity: 1,
          price: { id: priceId, object: 'price' }
        } as Stripe.SubscriptionItem
      ],
      has_more: false,
      url: `/v1/subscription_items?subscription=${id}`
    }
  } as Stripe.Subscription
}
