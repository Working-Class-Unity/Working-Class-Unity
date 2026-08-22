import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { verifySqliteIntegrityAndForeignKeys } from './connect'

const tempDir = mkdtempSync(join(tmpdir(), 'wcu-migration-check-'))
const databasePath = join(tempDir, 'app.db')
const migrationsFolder = resolve('server/db/migrations')
const sqlite = new Database(databasePath)
const expectedMigrationTags = ['0000_wcu_initial', '0001_wcu_account_profile', '0002_membership_operations'] as const
const expectedRuntimeTables = [
  'account',
  'agenda_items',
  'ai_conversations',
  'ai_generation_attempts',
  'ai_generation_leases',
  'ai_message_file_citations',
  'ai_message_web_citations',
  'ai_messages',
  'ai_usage_buckets',
  'app_settings',
  'attendance',
  'attendance_intervals',
  'billing_account_deletion_requests',
  'billing_checkout_attempts',
  'billing_customers',
  'billing_events',
  'billing_subscription_transitions',
  'billing_subscriptions',
  'budget_lines',
  'budgets',
  'cash_ledger_entries',
  'detached_billing_subjects',
  'event_sessions',
  'events',
  'external_record_snapshots',
  'files',
  'import_batches',
  'job_queue',
  'meetings',
  'member_disclosures',
  'membership_attestations',
  'membership_dues_prices',
  'membership_dues_subscriptions',
  'membership_policies',
  'membership_standing_periods',
  'memberships',
  'motion_people',
  'motions',
  'people',
  'person_accounts',
  'person_contacts',
  'provider_identities',
  'quorum_snapshots',
  'recurring_expenses',
  'rsvps',
  'session',
  'stripe_balance_transactions',
  'stripe_charges',
  'stripe_customers',
  'stripe_discount_applications',
  'stripe_disputes',
  'stripe_invoice_lines',
  'stripe_invoices',
  'stripe_payouts',
  'stripe_prices',
  'stripe_products',
  'stripe_refunds',
  'stripe_subscription_items',
  'stripe_subscriptions',
  'user',
  'verification',
  'vote_casts',
  'vote_eligibility_snapshots',
  'vote_options',
  'votes'
] as const
const expectedBillingTriggers = [
  'billing_checkout_customer_purchaser_insert',
  'billing_checkout_customer_purchaser_update',
  'billing_deletion_references_insert',
  'billing_deletion_references_update',
  'billing_subscription_customer_purchaser_insert',
  'billing_subscription_customer_purchaser_update',
  'billing_subscription_offering_reconciliation_insert',
  'billing_subscription_offering_reconciliation_update',
  'billing_transition_subscription_purchaser_insert',
  'billing_transition_subscription_purchaser_update'
] as const

try {
  requireCurrentMigrationPackage()
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle({ client: sqlite })

  migrate(db, { migrationsFolder })
  const freshLedger = requireCurrentMigrationLedger('Fresh migration')
  requireCurrentRuntimeSchema('Fresh migration')
  requireMembershipSeedData('Fresh migration')
  verifySqliteIntegrityAndForeignKeys(sqlite, 'Fresh migration', fail)

  migrate(db, { migrationsFolder })
  const repeatLedger = requireCurrentMigrationLedger('Repeat migration')
  if (JSON.stringify(repeatLedger) !== JSON.stringify(freshLedger)) {
    fail('Repeat migration changed the applied migration ledger.')
  }
  requireCurrentRuntimeSchema('Repeat migration')
  requireMembershipSeedData('Repeat migration')
  verifySqliteIntegrityAndForeignKeys(sqlite, 'Repeat migration', fail)

  console.log('Fresh and repeat WCU migration check passed with 65 tables and 10 Billing triggers.')
} finally {
  sqlite.close()
  rmSync(tempDir, { recursive: true, force: true })
}

function requireCurrentMigrationLedger(label: string) {
  const ledger = sqlite
    .prepare('select hash, created_at as createdAt from __drizzle_migrations order by created_at, id')
    .all() as Array<{ hash: string; createdAt: number }>
  if (ledger.length !== expectedMigrationTags.length) {
    fail(`${label} produced ${ledger.length} migration ledger entries; expected ${expectedMigrationTags.length}.`)
  }
  return ledger
}

function requireCurrentMigrationPackage() {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as {
    entries?: Array<{ tag?: string }>
  }
  const actualTags = journal.entries?.map(({ tag }) => tag) ?? []
  if (JSON.stringify(actualTags) !== JSON.stringify(expectedMigrationTags)) {
    fail(`Migration package is ${JSON.stringify(actualTags)}; expected ${JSON.stringify(expectedMigrationTags)}.`)
  }
}

function requireCurrentRuntimeSchema(label: string) {
  const tableNames = (
    sqlite
      .prepare(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name <> '__drizzle_migrations' order by name"
      )
      .all() as Array<{ name: string }>
  ).map(({ name }) => name)
  if (JSON.stringify(tableNames) !== JSON.stringify(expectedRuntimeTables)) {
    fail(`${label} produced tables ${JSON.stringify(tableNames)}; expected ${JSON.stringify(expectedRuntimeTables)}.`)
  }

  const triggerNames = (
    sqlite.prepare("select name from sqlite_master where type = 'trigger' order by name").all() as Array<{
      name: string
    }>
  ).map(({ name }) => name)
  if (JSON.stringify(triggerNames) !== JSON.stringify(expectedBillingTriggers)) {
    fail(
      `${label} produced triggers ${JSON.stringify(triggerNames)}; expected ${JSON.stringify(expectedBillingTriggers)}.`
    )
  }

  const userColumns = sqlite.prepare("pragma table_info('user')").all() as Array<{
    name: string
    notnull: number
    dflt_value: string | null
  }>
  const roleColumn = userColumns.find(({ name }) => name === 'role')
  if (!roleColumn || roleColumn.notnull !== 1 || roleColumn.dflt_value !== "'user'") {
    fail(`${label} did not create the required default-user role column.`)
  }
  for (const name of ['first_name', 'last_name', 'display_name']) {
    const column = userColumns.find((candidate) => candidate.name === name)
    if (!column || column.notnull !== 0 || column.dflt_value !== null) {
      fail(`${label} did not create nullable user.${name}.`)
    }
  }

  for (const table of [
    'billing_account_deletion_requests',
    'billing_checkout_attempts',
    'billing_customers',
    'billing_subscription_transitions',
    'billing_subscriptions'
  ]) {
    const columns = sqlite.prepare(`pragma table_info('${table}')`).all() as Array<{ name: string }>
    if (!columns.some(({ name }) => name === 'purchaser_user_id')) {
      fail(`${label} did not create ${table}.purchaser_user_id.`)
    }
  }
  const temporaryTables = sqlite
    .prepare("select name from sqlite_master where type = 'table' and name like '\\_\\_new\\_%' escape '\\'")
    .all()
  if (temporaryTables.length) fail(`${label} retained a generated table-rebuild artifact.`)
}

function requireMembershipSeedData(label: string) {
  const policy = sqlite
    .prepare(
      'select effective_from as effectiveFrom, effective_to as effectiveTo, dues_grace_days as duesGraceDays, required_general_meetings as requiredGeneralMeetings, attendance_window_months as attendanceWindowMonths from membership_policies where id = ?'
    )
    .get('wcu-policy-2026-04-02') as
    | {
        effectiveFrom: string
        effectiveTo: string | null
        duesGraceDays: number
        requiredGeneralMeetings: number
        attendanceWindowMonths: number
      }
    | undefined
  if (
    !policy ||
    policy.effectiveFrom !== '2026-04-02T00:00:00.000Z' ||
    policy.effectiveTo !== null ||
    policy.duesGraceDays !== 60 ||
    policy.requiredGeneralMeetings !== 1 ||
    policy.attendanceWindowMonths !== 12
  ) {
    fail(`${label} did not create the adopted WCU membership policy.`)
  }

  const duesPrices = sqlite
    .prepare(
      'select p.id, p.product_id as productId, p.unit_amount as unitAmount, p.currency, p.recurring_interval as recurringInterval, p.recurring_interval_count as recurringIntervalCount from stripe_prices p join membership_dues_prices d on d.price_id = p.id order by p.id'
    )
    .all()
  const expectedDuesPrices = [
    {
      id: 'membership-10-1month',
      productId: 'prod_PhJCFImeXD5okX',
      unitAmount: 1000,
      currency: 'USD',
      recurringInterval: 'month',
      recurringIntervalCount: 1
    },
    {
      id: 'solidarity-27-1month',
      productId: 'prod_PhIiDVN6omCZf0',
      unitAmount: 2700,
      currency: 'USD',
      recurringInterval: 'month',
      recurringIntervalCount: 1
    }
  ]
  if (JSON.stringify(duesPrices) !== JSON.stringify(expectedDuesPrices)) {
    fail(`${label} did not create the two qualifying Stripe dues prices.`)
  }
}

function fail(message: string): never {
  throw new Error(`Migration check failed: ${message}`)
}
