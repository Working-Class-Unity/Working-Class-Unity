import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { fileURLToPath } from 'node:url'
import { verifySqliteIntegrityAndForeignKeys } from './connect'

const migrationsFolder = fileURLToPath(new URL('./migrations/', import.meta.url))
const sqlite = new Database(':memory:')
const expectedTables = [
  'event_provider_links',
  'event_session_campaign_tags',
  'event_session_provider_links',
  'event_sessions',
  'event_tags',
  'events',
  'external_record_snapshots',
  'import_batches'
]

try {
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle({ client: sqlite })
  migrate(db, { migrationsFolder })
  const firstLedger = sqlite.prepare('select hash, created_at from __drizzle_migrations order by id').all()
  const expectedLedger = readMigrationFiles({ migrationsFolder }).map(({ hash, folderMillis }) => ({
    hash,
    created_at: folderMillis
  }))
  if (JSON.stringify(firstLedger) !== JSON.stringify(expectedLedger)) fail('Migration ledger differs from the package.')

  sqlite.exec(
    "insert into events (id, title, kind, visibility) values ('migration-check', 'Public event', 'social', 'public')"
  )
  migrate(db, { migrationsFolder })
  const secondLedger = sqlite.prepare('select hash, created_at from __drizzle_migrations order by id').all()
  if (JSON.stringify(firstLedger) !== JSON.stringify(secondLedger)) fail('Repeat migration changed the ledger.')
  if (!sqlite.prepare("select 1 from events where id = 'migration-check'").get())
    fail('Repeat migration lost event data.')

  const tables = (
    sqlite
      .prepare(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name <> '__drizzle_migrations' order by name"
      )
      .all() as Array<{ name: string }>
  ).map(({ name }) => name)
  if (JSON.stringify(tables) !== JSON.stringify(expectedTables)) fail('Unexpected application tables.')
  verifySqliteIntegrityAndForeignKeys(sqlite, 'Event-only migration', fail)
  console.log(`Fresh and repeat event-only migrations passed with ${expectedTables.length} application tables.`)
} finally {
  sqlite.close()
}

function fail(message: string): never {
  throw new Error(`Migration check failed: ${message}`)
}
