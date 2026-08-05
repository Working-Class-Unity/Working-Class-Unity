import type Stripe from 'stripe'
import {
  getBillingOffering,
  type BillingCadence,
  type BillingPlan,
  type BillingSnapshotStatus
} from '../../../../shared/billing'
import type { StripeBillingCatalog } from './catalog'
import {
  isTerminalStripeSubscription,
  resolveLiveStripeSubscription,
  retrieveExactStripeSubscription
} from './subscription-discovery'
import type { StripeBillingClient } from './stripe-client'

export type CurrentBillingProjection = Readonly<{
  stripeSubscriptionId: string | null
  stripeSubscriptionItemId: string | null
  status: BillingSnapshotStatus
  planKey: BillingPlan | null
  cadence: BillingCadence | null
  stripePriceId: string | null
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  reconciliationRequired: boolean
  reconciliationReason: string | null
}>

export async function readCurrentStripeProjection(
  client: StripeBillingClient,
  stripeCustomerId: string,
  catalog: StripeBillingCatalog,
  requestOptions?: Stripe.RequestOptions,
  expectedSubscriptionId?: string | null
): Promise<CurrentBillingProjection> {
  const expected = expectedSubscriptionId
    ? await retrieveExactStripeSubscription(client, stripeCustomerId, expectedSubscriptionId, [], requestOptions)
    : null
  if (expected?.outcome === 'ambiguous') return ambiguousProjection(discoveryReason(expected.reason))
  const live = await resolveLiveStripeSubscription(client, stripeCustomerId, requestOptions)
  if (live.outcome === 'ambiguous') return ambiguousProjection(discoveryReason(live.reason))
  if (live.outcome === 'found') {
    if (
      expected?.outcome === 'found' &&
      !isTerminalStripeSubscription(expected.subscription) &&
      expected.subscription.id !== live.subscription.id
    ) {
      return ambiguousProjection('expected_subscription_mismatch')
    }
    return normalizeSubscription(live.subscription, stripeCustomerId, catalog)
  }
  if (!expected) return emptyProjection()
  return isTerminalStripeSubscription(expected.subscription)
    ? normalizeSubscription(expected.subscription, stripeCustomerId, catalog)
    : ambiguousProjection('expected_subscription_missing')
}

export function currentProjectionFingerprint(projection: CurrentBillingProjection): string {
  return JSON.stringify([
    projection.stripeSubscriptionId,
    projection.stripeSubscriptionItemId,
    projection.status,
    projection.planKey,
    projection.cadence,
    projection.stripePriceId,
    projection.currentPeriodStart,
    projection.currentPeriodEnd,
    projection.cancelAtPeriodEnd,
    projection.reconciliationRequired,
    projection.reconciliationReason
  ])
}

export function projectStripeSubscription(
  subscription: Stripe.Subscription,
  expectedCustomerId: string,
  catalog: StripeBillingCatalog
): CurrentBillingProjection {
  return normalizeSubscription(subscription, expectedCustomerId, catalog)
}

export function reconciliationProjection(reason: string): CurrentBillingProjection {
  return ambiguousProjection(reason)
}

function normalizeSubscription(
  subscription: Stripe.Subscription,
  expectedCustomerId: string,
  catalog: StripeBillingCatalog
): CurrentBillingProjection {
  if (stripeId(subscription.customer) !== expectedCustomerId) return ambiguousProjection('customer_mismatch')
  if (subscription.items.has_more || subscription.items.data.length !== 1) {
    return ambiguousProjection('unexpected_subscription_items')
  }
  const item = subscription.items.data[0]!
  const priceId = item.price.id
  const offeringKey = catalog.offeringForPriceId(priceId)
  const offering = offeringKey ? getBillingOffering(offeringKey) : null
  if (item.quantity !== 1) {
    return {
      ...projectionFromSubscription(subscription, item, priceId),
      planKey: null,
      cadence: null,
      reconciliationRequired: true,
      reconciliationReason: 'unexpected_subscription_quantity'
    }
  }
  if (!offering) {
    return {
      ...projectionFromSubscription(subscription, item, priceId),
      planKey: null,
      cadence: null,
      reconciliationRequired: true,
      reconciliationReason: 'unrecognized_subscription_price'
    }
  }
  const unsupported = !['active', 'past_due', 'unpaid', 'canceled', 'incomplete_expired'].includes(subscription.status)
  return {
    ...projectionFromSubscription(subscription, item, priceId),
    planKey: offering.plan,
    cadence: offering.cadence,
    reconciliationRequired: unsupported,
    reconciliationReason: unsupported ? `unsupported_subscription_status:${subscription.status}` : null
  }
}

function projectionFromSubscription(
  subscription: Stripe.Subscription,
  item: Stripe.SubscriptionItem,
  stripePriceId: string
) {
  return {
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionItemId: item.id,
    status: subscription.status,
    stripePriceId,
    currentPeriodStart: timestampToIso(item.current_period_start),
    currentPeriodEnd: timestampToIso(item.current_period_end),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end)
  }
}

function emptyProjection(): CurrentBillingProjection {
  return {
    stripeSubscriptionId: null,
    stripeSubscriptionItemId: null,
    status: 'none',
    planKey: null,
    cadence: null,
    stripePriceId: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    reconciliationRequired: false,
    reconciliationReason: null
  }
}

function ambiguousProjection(reason: string): CurrentBillingProjection {
  return {
    stripeSubscriptionId: null,
    stripeSubscriptionItemId: null,
    status: 'ambiguous',
    planKey: null,
    cadence: null,
    stripePriceId: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    reconciliationRequired: true,
    reconciliationReason: reason
  }
}

function discoveryReason(reason: string): string {
  if (reason === 'unknown_subscription_state') return 'unknown_subscription_status'
  if (reason === 'subscription_customer_mismatch') return 'customer_mismatch'
  return reason
}

export function stripeId(value: string | { id: string } | null): string | null {
  return typeof value === 'string' ? value : (value?.id ?? null)
}

function timestampToIso(value: number): string {
  return new Date(value * 1_000).toISOString()
}
