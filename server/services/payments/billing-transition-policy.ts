import {
  getBillingOffering,
  type BillingCadence,
  type BillingOfferingKey,
  type BillingPlan,
  type BillingTransitionKind
} from '../../../shared/billing'

export type BillingTransitionDecision = Readonly<{
  kind: BillingTransitionKind
  targetOffering: BillingOfferingKey
  timing: 'immediate' | 'period_end'
  mechanism: 'pending_update' | 'subscription_schedule'
  resetBillingCycle: boolean
}>

export function deriveBillingTransition(
  currentPlan: BillingPlan,
  currentCadence: BillingCadence,
  targetOffering: BillingOfferingKey
): BillingTransitionDecision | null {
  const target = getBillingOffering(targetOffering)!

  if (target.plan === currentPlan && target.cadence === currentCadence) return null

  if (target.plan === currentPlan) {
    return decision('cadence_change', targetOffering, 'period_end', 'subscription_schedule', false)
  }

  if (currentPlan === 'personal') {
    return decision(
      'personal_to_family',
      targetOffering,
      'immediate',
      'pending_update',
      currentCadence !== target.cadence
    )
  }

  return decision('family_to_personal', targetOffering, 'period_end', 'subscription_schedule', false)
}

function decision(
  kind: BillingTransitionKind,
  targetOffering: BillingOfferingKey,
  timing: BillingTransitionDecision['timing'],
  mechanism: BillingTransitionDecision['mechanism'],
  resetBillingCycle: boolean
): BillingTransitionDecision {
  return Object.freeze({ kind, targetOffering, timing, mechanism, resetBillingCycle })
}
