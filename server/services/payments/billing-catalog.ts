import { billingOfferingKeys, isBillingOfferingKey, type BillingOfferingKey } from '../../../shared/billing'
import type { AppRuntimeConfig } from '../../utils/runtime'
import { configurationError } from '../../utils/errors'

const priceConfigKeys = {
  'personal.weekly': 'personalWeeklyPriceId',
  'personal.monthly': 'personalMonthlyPriceId',
  'personal.annual': 'personalAnnualPriceId',
  'family.monthly': 'familyMonthlyPriceId',
  'family.annual': 'familyAnnualPriceId'
} as const satisfies Record<BillingOfferingKey, keyof AppRuntimeConfig['stripe']>

export type StripeBillingCatalog = Readonly<{
  priceIdForOffering(offering: BillingOfferingKey): string
  offeringForPriceId(priceId: string): BillingOfferingKey | null
}>

export function createStripeBillingCatalog(config: AppRuntimeConfig['stripe']): StripeBillingCatalog {
  const priceIdByOffering = new Map<BillingOfferingKey, string>()
  const offeringByPriceId = new Map<string, BillingOfferingKey>()

  for (const offering of billingOfferingKeys) {
    const priceId = config[priceConfigKeys[offering]]
    if (!priceId || !priceId.startsWith('price_') || offeringByPriceId.has(priceId)) {
      throw configurationError('Stripe billing catalog is invalid')
    }
    priceIdByOffering.set(offering, priceId)
    offeringByPriceId.set(priceId, offering)
  }

  return Object.freeze({
    priceIdForOffering(offering: BillingOfferingKey) {
      if (!isBillingOfferingKey(offering)) {
        throw configurationError('Stripe billing catalog is invalid')
      }
      return priceIdByOffering.get(offering)!
    },
    offeringForPriceId(priceId: string) {
      return offeringByPriceId.get(priceId) ?? null
    }
  })
}
