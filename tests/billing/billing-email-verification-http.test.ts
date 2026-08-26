import { createServer, type Server } from 'node:http'
import { createApp, createRouter, toNodeListener, type EventHandler } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { billingStripeCompositionFixture } from './composition-fixture'

const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
  getAppRuntimeConfig: vi.fn()
}))

vi.mock('../../server/services/payments/stripe/app-composition', async () => ({
  default: (await import('./composition-fixture')).default
}))
vi.mock('../../server/services/payments/stripe/billing-email-verification', () => ({
  consumeBillingEmailVerification: mocks.consume
}))
vi.mock('../../server/utils/runtime', () => ({
  getAppRuntimeConfig: mocks.getAppRuntimeConfig
}))

let server: Server
let baseUrl: string

beforeAll(async () => {
  const handler = await import('../../server/api/account/billing/verify-email.get').then((module) => module.default)
  const router = createRouter().get('/api/account/billing/verify-email', handler as EventHandler)
  server = createServer(toNodeListener(createApp().use(router)))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected HTTP test address')
  baseUrl = `http://127.0.0.1:${address.port}`
})

beforeEach(() => {
  vi.clearAllMocks()
  billingStripeCompositionFixture.configuration = {
    appName: 'Billing email HTTP Test',
    appUrl: 'https://app.example.test',
    stripe: {
      secretKey: 'rk_test_billing_email_http',
      webhookSecret: 'whsec_billing_email_http',
      portalConfigurationId: 'bpc_billing_email_http',
      prices: {
        'personal.weekly': '',
        'personal.monthly': 'price_membership_10',
        'personal.annual': '',
        'family.monthly': 'price_solidarity_27',
        'family.annual': ''
      }
    }
  }
  billingStripeCompositionFixture.connection = { sqlite: {} as never }
  billingStripeCompositionFixture.requireUserCalls = 0
  mocks.getAppRuntimeConfig.mockReturnValue({ betterAuth: { secret: 'billing-email-http-secret' } })
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

describe('billing-email verification HTTP boundary', () => {
  it.each(['verified', 'conflict', 'expired', 'ignored'])(
    'returns the same no-store redirect for the %s outcome without requiring a session',
    async (outcome) => {
      mocks.consume.mockReturnValue(outcome)
      const response = await fetch(
        `${baseUrl}/api/account/billing/verify-email?id=verification-safe&token=${'a'.repeat(43)}`,
        { redirect: 'manual' }
      )

      expect(response.status).toBe(302)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(response.headers.get('location')).toBe('/login?status=billing-email-checked')
      expect(billingStripeCompositionFixture.requireUserCalls).toBe(0)
      expect(mocks.consume).toHaveBeenCalledExactlyOnceWith(billingStripeCompositionFixture.connection, {
        secret: 'billing-email-http-secret',
        stripePrices: billingStripeCompositionFixture.configuration.stripe.prices,
        token: 'a'.repeat(43),
        verificationId: 'verification-safe'
      })
    }
  )

  it('uses the same redirect and does no verification work for a malformed query', async () => {
    const response = await fetch(`${baseUrl}/api/account/billing/verify-email?id=verification-safe`, {
      redirect: 'manual'
    })

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/login?status=billing-email-checked')
    expect(mocks.consume).not.toHaveBeenCalled()
    expect(mocks.getAppRuntimeConfig).not.toHaveBeenCalled()
  })
})
