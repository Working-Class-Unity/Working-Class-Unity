import { defineBillingStripeComposition } from '../../server/services/payments/stripe/public-contract'
import type { BillingStripeRuntimeConfiguration } from '../../server/services/payments/stripe/configuration'
import type { BillingStripeConnection } from '../../server/services/payments/stripe/public-contract'

export const billingStripeCompositionFixture: {
  configuration: BillingStripeRuntimeConfiguration
  connection: BillingStripeConnection | null
  purchaserUserId: string
  requireUserError: Error | null
  requireUserCalls: number
  failures: Array<{ error: Error; operation: string }>
} = {
  configuration: {
    enabled: false,
    appName: 'Billing Stripe Test',
    appUrl: 'https://billing.example.test',
    stripe: {
      secretKey: '',
      webhookSecret: '',
      portalConfigurationId: '',
      prices: {
        'personal.weekly': '',
        'personal.monthly': '',
        'personal.annual': '',
        'family.monthly': '',
        'family.annual': ''
      }
    }
  },
  connection: null,
  purchaserUserId: 'purchaser_composition_fixture',
  requireUserError: null,
  requireUserCalls: 0,
  failures: []
}

export default defineBillingStripeComposition({
  connection() {
    if (!billingStripeCompositionFixture.connection) {
      throw new Error('Billing Stripe composition fixture connection was not configured')
    }
    return billingStripeCompositionFixture.connection
  },
  configuration() {
    return billingStripeCompositionFixture.configuration
  },
  async requireUserId() {
    billingStripeCompositionFixture.requireUserCalls += 1
    if (billingStripeCompositionFixture.requireUserError) {
      throw billingStripeCompositionFixture.requireUserError
    }
    return billingStripeCompositionFixture.purchaserUserId
  },
  reportFailure(error, operation) {
    billingStripeCompositionFixture.failures.push({ error, operation })
  }
})
