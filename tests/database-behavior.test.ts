import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))

describe('event database integrity', () => {
  it('rejects unsupported categories, audiences, occurrence states, and invalid intervals', () => {
    withDatabase((sqlite) => {
      sqlite.exec("insert into events (id, title, kind) values ('event', 'Community meeting', 'meeting')")
      sqlite.exec(
        "insert into event_sessions (id, event_id, starts_at, timezone) values ('session', 'event', '2026-09-01T19:00:00.000Z', 'America/Los_Angeles')"
      )
      for (const statement of [
        "update events set kind = 'canvass'",
        "update events set visibility = 'everyone'",
        "update events set title = ' '",
        "update events set event_page_url = 'http://example.test'",
        "update event_sessions set status = 'unknown'",
        "update event_sessions set delivery_mode = 'all'",
        "update event_sessions set starts_at = 'yesterday'",
        "update event_sessions set ends_at = '2026-09-01T18:00:00.000Z'",
        "update event_sessions set rsvp_url = 'javascript:alert(1)'"
      ]) {
        expect(() => sqlite.exec(statement), statement).toThrow(/CHECK constraint failed/)
      }
      expect(() => sqlite.exec("delete from events where id = 'event'")).toThrow(/FOREIGN KEY constraint failed/)
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
    })
  })

  it('restricts provenance to Solidarity event metadata and preserves it while referenced', () => {
    withDatabase((sqlite) => {
      expect(() =>
        sqlite.exec("insert into import_batches (id, provider, started_at) values ('wrong', 'stripe', '2026-09-01')")
      ).toThrow(/CHECK constraint failed/)
      sqlite.exec("insert into import_batches (id, provider, started_at) values ('batch', 'solidarity', '2026-09-01')")
      const insert = sqlite.prepare(
        "insert into external_record_snapshots (id, import_batch_id, object_type, external_id, observed_at, payload_hash, raw_payload) values (?, 'batch', ?, 'external', '2026-09-01', '0123456789abcdef', ?)"
      )
      expect(() => insert.run('person', 'solidarity.person', '{}')).toThrow(/CHECK constraint failed/)
      expect(() => insert.run('array', 'solidarity.event', '[]')).toThrow(/CHECK constraint failed/)
      insert.run('snapshot', 'solidarity.event', '{}')
      sqlite.exec(
        "insert into events (id, title, kind, source_snapshot_id) values ('event', 'Community meeting', 'meeting', 'snapshot')"
      )
      expect(() => sqlite.exec('delete from external_record_snapshots')).toThrow(/FOREIGN KEY constraint failed/)
      expect(() => sqlite.exec('delete from import_batches')).toThrow(/FOREIGN KEY constraint failed/)
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
    })
  })

  it('creates only event tables and repeats migrations without changing data', () => {
    withDatabase((sqlite) => {
      sqlite.exec("insert into events (id, title, kind) values ('kept', 'Community meeting', 'meeting')")
      const ledger = sqlite.prepare('select * from __drizzle_migrations').all()
      migrate(drizzle(sqlite), { migrationsFolder })
      expect(sqlite.prepare('select * from __drizzle_migrations').all()).toEqual(ledger)
      expect(sqlite.prepare('select id from events').all()).toEqual([{ id: 'kept' }])
      expect(
        sqlite
          .prepare(
            "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name <> '__drizzle_migrations' order by name"
          )
          .all()
      ).toEqual(
        [
          'event_provider_links',
          'event_session_provider_links',
          'event_sessions',
          'event_tags',
          'events',
          'external_record_snapshots',
          'import_batches'
        ].map((name) => ({ name }))
      )
    })
  })
})

function withDatabase(run: (sqlite: Database.Database) => void) {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  try {
    migrate(drizzle(sqlite), { migrationsFolder })
    run(sqlite)
  } finally {
    sqlite.close()
  }
}
