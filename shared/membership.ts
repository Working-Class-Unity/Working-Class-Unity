import type { BillingStripePurchaserState, BillingSubscriptionState, MembershipDuesOfferingKey } from './billing'

export type WebsiteMembershipAccess = Readonly<{
  granted: boolean
  graceDeadline: string | null
  offering: MembershipDuesOfferingKey | null
  source: 'canonical' | 'stripe' | 'stripe_membership' | 'supporter'
  state: BillingSubscriptionState
}>

export type AccountMembershipState = Readonly<{
  level: 'member' | 'supporter'
  identityReviewPending: boolean
  access: WebsiteMembershipAccess
  billing: BillingStripePurchaserState
}>

export function isStripeMembershipCancellationScheduled(state: AccountMembershipState): boolean {
  return state.access.source === 'stripe' && state.access.granted && !state.billing.subscription.renewalEnabled
}
