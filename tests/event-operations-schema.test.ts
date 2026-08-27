import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))

describe('event operations schema', () => {
  it('separates audience, category, occurrence, provider identity, and governance role', () => {
    withMigratedDatabase((sqlite) => {
      sqlite
        .prepare(
          `insert into events
            (id, title, description, kind, visibility, status, default_timezone, event_page_url)
           values ('event-steering', 'WCU Steering Committee Meeting', 'Monthly steering meeting',
             'meeting', 'members', 'active', 'America/Los_Angeles',
             'https://tech.workingclassunity.com/wcu-steering-committee-meeting')`
        )
        .run()
      sqlite
        .prepare(
          `insert into event_sessions
            (id, event_id, title, status, delivery_mode, starts_at, ends_at, timezone,
             location_name, location, virtual_url, rsvp_url)
           values ('session-steering', 'event-steering', 'September steering meeting', 'scheduled',
             'hybrid', '2026-09-07T01:00:00.000Z', '2026-09-07T02:30:00.000Z',
             'America/Los_Angeles', 'OF Hall', '2522 Grand Canal Blvd, Stockton, CA',
             'https://meet.example.test/steering',
             'https://tech.workingclassunity.com/wcu-steering-committee-meeting?event_session_ids=1,2')`
        )
        .run()
      sqlite
        .prepare(
          `insert into event_tags (event_id, kind, value)
           values ('event-steering', 'event', 'audience-members'),
                  ('event-steering', 'event', 'category-meeting'),
                  ('event-steering', 'event', 'meeting-steering'),
                  ('event-steering', 'campaign', 'focus-tenant-union')`
        )
        .run()
      sqlite
        .prepare(
          `insert into event_provider_links
            (id, event_id, provider, external_id, primary_external_id, source_url, last_seen_at)
           values ('event-link', 'event-steering', 'solidarity', 'event-external', 'event-external',
             'https://dashboard.example.test/events/event-external', '2026-08-23T18:00:00.000Z')`
        )
        .run()
      sqlite
        .prepare(
          `insert into event_session_provider_links
            (id, event_session_id, provider, external_id, primary_external_id, paired_external_id,
             last_seen_at)
           values ('session-link-1', 'session-steering', 'solidarity', '70001', '70001', '70002',
             '2026-08-23T18:00:00.000Z'),
                  ('session-link-2', 'session-steering', 'solidarity', '70002', '70002', '70001',
             '2026-08-23T18:00:00.000Z')`
        )
        .run()
      sqlite
        .prepare(
          `insert into meetings (event_session_id, kind)
           values ('session-steering', 'steering')`
        )
        .run()

      expect(
        sqlite
          .prepare(
            `select events.kind as category, events.visibility, sessions.delivery_mode as deliveryMode,
                    meetings.kind as meetingKind, count(links.id) as providerLinks
             from events
             join event_sessions sessions on sessions.event_id = events.id
             join meetings on meetings.event_session_id = sessions.id
             join event_session_provider_links links on links.event_session_id = sessions.id
             where events.id = 'event-steering'`
          )
          .get()
      ).toEqual({
        category: 'meeting',
        deliveryMode: 'hybrid',
        meetingKind: 'steering',
        providerLinks: 2,
        visibility: 'members'
      })

      expect(() =>
        sqlite
          .prepare(
            `insert into events (id, title, kind, visibility, default_timezone)
             values ('invalid-category', 'Invalid', 'canvass', 'public', 'America/Los_Angeles')`
          )
          .run()
      ).toThrow(/events category is not supported/)
      expect(() =>
        sqlite
          .prepare(
            `insert into event_tags (event_id, kind, value)
             values ('event-steering', 'event', 'audience-members')`
          )
          .run()
      ).toThrow(/UNIQUE constraint failed/)
      expect(() =>
        sqlite
          .prepare(
            `insert into event_provider_links
              (id, event_id, provider, external_id, last_seen_at)
             values ('duplicate-provider-link', 'event-steering', 'solidarity', 'event-external',
               '2026-08-23T18:00:00.000Z')`
          )
          .run()
      ).toThrow(/UNIQUE constraint failed/)
    })
  })
})

function withMigratedDatabase(run: (sqlite: Database.Database) => void) {
  const root = mkdtempSync(join(tmpdir(), 'wcu-event-schema-'))
  const sqlite = new Database(join(root, 'schema.sqlite'))
  sqlite.pragma('foreign_keys = ON')
  try {
    migrate(drizzle(sqlite), { migrationsFolder })
    run(sqlite)
  } finally {
    sqlite.close()
    rmSync(root, { recursive: true, force: true })
  }
}
