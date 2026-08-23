import type Database from 'better-sqlite3'
import type { DatabaseConnection } from '../../db/connect'
import type { AttendanceStatus } from '../../db/schema/events'
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
  eventSessionId: string
  observedAt: string
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
      const eventSourceSnapshotId = requireSolidarityEventSession(connection.sqlite, input.eventSessionId)

      const affectedPeople = new Set(
        (
          connection.sqlite
            .prepare('select person_id as personId from attendance where event_session_id = ?')
            .all(input.eventSessionId) as Array<{ personId: string }>
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
          input.eventSessionId,
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
            sourceSnapshotId: sourceSnapshotByPerson.get(personId) ?? eventSourceSnapshotId
          })
        )
      }
    })
    .immediate()
}

function requireSolidarityEventSession(sqlite: Sqlite, eventSessionId: string): string | null {
  const row = sqlite
    .prepare(
      `select coalesce(s.source_snapshot_id, e.source_snapshot_id) as sourceSnapshotId
       from event_sessions s
       join events e on e.id = s.event_id
       join event_session_provider_links provider on provider.event_session_id = s.id
         and provider.provider = 'solidarity'
       where s.id = ? limit 1`
    )
    .get(eventSessionId) as { sourceSnapshotId: string | null } | undefined
  if (!row) throw new Error('Attendance can be recorded only for an existing Solidarity event session')
  return row.sourceSnapshotId
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
