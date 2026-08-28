import type Stripe from 'stripe'
import { accountStripeMembershipStatuses, type AccountStripeMembershipStatus } from '../../db/schema/billing'
import type { BillingStripeConnection } from '../payments/stripe/public-contract'
import type { StripeEventObservation } from '../payments/stripe/webhook'

const knownStatuses = new Set<Stripe.Subscription.Status>(accountStripeMembershipStatuses)

export function applyAccountStripeMembershipObservation(
  connection: BillingStripeConnection,
  observation: StripeEventObservation,
  verifiedAt: Date
): boolean {
  const subscription = providerSubscription(observation.providerState)
  const subscriptionId =
    subscription?.id ?? (observation.eventType.startsWith('customer.subscription.') ? observation.objectId : null)
  if (!subscriptionId) return false

  const link = connection.sqlite
    .prepare(
      `select user_id as userId, stripe_customer_id as stripeCustomerId,
              stripe_subscription_id as stripeSubscriptionId, stripe_price_id as stripePriceId,
              tier, stripe_status as stripeStatus, projection_order_ms as projectionOrderMs,
              projection_event_id as projectionEventId
       from account_stripe_memberships where stripe_subscription_id = ?`
    )
    .get(subscriptionId) as
    | {
        projectionEventId: string | null
        projectionOrderMs: number
        stripeCustomerId: string
        stripePriceId: string
        stripeStatus: AccountStripeMembershipStatus | null
        stripeSubscriptionId: string
        tier: string
        userId: string
      }
    | undefined
  if (!link) return false

  const observedStatus = validStatus(link, observation, subscription)
  const observedOrderMs = observation.eventCreatedAt * 1_000
  if (observedOrderMs < link.projectionOrderMs && link.stripeStatus === observedStatus) return true
  const orderConflict =
    observedOrderMs < link.projectionOrderMs ||
    (observedOrderMs === link.projectionOrderMs &&
      link.projectionEventId !== observation.eventId &&
      link.stripeStatus !== observedStatus)
  const nextStatus = orderConflict ? null : observedStatus
  const nextOrderMs = observedOrderMs < link.projectionOrderMs ? link.projectionOrderMs : observedOrderMs
  const nextEventId = observedOrderMs < link.projectionOrderMs ? link.projectionEventId : observation.eventId
  connection.sqlite
    .prepare(
      `update account_stripe_memberships
       set stripe_status = ?, last_verified_at = ?, projection_order_ms = ?, projection_event_id = ?,
           updated_at = ?
       where user_id = ? and stripe_customer_id = ? and stripe_subscription_id = ?`
    )
    .run(
      nextStatus,
      verifiedAt.toISOString(),
      nextOrderMs,
      nextEventId,
      verifiedAt.toISOString(),
      link.userId,
      link.stripeCustomerId,
      link.stripeSubscriptionId
    )
  return true
}

function validStatus(
  link: Readonly<{
    stripeCustomerId: string
    stripePriceId: string
    stripeSubscriptionId: string
    tier: string
  }>,
  observation: StripeEventObservation,
  subscription: Stripe.Subscription | null
): AccountStripeMembershipStatus | null {
  if (
    !subscription ||
    (subscription.id !== observation.objectId && observation.eventType.startsWith('customer.subscription.')) ||
    observation.stripeCustomerId !== link.stripeCustomerId
  ) {
    return null
  }
  return exactStripeMembershipStatus(subscription, link)
}

export function exactStripeMembershipStatus(
  subscription: Stripe.Subscription,
  expected: Readonly<{
    stripeCustomerId: string
    stripePriceId: string
    stripeSubscriptionId?: string
    tier: string
  }>
): AccountStripeMembershipStatus | null {
  const item = subscription.items.data.length === 1 ? subscription.items.data[0] : undefined
  const metadataTier = subscription.metadata.wcu_membership_tier
  if (
    subscription.object !== 'subscription' ||
    (expected.stripeSubscriptionId !== undefined && subscription.id !== expected.stripeSubscriptionId) ||
    stripeId(subscription.customer) !== expected.stripeCustomerId ||
    !knownStatuses.has(subscription.status) ||
    subscription.items.has_more ||
    !item ||
    item.price.id !== expected.stripePriceId ||
    item.quantity !== 1 ||
    (metadataTier !== undefined && metadataTier !== expected.tier)
  ) {
    return null
  }
  return subscription.status
}

function providerSubscription(state: StripeEventObservation['providerState']): Stripe.Subscription | null {
  return 'subscription' in state ? state.subscription : null
}

function stripeId(value: string | { id: string }): string {
  return typeof value === 'string' ? value : value.id
}
