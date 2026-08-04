import { createServer, type Server } from 'node:http'
import { createApp, createError, createRouter, defineEventHandler, toNodeListener, type EventHandler } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  billingReconciliationRateLimitMax,
  resetBillingReconciliationRateLimitForTests
} from '../server/services/payments/billing-reconciliation-rate-limit'

const serviceMocks = vi.hoisted(() => ({
  getBillingState: vi.fn(),
  changeBillingOffering: vi.fn(),
  createBillingCheckout: vi.fn(),
  createBillingPortal: vi.fn(),
  reconcileBilling: vi.fn()
}))
const sessionMocks = vi.hoisted(() => ({ requireSession: vi.fn() }))

vi.mock('../server/services/payments/billing-service', () => serviceMocks)
vi.mock('../server/utils/auth/require-session', () => sessionMocks)

let server: Server
let baseUrl: string
const session = { user: { id: 'user_billing_http' }, session: { id: 'session_billing_http' } }

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', defineEventHandler)
  const [read, change, checkout, portal, reconcile] = await Promise.all([
    import('../server/api/account/billing/index.get').then((module) => module.default),
    import('../server/api/account/billing/change.post').then((module) => module.default),
    import('../server/api/account/billing/checkout.post').then((module) => module.default),
    import('../server/api/account/billing/portal.post').then((module) => module.default),
    import('../server/api/account/billing/reconcile.post').then((module) => module.default)
  ])
  const router = createRouter()
    .get('/api/account/billing', read as EventHandler)
    .post('/api/account/billing/change', change as EventHandler)
    .post('/api/account/billing/checkout', checkout as EventHandler)
    .post('/api/account/billing/portal', portal as EventHandler)
    .post('/api/account/billing/reconcile', reconcile as EventHandler)
  server = createServer(toNodeListener(createApp().use(router)))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new TypeError('Expected test server address')
  baseUrl = `http://127.0.0.1:${address.port}`
})

beforeEach(() => {
  vi.clearAllMocks()
  resetBillingReconciliationRateLimitForTests()
  sessionMocks.requireSession.mockResolvedValue(session)
  serviceMocks.getBillingState.mockReturnValue(safeState())
  serviceMocks.changeBillingOffering.mockResolvedValue(safeState())
  serviceMocks.createBillingCheckout.mockResolvedValue({
    url: 'https://checkout.stripe.test/session/cs_http'
  })
  serviceMocks.createBillingPortal.mockResolvedValue({
    url: 'https://billing.stripe.test/session/bps_http'
  })
  serviceMocks.reconcileBilling.mockResolvedValue(safeState())
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

describe('account billing HTTP boundary', () => {
  it('returns only the minimized private projection', async () => {
    const response = await fetch(`${baseUrl}/api/account/billing`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual(safeState())
    expect(serviceMocks.getBillingState).toHaveBeenCalledWith(session)
  })

  it('authenticates Checkout before parsing and rejects every provider or scope injection', async () => {
    sessionMocks.requireSession.mockRejectedValueOnce(
      createError({ statusCode: 401, statusMessage: 'Authentication required' })
    )
    const anonymous = await request('/api/account/billing/checkout', '{')
    expect(anonymous.status).toBe(401)
    expect(serviceMocks.createBillingCheckout).not.toHaveBeenCalled()

    for (const body of [
      {},
      { plan: 'other' },
      { offering: 'other' },
      { offering: 'family.monthly', priceId: 'price_injected' },
      { offering: 'family.monthly', organizationId: 'organization_injected' },
      { offering: 'family.monthly', customer: 'cus_injected' },
      { offering: 'family.monthly', quantity: 6 },
      { offering: 'family.monthly', idempotencyKey: 'injected' },
      { offering: 'family.monthly', successUrl: 'https://attacker.invalid' }
    ]) {
      expect((await jsonRequest('/api/account/billing/checkout', body)).status).toBe(400)
    }

    const valid = await jsonRequest('/api/account/billing/checkout', { offering: 'family.monthly' })
    expect(valid.status).toBe(200)
    expect(await valid.json()).toEqual({ url: 'https://checkout.stripe.test/session/cs_http' })
    expect(serviceMocks.createBillingCheckout).toHaveBeenCalledTimes(1)
    expect(serviceMocks.createBillingCheckout).toHaveBeenCalledWith(session, { offering: 'family.monthly' })
  })

  it('authenticates billing changes before parsing and accepts only one exact offering', async () => {
    sessionMocks.requireSession.mockRejectedValueOnce(
      createError({ statusCode: 401, statusMessage: 'Authentication required' })
    )
    const anonymous = await request('/api/account/billing/change', '{')
    expect(anonymous.status).toBe(401)
    expect(serviceMocks.changeBillingOffering).not.toHaveBeenCalled()

    for (const body of [
      {},
      { plan: 'family' },
      { offering: 'other' },
      { offering: 'family.annual', timing: 'now' },
      { offering: 'family.annual', proration: true },
      { offering: 'family.annual', priceId: 'price_injected' },
      { offering: 'family.annual', subscriptionId: 'sub_injected' },
      { offering: 'family.annual', itemId: 'si_injected' },
      { offering: 'family.annual', quantity: 2 },
      { offering: 'family.annual', idempotencyKey: 'injected' }
    ]) {
      expect((await jsonRequest('/api/account/billing/change', body)).status).toBe(400)
    }

    const valid = await jsonRequest('/api/account/billing/change', { offering: 'family.annual' })
    expect(valid.status).toBe(200)
    expect(valid.headers.get('cache-control')).toBe('private, no-store')
    expect(await valid.json()).toEqual(safeState())
    expect(serviceMocks.changeBillingOffering).toHaveBeenCalledTimes(1)
    expect(serviceMocks.changeBillingOffering).toHaveBeenCalledWith(session, { offering: 'family.annual' })
  })

  it('accepts only empty Portal and reconciliation commands', async () => {
    for (const path of ['/api/account/billing/portal', '/api/account/billing/reconcile']) {
      expect((await jsonRequest(path, { customer: 'cus_injected' })).status).toBe(400)
      expect((await jsonRequest(path, {})).status).toBe(200)
    }
    expect(serviceMocks.createBillingPortal).toHaveBeenCalledTimes(1)
    expect(serviceMocks.createBillingPortal).toHaveBeenCalledWith(session)
    expect(serviceMocks.reconcileBilling).toHaveBeenCalledTimes(1)
    expect(serviceMocks.reconcileBilling).toHaveBeenCalledWith(session)
  })

  it('bounds authenticated reconciliation without turning malformed or anonymous requests into Stripe calls', async () => {
    sessionMocks.requireSession.mockRejectedValueOnce(
      createError({ statusCode: 401, statusMessage: 'Authentication required' })
    )
    expect((await request('/api/account/billing/reconcile', '{')).status).toBe(401)
    expect(serviceMocks.reconcileBilling).not.toHaveBeenCalled()

    expect((await request('/api/account/billing/reconcile', '{')).status).toBe(400)
    expect(serviceMocks.reconcileBilling).not.toHaveBeenCalled()

    for (let requestIndex = 0; requestIndex < billingReconciliationRateLimitMax; requestIndex += 1) {
      expect((await jsonRequest('/api/account/billing/reconcile', {})).status).toBe(200)
    }
    const limited = await jsonRequest('/api/account/billing/reconcile', {})
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('60')
    expect(await limited.json()).not.toHaveProperty('data')
    expect(serviceMocks.reconcileBilling).toHaveBeenCalledTimes(billingReconciliationRateLimitMax)
  })
})

function safeState() {
  return {
    catalog: [
      { key: 'personal.weekly', plan: 'personal', cadence: 'weekly' },
      { key: 'personal.monthly', plan: 'personal', cadence: 'monthly' },
      { key: 'personal.annual', plan: 'personal', cadence: 'annual' },
      { key: 'family.monthly', plan: 'family', cadence: 'monthly' },
      { key: 'family.annual', plan: 'family', cadence: 'annual' }
    ],
    relationship: { kind: 'independent' },
    entitlement: { granted: false, source: null, state: 'none', plan: null, cadence: null },
    subscription: {
      provider: 'Stripe',
      state: 'none',
      plan: null,
      cadence: null,
      currentPeriodEnd: null,
      renewalEnabled: false,
      graceDeadline: null,
      checkoutPending: false
    },
    transition: null,
    seats: null,
    members: null,
    capabilities: {
      canCheckout: true,
      canChange: false,
      canManage: false,
      canReconcile: false,
      canLeaveFamily: false,
      canCreateFamilyInvitation: false,
      canResendFamilyInvitation: false,
      canAcceptFamilyInvitation: false,
      canAddFamilyMember: false,
      canRemoveFamilyMember: false
    }
  }
}

function jsonRequest(path: string, body: unknown) {
  return request(path, JSON.stringify(body))
}

function request(path: string, body: string) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body
  })
}
