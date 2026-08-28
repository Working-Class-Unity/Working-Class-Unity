import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type Stripe from 'stripe'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { DatabaseConnection } from '../server/db/connect'
import * as schema from '../server/db/schema'
import { readWebsiteMembershipAccess } from '../server/services/membership/member-access'
import {
  activatePublicJoinMembership,
  claimPublicJoinAttempt,
  claimUniquePublicJoinForAccount,
  createPublicJoinCheckout,
  readPublicJoinAttempt,
  readPublicJoinStatus
} from '../server/services/membership/public-join'
import {
  isAuthorizedPublicJoinMagicLinkRequest,
  publicJoinClaimToken,
  type PublicJoinMagicLinkBody
} from '../server/services/membership/public-join-auth'
import { createPublicJoinClaimJobHandler } from '../server/services/membership/public-join-job'
import { createStripeBillingCatalog } from '../server/services/payments/stripe/catalog'
import type { BillingStripeRuntimeConfiguration } from '../server/services/payments/stripe/configuration'
import { applyStripeEventObservation } from '../server/services/payments/stripe/event-store'
import type { StripeBillingClient } from '../server/services/payments/stripe/stripe-client'
import type { StripeEventObservation } from '../server/services/payments/stripe/webhook'
import type { MembershipDuesOfferingKey } from '../shared/billing'

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
const now = new Date('2026-08-27T18:00:00.000Z')
const reviewSecret = 'public-join-test-secret'
const configuration = {
  appName: 'Working Class Unity',
  appUrl: 'https://www.workingclassunity.test',
  stripe: {
    secretKey: 'rk_test_public_join',
    webhookSecret: 'whsec_public_join',
    portalConfigurationId: 'bpc_public_join',
    prices: {
      'personal.weekly': '',
      'personal.monthly': 'price_membership_10',
      'personal.annual': '',
      'family.monthly': 'price_solidarity_27',
      'family.annual': ''
    }
  }
} as const satisfies BillingStripeRuntimeConfiguration

describe('public membership join', () => {
  it.each([
    ['personal.monthly', 'personal', 'price_membership_10'],
    ['family.monthly', 'family', 'price_solidarity_27']
  ] as const)(
    'keeps %s server-owned, claims the exact paid attempt, and activates equal member access only after attestation',
    async (offering, plan, priceId) => {
      await withDatabase(async (connection) => {
        const checkout = checkoutClient()
        const result = await createPublicJoinCheckout(
          { client: checkout.client, config: configuration, connection },
          offering,
          now
        )
        const attempt = onlyAttempt(connection)

        expect(result.url).toBe(`https://checkout.stripe.test/${attempt.id}`)
        expect(checkout.create).toHaveBeenCalledWith(
          expect.objectContaining({
            mode: 'subscription',
            client_reference_id: attempt.id,
            line_items: [{ price: priceId, quantity: 1 }],
            metadata: { billing_attempt_id: attempt.id },
            subscription_data: { metadata: { billing_attempt_id: attempt.id } },
            success_url: `https://www.workingclassunity.test/join/complete?id=${attempt.id}`,
            cancel_url: `https://www.workingclassunity.test/join?offering=${encodeURIComponent(offering)}&checkout=cancelled`
          }),
          { idempotencyKey: attempt.idempotencyKey }
        )
        expect(attempt).toMatchObject({ cadence: 'monthly', planKey: plan, state: 'open', stripePriceId: priceId })

        const email = `${plan}@example.test`
        const paid = payAttempt(connection, attempt.id, offering, email)
        expect(paid).toEqual({
          subscriptionFirst: { duplicate: false, target: 'live' },
          checkoutComplete: { duplicate: false, target: 'live' },
          checkoutDuplicate: { duplicate: true, target: 'ignored' }
        })
        expect(readPublicJoinStatus(connection, attempt.id, null)).toMatchObject({ status: 'check_email', offering })
        expect(
          connection.sqlite
            .prepare("select count(*) as count from job_queue where type = 'membership.public-join-claim'")
            .get()
        ).toEqual({ count: 1 })

        const issued: PublicJoinMagicLinkBody[] = []
        const job = createPublicJoinClaimJobHandler({
          connection,
          secret: reviewSecret,
          now: () => new Date(now.getTime() + 1_000),
          issueMagicLink: async (body) => void issued.push(body)
        })
        await job({ attemptId: attempt.id })
        expect(issued).toEqual([
          expect.objectContaining({
            email,
            callbackURL: expect.stringMatching(/^\/join\/claim\?id=join_checkout_.*&token=/),
            newUserCallbackURL: expect.stringMatching(/^\/join\/claim\?id=join_checkout_.*&token=/),
            errorCallbackURL: `/join/complete?id=${attempt.id}&status=link-error`
          })
        ])
        expect(isAuthorizedPublicJoinMagicLinkRequest(issued[0], reviewSecret)).toBe(true)
        expect(
          isAuthorizedPublicJoinMagicLinkRequest({ ...issued[0], email: `other-${issued[0]!.email}` }, reviewSecret)
        ).toBe(false)
        expect(isAuthorizedPublicJoinMagicLinkRequest({ ...issued[0], name: 'Forged name' }, reviewSecret)).toBe(false)
        expect(isAuthorizedPublicJoinMagicLinkRequest({ ...issued[0], firstName: 'Forged field' }, reviewSecret)).toBe(
          false
        )

        seedAccount(connection, `user-${plan}`, email)
        const claimable = readPublicJoinAttempt(connection, attempt.id)!
        const claim = claimPublicJoinAttempt(
          connection,
          { id: `user-${plan}`, email, emailVerified: true },
          {
            attemptId: attempt.id,
            token: publicJoinClaimToken(claimable, reviewSecret),
            reviewHashKey: reviewSecret,
            now: new Date(now.getTime() + 2_000)
          }
        )
        expect(claim).toBe('claimed')
        expect(readPublicJoinStatus(connection, attempt.id, `user-${plan}`).status).toBe('needs_attestation')
        expect(readWebsiteMembershipAccess(connection, `user-${plan}`, configuration.stripe.prices, now)).toMatchObject(
          {
            granted: false,
            offering,
            source: 'stripe',
            state: 'active'
          }
        )

        connection.sqlite
          .prepare("update billing_subscriptions set status = 'canceled' where purchaser_user_id = ?")
          .run(`user-${plan}`)
        expect(
          activatePublicJoinMembership(connection, `user-${plan}`, {
            attemptId: attempt.id,
            connectionKind: 'resides',
            now: new Date(now.getTime() + 3_000)
          })
        ).toBe('ignored')
        connection.sqlite
          .prepare("update billing_subscriptions set status = 'active' where purchaser_user_id = ?")
          .run(`user-${plan}`)
        expect(
          activatePublicJoinMembership(connection, `user-${plan}`, {
            attemptId: attempt.id,
            connectionKind: 'resides',
            now: new Date(now.getTime() + 3_000)
          })
        ).toBe('active')
        expect(readWebsiteMembershipAccess(connection, `user-${plan}`, configuration.stripe.prices, now)).toMatchObject(
          {
            granted: true,
            offering,
            source: 'stripe',
            state: 'active'
          }
        )
        expect(
          connection.sqlite
            .prepare(
              `select m.status, a.connection_kind as connectionKind, s.status as standing
               from public_join_attempts j join memberships m on m.id = j.membership_id
               join membership_attestations a on a.membership_id = m.id
               join membership_standing_periods s on s.membership_id = m.id and s.effective_to is null
               where j.id = ?`
            )
            .get(attempt.id)
        ).toEqual({ status: 'active', connectionKind: 'resides', standing: 'good' })
      })
    }
  )

  it('claims exactly one same-email paid attempt on ordinary login and fails closed when two are available', async () => {
    await withDatabase(async (connection) => {
      const email = 'existing-supporter@example.test'
      seedAccount(connection, 'user-existing', email)
      const first = await startPaidAttempt(connection, 'personal.monthly', email, 0, 'user-existing')

      expect(
        claimUniquePublicJoinForAccount(
          connection,
          { id: 'user-existing', email, emailVerified: true },
          reviewSecret,
          new Date(now.getTime() + 2_000)
        )
      ).toBe('claimed')
      expect(readPublicJoinAttempt(connection, first)!.claimedUserId).toBe('user-existing')
      expect(readPublicJoinStatus(connection, first, 'user-existing').status).toBe('needs_attestation')
      expect(readWebsiteMembershipAccess(connection, 'user-existing', configuration.stripe.prices, now).granted).toBe(
        false
      )
    })

    await withDatabase(async (connection) => {
      const email = 'ambiguous-supporter@example.test'
      seedAccount(connection, 'user-ambiguous', email)
      const first = await startPaidAttempt(connection, 'personal.monthly', email, 0)
      const second = await startPaidAttempt(connection, 'family.monthly', email, 10_000)

      expect(
        claimUniquePublicJoinForAccount(
          connection,
          { id: 'user-ambiguous', email, emailVerified: true },
          reviewSecret,
          new Date(now.getTime() + 20_000)
        )
      ).toBe('conflict')
      expect(readPublicJoinAttempt(connection, first)!.claimedUserId).toBeNull()
      expect(readPublicJoinAttempt(connection, second)!.claimedUserId).toBeNull()
      expect(
        connection.sqlite
          .prepare("select reason, status from identity_link_reviews where user_id = 'user-ambiguous'")
          .get()
      ).toEqual({ reason: 'ambiguous_verified_email', status: 'open' })
    })

    await withDatabase(async (connection) => {
      const email = 'expired-supporter@example.test'
      seedAccount(connection, 'user-expired', email)
      const attemptId = await startPaidAttempt(connection, 'personal.monthly', email, 0)
      const claimExpiresAt = readPublicJoinAttempt(connection, attemptId)!.claimExpiresAt!

      expect(
        claimUniquePublicJoinForAccount(
          connection,
          { id: 'user-expired', email, emailVerified: true },
          reviewSecret,
          new Date(claimExpiresAt),
          attemptId
        )
      ).toBe('expired')
      expect(readPublicJoinAttempt(connection, attemptId)!.claimedUserId).toBeNull()
    })
  })

  it('rejects an authenticated active member before reserving a new Stripe Checkout', async () => {
    await withDatabase(async (connection) => {
      const userId = 'user-active-member'
      seedAccount(connection, userId, 'active-member@example.test')
      connection.sqlite
        .prepare(
          `insert into memberships
             (id, person_id, status, applied_at, started_at, attendance_requirement_starts_at, created_at, updated_at)
           values ('membership-active', ?, 'active', ?, ?, ?, ?, ?)`
        )
        .run(
          `person-${userId}`,
          now.toISOString(),
          now.toISOString(),
          now.toISOString(),
          now.toISOString(),
          now.toISOString()
        )
      const checkout = checkoutClient()

      await expect(
        createPublicJoinCheckout(
          { client: checkout.client, config: configuration, connection },
          'personal.monthly',
          now,
          userId
        )
      ).rejects.toThrow('The current account already has membership or billing in progress')
      expect(checkout.create).not.toHaveBeenCalled()
      expect(connection.sqlite.prepare('select count(*) as count from public_join_attempts').get()).toEqual({
        count: 0
      })
    })
  })
})

async function startPaidAttempt(
  connection: DatabaseConnection,
  offering: MembershipDuesOfferingKey,
  email: string,
  offsetMs: number,
  purchaserUserId: string | null = null
): Promise<string> {
  const checkout = checkoutClient(`_${offsetMs}`)
  await createPublicJoinCheckout(
    { client: checkout.client, config: configuration, connection },
    offering,
    new Date(now.getTime() + offsetMs),
    purchaserUserId
  )
  const attempt = connection.sqlite
    .prepare('select id from public_join_attempts order by created_at desc, id desc limit 1')
    .get() as { id: string }
  payAttempt(connection, attempt.id, offering, email, offsetMs)
  return attempt.id
}

function payAttempt(
  connection: DatabaseConnection,
  attemptId: string,
  offering: MembershipDuesOfferingKey,
  email: string,
  offsetMs = 0
) {
  const attempt = readPublicJoinAttempt(connection, attemptId)!
  const suffix = attemptId.slice(-12).replaceAll('-', '')
  const customerId = `cus_${suffix}`
  const subscriptionId = `sub_${suffix}`
  const subscriptionItemId = `si_${suffix}`
  const invoice = {
    object: 'invoice',
    id: `in_${suffix}`,
    customer: customerId,
    parent: { type: 'subscription_details', subscription_details: { subscription: subscriptionId } },
    billing_reason: 'subscription_create',
    collection_method: 'charge_automatically',
    status: 'paid',
    amount_remaining: 0
  } as unknown as Stripe.Invoice
  const subscription = {
    object: 'subscription',
    id: subscriptionId,
    customer: customerId,
    latest_invoice: invoice
  } as unknown as Stripe.Subscription
  const projection = {
    stripeSubscriptionId: subscriptionId,
    stripeSubscriptionItemId: subscriptionItemId,
    status: 'active' as const,
    planKey: offering === 'personal.monthly' ? ('personal' as const) : ('family' as const),
    cadence: 'monthly' as const,
    stripePriceId: configuration.stripe.prices[offering],
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: new Date(now.getTime() + 31 * 24 * 60 * 60 * 1_000).toISOString(),
    cancelAtPeriodEnd: false,
    reconciliationRequired: false,
    reconciliationReason: null
  }
  const subscriptionFirst = applyStripeEventObservation(
    connection,
    undefined,
    {
      eventId: `evt_subscription_${suffix}_${offsetMs}`,
      eventType: 'customer.subscription.created',
      eventCreatedAt: Math.floor((now.getTime() + offsetMs) / 1_000),
      objectId: subscriptionId,
      catalog: createStripeBillingCatalog(configuration.stripe.prices),
      attemptId,
      stripeCustomerId: customerId,
      stripeSessionId: null,
      checkoutState: null,
      projection,
      reconciliationReason: null,
      providerState: { kind: 'subscription', subscription, schedule: null }
    },
    new Date(now.getTime() + offsetMs + 500)
  )
  const observation: StripeEventObservation = {
    eventId: `evt_${suffix}_${offsetMs}`,
    eventType: 'checkout.session.completed',
    eventCreatedAt: Math.floor((now.getTime() + offsetMs) / 1_000),
    objectId: attempt.stripeSessionId!,
    catalog: createStripeBillingCatalog(configuration.stripe.prices),
    attemptId,
    stripeCustomerId: customerId,
    stripeSessionId: attempt.stripeSessionId,
    checkoutState: 'completed',
    projection,
    reconciliationReason: null,
    providerState: {
      kind: 'checkout',
      session: {
        object: 'checkout.session',
        id: attempt.stripeSessionId,
        client_reference_id: attempt.id,
        metadata: { billing_attempt_id: attempt.id },
        customer_details: { email },
        line_items: {
          object: 'list',
          data: [{ price: { id: configuration.stripe.prices[offering] }, quantity: 1 }],
          has_more: false
        }
      } as unknown as Stripe.Checkout.Session,
      subscription,
      schedule: null,
      checkoutOffering: offering
    }
  }
  const completedAt = new Date(now.getTime() + offsetMs + 1_000)
  return {
    subscriptionFirst,
    checkoutComplete: applyStripeEventObservation(connection, undefined, observation, completedAt),
    checkoutDuplicate: applyStripeEventObservation(connection, undefined, observation, completedAt)
  }
}

function checkoutClient(idSuffix = '') {
  const create = vi.fn(async (params: Stripe.Checkout.SessionCreateParams) => ({
    object: 'checkout.session',
    id: `cs_public_join${idSuffix}_${params.client_reference_id!.slice(-8)}`,
    mode: 'subscription',
    status: 'open',
    client_reference_id: params.client_reference_id,
    metadata: params.metadata,
    line_items: {
      object: 'list',
      data: [{ price: { id: params.line_items![0]!.price }, quantity: 1 }],
      has_more: false
    },
    url: `https://checkout.stripe.test/${params.client_reference_id}`
  }))
  return {
    create,
    client: { checkout: { sessions: { create } } } as unknown as StripeBillingClient
  }
}

function seedAccount(connection: DatabaseConnection, userId: string, email: string): void {
  const personId = `person-${userId}`
  connection.sqlite
    .prepare(
      `insert into user (id, name, email, email_verified, created_at, updated_at)
       values (?, 'WCU account', ?, 1, 1, 1)`
    )
    .run(userId, email)
  connection.sqlite.prepare('insert into people (id) values (?)').run(personId)
  connection.sqlite
    .prepare('insert into person_accounts (person_id, user_id, linked_at) values (?, ?, ?)')
    .run(personId, userId, now.toISOString())
}

function onlyAttempt(connection: DatabaseConnection) {
  const row = connection.sqlite.prepare('select id from public_join_attempts').get() as { id: string }
  return readPublicJoinAttempt(connection, row.id)!
}

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
