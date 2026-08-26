import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { DatabaseConnection } from '../server/db/connect'
import * as schema from '../server/db/schema'
import { ensureWebsiteAccountIdentity } from '../server/services/membership/account-identity'
import { createIdentityReviewNotificationHandler } from '../server/services/membership/identity-review-notification'
import { IdentityReviewResolutionError, resolveIdentityLinkReview } from '../server/services/membership/identity-review'
import { temporaryPhoneEmail } from '../server/utils/auth/phone'

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
const observedAt = new Date('2026-08-26T12:00:00.000Z')
const reviewHashKey = 'test-review-hash-key-that-is-not-a-production-secret'
const stripePrices = {
  'personal.monthly': 'price_membership_10',
  'family.monthly': 'price_solidarity_27'
} as const

describe('website account identity', () => {
  it('links a uniquely matched Stripe-backed person after the website account verifies the billing email', () => {
    withDatabase((connection) => {
      insertUser(connection, {
        email: 'member@example.test',
        emailVerified: true,
        id: 'user-member'
      })
      insertPerson(connection, 'person-stripe')
      insertContact(connection, {
        id: 'contact-stripe-email',
        kind: 'email',
        personId: 'person-stripe',
        value: 'member@example.test',
        verifiedAt: null
      })
      insertProviderIdentity(connection, {
        externalId: 'cus_member',
        id: 'identity-stripe',
        personId: 'person-stripe',
        provider: 'stripe'
      })
      insertImportedActiveSubscription(connection, {
        customerId: 'cus_member',
        personId: 'person-stripe',
        priceId: stripePrices['personal.monthly'],
        subscriptionId: 'sub_member'
      })

      const account = {
        email: 'member@example.test',
        emailVerified: true,
        id: 'user-member'
      }
      expect(ensureWebsiteAccountIdentity(connection, account, { observedAt, reviewHashKey, stripePrices })).toEqual({
        personId: 'person-stripe',
        reviewCreated: false,
        reviewReason: null
      })
      expect(ensureWebsiteAccountIdentity(connection, account, { observedAt, reviewHashKey, stripePrices })).toEqual({
        personId: 'person-stripe',
        reviewCreated: false,
        reviewReason: null
      })
      expect(count(connection, 'people')).toBe(1)
      expect(
        connection.sqlite
          .prepare("select person_id as personId from person_accounts where user_id = 'user-member'")
          .get()
      ).toEqual({ personId: 'person-stripe' })
      expect(
        connection.sqlite
          .prepare(
            "select is_primary as isPrimary, verified_at as verifiedAt from person_contacts where id = 'contact-stripe-email'"
          )
          .get()
      ).toEqual({ isPrimary: 1, verifiedAt: observedAt.toISOString() })
      expect(
        connection.sqlite
          .prepare(
            `select bc.stripe_customer_id as customerId, bs.stripe_subscription_id as subscriptionId,
                    bs.stripe_subscription_item_id as itemId, bs.plan_key as plan,
                    bs.cadence, bs.stripe_price_id as priceId, bs.status
             from billing_customers bc
             join billing_subscriptions bs on bs.billing_customer_id = bc.id`
          )
          .get()
      ).toEqual({
        cadence: 'monthly',
        customerId: 'cus_member',
        itemId: 'si_sub_member',
        plan: 'personal',
        priceId: 'price_membership_10',
        status: 'active',
        subscriptionId: 'sub_member'
      })
      expect(connection.sqlite.prepare('select count(*) as count from billing_customers').get()).toEqual({ count: 1 })
      expect(connection.sqlite.prepare('select count(*) as count from billing_subscriptions').get()).toEqual({
        count: 1
      })
    })
  })

  it('creates one canonical person for a phone-only account and remains idempotent', () => {
    withDatabase((connection) => {
      const email = temporaryPhoneEmail(reviewHashKey, '+14155550123')
      insertUser(connection, {
        email,
        emailVerified: false,
        id: 'user-phone',
        phoneNumber: '+14155550123',
        phoneNumberVerified: true
      })
      const account = {
        email,
        emailVerified: false,
        id: 'user-phone',
        phoneNumber: '+14155550123',
        phoneNumberVerified: true
      }

      const first = ensureWebsiteAccountIdentity(connection, account, { observedAt, reviewHashKey })
      const repeated = ensureWebsiteAccountIdentity(connection, account, { observedAt, reviewHashKey })

      expect(repeated).toEqual(first)
      expect(first.personId).toMatch(/^person_account_/)
      expect(count(connection, 'people')).toBe(1)
      expect(count(connection, 'person_accounts')).toBe(1)
      expect(count(connection, 'person_contacts')).toBe(1)
      expect(
        connection.sqlite
          .prepare('select kind, normalized_value as normalizedValue, verified_at as verifiedAt from person_contacts')
          .get()
      ).toEqual({
        kind: 'phone',
        normalizedValue: '+14155550123',
        verifiedAt: observedAt.toISOString()
      })
    })
  })

  it('collapses an unreferenced phone-only person into one unique Stripe-backed email person', () => {
    withDatabase((connection) => {
      const phone = '+14155550124'
      const placeholder = temporaryPhoneEmail(reviewHashKey, phone)
      insertUser(connection, {
        email: placeholder,
        emailVerified: false,
        id: 'user-phone-stripe',
        phoneNumber: phone,
        phoneNumberVerified: true
      })
      const phoneIdentity = ensureWebsiteAccountIdentity(
        connection,
        {
          email: placeholder,
          emailVerified: false,
          id: 'user-phone-stripe',
          phoneNumber: phone,
          phoneNumberVerified: true
        },
        { observedAt, reviewHashKey, stripePrices }
      )
      insertPerson(connection, 'person-stripe-phone-claim')
      insertContact(connection, {
        id: 'contact-stripe-phone-claim',
        kind: 'email',
        personId: 'person-stripe-phone-claim',
        value: 'phone.member@example.test',
        verifiedAt: null
      })
      insertProviderIdentity(connection, {
        externalId: 'cus_phone_claim',
        id: 'identity-stripe-phone-claim',
        personId: 'person-stripe-phone-claim',
        provider: 'stripe'
      })
      insertImportedActiveSubscription(connection, {
        customerId: 'cus_phone_claim',
        personId: 'person-stripe-phone-claim',
        priceId: stripePrices['personal.monthly'],
        subscriptionId: 'sub_phone_claim'
      })
      connection.sqlite
        .prepare('update user set email = ?, email_verified = 1 where id = ?')
        .run('phone.member@example.test', 'user-phone-stripe')

      const account = {
        email: 'phone.member@example.test',
        emailVerified: true,
        id: 'user-phone-stripe',
        phoneNumber: phone,
        phoneNumberVerified: true
      }
      expect(ensureWebsiteAccountIdentity(connection, account, { observedAt, reviewHashKey, stripePrices })).toEqual({
        personId: 'person-stripe-phone-claim',
        reviewCreated: false,
        reviewReason: null
      })
      expect(ensureWebsiteAccountIdentity(connection, account, { observedAt, reviewHashKey, stripePrices })).toEqual({
        personId: 'person-stripe-phone-claim',
        reviewCreated: false,
        reviewReason: null
      })
      expect(count(connection, 'people')).toBe(1)
      expect(
        connection.sqlite.prepare('select person_id as personId from person_accounts where user_id = ?').get(account.id)
      ).toEqual({ personId: 'person-stripe-phone-claim' })
      expect(connection.sqlite.prepare('select 1 from people where id = ?').get(phoneIdentity.personId)).toBeUndefined()
      expect(
        connection.sqlite.prepare('select kind, normalized_value as value from person_contacts order by kind').all()
      ).toEqual([
        { kind: 'email', value: 'phone.member@example.test' },
        { kind: 'phone', value: phone }
      ])
      expect(
        connection.sqlite.prepare('select stripe_subscription_id as subscriptionId from billing_subscriptions').get()
      ).toEqual({ subscriptionId: 'sub_phone_claim' })
      expect(count(connection, 'identity_link_reviews')).toBe(0)
    })
  })

  it('rolls back a phone-only collapse when imported and projected Stripe billing conflict', () => {
    withDatabase((connection) => {
      const phone = '+14155550128'
      const placeholder = temporaryPhoneEmail(reviewHashKey, phone)
      const userId = 'user-phone-billing-conflict'
      insertUser(connection, {
        email: placeholder,
        emailVerified: false,
        id: userId,
        phoneNumber: phone,
        phoneNumberVerified: true
      })
      const phoneIdentity = ensureWebsiteAccountIdentity(
        connection,
        {
          email: placeholder,
          emailVerified: false,
          id: userId,
          phoneNumber: phone,
          phoneNumberVerified: true
        },
        { observedAt, reviewHashKey, stripePrices }
      )
      connection.sqlite
        .prepare(
          `insert into billing_customers (id, purchaser_user_id, stripe_customer_id)
           values ('billing_customer_new', ?, 'cus_new')`
        )
        .run(userId)
      connection.sqlite
        .prepare(
          `insert into billing_subscriptions (
             id, purchaser_user_id, billing_customer_id, stripe_subscription_id,
             stripe_subscription_item_id, status, plan_key, cadence, stripe_price_id,
             current_period_start, current_period_end, last_verified_at
           ) values (
             'billing_subscription_new', ?, 'billing_customer_new', 'sub_new',
             'si_new', 'active', 'personal', 'monthly', ?,
             '2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', ?
           )`
        )
        .run(userId, stripePrices['personal.monthly'], observedAt.toISOString())

      insertPerson(connection, 'person-stripe-billing-conflict')
      insertContact(connection, {
        id: 'contact-stripe-billing-conflict',
        kind: 'email',
        personId: 'person-stripe-billing-conflict',
        value: 'billing.conflict@example.test',
        verifiedAt: null
      })
      insertProviderIdentity(connection, {
        externalId: 'cus_existing',
        id: 'identity-stripe-billing-conflict',
        personId: 'person-stripe-billing-conflict',
        provider: 'stripe'
      })
      insertImportedActiveSubscription(connection, {
        customerId: 'cus_existing',
        personId: 'person-stripe-billing-conflict',
        priceId: stripePrices['personal.monthly'],
        subscriptionId: 'sub_existing'
      })
      connection.sqlite
        .prepare('update user set email = ?, email_verified = 1 where id = ?')
        .run('billing.conflict@example.test', userId)

      expect(
        ensureWebsiteAccountIdentity(
          connection,
          {
            email: 'billing.conflict@example.test',
            emailVerified: true,
            id: userId,
            phoneNumber: phone,
            phoneNumberVerified: true
          },
          { observedAt, reviewHashKey, stripePrices }
        )
      ).toEqual({
        personId: phoneIdentity.personId,
        reviewCreated: true,
        reviewReason: 'conflicting_verified_identifiers'
      })
      expect(count(connection, 'people')).toBe(2)
      expect(
        connection.sqlite.prepare('select person_id as personId from person_accounts where user_id = ?').get(userId)
      ).toEqual({ personId: phoneIdentity.personId })
      expect(connection.sqlite.prepare('select id from people where id = ?').get(phoneIdentity.personId)).toEqual({
        id: phoneIdentity.personId
      })
      expect(connection.sqlite.prepare('select stripe_customer_id as customerId from billing_customers').all()).toEqual(
        [{ customerId: 'cus_new' }]
      )
      expect(
        connection.sqlite.prepare('select stripe_subscription_id as subscriptionId from billing_subscriptions').all()
      ).toEqual([{ subscriptionId: 'sub_new' }])
      const review = connection.sqlite
        .prepare('select identifier_hash as identifierHash, reason from identity_link_reviews')
        .get() as { identifierHash: string; reason: string }
      expect(review.reason).toBe('conflicting_verified_identifiers')
      expect(review.identifierHash).toMatch(/^[a-f0-9]{64}$/)
      expect(JSON.stringify(review)).not.toContain('cus_existing')
    })
  })

  it('does not collapse a phone-only person when another website account has the normalized email', () => {
    withDatabase((connection) => {
      const phone = '+14155550126'
      const placeholder = temporaryPhoneEmail(reviewHashKey, phone)
      insertUser(connection, {
        email: placeholder,
        emailVerified: false,
        id: 'user-phone-email-conflict',
        phoneNumber: phone,
        phoneNumberVerified: true
      })
      const phoneIdentity = ensureWebsiteAccountIdentity(
        connection,
        {
          email: placeholder,
          emailVerified: false,
          id: 'user-phone-email-conflict',
          phoneNumber: phone,
          phoneNumberVerified: true
        },
        { observedAt, reviewHashKey }
      )
      insertPerson(connection, 'person-email-conflict-target')
      insertContact(connection, {
        id: 'contact-email-conflict-target',
        kind: 'email',
        personId: 'person-email-conflict-target',
        value: 'claim@example.test',
        verifiedAt: observedAt.toISOString()
      })
      insertUser(connection, {
        email: 'CLAIM@example.test',
        emailVerified: true,
        id: 'user-normalized-email-owner'
      })
      connection.sqlite
        .prepare('update user set email = ?, email_verified = 1 where id = ?')
        .run('claim@example.test', 'user-phone-email-conflict')

      expect(
        ensureWebsiteAccountIdentity(
          connection,
          {
            email: 'claim@example.test',
            emailVerified: true,
            id: 'user-phone-email-conflict',
            phoneNumber: phone,
            phoneNumberVerified: true
          },
          { observedAt, reviewHashKey }
        )
      ).toMatchObject({
        personId: phoneIdentity.personId,
        reviewCreated: true,
        reviewReason: 'conflicting_verified_email'
      })
      expect(count(connection, 'people')).toBe(2)
      expect(
        connection.sqlite
          .prepare('select person_id as personId from person_accounts where user_id = ?')
          .get('user-phone-email-conflict')
      ).toEqual({ personId: phoneIdentity.personId })
      expect(connection.sqlite.prepare('select id from people where id = ?').get(phoneIdentity.personId)).toEqual({
        id: phoneIdentity.personId
      })
    })
  })

  it('does not collapse a phone-only person when a different canonical person owns the phone', () => {
    withDatabase((connection) => {
      const phone = '+14155550127'
      const placeholder = temporaryPhoneEmail(reviewHashKey, phone)
      insertUser(connection, {
        email: placeholder,
        emailVerified: false,
        id: 'user-phone-canonical-conflict',
        phoneNumber: phone,
        phoneNumberVerified: true
      })
      const phoneIdentity = ensureWebsiteAccountIdentity(
        connection,
        {
          email: placeholder,
          emailVerified: false,
          id: 'user-phone-canonical-conflict',
          phoneNumber: phone,
          phoneNumberVerified: true
        },
        { observedAt, reviewHashKey }
      )
      insertPerson(connection, 'person-email-target-with-phone-conflict')
      insertContact(connection, {
        id: 'contact-email-target-with-phone-conflict',
        kind: 'email',
        personId: 'person-email-target-with-phone-conflict',
        value: 'phone-conflict@example.test',
        verifiedAt: observedAt.toISOString()
      })
      insertPerson(connection, 'person-competing-phone')
      insertContact(connection, {
        id: 'contact-competing-phone',
        kind: 'phone',
        personId: 'person-competing-phone',
        value: phone,
        verifiedAt: observedAt.toISOString()
      })
      connection.sqlite
        .prepare('update user set email = ?, email_verified = 1 where id = ?')
        .run('phone-conflict@example.test', 'user-phone-canonical-conflict')

      expect(
        ensureWebsiteAccountIdentity(
          connection,
          {
            email: 'phone-conflict@example.test',
            emailVerified: true,
            id: 'user-phone-canonical-conflict',
            phoneNumber: phone,
            phoneNumberVerified: true
          },
          { observedAt, reviewHashKey }
        )
      ).toMatchObject({
        personId: phoneIdentity.personId,
        reviewCreated: true
      })
      expect(count(connection, 'people')).toBe(3)
      expect(
        connection.sqlite
          .prepare('select person_id as personId from person_accounts where user_id = ?')
          .get('user-phone-canonical-conflict')
      ).toEqual({ personId: phoneIdentity.personId })
      expect(connection.sqlite.prepare('select id from people where id = ?').get(phoneIdentity.personId)).toEqual({
        id: phoneIdentity.personId
      })
    })
  })

  it('keeps and reviews a phone-only person that has another canonical reference', () => {
    withDatabase((connection) => {
      const phone = '+14155550125'
      const placeholder = temporaryPhoneEmail(reviewHashKey, phone)
      insertUser(connection, {
        email: placeholder,
        emailVerified: false,
        id: 'user-phone-referenced',
        phoneNumber: phone,
        phoneNumberVerified: true
      })
      const phoneIdentity = ensureWebsiteAccountIdentity(
        connection,
        {
          email: placeholder,
          emailVerified: false,
          id: 'user-phone-referenced',
          phoneNumber: phone,
          phoneNumberVerified: true
        },
        { observedAt, reviewHashKey }
      )
      insertPerson(connection, 'person-email-target')
      insertContact(connection, {
        id: 'contact-email-target',
        kind: 'email',
        personId: 'person-email-target',
        value: 'referenced@example.test',
        verifiedAt: observedAt.toISOString()
      })
      connection.sqlite
        .prepare('insert into stripe_customers (id, person_id) values (?, ?)')
        .run('cus_source_reference', phoneIdentity.personId)
      connection.sqlite
        .prepare('update user set email = ?, email_verified = 1 where id = ?')
        .run('referenced@example.test', 'user-phone-referenced')

      expect(
        ensureWebsiteAccountIdentity(
          connection,
          {
            email: 'referenced@example.test',
            emailVerified: true,
            id: 'user-phone-referenced',
            phoneNumber: phone,
            phoneNumberVerified: true
          },
          { observedAt, reviewHashKey }
        )
      ).toEqual({
        personId: phoneIdentity.personId,
        reviewCreated: true,
        reviewReason: 'conflicting_verified_email'
      })
      expect(count(connection, 'people')).toBe(2)
      expect(
        connection.sqlite
          .prepare('select person_id as personId from person_accounts where user_id = ?')
          .get('user-phone-referenced')
      ).toEqual({ personId: phoneIdentity.personId })
      expect(count(connection, 'identity_link_reviews')).toBe(1)
    })
  })

  it('creates an email-only Supporter identity and adds a later verified phone without another person', () => {
    withDatabase((connection) => {
      insertUser(connection, {
        email: 'free@example.test',
        emailVerified: true,
        id: 'user-free'
      })

      const first = ensureWebsiteAccountIdentity(
        connection,
        {
          email: 'free@example.test',
          emailVerified: true,
          id: 'user-free'
        },
        { observedAt, reviewHashKey }
      )
      const updated = ensureWebsiteAccountIdentity(
        connection,
        {
          email: 'free@example.test',
          emailVerified: true,
          id: 'user-free',
          phoneNumber: '+12065550123',
          phoneNumberVerified: true
        },
        { observedAt, reviewHashKey }
      )

      expect(updated.personId).toBe(first.personId)
      expect(count(connection, 'people')).toBe(1)
      expect(count(connection, 'person_accounts')).toBe(1)
      expect(connection.sqlite.prepare('select kind from person_contacts order by kind').all()).toEqual([
        { kind: 'email' },
        { kind: 'phone' }
      ])
    })
  })

  it('fails closed on a shared Stripe billing email and stores only a keyed identifier hash', () => {
    withDatabase((connection) => {
      insertUser(connection, {
        email: 'shared@example.test',
        emailVerified: true,
        id: 'user-shared'
      })
      for (const suffix of ['a', 'b']) {
        const personId = `person-${suffix}`
        insertPerson(connection, personId)
        insertContact(connection, {
          id: `contact-${suffix}`,
          kind: 'email',
          personId,
          value: 'shared@example.test',
          verifiedAt: null
        })
        insertProviderIdentity(connection, {
          externalId: `cus_${suffix}`,
          id: `identity-${suffix}`,
          personId,
          provider: 'stripe'
        })
      }
      const account = {
        email: 'shared@example.test',
        emailVerified: true,
        id: 'user-shared'
      }

      expect(ensureWebsiteAccountIdentity(connection, account, { observedAt, reviewHashKey })).toEqual({
        personId: null,
        reviewCreated: true,
        reviewReason: 'ambiguous_verified_email'
      })
      expect(ensureWebsiteAccountIdentity(connection, account, { observedAt, reviewHashKey })).toEqual({
        personId: null,
        reviewCreated: false,
        reviewReason: 'ambiguous_verified_email'
      })
      expect(count(connection, 'people')).toBe(2)
      expect(count(connection, 'person_accounts')).toBe(0)
      expect(count(connection, 'identity_link_reviews')).toBe(1)
      const review = connection.sqlite
        .prepare('select id, identifier_hash as identifierHash, reason, status from identity_link_reviews')
        .get() as { id: string; identifierHash: string; reason: string; status: string }
      expect(review).toMatchObject({ reason: 'ambiguous_verified_email', status: 'open' })
      expect(review.identifierHash).toMatch(/^[0-9a-f]{64}$/)
      expect(JSON.stringify(review)).not.toContain('shared@example.test')
      expect(count(connection, 'job_queue')).toBe(1)
      expect(connection.sqlite.prepare('select payload, status, type from job_queue').get()).toEqual({
        payload: JSON.stringify({ reviewId: review.id }),
        status: 'queued',
        type: 'identity.review-notification'
      })

      resolveIdentityLinkReview(connection, {
        personId: 'person-a',
        resolvedAt: observedAt,
        reviewId: review.id
      })
      expect(ensureWebsiteAccountIdentity(connection, account, { observedAt, reviewHashKey })).toEqual({
        personId: 'person-a',
        reviewCreated: false,
        reviewReason: null
      })
      expect(count(connection, 'people')).toBe(2)
      expect(count(connection, 'person_accounts')).toBe(1)
      expect(count(connection, 'identity_link_reviews')).toBe(1)
      expect(count(connection, 'job_queue')).toBe(1)
    })
  })

  it('does not use a verified phone alone to claim an existing canonical person', () => {
    withDatabase((connection) => {
      const email = temporaryPhoneEmail(reviewHashKey, '+13105550123')
      insertUser(connection, {
        email,
        emailVerified: false,
        id: 'user-phone-claim',
        phoneNumber: '+13105550123',
        phoneNumberVerified: true
      })
      insertPerson(connection, 'person-existing-phone')
      insertContact(connection, {
        id: 'contact-existing-phone',
        kind: 'phone',
        personId: 'person-existing-phone',
        value: '+13105550123',
        verifiedAt: observedAt.toISOString()
      })

      expect(
        ensureWebsiteAccountIdentity(
          connection,
          {
            email,
            emailVerified: false,
            id: 'user-phone-claim',
            phoneNumber: '+13105550123',
            phoneNumberVerified: true
          },
          { observedAt, reviewHashKey }
        )
      ).toEqual({
        personId: null,
        reviewCreated: true,
        reviewReason: 'phone_match_requires_verified_email'
      })
      expect(count(connection, 'people')).toBe(1)
      expect(count(connection, 'person_accounts')).toBe(0)
    })
  })

  it('does not choose between a Stripe email match and a different verified-phone match', () => {
    withDatabase((connection) => {
      insertUser(connection, {
        email: 'conflict@example.test',
        emailVerified: true,
        id: 'user-conflict',
        phoneNumber: '+12135550123',
        phoneNumberVerified: true
      })
      insertPerson(connection, 'person-email')
      insertContact(connection, {
        id: 'contact-email',
        kind: 'email',
        personId: 'person-email',
        value: 'conflict@example.test',
        verifiedAt: null
      })
      insertProviderIdentity(connection, {
        externalId: 'cus_email',
        id: 'identity-email',
        personId: 'person-email',
        provider: 'stripe'
      })
      insertPerson(connection, 'person-phone')
      insertContact(connection, {
        id: 'contact-phone',
        kind: 'phone',
        personId: 'person-phone',
        value: '+12135550123',
        verifiedAt: observedAt.toISOString()
      })

      expect(
        ensureWebsiteAccountIdentity(
          connection,
          {
            email: 'conflict@example.test',
            emailVerified: true,
            id: 'user-conflict',
            phoneNumber: '+12135550123',
            phoneNumberVerified: true
          },
          { observedAt, reviewHashKey }
        )
      ).toEqual({
        personId: null,
        reviewCreated: true,
        reviewReason: 'conflicting_verified_identifiers'
      })
      expect(count(connection, 'people')).toBe(2)
      expect(count(connection, 'person_accounts')).toBe(0)
    })
  })

  it('keeps an existing website linkage when a newly verified contact conflicts', () => {
    withDatabase((connection) => {
      insertUser(connection, {
        email: 'linked@example.test',
        emailVerified: true,
        id: 'user-linked',
        phoneNumber: '+14155550999',
        phoneNumberVerified: true
      })
      insertPerson(connection, 'person-linked')
      linkAccount(connection, 'person-linked', 'user-linked')
      insertPerson(connection, 'person-other')
      insertContact(connection, {
        id: 'contact-other-phone',
        kind: 'phone',
        personId: 'person-other',
        value: '+14155550999',
        verifiedAt: observedAt.toISOString()
      })

      expect(
        ensureWebsiteAccountIdentity(
          connection,
          {
            email: 'linked@example.test',
            emailVerified: true,
            id: 'user-linked',
            phoneNumber: '+14155550999',
            phoneNumberVerified: true
          },
          { observedAt, reviewHashKey }
        )
      ).toEqual({
        personId: 'person-linked',
        reviewCreated: true,
        reviewReason: 'conflicting_verified_identifiers'
      })
      expect(count(connection, 'people')).toBe(2)
      expect(count(connection, 'person_accounts')).toBe(1)
      expect(
        connection.sqlite
          .prepare("select person_id as personId from person_accounts where user_id = 'user-linked'")
          .get()
      ).toEqual({ personId: 'person-linked' })
    })
  })

  it('refuses a normalized email already verified by a different website account', () => {
    withDatabase((connection) => {
      insertUser(connection, {
        email: 'Member@Example.test',
        emailVerified: true,
        id: 'user-existing'
      })
      insertUser(connection, {
        email: 'member@example.test',
        emailVerified: true,
        id: 'user-new'
      })

      expect(
        ensureWebsiteAccountIdentity(
          connection,
          {
            email: 'member@example.test',
            emailVerified: true,
            id: 'user-new'
          },
          { observedAt, reviewHashKey }
        )
      ).toEqual({
        personId: null,
        reviewCreated: true,
        reviewReason: 'conflicting_verified_email'
      })
      expect(count(connection, 'people')).toBe(0)
      expect(count(connection, 'person_accounts')).toBe(0)
    })
  })

  it('sends privacy-safe review notifications through the durable job handler and skips resolved work', async () => {
    await withDatabaseAsync(async (connection) => {
      insertUser(connection, {
        email: 'reviewer@example.test',
        emailVerified: true,
        id: 'user-review'
      })
      insertPerson(connection, 'person-review')
      const reviewId = 'identity_review_12345678-1234-4234-8234-123456789abc'
      connection.sqlite
        .prepare(
          `insert into identity_link_reviews
             (id, user_id, reason, identifier_hash, status)
           values (?, 'user-review', 'ambiguous_verified_email', ?, 'open')`
        )
        .run(reviewId, 'a'.repeat(64))
      const messages: Array<{ idempotencyKey?: string; text: string; to: string }> = []
      const handler = createIdentityReviewNotificationHandler({
        appName: 'Working Class Unity',
        connection,
        sender: {
          async send(message) {
            messages.push(message)
          }
        }
      })

      await handler({ reviewId })
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({
        idempotencyKey: `identity-review-${reviewId}`,
        to: 'info@workingclassunity.com'
      })
      expect(messages[0]!.text).toContain(reviewId)
      expect(messages[0]!.text).not.toContain('reviewer@example.test')

      resolveIdentityLinkReview(connection, {
        personId: 'person-review',
        resolvedAt: observedAt,
        reviewId
      })
      await handler({ reviewId })
      expect(messages).toHaveLength(1)
      await expect(handler({ reviewId: 'private@example.test' })).rejects.toThrow(
        'Invalid identity review notification payload'
      )
    })
  })

  it('refuses manual resolution when the selected person already belongs to another account', () => {
    withDatabase((connection) => {
      insertUser(connection, {
        email: 'review@example.test',
        emailVerified: true,
        id: 'user-review'
      })
      insertUser(connection, {
        email: 'owner@example.test',
        emailVerified: true,
        id: 'user-owner'
      })
      insertPerson(connection, 'person-owned')
      linkAccount(connection, 'person-owned', 'user-owner')
      const reviewId = 'identity_review_abcdefab-cdef-4abc-8def-abcdefabcdef'
      connection.sqlite
        .prepare(
          `insert into identity_link_reviews
             (id, user_id, reason, identifier_hash, status)
           values (?, 'user-review', 'conflicting_verified_email', ?, 'open')`
        )
        .run(reviewId, 'b'.repeat(64))

      expect(() =>
        resolveIdentityLinkReview(connection, {
          personId: 'person-owned',
          resolvedAt: observedAt,
          reviewId
        })
      ).toThrow(IdentityReviewResolutionError)
      expect(connection.sqlite.prepare('select status from identity_link_reviews where id = ?').get(reviewId)).toEqual({
        status: 'open'
      })
      expect(count(connection, 'person_accounts')).toBe(1)
    })
  })
})

function withDatabase(run: (connection: DatabaseConnection) => void): void {
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

async function withDatabaseAsync(run: (connection: DatabaseConnection) => Promise<void>): Promise<void> {
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

function insertUser(
  connection: DatabaseConnection,
  input: {
    email: string
    emailVerified: boolean
    id: string
    phoneNumber?: string
    phoneNumberVerified?: boolean
  }
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

function insertPerson(connection: DatabaseConnection, id: string): void {
  connection.sqlite.prepare('insert into people (id) values (?)').run(id)
}

function insertContact(
  connection: DatabaseConnection,
  input: {
    id: string
    kind: 'email' | 'phone'
    personId: string
    value: string
    verifiedAt: string | null
  }
): void {
  connection.sqlite
    .prepare(
      `insert into person_contacts
         (id, person_id, kind, value, normalized_value, is_primary, verified_at)
       values (?, ?, ?, ?, ?, 1, ?)`
    )
    .run(input.id, input.personId, input.kind, input.value, input.value.toLowerCase(), input.verifiedAt)
}

function insertProviderIdentity(
  connection: DatabaseConnection,
  input: {
    externalId: string
    id: string
    personId: string
    provider: 'stripe' | 'solidarity'
  }
): void {
  connection.sqlite
    .prepare(
      `insert into provider_identities
         (id, person_id, provider, external_id, state, linked_at)
       values (?, ?, ?, ?, 'active', ?)`
    )
    .run(input.id, input.personId, input.provider, input.externalId, observedAt.toISOString())
}

function insertImportedActiveSubscription(
  connection: DatabaseConnection,
  input: { customerId: string; personId: string; priceId: string; subscriptionId: string }
): void {
  connection.sqlite
    .prepare("insert into stripe_products (id, name, active) values ('prod_membership', 'Membership dues', 1)")
    .run()
  connection.sqlite
    .prepare(
      `insert into stripe_prices
         (id, product_id, active, currency, unit_amount, recurring_interval, recurring_interval_count)
       values (?, 'prod_membership', 1, 'USD', 1000, 'month', 1)`
    )
    .run(input.priceId)
  connection.sqlite
    .prepare('insert into stripe_customers (id, person_id) values (?, ?)')
    .run(input.customerId, input.personId)
  connection.sqlite
    .prepare(
      `insert into stripe_subscriptions
         (id, customer_id, status, current_period_start, current_period_end)
       values (?, ?, 'active', '2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`
    )
    .run(input.subscriptionId, input.customerId)
  connection.sqlite
    .prepare('insert into stripe_subscription_items (id, subscription_id, price_id) values (?, ?, ?)')
    .run(`si_${input.subscriptionId}`, input.subscriptionId, input.priceId)
}

function linkAccount(connection: DatabaseConnection, personId: string, userId: string): void {
  connection.sqlite
    .prepare('insert into person_accounts (person_id, user_id, linked_at) values (?, ?, ?)')
    .run(personId, userId, observedAt.toISOString())
}

function count(
  connection: DatabaseConnection,
  table: 'identity_link_reviews' | 'job_queue' | 'people' | 'person_accounts' | 'person_contacts'
): number {
  return (connection.sqlite.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count
}
