export const billingPlans = Object.freeze(['personal', 'family'] as const)
export const billingCadences = Object.freeze(['weekly', 'monthly', 'annual'] as const)
export const billingOfferingKeys = Object.freeze([
  'personal.weekly',
  'personal.monthly',
  'personal.annual',
  'family.monthly',
  'family.annual'
] as const)

export type BillingPlan = (typeof billingPlans)[number]
export type BillingCadence = (typeof billingCadences)[number]
export type BillingOfferingKey = (typeof billingOfferingKeys)[number]

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

const billingOfferingDefinitionByKey = new Map(
  billingOfferingDefinitions.map((definition) => [definition.key, definition] as const)
)

export function isBillingOfferingKey(value: string): value is BillingOfferingKey {
  return billingOfferingDefinitionByKey.has(value as BillingOfferingKey)
}

export function getBillingOffering(value: string): BillingOfferingDefinition | null {
  return billingOfferingDefinitionByKey.get(value as BillingOfferingKey) ?? null
}

export type BillingRelationship = 'independent' | 'manager' | 'member'
export type BillingEntitlementSource = 'personal' | 'manager' | 'family' | null
export type BillingSubscriptionState =
  'none' | 'active' | 'grace' | 'suspended' | 'terminal' | 'reconciliation_required'
export type BillingEntitlementState = BillingSubscriptionState
export type BillingTransitionKind = 'cadence_change' | 'personal_to_family' | 'family_to_personal'
export type BillingTransitionState = 'pending' | 'action_required' | 'scheduled' | 'reconciliation_required'

export type BillingAccountState = Readonly<{
  catalog: readonly BillingOfferingDefinition[]
  relationship: Readonly<{
    kind: BillingRelationship
  }>
  entitlement: Readonly<{
    granted: boolean
    source: BillingEntitlementSource
    state: BillingEntitlementState
    plan: BillingPlan | null
    cadence: BillingCadence | null
  }>
  subscription: Readonly<{
    provider: 'Stripe'
    state: BillingSubscriptionState
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
  seats: Readonly<{
    accepted: number
    reserved: number
    capacity: number
  }> | null
  members:
    | readonly Readonly<{
        reference: string
        name: string
        email: string
      }>[]
    | null
  capabilities: Readonly<{
    canCheckout: boolean
    canChange: boolean
    canManage: boolean
    canReconcile: boolean
    canLeaveFamily: boolean
    canCreateFamilyInvitation: boolean
    canResendFamilyInvitation: boolean
    canAcceptFamilyInvitation: boolean
    canAddFamilyMember: boolean
    canRemoveFamilyMember: boolean
  }>
}>

export const familyPlanKey = 'family' as const satisfies BillingPlan
