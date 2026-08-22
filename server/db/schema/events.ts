import { sql } from 'drizzle-orm'
import { check, index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { createdAtColumn, updatedAtColumn } from './core'
import { people } from './people'
import { externalRecordSnapshots } from './provenance'

export const eventStatuses = ['active', 'archived'] as const
export const eventSessionStatuses = ['scheduled', 'canceled', 'completed'] as const
export const rsvpStatuses = ['yes', 'no', 'maybe', 'waitlisted', 'canceled'] as const
export const attendanceStatuses = ['attended', 'absent', 'excused', 'unknown'] as const
export const attendanceSources = ['manual', 'solidarity', 'discourse', 'import'] as const

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    kind: text('kind').notNull(),
    status: text('status', { enum: eventStatuses }).notNull().default('active'),
    defaultTimezone: text('default_timezone').notNull().default('America/Los_Angeles'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index('events_status_kind_idx').on(table.status, table.kind),
    check('events_title_check', sql`length(trim(${table.title})) between 1 and 255`),
    check('events_kind_check', sql`length(trim(${table.kind})) between 1 and 100`),
    check('events_status_check', sql`${table.status} in ('active', 'archived')`),
    check('events_timezone_check', sql`length(trim(${table.defaultTimezone})) between 1 and 100`)
  ]
)

export const eventSessions = sqliteTable(
  'event_sessions',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    status: text('status', { enum: eventSessionStatuses }).notNull().default('scheduled'),
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at'),
    timezone: text('timezone').notNull(),
    location: text('location'),
    virtualUrl: text('virtual_url'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index('event_sessions_event_start_idx').on(table.eventId, table.startsAt),
    index('event_sessions_status_start_idx').on(table.status, table.startsAt),
    check('event_sessions_status_check', sql`${table.status} in ('scheduled', 'canceled', 'completed')`),
    check(
      'event_sessions_interval_check',
      sql`julianday(${table.startsAt}) is not null and (${table.endsAt} is null or julianday(${table.endsAt}) >= julianday(${table.startsAt}))`
    ),
    check('event_sessions_timezone_check', sql`length(trim(${table.timezone})) between 1 and 100`),
    check(
      'event_sessions_location_check',
      sql`(${table.location} is null or length(trim(${table.location})) between 1 and 500) and (${table.virtualUrl} is null or length(trim(${table.virtualUrl})) between 1 and 2000)`
    )
  ]
)

export const rsvps = sqliteTable(
  'rsvps',
  {
    id: text('id').primaryKey(),
    eventSessionId: text('event_session_id')
      .notNull()
      .references(() => eventSessions.id, { onDelete: 'restrict' }),
    personId: text('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'restrict' }),
    status: text('status', { enum: rsvpStatuses }).notNull(),
    respondedAt: text('responded_at').notNull(),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex('rsvps_session_person_uidx').on(table.eventSessionId, table.personId),
    index('rsvps_person_idx').on(table.personId, table.respondedAt),
    check('rsvps_status_check', sql`${table.status} in ('yes', 'no', 'maybe', 'waitlisted', 'canceled')`),
    check('rsvps_responded_at_check', sql`julianday(${table.respondedAt}) is not null`)
  ]
)

export const attendance = sqliteTable(
  'attendance',
  {
    id: text('id').primaryKey(),
    eventSessionId: text('event_session_id')
      .notNull()
      .references(() => eventSessions.id, { onDelete: 'restrict' }),
    personId: text('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'restrict' }),
    status: text('status', { enum: attendanceStatuses }).notNull(),
    source: text('source', { enum: attendanceSources }).notNull(),
    recordedAt: text('recorded_at').notNull(),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex('attendance_session_person_uidx').on(table.eventSessionId, table.personId),
    index('attendance_person_recorded_idx').on(table.personId, table.recordedAt),
    check('attendance_status_check', sql`${table.status} in ('attended', 'absent', 'excused', 'unknown')`),
    check('attendance_source_check', sql`${table.source} in ('manual', 'solidarity', 'discourse', 'import')`),
    check('attendance_recorded_at_check', sql`julianday(${table.recordedAt}) is not null`)
  ]
)

export const attendanceIntervals = sqliteTable(
  'attendance_intervals',
  {
    id: text('id').primaryKey(),
    attendanceId: text('attendance_id')
      .notNull()
      .references(() => attendance.id, { onDelete: 'restrict' }),
    checkedInAt: text('checked_in_at').notNull(),
    checkedOutAt: text('checked_out_at'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn()
  },
  (table) => [
    uniqueIndex('attendance_intervals_attendance_checkin_uidx').on(table.attendanceId, table.checkedInAt),
    check(
      'attendance_intervals_range_check',
      sql`julianday(${table.checkedInAt}) is not null and (${table.checkedOutAt} is null or julianday(${table.checkedOutAt}) >= julianday(${table.checkedInAt}))`
    )
  ]
)

export type EventStatus = (typeof eventStatuses)[number]
export type EventSessionStatus = (typeof eventSessionStatuses)[number]
export type RsvpStatus = (typeof rsvpStatuses)[number]
export type AttendanceStatus = (typeof attendanceStatuses)[number]
export type Event = typeof events.$inferSelect
export type EventSession = typeof eventSessions.$inferSelect
export type Attendance = typeof attendance.$inferSelect
