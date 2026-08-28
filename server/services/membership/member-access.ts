import type { BillingStripePriceConfiguration } from '../payments/stripe/configuration'
import { createStripeBillingCatalog } from '../payments/stripe/catalog'
import { readBaseBillingStripePurchaserState } from '../payments/stripe/purchaser-state'
import type { BillingStripeConnection } from '../payments/stripe/public-contract'
import {
  isMembershipDuesOfferingKey,
  type BillingSubscriptionState,
  type MembershipDuesOfferingKey
} from '../../../shared/billing'
import type { AccountMembershipState, WebsiteMembershipAccess } from '../../../shared/membership'
import { hasOpenWebsiteAccountIdentityReview } from './account-identity'
import { hasCurrentImportedStripeDuesSubscription } from './imported-stripe-billing'
import { hasAccountStripeMembership, type StripeMembershipTier } from './stripe-first'

export type { WebsiteMembershipAccess }

export function readAccountMembershipState(
  connection: BillingStripeConnection,
  userId: string,
  prices: BillingStripePriceConfiguration,
  now = new Date()
): AccountMembershipState {
  const access = readWebsiteMembershipAccess(connection, userId, prices, now)
  const baseBilling = readBaseBillingStripePurchaserState(connection, userId, now)
  const identityReviewPending = hasOpenWebsiteAccountIdentityReview(connection, userId)
  const stripeMembershipLinked = hasAccountStripeMembership(connection, userId)
  const currentImportedSubscription = hasCurrentImportedStripeDuesSubscription(connection, userId, {
    'personal.monthly': prices['personal.monthly'],
    'family.monthly': prices['family.monthly']
  })
  const billing =
    (stripeMembershipLinked || currentImportedSubscription || identityReviewPending) &&
    baseBilling.capabilities.canCheckout
      ? Object.freeze({
          ...baseBilling,
          capabilities: Object.freeze({ ...baseBilling.capabilities, canCheckout: false })
        })
      : baseBilling
  return Object.freeze({ level: access.granted ? 'member' : 'supporter', identityReviewPending, access, billing })
}

export function readWebsiteMembershipAccess(
  connection: BillingStripeConnection,
  userId: string,
  prices: BillingStripePriceConfiguration,
  now = new Date()
): WebsiteMembershipAccess {
  const linkedTier = connection.sqlite
    .prepare('select tier from account_stripe_memberships where user_id = ?')
    .get(userId) as { tier: StripeMembershipTier } | undefined
  if (linkedTier) {
    return linkedTier.tier === 'supporter'
      ? result('supporter', 'none', false)
      : result('stripe_membership', 'active', true)
  }
  if (!personForUser(connection, userId)) return result('supporter', 'none', false)

  const subscription = connection.sqlite
    .prepare('select stripe_price_id as stripePriceId from billing_subscriptions where purchaser_user_id = ?')
    .get(userId) as { stripePriceId: string | null } | undefined
  const hasBillingCustomer = Boolean(
    connection.sqlite.prepare('select 1 from billing_customers where purchaser_user_id = ?').get(userId)
  )

  if (subscription || hasBillingCustomer) {
    const state = readBaseBillingStripePurchaserState(connection, userId, now)
    if (!subscription) return result('stripe', 'reconciliation_required', false)
    const catalog = createStripeBillingCatalog(prices)
    const offering = subscription.stripePriceId ? catalog.offeringForPriceId(subscription.stripePriceId) : null
    if (!offering || !isMembershipDuesOfferingKey(offering) || state.subscription.offering !== offering) {
      return result('stripe', 'reconciliation_required', false)
    }
    return result(
      'stripe',
      state.subscription.state,
      state.subscription.state === 'active' || state.subscription.state === 'grace',
      state.subscription.graceDeadline,
      offering
    )
  }

  const canonical = Boolean(
    connection.sqlite
      .prepare(
        `select 1 from person_accounts pa
         join memberships m on m.person_id = pa.person_id
         where pa.user_id = ? and m.status = 'active' and m.ended_at is null limit 1`
      )
      .get(userId)
  )
  return canonical ? result('canonical', 'active', true) : result('supporter', 'none', false)
}

function personForUser(connection: BillingStripeConnection, userId: string): boolean {
  return Boolean(connection.sqlite.prepare('select 1 from person_accounts where user_id = ?').get(userId))
}

function result(
  source: WebsiteMembershipAccess['source'],
  state: BillingSubscriptionState,
  granted: boolean,
  graceDeadline: string | null = null,
  offering: MembershipDuesOfferingKey | null = null
): WebsiteMembershipAccess {
  return Object.freeze({ granted, graceDeadline, offering, source, state })
}
