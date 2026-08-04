import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { verifySqliteIntegrityAndForeignKeys } from './connect'

const tempDir = mkdtempSync(join(tmpdir(), 'swl-migration-check-'))
const databasePath = join(tempDir, 'app.db')
const migrationsFolder = resolve('server/db/migrations')
const sqlite = new Database(databasePath)
const expectedMigrationTags = [
  '0000_pre_release_baseline',
  '0001_runtime_invariants',
  '0002_stripe_subscription_persistence',
  '0003_stripe_subscription_invariants'
] as const
const rebuiltAuthorityTriggers = [
  'member_external_family_authority_before_insert',
  'member_external_family_authority_before_update',
  'billing_checkout_external_family_authority_before_insert',
  'billing_checkout_external_family_authority_before_update',
  'billing_subscription_external_family_authority_before_insert',
  'billing_subscription_external_family_authority_before_update',
  'member_current_family_manager_authority_before_insert',
  'family_join_open_subscription_correlation_before_update',
  'family_join_open_customer_correlation_before_update'
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

  console.log('Fresh and repeat four-entry migration check passed with 30 runtime triggers.')
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
  const triggerNames = (
    sqlite.prepare("select name from sqlite_master where type = 'trigger' order by name").all() as Array<{
      name: string
    }>
  ).map(({ name }) => name)
  if (triggerNames.length !== 30) {
    fail(`${label} produced ${triggerNames.length} runtime triggers; expected 30.`)
  }
  for (const trigger of rebuiltAuthorityTriggers) {
    if (!triggerNames.includes(trigger)) fail(`${label} did not restore ${trigger}.`)
  }

  for (const table of [
    'billing_subscription_transitions',
    'family_join_attempts',
    'billing_account_deletion_requests'
  ]) {
    const row = sqlite.prepare("select name from sqlite_master where type = 'table' and name = ?").get(table)
    if (!row) fail(`${label} did not create ${table}.`)
  }
  const temporaryTables = sqlite
    .prepare("select name from sqlite_master where type = 'table' and name like '\\_\\_new\\_%' escape '\\'")
    .all()
  if (temporaryTables.length) fail(`${label} retained a generated table-rebuild artifact.`)
}

function fail(message: string): never {
  throw new Error(`Migration check failed: ${message}`)
}
