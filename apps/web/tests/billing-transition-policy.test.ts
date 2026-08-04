import { describe, expect, it } from 'vitest'
import { deriveBillingTransition } from '../server/services/payments/billing-transition-policy'

describe('Stripe billing transition policy', () => {
  it('defers cadence-only changes through a Subscription Schedule', () => {
    expect(deriveBillingTransition('personal', 'weekly', 'personal.annual')).toEqual({
      kind: 'cadence_change',
      targetOffering: 'personal.annual',
      timing: 'period_end',
      mechanism: 'subscription_schedule',
      resetBillingCycle: false
    })
    expect(deriveBillingTransition('family', 'monthly', 'family.annual')).toEqual({
      kind: 'cadence_change',
      targetOffering: 'family.annual',
      timing: 'period_end',
      mechanism: 'subscription_schedule',
      resetBillingCycle: false
    })
  })

  it('uses a pending update for an immediate Personal-to-Family upgrade', () => {
    expect(deriveBillingTransition('personal', 'monthly', 'family.monthly')).toEqual({
      kind: 'personal_to_family',
      targetOffering: 'family.monthly',
      timing: 'immediate',
      mechanism: 'pending_update',
      resetBillingCycle: false
    })
    expect(deriveBillingTransition('personal', 'weekly', 'family.annual')).toEqual({
      kind: 'personal_to_family',
      targetOffering: 'family.annual',
      timing: 'immediate',
      mechanism: 'pending_update',
      resetBillingCycle: true
    })
  })

  it('defers Family-to-Personal downgrades through a Subscription Schedule', () => {
    expect(deriveBillingTransition('family', 'annual', 'personal.monthly')).toEqual({
      kind: 'family_to_personal',
      targetOffering: 'personal.monthly',
      timing: 'period_end',
      mechanism: 'subscription_schedule',
      resetBillingCycle: false
    })
  })

  it('returns no transition when the selected offering is already current', () => {
    expect(deriveBillingTransition('personal', 'annual', 'personal.annual')).toBeNull()
    expect(deriveBillingTransition('family', 'monthly', 'family.monthly')).toBeNull()
  })
})
