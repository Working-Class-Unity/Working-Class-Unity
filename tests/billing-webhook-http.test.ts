import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, request as httpRequest, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { createApp, createRouter, defineEventHandler, toNodeListener, type EventHandler } from 'h3'
import type Stripe from 'stripe'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectDatabase, type DatabaseConnection } from '../server/db/connect'
import { createStripeClient, resetStripeClientForTests } from '../server/services/payments/stripe-client'
import * as runtime from '../server/utils/runtime'
import type { AppRuntimeConfig } from '../server/utils/runtime'

const databaseBoundary = vi.hoisted(() => ({ connection: null as DatabaseConnection | null }))
const stripeBoundary = vi.hoisted(() => ({ client: null as Stripe | null }))

vi.mock('../server/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/db/client')>()),
  useDatabase() {
    if (!databaseBoundary.connection) throw new Error('Webhook test database is not ready')
    return databaseBoundary.connection
  }
}))

vi.mock('../server/services/payments/stripe-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../server/services/payments/stripe-client')>()
  return {
    ...original,
    getStripeClient(config: AppRuntimeConfig) {
      return stripeBoundary.client ?? original.createStripeClient(config.stripe.secretKey)
    }
  }
})

const appUrl = 'https://webhook.example.test'
const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
const webhookSecret = 'whsec_ci_r024_official_sdk_fixture'
const stripeSecretKey = 'sk_test_ci_r024_official_sdk_fixture'
let server: Server
let baseUrl: string
let fixture: ReturnType<typeof createFixture>

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', defineEventHandler)
  const [crossOrigin, webhook] = await Promise.all([
    import('../server/middleware/02-cross-origin').then((module) => module.default),
    import('../server/api/webhooks/stripe.post').then((module) => module.default)
  ])
  const router = createRouter().post('/api/webhooks/stripe', webhook as EventHandler)
  server = createServer(toNodeListener(createApp().use(crossOrigin).use(router)))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  const address = server.address()
  if (!address || typeof address === 'string') throw new TypeError('Expected a TCP test address')
  baseUrl = `http://127.0.0.1:${address.port}`
})

beforeEach(() => {
  fixture = createFixture()
  databaseBoundary.connection = fixture.connection
  stripeBoundary.client = null
  resetStripeClientForTests()
  vi.spyOn(runtime, 'getAppRuntimeConfig').mockReturnValue(testRuntimeConfig())
})

afterEach(() => {
  vi.restoreAllMocks()
  resetStripeClientForTests()
  databaseBoundary.connection = null
  stripeBoundary.client = null
  fixture.cleanup()
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

describe('configured Stripe webhook HTTP boundary', () => {
  it('accepts and verifies exactly 65,536 raw bytes without trusting browser origin', async () => {
    const payload = exactSizePayload({
      id: 'evt_exact_body_limit',
      object: 'event',
      api_version: '2026-06-24.dahlia',
      created: 1_783_920_000,
      type: 'customer.created',
      data: {
        object: {
          id: 'cus_exact_body_limit'
        }
      }
    })
    expect(Buffer.byteLength(payload)).toBe(65_536)
    const response = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://attacker.invalid',
        referer: 'https://attacker.invalid/forged-checkout',
        'sec-fetch-site': 'cross-site',
        'stripe-signature': signedHeader(payload)
      },
      body: payload
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true, duplicate: false })
    expect(recordedEvents()).toEqual([])
    expect(count('billing_customers')).toBe(0)
    expect(count('billing_subscriptions')).toBe(0)

    const duplicate = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signedHeader(payload)
      },
      body: payload
    })
    expect(duplicate.status).toBe(200)
    expect(await duplicate.json()).toEqual({ received: true, duplicate: false })
    expect(recordedEvents()).toHaveLength(0)
  })

  it('returns 502 and deduplicates an opaque durable retry when the required current read fails', async () => {
    const signingClient = createStripeClient(stripeSecretKey)
    stripeBoundary.client = {
      webhooks: signingClient.webhooks,
      checkout: {
        sessions: {
          retrieve: vi.fn(async () => {
            throw new Error('private provider failure')
          })
        }
      }
    } as unknown as Stripe
    const payload = JSON.stringify({
      id: 'evt_retryable_current_read',
      object: 'event',
      api_version: '2026-06-24.dahlia',
      created: 1_783_920_002,
      type: 'checkout.session.expired',
      data: { object: { id: 'cs_retryable_current_read' } }
    })

    for (let delivery = 0; delivery < 2; delivery += 1) {
      const response = await fetch(`${baseUrl}/api/webhooks/stripe`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': signedHeader(payload)
        },
        body: payload
      })
      expect(response.status).toBe(502)
      expect(await response.text()).not.toContain('private provider failure')
    }

    expect(recordedEvents()).toEqual([])
    expect(
      fixture.connection.sqlite
        .prepare(
          `select type, status, payload from job_queue
           where type = 'billing.webhook-reconciliation'`
        )
        .all()
    ).toEqual([
      {
        type: 'billing.webhook-reconciliation',
        status: 'queued',
        payload: JSON.stringify({
          eventId: 'evt_retryable_current_read',
          eventType: 'checkout.session.expired',
          eventCreatedAt: 1_783_920_002,
          objectId: 'cs_retryable_current_read'
        })
      }
    ])
  })

  it('rejects a declared body over 65,536 bytes before Stripe verification or persistence', async () => {
    const privateValues = ['declared-private-payload', 'declared-private-signature']
    const response = await rawWebhookRequest({
      headers: {
        'content-length': '65537',
        'stripe-signature': privateValues[1]
      },
      chunks: [privateValues[0]]
    })

    expect(response.status).toBe(413)
    for (const privateValue of privateValues) expect(response.body).not.toContain(privateValue)
    expect(recordedEvents()).toEqual([])
    expect(runtime.getAppRuntimeConfig).not.toHaveBeenCalled()
  })

  it('rejects a chunked body over 65,536 actual bytes without reflection or persistence', async () => {
    const privateValues = ['chunked-private-payload', 'chunked-private-signature']
    const firstChunk = Buffer.concat([Buffer.from(privateValues[0]), Buffer.alloc(32_768, 0x61)])
    const secondChunk = Buffer.alloc(65_537 - firstChunk.byteLength, 0x62)
    const response = await rawWebhookRequest({
      headers: {
        'stripe-signature': privateValues[1],
        'transfer-encoding': 'chunked'
      },
      chunks: [firstChunk, secondChunk]
    })

    expect(firstChunk.byteLength + secondChunk.byteLength).toBe(65_537)
    expect(response.status).toBe(413)
    for (const privateValue of privateValues) expect(response.body).not.toContain(privateValue)
    expect(recordedEvents()).toEqual([])
    expect(runtime.getAppRuntimeConfig).not.toHaveBeenCalled()
  })

  it('acknowledges a signed unsupported event without retaining a receipt', async () => {
    const payload = JSON.stringify({
      id: 'evt_unsupported_receipt',
      object: 'event',
      api_version: '2026-06-24.dahlia',
      created: 1_783_920_001,
      type: 'customer.created',
      data: { object: { id: 'cus_unsupported_receipt' } }
    })
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
    expect(recordedEvents()).toEqual([])
    expect(count('billing_customers')).toBe(0)
    expect(count('billing_subscriptions')).toBe(0)
  })

  it('rejects an invalid Stripe signature with no write or private-value reflection', async () => {
    const privateValues = [
      'evt_private_invalid_signature',
      'payload-private-metadata',
      'invalid-private-signature',
      webhookSecret
    ]
    const payload = JSON.stringify({
      id: privateValues[0],
      object: 'event',
      created: 1_783_920_001,
      type: 'customer.created',
      data: { object: { metadata: { private: privateValues[1] } } }
    })
    const response = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://attacker.invalid',
        'stripe-signature': `t=1783920001,v1=${privateValues[2]}`
      },
      body: payload
    })
    const body = await response.text()

    expect(response.status).toBe(400)
    for (const privateValue of privateValues) expect(body).not.toContain(privateValue)
    expect(recordedEvents()).toEqual([])
  })

  it('rejects a missing raw payload before Stripe verification or persistence', async () => {
    const response = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: 'POST',
      headers: { 'stripe-signature': 'must-not-be-used' }
    })

    expect(response.status).toBe(400)
    expect(await response.text()).toContain('Missing Stripe webhook payload')
    expect(recordedEvents()).toEqual([])
  })
})

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'swl-billing-webhook-http-'))
  const connection = connectDatabase(join(directory, 'fixture.sqlite'))
  migrate(connection.db, { migrationsFolder })
  return {
    connection,
    cleanup() {
      connection.sqlite.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

function testRuntimeConfig(): AppRuntimeConfig {
  return {
    databaseUrl: fixture.connection.databasePath,
    modules: {
      billing: { enabled: true },
      jobs: { enabled: true },
      observability: { enabled: false }
    },
    public: { appUrl },
    stripe: {
      secretKey: stripeSecretKey,
      webhookSecret,
      portalConfigurationId: 'bpc_webhook_http',
      personalWeeklyPriceId: 'price_personal_weekly_webhook_http',
      personalMonthlyPriceId: 'price_personal_monthly_webhook_http',
      personalAnnualPriceId: 'price_personal_annual_webhook_http',
      familyMonthlyPriceId: 'price_family_monthly_webhook_http',
      familyAnnualPriceId: 'price_family_annual_webhook_http'
    }
  } as unknown as AppRuntimeConfig
}

function signedHeader(payload: string) {
  return createStripeClient(stripeSecretKey).webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
    timestamp: Math.floor(Date.now() / 1_000)
  })
}

function exactSizePayload(event: Record<string, unknown>): string {
  const data = event.data as { object: Record<string, unknown> }
  data.object.padding = ''
  const unpadded = JSON.stringify(event)
  const paddingLength = 65_536 - Buffer.byteLength(unpadded)
  if (paddingLength < 0) throw new Error('Webhook fixture exceeds the body limit before padding')
  data.object.padding = 'x'.repeat(paddingLength)
  return JSON.stringify(event)
}

function rawWebhookRequest(input: {
  headers: Record<string, string>
  chunks: Array<string | Buffer>
}): Promise<{ status: number; body: string }> {
  const target = new URL('/api/webhooks/stripe', baseUrl)

  return new Promise((resolve, reject) => {
    const request = httpRequest(
      target,
      {
        method: 'POST',
        agent: false,
        headers: {
          connection: 'close',
          'content-type': 'application/json',
          ...input.headers
        }
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8')
          })
        })
      }
    )
    request.on('error', reject)
    for (const chunk of input.chunks) request.write(chunk)
    request.end()
  })
}

function recordedEvents() {
  return fixture.connection.sqlite
    .prepare(
      `select stripe_event_id as stripeEventId, event_type as eventType,
              provider_created_at as providerCreatedAt
       from billing_events order by id`
    )
    .all()
}

function count(table: string) {
  return (fixture.connection.sqlite.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count
}
