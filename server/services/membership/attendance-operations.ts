import type Database from 'better-sqlite3'
import type { DatabaseConnection } from '../../db/connect'
import type { AttendanceStatus, EventSessionStatus, EventStatus } from '../../db/schema/events'
import type { MeetingKind } from '../../db/schema/governance'
import {
  recalculateMembershipStandingInTransaction,
  type MembershipStandingProjectionResult
} from './membership-standing'

type Sqlite = InstanceType<typeof Database>
type AttendanceSource = 'discourse' | 'import' | 'manual' | 'solidarity'

export type RecordEventSessionAttendanceInput = Readonly<{
  attendance: ReadonlyArray<
    Readonly<{
      id: string
      personId: string
      recordedAt: string
      source: AttendanceSource
      sourceSnapshotId?: string | null
      status: AttendanceStatus
    }>
  >
  event: Readonly<{
    defaultTimezone?: string
    description?: string | null
    id: string
    kind: string
    sourceSnapshotId?: string | null
    status?: EventStatus
    title: string
  }>
  meetingKind?: MeetingKind
  observedAt: string
  session: Readonly<{
    endsAt?: string | null
    id: string
    location?: string | null
    sourceSnapshotId?: string | null
    startsAt: string
    status: EventSessionStatus
    timezone: string
    virtualUrl?: string | null
  }>
}>

export function recalculateMembershipStanding(
  connection: DatabaseConnection,
  input: Readonly<{ membershipId: string; observedAt: string; sourceSnapshotId?: string | null }>
): MembershipStandingProjectionResult {
  return connection.sqlite
    .transaction(() => requirePolicy(recalculateMembershipStandingInTransaction(connection.sqlite, input)))
    .immediate()
}

export function recordEventSessionAttendance(
  connection: DatabaseConnection,
  input: RecordEventSessionAttendanceInput
): void {
  const observedAt = canonicalUtcTimestamp(input.observedAt, 'Attendance operation observedAt')
  assertDistinctPeople(input.attendance)

  connection.sqlite
    .transaction(() => {
      persistEvent(connection.sqlite, input, observedAt)
      persistSession(connection.sqlite, input, observedAt)
      persistMeeting(connection.sqlite, input, observedAt)

      const affectedPeople = new Set(
        (
          connection.sqlite
            .prepare('select person_id as personId from attendance where event_session_id = ?')
            .all(input.session.id) as Array<{ personId: string }>
        ).map((row) => row.personId)
      )
      const sourceSnapshotByPerson = new Map<string, string | null>()
      const upsertAttendance = connection.sqlite.prepare(
        `insert into attendance
          (id, event_session_id, person_id, status, source, recorded_at,
           source_snapshot_id, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(event_session_id, person_id) do update set
           status = excluded.status, source = excluded.source, recorded_at = excluded.recorded_at,
           source_snapshot_id = excluded.source_snapshot_id, updated_at = excluded.updated_at`
      )
      for (const attendance of input.attendance) {
        upsertAttendance.run(
          attendance.id,
          input.session.id,
          attendance.personId,
          attendance.status,
          attendance.source,
          attendance.recordedAt,
          attendance.sourceSnapshotId ?? null,
          observedAt,
          observedAt
        )
        affectedPeople.add(attendance.personId)
        sourceSnapshotByPerson.set(attendance.personId, attendance.sourceSnapshotId ?? null)
      }

      const activeMembership = connection.sqlite.prepare(
        `select id from memberships
         where person_id = ? and status = 'active' and ended_at is null`
      )
      for (const personId of [...affectedPeople].sort()) {
        const membership = activeMembership.get(personId) as { id: string } | undefined
        if (!membership) continue
        requirePolicy(
          recalculateMembershipStandingInTransaction(connection.sqlite, {
            membershipId: membership.id,
            observedAt,
            sourceSnapshotId:
              sourceSnapshotByPerson.get(personId) ??
              input.session.sourceSnapshotId ??
              input.event.sourceSnapshotId ??
              null
          })
        )
      }
    })
    .immediate()
}

function persistEvent(sqlite: Sqlite, input: RecordEventSessionAttendanceInput, observedAt: string): void {
  sqlite
    .prepare(
      `insert into events
        (id, title, description, kind, status, default_timezone,
         source_snapshot_id, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(id) do update set title = excluded.title, description = excluded.description,
         kind = excluded.kind, status = excluded.status,
         default_timezone = excluded.default_timezone,
         source_snapshot_id = excluded.source_snapshot_id, updated_at = excluded.updated_at`
    )
    .run(
      input.event.id,
      input.event.title,
      input.event.description ?? null,
      input.event.kind,
      input.event.status ?? 'active',
      input.event.defaultTimezone ?? input.session.timezone,
      input.event.sourceSnapshotId ?? null,
      observedAt,
      observedAt
    )
}

function persistSession(sqlite: Sqlite, input: RecordEventSessionAttendanceInput, observedAt: string): void {
  const existing = sqlite
    .prepare('select event_id as eventId from event_sessions where id = ?')
    .get(input.session.id) as { eventId: string } | undefined
  if (existing && existing.eventId !== input.event.id) {
    throw new Error('An existing event session cannot be reassigned to another event')
  }
  sqlite
    .prepare(
      `insert into event_sessions
        (id, event_id, status, starts_at, ends_at, timezone, location, virtual_url,
         source_snapshot_id, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(id) do update set status = excluded.status,
         starts_at = excluded.starts_at, ends_at = excluded.ends_at,
         timezone = excluded.timezone, location = excluded.location,
         virtual_url = excluded.virtual_url, source_snapshot_id = excluded.source_snapshot_id,
         updated_at = excluded.updated_at`
    )
    .run(
      input.session.id,
      input.event.id,
      input.session.status,
      input.session.startsAt,
      input.session.endsAt ?? null,
      input.session.timezone,
      input.session.location ?? null,
      input.session.virtualUrl ?? null,
      input.session.sourceSnapshotId ?? null,
      observedAt,
      observedAt
    )
}

function persistMeeting(sqlite: Sqlite, input: RecordEventSessionAttendanceInput, observedAt: string): void {
  if (!input.meetingKind) return
  sqlite
    .prepare(
      `insert into meetings
        (event_session_id, kind, source_snapshot_id, created_at, updated_at)
       values (?, ?, ?, ?, ?)
       on conflict(event_session_id) do update set kind = excluded.kind,
         source_snapshot_id = excluded.source_snapshot_id, updated_at = excluded.updated_at`
    )
    .run(
      input.session.id,
      input.meetingKind,
      input.session.sourceSnapshotId ?? input.event.sourceSnapshotId ?? null,
      observedAt,
      observedAt
    )
}

function assertDistinctPeople(attendance: RecordEventSessionAttendanceInput['attendance']): void {
  const people = new Set<string>()
  for (const row of attendance) {
    if (people.has(row.personId)) throw new TypeError('Attendance operation contains the same person more than once')
    people.add(row.personId)
  }
}

function canonicalUtcTimestamp(value: string, label: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical UTC timestamp`)
  }
  return value
}

function requirePolicy(result: MembershipStandingProjectionResult): MembershipStandingProjectionResult {
  if (result.outcome === 'policy_missing') throw new Error('No membership policy applies at the observation time')
  return result
}
