import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { DatabaseConnection } from '../../db/connect'
import type { EventCategory, EventVisibility } from '../../db/schema/events'
import {
  normalizeSolidarityTaxonomyTags,
  solidarityAudienceTags,
  solidarityCategoryTags,
  solidarityMeetingTags
} from './solidarity-taxonomy'

type Sqlite = InstanceType<typeof Database>

export type SolidarityEventImportDataset = Readonly<{
  events: readonly SolidarityEventRecord[]
  sessions: readonly SolidaritySessionRecord[]
}>

type ExternalId = string | number

export const solidarityEventFields = [
  'campaignTags',
  'description',
  'eventPageUrl',
  'eventTags',
  'id',
  'primaryEventId',
  'status',
  'timezone',
  'title'
] as const
export const solidaritySessionFields = [
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
] as const

export type SolidarityEventRecord = Readonly<{
  campaignTags: readonly string[]
  description?: string | null
  eventPageUrl?: string | null
  eventTags: readonly string[]
  id: ExternalId
  primaryEventId?: ExternalId | null
  status: 'active' | 'archived'
  timezone: string
  title: string
}>

export type SolidaritySessionRecord = Readonly<{
  endsAt?: string | null
  eventId: ExternalId
  eventType: 'in_person' | 'virtual'
  id: ExternalId
  locationAddress?: string | null
  locationName?: string | null
  pairedSessionId?: ExternalId | null
  primarySessionId?: ExternalId | null
  rsvpUrl?: string | null
  startsAt: string
  status: 'canceled' | 'completed' | 'scheduled'
  timezone: string
  title?: string | null
  virtualUrl?: string | null
}>

export type SolidarityEventImportIssue = Readonly<{
  code: string
  externalId: string
  objectType: string
}>

export type SolidarityEventImportReport = Readonly<{
  batchId: string | null
  events: Readonly<{ hidden: number; imported: number }>
  issues: readonly SolidarityEventImportIssue[]
  mode: 'apply' | 'dry-run'
  sessions: Readonly<{ imported: number; providerLinks: number }>
  snapshots: Readonly<{ changed: number; unchanged: number }>
}>

export function assertSolidarityEventImportDataset(input: SolidarityEventImportDataset): void {
  normalizeDataset(input)
}

type NormalizedEvent = Omit<SolidarityEventRecord, 'id' | 'primaryEventId'> & {
  id: string
  primaryEventId: string | null
}

type NormalizedSession = Omit<SolidaritySessionRecord, 'eventId' | 'id' | 'pairedSessionId' | 'primarySessionId'> & {
  eventId: string
  id: string
  pairedSessionId: string | null
  primarySessionId: string | null
}

type NormalizedDataset = Readonly<{
  events: readonly NormalizedEvent[]
  sessions: readonly NormalizedSession[]
}>

type PreparedSnapshot = Readonly<{
  externalId: string
  objectType: string
  payloadHash: string
  rawPayload: string
}>

type EventPlan = Readonly<{
  canonicalExternalId: string
  category: EventCategory
  event: NormalizedEvent
  externalEvents: readonly NormalizedEvent[]
  localId: string
  visibility: EventVisibility
}>

type SessionPlan = Readonly<{
  deliveryMode: 'hybrid' | 'in_person' | 'virtual'
  eventPlan: EventPlan
  externalSessions: readonly NormalizedSession[]
  localId: string
  session: NormalizedSession
}>

type PreparedImport = Readonly<{
  eventPlans: readonly EventPlan[]
  issues: SolidarityEventImportIssue[]
  sessionPlans: readonly SessionPlan[]
  snapshots: readonly PreparedSnapshot[]
}>

const categoryByTag: Readonly<Record<(typeof solidarityCategoryTags)[number], EventCategory>> = Object.freeze({
  'category-action': 'action',
  'category-learning': 'learning',
  'category-meeting': 'meeting',
  'category-social': 'social'
})

export function importSolidarityEventDataset(
  connection: DatabaseConnection,
  input: SolidarityEventImportDataset,
  options: Readonly<{ apply: boolean; observedAt: Date; sourceName?: string }>
): SolidarityEventImportReport {
  if (Number.isNaN(options.observedAt.getTime())) {
    throw new TypeError('Solidarity import observedAt must be a valid date')
  }
  assertEventSchema(connection.sqlite)
  const dataset = normalizeDataset(input)
  const observedAt = options.observedAt.toISOString()
  const prepared = prepareImport(connection.sqlite, dataset)
  const snapshotCounts = countSnapshotChanges(connection.sqlite, prepared.snapshots)

  let batchId: string | null = null
  if (options.apply) {
    batchId = `import_solidarity_${randomUUID()}`
    applyImport(connection.sqlite, prepared, {
      batchId,
      observedAt,
      sourceName: normalizedText(options.sourceName, 255) ?? 'solidarity-event-export'
    })
  }

  return Object.freeze({
    batchId,
    events: Object.freeze({
      hidden: prepared.eventPlans.filter(({ visibility }) => visibility === 'hidden').length,
      imported: prepared.eventPlans.length
    }),
    issues: Object.freeze([...prepared.issues]),
    mode: options.apply ? 'apply' : 'dry-run',
    sessions: Object.freeze({
      imported: prepared.sessionPlans.length,
      providerLinks: prepared.sessionPlans.reduce((total, plan) => total + plan.externalSessions.length, 0)
    }),
    snapshots: Object.freeze(snapshotCounts)
  })
}

function assertEventSchema(sqlite: Sqlite): void {
  const required = [
    'event_provider_links',
    'event_session_provider_links',
    'event_sessions',
    'event_tags',
    'events',
    'external_record_snapshots',
    'import_batches'
  ]
  const rows = sqlite
    .prepare("select name from sqlite_master where type = 'table' and name in (select value from json_each(?))")
    .all(JSON.stringify(required)) as Array<{ name: string }>
  if (rows.length !== required.length) {
    throw new Error('The SQLite database is missing the event operations schema; run the packaged migrations first')
  }
}

function normalizeDataset(input: SolidarityEventImportDataset): NormalizedDataset {
  assertFields(input, ['events', 'sessions'], 'event dataset')
  for (const key of ['events', 'sessions'] as const) {
    if (!Array.isArray(input[key])) throw new TypeError(`Solidarity event import ${key} must be an array`)
  }
  const events = input.events.map((event) => {
    assertFields(event, solidarityEventFields, 'event')
    assertOptionalText(event.description, 'Solidarity event description', 10_000)
    assertText(event.title, 'Solidarity event title', 255)
    assertTimezone(event.timezone, 'Solidarity event timezone')
    assertEnum(event.status, ['active', 'archived'], 'Solidarity event status')
    assertTags(event.eventTags, 'Solidarity event tags')
    assertTags(event.campaignTags, 'Solidarity campaign tags')
    assertOptionalHttpsUrl(event.eventPageUrl, 'Solidarity event page URL')
    const taxonomyTags = normalizeSolidarityTaxonomyTags(event.eventTags, event.campaignTags)
    return {
      ...event,
      ...taxonomyTags,
      id: externalId(event.id, 'Solidarity event ID'),
      primaryEventId:
        event.primaryEventId === null || event.primaryEventId === undefined
          ? null
          : externalId(event.primaryEventId, 'Solidarity primary event ID')
    }
  })
  const sessions = input.sessions.map((session) => {
    assertFields(session, solidaritySessionFields, 'session')
    assertOptionalText(session.title, 'Solidarity session title', 255)
    assertOptionalText(session.locationName, 'Solidarity session location name', 255)
    assertOptionalText(session.locationAddress, 'Solidarity session address', 500)
    assertEnum(session.status, ['canceled', 'completed', 'scheduled'], 'Solidarity session status')
    assertEnum(session.eventType, ['in_person', 'virtual'], 'Solidarity session event type')
    canonicalUtcTimestamp(session.startsAt, 'Solidarity session startsAt')
    if (session.endsAt) canonicalUtcTimestamp(session.endsAt, 'Solidarity session endsAt')
    if (session.endsAt && session.endsAt < session.startsAt) {
      throw new TypeError('Solidarity session endsAt cannot be before startsAt')
    }
    assertTimezone(session.timezone, 'Solidarity session timezone')
    assertOptionalHttpsUrl(session.virtualUrl, 'Solidarity session virtual URL')
    assertOptionalHttpsUrl(session.rsvpUrl, 'Solidarity session RSVP URL')
    return {
      ...session,
      eventId: externalId(session.eventId, 'Solidarity session event ID'),
      id: externalId(session.id, 'Solidarity session ID'),
      pairedSessionId:
        session.pairedSessionId === null || session.pairedSessionId === undefined
          ? null
          : externalId(session.pairedSessionId, 'Solidarity paired session ID'),
      primarySessionId:
        session.primarySessionId === null || session.primarySessionId === undefined
          ? null
          : externalId(session.primarySessionId, 'Solidarity primary session ID')
    }
  })
  assertUniqueIds(events, 'event')
  assertUniqueIds(sessions, 'session')
  return Object.freeze({ events, sessions })
}

function prepareImport(sqlite: Sqlite, dataset: NormalizedDataset): PreparedImport {
  const issues: SolidarityEventImportIssue[] = []
  const eventPlans = prepareEvents(sqlite, dataset.events, issues)
  const eventByExternalId = new Map<string, EventPlan>()
  for (const plan of eventPlans) {
    for (const event of plan.externalEvents) eventByExternalId.set(event.id, plan)
  }
  const sessionPlans = prepareSessions(sqlite, dataset.sessions, eventByExternalId, issues)
  return Object.freeze({ eventPlans, issues, sessionPlans, snapshots: prepareSnapshots(dataset) })
}

function prepareEvents(
  sqlite: Sqlite,
  events: readonly NormalizedEvent[],
  issues: SolidarityEventImportIssue[]
): readonly EventPlan[] {
  const existingLinks = sqlite.prepare(
    `select distinct event_id as localId from event_provider_links
     where provider = 'solidarity' and (external_id = ? or primary_external_id = ?)`
  )
  const groups = groupBy(events, (event) => event.primaryEventId ?? event.id)
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([canonicalExternalId, externalEvents]) => {
      const event =
        externalEvents.find((candidate) => candidate.id === canonicalExternalId) ??
        [...externalEvents].sort((left, right) => left.id.localeCompare(right.id))[0]!
      const existingLocalIds = new Set(
        externalEvents.flatMap((candidate) =>
          (existingLinks.all(candidate.id, candidate.id) as Array<{ localId: string }>).map(({ localId }) => localId)
        )
      )
      if (existingLocalIds.size > 1) {
        throw new Error('Related Solidarity events are already linked to different local events')
      }
      const classification = classifyEvent(event, issues)
      return Object.freeze({
        canonicalExternalId,
        ...classification,
        event,
        externalEvents: Object.freeze([...externalEvents]),
        localId: [...existingLocalIds][0] ?? deterministicId('solidarity_event', canonicalExternalId)
      })
    })
}

function classifyEvent(
  event: NormalizedEvent,
  issues: SolidarityEventImportIssue[]
): Readonly<{ category: EventCategory; visibility: EventVisibility }> {
  const tags = new Set(event.eventTags)
  const audiences = solidarityAudienceTags.filter((tag) => tags.has(tag))
  const categories = solidarityCategoryTags.filter((tag) => tags.has(tag))
  let visibility: EventVisibility = audiences[0] === 'audience-public' ? 'public' : 'members'
  if (audiences.length !== 1) {
    visibility = 'hidden'
    issue(issues, 'invalid_audience_tags', 'solidarity.event', event.id)
  }
  const category: EventCategory = categories[0] ? categoryByTag[categories[0]] : 'social'
  if (categories.length !== 1) {
    visibility = 'hidden'
    issue(issues, 'invalid_category_tags', 'solidarity.event', event.id)
  }
  const meetingTags = solidarityMeetingTags.filter((tag) => tags.has(tag))
  if ((category === 'meeting' && meetingTags.length !== 1) || (category !== 'meeting' && meetingTags.length > 0)) {
    visibility = 'hidden'
    issue(issues, 'invalid_meeting_tags', 'solidarity.event', event.id)
  }
  return { category, visibility }
}

function prepareSessions(
  sqlite: Sqlite,
  sessions: readonly NormalizedSession[],
  eventByExternalId: ReadonlyMap<string, EventPlan>,
  issues: SolidarityEventImportIssue[]
): readonly SessionPlan[] {
  const existingLinks = sqlite.prepare(
    `select distinct event_session_id as localId from event_session_provider_links
     where provider = 'solidarity'
       and (external_id = ? or primary_external_id = ? or paired_external_id = ?)`
  )
  const canonicalByExternal = canonicalSessionIds(sessions)
  const groups = groupBy(sessions, (session) => canonicalByExternal.get(session.id)!)
  const plans = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([canonicalExternalId, externalSessions]) => {
      const session =
        externalSessions.find((candidate) => candidate.id === canonicalExternalId) ??
        [...externalSessions].sort((left, right) => left.id.localeCompare(right.id))[0]!
      const existingLocalIds = new Set(
        externalSessions.flatMap((candidate) =>
          (existingLinks.all(candidate.id, candidate.id, candidate.id) as Array<{ localId: string }>).map(
            ({ localId }) => localId
          )
        )
      )
      if (existingLocalIds.size > 1) {
        throw new Error('Paired Solidarity sessions are already linked to different local sessions')
      }
      const eventPlans = new Set(externalSessions.map((candidate) => eventByExternalId.get(candidate.eventId)))
      if (eventPlans.has(undefined) || eventPlans.size !== 1) {
        throw new Error(`Solidarity session ${session.id} does not resolve to exactly one imported event`)
      }
      const eventPlan = [...eventPlans][0]!
      const eventTypes = new Set(externalSessions.map(({ eventType }) => eventType))
      const deliveryMode = eventTypes.size > 1 ? 'hybrid' : session.eventType
      if (new Set(externalSessions.map(({ startsAt }) => startsAt)).size > 1) {
        issue(issues, 'paired_session_time_conflict', 'solidarity.session', session.id)
      }
      return Object.freeze({
        deliveryMode,
        eventPlan,
        externalSessions: Object.freeze([...externalSessions]),
        localId: [...existingLocalIds][0] ?? deterministicId('solidarity_session', canonicalExternalId),
        session
      })
    })
  return Object.freeze(plans)
}

function canonicalSessionIds(sessions: readonly NormalizedSession[]): ReadonlyMap<string, string> {
  const declaredCanonical = new Map(sessions.map((session) => [session.id, session.primarySessionId ?? session.id]))
  const parent = new Map<string, string>()
  const find = (value: string): string => {
    const current = parent.get(value) ?? value
    if (current === value) return value
    const root = find(current)
    parent.set(value, root)
    return root
  }
  const union = (left: string, right: string) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot === rightRoot) return
    const [first, second] = [leftRoot, rightRoot].sort()
    parent.set(second!, first!)
  }
  for (const session of sessions) {
    const canonical = session.primarySessionId ?? session.id
    parent.set(canonical, parent.get(canonical) ?? canonical)
    if (session.pairedSessionId) {
      union(canonical, declaredCanonical.get(session.pairedSessionId) ?? session.pairedSessionId)
    }
  }
  return new Map(sessions.map((session) => [session.id, find(session.primarySessionId ?? session.id)]))
}

function prepareSnapshots(dataset: NormalizedDataset): readonly PreparedSnapshot[] {
  const snapshots: PreparedSnapshot[] = []
  const add = (objectType: string, externalId: string, value: unknown) => {
    const rawPayload = canonicalJson(value)
    snapshots.push({ externalId, objectType, payloadHash: sha256(rawPayload), rawPayload })
  }
  for (const record of dataset.events) add('solidarity.event', record.id, record)
  for (const record of dataset.sessions) add('solidarity.session', record.id, record)
  return Object.freeze(snapshots.sort(compareSnapshots))
}

function countSnapshotChanges(
  sqlite: Sqlite,
  snapshots: readonly PreparedSnapshot[]
): { changed: number; unchanged: number } {
  const latest = sqlite.prepare(
    `select payload_hash as payloadHash from external_record_snapshots
     where object_type = ? and external_id = ? order by observed_at desc, rowid desc limit 1`
  )
  let changed = 0
  let unchanged = 0
  for (const snapshot of snapshots) {
    const row = latest.get(snapshot.objectType, snapshot.externalId) as { payloadHash: string } | undefined
    if (row?.payloadHash === snapshot.payloadHash) unchanged += 1
    else changed += 1
  }
  return { changed, unchanged }
}

function eventProjection(plan: EventPlan) {
  return {
    id: plan.localId,
    title: plan.event.title.trim(),
    description: normalizedText(plan.event.description, 10_000),
    category: plan.category,
    visibility: plan.visibility,
    status: plan.event.status,
    timezone: plan.event.timezone.trim(),
    eventPageUrl: normalizedText(plan.event.eventPageUrl, 2_000),
    eventTags: uniqueTags(plan.event.eventTags),
    campaignTags: uniqueTags(plan.event.campaignTags)
  }
}

function sessionProjection(plan: SessionPlan) {
  const inPerson = plan.externalSessions.find(({ eventType }) => eventType === 'in_person')
  const virtual = plan.externalSessions.find(({ eventType }) => eventType === 'virtual')
  return {
    id: plan.localId,
    eventId: plan.eventPlan.localId,
    title: normalizedText(plan.session.title, 255),
    status: combinedSessionStatus(plan.externalSessions),
    deliveryMode: plan.deliveryMode,
    startsAt: plan.session.startsAt,
    endsAt: plan.session.endsAt ?? null,
    timezone: plan.session.timezone.trim(),
    locationName: normalizedText(inPerson?.locationName ?? plan.session.locationName, 255),
    locationAddress: normalizedText(inPerson?.locationAddress ?? plan.session.locationAddress, 500),
    virtualUrl: normalizedText(virtual?.virtualUrl ?? plan.session.virtualUrl, 2_000),
    rsvpUrl: normalizedText(plan.externalSessions.find(({ rsvpUrl }) => rsvpUrl)?.rsvpUrl, 2_000)
  }
}

export type SolidarityEventProjection = ReturnType<typeof eventProjection>
export type SolidaritySessionProjection = ReturnType<typeof sessionProjection>
export type SolidarityEventProjectionLink = {
  externalId: string
  primaryExternalId: string | null
  sourceUrl: string | null
}
export type SolidaritySessionProjectionLink = {
  externalId: string
  primaryExternalId: string | null
  pairedExternalId: string | null
}

export function readSolidarityEventImportState(
  connection: DatabaseConnection,
  ids: Readonly<{ eventIds: readonly string[]; sessionIds: readonly string[] }>
) {
  const sqlite = connection.sqlite
  const events = [...new Set(ids.eventIds)].sort().map((id) => {
    const row = sqlite
      .prepare(
        `select id, title, description, kind as category, visibility, status,
      default_timezone as timezone, event_page_url as eventPageUrl from events where id = ?`
      )
      .get(id) as Omit<SolidarityEventProjection, 'eventTags' | 'campaignTags'> | undefined
    const tags = sqlite
      .prepare('select kind, value from event_tags where event_id = ? order by value')
      .all(id) as Array<{ kind: string; value: string }>
    const projection: SolidarityEventProjection | null = row
      ? {
          ...row,
          eventTags: tags.filter(({ kind }) => kind === 'event').map(({ value }) => value),
          campaignTags: tags.filter(({ kind }) => kind === 'campaign').map(({ value }) => value)
        }
      : null
    const links = sqlite
      .prepare(
        `select external_id as externalId, primary_external_id as primaryExternalId,
      source_url as sourceUrl from event_provider_links where provider = 'solidarity' and event_id = ?
      order by external_id`
      )
      .all(id) as SolidarityEventProjectionLink[]
    return { id, projection, links }
  })
  const sessions = [...new Set(ids.sessionIds)].sort().map((id) => {
    const projection = sqlite
      .prepare(
        `select s.id, s.event_id as eventId, s.title, s.status,
      s.delivery_mode as deliveryMode, s.starts_at as startsAt, s.ends_at as endsAt, s.timezone,
      s.location_name as locationName, s.location as locationAddress, s.virtual_url as virtualUrl,
      s.rsvp_url as rsvpUrl from event_sessions s where s.id = ?`
      )
      .get(id) as SolidaritySessionProjection | undefined
    const links = sqlite
      .prepare(
        `select external_id as externalId, primary_external_id as primaryExternalId,
      paired_external_id as pairedExternalId from event_session_provider_links
      where provider = 'solidarity' and event_session_id = ? order by external_id`
      )
      .all(id) as SolidaritySessionProjectionLink[]
    return { id, projection: projection ?? null, links }
  })
  return { events, sessions }
}

// Preview and persistence deliberately share both identity planning and field projection.
export function previewSolidarityEventImport(connection: DatabaseConnection, input: SolidarityEventImportDataset) {
  assertEventSchema(connection.sqlite)
  const prepared = prepareImport(connection.sqlite, normalizeDataset(input))
  const before = readSolidarityEventImportState(connection, {
    eventIds: prepared.eventPlans.map(({ localId }) => localId),
    sessionIds: prepared.sessionPlans.map(({ localId }) => localId)
  })
  const mergeLinks = <T extends { externalId: string }>(stored: readonly T[], incoming: readonly T[]): T[] =>
    [...new Map([...stored, ...incoming].map((link) => [link.externalId, link])).values()].sort((left, right) =>
      left.externalId < right.externalId ? -1 : left.externalId > right.externalId ? 1 : 0
    )
  return {
    issues: prepared.issues,
    events: prepared.eventPlans.map((plan) => {
      const stored = before.events.find(({ id }) => id === plan.localId)!
      return {
        before: stored.projection,
        after: eventProjection(plan),
        externalIds: plan.externalEvents.map(({ id }) => id),
        linksBefore: stored.links,
        linksAfter: mergeLinks(
          stored.links,
          plan.externalEvents.map((event) => ({
            externalId: event.id,
            primaryExternalId: event.primaryEventId ?? event.id,
            sourceUrl: normalizedText(event.eventPageUrl, 2_000)
          }))
        )
      }
    }),
    sessions: prepared.sessionPlans.map((plan) => {
      const stored = before.sessions.find(({ id }) => id === plan.localId)!
      if (stored.projection && stored.projection.eventId !== plan.eventPlan.localId) {
        throw new Error('An existing event session cannot be reassigned to another event')
      }
      return {
        before: stored.projection,
        after: sessionProjection(plan),
        externalIds: plan.externalSessions.map(({ id }) => id),
        linksBefore: stored.links,
        linksAfter: mergeLinks(
          stored.links,
          plan.externalSessions.map((session) => ({
            externalId: session.id,
            primaryExternalId: session.primarySessionId ?? session.id,
            pairedExternalId: session.pairedSessionId
          }))
        )
      }
    })
  }
}

function applyImport(
  sqlite: Sqlite,
  prepared: PreparedImport,
  context: Readonly<{ batchId: string; observedAt: string; sourceName: string }>
): void {
  const sourceChecksum = sha256(
    prepared.snapshots
      .map((snapshot) => `${snapshot.objectType}\0${snapshot.externalId}\0${snapshot.payloadHash}`)
      .join('\n')
  )
  sqlite
    .prepare(
      `insert into import_batches (id, provider, status, source_name, source_checksum, started_at)
       values (?, 'solidarity', 'pending', ?, ?, ?)`
    )
    .run(context.batchId, context.sourceName, sourceChecksum, context.observedAt)

  const transaction = sqlite.transaction(() => {
    const snapshotIds = persistSnapshots(sqlite, prepared.snapshots, context)
    persistEvents(sqlite, prepared.eventPlans, snapshotIds, context.observedAt)
    persistSessions(sqlite, prepared.sessionPlans, snapshotIds, context.observedAt)
    sqlite
      .prepare(
        `update import_batches set status = 'completed', completed_at = ?, record_count = ?, updated_at = ?
         where id = ?`
      )
      .run(context.observedAt, prepared.snapshots.length, context.observedAt, context.batchId)
  })

  try {
    transaction.immediate()
  } catch (error) {
    sqlite
      .prepare(`update import_batches set status = 'failed', completed_at = ?, updated_at = ? where id = ?`)
      .run(context.observedAt, context.observedAt, context.batchId)
    throw error
  }
}

function persistSnapshots(
  sqlite: Sqlite,
  snapshots: readonly PreparedSnapshot[],
  context: Readonly<{ batchId: string; observedAt: string }>
): ReadonlyMap<string, string> {
  const ids = new Map<string, string>()
  const latest = sqlite.prepare(
    `select id, payload_hash as payloadHash from external_record_snapshots
     where object_type = ? and external_id = ? order by observed_at desc, rowid desc limit 1`
  )
  const insert = sqlite.prepare(
    `insert into external_record_snapshots
       (id, import_batch_id, object_type, external_id, observed_at, payload_hash, raw_payload)
     values (?, ?, ?, ?, ?, ?, ?)`
  )
  for (const snapshot of snapshots) {
    const key = snapshotKey(snapshot.objectType, snapshot.externalId)
    const previous = latest.get(snapshot.objectType, snapshot.externalId) as
      { id: string; payloadHash: string } | undefined
    if (previous?.payloadHash === snapshot.payloadHash) {
      ids.set(key, previous.id)
      continue
    }
    const id = deterministicId('solidarity_snapshot', `${context.batchId}\0${key}`)
    insert.run(
      id,
      context.batchId,
      snapshot.objectType,
      snapshot.externalId,
      context.observedAt,
      snapshot.payloadHash,
      snapshot.rawPayload
    )
    ids.set(key, id)
  }
  return ids
}

function persistEvents(
  sqlite: Sqlite,
  plans: readonly EventPlan[],
  snapshotIds: ReadonlyMap<string, string>,
  observedAt: string
): void {
  const upsertEvent = sqlite.prepare(
    `insert into events
       (id, title, description, kind, visibility, status, default_timezone, event_page_url,
        source_snapshot_id, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set title = excluded.title, description = excluded.description,
       kind = excluded.kind, visibility = excluded.visibility, status = excluded.status,
       default_timezone = excluded.default_timezone, event_page_url = excluded.event_page_url,
       source_snapshot_id = excluded.source_snapshot_id, updated_at = excluded.updated_at`
  )
  const clearTags = sqlite.prepare('delete from event_tags where event_id = ?')
  const insertTag = sqlite.prepare(
    `insert into event_tags (event_id, kind, value, source_snapshot_id, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?)`
  )
  const existingLink = sqlite.prepare(
    `select event_id as eventId from event_provider_links where provider = 'solidarity' and external_id = ?`
  )
  const upsertLink = sqlite.prepare(
    `insert into event_provider_links
       (id, event_id, provider, external_id, primary_external_id, source_url, last_seen_at,
        source_snapshot_id, created_at, updated_at)
     values (?, ?, 'solidarity', ?, ?, ?, ?, ?, ?, ?)
     on conflict(provider, external_id) do update set primary_external_id = excluded.primary_external_id,
       source_url = excluded.source_url, last_seen_at = excluded.last_seen_at,
       source_snapshot_id = excluded.source_snapshot_id, updated_at = excluded.updated_at`
  )
  for (const plan of plans) {
    const projection = eventProjection(plan)
    const eventSnapshotId = snapshotId(snapshotIds, 'solidarity.event', plan.event.id)
    upsertEvent.run(
      projection.id,
      projection.title,
      projection.description,
      projection.category,
      projection.visibility,
      projection.status,
      projection.timezone,
      projection.eventPageUrl,
      eventSnapshotId,
      observedAt,
      observedAt
    )
    clearTags.run(plan.localId)
    for (const value of projection.eventTags) {
      insertTag.run(plan.localId, 'event', value, eventSnapshotId, observedAt, observedAt)
    }
    for (const value of projection.campaignTags) {
      insertTag.run(plan.localId, 'campaign', value, eventSnapshotId, observedAt, observedAt)
    }
    for (const externalEvent of plan.externalEvents) {
      const previous = existingLink.get(externalEvent.id) as { eventId: string } | undefined
      if (previous && previous.eventId !== plan.localId) {
        throw new Error('An existing Solidarity event identity cannot be reassigned')
      }
      upsertLink.run(
        deterministicId('solidarity_event_link', externalEvent.id),
        plan.localId,
        externalEvent.id,
        externalEvent.primaryEventId ?? externalEvent.id,
        normalizedText(externalEvent.eventPageUrl, 2_000),
        observedAt,
        snapshotId(snapshotIds, 'solidarity.event', externalEvent.id),
        observedAt,
        observedAt
      )
    }
  }
}

function persistSessions(
  sqlite: Sqlite,
  plans: readonly SessionPlan[],
  snapshotIds: ReadonlyMap<string, string>,
  observedAt: string
): void {
  const existingSession = sqlite.prepare('select event_id as eventId from event_sessions where id = ?')
  const upsertSession = sqlite.prepare(
    `insert into event_sessions
       (id, event_id, title, status, delivery_mode, starts_at, ends_at, timezone, location_name,
        location, virtual_url, rsvp_url, source_snapshot_id, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set title = excluded.title, status = excluded.status,
       delivery_mode = excluded.delivery_mode, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
       timezone = excluded.timezone, location_name = excluded.location_name,
       location = excluded.location, virtual_url = excluded.virtual_url,
       rsvp_url = excluded.rsvp_url, source_snapshot_id = excluded.source_snapshot_id,
       updated_at = excluded.updated_at`
  )
  const existingLink = sqlite.prepare(
    `select event_session_id as sessionId from event_session_provider_links
     where provider = 'solidarity' and external_id = ?`
  )
  const upsertLink = sqlite.prepare(
    `insert into event_session_provider_links
       (id, event_session_id, provider, external_id, primary_external_id, paired_external_id,
        last_seen_at, source_snapshot_id, created_at, updated_at)
     values (?, ?, 'solidarity', ?, ?, ?, ?, ?, ?, ?)
     on conflict(provider, external_id) do update set primary_external_id = excluded.primary_external_id,
       paired_external_id = excluded.paired_external_id, last_seen_at = excluded.last_seen_at,
       source_snapshot_id = excluded.source_snapshot_id, updated_at = excluded.updated_at`
  )
  for (const plan of plans) {
    const previous = existingSession.get(plan.localId) as { eventId: string } | undefined
    if (previous && previous.eventId !== plan.eventPlan.localId) {
      throw new Error('An existing event session cannot be reassigned to another event')
    }
    const projection = sessionProjection(plan)
    const sourceSnapshotId = snapshotId(snapshotIds, 'solidarity.session', plan.session.id)
    upsertSession.run(
      projection.id,
      projection.eventId,
      projection.title,
      projection.status,
      projection.deliveryMode,
      projection.startsAt,
      projection.endsAt,
      projection.timezone,
      projection.locationName,
      projection.locationAddress,
      projection.virtualUrl,
      projection.rsvpUrl,
      sourceSnapshotId,
      observedAt,
      observedAt
    )
    for (const externalSession of plan.externalSessions) {
      const linked = existingLink.get(externalSession.id) as { sessionId: string } | undefined
      if (linked && linked.sessionId !== plan.localId) {
        throw new Error('An existing Solidarity session identity cannot be reassigned')
      }
      upsertLink.run(
        deterministicId('solidarity_session_link', externalSession.id),
        plan.localId,
        externalSession.id,
        externalSession.primarySessionId ?? externalSession.id,
        externalSession.pairedSessionId,
        observedAt,
        snapshotId(snapshotIds, 'solidarity.session', externalSession.id),
        observedAt,
        observedAt
      )
    }
  }
}

function combinedSessionStatus(sessions: readonly NormalizedSession[]): 'canceled' | 'completed' | 'scheduled' {
  if (sessions.every(({ status }) => status === 'completed')) return 'completed'
  if (sessions.some(({ status }) => status === 'canceled')) return 'canceled'
  return 'scheduled'
}

function snapshotId(ids: ReadonlyMap<string, string>, objectType: string, externalId: string): string {
  const value = ids.get(snapshotKey(objectType, externalId))
  if (!value) throw new Error(`Missing persisted snapshot for ${objectType}`)
  return value
}

function snapshotKey(objectType: string, externalId: string): string {
  return `${objectType}\0${externalId}`
}

function compareSnapshots(left: PreparedSnapshot, right: PreparedSnapshot): number {
  return left.objectType.localeCompare(right.objectType) || left.externalId.localeCompare(right.externalId)
}

function issue(issues: SolidarityEventImportIssue[], code: string, objectType: string, externalId: string): void {
  issues.push(Object.freeze({ code, externalId, objectType }))
}

function groupBy<T>(values: readonly T[], key: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const value of values) {
    const groupKey = key(value)
    const group = groups.get(groupKey)
    if (group) group.push(value)
    else groups.set(groupKey, [value])
  }
  return groups
}

function uniqueTags(tags: readonly string[]): readonly string[] {
  return [...new Set(tags.map((tag) => tag.trim()))].sort()
}

function normalizedText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized && normalized.length <= maximumLength ? normalized : null
}

function externalId(value: unknown, label: string): string {
  if (typeof value !== 'string' && typeof value !== 'number') throw new TypeError(`${label} is required`)
  const normalized = String(value).trim()
  if (!normalized || normalized.length > 255) throw new TypeError(`${label} must contain 1 to 255 characters`)
  return normalized
}

function canonicalUtcTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a canonical UTC timestamp`)
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical UTC timestamp`)
  }
  return value
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Solidarity ${label} must be an object`)
  }
}

function assertFields(value: unknown, allowed: readonly string[], label: string): void {
  assertObject(value, label)
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new TypeError(`Solidarity ${label} contains unsupported fields`)
  }
}

function assertOptionalText(value: unknown, label: string, maximumLength: number): void {
  if (value != null && (typeof value !== 'string' || value.length > maximumLength)) {
    throw new TypeError(`${label} must be text of at most ${maximumLength} characters`)
  }
}

function assertText(value: unknown, label: string, maximumLength: number): void {
  if (!normalizedText(value, maximumLength)) throw new TypeError(`${label} is required`)
}

function assertTimezone(value: unknown, label: string): void {
  assertText(value, label, 100)
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value as string })
  } catch {
    throw new TypeError(`${label} is not supported`)
  }
}

function assertTags(value: unknown, label: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.some((tag) => !normalizedText(tag, 100))) {
    throw new TypeError(`${label} must be an array of non-empty strings no longer than 100 characters`)
  }
}

function assertOptionalHttpsUrl(value: unknown, label: string): void {
  if (value === undefined || value === null || value === '') return
  if (typeof value !== 'string' || value.length > 2_000) throw new TypeError(`${label} must be an HTTPS URL`)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError(`${label} must be an HTTPS URL`)
  }
  if (url.protocol !== 'https:') throw new TypeError(`${label} must be an HTTPS URL`)
}

function assertEnum<T extends string>(value: unknown, values: readonly T[], label: string): asserts value is T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new TypeError(`${label} is not supported`)
  }
}

function assertUniqueIds(values: readonly Readonly<{ id: string }>[], label: string): void {
  const seen = new Set<string>()
  for (const { id } of values) {
    if (seen.has(id)) throw new TypeError(`Solidarity event import contains duplicate ${label} ID ${id}`)
    seen.add(id)
  }
}

function deterministicId(prefix: string, value: string): string {
  return `${prefix}_${sha256(value).slice(0, 32)}`
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)])
  )
}
