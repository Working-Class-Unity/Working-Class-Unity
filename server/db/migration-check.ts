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
const expectedMigrationTags = ['0000_wcu_initial'] as const
const expectedRuntimeTables = [
  'account',
  'ai_conversations',
  'ai_generation_attempts',
  'ai_generation_leases',
  'ai_message_file_citations',
  'ai_message_web_citations',
  'ai_messages',
  'ai_usage_buckets',
  'app_settings',
  'billing_account_deletion_requests',
  'billing_checkout_attempts',
  'billing_customers',
  'billing_events',
  'billing_subscription_transitions',
  'billing_subscriptions',
  'detached_billing_subjects',
  'files',
  'job_queue',
  'session',
  'user',
  'verification'
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
  verifySqliteIntegrityAndForeignKeys(sqlite, 'Fresh migration', fail)

  migrate(db, { migrationsFolder })
  const repeatLedger = requireCurrentMigrationLedger('Repeat migration')
  if (JSON.stringify(repeatLedger) !== JSON.stringify(freshLedger)) {
    fail('Repeat migration changed the applied migration ledger.')
  }
  requireCurrentRuntimeSchema('Repeat migration')
  verifySqliteIntegrityAndForeignKeys(sqlite, 'Repeat migration', fail)

  console.log('Fresh and repeat WCU initial migration check passed with 21 tables and 10 Billing triggers.')
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

function fail(message: string): never {
  throw new Error(`Migration check failed: ${message}`)
}
