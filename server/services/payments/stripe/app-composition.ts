import { useDatabase } from '../../../db/client'
import { captureException } from '../../observability/capture'
import { getAppRuntimeConfig, type AppRuntimeConfig } from '../../../utils/runtime'
import { defineBillingStripeComposition } from './public-contract'
import type { BillingStripeRuntimeConfiguration } from './configuration'

export function billingStripeConfiguration(
  config: AppRuntimeConfig = getAppRuntimeConfig()
): BillingStripeRuntimeConfiguration {
  return Object.freeze({
    appName: config.public.appName,
    appUrl: config.public.appUrl,
    stripe: Object.freeze({
      secretKey: config.stripe.secretKey,
      webhookSecret: config.stripe.webhookSecret,
      portalConfigurationId: config.stripe.portalConfigurationId,
      prices: Object.freeze({
        'personal.weekly': config.stripe.personalWeeklyPriceId,
        'personal.monthly': config.stripe.personalMonthlyPriceId,
        'personal.annual': config.stripe.personalAnnualPriceId,
        'family.monthly': config.stripe.familyMonthlyPriceId,
        'family.annual': config.stripe.familyAnnualPriceId
      })
    })
  })
}

export const billingStripeComposition = defineBillingStripeComposition({
  connection: useDatabase,
  configuration: billingStripeConfiguration,
  requireUserId: async (event) => {
    const { requireSession } = await import('../../../utils/auth/require-session')
    return (await requireSession(event)).user.id
  },
  reportFailure: (error) => captureException(error, 'billing-operation-failed'),
  integration: undefined
})

export default billingStripeComposition
