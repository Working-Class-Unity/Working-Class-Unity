import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as schema from '../server/db/schema/index'
import {
  recalculateMembershipStanding,
  recordEventSessionAttendance
} from '../server/services/membership/attendance-operations'

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
type Sqlite = InstanceType<typeof Database>

describe('membership attendance operations', () => {
  it('records canonical member and nonmember attendance atomically and idempotently', () => {
    withMigratedDatabase('atomic', (sqlite, connection) => {
      seedMemberWithPaidDues(sqlite, {
        attendanceStartsAt: '2027-03-01T00:00:00.000Z',
        membershipId: 'membership-member',
        personId: 'person-member',
        priceId: 'membership-10-1month'
      })
      sqlite.prepare("insert into people (id, display_name) values ('person-guest', 'Community Guest')").run()

      const input = attendanceInput(sqlite, {
        attendance: [
          { id: 'attendance-member', personId: 'person-member', status: 'attended' },
          { id: 'attendance-guest', personId: 'person-guest', status: 'attended' }
        ],
        eventId: 'event-general',
        observedAt: '2028-03-01T00:00:00.000Z',
        sessionId: 'session-general',
        startsAt: '2028-02-15T19:00:00.000Z'
      })

      recordEventSessionAttendance(connection, input)
      recordEventSessionAttendance(connection, input)

      const recurringSession = attendanceInput(sqlite, {
        attendance: [{ id: 'attendance-member-second', personId: 'person-member', status: 'attended' }],
        eventId: 'event-general',
        observedAt: '2028-04-01T00:00:00.000Z',
        sessionId: 'session-general-second',
        startsAt: '2028-03-15T19:00:00.000Z'
      })
      recordEventSessionAttendance(connection, recurringSession)
      recordEventSessionAttendance(connection, recurringSession)

      expect(count(sqlite, 'events')).toBe(1)
      expect(count(sqlite, 'event_sessions')).toBe(2)
      expect(count(sqlite, 'meetings')).toBe(2)
      expect(count(sqlite, 'attendance')).toBe(3)
      expect(count(sqlite, 'people')).toBe(2)
      expect(sqlite.prepare("select visibility from events where id = 'event-general'").get()).toEqual({
        visibility: 'members'
      })
      expect(currentStanding(sqlite, 'membership-member')).toEqual({
        attendanceStatus: 'met',
        duesStatus: 'met',
        status: 'good'
      })
      expect(count(sqlite, 'membership_standing_periods')).toBe(1)

      expect(() =>
        recordEventSessionAttendance(connection, {
          ...recurringSession,
          eventSessionId: 'session-not-imported'
        })
      ).toThrow(/existing Solidarity event session/)

      expect(() =>
        recordEventSessionAttendance(
          connection,
          attendanceInput(sqlite, {
            attendance: [{ id: 'attendance-missing', personId: 'person-missing', status: 'attended' }],
            eventId: 'event-rollback',
            observedAt: '2028-03-02T00:00:00.000Z',
            sessionId: 'session-rollback',
            startsAt: '2028-03-01T19:00:00.000Z'
          })
        )
      ).toThrow(/FOREIGN KEY constraint failed/)
      expect(
        sqlite.prepare("select count(*) as count from attendance where event_session_id = 'session-rollback'").get()
      ).toEqual({ count: 0 })
    })
  })

  it('applies the first-year runway and inclusive rolling twelve-month boundary', () => {
    withMigratedDatabase('window', (sqlite, connection) => {
      seedMemberWithPaidDues(sqlite, {
        attendanceStartsAt: '2027-03-01T00:00:00.000Z',
        membershipId: 'membership-window',
        personId: 'person-window',
        priceId: 'membership-10-1month'
      })

      recalculateMembershipStanding(connection, {
        membershipId: 'membership-window',
        observedAt: '2028-02-29T23:59:59.000Z'
      })
      expect(currentStanding(sqlite, 'membership-window')).toEqual({
        attendanceStatus: 'not_applicable',
        duesStatus: 'met',
        status: 'good'
      })

      recordEventSessionAttendance(
        connection,
        attendanceInput(sqlite, {
          attendance: [{ id: 'attendance-steering', personId: 'person-window', status: 'attended' }],
          eventId: 'event-steering',
          meetingKind: 'steering',
          observedAt: '2028-03-01T00:00:00.000Z',
          sessionId: 'session-steering',
          startsAt: '2028-02-01T19:00:00.000Z'
        })
      )
      recordEventSessionAttendance(
        connection,
        attendanceInput(sqlite, {
          attendance: [{ id: 'attendance-excused', personId: 'person-window', status: 'excused' }],
          eventId: 'event-excused',
          observedAt: '2028-03-01T00:00:00.000Z',
          sessionId: 'session-excused',
          startsAt: '2028-02-15T19:00:00.000Z'
        })
      )
      recordEventSessionAttendance(
        connection,
        attendanceInput(sqlite, {
          attendance: [{ id: 'attendance-scheduled', personId: 'person-window', status: 'attended' }],
          eventId: 'event-scheduled',
          observedAt: '2028-03-01T00:00:00.000Z',
          sessionId: 'session-scheduled',
          sessionStatus: 'scheduled',
          startsAt: '2028-02-20T19:00:00.000Z'
        })
      )
      recordEventSessionAttendance(
        connection,
        attendanceInput(sqlite, {
          attendance: [{ id: 'attendance-too-old', personId: 'person-window', status: 'attended' }],
          eventId: 'event-too-old',
          observedAt: '2028-03-01T00:00:00.000Z',
          sessionId: 'session-too-old',
          startsAt: '2027-02-28T23:59:59.000Z'
        })
      )
      expect(currentStanding(sqlite, 'membership-window')).toEqual({
        attendanceStatus: 'unmet',
        duesStatus: 'met',
        status: 'not_good'
      })

      const upperBoundary = attendanceInput(sqlite, {
        attendance: [{ id: 'attendance-upper-boundary', personId: 'person-window', status: 'attended' }],
        eventId: 'event-upper-boundary',
        observedAt: '2028-03-01T00:00:00.000Z',
        sessionId: 'session-upper-boundary',
        startsAt: '2028-03-01T00:00:00.000Z'
      })
      recordEventSessionAttendance(connection, upperBoundary)
      expect(currentStanding(sqlite, 'membership-window')).toEqual({
        attendanceStatus: 'met',
        duesStatus: 'met',
        status: 'good'
      })
      recordEventSessionAttendance(connection, {
        ...upperBoundary,
        attendance: [{ ...upperBoundary.attendance[0]!, status: 'absent' }]
      })
      expect(currentStanding(sqlite, 'membership-window')).toEqual({
        attendanceStatus: 'unmet',
        duesStatus: 'met',
        status: 'not_good'
      })

      recordEventSessionAttendance(
        connection,
        attendanceInput(sqlite, {
          attendance: [{ id: 'attendance-boundary', personId: 'person-window', status: 'attended' }],
          eventId: 'event-boundary',
          observedAt: '2028-03-01T00:00:00.000Z',
          sessionId: 'session-boundary',
          startsAt: '2027-03-01T00:00:00.000Z'
        })
      )
      expect(currentStanding(sqlite, 'membership-window')).toEqual({
        attendanceStatus: 'met',
        duesStatus: 'met',
        status: 'good'
      })
      expect(count(sqlite, 'membership_standing_periods')).toBe(2)
    })
  })

  it('preserves standing periods across attendance corrections', () => {
    withMigratedDatabase('corrections', (sqlite, connection) => {
      seedMemberWithPaidDues(sqlite, {
        attendanceStartsAt: '2026-03-01T00:00:00.000Z',
        membershipId: 'membership-correction',
        personId: 'person-correction',
        priceId: 'membership-10-1month'
      })
      const base = attendanceInput(sqlite, {
        attendance: [{ id: 'attendance-correction', personId: 'person-correction', status: 'attended' }],
        eventId: 'event-correction',
        observedAt: '2028-03-01T00:00:00.000Z',
        sessionId: 'session-correction',
        startsAt: '2028-02-15T19:00:00.000Z'
      })

      recordEventSessionAttendance(connection, base)
      const absent = {
        ...base,
        attendance: [{ ...base.attendance[0]!, recordedAt: '2028-03-02T00:00:00.000Z', status: 'absent' as const }],
        observedAt: '2028-03-02T00:00:00.000Z'
      }
      recordEventSessionAttendance(connection, absent)
      recordEventSessionAttendance(connection, absent)
      recordEventSessionAttendance(connection, {
        ...base,
        attendance: [{ ...base.attendance[0]!, recordedAt: '2028-03-03T00:00:00.000Z' }],
        observedAt: '2028-03-03T00:00:00.000Z'
      })

      expect(
        sqlite
          .prepare(
            `select status, attendance_status as attendanceStatus,
               effective_from as effectiveFrom, effective_to as effectiveTo
             from membership_standing_periods where membership_id = ? order by effective_from`
          )
          .all('membership-correction')
      ).toEqual([
        {
          attendanceStatus: 'met',
          effectiveFrom: '2028-03-01T00:00:00.000Z',
          effectiveTo: '2028-03-02T00:00:00.000Z',
          status: 'good'
        },
        {
          attendanceStatus: 'unmet',
          effectiveFrom: '2028-03-02T00:00:00.000Z',
          effectiveTo: '2028-03-03T00:00:00.000Z',
          status: 'not_good'
        },
        {
          attendanceStatus: 'met',
          effectiveFrom: '2028-03-03T00:00:00.000Z',
          effectiveTo: null,
          status: 'good'
        }
      ])
    })
  })

  it('treats both approved Stripe dues prices as membership coverage', () => {
    withMigratedDatabase('dues-prices', (sqlite, connection) => {
      for (const [suffix, priceId] of [
        ['membership', 'membership-10-1month'],
        ['solidarity', 'solidarity-27-1month']
      ] as const) {
        seedMemberWithPaidDues(sqlite, {
          attendanceStartsAt: '2026-01-01T00:00:00.000Z',
          membershipId: `membership-${suffix}`,
          personId: `person-${suffix}`,
          priceId
        })
        recalculateMembershipStanding(connection, {
          membershipId: `membership-${suffix}`,
          observedAt: '2028-03-01T00:00:00.000Z'
        })
        expect(currentStanding(sqlite, `membership-${suffix}`)).toEqual({
          attendanceStatus: 'unmet',
          duesStatus: 'met',
          status: 'not_good'
        })
      }
    })
  })
})

function attendanceInput(
  sqlite: Sqlite,
  input: {
    attendance: Array<{ id: string; personId: string; status: 'absent' | 'attended' | 'excused' | 'unknown' }>
    eventId: string
    meetingKind?: 'general' | 'steering'
    observedAt: string
    sessionId: string
    sessionStatus?: 'canceled' | 'completed' | 'scheduled'
    startsAt: string
  }
) {
  seedSolidarityEventSession(sqlite, input)
  return {
    attendance: input.attendance.map((value) => ({
      ...value,
      recordedAt: input.observedAt,
      source: 'manual' as const
    })),
    eventSessionId: input.sessionId,
    observedAt: input.observedAt
  }
}

function seedSolidarityEventSession(
  sqlite: Sqlite,
  input: {
    eventId: string
    meetingKind?: 'general' | 'steering'
    sessionId: string
    sessionStatus?: 'canceled' | 'completed' | 'scheduled'
    startsAt: string
  }
) {
  sqlite
    .prepare(
      `insert into events (id, title, kind, visibility)
       values (?, ?, 'meeting', 'members') on conflict(id) do nothing`
    )
    .run(input.eventId, input.meetingKind === 'steering' ? 'WCU Steering Meeting' : 'WCU General Meeting')
  sqlite
    .prepare(
      `insert into event_sessions
         (id, event_id, status, delivery_mode, starts_at, ends_at, timezone)
       values (?, ?, ?, 'in_person', ?, ?, 'America/Los_Angeles') on conflict(id) do nothing`
    )
    .run(input.sessionId, input.eventId, input.sessionStatus ?? 'completed', input.startsAt, input.startsAt)
  sqlite
    .prepare(
      `insert into event_session_provider_links
         (id, event_session_id, provider, external_id, last_seen_at)
       values (?, ?, 'solidarity', ?, '2028-01-01T00:00:00.000Z') on conflict(provider, external_id) do nothing`
    )
    .run(`provider-${input.sessionId}`, input.sessionId, input.sessionId)
  sqlite
    .prepare(
      `insert into meetings (event_session_id, kind)
       values (?, ?) on conflict(event_session_id) do nothing`
    )
    .run(input.sessionId, input.meetingKind ?? 'general')
}

function seedMemberWithPaidDues(
  sqlite: Sqlite,
  input: { attendanceStartsAt: string; membershipId: string; personId: string; priceId: string }
) {
  const customerId = `cus_${input.personId}`
  const subscriptionId = `sub_${input.personId}`
  const invoiceId = `in_${input.personId}`
  sqlite.prepare('insert into people (id, display_name) values (?, ?)').run(input.personId, input.personId)
  sqlite
    .prepare(
      `insert into memberships
        (id, person_id, status, applied_at, started_at, attendance_requirement_starts_at)
       values (?, ?, 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?)`
    )
    .run(input.membershipId, input.personId, input.attendanceStartsAt)
  sqlite.prepare('insert into stripe_customers (id, person_id) values (?, ?)').run(customerId, input.personId)
  sqlite
    .prepare(
      `insert into stripe_subscriptions
        (id, customer_id, status, current_period_start, current_period_end)
       values (?, ?, 'active', '2028-02-01T00:00:00.000Z', '2028-04-01T00:00:00.000Z')`
    )
    .run(subscriptionId, customerId)
  sqlite
    .prepare(
      `insert into membership_dues_subscriptions
        (id, membership_id, subscription_id, effective_from)
       values (?, ?, ?, '2026-01-01T00:00:00.000Z')`
    )
    .run(`dues_${input.personId}`, input.membershipId, subscriptionId)
  sqlite
    .prepare(
      `insert into stripe_subscription_items (id, subscription_id, price_id, quantity)
       values (?, ?, ?, 1)`
    )
    .run(`si_${input.personId}`, subscriptionId, input.priceId)
  sqlite
    .prepare(
      `insert into stripe_invoices
        (id, customer_id, subscription_id, status, currency, subtotal, total,
         amount_due, amount_paid, amount_remaining, period_start, period_end, paid_at)
       values (?, ?, ?, 'paid', 'USD', 1000, 1000, 1000, 1000, 0,
         '2028-02-01T00:00:00.000Z', '2028-04-01T00:00:00.000Z', '2028-02-01T00:05:00.000Z')`
    )
    .run(invoiceId, customerId, subscriptionId)
  sqlite
    .prepare(
      `insert into stripe_invoice_lines
        (id, invoice_id, subscription_item_id, price_id, amount, currency, period_start, period_end)
       values (?, ?, ?, ?, 1000, 'USD', '2028-02-01T00:00:00.000Z', '2028-04-01T00:00:00.000Z')`
    )
    .run(`il_${input.personId}`, invoiceId, `si_${input.personId}`, input.priceId)
}

function currentStanding(sqlite: Sqlite, membershipId: string) {
  return sqlite
    .prepare(
      `select status, dues_status as duesStatus, attendance_status as attendanceStatus
       from membership_standing_periods where membership_id = ? and effective_to is null`
    )
    .get(membershipId)
}

function withMigratedDatabase(
  label: string,
  run: (sqlite: Sqlite, connection: ReturnType<typeof connectionFor>) => void
) {
  const directory = mkdtempSync(join(tmpdir(), `wcu-membership-attendance-${label}-`))
  const databasePath = join(directory, 'app.db')
  const sqlite = new Database(databasePath)
  sqlite.pragma('foreign_keys = ON')
  try {
    migrate(drizzle({ client: sqlite }), { migrationsFolder })
    run(sqlite, connectionFor(sqlite, databasePath))
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  } finally {
    sqlite.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

function connectionFor(sqlite: Sqlite, databasePath: string) {
  return { databasePath, db: drizzle({ client: sqlite, schema }), sqlite }
}

function count(sqlite: Sqlite, table: string): number {
  return (sqlite.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count
}
