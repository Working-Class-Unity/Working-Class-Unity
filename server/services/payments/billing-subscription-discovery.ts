import type Stripe from 'stripe'
import type { StripeBillingClient } from './stripe-client'

const stripeSubscriptionDiscoveryStatuses = [
  'active',
  'incomplete',
  'trialing',
  'paused',
  'past_due',
  'unpaid',
  'active'
] as const satisfies readonly Stripe.SubscriptionListParams.Status[]

const stripeSubscriptionDiscoveryPageSize = 2

const knownStripeSubscriptionStatuses = new Set<Stripe.Subscription.Status>([
  ...stripeSubscriptionDiscoveryStatuses,
  'canceled',
  'incomplete_expired'
])

type LiveStripeSubscriptionResolution =
  | Readonly<{ outcome: 'none' }>
  | Readonly<{ outcome: 'found'; subscription: Stripe.Subscription }>
  | Readonly<{
      outcome: 'ambiguous'
      reason: 'multiple_live_subscriptions' | 'subscription_customer_mismatch' | 'unknown_subscription_state'
    }>

type ExactStripeSubscriptionResolution =
  | Readonly<{ outcome: 'found'; subscription: Stripe.Subscription }>
  | Readonly<{
      outcome: 'ambiguous'
      reason: 'expected_subscription_missing' | 'subscription_customer_mismatch' | 'unknown_subscription_state'
    }>

type StripeSubscriptionClient = Pick<StripeBillingClient, 'subscriptions'>

/**
 * Terminal history is unbounded, so discovery reads only current statuses.
 * Active brackets the scan because documented Stripe transitions can move both
 * into and out of active. The sole candidate is then retrieved exactly.
 */
export async function resolveLiveStripeSubscription(
  client: StripeSubscriptionClient,
  stripeCustomerId: string,
  requestOptions?: Stripe.RequestOptions
): Promise<LiveStripeSubscriptionResolution> {
  let candidate: string | null = null

  for (const status of stripeSubscriptionDiscoveryStatuses) {
    const parameters = {
      customer: stripeCustomerId,
      status,
      limit: stripeSubscriptionDiscoveryPageSize
    } as const
    const page = requestOptions
      ? await client.subscriptions.list(parameters, requestOptions)
      : await client.subscriptions.list(parameters)

    if (
      !page ||
      typeof page !== 'object' ||
      page.object !== 'list' ||
      !Array.isArray(page.data) ||
      typeof page.has_more !== 'boolean' ||
      page.data.length > stripeSubscriptionDiscoveryPageSize
    ) {
      return { outcome: 'ambiguous', reason: 'unknown_subscription_state' }
    }

    const pageIds = new Set<string>()
    for (const subscription of page.data) {
      if (
        !subscription ||
        subscription.object !== 'subscription' ||
        typeof subscription.id !== 'string' ||
        subscription.id.length === 0 ||
        !knownStripeSubscriptionStatuses.has(subscription.status)
      ) {
        return { outcome: 'ambiguous', reason: 'unknown_subscription_state' }
      }
      if (stripeCustomerReference(subscription.customer) !== stripeCustomerId) {
        return { outcome: 'ambiguous', reason: 'subscription_customer_mismatch' }
      }
      if (pageIds.has(subscription.id)) {
        return { outcome: 'ambiguous', reason: 'unknown_subscription_state' }
      }
      pageIds.add(subscription.id)
      if (candidate && candidate !== subscription.id) {
        return { outcome: 'ambiguous', reason: 'multiple_live_subscriptions' }
      }
      candidate = subscription.id
    }

    if (page.has_more) {
      return { outcome: 'ambiguous', reason: 'multiple_live_subscriptions' }
    }
  }

  if (!candidate) return { outcome: 'none' }

  const exact = await retrieveExactStripeSubscription(client, stripeCustomerId, candidate, [], requestOptions)
  if (exact.outcome === 'ambiguous') {
    return {
      outcome: 'ambiguous',
      reason:
        exact.reason === 'subscription_customer_mismatch'
          ? 'subscription_customer_mismatch'
          : 'unknown_subscription_state'
    }
  }
  return isTerminalStripeSubscription(exact.subscription)
    ? { outcome: 'ambiguous', reason: 'unknown_subscription_state' }
    : { outcome: 'found', subscription: exact.subscription }
}

export async function retrieveExactStripeSubscription(
  client: StripeSubscriptionClient,
  stripeCustomerId: string,
  expectedSubscriptionId: string,
  expand: string[] = [],
  requestOptions?: Stripe.RequestOptions
): Promise<ExactStripeSubscriptionResolution> {
  const parameters = expand.length > 0 ? { expand } : {}
  const subscription = requestOptions
    ? await client.subscriptions.retrieve(expectedSubscriptionId, parameters, requestOptions)
    : expand.length > 0
      ? await client.subscriptions.retrieve(expectedSubscriptionId, parameters)
      : await client.subscriptions.retrieve(expectedSubscriptionId)

  if (
    !subscription ||
    typeof subscription !== 'object' ||
    subscription.object !== 'subscription' ||
    subscription.id !== expectedSubscriptionId
  ) {
    return { outcome: 'ambiguous', reason: 'expected_subscription_missing' }
  }
  if (!knownStripeSubscriptionStatuses.has(subscription.status)) {
    return { outcome: 'ambiguous', reason: 'unknown_subscription_state' }
  }
  if (stripeCustomerReference(subscription.customer) !== stripeCustomerId) {
    return { outcome: 'ambiguous', reason: 'subscription_customer_mismatch' }
  }
  return { outcome: 'found', subscription }
}

export function isTerminalStripeSubscription(subscription: Stripe.Subscription): boolean {
  return subscription.status === 'canceled' || subscription.status === 'incomplete_expired'
}

function stripeCustomerReference(value: Stripe.Subscription['customer']): string | null {
  if (typeof value === 'string') return value
  return value && typeof value === 'object' && typeof value.id === 'string' ? value.id : null
}
