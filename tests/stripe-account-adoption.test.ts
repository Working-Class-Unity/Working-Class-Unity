import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'node:url'
import type Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import type { DatabaseConnection } from '../server/db/connect'
import * as schema from '../server/db/schema'
import { readWebsiteMembershipAccess } from '../server/services/membership/member-access'
import {
  claimStripeAccountAdoption,
  issueStripeAccountAdoptionLink
} from '../server/services/membership/stripe-account-adoption'
import { stripeMembershipConfiguration } from '../server/services/membership/stripe-first'
import type { BillingStripeRuntimeConfiguration } from '../server/services/payments/stripe/configuration'
import { stripeMembershipAuth } from '../server/utils/auth/stripe-membership'

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
const legacyPrices = {
  member: ['membership-10-1month'],
  solidarity: ['solidarity-27-1month']
} as const
const billingConfig: BillingStripeRuntimeConfiguration = {
  appName: 'Working Class Unity',
  appUrl: 'https://wcu.example.test',
  stripe: {
    secretKey: 'rk_test_membership',
    webhookSecret: 'whsec_membership',
    portalConfigurationId: 'bpc_membership',
    prices: {
      'personal.weekly': '',
      'personal.monthly': 'price_current_member',
      'personal.annual': '',
      'family.monthly': 'price_current_solidarity',
      'family.annual': ''
    }
  }
}
const membershipConfig = stripeMembershipConfiguration(billingConfig)
type Provider = ReturnType<typeof createProvider>

describe('Stripe subscriber account adoption', () => {
  it.each([
    ['member', legacyPrices.member[0]],
    ['solidarity', legacyPrices.solidarity[0]]
  ] as const)('creates one paid %s account only after its emailed link is redeemed', async (tier, priceId) => {
    await withDatabase(async (connection) => {
      const provider = createProvider({ email: `${tier}@example.test`, priceId, tier })
      const token = await issueToken(connection, provider)
      const competingToken = await issueToken(connection, provider)

      expect(connection.sqlite.prepare('select count(*) as count from user').get()).toEqual({ count: 0 })
      expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({ to: `${tier}@example.test` }))

      const claimed = await redeem(connection, provider, token, `user-${tier}`)
      expect(claimed).toEqual({ userId: `user-${tier}` })
      expect(readWebsiteMembershipAccess(connection, claimed.userId, billingConfig.stripe.prices).granted).toBe(true)
      await expect(redeem(connection, provider, token, 'user-replay')).rejects.toMatchObject({ statusCode: 409 })
      await expect(redeem(connection, provider, competingToken, 'user-competing')).rejects.toMatchObject({
        statusCode: 409
      })
      expect(counts(connection)).toEqual({ links: 1, people: 0, users: 1 })
    })
  })

  it('reuses and logs into one existing same-email account', async () => {
    await withDatabase(async (connection) => {
      connection.sqlite
        .prepare(
          `insert into user (id, name, email, email_verified, created_at, updated_at)
           values ('existing-user', 'WCU account', 'Existing@Example.test', 0, 1, 1)`
        )
        .run()
      const provider = createProvider({
        email: 'existing@example.test',
        priceId: legacyPrices.member[0],
        tier: 'member'
      })
      const token = await issueToken(connection, provider)
      const authentication = betterAuth({
        baseURL: membershipConfig.appUrl,
        secret: 'stripe-account-adoption-test-secret',
        database: drizzleAdapter(connection.db, { provider: 'sqlite', schema }),
        plugins: [stripeMembershipAuth({ client: () => provider.client, config: membershipConfig, connection })]
      })

      const response = await authentication.handler(
        new Request(`${membershipConfig.appUrl}/api/auth/stripe-membership/adopt?token=${token}`, {
          redirect: 'manual'
        })
      )

      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe(`${membershipConfig.appUrl}/app`)
      expect(response.headers.getSetCookie().some((value) => value.includes('session_token='))).toBe(true)
      expect(connection.sqlite.prepare('select id, email, email_verified as verified from user').all()).toEqual([
        { email: 'existing@example.test', id: 'existing-user', verified: 1 }
      ])
      expect(counts(connection)).toEqual({ links: 1, people: 0, users: 1 })
    })
  })

  it.each([
    ['customer email', (provider: Provider) => (provider.customer.email = 'changed@example.test')],
    ['status', (provider: Provider) => (provider.subscription.status = 'past_due')],
    ['customer', (provider: Provider) => (provider.subscription.customer = 'cus_changed')],
    ['subscription', (provider: Provider) => (provider.subscription.id = 'sub_changed')],
    ['price', (provider: Provider) => (provider.subscription.items.data[0]!.price.id = 'price_changed')],
    ['tier', (provider: Provider) => (provider.subscription.metadata.wcu_membership_tier = 'solidarity')],
    ['quantity', (provider: Provider) => (provider.subscription.items.data[0]!.quantity = 2)],
    ['pagination', (provider: Provider) => (provider.subscription.items.has_more = true)]
  ])('rejects changed %s before creating or linking an account', async (_label, mutate) => {
    await withDatabase(async (connection) => {
      const provider = createProvider({
        email: 'original@example.test',
        priceId: legacyPrices.member[0],
        tier: 'member'
      })
      const token = await issueToken(connection, provider)
      mutate(provider)

      await expect(redeem(connection, provider, token, 'user-changed')).rejects.toMatchObject({ statusCode: 409 })
      expect(counts(connection)).toEqual({ links: 0, people: 0, users: 0 })
    })
  })

  it('rejects a pending deletion for the exact Stripe membership despite a changed email', async () => {
    await withDatabase(async (connection) => {
      const provider = createProvider({ email: 'new@example.test', priceId: legacyPrices.member[0], tier: 'member' })
      connection.sqlite.exec(`
        insert into user (id, name, email, email_verified, created_at, updated_at)
          values ('deleting-user', 'WCU account', 'old@example.test', 1, 1, 1);
        insert into billing_customers (id, purchaser_user_id, stripe_customer_id)
          values ('billing-customer', 'deleting-user', 'cus_member');
        insert into billing_subscriptions
          (id, purchaser_user_id, billing_customer_id, stripe_subscription_id, status, plan_key, cadence, stripe_price_id)
          values ('billing-subscription', 'deleting-user', 'billing-customer', 'sub_member', 'active', 'personal', 'monthly', 'membership-10-1month');
        insert into billing_account_deletion_requests
          (id, purchaser_user_id, billing_subscription_id, billing_customer_id,
           expected_stripe_subscription_id, expected_stripe_customer_id)
          values ('deletion', 'deleting-user', 'billing-subscription', 'billing-customer', 'sub_member', 'cus_member');
      `)

      await expect(issue(provider, connection)).rejects.toMatchObject({ statusCode: 409 })
      expect(provider.send).not.toHaveBeenCalled()
      expect(counts(connection)).toEqual({ links: 0, people: 0, users: 1 })
    })
  })

  it('rejects an expired or ambiguous offer before creating an account', async () => {
    await withDatabase(async (connection) => {
      const provider = createProvider({
        email: 'ambiguous@example.test',
        priceId: legacyPrices.member[0],
        tier: 'member'
      })
      for (const [id, email] of [
        ['user-one', 'ambiguous@example.test'],
        ['user-two', 'AMBIGUOUS@example.test']
      ]) {
        connection.sqlite
          .prepare(
            'insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, 1, 1)'
          )
          .run(id, 'WCU account', email)
      }
      await expect(issue(provider, connection)).rejects.toMatchObject({ statusCode: 409 })
      expect(provider.send).not.toHaveBeenCalled()

      connection.sqlite.prepare('delete from user').run()
      const token = await issueToken(connection, provider)
      connection.sqlite.prepare('update verification set expires_at = 0').run()
      await expect(redeem(connection, provider, token, 'user-expired')).rejects.toMatchObject({ statusCode: 409 })
      expect(counts(connection)).toEqual({ links: 0, people: 0, users: 0 })
    })
  })

  it.each([
    ['inactive', { status: 'past_due' }],
    ['non-allowlisted', { priceId: 'price_not_allowlisted' }],
    ['multiple quantity', { quantity: 2 }],
    ['conflicting metadata', { metadataTier: 'solidarity' }]
  ])('rejects an %s subscription before delivery or account creation', async (_label, overrides) => {
    await withDatabase(async (connection) => {
      const provider = createProvider({
        email: 'invalid@example.test',
        priceId: legacyPrices.member[0],
        tier: 'member',
        ...overrides
      })

      await expect(issue(provider, connection)).rejects.toMatchObject({ statusCode: 409 })
      expect(provider.send).not.toHaveBeenCalled()
      expect(connection.sqlite.prepare('select count(*) as count from verification').get()).toEqual({ count: 0 })
      expect(counts(connection)).toEqual({ links: 0, people: 0, users: 0 })
    })
  })
})

async function withDatabase(run: (connection: DatabaseConnection) => Promise<void>): Promise<void> {
  const sqlite = new Database(':memory:')
  try {
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle({ client: sqlite, schema })
    migrate(db, { migrationsFolder })
    await run({ databasePath: ':memory:', db, sqlite })
  } finally {
    sqlite.close()
  }
}

function createProvider(input: {
  email: string
  metadataTier?: string
  priceId: string
  quantity?: number
  status?: Stripe.Subscription.Status
  tier: 'member' | 'solidarity'
}) {
  const customer = { id: `cus_${input.tier}`, deleted: false, email: input.email }
  const subscription = {
    id: `sub_${input.tier}`,
    object: 'subscription',
    status: input.status ?? 'active',
    customer: customer.id,
    metadata: input.metadataTier ? { wcu_membership_tier: input.metadataTier } : {},
    items: {
      data: [{ price: { id: input.priceId }, quantity: input.quantity ?? 1 }],
      has_more: false
    }
  } as Stripe.Subscription
  const send = vi.fn(async () => undefined)
  const client = {
    customers: { retrieve: vi.fn(async () => customer) },
    subscriptions: { retrieve: vi.fn(async () => subscription) }
  } as unknown as Stripe
  return { client, customer, send, subscription }
}

function issue(provider: Provider, connection: DatabaseConnection) {
  return issueStripeAccountAdoptionLink({
    appName: membershipConfig.appName,
    appUrl: membershipConfig.appUrl,
    client: provider.client,
    connection,
    prices: legacyPrices,
    sender: { send: provider.send },
    subscriptionId: provider.subscription.id
  })
}

async function issueToken(connection: DatabaseConnection, provider: Provider) {
  await issue(provider, connection)
  const text = provider.send.mock.calls.at(-1)?.[0].text ?? ''
  const url = text.match(/https?:\/\/\S+/)?.[0]
  const token = url ? new URL(url).searchParams.get('token') : null
  if (!token) throw new Error('Expected an emailed account-adoption token')
  return token
}

function redeem(connection: DatabaseConnection, provider: Provider, token: string, id: string) {
  return claimStripeAccountAdoption({ client: provider.client, connection, generateUserId: () => id, token })
}

function counts(connection: DatabaseConnection) {
  const count = (table: string) =>
    (connection.sqlite.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count
  return { links: count('account_stripe_memberships'), people: count('people'), users: count('user') }
}
