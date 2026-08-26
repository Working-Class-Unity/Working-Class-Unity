import { describe, expect, it } from 'vitest'
import { createStripeBillingCatalog } from '../../server/services/payments/stripe/catalog'
import {
  billingCadences,
  billingOfferingDefinitions,
  billingOfferingKeys,
  billingPlans,
  getBillingOffering,
  isBillingOfferingKey,
  isMembershipDuesOfferingKey,
  membershipDuesOfferingDefinitions,
  membershipDuesOfferingKeys
} from '../../shared/billing'

const prices = {
  'personal.weekly': '',
  'personal.monthly': 'price_personal_monthly',
  'personal.annual': '',
  'family.monthly': 'price_family_monthly',
  'family.annual': ''
} as const

describe('private Stripe billing catalog', () => {
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
    expect(billingOfferingDefinitions).toEqual([
      { key: 'personal.weekly', plan: 'personal', cadence: 'weekly' },
      { key: 'personal.monthly', plan: 'personal', cadence: 'monthly' },
      { key: 'personal.annual', plan: 'personal', cadence: 'annual' },
      { key: 'family.monthly', plan: 'family', cadence: 'monthly' },
      { key: 'family.annual', plan: 'family', cadence: 'annual' }
    ])
    for (const value of [billingPlans, billingCadences, billingOfferingKeys, billingOfferingDefinitions]) {
      expect(Object.isFrozen(value)).toBe(true)
    }
    expect(billingOfferingDefinitions.every(Object.isFrozen)).toBe(true)
  })

  it('keeps public metadata provider- and price-free', () => {
    expect(membershipDuesOfferingKeys).toEqual(['personal.monthly', 'family.monthly'])
    expect(membershipDuesOfferingDefinitions).toEqual([
      { key: 'personal.monthly', plan: 'personal', cadence: 'monthly' },
      { key: 'family.monthly', plan: 'family', cadence: 'monthly' }
    ])
    expect(JSON.stringify(membershipDuesOfferingDefinitions)).not.toMatch(
      /stripe|price|secret|portal|amount|currency|environment/i
    )
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
    expect(isMembershipDuesOfferingKey('personal.monthly')).toBe(true)
    expect(isMembershipDuesOfferingKey('family.monthly')).toBe(true)
    expect(isMembershipDuesOfferingKey('personal.weekly')).toBe(false)
  })

  it('maps only the two monthly dues offerings without exposing configured values through serialization', () => {
    const catalog = createStripeBillingCatalog(prices)

    expect(catalog.priceIdForOffering('personal.monthly')).toBe('price_personal_monthly')
    expect(catalog.priceIdForOffering('family.monthly')).toBe('price_family_monthly')
    expect(catalog.offeringForPriceId('price_personal_monthly')).toBe('personal.monthly')
    expect(catalog.offeringForPriceId('price_family_monthly')).toBe('family.monthly')
    expect(catalog.offeringForPriceId('price_personal_annual')).toBeNull()
    expect(catalog.offeringForPriceId('price_unknown')).toBeNull()
    expect(Object.isFrozen(catalog)).toBe(true)
    expect(JSON.stringify(catalog)).not.toContain('price_personal_monthly')
  })

  it('fails closed for duplicate, malformed, and unsupported mappings without leaking Price IDs', () => {
    const privateDuplicate = 'price_private_duplicate'

    for (const invalidPrices of [
      { ...prices, 'personal.monthly': privateDuplicate, 'family.monthly': privateDuplicate },
      { ...prices, 'personal.monthly': 'product_private_invalid' }
    ]) {
      try {
        createStripeBillingCatalog(invalidPrices)
        throw new Error('Expected invalid catalog')
      } catch (error) {
        expect(error).toMatchObject({
          statusCode: 503,
          statusMessage: 'Stripe billing catalog is invalid'
        })
        expect(JSON.stringify(error)).not.toContain('private')
      }
    }

    const catalog = createStripeBillingCatalog(prices)
    expect(() => catalog.priceIdForOffering('personal.weekly')).toThrowError(
      expect.objectContaining({
        statusCode: 503,
        statusMessage: 'Stripe billing catalog is invalid'
      })
    )
  })
})
