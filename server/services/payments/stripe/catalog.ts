import { billingOfferingKeys, isMembershipDuesOfferingKey, type BillingOfferingKey } from '../../../../shared/billing'
import { isStripePriceIdForOffering, type BillingStripePriceConfiguration } from './configuration'
import { configurationError } from '../../../utils/errors'

export type StripeBillingCatalog = Readonly<{
  priceIdForOffering(offering: BillingOfferingKey): string
  offeringForPriceId(priceId: string): BillingOfferingKey | null
}>

export function createStripeBillingCatalog(prices: BillingStripePriceConfiguration): StripeBillingCatalog {
  const priceIdByOffering = new Map<BillingOfferingKey, string>()
  const offeringByPriceId = new Map<string, BillingOfferingKey>()

  for (const offering of billingOfferingKeys) {
    const priceId = prices[offering]
    if (!priceId && !isMembershipDuesOfferingKey(offering)) continue
    if (
      typeof priceId !== 'string' ||
      !isStripePriceIdForOffering(offering, priceId) ||
      offeringByPriceId.has(priceId)
    ) {
      throw configurationError('Stripe billing catalog is invalid')
    }
    priceIdByOffering.set(offering, priceId)
    offeringByPriceId.set(priceId, offering)
  }

  return Object.freeze({
    priceIdForOffering(offering: BillingOfferingKey) {
      if (!priceIdByOffering.has(offering)) {
        throw configurationError('Stripe billing catalog is invalid')
      }
      return priceIdByOffering.get(offering)!
    },
    offeringForPriceId(priceId: string) {
      return offeringByPriceId.get(priceId) ?? null
    }
  })
}
