import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'

type Sqlite = InstanceType<typeof Database>
type StandingFactor = 'met' | 'not_applicable' | 'pending' | 'unmet'
type StandingStatus = 'good' | 'grace' | 'not_good' | 'pending'

export type MembershipStandingProjectionResult = Readonly<{
  outcome: 'changed' | 'policy_missing' | 'skipped' | 'unchanged'
  status: StandingStatus | null
}>

type StandingRow = Readonly<{
  attendanceStatus: StandingFactor
  conductStatus: StandingFactor
  duesStatus: StandingFactor
  effectiveFrom: string
  eligibilityStatus: StandingFactor
  graceEndsAt: string | null
  id: string
  policyId: string
  status: StandingStatus
}>

export function recalculateMembershipStandingInTransaction(
  sqlite: Sqlite,
  input: Readonly<{ membershipId: string; observedAt: string; sourceSnapshotId?: string | null }>
): MembershipStandingProjectionResult {
  const observedAt = canonicalUtcTimestamp(input.observedAt, 'Membership standing observedAt')
  const membership = sqlite
    .prepare(
      `select person_id as personId, status, attendance_requirement_starts_at as attendanceStartsAt
       from memberships where id = ?`
    )
    .get(input.membershipId) as
    { attendanceStartsAt: string | null; personId: string; status: 'active' | 'ended' | 'pending' } | undefined
  if (!membership || membership.status === 'ended') return Object.freeze({ outcome: 'skipped', status: null })

  const policy = sqlite
    .prepare(
      `select id, dues_grace_days as duesGraceDays,
         required_general_meetings as requiredGeneralMeetings,
         attendance_window_months as attendanceWindowMonths
       from membership_policies
       where julianday(effective_from) <= julianday(?)
         and (effective_to is null or julianday(effective_to) > julianday(?))
       order by julianday(effective_from) desc limit 1`
    )
    .get(observedAt, observedAt) as
    | {
        attendanceWindowMonths: number
        duesGraceDays: number
        id: string
        requiredGeneralMeetings: number
      }
    | undefined
  if (!policy) return Object.freeze({ outcome: 'policy_missing', status: null })

  const live = sqlite
    .prepare(
      `select id, policy_id as policyId, status, dues_status as duesStatus,
         attendance_status as attendanceStatus, eligibility_status as eligibilityStatus,
         conduct_status as conductStatus, grace_ends_at as graceEndsAt,
         effective_from as effectiveFrom
       from membership_standing_periods where membership_id = ? and effective_to is null`
    )
    .get(input.membershipId) as StandingRow | undefined
  if (live && Date.parse(live.effectiveFrom) > Date.parse(observedAt)) {
    throw new Error('Membership standing cannot be recalculated before its current effective period')
  }

  const coverageEnd = paidCoverageEnd(sqlite, input.membershipId, observedAt)
  const dues = duesFactor(coverageEnd, observedAt, policy.duesGraceDays)
  const duesStatus: StandingFactor = membership.status === 'pending' && !coverageEnd ? 'pending' : dues.status
  const attendanceStatus = attendanceFactor(sqlite, {
    attendanceStartsAt: membership.attendanceStartsAt,
    attendanceWindowMonths: policy.attendanceWindowMonths,
    membershipStatus: membership.status,
    observedAt,
    personId: membership.personId,
    requiredGeneralMeetings: policy.requiredGeneralMeetings
  })
  const eligibilityStatus = live?.eligibilityStatus ?? defaultNonAttendanceFactor(membership.status)
  const conductStatus = live?.conductStatus ?? defaultNonAttendanceFactor(membership.status)
  const status = standingStatus(duesStatus, attendanceStatus, eligibilityStatus, conductStatus, dues.inGrace)
  const graceEndsAt = status === 'grace' ? dues.graceEndsAt : null

  if (
    live?.policyId === policy.id &&
    live.status === status &&
    live.duesStatus === duesStatus &&
    live.attendanceStatus === attendanceStatus &&
    live.eligibilityStatus === eligibilityStatus &&
    live.conductStatus === conductStatus &&
    live.graceEndsAt === graceEndsAt
  ) {
    return Object.freeze({ outcome: 'unchanged', status })
  }

  const sourceSnapshotId = input.sourceSnapshotId ?? null
  if (live?.effectiveFrom === observedAt) {
    sqlite
      .prepare(
        `update membership_standing_periods set policy_id = ?, status = ?, dues_status = ?,
           attendance_status = ?, eligibility_status = ?, conduct_status = ?,
           grace_ends_at = ?, source_snapshot_id = ? where id = ?`
      )
      .run(
        policy.id,
        status,
        duesStatus,
        attendanceStatus,
        eligibilityStatus,
        conductStatus,
        graceEndsAt,
        sourceSnapshotId,
        live.id
      )
    return Object.freeze({ outcome: 'changed', status })
  }
  if (live) {
    sqlite
      .prepare('update membership_standing_periods set effective_to = ? where id = ? and effective_to is null')
      .run(observedAt, live.id)
  }
  const signature = [
    policy.id,
    status,
    duesStatus,
    attendanceStatus,
    eligibilityStatus,
    conductStatus,
    graceEndsAt
  ].join('\0')
  sqlite
    .prepare(
      `insert into membership_standing_periods
        (id, membership_id, policy_id, status, dues_status, attendance_status,
         eligibility_status, conduct_status, grace_ends_at, effective_from,
         source_snapshot_id, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      deterministicId('membership_standing', `${input.membershipId}\0${observedAt}\0${signature}`),
      input.membershipId,
      policy.id,
      status,
      duesStatus,
      attendanceStatus,
      eligibilityStatus,
      conductStatus,
      graceEndsAt,
      observedAt,
      sourceSnapshotId,
      observedAt
    )
  return Object.freeze({ outcome: 'changed', status })
}

function paidCoverageEnd(sqlite: Sqlite, membershipId: string, observedAt: string): string | null {
  const row = sqlite
    .prepare(
      `select lines.period_end as coverageEnd
       from membership_dues_subscriptions dues
       join stripe_invoices invoices
         on invoices.subscription_id = dues.subscription_id and invoices.status = 'paid'
       join stripe_invoice_lines lines on lines.invoice_id = invoices.id
       join membership_dues_prices prices on prices.price_id = lines.price_id
       where dues.membership_id = ?
         and julianday(dues.effective_from) <= julianday(?)
         and (dues.effective_to is null or julianday(dues.effective_to) > julianday(?))
         and lines.period_end is not null and julianday(lines.period_end) is not null
       order by julianday(lines.period_end) desc limit 1`
    )
    .get(membershipId, observedAt, observedAt) as { coverageEnd: string } | undefined
  return row?.coverageEnd ?? null
}

function attendanceFactor(
  sqlite: Sqlite,
  input: Readonly<{
    attendanceStartsAt: string | null
    attendanceWindowMonths: number
    membershipStatus: 'active' | 'pending'
    observedAt: string
    personId: string
    requiredGeneralMeetings: number
  }>
): StandingFactor {
  if (input.membershipStatus === 'pending') return 'pending'
  if (!input.attendanceStartsAt) return 'pending'

  const requirementStartsAt = parsedTimestamp(input.attendanceStartsAt, 'Membership attendance start')
  const observedAt = parsedTimestamp(input.observedAt, 'Membership standing observation')
  const firstDeadline = addCalendarMonths(requirementStartsAt, input.attendanceWindowMonths)
  if (observedAt.getTime() < firstDeadline.getTime()) return 'not_applicable'

  const windowStartsAt = addCalendarMonths(observedAt, -input.attendanceWindowMonths).toISOString()
  const row = sqlite
    .prepare(
      `select count(distinct sessions.id) as count
       from attendance
       join event_sessions sessions on sessions.id = attendance.event_session_id
       join meetings on meetings.event_session_id = sessions.id
       where attendance.person_id = ? and attendance.status = 'attended'
         and meetings.kind = 'general' and sessions.status = 'completed'
         and julianday(sessions.starts_at) >= julianday(?)
         and julianday(sessions.starts_at) <= julianday(?)`
    )
    .get(input.personId, windowStartsAt, input.observedAt) as { count: number }
  return row.count >= input.requiredGeneralMeetings ? 'met' : 'unmet'
}

function defaultNonAttendanceFactor(status: 'active' | 'pending'): StandingFactor {
  return status === 'active' ? 'not_applicable' : 'pending'
}

function duesFactor(coverageEnd: string | null, observedAt: string, graceDays: number) {
  if (!coverageEnd) return { graceEndsAt: null, inGrace: false, status: 'unmet' as const }
  if (Date.parse(coverageEnd) >= Date.parse(observedAt)) {
    return { graceEndsAt: null, inGrace: false, status: 'met' as const }
  }
  const graceEndsAt = addDays(parsedTimestamp(coverageEnd, 'Membership dues coverage'), graceDays).toISOString()
  return {
    graceEndsAt,
    inGrace: Date.parse(observedAt) <= Date.parse(graceEndsAt),
    status: 'unmet' as const
  }
}

function standingStatus(
  dues: StandingFactor,
  attendance: StandingFactor,
  eligibility: StandingFactor,
  conduct: StandingFactor,
  duesInGrace: boolean
): StandingStatus {
  const factors = [dues, attendance, eligibility, conduct]
  if (factors.includes('pending')) return 'pending'
  if (factors.every((value) => value === 'met' || value === 'not_applicable')) return 'good'
  if (
    dues === 'unmet' &&
    duesInGrace &&
    [attendance, eligibility, conduct].every((value) => value === 'met' || value === 'not_applicable')
  ) {
    return 'grace'
  }
  return 'not_good'
}

function canonicalUtcTimestamp(value: string, label: string): string {
  const parsed = parsedTimestamp(value, label)
  if (parsed.toISOString() !== value) throw new TypeError(`${label} must be a canonical UTC timestamp`)
  return value
}

function parsedTimestamp(value: string, label: string): Date {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`${label} must be a valid timestamp`)
  return parsed
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

function addCalendarMonths(value: Date, months: number): Date {
  const result = new Date(value)
  const day = result.getUTCDate()
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()
  result.setUTCDate(Math.min(day, lastDay))
  return result
}

function deterministicId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 32)}`
}
