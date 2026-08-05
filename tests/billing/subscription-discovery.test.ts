import type Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import { resolveLiveStripeSubscription } from '../../server/services/payments/stripe/subscription-discovery'
import type { StripeBillingClient } from '../../server/services/payments/stripe/stripe-client'

describe('Stripe subscription discovery', () => {
  it('deduplicates a subscription that moves from active to past_due during discovery', async () => {
    let status: Stripe.Subscription.Status = 'active'
    let requestCount = 0
    const list = vi.fn(async (parameters: Stripe.SubscriptionListParams) => {
      const observedStatus = status
      requestCount += 1
      if (requestCount === 1) status = 'past_due'
      const data = parameters.status === observedStatus ? [stripeSubscription('sub_transition', observedStatus)] : []
      return stripePage(data, false)
    })
    const retrieve = vi.fn(async () => stripeSubscription('sub_transition', status))

    await expect(resolveLiveStripeSubscription(stripeClient(list, retrieve), 'cus_discovery')).resolves.toMatchObject({
      outcome: 'found',
      subscription: {
        id: 'sub_transition',
        status: 'past_due'
      }
    })
    expect(retrieve).toHaveBeenCalledOnce()
  })

  it('ignores more than 1,000 terminal subscriptions to find one live subscription', async () => {
    const subscriptions = [
      ...Array.from({ length: 1_001 }, (_, index) =>
        stripeSubscription(
          `sub_terminal_${index.toString().padStart(4, '0')}`,
          index % 2 === 0 ? 'canceled' : 'incomplete_expired'
        )
      ),
      stripeSubscription('sub_live', 'active')
    ]
    const list = filteredList(subscriptions)
    const retrieve = vi.fn(async () => subscriptions.at(-1)!)

    await expect(resolveLiveStripeSubscription(stripeClient(list, retrieve), 'cus_discovery')).resolves.toMatchObject({
      outcome: 'found',
      subscription: { id: 'sub_live', status: 'active' }
    })
    expect(list.mock.calls.map(([parameters]) => parameters.status)).not.toContain('all')
    expect(retrieve).toHaveBeenCalledWith('sub_live')
  })

  it('detects multiple live subscriptions across statuses', async () => {
    const subscriptions = [
      stripeSubscription('sub_live_first', 'active'),
      stripeSubscription('sub_live_second', 'past_due')
    ]

    await expect(
      resolveLiveStripeSubscription(stripeClient(filteredList(subscriptions)), 'cus_discovery')
    ).resolves.toEqual({
      outcome: 'ambiguous',
      reason: 'multiple_live_subscriptions'
    })
  })

  it('finds a subscription that recovers from past_due to active during discovery', async () => {
    let status: Stripe.Subscription.Status = 'past_due'
    let requestCount = 0
    const list = vi.fn(async (parameters: Stripe.SubscriptionListParams) => {
      const observedStatus = status
      requestCount += 1
      if (requestCount === 1) status = 'active'
      const data = parameters.status === observedStatus ? [stripeSubscription('sub_recovered', observedStatus)] : []
      return stripePage(data, false)
    })
    const retrieve = vi.fn(async () => stripeSubscription('sub_recovered', status))

    await expect(resolveLiveStripeSubscription(stripeClient(list, retrieve), 'cus_discovery')).resolves.toMatchObject({
      outcome: 'found',
      subscription: { id: 'sub_recovered', status: 'active' }
    })
    expect(list.mock.calls.map(([parameters]) => parameters.status)).toEqual([
      'active',
      'incomplete',
      'trialing',
      'paused',
      'past_due',
      'unpaid',
      'active'
    ])
  })

  it('finds a paused subscription that resumes as past_due during discovery', async () => {
    let status: Stripe.Subscription.Status = 'paused'
    const list = vi.fn(async (parameters: Stripe.SubscriptionListParams) => {
      if (parameters.status === 'paused') status = 'past_due'
      const data = parameters.status === status ? [stripeSubscription('sub_resumed_past_due', status)] : []
      return stripePage(data, false)
    })
    const retrieve = vi.fn(async () => stripeSubscription('sub_resumed_past_due', status))

    await expect(resolveLiveStripeSubscription(stripeClient(list, retrieve), 'cus_discovery')).resolves.toMatchObject({
      outcome: 'found',
      subscription: { id: 'sub_resumed_past_due', status: 'past_due' }
    })
  })

  it('fails closed when one status contains more than one subscription', async () => {
    const list = filteredList([
      stripeSubscription('sub_active_first', 'active'),
      stripeSubscription('sub_active_second', 'active')
    ])

    await expect(resolveLiveStripeSubscription(stripeClient(list), 'cus_discovery')).resolves.toEqual({
      outcome: 'ambiguous',
      reason: 'multiple_live_subscriptions'
    })
  })

  it('requires reconciliation when a bounded Stripe status read reports more results', async () => {
    const list = vi.fn(async (parameters: Stripe.SubscriptionListParams) =>
      parameters.status === 'active'
        ? stripePage([stripeSubscription('sub_truncated', 'active')], true)
        : stripePage([], false)
    )

    await expect(resolveLiveStripeSubscription(stripeClient(list), 'cus_discovery')).resolves.toEqual({
      outcome: 'ambiguous',
      reason: 'multiple_live_subscriptions'
    })
    expect(list).toHaveBeenCalledOnce()
  })

  it('fails closed when the sole candidate becomes terminal before exact retrieval', async () => {
    const candidate = stripeSubscription('sub_terminalized', 'active')
    const retrieve = vi.fn(async () => stripeSubscription(candidate.id, 'canceled'))

    await expect(
      resolveLiveStripeSubscription(stripeClient(filteredList([candidate]), retrieve), 'cus_discovery')
    ).resolves.toEqual({
      outcome: 'ambiguous',
      reason: 'unknown_subscription_state'
    })
  })
})

function filteredList(subscriptions: Stripe.Subscription[]) {
  return vi.fn(async (parameters: Stripe.SubscriptionListParams) => {
    const matching = subscriptions.filter((subscription) => subscription.status === parameters.status)
    const limit = parameters.limit ?? 10
    return stripePage(matching.slice(0, limit), matching.length > limit)
  })
}

function stripeClient(
  list: ReturnType<
    typeof vi.fn<(parameters: Stripe.SubscriptionListParams) => Promise<Stripe.ApiList<Stripe.Subscription>>>
  >,
  retrieve = vi.fn(async (subscriptionId: string) => stripeSubscription(subscriptionId, 'active'))
) {
  return { subscriptions: { list, retrieve } } as unknown as StripeBillingClient
}

function stripePage(data: Stripe.Subscription[], hasMore: boolean): Stripe.ApiList<Stripe.Subscription> {
  return {
    object: 'list',
    data,
    has_more: hasMore,
    url: '/v1/subscriptions'
  }
}

function stripeSubscription(id: string, status: Stripe.Subscription.Status): Stripe.Subscription {
  return {
    id,
    object: 'subscription',
    customer: 'cus_discovery',
    status
  } as Stripe.Subscription
}
