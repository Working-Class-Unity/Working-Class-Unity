import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as schema from '../server/db/schema/index'
import { listVisibleCalendarEvents } from '../server/services/events/calendar-read'

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))

describe('public calendar', () => {
  it('reads public occurrences without identities and excludes private, archived, canceled, and out-of-range records', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    try {
      migrate(drizzle({ client: sqlite }), { migrationsFolder })
      const connection = { databasePath: ':memory:', db: drizzle({ client: sqlite, schema }), sqlite }
      sqlite
        .prepare(
          `insert into events (id, title, kind, visibility, status)
           values ('public', 'Public action', 'action', 'public', 'active'),
                  ('members', 'Member meeting', 'meeting', 'members', 'active'),
                  ('member-tagged', 'Member-tagged legacy event', 'meeting', 'public', 'active'),
                  ('hidden', 'Unclassified', 'social', 'hidden', 'active'),
                  ('archived', 'Archived series', 'social', 'public', 'archived')`
        )
        .run()
      sqlite
        .prepare("insert into event_tags (event_id, kind, value) values ('member-tagged', 'event', 'audience-members')")
        .run()
      const insert = sqlite.prepare(
        `insert into event_sessions (id, event_id, status, starts_at, timezone, rsvp_url, virtual_url)
         values (?, ?, ?, ?, 'America/Los_Angeles', 'https://tech.workingclassunity.com/public-action',
           'https://meet.example.test/private-token')`
      )
      insert.run('public-first', 'public', 'scheduled', '2026-09-01T00:00:00.000Z')
      insert.run('public-second', 'public', 'completed', '2026-09-02T00:00:00.000Z')
      insert.run('public-canceled', 'public', 'canceled', '2026-09-03T00:00:00.000Z')
      insert.run('private-session', 'members', 'scheduled', '2026-09-03T00:00:00.000Z')
      insert.run('member-tagged-session', 'member-tagged', 'scheduled', '2026-09-03T00:00:00.000Z')
      insert.run('hidden-session', 'hidden', 'scheduled', '2026-09-03T00:00:00.000Z')
      insert.run('archived-session', 'archived', 'scheduled', '2026-09-03T00:00:00.000Z')
      insert.run('before-window', 'public', 'scheduled', '2026-08-31T23:59:59.000Z')
      insert.run('after-window', 'public', 'scheduled', '2026-10-01T00:00:00.000Z')

      const input = { from: '2026-09-01T00:00:00.000Z', limit: 200, to: '2026-10-01T00:00:00.000Z' }
      const result = listVisibleCalendarEvents(connection, input)
      expect(result.events.map(({ title }) => title)).toEqual(['Public action'])
      expect(result.events[0]!.sessions.map(({ id }) => id)).toEqual(['public-first', 'public-second'])
      expect(result.events[0]!.sessions[0]!.rsvpUrl).toBe('https://tech.workingclassunity.com/public-action')
      expect(JSON.stringify(result)).not.toContain('private-token')
      expect(result.events[0]).not.toHaveProperty('visibility')
      expect(listVisibleCalendarEvents(connection, { ...input, limit: 1 }).events[0]!.sessions).toHaveLength(1)
    } finally {
      sqlite.close()
    }
  })
})
