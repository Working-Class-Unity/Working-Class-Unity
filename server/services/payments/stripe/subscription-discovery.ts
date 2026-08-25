import type Stripe from 'stripe'
import type { StripeBillingClient } from './stripe-client'

const discoveryStatuses = [
  'active',
  'incomplete',
  'trialing',
  'paused',
  'past_due',
  'unpaid',
  'active'
] as const satisfies readonly Stripe.SubscriptionListParams.Status[]
const discoveryPageSize = 2
const knownStatuses = new Set<Stripe.Subscription.Status>([...discoveryStatuses, 'canceled', 'incomplete_expired'])

export type LiveStripeSubscriptionResolution =
  | Readonly<{ outcome: 'none' }>
  | Readonly<{ outcome: 'found'; subscription: Stripe.Subscription }>
  | Readonly<{
      outcome: 'ambiguous'
      reason: 'multiple_live_subscriptions' | 'subscription_customer_mismatch' | 'unknown_subscription_state'
    }>

export type ExactStripeSubscriptionResolution =
  | Readonly<{ outcome: 'found'; subscription: Stripe.Subscription }>
  | Readonly<{
      outcome: 'ambiguous'
      reason: 'expected_subscription_missing' | 'subscription_customer_mismatch' | 'unknown_subscription_state'
    }>

type StripeSubscriptionClient = Pick<StripeBillingClient, 'subscriptions'>

export async function resolveLiveStripeSubscription(
  client: StripeSubscriptionClient,
  stripeCustomerId: string,
  requestOptions?: Stripe.RequestOptions
): Promise<LiveStripeSubscriptionResolution> {
  let candidate: string | null = null
  for (const status of discoveryStatuses) {
    const parameters = { customer: stripeCustomerId, status, limit: discoveryPageSize } as const
    const page = requestOptions
      ? await client.subscriptions.list(parameters, requestOptions)
      : await client.subscriptions.list(parameters)
    if (
      !page ||
      typeof page !== 'object' ||
      page.object !== 'list' ||
      !Array.isArray(page.data) ||
      typeof page.has_more !== 'boolean' ||
      page.data.length > discoveryPageSize
    ) {
      return { outcome: 'ambiguous', reason: 'unknown_subscription_state' }
    }
    const pageIds = new Set<string>()
    for (const subscription of page.data) {
      if (
        !subscription ||
        subscription.object !== 'subscription' ||
        typeof subscription.id !== 'string' ||
        !subscription.id ||
        !knownStatuses.has(subscription.status) ||
        pageIds.has(subscription.id)
      ) {
        return { outcome: 'ambiguous', reason: 'unknown_subscription_state' }
      }
      if (stripeCustomerReference(subscription.customer) !== stripeCustomerId) {
        return { outcome: 'ambiguous', reason: 'subscription_customer_mismatch' }
      }
      pageIds.add(subscription.id)
      if (candidate && candidate !== subscription.id) {
        return { outcome: 'ambiguous', reason: 'multiple_live_subscriptions' }
      }
      candidate = subscription.id
    }
    if (page.has_more) return { outcome: 'ambiguous', reason: 'multiple_live_subscriptions' }
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
  const parameters = expand.length ? { expand } : {}
  const subscription = requestOptions
    ? await client.subscriptions.retrieve(expectedSubscriptionId, parameters, requestOptions)
    : expand.length
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
  if (!knownStatuses.has(subscription.status)) {
    return { outcome: 'ambiguous', reason: 'unknown_subscription_state' }
  }
  if (stripeCustomerReference(subscription.customer) !== stripeCustomerId) {
    return { outcome: 'ambiguous', reason: 'subscription_customer_mismatch' }
  }
  return { outcome: 'found', subscription }
}

export function isTerminalStripeSubscription(
  subscription: Stripe.Subscription
): subscription is Stripe.Subscription & { status: 'canceled' | 'incomplete_expired' } {
  return subscription.status === 'canceled' || subscription.status === 'incomplete_expired'
}

function stripeCustomerReference(value: Stripe.Subscription['customer']): string | null {
  if (typeof value === 'string') return value
  return value && typeof value === 'object' && typeof value.id === 'string' ? value.id : null
}
