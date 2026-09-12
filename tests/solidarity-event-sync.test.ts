import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { DatabaseConnection } from '../server/db/connect'
import * as schema from '../server/db/schema/index'
import { importSolidarityEventDataset, type SolidaritySessionRecord } from '../server/services/events/solidarity-import'
import {
  applySolidarityEventSync,
  previewSolidarityEventSync,
  type SolidarityEventSyncCapture
} from '../server/services/events/solidarity-sync'

const observedAt = '2026-09-09T12:00:00.000Z'
const scope = { eventIds: ['event'], from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' }
const event = {
  id: 'event',
  title: 'General meeting',
  status: 'active',
  timezone: 'America/Los_Angeles',
  eventTags: ['audience-public', 'category-meeting', 'meeting-general'],
  campaignTags: [],
  description: 'Private description',
  eventPageUrl: 'https://example.test/event'
} as const

function session(id: string, overrides: Partial<SolidaritySessionRecord> = {}): SolidaritySessionRecord {
  return {
    id,
    eventId: 'event',
    eventType: 'in_person',
    status: 'scheduled',
    startsAt: '2026-09-15T19:00:00.000Z',
    endsAt: '2026-09-15T20:00:00.000Z',
    timezone: 'America/Los_Angeles',
    title: 'September meeting',
    locationName: 'Hall',
    locationAddress: '100 Main St',
    ...overrides
  }
}

function capture(sessions: readonly SolidaritySessionRecord[]): SolidarityEventSyncCapture {
  return { dataset: { events: [event], sessions }, scope, observedAt }
}

function withDatabase(run: (connection: DatabaseConnection) => void) {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  try {
    migrate(drizzle({ client: sqlite }), {
      migrationsFolder: fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
    })
    run({ sqlite, db: drizzle({ client: sqlite, schema }), databasePath: ':memory:' })
  } finally {
    sqlite.close()
  }
}

function localSession(connection: DatabaseConnection, externalId: string) {
  return connection.sqlite
    .prepare(
      `select s.* from event_sessions s join event_session_provider_links l
    on l.event_session_id = s.id where l.provider = 'solidarity' and l.external_id = ?`
    )
    .get(externalId) as { id: string; status: string; starts_at: string; delivery_mode: string; [key: string]: unknown }
}

function batches(connection: DatabaseConnection) {
  return connection.sqlite.prepare('select * from import_batches order by id').all()
}

describe('Solidarity browser event sync', () => {
  it('reschedules out of scope, adds a hybrid counterpart using the same ID, and retires only explicitly while preserving event metadata', () => {
    withDatabase((connection) => {
      const original = capture([
        session('move'),
        session('missing-in', { pairedSessionId: 'missing-virtual', primarySessionId: 'missing-in' }),
        session('missing-virtual', {
          eventType: 'virtual',
          pairedSessionId: 'missing-in',
          primarySessionId: 'missing-in',
          virtualUrl: 'https://meet.example.test/private?secret=retired',
          locationName: null,
          locationAddress: null
        }),
        session('outside', { startsAt: '2026-10-15T19:00:00.000Z', endsAt: '2026-10-15T20:00:00.000Z' }),
        session('completed', { status: 'completed' })
      ])
      importSolidarityEventDataset(connection, original.dataset, {
        apply: true,
        observedAt: new Date('2026-09-08T12:00:00.000Z')
      })
      const moveId = localSession(connection, 'move').id
      const missingId = localSession(connection, 'missing-in').id
      const outside = localSession(connection, 'outside')
      const incoming = capture([
        session('move', {
          pairedSessionId: 'move-virtual',
          startsAt: '2026-10-02T19:00:00.000Z',
          endsAt: '2026-10-02T20:00:00.000Z'
        }),
        session('move-virtual', {
          eventType: 'virtual',
          pairedSessionId: 'move',
          startsAt: '2026-10-02T19:00:00.000Z',
          endsAt: '2026-10-02T20:00:00.000Z',
          virtualUrl: 'https://meet.example.test/private?secret=new'
        }),
        session('new'),
        session('completed'),
        session('outside', {
          title: 'Outside must not change',
          startsAt: '2026-10-15T19:00:00.000Z',
          endsAt: '2026-10-15T20:00:00.000Z'
        })
      ])
      const updatedCapture = {
        ...incoming,
        dataset: {
          ...incoming.dataset,
          events: [{ ...event, title: 'Renamed series', description: 'New private description' }]
        }
      }
      const preview = previewSolidarityEventSync(connection, updatedCapture)
      expect(() =>
        applySolidarityEventSync(connection, preview, {
          retireSessionIds: [],
          observedAt,
          target: 'another-database'
        })
      ).toThrow(/target differs/)
      expect(preview.retirementCandidates.map(({ sessionId }) => sessionId)).toEqual([missingId])
      expect(preview.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ level: 'series', fields: expect.arrayContaining([{ field: 'description' }]) }),
          expect.objectContaining({
            level: 'session',
            id: moveId,
            fields: expect.arrayContaining([
              { field: 'startsAt', before: '2026-09-15T19:00:00.000Z', after: '2026-10-02T19:00:00.000Z' },
              { field: 'providerLinks' },
              { field: 'virtualUrl' }
            ])
          })
        ])
      )
      expect(JSON.stringify(preview.changes)).not.toMatch(/secret=|private description|https:/)
      expect(batches(connection)).toHaveLength(1)
      connection.sqlite.prepare('update event_sessions set title = ? where id = ?').run('Concurrent change', moveId)
      const changedState = localSession(connection, 'move')
      expect(() => applySolidarityEventSync(connection, preview, { retireSessionIds: [], observedAt })).toThrow(/stale/)
      expect(localSession(connection, 'move')).toEqual(changedState)
      expect(batches(connection)).toHaveLength(1)
      connection.sqlite.prepare('update event_sessions set title = ? where id = ?').run('September meeting', moveId)
      const first = applySolidarityEventSync(connection, JSON.parse(JSON.stringify(preview)), {
        retireSessionIds: [],
        observedAt
      })
      expect(first).toMatchObject({ changed: true, noOp: false, retiredSessionIds: [] })
      expect(localSession(connection, 'move')).toMatchObject({
        id: moveId,
        delivery_mode: 'hybrid',
        starts_at: '2026-10-02T19:00:00.000Z'
      })
      expect(localSession(connection, 'move-virtual').id).toBe(moveId)
      expect(localSession(connection, 'missing-in').status).toBe('scheduled')
      expect(localSession(connection, 'outside')).toEqual(outside)
      expect(localSession(connection, 'completed').status).toBe('completed')
      const next = previewSolidarityEventSync(connection, updatedCapture)
      expect(next.changes).toEqual([])
      const retired = applySolidarityEventSync(connection, next, { retireSessionIds: [missingId], observedAt })
      expect(retired).toMatchObject({
        changed: true,
        retiredSessionIds: [missingId]
      })
      expect(localSession(connection, 'missing-in')).toMatchObject({
        id: missingId,
        status: 'canceled',
        delivery_mode: 'hybrid'
      })
      expect(localSession(connection, 'missing-virtual').id).toBe(missingId)
      const payloads = connection.sqlite
        .prepare(
          `select external_id, raw_payload from external_record_snapshots
        where import_batch_id = ? and object_type = 'solidarity.session' order by external_id`
        )
        .all(retired.report.batchId) as Array<{ external_id: string; raw_payload: string }>
      expect(payloads.map(({ raw_payload }) => JSON.parse(raw_payload))).toEqual(
        original.dataset.sessions.slice(1, 3).map((source) => ({ ...source, status: 'canceled' }))
      )
      const beforeNoOp = batches(connection)
      const noOp = applySolidarityEventSync(connection, previewSolidarityEventSync(connection, updatedCapture), {
        retireSessionIds: [],
        observedAt: '2026-09-10T12:00:00.000Z'
      })
      expect(noOp).toMatchObject({ changed: false, noOp: true, report: { batchId: null } })
      expect(batches(connection)).toEqual(beforeNoOp)
      expect(localSession(connection, 'outside')).toEqual(outside)
    })
  })
})
