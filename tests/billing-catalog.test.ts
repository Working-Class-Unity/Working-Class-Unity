import { describe, expect, it } from 'vitest'
import {
  billingCadences,
  billingOfferingKeys,
  billingOfferingDefinitions,
  billingPlans,
  getBillingOffering,
  isBillingOfferingKey
} from '../shared/billing'
import { createStripeBillingCatalog } from '../server/services/payments/billing-catalog'

const stripeConfig = {
  secretKey: 'sk_test_private',
  webhookSecret: 'whsec_private',
  portalConfigurationId: 'bpc_test',
  personalWeeklyPriceId: 'price_personal_weekly',
  personalMonthlyPriceId: 'price_personal_monthly',
  personalAnnualPriceId: 'price_personal_annual',
  familyMonthlyPriceId: 'price_family_monthly',
  familyAnnualPriceId: 'price_family_annual'
} as const

describe('billing catalog', () => {
  it('publishes exactly the five stable offering keys with derived plan and cadence metadata', () => {
    expect(billingPlans).toEqual(['personal', 'family'])
    expect(billingCadences).toEqual(['weekly', 'monthly', 'annual'])
    expect(billingOfferingKeys).toEqual([
      'personal.weekly',
      'personal.monthly',
      'personal.annual',
      'family.monthly',
      'family.annual'
    ])
    expect(Object.isFrozen(billingPlans)).toBe(true)
    expect(Object.isFrozen(billingCadences)).toBe(true)
    expect(billingOfferingDefinitions).toEqual([
      { key: 'personal.weekly', plan: 'personal', cadence: 'weekly' },
      { key: 'personal.monthly', plan: 'personal', cadence: 'monthly' },
      { key: 'personal.annual', plan: 'personal', cadence: 'annual' },
      { key: 'family.monthly', plan: 'family', cadence: 'monthly' },
      { key: 'family.annual', plan: 'family', cadence: 'annual' }
    ])
    expect(Object.isFrozen(billingOfferingKeys)).toBe(true)
    expect(Object.isFrozen(billingOfferingDefinitions)).toBe(true)
    expect(billingOfferingDefinitions.every((offering) => Object.isFrozen(offering))).toBe(true)
  })

  it('keeps public metadata provider- and price-free', () => {
    const serialized = JSON.stringify(billingOfferingDefinitions)

    expect(serialized).not.toMatch(/stripe|price|secret|portal|amount|currency|environment/i)
  })

  it('recognizes only exact offering keys', () => {
    expect(isBillingOfferingKey('personal.weekly')).toBe(true)
    expect(getBillingOffering('family.annual')).toEqual({
      key: 'family.annual',
      plan: 'family',
      cadence: 'annual'
    })
    expect(isBillingOfferingKey('family.weekly')).toBe(false)
    expect(getBillingOffering('family.weekly')).toBeNull()
  })

  it('keeps a private bidirectional mapping between offering keys and configured Price IDs', () => {
    const catalog = createStripeBillingCatalog(stripeConfig)

    expect(catalog.priceIdForOffering('personal.weekly')).toBe('price_personal_weekly')
    expect(catalog.priceIdForOffering('family.annual')).toBe('price_family_annual')
    expect(catalog.offeringForPriceId('price_personal_annual')).toBe('personal.annual')
    expect(catalog.offeringForPriceId('price_family_monthly')).toBe('family.monthly')
    expect(Object.keys(catalog)).toEqual(['priceIdForOffering', 'offeringForPriceId'])
    expect(JSON.stringify(catalog)).not.toContain('price_personal_weekly')
  })

  it('rejects duplicate and unrecognized values without exposing configured Price IDs', () => {
    const duplicatePriceId = 'price_duplicate_private'

    expect(() =>
      createStripeBillingCatalog({
        ...stripeConfig,
        personalWeeklyPriceId: duplicatePriceId,
        familyAnnualPriceId: duplicatePriceId
      })
    ).toThrowError(
      expect.objectContaining({
        statusCode: 503,
        statusMessage: 'Stripe billing catalog is invalid'
      })
    )

    try {
      createStripeBillingCatalog({
        ...stripeConfig,
        personalWeeklyPriceId: duplicatePriceId,
        familyAnnualPriceId: duplicatePriceId
      })
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(duplicatePriceId)
    }

    const catalog = createStripeBillingCatalog(stripeConfig)
    expect(catalog.offeringForPriceId('price_unrecognized')).toBeNull()
    expect(() => catalog.priceIdForOffering('family.weekly' as never)).toThrowError(
      expect.objectContaining({
        statusCode: 503,
        statusMessage: 'Stripe billing catalog is invalid'
      })
    )
  })
})
