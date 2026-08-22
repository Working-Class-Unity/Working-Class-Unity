import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type Stripe from 'stripe'
import { describe, expect, it } from 'vitest'
import * as schema from '../server/db/schema/index'
import { importStripeMembershipDataset } from '../server/services/membership/stripe-import'
import {
  fetchStripeMembershipImportDataset,
  type StripeMembershipImportDataset,
  type StripeMembershipImportSource
} from '../server/services/membership/stripe-import-source'

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
type Sqlite = InstanceType<typeof Database>

describe('Stripe membership import', () => {
  it('keeps dry runs local, imports actual dues, and repeats without duplicating normalized records', () => {
    withMigratedDatabase('apply', (sqlite, connection) => {
      sqlite
        .prepare(
          `insert into user (id, name, email, email_verified, created_at, updated_at)
           values ('website-user', 'Website Member', 'member@example.test', 1, 1, 1)`
        )
        .run()
      const dataset = membershipDataset({
        chargeAmount: 100,
        coverageEnd: '2026-09-01T00:00:00.000Z',
        customerId: 'cus_member',
        email: 'MEMBER@example.test',
        refundAmount: 25,
        subscriptionId: 'sub_member',
        subscriptionStartedAt: '2025-08-01T00:00:00.000Z'
      })
      const options = {
        apply: false,
        grandfatheredBefore: new Date('2026-08-22T00:00:00.000Z'),
        observedAt: new Date('2026-08-22T12:00:00.000Z')
      }

      const beforeDryRun = operationalCounts(sqlite)
      const dryRun = importStripeMembershipDataset(connection, dataset, options)
      expect(dryRun.mode).toBe('dry-run')
      expect(dryRun.identities).toEqual({ ambiguous: 0, created: 1, existing: 0 })
      expect(dryRun.memberships).toEqual({ blocked: 0, createdActive: 1, createdPending: 0, existing: 0 })
      expect(operationalCounts(sqlite)).toEqual(beforeDryRun)

      const first = importStripeMembershipDataset(connection, dataset, { ...options, apply: true })
      expect(first.mode).toBe('apply')
      expect(first.revenue).toEqual({ duesCaptured: 100, duesRefunded: 25, netDuesCollected: 75 })
      expect(first.snapshots.changed).toBeGreaterThan(0)
      expect(
        sqlite
          .prepare(
            `select sc.id, pa.user_id as userId, p.display_name as displayName
             from stripe_customers sc
             join people p on p.id = sc.person_id
             join person_accounts pa on pa.person_id = p.id`
          )
          .get()
      ).toEqual({ displayName: 'Example Stripe Member', id: 'cus_member', userId: 'website-user' })
      expect(
        sqlite
          .prepare(
            `select status, applied_at as appliedAt, attendance_requirement_starts_at as attendanceStartsAt
             from memberships`
          )
          .get()
      ).toEqual({
        appliedAt: '2025-08-01T00:00:00.000Z',
        attendanceStartsAt: '2026-08-22T12:00:00.000Z',
        status: 'active'
      })
      expect(
        sqlite
          .prepare(
            `select status, dues_status as duesStatus, attendance_status as attendanceStatus,
               eligibility_status as eligibilityStatus, conduct_status as conductStatus
             from membership_standing_periods where effective_to is null`
          )
          .get()
      ).toEqual({
        attendanceStatus: 'not_applicable',
        conductStatus: 'not_applicable',
        duesStatus: 'met',
        eligibilityStatus: 'not_applicable',
        status: 'good'
      })
      expect(sqlite.prepare('select kind, amount from cash_ledger_entries order by amount desc').all()).toEqual([
        { amount: 100, kind: 'dues' },
        { amount: -25, kind: 'refund' }
      ])
      expect(count(sqlite, 'stripe_disputes')).toBe(1)
      expect(count(sqlite, 'stripe_discount_applications')).toBe(2)
      expect(
        sqlite
          .prepare(
            `select mdp.price_id as priceId
             from membership_dues_prices mdp
             join stripe_subscription_items ssi on ssi.price_id = mdp.price_id`
          )
          .get()
      ).toEqual({ priceId: 'price_membership_10_monthly' })
      const normalizedCounts = operationalCounts(sqlite)

      const second = importStripeMembershipDataset(connection, dataset, { ...options, apply: true })
      expect(second.snapshots).toEqual({ changed: 0, unchanged: first.snapshots.changed })
      expect(operationalCounts(sqlite)).toEqual(normalizedCounts)
      expect(count(sqlite, 'import_batches')).toBe(2)
      expect(sqlite.prepare("select count(*) as count from import_batches where status = 'completed'").get()).toEqual({
        count: 2
      })
    })
  })

  it('moves an imported member through the sixty-day dues grace without ending membership', () => {
    withMigratedDatabase('grace', (sqlite, connection) => {
      const dataset = membershipDataset({
        chargeAmount: 1000,
        coverageEnd: '2026-07-31T00:00:00.000Z',
        customerId: 'cus_grace',
        email: 'grace@example.test',
        refundAmount: 0,
        subscriptionId: 'sub_grace',
        subscriptionStartedAt: '2025-06-01T00:00:00.000Z'
      })
      const grandfatheredBefore = new Date('2026-08-22T00:00:00.000Z')
      importStripeMembershipDataset(connection, dataset, {
        apply: true,
        grandfatheredBefore,
        observedAt: new Date('2026-08-22T12:00:00.000Z')
      })
      expect(
        sqlite
          .prepare(
            `select status, dues_status as duesStatus, grace_ends_at as graceEndsAt
             from membership_standing_periods where effective_to is null`
          )
          .get()
      ).toEqual({ duesStatus: 'unmet', graceEndsAt: '2026-09-29T00:00:00.000Z', status: 'grace' })

      importStripeMembershipDataset(connection, dataset, {
        apply: true,
        grandfatheredBefore,
        observedAt: new Date('2026-10-01T00:00:00.000Z')
      })
      expect(
        sqlite
          .prepare(
            `select status, dues_status as duesStatus, grace_ends_at as graceEndsAt
             from membership_standing_periods where effective_to is null`
          )
          .get()
      ).toEqual({ duesStatus: 'unmet', graceEndsAt: null, status: 'not_good' })
      expect(count(sqlite, 'membership_standing_periods')).toBe(2)
      expect(sqlite.prepare('select status, ended_at as endedAt from memberships').get()).toEqual({
        endedAt: null,
        status: 'active'
      })
    })
  })

  it('leaves shared verified-email collisions unlinked and makes post-cutoff subscribers pending', () => {
    withMigratedDatabase('matching', (sqlite, connection) => {
      for (const [id, name] of [
        ['person-shared-a', 'Shared A'],
        ['person-shared-b', 'Shared B']
      ]) {
        sqlite.prepare('insert into people (id, display_name) values (?, ?)').run(id, name)
        sqlite
          .prepare(
            `insert into person_contacts
               (id, person_id, kind, value, normalized_value, is_primary, verified_at)
             values (?, ?, 'email', 'shared@example.test', 'shared@example.test', 1,
               '2026-01-01T00:00:00.000Z')`
          )
          .run(`contact-${id}`, id)
      }

      const ambiguous = membershipDataset({
        chargeAmount: 1000,
        coverageEnd: '2026-11-01T00:00:00.000Z',
        customerId: 'cus_ambiguous',
        email: 'shared@example.test',
        refundAmount: 0,
        subscriptionId: 'sub_ambiguous',
        subscriptionStartedAt: '2025-01-01T00:00:00.000Z'
      })
      const ambiguousReport = importStripeMembershipDataset(connection, ambiguous, {
        apply: true,
        grandfatheredBefore: new Date('2026-08-22T00:00:00.000Z'),
        observedAt: new Date('2026-10-01T00:00:00.000Z')
      })
      expect(ambiguousReport.identities.ambiguous).toBe(1)
      expect(ambiguousReport.issues.map((value) => value.code)).toContain('ambiguous_verified_email')
      expect(
        sqlite.prepare("select person_id as personId from stripe_customers where id = 'cus_ambiguous'").get()
      ).toEqual({ personId: null })
      expect(
        sqlite
          .prepare("select state from provider_identities where provider = 'stripe' and external_id = 'cus_ambiguous'")
          .get()
      ).toEqual({ state: 'unlinked' })
      expect(count(sqlite, 'memberships')).toBe(0)

      const future = membershipDataset({
        chargeAmount: 1000,
        coverageEnd: '2026-11-01T00:00:00.000Z',
        customerId: 'cus_future',
        email: 'future@example.test',
        refundAmount: 0,
        subscriptionId: 'sub_future',
        subscriptionStartedAt: '2026-09-01T00:00:00.000Z'
      })
      const futureReport = importStripeMembershipDataset(connection, future, {
        apply: true,
        grandfatheredBefore: new Date('2026-08-22T00:00:00.000Z'),
        observedAt: new Date('2026-10-01T00:00:00.000Z')
      })
      expect(futureReport.memberships.createdPending).toBe(1)
      expect(
        sqlite
          .prepare(
            `select m.status, ms.status as standingStatus
             from memberships m join membership_standing_periods ms on ms.membership_id = m.id
             where m.person_id = (select person_id from stripe_customers where id = 'cus_future')`
          )
          .get()
      ).toEqual({ standingStatus: 'pending', status: 'pending' })
    })
  })

  it('does not choose between one canonical person and one unlinked account with the same verified email', () => {
    withMigratedDatabase('person-account-collision', (sqlite, connection) => {
      sqlite.prepare("insert into people (id, display_name) values ('person-shared', 'Shared Person')").run()
      sqlite
        .prepare(
          `insert into person_contacts
             (id, person_id, kind, value, normalized_value, is_primary, verified_at)
           values ('contact-shared', 'person-shared', 'email', 'shared@example.test',
             'shared@example.test', 1, '2026-01-01T00:00:00.000Z')`
        )
        .run()
      sqlite
        .prepare(
          `insert into user (id, name, email, email_verified, created_at, updated_at)
           values ('unlinked-user', 'Unlinked User', 'shared@example.test', 1, 1, 1)`
        )
        .run()
      const dataset = membershipDataset({
        chargeAmount: 1000,
        coverageEnd: '2026-11-01T00:00:00.000Z',
        customerId: 'cus_person_account_collision',
        email: 'shared@example.test',
        refundAmount: 0,
        subscriptionId: 'sub_person_account_collision',
        subscriptionStartedAt: '2025-01-01T00:00:00.000Z'
      })

      const report = importStripeMembershipDataset(connection, dataset, {
        apply: true,
        grandfatheredBefore: new Date('2026-08-22T00:00:00.000Z'),
        observedAt: new Date('2026-10-01T00:00:00.000Z')
      })

      expect(report.identities.ambiguous).toBe(1)
      expect(report.issues.map((value) => value.code)).toContain('ambiguous_verified_email')
      expect(
        sqlite
          .prepare("select person_id as personId from stripe_customers where id = 'cus_person_account_collision'")
          .get()
      ).toEqual({ personId: null })
      expect(count(sqlite, 'person_accounts')).toBe(0)
      expect(count(sqlite, 'memberships')).toBe(0)
    })
  })

  it('creates a new episode when a qualifying subscription starts after an ended membership', () => {
    withMigratedDatabase('rejoin', (sqlite, connection) => {
      sqlite.prepare("insert into people (id, display_name) values ('person-rejoin', 'Rejoining Member')").run()
      sqlite
        .prepare(
          `insert into provider_identities
             (id, person_id, provider, external_id, state, linked_at, last_synced_at)
           values ('identity-rejoin', 'person-rejoin', 'stripe', 'cus_rejoin', 'active',
             '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')`
        )
        .run()
      sqlite
        .prepare(
          `insert into memberships
             (id, person_id, status, applied_at, started_at, ended_at, end_reason)
           values ('membership-ended', 'person-rejoin', 'ended', '2025-01-01T00:00:00.000Z',
             '2025-01-01T00:00:00.000Z', '2026-01-15T00:00:00.000Z', 'resigned')`
        )
        .run()
      const dataset = membershipDataset({
        chargeAmount: 1000,
        coverageEnd: '2026-09-01T00:00:00.000Z',
        customerId: 'cus_rejoin',
        email: 'rejoin@example.test',
        refundAmount: 0,
        subscriptionId: 'sub_rejoin',
        subscriptionStartedAt: '2026-02-01T00:00:00.000Z'
      })

      const report = importStripeMembershipDataset(connection, dataset, {
        apply: true,
        grandfatheredBefore: new Date('2026-08-22T00:00:00.000Z'),
        observedAt: new Date('2026-08-22T12:00:00.000Z')
      })

      expect(report.memberships).toEqual({ blocked: 0, createdActive: 1, createdPending: 0, existing: 0 })
      expect(
        sqlite
          .prepare(
            `select status, applied_at as appliedAt, ended_at as endedAt
             from memberships where person_id = 'person-rejoin' order by applied_at`
          )
          .all()
      ).toEqual([
        { appliedAt: '2025-01-01T00:00:00.000Z', endedAt: '2026-01-15T00:00:00.000Z', status: 'ended' },
        { appliedAt: '2026-02-01T00:00:00.000Z', endedAt: null, status: 'active' }
      ])
      expect(
        sqlite
          .prepare(
            `select subscription_id as subscriptionId
             from membership_dues_subscriptions
             where membership_id <> 'membership-ended'`
          )
          .get()
      ).toEqual({ subscriptionId: 'sub_rejoin' })
    })
  })

  it('rolls normalized data back and records a failed batch when an apply cannot commit', () => {
    withMigratedDatabase('rollback', (sqlite, connection) => {
      sqlite
        .prepare(
          `insert into cash_ledger_entries
             (id, kind, amount, currency, occurred_at, category, description, visibility,
              source_type, source_id, source_component)
           values ('conflicting-ledger-row', 'dues', 1, 'USD', '2026-08-01T00:00:00.000Z',
             'membership_dues', 'Existing source identity', 'members',
             'stripe_charge', 'ch_sub_rollback', 'captured')`
        )
        .run()
      const dataset = membershipDataset({
        chargeAmount: 1000,
        coverageEnd: '2026-09-01T00:00:00.000Z',
        customerId: 'cus_rollback',
        email: 'rollback@example.test',
        refundAmount: 0,
        subscriptionId: 'sub_rollback',
        subscriptionStartedAt: '2025-01-01T00:00:00.000Z'
      })

      expect(() =>
        importStripeMembershipDataset(connection, dataset, {
          apply: true,
          grandfatheredBefore: new Date('2026-08-22T00:00:00.000Z'),
          observedAt: new Date('2026-08-22T12:00:00.000Z')
        })
      ).toThrow(/UNIQUE constraint failed/)
      expect(count(sqlite, 'stripe_customers')).toBe(0)
      expect(count(sqlite, 'external_record_snapshots')).toBe(0)
      expect(sqlite.prepare('select status, record_count as recordCount from import_batches').get()).toEqual({
        recordCount: null,
        status: 'failed'
      })
    })
  })

  it('collects every page through a source surface that exposes no Stripe mutations', async () => {
    const dataset = membershipDataset({
      chargeAmount: 1000,
      coverageEnd: '2026-09-01T00:00:00.000Z',
      customerId: 'cus_pages',
      email: 'pages@example.test',
      refundAmount: 0,
      subscriptionId: 'sub_pages',
      subscriptionStartedAt: '2025-01-01T00:00:00.000Z'
    })
    const calls: string[] = []
    const source: StripeMembershipImportSource = {
      listCharges: () => listed('charges', dataset.charges),
      listCustomers: () => listed('customers', dataset.customers),
      listDisputes: () => listed('disputes', dataset.disputes),
      listInvoiceLines: (id) => listed(`invoice-lines:${id}`, dataset.invoiceLines.get(id) ?? []),
      listInvoicePayments: () => listed('invoice-payments', dataset.invoicePayments),
      listInvoices: () => listed('invoices', dataset.invoices),
      listPrices: () => listed('prices', dataset.prices),
      listProducts: () => listed('products', dataset.products),
      listRefunds: () => listed('refunds', dataset.refunds),
      listSubscriptionItems: (id) => listed(`subscription-items:${id}`, dataset.subscriptionItems.get(id) ?? []),
      listSubscriptions: () => listed('subscriptions', dataset.subscriptions)
    }

    const fetched = await fetchStripeMembershipImportDataset(source)
    expect(fetched.customers).toHaveLength(1)
    expect(fetched.subscriptionItems.get('sub_pages')).toHaveLength(1)
    expect(fetched.invoiceLines.get('in_sub_pages')).toHaveLength(1)
    expect(calls).toEqual([
      'products',
      'prices',
      'customers',
      'subscriptions',
      'subscription-items:sub_pages',
      'invoices',
      'invoice-lines:in_sub_pages',
      'invoice-payments',
      'charges',
      'refunds',
      'disputes'
    ])

    async function* listed<T>(label: string, values: readonly T[]): AsyncIterable<T> {
      calls.push(label)
      for (const value of values) yield value
    }
  })
})

function membershipDataset(input: {
  chargeAmount: number
  coverageEnd: string
  customerId: string
  email: string
  refundAmount: number
  subscriptionId: string
  subscriptionStartedAt: string
}): StripeMembershipImportDataset {
  const productId = 'prod_PhJCFImeXD5okX'
  const priceId = 'price_membership_10_monthly'
  const invoiceId = `in_${input.subscriptionId}`
  const paymentIntentId = `pi_${input.subscriptionId}`
  const chargeId = `ch_${input.subscriptionId}`
  const subscriptionStart = seconds(input.subscriptionStartedAt)
  const periodEnd = seconds(input.coverageEnd)
  const periodStart = periodEnd - 2_678_400
  const discount = stripe<Stripe.Discount>({
    customer: input.customerId,
    deleted: undefined,
    end: null,
    id: `di_${input.subscriptionId}`,
    invoice: null,
    object: 'discount',
    promotion_code: null,
    source: {
      coupon: {
        amount_off: 900,
        currency: 'usd',
        duration: 'forever',
        id: 'coupon-nine-off',
        object: 'coupon',
        percent_off: null
      },
      type: 'coupon'
    },
    start: subscriptionStart,
    subscription: input.subscriptionId,
    subscription_item: null
  })
  const customer = stripe<Stripe.Customer>({
    created: subscriptionStart,
    currency: 'usd',
    email: input.email,
    id: input.customerId,
    name: 'Example Stripe Member',
    object: 'customer',
    phone: '+1 209 555 0100'
  })
  const product = stripe<Stripe.Product>({
    active: true,
    description: 'Working Class Unity membership dues',
    id: productId,
    name: 'Membership Dues',
    object: 'product'
  })
  const price = stripe<Stripe.Price>({
    active: true,
    currency: 'usd',
    id: priceId,
    lookup_key: 'membership-10-1month',
    object: 'price',
    product: productId,
    recurring: { interval: 'month', interval_count: 1 },
    unit_amount: 1000
  })
  const subscription = stripe<Stripe.Subscription>({
    cancel_at: null,
    cancel_at_period_end: false,
    canceled_at: null,
    created: subscriptionStart,
    customer: input.customerId,
    discounts: [discount],
    ended_at: null,
    id: input.subscriptionId,
    object: 'subscription',
    start_date: subscriptionStart,
    status: 'active'
  })
  const subscriptionItem = stripe<Stripe.SubscriptionItem>({
    created: subscriptionStart,
    current_period_end: periodEnd,
    current_period_start: periodStart,
    discounts: [],
    id: `si_${input.subscriptionId}`,
    object: 'subscription_item',
    price,
    quantity: 1,
    subscription: input.subscriptionId
  })
  const invoiceDiscount = stripe<Stripe.Discount>({ ...discount, invoice: invoiceId, subscription: null })
  const invoice = stripe<Stripe.Invoice>({
    amount_due: input.chargeAmount,
    amount_paid: input.chargeAmount,
    amount_remaining: 0,
    created: periodStart,
    currency: 'usd',
    customer: input.customerId,
    discounts: [invoiceDiscount],
    id: invoiceId,
    object: 'invoice',
    parent: {
      quote_details: null,
      subscription_details: { metadata: null, subscription: input.subscriptionId },
      type: 'subscription_details'
    },
    period_end: periodEnd,
    period_start: periodStart,
    status: 'paid',
    status_transitions: { paid_at: periodStart + 60 },
    subtotal: 1000,
    total: input.chargeAmount
  })
  const invoiceLine = stripe<Stripe.InvoiceLineItem>({
    amount: 1000,
    currency: 'usd',
    description: 'Monthly membership dues',
    id: `il_${input.subscriptionId}`,
    object: 'line_item',
    parent: {
      invoice_item_details: null,
      subscription_item_details: {
        invoice_item: null,
        proration: false,
        proration_details: null,
        subscription: input.subscriptionId,
        subscription_item: subscriptionItem.id
      },
      type: 'subscription_item_details'
    },
    period: { end: periodEnd, start: periodStart },
    pricing: {
      price_details: { price: priceId, product: productId },
      type: 'price_details',
      unit_amount_decimal: '1000'
    }
  })
  const invoicePayment = stripe<Stripe.InvoicePayment>({
    id: `ip_${input.subscriptionId}`,
    invoice: invoiceId,
    object: 'invoice_payment',
    payment: { payment_intent: paymentIntentId, type: 'payment_intent' },
    status: 'paid'
  })
  const charge = stripe<Stripe.Charge>({
    amount: input.chargeAmount,
    amount_captured: input.chargeAmount,
    amount_refunded: input.refundAmount,
    created: periodStart + 60,
    currency: 'usd',
    customer: input.customerId,
    disputed: true,
    id: chargeId,
    object: 'charge',
    paid: true,
    payment_intent: paymentIntentId,
    status: 'succeeded'
  })
  const refunds = input.refundAmount
    ? [
        stripe<Stripe.Refund>({
          amount: input.refundAmount,
          charge: chargeId,
          created: periodStart + 120,
          currency: 'usd',
          id: `re_${input.subscriptionId}`,
          object: 'refund',
          reason: 'requested_by_customer',
          status: 'succeeded'
        })
      ]
    : []
  const dispute = stripe<Stripe.Dispute>({
    amount: input.chargeAmount,
    charge: chargeId,
    created: periodStart + 180,
    currency: 'usd',
    id: `dp_${input.subscriptionId}`,
    object: 'dispute',
    reason: 'general',
    status: 'under_review'
  })

  return Object.freeze({
    charges: Object.freeze([charge]),
    customers: Object.freeze([customer]),
    disputes: Object.freeze([dispute]),
    invoiceLines: new Map([[invoiceId, Object.freeze([invoiceLine])]]),
    invoicePayments: Object.freeze([invoicePayment]),
    invoices: Object.freeze([invoice]),
    prices: Object.freeze([price]),
    products: Object.freeze([product]),
    refunds: Object.freeze(refunds),
    subscriptionItems: new Map([[input.subscriptionId, Object.freeze([subscriptionItem])]]),
    subscriptions: Object.freeze([subscription])
  })
}

function withMigratedDatabase(
  label: string,
  run: (sqlite: Sqlite, connection: ReturnType<typeof connectionFor>) => void
): void {
  const directory = mkdtempSync(join(tmpdir(), `wcu-stripe-import-${label}-`))
  const databasePath = join(directory, 'app.db')
  const sqlite = new Database(databasePath)
  try {
    sqlite.pragma('foreign_keys = ON')
    migrate(drizzle({ client: sqlite }), { migrationsFolder })
    run(sqlite, connectionFor(sqlite, databasePath))
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  } finally {
    sqlite.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

function connectionFor(sqlite: Sqlite, databasePath: string) {
  return { databasePath, db: drizzle({ client: sqlite, schema }), sqlite }
}

function operationalCounts(sqlite: Sqlite): Record<string, number> {
  return Object.fromEntries(
    [
      'cash_ledger_entries',
      'external_record_snapshots',
      'memberships',
      'membership_dues_subscriptions',
      'membership_standing_periods',
      'people',
      'person_accounts',
      'person_contacts',
      'provider_identities',
      'stripe_charges',
      'stripe_customers',
      'stripe_discount_applications',
      'stripe_disputes',
      'stripe_invoice_lines',
      'stripe_invoices',
      'stripe_prices',
      'stripe_products',
      'stripe_refunds',
      'stripe_subscription_items',
      'stripe_subscriptions'
    ].map((table) => [table, count(sqlite, table)])
  )
}

function count(sqlite: Sqlite, table: string): number {
  return (sqlite.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count
}

function seconds(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000)
}

function stripe<T>(value: Partial<T>): T {
  return value as T
}
