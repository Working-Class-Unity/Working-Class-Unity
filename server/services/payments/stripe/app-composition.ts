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
        'personal.weekly': '',
        'personal.monthly': config.stripe.membershipDues10PriceId,
        'personal.annual': '',
        'family.monthly': config.stripe.solidarityDues27PriceId,
        'family.annual': ''
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
