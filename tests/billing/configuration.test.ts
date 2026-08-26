import { describe, expect, it } from 'vitest'
import {
  evaluateBillingStripeRuntimeConfiguration,
  type BillingStripeRuntimeConfiguration
} from '../../server/services/payments/stripe/configuration'

const prices = {
  'personal.weekly': 'price_personal_weekly',
  'personal.monthly': 'price_personal_monthly',
  'personal.annual': 'price_personal_annual',
  'family.monthly': 'price_family_monthly',
  'family.annual': 'price_family_annual'
} as const

function configuration(overrides: Partial<BillingStripeRuntimeConfiguration> = {}): BillingStripeRuntimeConfiguration {
  return {
    appName: 'SmallWiseLabs',
    appUrl: 'https://app.example.test',
    stripe: {
      secretKey: 'rk_test_billing',
      webhookSecret: 'whsec_billing',
      portalConfigurationId: 'bpc_billing',
      prices
    },
    ...overrides
  }
}

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    NUXT_PUBLIC_APP_NAME: 'SmallWiseLabs',
    NUXT_PUBLIC_APP_URL: 'https://app.example.test',
    NUXT_STRIPE_SECRET_KEY: 'rk_test_billing',
    NUXT_STRIPE_WEBHOOK_SECRET: 'whsec_billing',
    NUXT_STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_billing',
    NUXT_STRIPE_MEMBERSHIP_DUES10_PRICE_ID: prices['personal.monthly'],
    NUXT_STRIPE_SOLIDARITY_DUES27_PRICE_ID: prices['family.monthly'],
    ...overrides
  }
}

describe('Billing Stripe runtime configuration', () => {
  it('accepts the exact runtime tuple and freezes its evaluation', () => {
    const issues = evaluateBillingStripeRuntimeConfiguration(configuration(), environment())

    expect(issues).toEqual([])
    expect(Object.isFrozen(issues)).toBe(true)
  })

  it('requires provider configuration', () => {
    const issues = evaluateBillingStripeRuntimeConfiguration(
      configuration({
        appUrl: '',
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
      }),
      environment({
        NUXT_PUBLIC_APP_URL: undefined,
        NUXT_STRIPE_SECRET_KEY: undefined,
        NUXT_STRIPE_WEBHOOK_SECRET: undefined,
        NUXT_STRIPE_PORTAL_CONFIGURATION_ID: undefined,
        NUXT_STRIPE_MEMBERSHIP_DUES10_PRICE_ID: undefined,
        NUXT_STRIPE_SOLIDARITY_DUES27_PRICE_ID: undefined
      })
    )

    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'missing' })]))
  })

  it('rejects unsafe identifiers, insecure non-loopback URLs, and duplicate prices without leaking values', () => {
    const duplicate = 'price_private_duplicate'
    const issues = evaluateBillingStripeRuntimeConfiguration(
      configuration({
        appUrl: 'http://billing.example.test',
        stripe: {
          secretKey: 'sk_test_unrestricted_private',
          webhookSecret: 'secret_private',
          portalConfigurationId: 'portal_private',
          prices: {
            ...prices,
            'personal.monthly': duplicate,
            'family.monthly': duplicate
          }
        }
      }),
      environment({
        NUXT_PUBLIC_APP_URL: 'http://billing.example.test',
        NUXT_STRIPE_SECRET_KEY: 'sk_test_unrestricted_private',
        NUXT_STRIPE_WEBHOOK_SECRET: 'secret_private',
        NUXT_STRIPE_PORTAL_CONFIGURATION_ID: 'portal_private',
        NUXT_STRIPE_MEMBERSHIP_DUES10_PRICE_ID: duplicate,
        NUXT_STRIPE_SOLIDARITY_DUES27_PRICE_ID: duplicate
      })
    )

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid', key: 'NUXT_PUBLIC_APP_URL' }),
        expect.objectContaining({ code: 'invalid', key: 'NUXT_STRIPE_SECRET_KEY' }),
        expect.objectContaining({ code: 'invalid', key: 'NUXT_STRIPE_WEBHOOK_SECRET' }),
        expect.objectContaining({ code: 'invalid', key: 'NUXT_STRIPE_PORTAL_CONFIGURATION_ID' }),
        expect.objectContaining({ code: 'invalid', key: 'NUXT_STRIPE_MEMBERSHIP_DUES10_PRICE_ID' }),
        expect.objectContaining({ code: 'invalid', key: 'NUXT_STRIPE_SOLIDARITY_DUES27_PRICE_ID' })
      ])
    )
    expect(JSON.stringify(issues)).not.toContain('private')
  })

  it('allows HTTP only for loopback app URLs', () => {
    for (const appUrl of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
      expect(
        evaluateBillingStripeRuntimeConfiguration(
          configuration({ appUrl }),
          environment({ NUXT_PUBLIC_APP_URL: appUrl })
        )
      ).toEqual([])
    }
  })

  it('reports missing, untrimmed, and mismatched environment values by key', () => {
    const issues = evaluateBillingStripeRuntimeConfiguration(
      configuration(),
      environment({
        NUXT_STRIPE_WEBHOOK_SECRET: undefined,
        NUXT_STRIPE_PORTAL_CONFIGURATION_ID: ' bpc_billing ',
        NUXT_STRIPE_MEMBERSHIP_DUES10_PRICE_ID: 'price_other_monthly'
      })
    )

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing', key: 'NUXT_STRIPE_WEBHOOK_SECRET' }),
        expect.objectContaining({ code: 'mismatch', key: 'NUXT_STRIPE_WEBHOOK_SECRET' }),
        expect.objectContaining({ code: 'invalid', key: 'NUXT_STRIPE_PORTAL_CONFIGURATION_ID' }),
        expect.objectContaining({ code: 'mismatch', key: 'NUXT_STRIPE_PORTAL_CONFIGURATION_ID' }),
        expect.objectContaining({ code: 'mismatch', key: 'NUXT_STRIPE_MEMBERSHIP_DUES10_PRICE_ID' })
      ])
    )
  })
})
