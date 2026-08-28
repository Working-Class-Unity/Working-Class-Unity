import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { convertSetCookieToCookie } from 'better-auth/test'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { createApp, createRouter, toNodeListener, type EventHandler } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { turnstileHeaderName } from '../shared/turnstile'

type DeliveredEmail = Readonly<{ text: string; to: string }>

const providerBoundaries = vi.hoisted(() => {
  const deliveries: DeliveredEmail[] = []
  return {
    deliveries,
    sendEmail: vi.fn(async (message: DeliveredEmail) => {
      deliveries.push(message)
    }),
    verifyTurnstile: vi.fn(async () => undefined),
    createStripeClient: vi.fn(() => {
      throw new Error('Account without a Billing customer must not call Stripe')
    })
  }
})

vi.mock('../server/services/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/services/email')>()),
  getTransactionalEmailSender: () => ({ send: providerBoundaries.sendEmail })
}))

vi.mock('../server/services/security/turnstile', () => ({
  verifyTurnstileToken: providerBoundaries.verifyTurnstile
}))

vi.mock('../server/services/payments/stripe/stripe-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/services/payments/stripe/stripe-client')>()),
  createStripeClient: providerBoundaries.createStripeClient
}))

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
const authBaseUrl = 'http://127.0.0.1:3000'
let server: Server | undefined
let database: InstanceType<typeof Database> | undefined
let temporaryDirectory: string | undefined

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()))
  server = undefined
  database?.close()
  database = undefined
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true })
  temporaryDirectory = undefined
  vi.unstubAllEnvs()
  providerBoundaries.deliveries.length = 0
  vi.clearAllMocks()
})

describe('production-wired account deletion', () => {
  it('logs in by magic link and deletes all purchaser-owned state through the account route', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'wcu-account-deletion-integration-'))
    const databasePath = join(temporaryDirectory, 'app.db')
    configureRuntime(databasePath)

    database = new Database(databasePath)
    database.pragma('foreign_keys = ON')
    migrate(drizzle({ client: database }), { migrationsFolder })

    const [{ auth }, accountDeletionHandler] = await Promise.all([
      import('../server/utils/auth/index'),
      import('../server/api/account.delete').then((module) => module.default)
    ])
    const router = createRouter().delete('/api/account', accountDeletionHandler as EventHandler)
    server = createServer(toNodeListener(createApp().use(router)))
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new TypeError('Expected a TCP test address')
    const accountEndpoint = `http://127.0.0.1:${address.port}/api/account`

    const email = 'delete-integration@example.test'
    database
      .prepare('insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, 1, 1)')
      .run('delete-integration-user', 'WCU account', email)
    const issued = await auth.handler(
      authRequest('/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: { [turnstileHeaderName]: 'accepted-integration-challenge' },
        body: JSON.stringify({
          email,
          callbackURL: '/app',
          newUserCallbackURL: '/app',
          errorCallbackURL: '/login'
        })
      })
    )
    expect(issued.status).toBe(200)
    expect(providerBoundaries.verifyTurnstile).toHaveBeenCalledOnce()
    expect(providerBoundaries.deliveries).toHaveLength(1)

    const magicLink = providerBoundaries.deliveries[0]?.text.match(/https?:\/\/\S+/)?.[0]
    if (!magicLink) throw new Error('Expected the email boundary to capture one magic link')
    const authenticated = await auth.handler(authRequest(magicLink))
    expect(authenticated.status).toBe(302)
    const sessionHeaders = convertSetCookieToCookie(new Headers(authenticated.headers))
    const user = database.prepare('select id from user where email = ?').get(email) as { id: string } | undefined
    if (!user) throw new Error('Expected the existing account to remain available')

    seedPrivatePurchaserState(database, user.id, email)

    const [nativeDelete, nativeCallback] = await Promise.all([
      auth.handler(
        authRequest('/api/auth/delete-user', {
          method: 'POST',
          headers: sessionHeaders,
          body: '{}'
        })
      ),
      auth.handler(authRequest('/api/auth/delete-user/callback?token=private', { headers: sessionHeaders }))
    ])
    expect(nativeDelete.status).toBe(404)
    expect(nativeCallback.status).toBe(404)

    const deleteAccount = () =>
      fetch(accountEndpoint, {
        method: 'DELETE',
        headers: {
          ...Object.fromEntries(sessionHeaders),
          'content-type': 'application/json',
          origin: authBaseUrl
        },
        body: JSON.stringify({ confirmation: 'DELETE' })
      })
    const responses = await Promise.all([deleteAccount(), deleteAccount()])
    expect(responses.some((response) => response.status === 200)).toBe(true)
    expect(responses.every((response) => response.status === 200 || response.status === 401)).toBe(true)
    const response = responses.find((candidate) => candidate.status === 200)!
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ success: true, message: 'User deleted' })
    expect(providerBoundaries.createStripeClient).not.toHaveBeenCalled()

    for (const [table, column] of [
      ['user', 'id'],
      ['account', 'user_id'],
      ['session', 'user_id'],
      ['verification', 'value'],
      ['ai_conversations', 'owner_user_id'],
      ['ai_generation_leases', 'owner_user_id'],
      ['ai_usage_buckets', 'owner_user_id'],
      ['files', 'owner_id'],
      ['billing_checkout_attempts', 'purchaser_user_id'],
      ['billing_customers', 'purchaser_user_id'],
      ['billing_subscriptions', 'purchaser_user_id'],
      ['billing_subscription_transitions', 'purchaser_user_id'],
      ['billing_account_deletion_requests', 'purchaser_user_id']
    ] as const) {
      expect(rowCount(database, table, `${column} = ?`, user.id), `${table} purchaser residue`).toBe(0)
    }
    expect(
      rowCount(database, 'verification', "json_valid(value) and lower(json_extract(value, '$.email')) = ?", email)
    ).toBe(0)
    expect(rowCount(database, 'job_queue', "type like 'billing.%' or instr(payload, ?) > 0", user.id)).toBe(0)
    expect(rowCount(database, 'job_queue', "type = 'files.cleanup-orphans' and payload = '{}'")).toBe(0)
    expect(database.pragma('foreign_key_check')).toEqual([])

    const expiredSession = await auth.handler(authRequest('/api/auth/get-session', { headers: sessionHeaders }))
    expect(expiredSession.status).toBe(200)
    expect(await expiredSession.json()).toBeNull()
  })
})

function configureRuntime(databasePath: string) {
  const environment = {
    NODE_ENV: 'test',
    NUXT_DATABASE_URL: `file:${databasePath}`,
    NUXT_READINESS_TOKEN: 'account-deletion-readiness-token-123456789',
    NUXT_BETTER_AUTH_SECRET: 'account-deletion-auth-secret-with-32-characters',
    NUXT_BETTER_AUTH_URL: authBaseUrl,
    NUXT_EMAIL_TRANSPORT: 'capture',
    NUXT_EMAIL_FROM: 'wcu@example.test',
    NUXT_EMAIL_CAPTURE_DIRECTORY: join(temporaryDirectory!, 'email'),
    NUXT_TWILIO_VERIFY_API_KEY_SID: 'SK66666666666666666666666666666666',
    NUXT_TWILIO_VERIFY_API_KEY_SECRET: 'account-deletion-twilio-secret-not-a-credential',
    NUXT_TWILIO_VERIFY_SERVICE_SID: 'VA66666666666666666666666666666666',
    NUXT_PUBLIC_APP_NAME: 'Working Class Unity',
    NUXT_PUBLIC_APP_URL: authBaseUrl,
    NUXT_STRIPE_SECRET_KEY: 'rk_test_account_deletion_integration',
    NUXT_STRIPE_WEBHOOK_SECRET: 'whsec_account_deletion_integration',
    NUXT_STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_account_deletion_integration',
    NUXT_STRIPE_MEMBERSHIP_DUES10_PRICE_ID: 'price_account_deletion_personal_monthly',
    NUXT_STRIPE_SOLIDARITY_DUES27_PRICE_ID: 'price_account_deletion_family_monthly',
    NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY: 'account-deletion-turnstile-not-a-provider-credential',
    NUXT_PUBLIC_TURNSTILE_SITE_KEY: 'account-deletion-turnstile-site-not-a-provider-credential'
  }
  for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value)
}

function seedPrivatePurchaserState(sqlite: InstanceType<typeof Database>, userId: string, email: string) {
  const now = Math.floor(Date.now() / 1_000)
  const conversationId = `ai_conversation_${randomUUID()}`
  const messageId = `ai_message_${randomUUID()}`
  const attemptId = `ai_attempt_${randomUUID()}`
  sqlite
    .prepare(
      `insert into account (
         id, account_id, provider_id, user_id, created_at, updated_at
       ) values (?, ?, 'integration-private', ?, ?, ?)`
    )
    .run(`account_${randomUUID()}`, `private_${randomUUID()}`, userId, now, now)
  sqlite.prepare('insert into ai_conversations (id, owner_user_id) values (?, ?)').run(conversationId, userId)
  sqlite
    .prepare(
      "insert into ai_messages (id, conversation_id, sequence, role, content) values (?, ?, 1, 'user', 'private')"
    )
    .run(messageId, conversationId)
  sqlite
    .prepare('insert into ai_generation_leases (owner_user_id, attempt_id, lease_expires_at) values (?, ?, ?)')
    .run(userId, attemptId, '2099-01-01T00:00:00.000Z')
  sqlite
    .prepare('insert into ai_usage_buckets (owner_user_id, bucket_date, request_count) values (?, ?, 1)')
    .run(userId, new Date().toISOString().slice(0, 10))
  sqlite
    .prepare(
      `insert into files (
         id, owner_id, bucket, object_key, original_name, content_type,
         byte_size, content_md5, status, upload_expires_at
       ) values (?, ?, 'local', ?, 'private.pdf', 'application/pdf', 1,
         'AAAAAAAAAAAAAAAAAAAAAA==', 'ready', '2099-01-01T00:00:00.000Z')`
    )
    .run(`file_${randomUUID()}`, userId, `users/${userId}/private.pdf`)
  sqlite
    .prepare(
      `insert into billing_checkout_attempts (
         id, purchaser_user_id, plan_key, cadence, stripe_price_id, idempotency_key,
         state, success_url, cancel_url, reuse_until
       ) values (?, ?, 'personal', 'monthly', 'price_account_deletion_personal_monthly', ?,
         'completed', ?, ?, '2099-01-01T00:00:00.000Z')`
    )
    .run(
      `checkout_${randomUUID()}`,
      userId,
      `checkout-deletion-${randomUUID()}`,
      `${authBaseUrl}/account`,
      `${authBaseUrl}/account`
    )
  sqlite.prepare("insert into job_queue (type, payload) values ('billing.notification-delivery', ?)").run(
    JSON.stringify({
      notificationKey: 'a'.repeat(64),
      kind: 'payment_attention',
      purchaserUserId: userId,
      authorityReference: null
    })
  )
  sqlite
    .prepare(
      'insert into verification (id, identifier, value, expires_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?)'
    )
    .run(`verification_${randomUUID()}`, `identity:${userId}`, userId, now + 300, now, now)
  sqlite
    .prepare(
      'insert into verification (id, identifier, value, expires_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?)'
    )
    .run(`verification_${randomUUID()}`, `email:${userId}`, JSON.stringify({ email }), now + 300, now, now)
}

function authRequest(path: string | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('cf-connecting-ip', '2001:db8:42::1')
  if (init.body !== undefined) {
    headers.set('content-type', 'application/json')
    headers.set('origin', authBaseUrl)
  }
  return new Request(new URL(path, authBaseUrl), { ...init, headers, redirect: 'manual' })
}

function rowCount(sqlite: InstanceType<typeof Database>, table: string, where?: string, ...parameters: unknown[]) {
  return (
    sqlite.prepare(`select count(*) as count from ${table}${where ? ` where ${where}` : ''}`).get(...parameters) as {
      count: number
    }
  ).count
}
