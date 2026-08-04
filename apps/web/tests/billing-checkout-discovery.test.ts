import type Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import { resolveCheckoutAttemptSession } from '../server/services/payments/billing-checkout'
import type { StripeBillingClient } from '../server/services/payments/stripe-client'

const attempt = {
  id: 'billing_attempt_paginated',
  createdAt: '2026-07-15T12:00:00.000Z',
  reuseUntil: '2026-07-16T11:00:00.000Z'
} as const

describe('Stripe Checkout attempt discovery', () => {
  it('walks account-global pages with the last validated Session ID as starting_after', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      checkoutSession(`unrelated_${index}`, `cs_page_1_${index.toString().padStart(3, '0')}`)
    )
    const correlated = checkoutSession(attempt.id, 'cs_page_2_match')
    const provider = checkoutDiscoveryProvider([stripePage(firstPage, true), stripePage([correlated], false)])

    await expect(resolveCheckoutAttemptSession(provider.client, attempt)).resolves.toEqual({
      outcome: 'found',
      session: correlated
    })
    expect(provider.list).toHaveBeenCalledTimes(2)
    expect(provider.list.mock.calls).toEqual([
      [
        {
          created: { gte: 1_784_116_740, lte: 1_784_199_600 },
          limit: 100
        }
      ],
      [
        {
          created: { gte: 1_784_116_740, lte: 1_784_199_600 },
          limit: 100,
          starting_after: 'cs_page_1_099'
        }
      ]
    ])
  })

  it('stops on cross-page correlation ambiguity', async () => {
    const first = checkoutSession(attempt.id, 'cs_first_match')
    const second = checkoutSession(attempt.id, 'cs_second_match')
    const provider = checkoutDiscoveryProvider([
      stripePage([first, checkoutSession('unrelated', 'cs_page_1_tail')], true),
      stripePage([second], true),
      stripePage([checkoutSession('unrelated', 'cs_unreachable')], false)
    ])

    await expect(resolveCheckoutAttemptSession(provider.client, attempt)).resolves.toEqual({
      outcome: 'ambiguous',
      reason: 'multiple_correlated_checkout_sessions'
    })
    expect(provider.list).toHaveBeenCalledTimes(2)
  })

  it('fails closed when Stripe repeats a non-advancing cursor', async () => {
    const provider = checkoutDiscoveryProvider([
      stripePage([checkoutSession('unrelated', 'cs_repeated_cursor')], true),
      stripePage([checkoutSession('unrelated', 'cs_repeated_cursor')], true)
    ])

    await expect(resolveCheckoutAttemptSession(provider.client, attempt)).resolves.toEqual({
      outcome: 'ambiguous',
      reason: 'checkout_pagination_cursor_stalled'
    })
    expect(provider.list).toHaveBeenCalledTimes(2)
  })

  it('fails closed after the bounded account-global discovery budget', async () => {
    const provider = checkoutDiscoveryProvider(
      Array.from({ length: 11 }, (_, index) => stripePage([checkoutSession('unrelated', `cs_bounded_${index}`)], true))
    )

    await expect(resolveCheckoutAttemptSession(provider.client, attempt)).resolves.toEqual({
      outcome: 'ambiguous',
      reason: 'checkout_discovery_truncated'
    })
    expect(provider.list).toHaveBeenCalledTimes(10)
  })
})

function checkoutDiscoveryProvider(pages: Stripe.ApiList<Stripe.Checkout.Session>[]) {
  const list = vi.fn(async () => pages.shift() ?? stripePage([], false))
  return {
    list,
    client: {
      checkout: { sessions: { list } }
    } as unknown as Pick<StripeBillingClient, 'checkout'>
  }
}

function stripePage(data: Stripe.Checkout.Session[], hasMore: boolean): Stripe.ApiList<Stripe.Checkout.Session> {
  return {
    object: 'list',
    data,
    has_more: hasMore,
    url: '/v1/checkout/sessions'
  }
}

function checkoutSession(clientReferenceId: string, id: string): Stripe.Checkout.Session {
  return {
    id,
    object: 'checkout.session',
    client_reference_id: clientReferenceId
  } as Stripe.Checkout.Session
}
