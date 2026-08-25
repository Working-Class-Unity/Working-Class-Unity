import { sql } from 'drizzle-orm'
import { check, index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { createdAtColumn, updatedAtColumn } from './core'
import { people } from './people'
import { externalRecordSnapshots } from './provenance'

export const eventStatuses = ['active', 'archived'] as const
export const eventCategories = ['meeting', 'action', 'learning', 'social'] as const
export const eventVisibilities = ['hidden', 'public', 'members'] as const
export const eventDeliveryModes = ['in_person', 'virtual', 'hybrid'] as const
export const eventTagKinds = ['event', 'campaign'] as const
export const eventProviders = ['solidarity'] as const
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
    category: text('kind', { enum: eventCategories }).notNull(),
    visibility: text('visibility', { enum: eventVisibilities }).notNull().default('hidden'),
    status: text('status', { enum: eventStatuses }).notNull().default('active'),
    defaultTimezone: text('default_timezone').notNull().default('America/Los_Angeles'),
    eventPageUrl: text('event_page_url'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index('events_status_kind_idx').on(table.status, table.category),
    index('events_visibility_status_category_idx').on(table.visibility, table.status, table.category),
    check('events_title_check', sql`length(trim(${table.title})) between 1 and 255`),
    check('events_kind_check', sql`length(trim(${table.category})) between 1 and 100`),
    check('events_visibility_check', sql`${table.visibility} in ('hidden', 'public', 'members')`),
    check('events_status_check', sql`${table.status} in ('active', 'archived')`),
    check('events_timezone_check', sql`length(trim(${table.defaultTimezone})) between 1 and 100`),
    check(
      'events_page_url_check',
      sql`${table.eventPageUrl} is null or (length(trim(${table.eventPageUrl})) between 9 and 2000 and lower(${table.eventPageUrl}) like 'https://%')`
    )
  ]
)

export const eventSessions = sqliteTable(
  'event_sessions',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    title: text('title'),
    status: text('status', { enum: eventSessionStatuses }).notNull().default('scheduled'),
    deliveryMode: text('delivery_mode', { enum: eventDeliveryModes }).notNull().default('in_person'),
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at'),
    timezone: text('timezone').notNull(),
    locationName: text('location_name'),
    locationAddress: text('location'),
    virtualUrl: text('virtual_url'),
    rsvpUrl: text('rsvp_url'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index('event_sessions_event_start_idx').on(table.eventId, table.startsAt),
    index('event_sessions_status_start_idx').on(table.status, table.startsAt),
    check('event_sessions_title_check', sql`${table.title} is null or length(trim(${table.title})) between 1 and 255`),
    check('event_sessions_status_check', sql`${table.status} in ('scheduled', 'canceled', 'completed')`),
    check('event_sessions_delivery_check', sql`${table.deliveryMode} in ('in_person', 'virtual', 'hybrid')`),
    check(
      'event_sessions_interval_check',
      sql`julianday(${table.startsAt}) is not null and (${table.endsAt} is null or julianday(${table.endsAt}) >= julianday(${table.startsAt}))`
    ),
    check('event_sessions_timezone_check', sql`length(trim(${table.timezone})) between 1 and 100`),
    check(
      'event_sessions_location_name_check',
      sql`${table.locationName} is null or length(trim(${table.locationName})) between 1 and 255`
    ),
    check(
      'event_sessions_location_check',
      sql`(${table.locationAddress} is null or length(trim(${table.locationAddress})) between 1 and 500) and (${table.virtualUrl} is null or length(trim(${table.virtualUrl})) between 1 and 2000)`
    ),
    check(
      'event_sessions_rsvp_url_check',
      sql`${table.rsvpUrl} is null or (length(trim(${table.rsvpUrl})) between 9 and 2000 and lower(${table.rsvpUrl}) like 'https://%')`
    )
  ]
)

export const eventTags = sqliteTable(
  'event_tags',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    kind: text('kind', { enum: eventTagKinds }).notNull(),
    value: text('value').notNull(),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex('event_tags_event_kind_value_uidx').on(table.eventId, table.kind, table.value),
    index('event_tags_kind_value_idx').on(table.kind, table.value, table.eventId),
    check('event_tags_kind_check', sql`${table.kind} in ('event', 'campaign')`),
    check(
      'event_tags_value_check',
      sql`${table.value} = trim(${table.value}) and length(${table.value}) between 1 and 100`
    )
  ]
)

export const eventProviderLinks = sqliteTable(
  'event_provider_links',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    provider: text('provider', { enum: eventProviders }).notNull(),
    externalId: text('external_id').notNull(),
    primaryExternalId: text('primary_external_id'),
    sourceUrl: text('source_url'),
    lastSeenAt: text('last_seen_at').notNull(),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex('event_provider_links_provider_external_uidx').on(table.provider, table.externalId),
    index('event_provider_links_event_idx').on(table.eventId, table.provider),
    check('event_provider_links_provider_check', sql`${table.provider} = 'solidarity'`),
    check(
      'event_provider_links_identity_check',
      sql`length(trim(${table.externalId})) between 1 and 255 and (${table.primaryExternalId} is null or length(trim(${table.primaryExternalId})) between 1 and 255)`
    ),
    check(
      'event_provider_links_source_check',
      sql`${table.sourceUrl} is null or (length(trim(${table.sourceUrl})) between 9 and 2000 and lower(${table.sourceUrl}) like 'https://%')`
    ),
    check('event_provider_links_seen_check', sql`julianday(${table.lastSeenAt}) is not null`)
  ]
)

export const eventSessionProviderLinks = sqliteTable(
  'event_session_provider_links',
  {
    id: text('id').primaryKey(),
    eventSessionId: text('event_session_id')
      .notNull()
      .references(() => eventSessions.id, { onDelete: 'restrict' }),
    provider: text('provider', { enum: eventProviders }).notNull(),
    externalId: text('external_id').notNull(),
    primaryExternalId: text('primary_external_id'),
    pairedExternalId: text('paired_external_id'),
    lastSeenAt: text('last_seen_at').notNull(),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex('event_session_provider_links_provider_external_uidx').on(table.provider, table.externalId),
    index('event_session_provider_links_session_idx').on(table.eventSessionId, table.provider),
    check('event_session_provider_links_provider_check', sql`${table.provider} = 'solidarity'`),
    check(
      'event_session_provider_links_identity_check',
      sql`length(trim(${table.externalId})) between 1 and 255 and (${table.primaryExternalId} is null or length(trim(${table.primaryExternalId})) between 1 and 255) and (${table.pairedExternalId} is null or length(trim(${table.pairedExternalId})) between 1 and 255)`
    ),
    check('event_session_provider_links_seen_check', sql`julianday(${table.lastSeenAt}) is not null`)
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
export type EventCategory = (typeof eventCategories)[number]
export type EventVisibility = (typeof eventVisibilities)[number]
export type EventDeliveryMode = (typeof eventDeliveryModes)[number]
export type EventTagKind = (typeof eventTagKinds)[number]
export type EventSessionStatus = (typeof eventSessionStatuses)[number]
export type RsvpStatus = (typeof rsvpStatuses)[number]
export type AttendanceStatus = (typeof attendanceStatuses)[number]
export type Event = typeof events.$inferSelect
export type EventSession = typeof eventSessions.$inferSelect
export type Attendance = typeof attendance.$inferSelect
