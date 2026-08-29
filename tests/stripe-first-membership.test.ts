import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'node:url'
import type Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import * as schema from '../server/db/schema'
import type { DatabaseConnection } from '../server/db/connect'
import { readWebsiteMembershipAccess } from '../server/services/membership/member-access'
import {
  claimStripeMembership,
  createStripeMembershipCheckout,
  issueStripeMembershipMagicLink,
  stripeMembershipConfiguration,
  type StripeMembershipTier
} from '../server/services/membership/stripe-first'
import type { BillingStripeRuntimeConfiguration } from '../server/services/payments/stripe/configuration'
import { stripeMembershipAuth } from '../server/utils/auth/stripe-membership'

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
const runtimeConfig: BillingStripeRuntimeConfiguration = {
  appName: 'Working Class Unity',
  appUrl: 'https://wcu.example.test',
  stripe: {
    secretKey: 'rk_test_membership',
    webhookSecret: 'whsec_membership',
    portalConfigurationId: 'bpc_membership',
    prices: {
      'personal.weekly': '',
      'personal.monthly': 'membership-10-1month',
      'personal.annual': '',
      'family.monthly': 'solidarity-27-1month',
      'family.annual': ''
    }
  }
}
const config = stripeMembershipConfiguration(runtimeConfig)
const accessPrices = runtimeConfig.stripe.prices

describe('Stripe-first membership', () => {
  it.each([
    ['supporter', 'price_1U9I17GqgHVbR26t3GDDF3Jg'],
    ['member', 'membership-10-1month'],
    ['solidarity', 'solidarity-27-1month']
  ] as const)('creates %s through subscription Checkout with the server-owned Price', async (tier, priceId) => {
    const provider = createProvider()

    await expect(createStripeMembershipCheckout(provider.client, config, tier)).resolves.toEqual({
      url: 'https://checkout.stripe.com/c/pay/cs_created'
    })
    expect(provider.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        payment_method_collection: 'if_required',
        metadata: { wcu_membership_tier: tier },
        subscription_data: { metadata: { wcu_membership_tier: tier } }
      })
    )
    expect(provider.create.mock.calls[0]?.[0]).not.toHaveProperty('payment_method_types')

    provider.create.mockRejectedValueOnce(new Error('provider failure'))
    await expect(createStripeMembershipCheckout(provider.client, config, tier)).rejects.toMatchObject({
      statusCode: 502
    })
  })

  it('gives Supporter account-only access and identical rights to both paid tiers', async () => {
    await withDatabase(async (connection) => {
      const insertMembership = connection.sqlite.prepare(
        `insert into account_stripe_memberships
           (user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, tier,
            stripe_status, last_verified_at)
         values (?, ?, ?, ?, ?, 'active', '2026-08-28T00:00:00.000Z')`
      )
      for (const tier of ['supporter', 'member', 'solidarity'] as const) {
        connection.sqlite
          .prepare(
            'insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, 1, 1)'
          )
          .run(`user-${tier}`, 'WCU account', `${tier}@example.test`)
        insertMembership.run(`user-${tier}`, `cus_${tier}`, `sub_${tier}`, config.prices[tier], tier)
      }

      expect(readWebsiteMembershipAccess(connection, 'user-supporter', accessPrices)).toMatchObject({
        granted: false,
        source: 'supporter'
      })
      for (const userId of ['user-member', 'user-solidarity']) {
        expect(readWebsiteMembershipAccess(connection, userId, accessPrices)).toMatchObject({
          granted: true,
          source: 'stripe_membership',
          state: 'active'
        })
      }
    })
  })

  it('rejects Checkout/customer and post-delivery email mismatches', async () => {
    await withDatabase(async (connection) => {
      const provider = createProvider()
      provider.add('member', 'checkout@example.test', { customerEmail: 'other@example.test' })

      await expect(
        issueStripeMembershipMagicLink({
          client: provider.client,
          config,
          connection,
          sender: { send: vi.fn() },
          sessionId: 'cs_mismatch'
        })
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(connection.sqlite.prepare('select count(*) as count from verification').get()).toEqual({ count: 0 })

      provider.add('member', 'price@example.test', { priceId: config.prices.solidarity })
      await expect(
        issueStripeMembershipMagicLink({
          client: provider.client,
          config,
          connection,
          sender: { send: vi.fn() },
          sessionId: 'cs_wrong_price'
        })
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(connection.sqlite.prepare('select count(*) as count from verification').get()).toEqual({ count: 0 })

      provider.add('member', 'original@example.test')
      const token = await issueToken(connection, provider, 'cs_changed')
      provider.add('member', 'changed@example.test')
      await expect(
        claimStripeMembership({
          client: provider.client,
          config,
          connection,
          generateUserId: () => 'user-changed',
          token
        })
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(connection.sqlite.prepare('select count(*) as count from user').get()).toEqual({ count: 0 })
    })
  })

  it('rolls back a second account when a Stripe customer or subscription is already claimed', async () => {
    await withDatabase(async (connection) => {
      const provider = createProvider()
      const shared = { customerId: 'cus_shared', subscriptionId: 'sub_shared' }
      provider.add('member', 'first@example.test', shared)
      const authentication = betterAuth({
        baseURL: config.appUrl,
        secret: 'stripe-first-membership-test-secret',
        database: drizzleAdapter(connection.db, { provider: 'sqlite', schema }),
        plugins: [
          stripeMembershipAuth({
            client: () => provider.client,
            config,
            connection,
            getEmailSender: () => ({ send: async () => undefined }),
            legacyPrices: { member: ['membership-10-1month'], solidarity: ['solidarity-27-1month'] }
          })
        ]
      })
      const response = await authentication.handler(
        new Request(
          `${config.appUrl}/api/auth/stripe-membership/claim?token=${await issueToken(connection, provider, 'cs_first')}`,
          { redirect: 'manual' }
        )
      )
      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe(`${config.appUrl}/app`)
      expect(response.headers.getSetCookie().some((value) => value.includes('session_token='))).toBe(true)

      provider.add('member', 'second@example.test', shared)
      await expect(
        claimStripeMembership({
          client: provider.client,
          config,
          connection,
          generateUserId: () => 'user-second',
          token: await issueToken(connection, provider, 'cs_second')
        })
      ).rejects.toThrow()

      expect(connection.sqlite.prepare('select email from user').all()).toEqual([{ email: 'first@example.test' }])
      expect(connection.sqlite.prepare('select count(*) as count from session').get()).toEqual({ count: 1 })
      expect(connection.sqlite.prepare('select count(*) as count from account_stripe_memberships').get()).toEqual({
        count: 1
      })
      expect(
        connection.sqlite
          .prepare(
            `select stripe_status as stripeStatus,
                    last_verified_at is not null as hasFreshProjection
             from account_stripe_memberships`
          )
          .get()
      ).toEqual({ stripeStatus: 'active', hasFreshProjection: 1 })
      expect(connection.sqlite.prepare('select count(*) as count from people').get()).toEqual({ count: 0 })
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

async function issueToken(
  connection: DatabaseConnection,
  provider: ReturnType<typeof createProvider>,
  sessionId: string
) {
  let delivery = ''
  await issueStripeMembershipMagicLink({
    client: provider.client,
    config,
    connection,
    sender: { send: async (message) => void (delivery = message.text) },
    sessionId
  })
  const url = delivery.match(/https?:\/\/\S+/)?.[0]
  const token = url ? new URL(url).searchParams.get('token') : null
  if (!token) throw new Error('Expected a delivered membership token')
  return token
}

function createProvider() {
  let record = membershipRecord('supporter', 'default@example.test')
  const create = vi.fn(async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_created' }))
  const client = {
    checkout: {
      sessions: {
        create,
        retrieve: vi.fn(async () => record.session)
      }
    },
    customers: { retrieve: vi.fn(async () => record.customer) },
    subscriptions: { retrieve: vi.fn(async () => record.subscription) }
  } as unknown as Stripe

  return {
    add(
      tier: StripeMembershipTier,
      email: string,
      overrides: { customerEmail?: string; customerId?: string; priceId?: string; subscriptionId?: string } = {}
    ) {
      record = membershipRecord(tier, email, overrides)
    },
    client,
    create
  }
}

function membershipRecord(
  tier: StripeMembershipTier,
  email: string,
  overrides: { customerEmail?: string; customerId?: string; priceId?: string; subscriptionId?: string } = {}
) {
  const customerId = overrides.customerId ?? `cus_${tier}`
  const subscriptionId = overrides.subscriptionId ?? `sub_${tier}`
  return {
    session: {
      status: 'complete',
      mode: 'subscription',
      metadata: { wcu_membership_tier: tier },
      customer: customerId,
      subscription: subscriptionId,
      customer_details: { email }
    },
    customer: { id: customerId, deleted: false, email: overrides.customerEmail ?? email },
    subscription: {
      id: subscriptionId,
      status: 'active',
      customer: customerId,
      metadata: { wcu_membership_tier: tier },
      items: { data: [{ price: { id: overrides.priceId ?? config.prices[tier] }, quantity: 1 }] }
    }
  }
}
