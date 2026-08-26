import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { DatabaseConnection } from '../../server/db/connect'
import * as schema from '../../server/db/schema'
import type { TransactionalEmailMessage } from '../../server/services/email'
import { ensureWebsiteAccountIdentity } from '../../server/services/membership/account-identity'
import {
  billingEmailVerificationExpiryMs,
  consumeBillingEmailVerification,
  createBillingEmailVerificationDeliveryHandler,
  ensureBillingEmailVerificationJobs,
  reserveBillingEmailVerificationInTransaction
} from '../../server/services/payments/stripe/billing-email-verification'
import { temporaryPhoneEmail } from '../../server/utils/auth/phone'

const migrationsFolder = fileURLToPath(new URL('../../server/db/migrations/', import.meta.url))
const now = new Date('2026-08-26T12:00:00.000Z')
const secret = 'billing-email-verification-test-secret'
const prices = {
  'personal.monthly': 'price_membership_10',
  'family.monthly': 'price_solidarity_27'
} as const

describe('post-Checkout billing-email verification', () => {
  it('verifies email on the same phone-backed account without creating another canonical person', async () => {
    await withDatabase(async (connection) => {
      const userId = 'user-phone-member'
      const phone = '+12095550123'
      const billingEmail = 'new.member@example.test'
      const personId = seedPhoneSupporter(connection, userId, phone)
      const attemptId = seedCompletedCheckout(
        connection,
        userId,
        'personal',
        'price_membership_10',
        'cs_billing_email_personal'
      )

      const verificationId = reserveBillingEmailVerificationInTransaction(
        connection,
        {
          billingCheckoutAttemptId: attemptId,
          email: `  ${billingEmail.toUpperCase()}  `,
          purchaserUserId: userId,
          stripeSessionId: 'cs_billing_email_personal'
        },
        now
      )
      expect(verificationId).toMatch(/^billing_email_verification_/)
      expect(
        reserveBillingEmailVerificationInTransaction(
          connection,
          {
            billingCheckoutAttemptId: attemptId,
            email: billingEmail,
            purchaserUserId: userId,
            stripeSessionId: 'cs_billing_email_personal'
          },
          now
        )
      ).toBe(verificationId)
      expect(count(connection, 'billing_email_verifications')).toBe(1)

      const queued = verificationJob(connection)
      expect(JSON.parse(queued.payload)).toEqual({ verificationId })
      expect(queued.payload).not.toContain(billingEmail)
      expect(Object.keys(JSON.parse(queued.payload))).toEqual(['verificationId'])

      const messages: TransactionalEmailMessage[] = []
      const handler = deliveryHandler(connection, messages, now)
      await handler(JSON.parse(queued.payload))
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({
        idempotencyKey: `billing-email-verification-${verificationId}`,
        to: billingEmail
      })
      const link = verificationLink(messages[0]!)
      expect(link.searchParams.get('id')).toBe(verificationId)
      expect(link.searchParams.get('token')).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(queued.payload).not.toContain(link.searchParams.get('token')!)

      expect(
        consumeBillingEmailVerification(connection, {
          secret,
          stripePrices: prices,
          token: link.searchParams.get('token')!,
          verificationId: verificationId!,
          now: new Date(now.getTime() + 60 * 60 * 1_000)
        })
      ).toBe('verified')
      expect(readUser(connection, userId)).toMatchObject({
        email: billingEmail,
        emailVerified: 1,
        phoneNumber: phone,
        phoneNumberVerified: 1
      })
      expect(count(connection, 'people')).toBe(1)
      expect(count(connection, 'person_accounts')).toBe(1)
      expect(
        connection.sqlite
          .prepare(
            `select kind, normalized_value as value, verified_at as verifiedAt
             from person_contacts where person_id = ? order by kind`
          )
          .all(personId)
      ).toEqual([
        { kind: 'email', value: billingEmail, verifiedAt: new Date(now.getTime() + 60 * 60 * 1_000).toISOString() },
        { kind: 'phone', value: phone, verifiedAt: now.toISOString() }
      ])
      expect(count(connection, 'session')).toBe(0)

      expect(
        consumeBillingEmailVerification(connection, {
          secret,
          stripePrices: prices,
          token: link.searchParams.get('token')!,
          verificationId: verificationId!,
          now: new Date(now.getTime() + 2 * 60 * 60 * 1_000)
        })
      ).toBe('ignored')
      expect(
        ensureWebsiteAccountIdentity(
          connection,
          {
            id: userId,
            email: billingEmail,
            emailVerified: true,
            phoneNumber: phone,
            phoneNumberVerified: true
          },
          { observedAt: new Date(now.getTime() + 2 * 60 * 60 * 1_000), reviewHashKey: secret, stripePrices: prices }
        )
      ).toMatchObject({ personId, reviewCreated: false, reviewReason: null })
      expect(count(connection, 'people')).toBe(1)
    })
  })

  it('expires the one-time link at the exact 24-hour boundary without changing the account', async () => {
    await withDatabase(async (connection) => {
      const userId = 'user-expired-link'
      const phone = '+13105550123'
      const placeholder = temporaryPhoneEmail(secret, phone)
      seedPhoneSupporter(connection, userId, phone)
      const attemptId = seedCompletedCheckout(
        connection,
        userId,
        'family',
        'price_solidarity_27',
        'cs_billing_email_expired'
      )
      const verificationId = reserveBillingEmailVerificationInTransaction(
        connection,
        {
          billingCheckoutAttemptId: attemptId,
          email: 'expired.member@example.test',
          purchaserUserId: userId,
          stripeSessionId: 'cs_billing_email_expired'
        },
        now
      )!
      const messages: TransactionalEmailMessage[] = []
      await deliveryHandler(connection, messages, now)(JSON.parse(verificationJob(connection).payload))
      const link = verificationLink(messages[0]!)

      expect(
        consumeBillingEmailVerification(connection, {
          secret,
          stripePrices: prices,
          token: link.searchParams.get('token')!,
          verificationId,
          now: new Date(now.getTime() + billingEmailVerificationExpiryMs)
        })
      ).toBe('expired')
      expect(readUser(connection, userId)).toMatchObject({ email: placeholder, emailVerified: 0 })
      expect(
        connection.sqlite.prepare('select status from billing_email_verifications where id = ?').get(verificationId)
      ).toEqual({ status: 'expired' })
      expect(count(connection, 'people')).toBe(1)
    })
  })

  it('refuses a shared email, preserves both accounts, and opens one privacy-safe review', async () => {
    await withDatabase(async (connection) => {
      const phoneUserId = 'user-shared-phone'
      const ownerUserId = 'user-shared-owner'
      const phone = '+14155550123'
      const sharedEmail = 'shared.member@example.test'
      const placeholder = temporaryPhoneEmail(secret, phone)
      const phonePersonId = seedPhoneSupporter(connection, phoneUserId, phone)
      insertUser(connection, { email: sharedEmail, emailVerified: true, id: ownerUserId })
      const ownerIdentity = ensureWebsiteAccountIdentity(
        connection,
        { email: sharedEmail, emailVerified: true, id: ownerUserId },
        { observedAt: now, reviewHashKey: secret, stripePrices: prices }
      )
      const attemptId = seedCompletedCheckout(
        connection,
        phoneUserId,
        'personal',
        'price_membership_10',
        'cs_billing_email_shared'
      )
      const verificationId = reserveBillingEmailVerificationInTransaction(
        connection,
        {
          billingCheckoutAttemptId: attemptId,
          email: sharedEmail,
          purchaserUserId: phoneUserId,
          stripeSessionId: 'cs_billing_email_shared'
        },
        now
      )!
      const messages: TransactionalEmailMessage[] = []
      await deliveryHandler(connection, messages, now)(JSON.parse(verificationJob(connection).payload))
      const link = verificationLink(messages[0]!)

      expect(
        consumeBillingEmailVerification(connection, {
          secret,
          stripePrices: prices,
          token: link.searchParams.get('token')!,
          verificationId,
          now: new Date(now.getTime() + 1_000)
        })
      ).toBe('conflict')
      expect(readUser(connection, phoneUserId)).toMatchObject({ email: placeholder, emailVerified: 0 })
      expect(readUser(connection, ownerUserId)).toMatchObject({ email: sharedEmail, emailVerified: 1 })
      expect(count(connection, 'people')).toBe(2)
      expect(
        connection.sqlite
          .prepare('select person_id as personId from person_accounts where user_id = ?')
          .get(phoneUserId)
      ).toEqual({ personId: phonePersonId })
      expect(ownerIdentity.personId).not.toBe(phonePersonId)
      const review = connection.sqlite
        .prepare(
          `select reason, identifier_hash as identifierHash, status
           from identity_link_reviews where user_id = ?`
        )
        .get(phoneUserId) as { identifierHash: string; reason: string; status: string }
      expect(review).toMatchObject({ reason: 'conflicting_verified_email', status: 'open' })
      expect(review.identifierHash).toMatch(/^[a-f0-9]{64}$/)
      expect(review.identifierHash).not.toContain(sharedEmail)
      const reviewJob = connection.sqlite
        .prepare("select payload from job_queue where type = 'identity.review-notification'")
        .get() as { payload: string }
      expect(JSON.parse(reviewJob.payload)).toEqual({ reviewId: expect.stringMatching(/^identity_review_/) })
      expect(reviewJob.payload).not.toContain(sharedEmail)
      expect(
        connection.sqlite.prepare('select status from billing_email_verifications where id = ?').get(verificationId)
      ).toEqual({ status: 'conflict' })
    })
  })

  it('verifies the login email but keeps canonical people separate when the Stripe person has another account', async () => {
    await withDatabase(async (connection) => {
      const phoneUserId = 'user-owned-stripe-phone'
      const ownerUserId = 'user-owned-stripe-owner'
      const phone = '+14155550124'
      const billingEmail = 'billing.alias@example.test'
      const phonePersonId = seedPhoneSupporter(connection, phoneUserId, phone)
      insertUser(connection, { email: 'owner.login@example.test', emailVerified: true, id: ownerUserId })
      const ownerIdentity = ensureWebsiteAccountIdentity(
        connection,
        { email: 'owner.login@example.test', emailVerified: true, id: ownerUserId },
        { observedAt: now, reviewHashKey: secret, stripePrices: prices }
      )
      connection.sqlite
        .prepare(
          `insert into person_contacts
             (id, person_id, kind, value, normalized_value, is_primary)
           values ('contact-owned-stripe-alias', ?, 'email', ?, ?, 0)`
        )
        .run(ownerIdentity.personId, billingEmail, billingEmail)
      connection.sqlite
        .prepare(
          `insert into provider_identities
             (id, person_id, provider, external_id, state, linked_at)
           values ('identity-owned-stripe', ?, 'stripe', 'cus_owned_stripe', 'active', ?)`
        )
        .run(ownerIdentity.personId, now.toISOString())
      connection.sqlite
        .prepare("insert into stripe_products (id, name, active) values ('prod_owned_stripe', 'Membership dues', 1)")
        .run()
      connection.sqlite
        .prepare(
          `insert into stripe_prices
             (id, product_id, active, currency, unit_amount, recurring_interval, recurring_interval_count)
           values (?, 'prod_owned_stripe', 1, 'USD', 1000, 'month', 1)`
        )
        .run(prices['personal.monthly'])
      connection.sqlite
        .prepare("insert into stripe_customers (id, person_id) values ('cus_owned_stripe', ?)")
        .run(ownerIdentity.personId)
      connection.sqlite
        .prepare(
          `insert into stripe_subscriptions
             (id, customer_id, status, current_period_start, current_period_end)
           values (
             'sub_owned_stripe', 'cus_owned_stripe', 'active',
             '2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'
           )`
        )
        .run()
      connection.sqlite
        .prepare(
          `insert into stripe_subscription_items (id, subscription_id, price_id)
           values ('si_owned_stripe', 'sub_owned_stripe', ?)`
        )
        .run(prices['personal.monthly'])

      const attemptId = seedCompletedCheckout(
        connection,
        phoneUserId,
        'personal',
        prices['personal.monthly'],
        'cs_billing_email_owned_stripe'
      )
      const verificationId = reserveBillingEmailVerificationInTransaction(
        connection,
        {
          billingCheckoutAttemptId: attemptId,
          email: billingEmail,
          purchaserUserId: phoneUserId,
          stripeSessionId: 'cs_billing_email_owned_stripe'
        },
        now
      )!
      const messages: TransactionalEmailMessage[] = []
      await deliveryHandler(connection, messages, now)(JSON.parse(verificationJob(connection).payload))
      const link = verificationLink(messages[0]!)

      expect(
        consumeBillingEmailVerification(connection, {
          secret,
          stripePrices: prices,
          token: link.searchParams.get('token')!,
          verificationId,
          now: new Date(now.getTime() + 1_000)
        })
      ).toBe('verified')
      expect(readUser(connection, phoneUserId)).toMatchObject({ email: billingEmail, emailVerified: 1 })
      expect(count(connection, 'people')).toBe(2)
      expect(count(connection, 'person_accounts')).toBe(2)
      expect(
        connection.sqlite
          .prepare('select person_id as personId from person_accounts where user_id = ?')
          .get(phoneUserId)
      ).toEqual({ personId: phonePersonId })
      expect(
        connection.sqlite
          .prepare('select person_id as personId from person_accounts where user_id = ?')
          .get(ownerUserId)
      ).toEqual({ personId: ownerIdentity.personId })
      expect(connection.sqlite.prepare('select count(*) as count from billing_customers').get()).toEqual({ count: 0 })
      expect(connection.sqlite.prepare('select count(*) as count from billing_subscriptions').get()).toEqual({
        count: 0
      })
      const review = connection.sqlite
        .prepare(
          `select identifier_hash as identifierHash, reason, status
           from identity_link_reviews where user_id = ?`
        )
        .get(phoneUserId) as { identifierHash: string; reason: string; status: string }
      expect(review).toMatchObject({ reason: 'conflicting_verified_email', status: 'open' })
      expect(review.identifierHash).toMatch(/^[a-f0-9]{64}$/)
      expect(JSON.stringify(review)).not.toContain(billingEmail)
    })
  })

  it('keeps both canonical people and local billing when imported Stripe adoption conflicts', async () => {
    await withDatabase(async (connection) => {
      const phoneUserId = 'user-billing-adoption-conflict'
      const phone = '+14155550129'
      const billingEmail = 'billing.adoption.conflict@example.test'
      const phonePersonId = seedPhoneSupporter(connection, phoneUserId, phone)
      connection.sqlite
        .prepare(
          `insert into billing_customers (id, purchaser_user_id, stripe_customer_id)
           values ('billing_customer_adoption_conflict', ?, 'cus_new')`
        )
        .run(phoneUserId)
      connection.sqlite
        .prepare(
          `insert into billing_subscriptions (
             id, purchaser_user_id, billing_customer_id, stripe_subscription_id,
             stripe_subscription_item_id, status, plan_key, cadence, stripe_price_id,
             current_period_start, current_period_end, last_verified_at
           ) values (
             'billing_subscription_adoption_conflict', ?,
             'billing_customer_adoption_conflict', 'sub_new', 'si_new', 'active',
             'personal', 'monthly', ?, '2026-08-01T00:00:00.000Z',
             '2026-09-01T00:00:00.000Z', ?
           )`
        )
        .run(phoneUserId, prices['personal.monthly'], now.toISOString())

      connection.sqlite.prepare("insert into people (id) values ('person-imported-adoption-conflict')").run()
      connection.sqlite
        .prepare(
          `insert into person_contacts
             (id, person_id, kind, value, normalized_value, is_primary)
           values (
             'contact-imported-adoption-conflict', 'person-imported-adoption-conflict',
             'email', ?, ?, 1
           )`
        )
        .run(billingEmail, billingEmail)
      connection.sqlite
        .prepare(
          `insert into provider_identities
             (id, person_id, provider, external_id, state, linked_at)
           values (
             'identity-imported-adoption-conflict', 'person-imported-adoption-conflict',
             'stripe', 'cus_existing', 'active', ?
           )`
        )
        .run(now.toISOString())
      connection.sqlite
        .prepare(
          "insert into stripe_products (id, name, active) values ('prod_adoption_conflict', 'Membership dues', 1)"
        )
        .run()
      connection.sqlite
        .prepare(
          `insert into stripe_prices
             (id, product_id, active, currency, unit_amount, recurring_interval, recurring_interval_count)
           values (?, 'prod_adoption_conflict', 1, 'USD', 1000, 'month', 1)`
        )
        .run(prices['personal.monthly'])
      connection.sqlite
        .prepare(
          `insert into stripe_customers (id, person_id)
           values ('cus_existing', 'person-imported-adoption-conflict')`
        )
        .run()
      connection.sqlite
        .prepare(
          `insert into stripe_subscriptions
             (id, customer_id, status, current_period_start, current_period_end)
           values (
             'sub_existing', 'cus_existing', 'active',
             '2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'
           )`
        )
        .run()
      connection.sqlite
        .prepare(
          `insert into stripe_subscription_items (id, subscription_id, price_id)
           values ('si_existing', 'sub_existing', ?)`
        )
        .run(prices['personal.monthly'])

      const attemptId = seedCompletedCheckout(
        connection,
        phoneUserId,
        'personal',
        prices['personal.monthly'],
        'cs_billing_email_adoption_conflict'
      )
      const verificationId = reserveBillingEmailVerificationInTransaction(
        connection,
        {
          billingCheckoutAttemptId: attemptId,
          email: billingEmail,
          purchaserUserId: phoneUserId,
          stripeSessionId: 'cs_billing_email_adoption_conflict'
        },
        now
      )!
      const messages: TransactionalEmailMessage[] = []
      await deliveryHandler(connection, messages, now)(JSON.parse(verificationJob(connection).payload))
      const link = verificationLink(messages[0]!)

      expect(
        consumeBillingEmailVerification(connection, {
          secret,
          stripePrices: prices,
          token: link.searchParams.get('token')!,
          verificationId,
          now: new Date(now.getTime() + 1_000)
        })
      ).toBe('verified')
      expect(readUser(connection, phoneUserId)).toMatchObject({ email: billingEmail, emailVerified: 1 })
      expect(
        connection.sqlite.prepare('select status from billing_email_verifications where id = ?').get(verificationId)
      ).toEqual({ status: 'consumed' })
      expect(count(connection, 'people')).toBe(2)
      expect(
        connection.sqlite
          .prepare('select person_id as personId from person_accounts where user_id = ?')
          .get(phoneUserId)
      ).toEqual({ personId: phonePersonId })
      expect(
        connection.sqlite.prepare("select id from people where id = 'person-imported-adoption-conflict'").get()
      ).toEqual({ id: 'person-imported-adoption-conflict' })
      expect(connection.sqlite.prepare('select stripe_customer_id as customerId from billing_customers').all()).toEqual(
        [{ customerId: 'cus_new' }]
      )
      expect(
        connection.sqlite.prepare('select stripe_subscription_id as subscriptionId from billing_subscriptions').all()
      ).toEqual([{ subscriptionId: 'sub_new' }])
      const review = connection.sqlite
        .prepare(
          `select identifier_hash as identifierHash, reason, status
           from identity_link_reviews where user_id = ?`
        )
        .get(phoneUserId) as { identifierHash: string; reason: string; status: string }
      expect(review).toMatchObject({ reason: 'conflicting_verified_identifiers', status: 'open' })
      expect(review.identifierHash).toMatch(/^[a-f0-9]{64}$/)
      expect(JSON.stringify(review)).not.toContain(billingEmail)
      expect(JSON.stringify(review)).not.toContain('cus_existing')
    })
  })

  it('recreates one missing durable job and expires pending work without sending', () => {
    withDatabaseSync((connection) => {
      const userId = 'user-recover-job'
      seedPhoneSupporter(connection, userId, '+12135550123')
      const attemptId = seedCompletedCheckout(
        connection,
        userId,
        'personal',
        'price_membership_10',
        'cs_billing_email_recover'
      )
      const verificationId = reserveBillingEmailVerificationInTransaction(
        connection,
        {
          billingCheckoutAttemptId: attemptId,
          email: 'recover.member@example.test',
          purchaserUserId: userId,
          stripeSessionId: 'cs_billing_email_recover'
        },
        now
      )!
      connection.sqlite.prepare("delete from job_queue where type = 'billing.email-verification'").run()

      expect(ensureBillingEmailVerificationJobs(connection, new Date(now.getTime() + 1_000))).toBe(1)
      expect(ensureBillingEmailVerificationJobs(connection, new Date(now.getTime() + 2_000))).toBe(0)
      expect(JSON.parse(verificationJob(connection).payload)).toEqual({ verificationId })

      connection.sqlite.prepare("delete from job_queue where type = 'billing.email-verification'").run()
      expect(
        ensureBillingEmailVerificationJobs(connection, new Date(now.getTime() + billingEmailVerificationExpiryMs))
      ).toBe(0)
      expect(
        connection.sqlite.prepare('select status from billing_email_verifications where id = ?').get(verificationId)
      ).toEqual({ status: 'expired' })
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

function withDatabaseSync(run: (connection: DatabaseConnection) => void): void {
  const sqlite = new Database(':memory:')
  try {
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle({ client: sqlite, schema })
    migrate(db, { migrationsFolder })
    run({ databasePath: ':memory:', db, sqlite })
  } finally {
    sqlite.close()
  }
}

function seedPhoneSupporter(connection: DatabaseConnection, userId: string, phone: string): string {
  const placeholder = temporaryPhoneEmail(secret, phone)
  insertUser(connection, {
    email: placeholder,
    emailVerified: false,
    id: userId,
    phoneNumber: phone,
    phoneNumberVerified: true
  })
  const identity = ensureWebsiteAccountIdentity(
    connection,
    {
      email: placeholder,
      emailVerified: false,
      id: userId,
      phoneNumber: phone,
      phoneNumberVerified: true
    },
    { observedAt: now, reviewHashKey: secret, stripePrices: prices }
  )
  if (!identity.personId) throw new Error('Expected phone Supporter identity')
  return identity.personId
}

function insertUser(
  connection: DatabaseConnection,
  input: Readonly<{
    email: string
    emailVerified: boolean
    id: string
    phoneNumber?: string
    phoneNumberVerified?: boolean
  }>
): void {
  connection.sqlite
    .prepare(
      `insert into user
         (id, name, email, email_verified, phone_number, phone_number_verified, created_at, updated_at)
       values (?, 'WCU account', ?, ?, ?, ?, 1, 1)`
    )
    .run(
      input.id,
      input.email,
      input.emailVerified ? 1 : 0,
      input.phoneNumber ?? null,
      input.phoneNumberVerified ? 1 : 0
    )
}

function seedCompletedCheckout(
  connection: DatabaseConnection,
  userId: string,
  plan: 'personal' | 'family',
  priceId: string,
  sessionId: string
): string {
  const attemptId = `billing_attempt_${userId}`
  connection.sqlite
    .prepare(
      `insert into billing_checkout_attempts
         (id, purchaser_user_id, plan_key, cadence, stripe_price_id, stripe_session_id,
          idempotency_key, state, success_url, cancel_url, reuse_until, created_at, updated_at)
       values (?, ?, ?, 'monthly', ?, ?, ?, 'completed',
               'https://app.example.test/account?checkout=success',
               'https://app.example.test/account?checkout=cancelled', ?, ?, ?)`
    )
    .run(
      attemptId,
      userId,
      plan,
      priceId,
      sessionId,
      `checkout_${userId}`,
      new Date(now.getTime() + 30 * 60 * 1_000).toISOString(),
      now.toISOString(),
      now.toISOString()
    )
  return attemptId
}

function deliveryHandler(connection: DatabaseConnection, messages: TransactionalEmailMessage[], deliveryTime: Date) {
  return createBillingEmailVerificationDeliveryHandler({
    appName: 'Working Class Unity',
    appUrl: 'https://app.example.test',
    connection,
    secret,
    sender: {
      async send(message) {
        messages.push(message)
      }
    },
    now: () => deliveryTime
  })
}

function verificationJob(connection: DatabaseConnection): { payload: string } {
  return connection.sqlite
    .prepare("select payload from job_queue where type = 'billing.email-verification' order by id limit 1")
    .get() as { payload: string }
}

function verificationLink(message: TransactionalEmailMessage): URL {
  const value = message.text.split('\n').find((line) => line.startsWith('https://'))
  if (!value) throw new Error('Expected verification URL')
  return new URL(value)
}

function readUser(connection: DatabaseConnection, userId: string) {
  return connection.sqlite
    .prepare(
      `select email, email_verified as emailVerified,
              phone_number as phoneNumber, phone_number_verified as phoneNumberVerified
       from user where id = ?`
    )
    .get(userId)
}

function count(connection: DatabaseConnection, table: string): number {
  const allowed = new Set(['billing_email_verifications', 'people', 'person_accounts', 'session'])
  if (!allowed.has(table)) throw new Error('Unexpected table')
  return (connection.sqlite.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count
}
