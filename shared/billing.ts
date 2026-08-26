export const billingPlans = Object.freeze(['personal', 'family'] as const)
export const billingCadences = Object.freeze(['weekly', 'monthly', 'annual'] as const)
export const billingOfferingKeys = Object.freeze([
  'personal.weekly',
  'personal.monthly',
  'personal.annual',
  'family.monthly',
  'family.annual'
] as const)
export const membershipDuesOfferingKeys = Object.freeze(['personal.monthly', 'family.monthly'] as const)

export const stripeSubscriptionStatuses = Object.freeze([
  'active',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'past_due',
  'paused',
  'trialing',
  'unpaid'
] as const)
export const billingSnapshotStatuses = Object.freeze(['none', ...stripeSubscriptionStatuses, 'ambiguous'] as const)

export type BillingPlan = (typeof billingPlans)[number]
export type BillingCadence = (typeof billingCadences)[number]
export type BillingOfferingKey = (typeof billingOfferingKeys)[number]
export type MembershipDuesOfferingKey = (typeof membershipDuesOfferingKeys)[number]
export type StripeSubscriptionStatus = (typeof stripeSubscriptionStatuses)[number]
export type BillingSnapshotStatus = (typeof billingSnapshotStatuses)[number]

export type BillingOfferingDefinition = Readonly<{
  key: BillingOfferingKey
  plan: BillingPlan
  cadence: BillingCadence
}>

function deriveOfferingDefinition(key: BillingOfferingKey): BillingOfferingDefinition {
  const [plan, cadence] = key.split('.') as [BillingPlan, BillingCadence]
  return Object.freeze({ key, plan, cadence })
}

export const billingOfferingDefinitions = Object.freeze(billingOfferingKeys.map(deriveOfferingDefinition))
export const membershipDuesOfferingDefinitions = Object.freeze(membershipDuesOfferingKeys.map(deriveOfferingDefinition))
const offeringByKey = new Map(billingOfferingDefinitions.map((offering) => [offering.key, offering] as const))
const membershipDuesOfferingSet = new Set<BillingOfferingKey>(membershipDuesOfferingKeys)

export function isBillingOfferingKey(value: string): value is BillingOfferingKey {
  return offeringByKey.has(value as BillingOfferingKey)
}

export function getBillingOffering(value: string): BillingOfferingDefinition | null {
  return offeringByKey.get(value as BillingOfferingKey) ?? null
}

export function isMembershipDuesOfferingKey(value: string): value is MembershipDuesOfferingKey {
  return membershipDuesOfferingSet.has(value as BillingOfferingKey)
}

export type BillingSubscriptionState =
  'none' | 'active' | 'grace' | 'suspended' | 'terminal' | 'reconciliation_required'
export type BillingTransitionKind = 'cadence_change' | 'personal_to_family' | 'family_to_personal'
export type BillingTransitionState = 'pending' | 'action_required' | 'scheduled' | 'reconciliation_required'

export type BillingStripePurchaserState = Readonly<{
  catalog: readonly BillingOfferingDefinition[]
  deletionPending: boolean
  subscription: Readonly<{
    provider: 'Stripe'
    state: BillingSubscriptionState
    offering: BillingOfferingKey | null
    plan: BillingPlan | null
    cadence: BillingCadence | null
    currentPeriodEnd: string | null
    renewalEnabled: boolean
    graceDeadline: string | null
    checkoutPending: boolean
  }>
  transition: Readonly<{
    kind: BillingTransitionKind
    targetOffering: BillingOfferingKey
    effectiveAt: string | null
    state: BillingTransitionState
  }> | null
  capabilities: Readonly<{
    canCheckout: boolean
    canChange: boolean
    canManage: boolean
    canReconcile: boolean
  }>
}>
