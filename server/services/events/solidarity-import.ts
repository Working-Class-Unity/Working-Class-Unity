import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { DatabaseConnection } from '../../db/connect'
import type { AttendanceStatus, EventCategory, EventVisibility, RsvpStatus } from '../../db/schema/events'
import { recalculateMembershipStandingInTransaction } from '../membership/membership-standing'

type Sqlite = InstanceType<typeof Database>

export type SolidarityEventImportDataset = Readonly<{
  attendance: readonly SolidarityAttendanceRecord[]
  events: readonly SolidarityEventRecord[]
  people: readonly SolidarityPersonRecord[]
  rsvps: readonly SolidarityRsvpRecord[]
  sessions: readonly SolidaritySessionRecord[]
}>

type ExternalId = string | number

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

export type SolidarityPersonRecord = Readonly<{
  displayName?: string | null
  email?: string | null
  firstName?: string | null
  id: ExternalId
  lastName?: string | null
  phone?: string | null
}>

export type SolidarityRsvpRecord = Readonly<{
  id: ExternalId
  respondedAt: string
  sessionId: ExternalId
  status: RsvpStatus
  userId: ExternalId
}>

export type SolidarityAttendanceRecord = Readonly<{
  checkedInAt?: string | null
  checkedOutAt?: string | null
  id: ExternalId
  recordedAt: string
  sessionId: ExternalId
  status: AttendanceStatus
  userId: ExternalId
}>

export type SolidarityEventImportIssue = Readonly<{
  code: string
  externalId: string
  objectType: string
}>

export type SolidarityEventImportReport = Readonly<{
  activities: Readonly<{ attendance: number; rsvps: number }>
  batchId: string | null
  events: Readonly<{ hidden: number; imported: number }>
  identities: Readonly<{ ambiguous: number; created: number; existing: number }>
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

type NormalizedPerson = Omit<SolidarityPersonRecord, 'id'> & { id: string }
type NormalizedRsvp = Omit<SolidarityRsvpRecord, 'id' | 'sessionId' | 'userId'> & {
  id: string
  sessionId: string
  userId: string
}
type NormalizedAttendance = Omit<SolidarityAttendanceRecord, 'id' | 'sessionId' | 'userId'> & {
  id: string
  sessionId: string
  userId: string
}

type NormalizedDataset = Readonly<{
  attendance: readonly NormalizedAttendance[]
  events: readonly NormalizedEvent[]
  people: readonly NormalizedPerson[]
  rsvps: readonly NormalizedRsvp[]
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
  meetingKind: 'general' | 'steering' | null
  visibility: EventVisibility
}>

type SessionPlan = Readonly<{
  deliveryMode: 'hybrid' | 'in_person' | 'virtual'
  eventPlan: EventPlan
  externalSessions: readonly NormalizedSession[]
  localId: string
  session: NormalizedSession
}>

type PersonPlan = Readonly<{
  action: 'ambiguous' | 'created' | 'existing'
  person: NormalizedPerson
  personId: string | null
}>

type PreparedImport = Readonly<{
  attendance: readonly Readonly<{ record: NormalizedAttendance; personId: string; sessionId: string }>[]
  eventPlans: readonly EventPlan[]
  issues: SolidarityEventImportIssue[]
  personPlans: readonly PersonPlan[]
  rsvps: readonly Readonly<{ record: NormalizedRsvp; personId: string; sessionId: string }>[]
  sessionPlans: readonly SessionPlan[]
  snapshots: readonly PreparedSnapshot[]
}>

const audienceTags = ['audience-members', 'audience-public'] as const
const categoryTags = ['category-action', 'category-learning', 'category-meeting', 'category-social'] as const
const categoryByTag: Readonly<Record<(typeof categoryTags)[number], EventCategory>> = Object.freeze({
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
    activities: Object.freeze({ attendance: prepared.attendance.length, rsvps: prepared.rsvps.length }),
    batchId,
    events: Object.freeze({
      hidden: prepared.eventPlans.filter(({ visibility }) => visibility === 'hidden').length,
      imported: prepared.eventPlans.length
    }),
    identities: Object.freeze({
      ambiguous: prepared.personPlans.filter(({ action }) => action === 'ambiguous').length,
      created: prepared.personPlans.filter(({ action }) => action === 'created').length,
      existing: prepared.personPlans.filter(({ action }) => action === 'existing').length
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
    'attendance',
    'event_provider_links',
    'event_session_provider_links',
    'event_sessions',
    'event_tags',
    'events',
    'external_record_snapshots',
    'import_batches',
    'people',
    'provider_identities',
    'rsvps'
  ]
  const rows = sqlite
    .prepare("select name from sqlite_master where type = 'table' and name in (select value from json_each(?))")
    .all(JSON.stringify(required)) as Array<{ name: string }>
  if (rows.length !== required.length) {
    throw new Error('The SQLite database is missing the event operations schema; run the packaged migrations first')
  }
}

function normalizeDataset(input: SolidarityEventImportDataset): NormalizedDataset {
  if (!input || typeof input !== 'object') throw new TypeError('Solidarity event import must be an object')
  for (const key of ['attendance', 'events', 'people', 'rsvps', 'sessions'] as const) {
    if (!Array.isArray(input[key])) throw new TypeError(`Solidarity event import ${key} must be an array`)
  }
  const events = input.events.map((event) => {
    assertObject(event, 'event')
    assertText(event.title, 'Solidarity event title', 255)
    assertTimezone(event.timezone, 'Solidarity event timezone')
    assertEnum(event.status, ['active', 'archived'], 'Solidarity event status')
    assertTags(event.eventTags, 'Solidarity event tags')
    assertTags(event.campaignTags, 'Solidarity campaign tags')
    assertOptionalHttpsUrl(event.eventPageUrl, 'Solidarity event page URL')
    return {
      ...event,
      id: externalId(event.id, 'Solidarity event ID'),
      primaryEventId:
        event.primaryEventId === null || event.primaryEventId === undefined
          ? null
          : externalId(event.primaryEventId, 'Solidarity primary event ID')
    }
  })
  const sessions = input.sessions.map((session) => {
    assertObject(session, 'session')
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
  const people = input.people.map((person) => {
    assertObject(person, 'person')
    return { ...person, id: externalId(person.id, 'Solidarity person ID') }
  })
  const rsvps = input.rsvps.map((rsvp) => {
    assertObject(rsvp, 'RSVP')
    assertEnum(rsvp.status, ['canceled', 'maybe', 'no', 'waitlisted', 'yes'], 'Solidarity RSVP status')
    canonicalUtcTimestamp(rsvp.respondedAt, 'Solidarity RSVP respondedAt')
    return {
      ...rsvp,
      id: externalId(rsvp.id, 'Solidarity RSVP ID'),
      sessionId: externalId(rsvp.sessionId, 'Solidarity RSVP session ID'),
      userId: externalId(rsvp.userId, 'Solidarity RSVP user ID')
    }
  })
  const attendance = input.attendance.map((record) => {
    assertObject(record, 'attendance')
    assertEnum(record.status, ['absent', 'attended', 'excused', 'unknown'], 'Solidarity attendance status')
    canonicalUtcTimestamp(record.recordedAt, 'Solidarity attendance recordedAt')
    if (record.checkedInAt) canonicalUtcTimestamp(record.checkedInAt, 'Solidarity attendance checkedInAt')
    if (record.checkedOutAt) canonicalUtcTimestamp(record.checkedOutAt, 'Solidarity attendance checkedOutAt')
    if (record.checkedOutAt && !record.checkedInAt) {
      throw new TypeError('Solidarity attendance checkedOutAt requires checkedInAt')
    }
    if (record.checkedInAt && record.checkedOutAt && record.checkedOutAt < record.checkedInAt) {
      throw new TypeError('Solidarity attendance checkedOutAt cannot be before checkedInAt')
    }
    return {
      ...record,
      id: externalId(record.id, 'Solidarity attendance ID'),
      sessionId: externalId(record.sessionId, 'Solidarity attendance session ID'),
      userId: externalId(record.userId, 'Solidarity attendance user ID')
    }
  })
  assertUniqueIds(events, 'event')
  assertUniqueIds(sessions, 'session')
  assertUniqueIds(people, 'person')
  assertUniqueIds(rsvps, 'RSVP')
  assertUniqueIds(attendance, 'attendance')
  assertUniqueActivitySubjects(rsvps, 'RSVP')
  assertUniqueActivitySubjects(attendance, 'attendance')
  const canonicalSessionByExternalId = canonicalSessionIds(sessions)
  assertUniqueCanonicalActivitySubjects(rsvps, 'RSVP', canonicalSessionByExternalId)
  assertUniqueCanonicalActivitySubjects(attendance, 'attendance', canonicalSessionByExternalId)
  return Object.freeze({ attendance, events, people, rsvps, sessions })
}

function prepareImport(sqlite: Sqlite, dataset: NormalizedDataset): PreparedImport {
  const issues: SolidarityEventImportIssue[] = []
  const eventPlans = prepareEvents(sqlite, dataset.events, issues)
  const eventByExternalId = new Map<string, EventPlan>()
  for (const plan of eventPlans) {
    for (const event of plan.externalEvents) eventByExternalId.set(event.id, plan)
  }
  const { sessionByExternalId, sessionPlans } = prepareSessions(sqlite, dataset.sessions, eventByExternalId, issues)
  const personPlans = preparePeople(sqlite, dataset.people, issues)
  const personByExternalId = new Map(personPlans.map((plan) => [plan.person.id, plan]))
  const rsvps = dataset.rsvps.flatMap((record) => {
    const session = sessionByExternalId.get(record.sessionId)
    if (!session) {
      issue(issues, 'rsvp_session_missing', 'solidarity.rsvp', record.id)
      return []
    }
    const person = personByExternalId.get(record.userId)
    if (!person?.personId) {
      issue(issues, 'rsvp_person_unresolved', 'solidarity.rsvp', record.id)
      return []
    }
    return [{ personId: person.personId, record, sessionId: session.localId }]
  })
  const attendance = dataset.attendance.flatMap((record) => {
    const session = sessionByExternalId.get(record.sessionId)
    if (!session) {
      issue(issues, 'attendance_session_missing', 'solidarity.attendance', record.id)
      return []
    }
    const person = personByExternalId.get(record.userId)
    if (!person?.personId) {
      issue(issues, 'attendance_person_unresolved', 'solidarity.attendance', record.id)
      return []
    }
    return [{ personId: person.personId, record, sessionId: session.localId }]
  })
  assertUniqueResolvedActivitySubjects(rsvps, 'RSVP')
  assertUniqueResolvedActivitySubjects(attendance, 'attendance')
  return Object.freeze({
    attendance,
    eventPlans,
    issues,
    personPlans,
    rsvps,
    sessionPlans,
    snapshots: prepareSnapshots(dataset)
  })
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
): Readonly<{ category: EventCategory; meetingKind: 'general' | 'steering' | null; visibility: EventVisibility }> {
  const tags = new Set(event.eventTags)
  const audiences = audienceTags.filter((tag) => tags.has(tag))
  const categories = categoryTags.filter((tag) => tags.has(tag))
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
  const meetingTags = ['meeting-general', 'meeting-steering'].filter((tag) => tags.has(tag))
  let meetingKind: 'general' | 'steering' | null = null
  if (category === 'meeting' && meetingTags.length === 1) {
    meetingKind = meetingTags[0] === 'meeting-general' ? 'general' : 'steering'
  } else if (meetingTags.length > 0 || category === 'meeting') {
    visibility = 'hidden'
    issue(issues, 'invalid_meeting_tags', 'solidarity.event', event.id)
  }
  return { category, meetingKind, visibility }
}

function prepareSessions(
  sqlite: Sqlite,
  sessions: readonly NormalizedSession[],
  eventByExternalId: ReadonlyMap<string, EventPlan>,
  issues: SolidarityEventImportIssue[]
): Readonly<{
  sessionByExternalId: ReadonlyMap<string, SessionPlan>
  sessionPlans: readonly SessionPlan[]
}> {
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
  const sessionByExternalId = new Map<string, SessionPlan>()
  for (const plan of plans) {
    for (const session of plan.externalSessions) sessionByExternalId.set(session.id, plan)
  }
  return Object.freeze({ sessionByExternalId, sessionPlans: Object.freeze(plans) })
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

function preparePeople(
  sqlite: Sqlite,
  people: readonly NormalizedPerson[],
  issues: SolidarityEventImportIssue[]
): readonly PersonPlan[] {
  const identity = sqlite.prepare(
    `select person_id as personId, state from provider_identities
     where provider = 'solidarity' and external_id = ?`
  )
  const matchingContacts = sqlite.prepare(
    `select distinct person_id as personId from person_contacts
     where verified_at is not null
       and ((kind = 'email' and normalized_value = ?) or (kind = 'phone' and normalized_value = ?))`
  )
  return people.map((person) => {
    const existing = identity.get(person.id) as { personId: string | null; state: string } | undefined
    if (existing?.personId) return Object.freeze({ action: 'existing', person, personId: existing.personId })
    const email = normalizeEmail(person.email)
    const phone = normalizePhone(person.phone)
    const matches =
      email || phone ? (matchingContacts.all(email ?? '', phone ?? '') as Array<{ personId: string }>) : []
    const personIds = new Set(matches.map(({ personId }) => personId))
    if (personIds.size > 1) {
      issue(issues, 'ambiguous_person_match', 'solidarity.person', person.id)
      return Object.freeze({ action: 'ambiguous', person, personId: null })
    }
    const matched = [...personIds][0]
    return Object.freeze({
      action: matched ? 'existing' : 'created',
      person,
      personId: matched ?? deterministicId('solidarity_person', person.id)
    })
  })
}

function prepareSnapshots(dataset: NormalizedDataset): readonly PreparedSnapshot[] {
  const snapshots: PreparedSnapshot[] = []
  const add = (objectType: string, externalId: string, value: unknown) => {
    const rawPayload = canonicalJson(value)
    snapshots.push({ externalId, objectType, payloadHash: sha256(rawPayload), rawPayload })
  }
  for (const record of dataset.events) add('solidarity.event', record.id, record)
  for (const record of dataset.sessions) add('solidarity.session', record.id, record)
  for (const record of dataset.people) add('solidarity.person', record.id, record)
  for (const record of dataset.rsvps) add('solidarity.rsvp', record.id, record)
  for (const record of dataset.attendance) add('solidarity.attendance', record.id, record)
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
    persistPeople(sqlite, prepared.personPlans, snapshotIds, context.observedAt)
    persistRsvps(sqlite, prepared.rsvps, snapshotIds, context.observedAt)
    const affectedPeople = persistAttendance(sqlite, prepared.attendance, snapshotIds, context.observedAt)
    recalculateStanding(sqlite, affectedPeople, prepared.issues, context.observedAt)
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
    const eventSnapshotId = snapshotId(snapshotIds, 'solidarity.event', plan.event.id)
    upsertEvent.run(
      plan.localId,
      plan.event.title.trim(),
      normalizedText(plan.event.description, 10_000),
      plan.category,
      plan.visibility,
      plan.event.status,
      plan.event.timezone.trim(),
      normalizedText(plan.event.eventPageUrl, 2_000),
      eventSnapshotId,
      observedAt,
      observedAt
    )
    clearTags.run(plan.localId)
    for (const value of uniqueTags(plan.event.eventTags)) {
      insertTag.run(plan.localId, 'event', value, eventSnapshotId, observedAt, observedAt)
    }
    for (const value of uniqueTags(plan.event.campaignTags)) {
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
  const upsertMeeting = sqlite.prepare(
    `insert into meetings (event_session_id, kind, source_snapshot_id, created_at, updated_at)
     values (?, ?, ?, ?, ?)
     on conflict(event_session_id) do update set kind = excluded.kind,
       source_snapshot_id = excluded.source_snapshot_id, updated_at = excluded.updated_at`
  )
  const deleteMeeting = sqlite.prepare('delete from meetings where event_session_id = ?')
  for (const plan of plans) {
    const previous = existingSession.get(plan.localId) as { eventId: string } | undefined
    if (previous && previous.eventId !== plan.eventPlan.localId) {
      throw new Error('An existing event session cannot be reassigned to another event')
    }
    const inPerson = plan.externalSessions.find(({ eventType }) => eventType === 'in_person')
    const virtual = plan.externalSessions.find(({ eventType }) => eventType === 'virtual')
    const sourceSnapshotId = snapshotId(snapshotIds, 'solidarity.session', plan.session.id)
    upsertSession.run(
      plan.localId,
      plan.eventPlan.localId,
      normalizedText(plan.session.title, 255),
      combinedSessionStatus(plan.externalSessions),
      plan.deliveryMode,
      plan.session.startsAt,
      plan.session.endsAt ?? null,
      plan.session.timezone.trim(),
      normalizedText(inPerson?.locationName ?? plan.session.locationName, 255),
      normalizedText(inPerson?.locationAddress ?? plan.session.locationAddress, 500),
      normalizedText(virtual?.virtualUrl ?? plan.session.virtualUrl, 2_000),
      normalizedText(plan.externalSessions.find(({ rsvpUrl }) => rsvpUrl)?.rsvpUrl, 2_000),
      sourceSnapshotId,
      observedAt,
      observedAt
    )
    if (plan.eventPlan.meetingKind) {
      upsertMeeting.run(plan.localId, plan.eventPlan.meetingKind, sourceSnapshotId, observedAt, observedAt)
    } else {
      deleteMeeting.run(plan.localId)
    }
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

function persistPeople(
  sqlite: Sqlite,
  plans: readonly PersonPlan[],
  snapshotIds: ReadonlyMap<string, string>,
  observedAt: string
): void {
  const upsertPerson = sqlite.prepare(
    `insert into people (id, first_name, last_name, display_name, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?)
     on conflict(id) do update set first_name = coalesce(people.first_name, excluded.first_name),
       last_name = coalesce(people.last_name, excluded.last_name),
       display_name = coalesce(people.display_name, excluded.display_name), updated_at = excluded.updated_at`
  )
  const primaryContact = sqlite.prepare(
    'select 1 from person_contacts where person_id = ? and kind = ? and is_primary = 1 limit 1'
  )
  const upsertContact = sqlite.prepare(
    `insert into person_contacts
       (id, person_id, kind, value, normalized_value, is_primary, verified_at,
        source_snapshot_id, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, null, ?, ?, ?)
     on conflict(person_id, kind, normalized_value) do update set value = excluded.value,
       source_snapshot_id = excluded.source_snapshot_id, updated_at = excluded.updated_at`
  )
  const upsertIdentity = sqlite.prepare(
    `insert into provider_identities
       (id, person_id, provider, external_id, state, linked_at, last_synced_at,
        source_snapshot_id, created_at, updated_at)
     values (?, ?, 'solidarity', ?, ?, ?, ?, ?, ?, ?)
     on conflict(provider, external_id) do update set
       person_id = case when provider_identities.state = 'unlinked' and excluded.person_id is not null
         then excluded.person_id else provider_identities.person_id end,
       state = case when provider_identities.state = 'unlinked' and excluded.person_id is not null
         then 'active' else provider_identities.state end,
       linked_at = case when provider_identities.state = 'unlinked' and excluded.person_id is not null
         then excluded.linked_at else provider_identities.linked_at end,
       last_synced_at = excluded.last_synced_at, source_snapshot_id = excluded.source_snapshot_id,
       updated_at = excluded.updated_at`
  )
  for (const plan of plans) {
    const sourceSnapshotId = snapshotId(snapshotIds, 'solidarity.person', plan.person.id)
    if (plan.personId) {
      upsertPerson.run(
        plan.personId,
        normalizedText(plan.person.firstName, 100),
        normalizedText(plan.person.lastName, 100),
        normalizedText(plan.person.displayName, 100),
        observedAt,
        observedAt
      )
      persistContact('email', plan.person.email, normalizeEmail(plan.person.email))
      persistContact('phone', plan.person.phone, normalizePhone(plan.person.phone))
    }
    upsertIdentity.run(
      deterministicId('solidarity_identity', plan.person.id),
      plan.personId,
      plan.person.id,
      plan.personId ? 'active' : 'unlinked',
      plan.personId ? observedAt : null,
      observedAt,
      sourceSnapshotId,
      observedAt,
      observedAt
    )

    function persistContact(kind: 'email' | 'phone', value: unknown, normalized: string | null) {
      const display = normalizedText(value, 320)
      if (!plan.personId || !display || !normalized) return
      upsertContact.run(
        deterministicId('solidarity_contact', `${plan.personId}\0${kind}\0${normalized}`),
        plan.personId,
        kind,
        display,
        normalized,
        primaryContact.get(plan.personId, kind) ? 0 : 1,
        sourceSnapshotId,
        observedAt,
        observedAt
      )
    }
  }
}

function persistRsvps(
  sqlite: Sqlite,
  rsvps: PreparedImport['rsvps'],
  snapshotIds: ReadonlyMap<string, string>,
  observedAt: string
): void {
  const upsert = sqlite.prepare(
    `insert into rsvps
       (id, event_session_id, person_id, status, responded_at, source_snapshot_id, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(event_session_id, person_id) do update set status = excluded.status,
       responded_at = excluded.responded_at, source_snapshot_id = excluded.source_snapshot_id,
       updated_at = excluded.updated_at`
  )
  for (const { personId, record, sessionId } of rsvps) {
    upsert.run(
      deterministicId('solidarity_rsvp', record.id),
      sessionId,
      personId,
      record.status,
      record.respondedAt,
      snapshotId(snapshotIds, 'solidarity.rsvp', record.id),
      observedAt,
      observedAt
    )
  }
}

function persistAttendance(
  sqlite: Sqlite,
  records: PreparedImport['attendance'],
  snapshotIds: ReadonlyMap<string, string>,
  observedAt: string
): ReadonlySet<string> {
  const affected = new Set<string>()
  const upsert = sqlite.prepare(
    `insert into attendance
       (id, event_session_id, person_id, status, source, recorded_at,
        source_snapshot_id, created_at, updated_at)
     values (?, ?, ?, ?, 'solidarity', ?, ?, ?, ?)
     on conflict(event_session_id, person_id) do update set status = excluded.status,
       source = excluded.source, recorded_at = excluded.recorded_at,
       source_snapshot_id = excluded.source_snapshot_id, updated_at = excluded.updated_at`
  )
  const findAttendance = sqlite.prepare('select id from attendance where event_session_id = ? and person_id = ?')
  const clearIntervals = sqlite.prepare('delete from attendance_intervals where attendance_id = ?')
  const insertInterval = sqlite.prepare(
    `insert into attendance_intervals
       (id, attendance_id, checked_in_at, checked_out_at, source_snapshot_id, created_at)
     values (?, ?, ?, ?, ?, ?)`
  )
  for (const { personId, record, sessionId } of records) {
    const localId = deterministicId('solidarity_attendance', record.id)
    const sourceSnapshotId = snapshotId(snapshotIds, 'solidarity.attendance', record.id)
    upsert.run(localId, sessionId, personId, record.status, record.recordedAt, sourceSnapshotId, observedAt, observedAt)
    const attendanceId = (findAttendance.get(sessionId, personId) as { id: string }).id
    clearIntervals.run(attendanceId)
    if (record.checkedInAt) {
      insertInterval.run(
        deterministicId('solidarity_attendance_interval', `${record.id}\0${record.checkedInAt}`),
        attendanceId,
        record.checkedInAt,
        record.checkedOutAt ?? null,
        sourceSnapshotId,
        observedAt
      )
    }
    affected.add(personId)
  }
  return affected
}

function recalculateStanding(
  sqlite: Sqlite,
  personIds: ReadonlySet<string>,
  issues: SolidarityEventImportIssue[],
  observedAt: string
): void {
  const activeMembership = sqlite.prepare(
    `select id from memberships where person_id = ? and status = 'active' and ended_at is null`
  )
  for (const personId of [...personIds].sort()) {
    const membership = activeMembership.get(personId) as { id: string } | undefined
    if (!membership) continue
    const result = recalculateMembershipStandingInTransaction(sqlite, { membershipId: membership.id, observedAt })
    if (result.outcome === 'policy_missing') {
      issue(issues, 'membership_policy_missing', 'membership', membership.id)
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

function normalizeEmail(value: unknown): string | null {
  const normalized = normalizedText(value, 320)?.toLowerCase()
  return normalized && normalized.includes('@') ? normalized : null
}

function normalizePhone(value: unknown): string | null {
  const normalized = normalizedText(value, 320)?.replace(/[^\d+]/g, '') ?? null
  if (!normalized) return null
  return normalized.startsWith('+') ? `+${normalized.slice(1).replace(/\+/g, '')}` : normalized.replace(/\+/g, '')
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

function assertUniqueActivitySubjects(
  values: readonly Readonly<{ sessionId: string; userId: string }>[],
  label: string
): void {
  const seen = new Set<string>()
  for (const { sessionId, userId } of values) {
    const key = `${sessionId}\0${userId}`
    if (seen.has(key)) throw new TypeError(`Solidarity event import contains duplicate ${label} person/session`)
    seen.add(key)
  }
}

function assertUniqueCanonicalActivitySubjects(
  values: readonly Readonly<{ sessionId: string; userId: string }>[],
  label: string,
  canonicalSessionByExternalId: ReadonlyMap<string, string>
): void {
  const seen = new Set<string>()
  for (const { sessionId, userId } of values) {
    const key = `${canonicalSessionByExternalId.get(sessionId) ?? sessionId}\0${userId}`
    if (seen.has(key))
      throw new TypeError(`Solidarity event import contains duplicate normalized ${label} person/session`)
    seen.add(key)
  }
}

function assertUniqueResolvedActivitySubjects(
  values: readonly Readonly<{ personId: string; sessionId: string }>[],
  label: string
): void {
  const seen = new Set<string>()
  for (const { personId, sessionId } of values) {
    const key = `${sessionId}\0${personId}`
    if (seen.has(key)) {
      throw new TypeError(`Solidarity event import contains duplicate normalized ${label} person/session`)
    }
    seen.add(key)
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
