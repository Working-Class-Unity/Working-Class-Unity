import { familyPlanKey } from './billing'

export { familyPlanKey, type BillingAccountState } from './billing'
export const familyPlanCapacity = 6 as const

export const stripeSubscriptionStatuses = [
  'active',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'past_due',
  'paused',
  'trialing',
  'unpaid'
] as const
export const billingSnapshotStatuses = ['none', ...stripeSubscriptionStatuses, 'ambiguous'] as const

// This legacy shape has no authenticated first-failure timestamp, so it can
// prove only ordinary active access. The billing dunning evaluator owns the
// separately verified, bounded `past_due` grace case; trials never grant.
const grantingStripeSubscriptionStatuses = ['active'] as const

export type FamilyPlanKey = typeof familyPlanKey
export type StripeSubscriptionStatus = (typeof stripeSubscriptionStatuses)[number]
export type BillingSnapshotStatus = (typeof billingSnapshotStatuses)[number]
type GrantingStripeSubscriptionStatus = (typeof grantingStripeSubscriptionStatuses)[number]

type FamilyPlanEntitlementSnapshot = Readonly<{
  checkoutReconciliationRequired: boolean
  planKey: string | null
  reconciliationRequired: boolean
  status: string | null
}>

function isGrantingStripeSubscriptionStatus(value: string): value is GrantingStripeSubscriptionStatus {
  return grantingStripeSubscriptionStatuses.some((status) => status === value)
}

export function isGrantingFamilyPlanSnapshot(snapshot: FamilyPlanEntitlementSnapshot): boolean {
  return (
    !snapshot.reconciliationRequired &&
    !snapshot.checkoutReconciliationRequired &&
    snapshot.planKey === familyPlanKey &&
    snapshot.status !== null &&
    isGrantingStripeSubscriptionStatus(snapshot.status)
  )
}
