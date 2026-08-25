import { createServer, request as nodeRequest, type Server } from 'node:http'
import Stripe from 'stripe'
import { createApp, createError, createRouter, toNodeListener, type EventHandler } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestWithChunkedBody, requestWithDeclaredBody } from './http-request'
import type { BillingStripeRuntimeConfiguration } from '../../server/services/payments/stripe/configuration'
import * as stripeClientModule from '../../server/services/payments/stripe/stripe-client'
import {
  billingReconciliationRateLimitMax,
  resetBillingReconciliationRateLimitForTests
} from '../../server/services/payments/stripe/reconciliation-rate-limit'
import { billingStripeWebhookBodyLimitBytes } from '../../server/api/webhooks/stripe.post'
import { billingStripeCompositionFixture } from './composition-fixture'

const serviceMocks = vi.hoisted(() => ({
  getBillingStripeState: vi.fn(),
  createBillingStripeCheckout: vi.fn(),
  changeBillingStripeOffering: vi.fn(),
  createBillingStripePortal: vi.fn(),
  reconcileBillingStripe: vi.fn()
}))
const webhookMocks = vi.hoisted(() => ({ processStripeWebhookEvent: vi.fn() }))

vi.mock('../../server/services/payments/stripe/app-composition', async () => ({
  default: (await import('./composition-fixture')).default
}))
vi.mock('../../server/services/payments/stripe/billing-service', () => serviceMocks)
vi.mock('../../server/services/payments/stripe/webhook', () => webhookMocks)

const getStripeClientSpy = vi.spyOn(stripeClientModule, 'getStripeClient')

const webhookSecret = 'whsec_package_http_boundary'
const stripeKey = 'rk_test_package_http_boundary'
let server: Server
let baseUrl: string

beforeAll(async () => {
  const [billing, checkout, change, portal, reconcile, webhook] = await Promise.all([
    import('../../server/api/account/billing/index.get').then((module) => module.default),
    import('../../server/api/account/billing/checkout.post').then((module) => module.default),
    import('../../server/api/account/billing/change.post').then((module) => module.default),
    import('../../server/api/account/billing/portal.post').then((module) => module.default),
    import('../../server/api/account/billing/reconcile.post').then((module) => module.default),
    import('../../server/api/webhooks/stripe.post').then((module) => module.default)
  ])
  const router = createRouter()
    .get('/api/account/billing', billing as EventHandler)
    .post('/api/account/billing/checkout', checkout as EventHandler)
    .post('/api/account/billing/change', change as EventHandler)
    .post('/api/account/billing/portal', portal as EventHandler)
    .post('/api/account/billing/reconcile', reconcile as EventHandler)
    .post('/api/webhooks/stripe', webhook as EventHandler)
  server = createServer(toNodeListener(createApp().use(router)))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected HTTP test address')
  baseUrl = `http://127.0.0.1:${address.port}`
})

beforeEach(() => {
  vi.clearAllMocks()
  stripeClientModule.resetStripeClientForTests()
  resetBillingReconciliationRateLimitForTests()
  billingStripeCompositionFixture.configuration = runtimeConfiguration()
  billingStripeCompositionFixture.connection = { sqlite: {} as never }
  billingStripeCompositionFixture.purchaserUserId = 'purchaser_http'
  billingStripeCompositionFixture.requireUserError = null
  billingStripeCompositionFixture.requireUserCalls = 0
  billingStripeCompositionFixture.failures.length = 0
  serviceMocks.getBillingStripeState.mockReturnValue(safeState())
  serviceMocks.createBillingStripeCheckout.mockResolvedValue({ url: 'https://checkout.stripe.test/cs_safe' })
  serviceMocks.changeBillingStripeOffering.mockResolvedValue(safeState())
  serviceMocks.createBillingStripePortal.mockResolvedValue({ url: 'https://billing.stripe.test/bps_safe' })
  serviceMocks.reconcileBillingStripe.mockResolvedValue(safeState())
  webhookMocks.processStripeWebhookEvent.mockResolvedValue({ duplicate: false, target: 'ignored' })
})

afterAll(async () => {
  stripeClientModule.resetStripeClientForTests()
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

describe('Billing HTTP boundary', () => {
  it('authenticates Billing portal commands before bounded body parsing', async () => {
    billingStripeCompositionFixture.requireUserError = createError({
      statusCode: 401,
      statusMessage: 'Authentication required'
    })
    const anonymous = await requestWithDeclaredBody(new URL('/api/account/billing/portal', baseUrl), 1_025, [], {
      endRequest: false,
      headers: { 'content-type': 'application/json' }
    })

    expect(anonymous.status).toBe(401)
    expect(billingStripeCompositionFixture.requireUserCalls).toBe(1)
    expect(getStripeClientSpy).not.toHaveBeenCalled()
    expect(serviceMocks.createBillingStripePortal).not.toHaveBeenCalled()
  })

  it('authenticates Billing reconciliation commands before bounded body parsing', async () => {
    billingStripeCompositionFixture.requireUserError = createError({
      statusCode: 401,
      statusMessage: 'Authentication required'
    })
    const anonymous = await requestWithDeclaredBody(new URL('/api/account/billing/reconcile', baseUrl), 1_025, [], {
      endRequest: false,
      headers: { 'content-type': 'application/json' }
    })

    expect(anonymous.status).toBe(401)
    expect(anonymous.headers['cache-control']).toBe('private, no-store')
    expect(billingStripeCompositionFixture.requireUserCalls).toBe(1)
    expect(getStripeClientSpy).not.toHaveBeenCalled()
    expect(serviceMocks.reconcileBillingStripe).not.toHaveBeenCalled()
  })

  it('authenticates commands before parsing and rejects provider/scope injection', async () => {
    billingStripeCompositionFixture.requireUserError = createError({
      statusCode: 401,
      statusMessage: 'Authentication required'
    })
    const anonymous = await requestWithDeclaredBody(new URL('/api/account/billing/checkout', baseUrl), 1_025, [], {
      endRequest: false,
      headers: { 'content-type': 'application/json' }
    })
    expect(anonymous.status).toBe(401)
    expect(getStripeClientSpy).not.toHaveBeenCalled()
    expect(serviceMocks.createBillingStripeCheckout).not.toHaveBeenCalled()

    billingStripeCompositionFixture.requireUserError = null
    for (const body of [
      {},
      { offering: 'other' },
      { offering: 'family.monthly', priceId: 'price_injected' },
      { offering: 'family.monthly', customer: 'cus_injected' },
      { offering: 'family.monthly', organizationId: 'organization_injected' },
      { offering: 'family.monthly', idempotencyKey: 'injected' }
    ]) {
      expect((await jsonRequest('/api/account/billing/checkout', body)).status).toBe(400)
    }
    const valid = await jsonRequest('/api/account/billing/checkout', { offering: 'family.monthly' })
    expect(valid.status).toBe(200)
    expect(await valid.json()).toEqual({ url: 'https://checkout.stripe.test/cs_safe' })
    expect(serviceMocks.createBillingStripeCheckout).toHaveBeenCalledTimes(1)
    expect(serviceMocks.createBillingStripeCheckout.mock.calls[0]?.slice(1, 3)).toEqual([
      'purchaser_http',
      'family.monthly'
    ])
  })

  it('bounds authenticated Billing checkout commands before service or provider work', async () => {
    const exactBody = billingCommandBodyWithByteLength({ offering: 'family.monthly' }, 1_024)
    const admitted = await requestWithDeclaredBody(
      new URL('/api/account/billing/checkout', baseUrl),
      exactBody.byteLength,
      [exactBody],
      { headers: { 'content-type': 'application/json' } }
    )
    expect(exactBody.byteLength).toBe(1_024)
    expect(admitted.status).toBe(200)
    expect(JSON.parse(admitted.body)).toEqual({ url: 'https://checkout.stripe.test/cs_safe' })
    expect(serviceMocks.createBillingStripeCheckout).toHaveBeenCalledTimes(1)
    expect(getStripeClientSpy).toHaveBeenCalledTimes(1)

    serviceMocks.createBillingStripeCheckout.mockClear()
    getStripeClientSpy.mockClear()
    billingStripeCompositionFixture.requireUserCalls = 0
    const overflowByte = Buffer.from(' ')
    const completed = await fetch(`${baseUrl}/api/account/billing/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: Buffer.concat([exactBody, overflowByte]).toString('utf8')
    })
    expect(completed.status).toBe(413)
    expect(completed.headers.get('cache-control')).toBe('private, no-store')
    expect(await completed.json()).toEqual({
      statusCode: 413,
      statusMessage: 'Payload Too Large',
      stack: []
    })

    const declared = await requestWithDeclaredBody(new URL('/api/account/billing/checkout', baseUrl), 1_025, [], {
      endRequest: false,
      headers: { 'content-type': 'application/json' }
    })
    const chunked = await requestWithChunkedBody(
      new URL('/api/account/billing/checkout', baseUrl),
      [exactBody, overflowByte],
      { endRequest: false, headers: { 'content-type': 'application/json' } }
    )

    expectPayloadTooLarge(declared)
    expectPayloadTooLarge(chunked)
    expect(billingStripeCompositionFixture.requireUserCalls).toBe(3)
    expect(serviceMocks.createBillingStripeCheckout).not.toHaveBeenCalled()
    expect(getStripeClientSpy).not.toHaveBeenCalled()
    expect(billingStripeCompositionFixture.failures).toEqual([])
  })

  it('accepts exactly one change offering and rejects every provider or scope injection', async () => {
    billingStripeCompositionFixture.requireUserError = createError({
      statusCode: 401,
      statusMessage: 'Authentication required'
    })
    expect((await request('/api/account/billing/change', '{')).status).toBe(401)
    expect(serviceMocks.changeBillingStripeOffering).not.toHaveBeenCalled()

    billingStripeCompositionFixture.requireUserError = null
    for (const body of [
      {},
      { offering: 'other' },
      { offering: 'family.monthly', priceId: 'price_injected' },
      { offering: 'family.monthly', customer: 'cus_injected' },
      { offering: 'family.monthly', purchaserUserId: 'purchaser_injected' },
      { offering: 'family.monthly', idempotencyKey: 'injected' }
    ]) {
      expect((await jsonRequest('/api/account/billing/change', body)).status).toBe(400)
    }
    const valid = await jsonRequest('/api/account/billing/change', { offering: 'family.monthly' })
    expect(valid.status).toBe(200)
    expect(serviceMocks.changeBillingStripeOffering).toHaveBeenCalledTimes(1)
    expect(serviceMocks.changeBillingStripeOffering.mock.calls[0]?.slice(1, 3)).toEqual([
      'purchaser_http',
      'family.monthly'
    ])
  })

  it('bounds authenticated Billing change commands before service or provider work', async () => {
    const exactBody = billingCommandBodyWithByteLength({ offering: 'family.monthly' }, 1_024)
    const admitted = await requestWithDeclaredBody(
      new URL('/api/account/billing/change', baseUrl),
      exactBody.byteLength,
      [exactBody],
      { headers: { 'content-type': 'application/json' } }
    )
    expect(admitted.status).toBe(200)
    expect(serviceMocks.changeBillingStripeOffering).toHaveBeenCalledTimes(1)
    expect(getStripeClientSpy).toHaveBeenCalledTimes(1)

    serviceMocks.changeBillingStripeOffering.mockClear()
    getStripeClientSpy.mockClear()
    const overflowByte = Buffer.from(' ')
    const declared = await requestWithDeclaredBody(new URL('/api/account/billing/change', baseUrl), 1_025, [], {
      endRequest: false,
      headers: { 'content-type': 'application/json' }
    })
    const chunked = await requestWithChunkedBody(
      new URL('/api/account/billing/change', baseUrl),
      [exactBody, overflowByte],
      { endRequest: false, headers: { 'content-type': 'application/json' } }
    )
    const completed = await fetch(`${baseUrl}/api/account/billing/change`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: Buffer.concat([exactBody, overflowByte]).toString('utf8')
    })

    expectPayloadTooLarge(declared)
    expectPayloadTooLarge(chunked)
    expect(completed.status).toBe(413)
    expect(completed.headers.get('cache-control')).toBe('private, no-store')
    expect(await completed.json()).toEqual({
      statusCode: 413,
      statusMessage: 'Payload Too Large',
      stack: []
    })
    expect(serviceMocks.changeBillingStripeOffering).not.toHaveBeenCalled()
    expect(getStripeClientSpy).not.toHaveBeenCalled()
    expect(billingStripeCompositionFixture.failures).toEqual([])
  })

  it('bounds authenticated Billing portal commands before service or provider work', async () => {
    const exactBody = billingCommandBodyWithByteLength({}, 1_024)
    const admitted = await requestWithDeclaredBody(
      new URL('/api/account/billing/portal', baseUrl),
      exactBody.byteLength,
      [exactBody],
      { headers: { 'content-type': 'application/json' } }
    )
    expect(exactBody.byteLength).toBe(1_024)
    expect(admitted.status).toBe(200)
    expect(JSON.parse(admitted.body)).toEqual({ url: 'https://billing.stripe.test/bps_safe' })
    expect(serviceMocks.createBillingStripePortal).toHaveBeenCalledTimes(1)
    expect(getStripeClientSpy).toHaveBeenCalledTimes(1)

    serviceMocks.createBillingStripePortal.mockClear()
    getStripeClientSpy.mockClear()
    billingStripeCompositionFixture.requireUserCalls = 0
    const overflowByte = Buffer.from(' ')
    const completed = await fetch(`${baseUrl}/api/account/billing/portal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: Buffer.concat([exactBody, overflowByte]).toString('utf8')
    })
    expect(completed.status).toBe(413)
    expect(completed.headers.get('cache-control')).toBe('private, no-store')
    expect(await completed.json()).toEqual({
      statusCode: 413,
      statusMessage: 'Payload Too Large',
      stack: []
    })

    const declared = await requestWithDeclaredBody(new URL('/api/account/billing/portal', baseUrl), 1_025, [], {
      endRequest: false,
      headers: { 'content-type': 'application/json' }
    })
    const chunked = await requestWithChunkedBody(
      new URL('/api/account/billing/portal', baseUrl),
      [exactBody, overflowByte],
      {
        endRequest: false,
        headers: { 'content-type': 'application/json' }
      }
    )

    expectPayloadTooLarge(declared)
    expectPayloadTooLarge(chunked)
    expect(billingStripeCompositionFixture.requireUserCalls).toBe(3)
    expect(serviceMocks.createBillingStripePortal).not.toHaveBeenCalled()
    expect(getStripeClientSpy).not.toHaveBeenCalled()
    expect(billingStripeCompositionFixture.failures).toEqual([])
  })

  it('returns only the projected state with private no-store headers and strict empty commands', async () => {
    const state = await fetch(`${baseUrl}/api/account/billing`)
    expect(state.status).toBe(200)
    expect(state.headers.get('cache-control')).toBe('private, no-store')
    expect(await state.json()).toEqual(safeState())

    for (const path of ['/api/account/billing/portal', '/api/account/billing/reconcile']) {
      expect((await jsonRequest(path, { customer: 'cus_injected' })).status).toBe(400)
      expect((await jsonRequest(path, {})).status).toBe(200)
    }
  })

  it('bounds authenticated reconciliation before rate charging or provider work', async () => {
    const exactBody = billingCommandBodyWithByteLength({}, 1_024)
    billingStripeCompositionFixture.purchaserUserId = 'purchaser_reconciliation_exact'
    const admitted = await requestWithDeclaredBody(
      new URL('/api/account/billing/reconcile', baseUrl),
      exactBody.byteLength,
      [exactBody],
      { headers: { 'content-type': 'application/json' } }
    )
    expect(exactBody.byteLength).toBe(1_024)
    expect(admitted.status).toBe(200)
    expect(admitted.headers['cache-control']).toBe('private, no-store')
    expect(admitted.headers['retry-after']).toBeUndefined()

    for (let attempt = 1; attempt < billingReconciliationRateLimitMax; attempt += 1) {
      expect((await jsonRequest('/api/account/billing/reconcile', {})).status).toBe(200)
    }
    const exactPurchaserLimited = await jsonRequest('/api/account/billing/reconcile', {})
    const exactPurchaserRetryAfter = Number(exactPurchaserLimited.headers.get('retry-after'))
    expect(exactPurchaserLimited.status).toBe(429)
    expect(exactPurchaserLimited.headers.get('cache-control')).toBe('private, no-store')
    expect(Number.isInteger(exactPurchaserRetryAfter)).toBe(true)
    expect(exactPurchaserRetryAfter).toBeGreaterThanOrEqual(1)
    expect(exactPurchaserRetryAfter).toBeLessThanOrEqual(60)
    expect(serviceMocks.reconcileBillingStripe).toHaveBeenCalledTimes(billingReconciliationRateLimitMax)
    expect(getStripeClientSpy).toHaveBeenCalledTimes(billingReconciliationRateLimitMax)
    expect(serviceMocks.reconcileBillingStripe.mock.calls.map((call) => call[1])).toEqual(
      Array(billingReconciliationRateLimitMax).fill('purchaser_reconciliation_exact')
    )

    serviceMocks.reconcileBillingStripe.mockClear()
    getStripeClientSpy.mockClear()
    billingStripeCompositionFixture.purchaserUserId = 'purchaser_reconciliation_overflow'

    const injected = await jsonRequest('/api/account/billing/reconcile', { injected: true })
    expect(injected.status).toBe(400)
    expect(injected.headers.get('cache-control')).toBe('private, no-store')
    expect(injected.headers.get('retry-after')).toBeNull()

    billingStripeCompositionFixture.requireUserCalls = 0
    const overflowByte = Buffer.from(' ')
    const oversizedBody = Buffer.concat([exactBody, overflowByte])
    expect(oversizedBody.byteLength).toBe(1_025)
    const completed = await requestWithDeclaredBody(
      new URL('/api/account/billing/reconcile', baseUrl),
      oversizedBody.byteLength,
      [oversizedBody],
      { headers: { 'content-type': 'application/json' } }
    )
    expectPayloadTooLarge(completed)

    const declared = await requestWithDeclaredBody(new URL('/api/account/billing/reconcile', baseUrl), 1_025, [], {
      endRequest: false,
      headers: { 'content-type': 'application/json' }
    })
    expectPayloadTooLarge(declared)

    const chunked = await requestWithChunkedBody(
      new URL('/api/account/billing/reconcile', baseUrl),
      [exactBody, overflowByte],
      { endRequest: false, headers: { 'content-type': 'application/json' } }
    )
    expectPayloadTooLarge(chunked)
    expect(billingStripeCompositionFixture.requireUserCalls).toBe(3)
    expect(serviceMocks.reconcileBillingStripe).not.toHaveBeenCalled()
    expect(getStripeClientSpy).not.toHaveBeenCalled()
    expect(billingStripeCompositionFixture.failures).toEqual([])

    for (let attempt = 0; attempt < billingReconciliationRateLimitMax; attempt += 1) {
      expect((await jsonRequest('/api/account/billing/reconcile', {})).status).toBe(200)
    }
    const overflowPurchaserLimited = await jsonRequest('/api/account/billing/reconcile', {})
    const overflowPurchaserRetryAfter = Number(overflowPurchaserLimited.headers.get('retry-after'))
    expect(overflowPurchaserLimited.status).toBe(429)
    expect(overflowPurchaserLimited.headers.get('cache-control')).toBe('private, no-store')
    expect(Number.isInteger(overflowPurchaserRetryAfter)).toBe(true)
    expect(overflowPurchaserRetryAfter).toBeGreaterThanOrEqual(1)
    expect(overflowPurchaserRetryAfter).toBeLessThanOrEqual(60)
    expect(serviceMocks.reconcileBillingStripe).toHaveBeenCalledTimes(billingReconciliationRateLimitMax)
    expect(getStripeClientSpy).toHaveBeenCalledTimes(billingReconciliationRateLimitMax)
    expect(serviceMocks.reconcileBillingStripe.mock.calls.map((call) => call[1])).toEqual(
      Array(billingReconciliationRateLimitMax).fill('purchaser_reconciliation_overflow')
    )
    expect(billingStripeCompositionFixture.failures).toEqual([])
  })
})

describe('Stripe webhook HTTP protocol', () => {
  it('verifies and accepts exactly 65,536 raw bytes', async () => {
    const payload = exactSizePayload()
    expect(Buffer.byteLength(payload)).toBe(billingStripeWebhookBodyLimitBytes)
    const response = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signedHeader(payload)
      },
      body: payload
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true, duplicate: false })
    expect(webhookMocks.processStripeWebhookEvent).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid signatures and oversized declared or chunked bodies without provider processing', async () => {
    const invalid = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=private-invalid-signature' },
      body: JSON.stringify(stripeEvent())
    })
    expect(invalid.status).toBe(400)
    expect(await invalid.text()).not.toContain('private-invalid-signature')

    const oversized = 'x'.repeat(billingStripeWebhookBodyLimitBytes + 1)
    const declared = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: 'POST',
      headers: { 'stripe-signature': 'private-oversized-signature' },
      body: oversized
    })
    expect(declared.status).toBe(413)

    const chunked = await chunkedWebhookRequest([Buffer.alloc(32_768, 0x61), Buffer.alloc(32_769, 0x62)])
    expect(chunked.status).toBe(413)
    expect(webhookMocks.processStripeWebhookEvent).not.toHaveBeenCalled()
  })

  it('acknowledges a signed unsupported event without retaining a receipt', async () => {
    const payload = JSON.stringify(stripeEvent('customer.created'))
    const response = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: 'POST',
      headers: { 'stripe-signature': signedHeader(payload) },
      body: payload
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true, duplicate: false })
    expect(webhookMocks.processStripeWebhookEvent).toHaveBeenCalledTimes(1)
    expect(webhookMocks.processStripeWebhookEvent.mock.calls[0]?.[4]).toMatchObject({
      id: 'evt_http_boundary',
      type: 'customer.created'
    })
  })

  it('rejects a missing raw payload before Stripe verification or persistence', async () => {
    const response = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: 'POST',
      headers: { 'stripe-signature': 'must-not-be-read' }
    })
    expect(response.status).toBe(400)
    expect(webhookMocks.processStripeWebhookEvent).not.toHaveBeenCalled()
  })

  it('reports a provider-state failure as 502 without reflecting private details', async () => {
    webhookMocks.processStripeWebhookEvent.mockRejectedValueOnce(
      createError({
        statusCode: 502,
        statusMessage: 'Stripe billing state is temporarily unavailable',
        message: 'private provider read detail'
      })
    )
    const payload = JSON.stringify(stripeEvent('customer.subscription.updated'))
    const response = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: 'POST',
      headers: { 'stripe-signature': signedHeader(payload) },
      body: payload
    })
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('private provider read detail')
    expect(billingStripeCompositionFixture.failures).toEqual([expect.objectContaining({ operation: 'webhook' })])
  })
})

function runtimeConfiguration(): BillingStripeRuntimeConfiguration {
  return {
    appName: 'HTTP Test',
    appUrl: 'https://app.example.test',
    stripe: {
      secretKey: stripeKey,
      webhookSecret,
      portalConfigurationId: 'bpc_http',
      prices: {
        'personal.weekly': 'price_personal_weekly_http',
        'personal.monthly': 'price_personal_monthly_http',
        'personal.annual': 'price_personal_annual_http',
        'family.monthly': 'price_family_monthly_http',
        'family.annual': 'price_family_annual_http'
      }
    }
  }
}

function safeState() {
  return {
    catalog: [],
    deletionPending: false,
    subscription: {
      provider: 'Stripe',
      state: 'none',
      offering: null,
      plan: null,
      cadence: null,
      currentPeriodEnd: null,
      renewalEnabled: false,
      graceDeadline: null,
      checkoutPending: false
    },
    transition: null,
    capabilities: { canCheckout: true, canChange: false, canManage: false, canReconcile: false }
  }
}

function stripeEvent(type: string = 'customer.created') {
  return {
    id: 'evt_http_boundary',
    object: 'event',
    api_version: '2026-06-24.dahlia',
    created: Math.floor(Date.now() / 1_000),
    type,
    data: { object: { id: type.startsWith('customer.subscription.') ? 'sub_http_boundary' : 'cus_http_boundary' } }
  }
}

function exactSizePayload(): string {
  const event = { ...stripeEvent(), padding: '' }
  const base = JSON.stringify(event)
  event.padding = 'x'.repeat(billingStripeWebhookBodyLimitBytes - Buffer.byteLength(base))
  const payload = JSON.stringify(event)
  if (Buffer.byteLength(payload) !== billingStripeWebhookBodyLimitBytes) {
    throw new Error('Failed to construct exact webhook payload')
  }
  return payload
}

function signedHeader(payload: string): string {
  return new Stripe(stripeKey).webhooks.generateTestHeaderString({ payload, secret: webhookSecret })
}

function jsonRequest(path: string, body: unknown) {
  return request(path, JSON.stringify(body))
}

function billingCommandBodyWithByteLength(body: unknown, byteLength: number): Buffer {
  const encoded = Buffer.from(JSON.stringify(body))
  if (encoded.byteLength > byteLength) throw new Error('Billing command exceeds requested test size')
  return Buffer.concat([encoded, Buffer.alloc(byteLength - encoded.byteLength, 0x20)])
}

function expectPayloadTooLarge(response: Awaited<ReturnType<typeof requestWithDeclaredBody>>) {
  expect(response.status).toBe(413)
  expect(response.headers['cache-control']).toBe('private, no-store')
  expect(response.headers['retry-after']).toBeUndefined()
  expect(JSON.parse(response.body)).toEqual({
    statusCode: 413,
    statusMessage: 'Payload Too Large',
    stack: []
  })
}

function request(path: string, body: string) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body
  })
}

function chunkedWebhookRequest(chunks: Buffer[]): Promise<{ status: number; body: string }> {
  const url = new URL('/api/webhooks/stripe', baseUrl)
  return new Promise((resolve, reject) => {
    const request = nodeRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'transfer-encoding': 'chunked',
          'stripe-signature': 'private-chunked-signature'
        }
      },
      (response) => {
        const responseChunks: Buffer[] = []
        response.on('data', (chunk) => responseChunks.push(Buffer.from(chunk)))
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(responseChunks).toString('utf8')
          })
        )
      }
    )
    request.on('error', reject)
    for (const chunk of chunks) request.write(chunk)
    request.end()
  })
}
