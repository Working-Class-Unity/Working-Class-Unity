import type Stripe from 'stripe'
import { afterEach, describe, expect, it } from 'vitest'
import type { BillingStripeRuntimeConfiguration } from '../../server/services/payments/stripe/configuration'
import {
  constructStripeWebhookEvent,
  createStripeClient,
  getStripeClient,
  getStripeWebhookSecret,
  resetStripeClientForTests
} from '../../server/services/payments/stripe/stripe-client'

afterEach(() => resetStripeClientForTests())

describe('Stripe SDK boundary', () => {
  it('uses the official webhook helper and reports missing or invalid signatures safely', () => {
    const client = createStripeClient('rk_test_support')
    const payload = JSON.stringify({ id: 'evt_support', type: 'customer.created' })
    const secret = 'whsec_support'
    const signature = client.webhooks.generateTestHeaderString({ payload, secret })

    expect(constructStripeWebhookEvent(client, payload, signature, secret)).toMatchObject({
      id: 'evt_support',
      type: 'customer.created'
    })
    expect(() => constructStripeWebhookEvent(client, payload, undefined, secret)).toThrow('Missing Stripe signature')
    expect(() => constructStripeWebhookEvent(client, payload, 'invalid', secret)).toThrow(
      'Stripe signature verification failed'
    )
    expect(() => createStripeClient('')).toThrow('Stripe secret key is not configured')
  })

  it('bounds ordinary Stripe attempts and performs only one SDK network retry', async () => {
    const observedTimeouts: number[] = []
    const httpClient = {
      getClientName() {
        return 'deterministic-local-fake'
      },
      async makeRequest(
        _host: string,
        _port: string,
        _path: string,
        _method: string,
        _headers: Stripe.RequestHeaders,
        _requestData: string,
        _protocol: string,
        timeout: number
      ) {
        observedTimeouts.push(timeout)
        const error = new TypeError('local transport closed') as TypeError & { code: string }
        error.code = 'ECONNRESET'
        throw error
      }
    } as Stripe.HttpClient
    const client = createStripeClient('rk_test_local_transport', httpClient)

    await expect(client.subscriptions.list({ limit: 1 })).rejects.toMatchObject({
      type: 'StripeConnectionError'
    })
    expect(observedTimeouts).toEqual([10_000, 10_000])
  })

  it('validates required configuration and caches the production client', () => {
    const ready = runtimeConfiguration()
    const missingWebhookSecret = runtimeConfiguration({
      stripe: { ...runtimeConfiguration().stripe, webhookSecret: '' }
    })

    expect(() => getStripeWebhookSecret(missingWebhookSecret)).toThrow('Stripe webhook secret is not configured')
    expect(getStripeWebhookSecret(ready)).toBe('whsec_support')

    const first = getStripeClient(ready)
    const cached = getStripeClient(
      runtimeConfiguration({
        stripe: { ...ready.stripe, secretKey: 'rk_test_other' }
      })
    )
    expect(cached).toBe(first)

    resetStripeClientForTests()
    expect(getStripeClient(ready)).not.toBe(first)
  })
})

function runtimeConfiguration(
  overrides: Partial<BillingStripeRuntimeConfiguration> = {}
): BillingStripeRuntimeConfiguration {
  return {
    appName: 'Support Test',
    appUrl: 'https://app.example.test',
    stripe: {
      secretKey: 'rk_test_support',
      webhookSecret: 'whsec_support',
      portalConfigurationId: 'bpc_support',
      prices: {
        'personal.weekly': 'price_personal_weekly_support',
        'personal.monthly': 'price_personal_monthly_support',
        'personal.annual': 'price_personal_annual_support',
        'family.monthly': 'price_family_monthly_support',
        'family.annual': 'price_family_annual_support'
      }
    },
    ...overrides
  }
}
