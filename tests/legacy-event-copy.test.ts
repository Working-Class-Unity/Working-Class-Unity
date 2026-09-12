import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../server/db/schema/index'
import { previewSolidarityEventSync } from '../server/services/events/solidarity-sync'
import type { SolidarityEventRecord } from '../server/services/events/solidarity-import'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { copyLegacyEvents } from '../server/db/copy-legacy-events'

const baseline = readFileSync(
  fileURLToPath(new URL('../server/db/migrations/0000_public_events.sql', import.meta.url)),
  'utf8'
)
const personalMarker = 'RETIRED_PRIVATE_PERSON@example.test'

describe('one-time legacy event copy', () => {
  it('preserves recurring, hybrid, private, hidden and retired event metadata without copying personal records or JSON fields', () => {
    withFixture(({ root, source, destination }) => {
      const before = readFileSync(source)
      expect(copyLegacyEvents(source, destination)).toEqual({
        events: 3,
        sessions: 4,
        tags: 4,
        eventProviderLinks: 3,
        sessionProviderLinks: 5,
        snapshots: 6,
        discardedSnapshots: 0
      })
      expect(readFileSync(source)).toEqual(before)
      const copied = new Database(destination, { readonly: true })
      try {
        expect(copied.prepare('select id, visibility, status from events order by id').all()).toEqual([
          { id: 'event-hidden', visibility: 'hidden', status: 'archived' },
          { id: 'event-members', visibility: 'members', status: 'active' },
          { id: 'event-public', visibility: 'public', status: 'active' }
        ])
        expect(copied.prepare('select id, status, delivery_mode from event_sessions order by id').all()).toEqual([
          { id: 'session-canceled', status: 'canceled', delivery_mode: 'virtual' },
          { id: 'session-completed', status: 'completed', delivery_mode: 'in_person' },
          { id: 'session-hybrid', status: 'scheduled', delivery_mode: 'hybrid' },
          { id: 'session-members', status: 'scheduled', delivery_mode: 'virtual' }
        ])
        expect(
          copied
            .prepare(
              "select external_id, paired_external_id from event_session_provider_links where event_session_id = 'session-hybrid' order by external_id"
            )
            .all()
        ).toEqual([
          { external_id: 'physical', paired_external_id: 'virtual' },
          { external_id: 'virtual', paired_external_id: 'physical' }
        ])
        expect(
          copied.prepare("select raw_payload from external_record_snapshots where external_id = 'physical'").get()
        ).toEqual({ raw_payload: JSON.stringify(sessionRecord('physical', 'in_person', 'virtual')) })
        expect(copied.prepare("select value from event_tags where event_id = 'event-members'").all()).toEqual([
          { value: 'audience-members' }
        ])
        expect(copied.prepare('select source_name, provider, record_count from import_batches').all()).toEqual([
          { source_name: 'legacy-event-copy', provider: 'solidarity', record_count: 6 }
        ])
        expect(
          copied
            .prepare(
              "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name <> '__drizzle_migrations' order by name"
            )
            .all()
        ).toHaveLength(7)
        const eventSnapshots = copied
          .prepare(
            "select raw_payload from external_record_snapshots where external_id in ('event-public', 'event-members')"
          )
          .all() as Array<{ raw_payload: string }>
        const retirement = previewSolidarityEventSync(
          { sqlite: copied, databasePath: destination, db: drizzle({ client: copied, schema }) },
          {
            observedAt: '2026-09-16T00:00:00.000Z',
            scope: {
              eventIds: ['event-public', 'event-members'],
              from: '2026-09-01T00:00:00.000Z',
              to: '2026-10-01T00:00:00.000Z'
            },
            dataset: {
              events: eventSnapshots.map((snapshot) => JSON.parse(snapshot.raw_payload) as SolidarityEventRecord),
              sessions: []
            }
          }
        )
        expect(retirement.retirementCandidates.map(({ sessionId }) => sessionId)).toEqual([
          'session-hybrid',
          'session-members'
        ])
        expect(copied.pragma('foreign_key_check')).toEqual([])
        expect(copied.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }])
      } finally {
        copied.close()
      }
      expect(readFileSync(destination).includes(Buffer.from(personalMarker))).toBe(false)
      expect(statSync(destination).mode & 0o777).toBe(0o600)
      expect(readdirSync(root).sort()).toEqual(['events.db', 'legacy.db'])
    })
  })

  it('refuses an existing destination and orphan sidecars without changing any file', () => {
    withFixture(({ source, destination }) => {
      const sourceBefore = readFileSync(source)
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        writeFileSync(`${destination}${suffix}`, 'existing state')
        expect(() => copyLegacyEvents(source, destination)).toThrow(/already exists/)
        expect(readFileSync(`${destination}${suffix}`, 'utf8')).toBe('existing state')
        rmSync(`${destination}${suffix}`)
      }
      expect(() => copyLegacyEvents(source, source)).toThrow(/already exists/)
      expect(readFileSync(source)).toEqual(sourceBefore)
    })
  })

  it('refuses incomplete hybrid source metadata and leaves no partial destination or source edits', () => {
    withFixture(({ root, source, destination }) => {
      const legacy = new Database(source)
      legacy
        .prepare("update external_record_snapshots set raw_payload = ? where external_id = 'virtual'")
        .run(JSON.stringify({ id: 'virtual', email: personalMarker }))
      legacy.close()
      const before = readFileSync(source)
      expect(() => copyLegacyEvents(source, destination)).toThrow(/missing safe source metadata/)
      expect(readFileSync(source)).toEqual(before)
      expect(readdirSync(root)).toEqual(['legacy.db'])
    })
  })

  it('refuses stale hybrid halves that would change the copied occurrence during retirement', () => {
    withFixture(({ root, source, destination }) => {
      const legacy = new Database(source)
      legacy
        .prepare(
          "update event_sessions set virtual_url = 'https://meet.example.test/changed' where id = 'session-hybrid'"
        )
        .run()
      legacy.close()
      const before = readFileSync(source)
      expect(() => copyLegacyEvents(source, destination)).toThrow(/cannot reconstruct its occurrence/)
      expect(readFileSync(source)).toEqual(before)
      expect(readdirSync(root)).toEqual(['legacy.db'])
    })
  })

  it('rejects WAL-mode sources before opening them or creating source sidecars', () => {
    withFixture(({ root, source, destination }) => {
      const legacy = new Database(source)
      legacy.pragma('journal_mode = WAL')
      legacy.close()
      const before = readFileSync(source)
      expect(readdirSync(root)).toEqual(['legacy.db'])
      expect(() => copyLegacyEvents(source, destination)).toThrow(/standalone SQLite backup/)
      expect(readFileSync(source)).toEqual(before)
      expect(readdirSync(root)).toEqual(['legacy.db'])
    })
  })

  it('refuses malformed source databases without leaving a usable partial output', () => {
    const root = mkdtempSync(join(tmpdir(), 'wcu-invalid-event-copy-'))
    try {
      const source = join(root, 'legacy.db')
      writeFileSync(source, 'not a database')
      expect(() => copyLegacyEvents(source, join(root, 'events.db'))).toThrow()
      expect(readFileSync(source, 'utf8')).toBe('not a database')
      expect(readdirSync(root)).toEqual(['legacy.db'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function withFixture(run: (paths: { root: string; source: string; destination: string }) => void) {
  const root = mkdtempSync(join(tmpdir(), 'wcu-legacy-event-copy-'))
  const source = join(root, 'legacy.db')
  const destination = join(root, 'events.db')
  const legacy = new Database(source)
  // Synthetic legacy schema: the old provenance contract allowed unrelated provider records.
  legacy.exec(
    baseline.replace(
      "in ('solidarity.event', 'solidarity.session')",
      "in ('solidarity.event', 'solidarity.session', 'solidarity.person', 'stripe.subscription')"
    )
  )
  legacy.pragma('foreign_keys = ON')
  legacy.exec(
    'create table people (id text primary key, email text); create table user (id text primary key, email text); create table memberships (id text primary key, person_id text); create table rsvps (id text, person_id text); create table attendance (id text, person_id text)'
  )
  legacy.prepare('insert into people values (?, ?)').run('person-old', personalMarker)
  legacy.prepare('insert into user values (?, ?)').run('user-old', personalMarker)
  legacy.exec(
    "insert into memberships values ('member-old','person-old'); insert into rsvps values ('rsvp-old','person-old'); insert into attendance values ('attendance-old','person-old')"
  )
  legacy
    .prepare(
      "insert into import_batches (id, provider, status, source_name, source_checksum, started_at, completed_at, record_count) values ('old-batch', 'solidarity', 'completed', ?, ?, '2026-09-01', '2026-09-01', 999)"
    )
    .run(personalMarker, personalMarker)
  const snapshot = legacy.prepare(
    "insert into external_record_snapshots (id, import_batch_id, object_type, external_id, observed_at, payload_hash, raw_payload) values (?, 'old-batch', ?, ?, '2026-09-01T00:00:00.000Z', '0123456789abcdef', ?)"
  )
  snapshot.run(
    'snapshot-person',
    'solidarity.person',
    'person-old',
    JSON.stringify({ id: 'person-old', email: personalMarker })
  )
  snapshot.run(
    'snapshot-payment',
    'stripe.subscription',
    'sub-old',
    JSON.stringify({ customer: { email: personalMarker } })
  )
  for (const audience of ['public', 'members', 'hidden']) {
    const eventId = `event-${audience}`
    const record = {
      id: eventId,
      primaryEventId: null,
      title: 'Community gathering',
      description: 'Event details',
      status: audience === 'hidden' ? 'archived' : 'active',
      timezone: 'America/Los_Angeles',
      eventTags: audience === 'hidden' ? ['category-social'] : [`audience-${audience}`, 'category-social'],
      campaignTags: []
    }
    snapshot.run(
      `snapshot-${eventId}`,
      'solidarity.event',
      eventId,
      JSON.stringify({ ...record, contacts: [{ email: personalMarker }], membership: { customer: personalMarker } })
    )
    legacy
      .prepare(
        "insert into events (id, title, description, kind, visibility, status, default_timezone, source_snapshot_id) values (?, 'Community gathering', 'Event details', 'social', ?, ?, 'America/Los_Angeles', ?)"
      )
      .run(eventId, audience, record.status, `snapshot-${eventId}`)
    legacy
      .prepare("insert into event_tags (event_id, kind, value, source_snapshot_id) values (?, 'event', ?, ?)")
      .run(eventId, `audience-${audience}`, `snapshot-${eventId}`)
    legacy
      .prepare(
        "insert into event_provider_links (id, event_id, provider, external_id, last_seen_at, source_snapshot_id) values (?, ?, 'solidarity', ?, '2026-09-01', ?)"
      )
      .run(`link-${eventId}`, eventId, eventId, `snapshot-${eventId}`)
  }
  legacy.exec(
    "insert into event_tags (event_id, kind, value) values ('event-public', 'campaign', 'focus-tenant-union')"
  )
  const sessions = [
    ['session-hybrid', 'event-public', 'scheduled', 'hybrid', '2026-09-15T19:00:00.000Z'],
    ['session-completed', 'event-public', 'completed', 'in_person', '2026-08-15T19:00:00.000Z'],
    ['session-canceled', 'event-public', 'canceled', 'virtual', '2026-10-15T19:00:00.000Z'],
    ['session-members', 'event-members', 'scheduled', 'virtual', '2026-09-20T19:00:00.000Z']
  ]
  const insertSession = legacy.prepare(
    "insert into event_sessions (id, event_id, status, delivery_mode, starts_at, timezone, virtual_url, rsvp_url) values (?, ?, ?, ?, ?, 'America/Los_Angeles', 'https://meet.example.test/private', 'https://solidarity.example.test/rsvp')"
  )
  for (const row of sessions) insertSession.run(...row)
  for (const [external, mode, pair] of [
    ['physical', 'in_person', 'virtual'],
    ['virtual', 'virtual', 'physical']
  ] as const) {
    snapshot.run(
      `snapshot-${external}`,
      'solidarity.session',
      external,
      JSON.stringify({
        ...sessionRecord(external, mode, pair),
        attendees: [{ email: personalMarker }],
        notes: { contact: personalMarker }
      })
    )
    legacy
      .prepare(
        "insert into event_session_provider_links (id, event_session_id, provider, external_id, primary_external_id, paired_external_id, last_seen_at, source_snapshot_id) values (?, 'session-hybrid', 'solidarity', ?, ?, ?, '2026-09-01', ?)"
      )
      .run(`link-${external}`, external, external, pair, `snapshot-${external}`)
  }
  for (const session of ['session-completed', 'session-canceled', 'session-members']) {
    legacy
      .prepare(
        "insert into event_session_provider_links (id, event_session_id, provider, external_id, primary_external_id, last_seen_at) values (?, ?, 'solidarity', ?, ?, '2026-09-01')"
      )
      .run(`link-${session}`, session, session, session)
  }
  snapshot.run(
    'snapshot-session-members',
    'solidarity.session',
    'session-members',
    JSON.stringify({
      ...sessionRecord('session-members', 'virtual', null),
      eventId: 'event-members',
      startsAt: '2026-09-20T19:00:00.000Z'
    })
  )
  legacy.close()
  try {
    run({ root, source, destination })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function sessionRecord(id: string, eventType: 'in_person' | 'virtual', pairedSessionId: string | null) {
  return {
    eventId: 'event-public',
    eventType,
    id,
    pairedSessionId,
    primarySessionId: id,
    rsvpUrl: 'https://solidarity.example.test/rsvp',
    startsAt: '2026-09-15T19:00:00.000Z',
    status: 'scheduled',
    timezone: 'America/Los_Angeles',
    virtualUrl: eventType === 'virtual' ? 'https://meet.example.test/private' : null
  }
}
