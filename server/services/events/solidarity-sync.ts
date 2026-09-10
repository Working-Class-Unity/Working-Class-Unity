import { createHash } from 'node:crypto'
import type { DatabaseConnection } from '../../db/connect'
import {
  assertSolidarityEventImportDataset,
  importSolidarityEventDataset,
  previewSolidarityEventImport,
  readSolidarityEventImportState,
  type SolidarityEventImportDataset,
  type SolidaritySessionRecord
} from './solidarity-import'

export type SolidarityEventSyncCapture = Readonly<{
  dataset: SolidarityEventImportDataset
  scope: Readonly<{ eventIds: readonly string[]; from: string; to: string }>
  observedAt: string
}>

type ImportPreview = ReturnType<typeof previewSolidarityEventImport>
type ImportState = ReturnType<typeof readSolidarityEventImportState>
export type SolidarityEventSyncChange = {
  level: 'series' | 'session'
  id: string
  kind: 'create' | 'update'
  fields: Array<{ field: string; before?: unknown; after?: unknown }>
}

const eventFields = [
  'campaignTags',
  'description',
  'eventPageUrl',
  'eventTags',
  'id',
  'primaryEventId',
  'status',
  'timezone',
  'title'
]
const sessionFields = [
  'endsAt',
  'eventId',
  'eventType',
  'id',
  'locationAddress',
  'locationName',
  'pairedSessionId',
  'primarySessionId',
  'rsvpUrl',
  'startsAt',
  'status',
  'timezone',
  'title',
  'virtualUrl'
]

export function previewSolidarityEventSync(
  connection: DatabaseConnection,
  input: SolidarityEventSyncCapture,
  target = connection.databasePath
) {
  const capture = validateCapture(input)
  return connection.sqlite.transaction(() => planSync(connection, capture, target))()
}

export type SolidarityEventSyncPreview = ReturnType<typeof planSync>

function planSync(connection: DatabaseConnection, capture: SolidarityEventSyncCapture, target: string) {
  const { dataset, scope } = capture
  const inWindow = (startsAt: string) => startsAt >= scope.from && startsAt < scope.to
  const inventory = previewSolidarityEventImport(connection, dataset)
  const allSessionIds = new Set(dataset.sessions.map(({ id }) => String(id)))
  for (const event of inventory.events) {
    if (event.linksBefore.some(({ externalId }) => !event.externalIds.includes(externalId))) {
      throw new Error('Solidarity capture has an incomplete event group')
    }
  }
  const localIds = new Set<string>()
  for (const session of inventory.sessions) {
    if (
      localIds.has(session.after.id) ||
      session.linksBefore.some(({ externalId }) => !session.externalIds.includes(externalId))
    ) {
      throw new Error('Solidarity capture has an incomplete or split hybrid session group')
    }
    localIds.add(session.after.id)
  }
  const selectedSessions = inventory.sessions.filter(
    (session) =>
      (session.before && inWindow(session.before.startsAt)) ||
      dataset.sessions.some((source) => session.externalIds.includes(String(source.id)) && inWindow(source.startsAt))
  )
  const storedWindowIds = connection.sqlite
    .prepare(
      `select id from event_sessions
    where event_id in (select value from json_each(?)) and starts_at >= ? and starts_at < ? order by id`
    )
    .all(JSON.stringify(inventory.events.map(({ after }) => after.id)), scope.from, scope.to) as Array<{ id: string }>
  const storedWindow = readSolidarityEventImportState(connection, {
    eventIds: [],
    sessionIds: storedWindowIds.map(({ id }) => id)
  }).sessions
  const selectedEventIds = new Set([
    ...selectedSessions.map(({ after }) => after.eventId),
    ...storedWindow.map(({ projection }) => projection!.eventId)
  ])
  const selectedEvents = inventory.events.filter(({ after }) => selectedEventIds.has(after.id))
  const selectedSourceIds = new Set(selectedSessions.flatMap(({ externalIds }) => externalIds))
  const selectedSourceEventIds = new Set(selectedEvents.flatMap(({ externalIds }) => externalIds))
  const scopedDataset: SolidarityEventImportDataset = {
    attendance: [],
    people: [],
    rsvps: [],
    events: dataset.events.filter(({ id }) => selectedSourceEventIds.has(String(id))),
    sessions: dataset.sessions
      .filter(({ id }) => selectedSourceIds.has(String(id)))
      .map((source) => {
        const stored = selectedSessions.find(({ externalIds }) => externalIds.includes(String(source.id)))?.before
        // The dashboard's ordinary listing does not establish completion or reopen retired sessions.
        return stored && source.status === 'scheduled' && stored.status !== 'scheduled'
          ? { ...source, status: stored.status }
          : source
      })
  }
  const projection = previewSolidarityEventImport(connection, scopedDataset)
  const missing = storedWindow.filter(
    ({ id, projection: stored, links }) =>
      stored?.status === 'scheduled' &&
      links.length > 0 &&
      !localIds.has(id) &&
      links.every((link) =>
        [link.externalId, link.primaryExternalId, link.pairedExternalId].every(
          (externalId) => !externalId || !allSessionIds.has(externalId)
        )
      )
  )
  const retirements = missing.map((stored) => {
    const sessions = rehydrateRetirement(connection, stored, scopedDataset)
    const retirementProjection = previewSolidarityEventImport(connection, { ...scopedDataset, sessions })
    const proposed = retirementProjection.sessions[0]
    if (
      retirementProjection.sessions.length !== 1 ||
      !proposed ||
      proposed.after.id !== stored.id ||
      hash({ ...proposed.after, status: stored.projection!.status, meetingKind: stored.projection!.meetingKind }) !==
        hash(stored.projection) ||
      hash(proposed.linksAfter) !== hash(stored.links)
    ) {
      throw new Error(
        'Cannot safely reconstruct a missing Solidarity session without changing its metadata or identity'
      )
    }
    return { sessionId: stored.id, sessions, projection: proposed }
  })
  const before = readSolidarityEventImportState(connection, {
    eventIds: selectedEvents.map(({ after }) => after.id),
    sessionIds: [...selectedSessions.map(({ after }) => after.id), ...storedWindowIds.map(({ id }) => id)]
  })
  const result = {
    version: 1 as const,
    target,
    capture,
    beforeHash: hash(before),
    changes: summarizeChanges(projection),
    retirementCandidates: missing.map(({ id, projection: stored, links }) => ({
      sessionId: id,
      eventId: stored!.eventId,
      title: stored!.title,
      startsAt: stored!.startsAt,
      providerIds: links.map(({ externalId }) => externalId)
    })),
    // Private file payload: console output must use changes/candidates, never this plan or capture.
    plan: { dataset: scopedDataset, projection, before, retirements }
  }
  return freeze({ ...result, digest: hash(result) })
}

export function applySolidarityEventSync(
  connection: DatabaseConnection,
  preview: SolidarityEventSyncPreview,
  options: Readonly<{ retireSessionIds: readonly string[]; observedAt: string | Date; target?: string }>
) {
  const observedAt = options.observedAt instanceof Date ? options.observedAt.toISOString() : options.observedAt
  assertTimestamp(observedAt)
  if (
    !Array.isArray(options.retireSessionIds) ||
    options.retireSessionIds.some((id) => typeof id !== 'string') ||
    new Set(options.retireSessionIds).size !== options.retireSessionIds.length
  ) {
    throw new TypeError('Retirement selection must contain unique local session IDs')
  }
  // The guard and nested importer savepoint share this write lock, including postcondition checks.
  return connection.sqlite
    .transaction(() => {
      if (!preview || preview.version !== 1) throw new TypeError('Unsupported Solidarity sync preview')
      const { digest, ...unsigned } = preview
      if (digest !== hash(unsigned)) throw new Error('Solidarity sync preview was tampered with')
      const target = options.target ?? connection.databasePath
      if (preview.target !== target) throw new Error('Solidarity sync target differs from the approved preview')
      const current = planSync(connection, validateCapture(preview.capture), target)
      if (current.beforeHash !== preview.beforeHash) throw new Error('Solidarity sync preview is stale; preview again')
      if (current.digest !== digest) throw new Error('Solidarity sync plan changed; preview again')
      const selected = options.retireSessionIds.map((id) => {
        const retirement = current.plan.retirements.find(({ sessionId }) => sessionId === id)
        if (!retirement) throw new Error('Retirement selection is not a current preview candidate')
        return retirement
      })
      const dataset = {
        ...current.plan.dataset,
        sessions: [...current.plan.dataset.sessions, ...selected.flatMap(({ sessions }) => sessions)]
      }
      const expected = previewSolidarityEventImport(connection, dataset)
      const changes = summarizeChanges(expected)
      const changed = changes.length > 0
      const report = importSolidarityEventDataset(connection, dataset, {
        apply: changed,
        observedAt: new Date(observedAt),
        sourceName: 'solidarity-browser-sync'
      })
      const after = readSolidarityEventImportState(connection, {
        eventIds: current.plan.before.events.map(({ id }) => id),
        sessionIds: current.plan.before.sessions.map(({ id }) => id)
      })
      const expectedState: ImportState = {
        events: current.plan.before.events.map((stored) => {
          const next = expected.events.find(({ after }) => after.id === stored.id)
          return next ? { id: stored.id, projection: next.after, links: next.linksAfter } : stored
        }),
        sessions: current.plan.before.sessions.map((stored) => {
          const next = expected.sessions.find(({ after }) => after.id === stored.id)
          return next ? { id: stored.id, projection: next.after, links: next.linksAfter } : stored
        })
      }
      if (hash(after) !== hash(expectedState))
        throw new Error('Solidarity sync post-apply projection verification failed')
      return {
        changed,
        noOp: !changed,
        report,
        changes,
        retiredSessionIds: selected.map(({ sessionId }) => sessionId),
        beforeHash: current.beforeHash,
        afterHash: hash(after),
        digest,
        observedAt
      }
    })
    .immediate()
}

function rehydrateRetirement(
  connection: DatabaseConnection,
  stored: ImportState['sessions'][number],
  dataset: SolidarityEventImportDataset
): SolidaritySessionRecord[] {
  const projection = stored.projection!
  const eventLinks = readSolidarityEventImportState(connection, {
    eventIds: [projection.eventId],
    sessionIds: []
  }).events[0]!.links
  return stored.links.map((link) => {
    const snapshots = connection.sqlite
      .prepare(
        `select raw_payload as payload from external_record_snapshots
      where object_type = 'solidarity.session' and external_id = ? order by observed_at desc, rowid desc`
      )
      .all(link.externalId) as Array<{ payload: string }>
    let source: SolidaritySessionRecord | undefined
    for (const { payload } of snapshots) {
      try {
        const raw = JSON.parse(payload)
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
        const record = Object.fromEntries(
          sessionFields.filter((key) => key in raw).map((key) => [key, raw[key]])
        ) as SolidaritySessionRecord
        if (
          String(record.id) !== link.externalId ||
          !eventLinks.some(({ externalId }) => externalId === String(record.eventId)) ||
          (record.primarySessionId == null ? String(record.id) : String(record.primarySessionId)) !==
            link.primaryExternalId ||
          (record.pairedSessionId == null ? null : String(record.pairedSessionId)) !== link.pairedExternalId
        )
          continue
        assertSolidarityEventImportDataset({ ...dataset, sessions: [record] })
        source = record
        break
      } catch {
        // Old imports may have untrusted or incomplete raw payloads; only use validated metadata.
      }
    }
    if (!source) {
      if (projection.deliveryMode === 'hybrid' || eventLinks.length !== 1) {
        throw new Error('Missing safe source metadata for Solidarity retirement')
      }
      source = {
        id: link.externalId,
        eventId: eventLinks[0]!.externalId,
        primarySessionId: link.primaryExternalId,
        pairedSessionId: link.pairedExternalId,
        eventType: projection.deliveryMode,
        title: projection.title,
        status: projection.status,
        startsAt: projection.startsAt,
        endsAt: projection.endsAt,
        timezone: projection.timezone,
        locationName: projection.locationName,
        locationAddress: projection.locationAddress,
        virtualUrl: projection.virtualUrl,
        rsvpUrl: projection.rsvpUrl
      }
    }
    return { ...source, status: 'canceled' }
  })
}

function summarizeChanges(projection: ImportPreview): SolidarityEventSyncChange[] {
  const safeFields = new Set([
    'title',
    'category',
    'visibility',
    'status',
    'timezone',
    'eventTags',
    'campaignTags',
    'deliveryMode',
    'startsAt',
    'endsAt',
    'meetingKind'
  ])
  const changes: SolidarityEventSyncChange[] = []
  for (const level of ['series', 'session'] as const) {
    for (const row of level === 'series' ? projection.events : projection.sessions) {
      const before = row.before as Record<string, unknown> | null
      const fields: SolidarityEventSyncChange['fields'] = Object.entries(row.after)
        .filter(([key, value]) => key !== 'id' && hash(before?.[key] ?? null) !== hash(value))
        .map(([field, value]) =>
          safeFields.has(field) ? { field, before: before?.[field] ?? null, after: value } : { field }
        )
      if (hash(row.linksBefore) !== hash(row.linksAfter)) fields.push({ field: 'providerLinks' })
      if (!before || fields.length)
        changes.push({ level, id: row.after.id, kind: before ? 'update' : 'create', fields })
    }
  }
  return changes
}

function validateCapture(input: SolidarityEventSyncCapture): SolidarityEventSyncCapture {
  assertFields(input, ['dataset', 'scope', 'observedAt'])
  assertFields(input.scope, ['eventIds', 'from', 'to'])
  assertFields(input.dataset, ['attendance', 'events', 'people', 'rsvps', 'sessions'])
  assertTimestamp(input.observedAt)
  assertTimestamp(input.scope.from)
  assertTimestamp(input.scope.to)
  if (input.scope.from >= input.scope.to) throw new TypeError('Solidarity scope from must precede to')
  if (
    !Array.isArray(input.scope.eventIds) ||
    input.scope.eventIds.some((id) => !validId(id)) ||
    new Set(input.scope.eventIds).size !== input.scope.eventIds.length
  ) {
    throw new TypeError('Solidarity scope must contain unique provider event IDs')
  }
  for (const key of ['attendance', 'events', 'people', 'rsvps', 'sessions'] as const) {
    if (!Array.isArray(input.dataset[key])) throw new TypeError('Solidarity capture requires all five dataset arrays')
  }
  if (input.dataset.attendance.length || input.dataset.people.length || input.dataset.rsvps.length) {
    throw new TypeError('Solidarity browser sync accepts event-only captures')
  }
  const eventIds = new Set(input.dataset.events.map(({ id }) => id))
  const sessionIds = new Set(input.dataset.sessions.map(({ id }) => id))
  for (const event of input.dataset.events) {
    assertFields(event, eventFields)
    if (
      !validId(event.id) ||
      !input.scope.eventIds.includes(event.id) ||
      (event.primaryEventId != null && (!validId(event.primaryEventId) || !eventIds.has(event.primaryEventId)))
    ) {
      throw new TypeError('Solidarity capture has an incomplete event inventory')
    }
    assertOptionalText(event.description, 10_000)
  }
  if (input.scope.eventIds.some((id) => !eventIds.has(id)))
    throw new TypeError('Solidarity capture is missing a covered event')
  for (const session of input.dataset.sessions) {
    assertFields(session, sessionFields)
    if (
      !validId(session.id) ||
      !eventIds.has(session.eventId) ||
      [session.primarySessionId, session.pairedSessionId].some(
        (id) => id != null && (!validId(id) || !sessionIds.has(id))
      )
    ) {
      throw new TypeError('Solidarity capture has an incomplete session inventory')
    }
    assertOptionalText(session.title, 255)
    assertOptionalText(session.locationName, 255)
    assertOptionalText(session.locationAddress, 500)
    if (session.endsAt != null) assertTimestamp(session.endsAt)
  }
  assertSolidarityEventImportDataset(input.dataset)
  return freeze(JSON.parse(JSON.stringify(input)) as SolidarityEventSyncCapture)
}

function assertFields(value: unknown, allowed: readonly string[]): void {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  ) {
    throw new TypeError('Solidarity capture contains unexpected fields or invalid metadata')
  }
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 && value.trim() === value
}

function assertOptionalText(value: unknown, maximum: number): void {
  if (value != null && (typeof value !== 'string' || value.length > maximum)) {
    throw new TypeError('Solidarity capture contains invalid text metadata')
  }
}

function assertTimestamp(value: unknown): void {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(new Date(value).getTime()) ||
    new Date(value).toISOString() !== value
  ) {
    throw new TypeError('Solidarity sync timestamps must be canonical UTC timestamps')
  }
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

function hash(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical)
    if (!item || typeof item !== 'object') return item
    return Object.fromEntries(
      Object.entries(item)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)])
    )
  }
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')
}
