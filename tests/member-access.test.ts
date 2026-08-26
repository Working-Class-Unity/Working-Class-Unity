import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { DatabaseConnection } from '../server/db/connect'
import * as schema from '../server/db/schema'
import { readAccountMembershipState, readWebsiteMembershipAccess } from '../server/services/membership/member-access'
import { isStripeMembershipCancellationScheduled } from '../shared/membership'

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
const now = new Date('2026-08-26T12:00:00.000Z')
const prices = {
  'personal.weekly': '',
  'personal.monthly': 'price_membership_10',
  'personal.annual': '',
  'family.monthly': 'price_solidarity_27',
  'family.annual': ''
} as const

describe('website membership access', () => {
  it.each([
    ['personal', 'price_membership_10', 'personal.monthly'],
    ['family', 'price_solidarity_27', 'family.monthly']
  ] as const)('grants identical rights for the configured %s monthly dues price', (plan, priceId, offering) => {
    withDatabase((connection) => {
      seedAccount(connection, 'member')
      seedBillingSubscription(connection, 'member', { plan, priceId })

      expect(readWebsiteMembershipAccess(connection, 'user-member', prices, now)).toEqual({
        granted: true,
        graceDeadline: null,
        offering,
        source: 'stripe',
        state: 'active'
      })
    })
  })

  it('keeps a failed-payment member active until the exact 60-day deadline', () => {
    withDatabase((connection) => {
      seedAccount(connection, 'grace')
      seedBillingSubscription(connection, 'grace', {
        graceEndsAt: '2026-08-26T12:00:00.000Z',
        graceInvoiceId: 'in_grace',
        graceStartedAt: '2026-06-27T12:00:00.000Z',
        plan: 'personal',
        priceId: 'price_membership_10',
        status: 'past_due'
      })

      expect(
        readWebsiteMembershipAccess(connection, 'user-grace', prices, new Date('2026-08-26T11:59:59.999Z'))
      ).toMatchObject({
        granted: true,
        graceDeadline: '2026-08-26T12:00:00.000Z',
        source: 'stripe',
        state: 'grace'
      })
      expect(readWebsiteMembershipAccess(connection, 'user-grace', prices, now)).toMatchObject({
        granted: false,
        graceDeadline: '2026-08-26T12:00:00.000Z',
        source: 'stripe',
        state: 'suspended'
      })
    })
  })

  it('honors voluntary cancellation through the paid period and denies it at the boundary', () => {
    withDatabase((connection) => {
      seedAccount(connection, 'cancel')
      seedBillingSubscription(connection, 'cancel', {
        cancelAtPeriodEnd: true,
        currentPeriodEnd: '2026-08-26T12:00:00.000Z',
        plan: 'family',
        priceId: 'price_solidarity_27'
      })

      expect(
        readWebsiteMembershipAccess(connection, 'user-cancel', prices, new Date('2026-08-26T11:59:59.999Z')).granted
      ).toBe(true)
      expect(
        isStripeMembershipCancellationScheduled(
          readAccountMembershipState(connection, 'user-cancel', prices, new Date('2026-08-26T11:59:59.999Z'))
        )
      ).toBe(true)
      expect(readWebsiteMembershipAccess(connection, 'user-cancel', prices, now)).toMatchObject({
        granted: false,
        source: 'stripe',
        state: 'reconciliation_required'
      })
    })
  })

  it('fails closed for donations, malformed live billing, and customer-only projections', () => {
    withDatabase((connection) => {
      seedAccount(connection, 'donation')
      seedCanonicalMembership(connection, 'donation')
      seedBillingSubscription(connection, 'donation', {
        plan: 'personal',
        priceId: 'price_donation_monthly'
      })
      seedAccount(connection, 'customer-only')
      seedBillingCustomer(connection, 'customer-only')

      expect(readWebsiteMembershipAccess(connection, 'user-donation', prices, now)).toMatchObject({
        granted: false,
        source: 'stripe',
        state: 'reconciliation_required'
      })
      expect(readWebsiteMembershipAccess(connection, 'user-customer-only', prices, now)).toMatchObject({
        granted: false,
        source: 'stripe',
        state: 'reconciliation_required'
      })
    })
  })

  it('uses canonical membership only when no live Stripe billing projection exists', () => {
    withDatabase((connection) => {
      seedAccount(connection, 'supporter')
      seedAccount(connection, 'historical')
      seedCanonicalMembership(connection, 'historical')

      expect(readWebsiteMembershipAccess(connection, 'user-supporter', prices, now)).toEqual({
        granted: false,
        graceDeadline: null,
        offering: null,
        source: 'supporter',
        state: 'none'
      })
      expect(readWebsiteMembershipAccess(connection, 'user-historical', prices, now)).toEqual({
        granted: true,
        graceDeadline: null,
        offering: null,
        source: 'canonical',
        state: 'active'
      })
      expect(
        isStripeMembershipCancellationScheduled(readAccountMembershipState(connection, 'user-historical', prices, now))
      ).toBe(false)
      expect(readWebsiteMembershipAccess(connection, 'missing-user', prices, now).granted).toBe(false)
    })
  })

  it('publishes Supporter and member account states without legacy plan labels', () => {
    withDatabase((connection) => {
      seedAccount(connection, 'contract-supporter')
      seedAccount(connection, 'contract-member')
      seedBillingSubscription(connection, 'contract-member', {
        plan: 'family',
        priceId: 'price_solidarity_27'
      })

      const supporter = readAccountMembershipState(connection, 'user-contract-supporter', prices, now)
      const member = readAccountMembershipState(connection, 'user-contract-member', prices, now)

      expect(supporter).toMatchObject({ level: 'supporter', access: { granted: false, offering: null } })
      expect(member).toMatchObject({
        level: 'member',
        access: { granted: true, offering: 'family.monthly' },
        billing: { subscription: { offering: 'family.monthly' } }
      })
      expect(member.billing.catalog.map(({ key }) => key)).toEqual(['personal.monthly', 'family.monthly'])
    })
  })

  it('keeps a Supporter from starting another subscription while identity review is pending', () => {
    withDatabase((connection) => {
      seedAccount(connection, 'review-pending')
      connection.sqlite
        .prepare(
          `insert into identity_link_reviews
             (id, user_id, reason, identifier_hash, status)
           values (
             'identity_review_11111111-1111-4111-8111-111111111111',
             'user-review-pending', 'ambiguous_verified_email', ?, 'open'
           )`
        )
        .run('a'.repeat(64))

      expect(readAccountMembershipState(connection, 'user-review-pending', prices, now)).toMatchObject({
        level: 'supporter',
        identityReviewPending: true,
        access: { granted: false },
        billing: { capabilities: { canCheckout: false } }
      })
    })
  })

  it('preserves Stripe management for a member whose identity review is pending', () => {
    withDatabase((connection) => {
      seedAccount(connection, 'member-review-pending')
      seedBillingSubscription(connection, 'member-review-pending', {
        plan: 'personal',
        priceId: 'price_membership_10'
      })
      connection.sqlite
        .prepare(
          `insert into identity_link_reviews
             (id, user_id, reason, identifier_hash, status)
           values (
             'identity_review_33333333-3333-4333-8333-333333333333',
             'user-member-review-pending', 'conflicting_verified_email', ?, 'open'
           )`
        )
        .run('c'.repeat(64))

      expect(readAccountMembershipState(connection, 'user-member-review-pending', prices, now)).toMatchObject({
        level: 'member',
        identityReviewPending: true,
        billing: {
          capabilities: { canChange: true, canCheckout: false, canManage: true, canReconcile: true }
        }
      })
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

function seedAccount(connection: DatabaseConnection, suffix: string): void {
  connection.sqlite
    .prepare(
      `insert into user (id, name, email, email_verified, created_at, updated_at)
       values (?, 'WCU account', ?, 1, 1, 1)`
    )
    .run(`user-${suffix}`, `${suffix}@example.test`)
  connection.sqlite.prepare('insert into people (id) values (?)').run(`person-${suffix}`)
  connection.sqlite
    .prepare('insert into person_accounts (person_id, user_id, linked_at) values (?, ?, ?)')
    .run(`person-${suffix}`, `user-${suffix}`, now.toISOString())
}

function seedBillingCustomer(connection: DatabaseConnection, suffix: string): void {
  connection.sqlite
    .prepare(
      `insert into billing_customers (id, purchaser_user_id, stripe_customer_id)
       values (?, ?, ?)`
    )
    .run(`billing-customer-${suffix}`, `user-${suffix}`, `cus_${suffix}`)
}

function seedBillingSubscription(
  connection: DatabaseConnection,
  suffix: string,
  input: {
    cancelAtPeriodEnd?: boolean
    currentPeriodEnd?: string
    graceEndsAt?: string
    graceInvoiceId?: string
    graceStartedAt?: string
    plan: 'family' | 'personal'
    priceId: string
    status?: 'active' | 'past_due'
  }
): void {
  seedBillingCustomer(connection, suffix)
  connection.sqlite
    .prepare(
      `insert into billing_subscriptions (
         id, purchaser_user_id, billing_customer_id, stripe_subscription_id,
         stripe_subscription_item_id, status, plan_key, cadence, stripe_price_id,
         current_period_start, current_period_end, cancel_at_period_end,
         grace_invoice_id, grace_started_at, grace_ends_at, last_verified_at
       ) values (?, ?, ?, ?, ?, ?, ?, 'monthly', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      `billing-subscription-${suffix}`,
      `user-${suffix}`,
      `billing-customer-${suffix}`,
      `sub_${suffix}`,
      `si_${suffix}`,
      input.status ?? 'active',
      input.plan,
      input.priceId,
      '2026-07-26T12:00:00.000Z',
      input.currentPeriodEnd ?? '2026-09-26T12:00:00.000Z',
      input.cancelAtPeriodEnd ? 1 : 0,
      input.graceInvoiceId ?? null,
      input.graceStartedAt ?? null,
      input.graceEndsAt ?? null,
      now.toISOString()
    )
}

function seedCanonicalMembership(connection: DatabaseConnection, suffix: string): void {
  connection.sqlite
    .prepare(
      `insert into memberships (id, person_id, status, applied_at, started_at)
       values (?, ?, 'active', ?, ?)`
    )
    .run(`membership-${suffix}`, `person-${suffix}`, now.toISOString(), now.toISOString())
}
