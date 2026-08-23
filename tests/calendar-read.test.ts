import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as schema from '../server/db/schema/index'
import { listVisibleCalendarEvents } from '../server/services/events/calendar-read'

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))

describe('calendar visibility', () => {
  it('shows member events only to website accounts linked to an active membership', () => {
    const root = mkdtempSync(join(tmpdir(), 'wcu-calendar-read-'))
    const databasePath = join(root, 'calendar.sqlite')
    const sqlite = new Database(databasePath)
    sqlite.pragma('foreign_keys = ON')
    try {
      migrate(drizzle({ client: sqlite }), { migrationsFolder })
      const connection = { databasePath, db: drizzle({ client: sqlite, schema }), sqlite }
      sqlite
        .prepare(
          `insert into user (id, name, email, email_verified, created_at, updated_at)
           values ('user-member', 'WCU Member', 'member@example.test', 1, 1, 1),
                  ('user-nonmember', 'Website User', 'user@example.test', 1, 1, 1)`
        )
        .run()
      sqlite.prepare("insert into people (id, display_name) values ('person-member', 'WCU Member')").run()
      sqlite
        .prepare(
          `insert into person_accounts (person_id, user_id, linked_at)
           values ('person-member', 'user-member', '2026-08-01T00:00:00.000Z')`
        )
        .run()
      sqlite
        .prepare(
          `insert into memberships (id, person_id, status, applied_at, started_at)
           values ('membership-member', 'person-member', 'active',
             '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`
        )
        .run()
      sqlite
        .prepare(
          `insert into events (id, title, kind, visibility)
           values ('event-public', 'Public action', 'action', 'public'),
                  ('event-members', 'Steering meeting', 'meeting', 'members'),
                  ('event-hidden', 'Unclassified', 'social', 'hidden')`
        )
        .run()
      sqlite
        .prepare(
          `insert into event_sessions
             (id, event_id, status, delivery_mode, starts_at, timezone, rsvp_url)
           values ('session-public', 'event-public', 'scheduled', 'in_person',
             '2026-09-01T02:00:00.000Z', 'America/Los_Angeles',
             'https://tech.workingclassunity.com/public-action'),
                  ('session-members', 'event-members', 'scheduled', 'virtual',
             '2026-09-02T02:00:00.000Z', 'America/Los_Angeles',
             'https://tech.workingclassunity.com/steering'),
                  ('session-hidden', 'event-hidden', 'scheduled', 'in_person',
             '2026-09-03T02:00:00.000Z', 'America/Los_Angeles', null)`
        )
        .run()
      sqlite.prepare("insert into meetings (event_session_id, kind) values ('session-members', 'steering')").run()

      const input = {
        from: '2026-09-01T00:00:00.000Z',
        limit: 200,
        to: '2026-10-01T00:00:00.000Z'
      }
      expect(
        listVisibleCalendarEvents(connection, { ...input, userId: null }).events.map(({ title }) => title)
      ).toEqual(['Public action'])
      expect(
        listVisibleCalendarEvents(connection, { ...input, userId: 'user-nonmember' }).events.map(({ title }) => title)
      ).toEqual(['Public action'])
      expect(
        listVisibleCalendarEvents(connection, { ...input, userId: 'user-member' }).events.map(({ title }) => title)
      ).toEqual(['Public action', 'Steering meeting'])

      const memberEvent = listVisibleCalendarEvents(connection, { ...input, userId: 'user-member' }).events[1]!
      expect(memberEvent.sessions[0]).toMatchObject({
        meetingKind: 'steering',
        rsvpUrl: 'https://tech.workingclassunity.com/steering'
      })
      expect(memberEvent.sessions[0]).not.toHaveProperty('virtualUrl')
      expect(memberEvent).not.toHaveProperty('visibility')
    } finally {
      sqlite.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
