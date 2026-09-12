import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, closeSync, existsSync, linkSync, lstatSync, mkdirSync, openSync, readSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import {
  assertSolidarityEventImportDataset,
  previewSolidarityEventImport,
  solidarityEventFields,
  solidaritySessionFields,
  type SolidarityEventRecord,
  type SolidaritySessionRecord
} from '../services/events/solidarity-import'
import { verifySqliteIntegrityAndForeignKeys } from './connect'
import * as schema from './schema/index'

const packagedMigrationsFolder = fileURLToPath(new URL('./db/migrations/', import.meta.url))
const migrationsFolder = existsSync(packagedMigrationsFolder)
  ? packagedMigrationsFolder
  : fileURLToPath(new URL('./migrations/', import.meta.url))
const eventColumns = {
  events: [
    'id',
    'title',
    'description',
    'kind',
    'visibility',
    'status',
    'default_timezone',
    'event_page_url',
    'source_snapshot_id',
    'created_at',
    'updated_at'
  ],
  event_sessions: [
    'id',
    'event_id',
    'title',
    'status',
    'delivery_mode',
    'starts_at',
    'ends_at',
    'timezone',
    'location_name',
    'location',
    'virtual_url',
    'rsvp_url',
    'source_snapshot_id',
    'created_at',
    'updated_at'
  ],
  event_tags: ['event_id', 'kind', 'value', 'source_snapshot_id', 'created_at', 'updated_at'],
  event_provider_links: [
    'id',
    'event_id',
    'provider',
    'external_id',
    'primary_external_id',
    'source_url',
    'last_seen_at',
    'source_snapshot_id',
    'created_at',
    'updated_at'
  ],
  event_session_provider_links: [
    'id',
    'event_session_id',
    'provider',
    'external_id',
    'primary_external_id',
    'paired_external_id',
    'last_seen_at',
    'source_snapshot_id',
    'created_at',
    'updated_at'
  ]
} as const

type EventTable = keyof typeof eventColumns
type Row = Record<string, string | number | null>
type Snapshot = {
  id: string
  object_type: string
  external_id: string
  observed_at: string
  raw_payload: string
  created_at: string
}

/** Copy from a consistent, read-only source snapshot. The destination is published only after validation. */
export function copyLegacyEvents(sourcePath: string, destinationPath: string) {
  const source = resolve(sourcePath)
  const destination = resolve(destinationPath)
  if (!lstatSync(source).isFile()) throw new Error('Legacy source must be a regular SQLite file.')
  requireUnusedDestination(destination)
  requireStandaloneSource(source)
  mkdirSync(dirname(destination), { recursive: true })
  const staged = join(dirname(destination), `.${basename(destination)}.event-copy-${randomUUID()}.tmp`)
  closeSync(openSync(staged, 'wx', 0o600))
  let input: Database.Database | undefined
  let output: Database.Database | undefined
  try {
    input = new Database(source, { readonly: true, fileMustExist: true })
    output = new Database(staged)
    output.pragma('foreign_keys = ON')
    migrate(drizzle(output), { migrationsFolder })
    const legacy = input
    const target = output
    const result = legacy.transaction(() => {
      verifySqliteIntegrityAndForeignKeys(legacy, 'Legacy source', fail)
      const rows = Object.fromEntries(
        Object.entries(eventColumns).map(([table, columns]) => [
          table,
          legacy.prepare(`select ${columns.join(', ')} from ${table}`).all()
        ])
      ) as Record<EventTable, Row[]>
      const sourceRows = legacy
        .prepare(
          "select id, object_type, external_id, observed_at, raw_payload, created_at from external_record_snapshots where object_type in ('solidarity.event', 'solidarity.session') order by observed_at desc, rowid desc"
        )
        .all() as Snapshot[]
      const linkedEvents = new Set(rows.event_provider_links.map((row) => String(row.external_id)))
      const linkedSessions = new Set(rows.event_session_provider_links.map((row) => String(row.external_id)))
      const latest = new Map<string, Snapshot>()
      let discardedSnapshots = 0
      for (const row of sourceRows) {
        const linked = row.object_type === 'solidarity.event' ? linkedEvents : linkedSessions
        if (!linked.has(row.external_id)) continue
        const key = snapshotKey(row.object_type, row.external_id)
        if (latest.has(key)) continue
        try {
          const payload = sanitizeSnapshot(row)
          latest.set(key, { ...row, raw_payload: payload })
        } catch {
          // Old raw payloads may contain arbitrary exports. Only validated event metadata is retained.
          discardedSnapshots++
        }
      }
      const sourceKeys = new Map(sourceRows.map((row) => [row.id, snapshotKey(row.object_type, row.external_id)]))
      const snapshots = [...latest.values()]
      const batchId = `import_legacy_events_${randomUUID()}`
      const observed = snapshots.map((row) => row.observed_at).sort()
      target.transaction(() => {
        if (snapshots.length) {
          target
            .prepare(
              "insert into import_batches (id, provider, status, source_name, started_at, completed_at, record_count) values (?, 'solidarity', 'completed', 'legacy-event-copy', ?, ?, ?)"
            )
            .run(batchId, observed[0], observed.at(-1), snapshots.length)
          const insert = target.prepare(
            'insert into external_record_snapshots (id, import_batch_id, object_type, external_id, observed_at, payload_hash, raw_payload, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)'
          )
          for (const row of snapshots)
            insert.run(
              row.id,
              batchId,
              row.object_type,
              row.external_id,
              row.observed_at,
              createHash('sha256').update(row.raw_payload).digest('hex'),
              row.raw_payload,
              row.created_at
            )
        }
        for (const [table, columns] of Object.entries(eventColumns)) {
          const insert = target.prepare(
            `insert into ${table} (${columns.join(', ')}) values (${columns.map(() => '?').join(', ')})`
          )
          for (const row of rows[table as EventTable]) {
            const sourceKey =
              row.source_snapshot_id === null ? undefined : sourceKeys.get(String(row.source_snapshot_id))
            const copy = { ...row, source_snapshot_id: sourceKey ? (latest.get(sourceKey)?.id ?? null) : null }
            insert.run(...columns.map((column) => copy[column as keyof typeof copy]))
          }
        }
      })()
      requireHybridSourceMetadata(rows, latest, target, staged)
      verifySqliteIntegrityAndForeignKeys(target, 'Copied events', fail)
      for (const [table, columns] of Object.entries(eventColumns)) {
        // Compare every durable event field, allowing only provenance references to be rewritten.
        const dataColumns = columns.filter((column) => column !== 'source_snapshot_id')
        const copied = target.prepare(`select ${dataColumns.join(', ')} from ${table}`).all() as Row[]
        const expected = rows[table as EventTable].map((row) =>
          Object.fromEntries(dataColumns.map((column) => [column, row[column]]))
        )
        if (JSON.stringify(copied) !== JSON.stringify(expected))
          fail(`Copied ${table} metadata differs from its source.`)
      }
      return {
        events: rows.events.length,
        sessions: rows.event_sessions.length,
        tags: rows.event_tags.length,
        eventProviderLinks: rows.event_provider_links.length,
        sessionProviderLinks: rows.event_session_provider_links.length,
        snapshots: snapshots.length,
        discardedSnapshots
      }
    })()
    output.close()
    output = undefined
    input.close()
    input = undefined
    chmodSync(staged, 0o600)
    requireUnusedDestination(destination)
    linkSync(staged, destination)
    return result
  } finally {
    output?.close()
    input?.close()
    for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(`${staged}${suffix}`, { force: true })
  }
}

function sanitizeSnapshot(row: Snapshot): string {
  const raw: unknown = JSON.parse(row.raw_payload)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid source metadata.')
  const record = raw as Record<string, unknown>
  const fields = row.object_type === 'solidarity.event' ? solidarityEventFields : solidaritySessionFields
  const selected: Record<string, unknown> = {}
  for (const key of fields) {
    if (!(key in record)) continue
    const value = record[key]
    if (key === 'eventTags' || key === 'campaignTags') {
      if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string')) throw new Error('Invalid source tags.')
    } else if (['id', 'eventId', 'primaryEventId', 'primarySessionId', 'pairedSessionId'].includes(key)) {
      if (value !== null && typeof value !== 'string' && typeof value !== 'number')
        throw new Error('Invalid source identity.')
    } else if (value !== null && typeof value !== 'string') {
      throw new Error('Invalid event metadata field.')
    }
    selected[key] = value
  }
  if (String(selected.id) !== row.external_id) throw new Error('Source identity mismatch.')
  assertSolidarityEventImportDataset({
    events: row.object_type === 'solidarity.event' ? [selected as SolidarityEventRecord] : [],
    sessions: row.object_type === 'solidarity.session' ? [selected as SolidaritySessionRecord] : []
  })
  return JSON.stringify(selected)
}

function requireHybridSourceMetadata(
  rows: Record<EventTable, Row[]>,
  snapshots: Map<string, Snapshot>,
  sqlite: Database.Database,
  databasePath: string
) {
  const connection = { sqlite, databasePath, db: drizzle({ client: sqlite, schema }) }
  for (const session of rows.event_sessions.filter((row) => row.delivery_mode === 'hybrid')) {
    const links = rows.event_session_provider_links.filter((row) => row.event_session_id === session.id)
    const eventIds = new Set(
      rows.event_provider_links.filter((row) => row.event_id === session.event_id).map((row) => row.external_id)
    )
    const types = new Set<string>()
    const records: SolidaritySessionRecord[] = []
    if (links.length < 2)
      fail('A hybrid occurrence is missing its provider links; capture event details before copying.')
    for (const link of links) {
      const snapshot = snapshots.get(snapshotKey('solidarity.session', String(link.external_id)))
      if (!snapshot) fail('A hybrid occurrence is missing safe source metadata; capture event details before copying.')
      const record = JSON.parse(snapshot.raw_payload) as SolidaritySessionRecord
      if (
        !eventIds.has(String(record.eventId)) ||
        String(record.primarySessionId ?? record.id) !== String(link.primary_external_id ?? link.external_id) ||
        (record.pairedSessionId == null ? null : String(record.pairedSessionId)) !== link.paired_external_id
      ) {
        fail('Hybrid source metadata differs from its provider links; capture event details before copying.')
      }
      types.add(record.eventType)
      records.push({ ...record, status: 'canceled' })
    }
    if (!types.has('in_person') || !types.has('virtual'))
      fail('A hybrid occurrence is missing one source delivery mode.')
    const event = rows.events.find((row) => row.id === session.event_id)!
    const events: SolidarityEventRecord[] = rows.event_provider_links
      .filter((row) => row.event_id === event.id)
      .map((link) => ({
        id: String(link.external_id),
        primaryEventId: String(link.primary_external_id ?? link.external_id),
        title: String(event.title),
        status: event.status as 'active' | 'archived',
        timezone: String(event.default_timezone),
        eventTags: [
          `category-${event.kind}`,
          ...(event.visibility === 'hidden' ? [] : [`audience-${event.visibility}`])
        ],
        campaignTags: []
      }))
    const preview = previewSolidarityEventImport(connection, { events, sessions: records })
    const proposed = preview.sessions[0]
    if (
      preview.sessions.length !== 1 ||
      !proposed?.before ||
      proposed.after.id !== session.id ||
      !isDeepStrictEqual({ ...proposed.after, status: proposed.before.status }, proposed.before) ||
      !isDeepStrictEqual(proposed.linksAfter, proposed.linksBefore)
    ) {
      fail(
        'Hybrid source metadata cannot reconstruct its occurrence without changing metadata or identity; capture event details before copying.'
      )
    }
  }
}

function snapshotKey(type: string, id: string) {
  return `${type}\0${id}`
}
function fail(message: string): never {
  throw new Error(message)
}
function requireUnusedDestination(destination: string) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      lstatSync(`${destination}${suffix}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    throw new Error('Destination database or sidecar already exists; choose a new destination.')
  }
}

function requireStandaloneSource(source: string) {
  const header = Buffer.alloc(20)
  const descriptor = openSync(source, 'r')
  try {
    readSync(descriptor, header, 0, header.length, 0)
  } finally {
    closeSync(descriptor)
  }
  if (header[18] === 2 || header[19] === 2) {
    throw new Error(
      'Legacy source must be a standalone SQLite backup in DELETE journal mode, not a live or WAL-mode database.'
    )
  }
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try {
      lstatSync(`${source}${suffix}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    throw new Error('Legacy source must be a standalone SQLite backup without sidecars.')
  }
}
