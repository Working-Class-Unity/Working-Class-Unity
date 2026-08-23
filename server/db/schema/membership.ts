import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { createdAtColumn, updatedAtColumn } from './core'
import { people } from './people'
import { externalRecordSnapshots } from './provenance'

export const membershipStatuses = ['pending', 'active', 'ended'] as const
export const membershipEndReasons = [
  'resigned',
  'expelled',
  'deceased',
  'withdrawn',
  'ineligible',
  'duplicate',
  'other'
] as const
export const membershipConnectionKinds = ['resides', 'works', 'studies', 'worships'] as const
export const memberDisclosureKinds = [
  'law_enforcement',
  'supervisor',
  'human_resources',
  'landlord',
  'nonprofit_leadership'
] as const
export const membershipStandingStatuses = ['pending', 'good', 'grace', 'not_good'] as const
export const membershipFactorStatuses = ['met', 'unmet', 'pending', 'not_applicable'] as const

export const memberships = sqliteTable(
  'memberships',
  {
    id: text('id').primaryKey(),
    personId: text('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'restrict' }),
    status: text('status', { enum: membershipStatuses }).notNull().default('pending'),
    appliedAt: text('applied_at').notNull(),
    startedAt: text('started_at'),
    attendanceRequirementStartsAt: text('attendance_requirement_starts_at'),
    endedAt: text('ended_at'),
    endReason: text('end_reason', { enum: membershipEndReasons }),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex('memberships_one_open_person_uidx')
      .on(table.personId)
      .where(sql`${table.endedAt} is null`),
    uniqueIndex('memberships_person_id_id_uidx').on(table.personId, table.id),
    index('memberships_status_idx').on(table.status, table.startedAt),
    check('memberships_status_check', sql`${table.status} in ('pending', 'active', 'ended')`),
    check(
      'memberships_end_reason_check',
      sql`${table.endReason} is null or ${table.endReason} in ('resigned', 'expelled', 'deceased', 'withdrawn', 'ineligible', 'duplicate', 'other')`
    ),
    check(
      'memberships_lifecycle_check',
      sql`(${table.status} = 'pending' and ${table.startedAt} is null and ${table.endedAt} is null and ${table.endReason} is null) or (${table.status} = 'active' and ${table.startedAt} is not null and julianday(${table.startedAt}) >= julianday(${table.appliedAt}) and ${table.endedAt} is null and ${table.endReason} is null) or (${table.status} = 'ended' and ${table.endedAt} is not null and ${table.endReason} is not null and ((${table.startedAt} is null and ${table.endReason} in ('withdrawn', 'ineligible', 'duplicate') and julianday(${table.endedAt}) >= julianday(${table.appliedAt})) or (${table.startedAt} is not null and julianday(${table.startedAt}) >= julianday(${table.appliedAt}) and julianday(${table.endedAt}) >= julianday(${table.startedAt}))))`
    ),
    check(
      'memberships_dates_check',
      sql`julianday(${table.appliedAt}) is not null and (${table.attendanceRequirementStartsAt} is null or (${table.startedAt} is not null and julianday(${table.attendanceRequirementStartsAt}) >= julianday(${table.startedAt})))`
    )
  ]
)

export const membershipPolicies = sqliteTable(
  'membership_policies',
  {
    id: text('id').primaryKey(),
    effectiveFrom: text('effective_from').notNull(),
    effectiveTo: text('effective_to'),
    duesGraceDays: integer('dues_grace_days').notNull(),
    requiredGeneralMeetings: integer('required_general_meetings').notNull(),
    attendanceWindowMonths: integer('attendance_window_months').notNull(),
    sourceUrl: text('source_url'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn()
  },
  (table) => [
    uniqueIndex('membership_policies_one_current_uidx')
      .on(sql`(1)`)
      .where(sql`${table.effectiveTo} is null`),
    uniqueIndex('membership_policies_effective_from_uidx').on(table.effectiveFrom),
    check(
      'membership_policies_values_check',
      sql`${table.duesGraceDays} between 0 and 365 and ${table.requiredGeneralMeetings} between 1 and 12 and ${table.attendanceWindowMonths} between 1 and 60`
    ),
    check(
      'membership_policies_interval_check',
      sql`julianday(${table.effectiveFrom}) is not null and (${table.effectiveTo} is null or julianday(${table.effectiveTo}) > julianday(${table.effectiveFrom}))`
    )
  ]
)

export const membershipAttestations = sqliteTable(
  'membership_attestations',
  {
    id: text('id').primaryKey(),
    membershipId: text('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'restrict' }),
    connectionKind: text('connection_kind', { enum: membershipConnectionKinds }).notNull(),
    codeOfConductVersion: text('code_of_conduct_version').notNull(),
    attestedAt: text('attested_at').notNull(),
    supersededAt: text('superseded_at'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn()
  },
  (table) => [
    uniqueIndex('membership_attestations_one_current_uidx')
      .on(table.membershipId)
      .where(sql`${table.supersededAt} is null`),
    index('membership_attestations_membership_idx').on(table.membershipId, table.attestedAt),
    check(
      'membership_attestations_connection_check',
      sql`${table.connectionKind} in ('resides', 'works', 'studies', 'worships')`
    ),
    check('membership_attestations_code_check', sql`length(trim(${table.codeOfConductVersion})) between 1 and 100`),
    check(
      'membership_attestations_interval_check',
      sql`julianday(${table.attestedAt}) is not null and (${table.supersededAt} is null or julianday(${table.supersededAt}) > julianday(${table.attestedAt}))`
    )
  ]
)

export const memberDisclosures = sqliteTable(
  'member_disclosures',
  {
    id: text('id').primaryKey(),
    membershipId: text('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'restrict' }),
    kind: text('kind', { enum: memberDisclosureKinds }).notNull(),
    disclosed: integer('disclosed', { mode: 'boolean' }).notNull(),
    details: text('details'),
    effectiveFrom: text('effective_from').notNull(),
    effectiveTo: text('effective_to'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn()
  },
  (table) => [
    uniqueIndex('member_disclosures_one_current_kind_uidx')
      .on(table.membershipId, table.kind)
      .where(sql`${table.effectiveTo} is null`),
    index('member_disclosures_membership_idx').on(table.membershipId, table.effectiveFrom),
    check(
      'member_disclosures_kind_check',
      sql`${table.kind} in ('law_enforcement', 'supervisor', 'human_resources', 'landlord', 'nonprofit_leadership')`
    ),
    check(
      'member_disclosures_details_check',
      sql`${table.details} is null or length(trim(${table.details})) between 1 and 2000`
    ),
    check(
      'member_disclosures_interval_check',
      sql`julianday(${table.effectiveFrom}) is not null and (${table.effectiveTo} is null or julianday(${table.effectiveTo}) > julianday(${table.effectiveFrom}))`
    )
  ]
)

export const membershipStandingPeriods = sqliteTable(
  'membership_standing_periods',
  {
    id: text('id').primaryKey(),
    membershipId: text('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'restrict' }),
    policyId: text('policy_id')
      .notNull()
      .references(() => membershipPolicies.id, { onDelete: 'restrict' }),
    status: text('status', { enum: membershipStandingStatuses }).notNull(),
    duesStatus: text('dues_status', { enum: membershipFactorStatuses }).notNull(),
    attendanceStatus: text('attendance_status', { enum: membershipFactorStatuses }).notNull(),
    eligibilityStatus: text('eligibility_status', { enum: membershipFactorStatuses }).notNull(),
    conductStatus: text('conduct_status', { enum: membershipFactorStatuses }).notNull(),
    graceEndsAt: text('grace_ends_at'),
    effectiveFrom: text('effective_from').notNull(),
    effectiveTo: text('effective_to'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn()
  },
  (table) => [
    uniqueIndex('membership_standing_one_current_uidx')
      .on(table.membershipId)
      .where(sql`${table.effectiveTo} is null`),
    uniqueIndex('membership_standing_membership_from_uidx').on(table.membershipId, table.effectiveFrom),
    index('membership_standing_status_idx').on(table.status, table.effectiveFrom),
    check('membership_standing_status_check', sql`${table.status} in ('pending', 'good', 'grace', 'not_good')`),
    check(
      'membership_standing_factor_check',
      sql`${table.duesStatus} in ('met', 'unmet', 'pending', 'not_applicable') and ${table.attendanceStatus} in ('met', 'unmet', 'pending', 'not_applicable') and ${table.eligibilityStatus} in ('met', 'unmet', 'pending', 'not_applicable') and ${table.conductStatus} in ('met', 'unmet', 'pending', 'not_applicable')`
    ),
    check(
      'membership_standing_consistency_check',
      sql`(${table.status} = 'good' and ${table.duesStatus} in ('met', 'not_applicable') and ${table.attendanceStatus} in ('met', 'not_applicable') and ${table.eligibilityStatus} in ('met', 'not_applicable') and ${table.conductStatus} in ('met', 'not_applicable')) or (${table.status} = 'grace' and ${table.duesStatus} = 'unmet' and ${table.attendanceStatus} in ('met', 'not_applicable') and ${table.eligibilityStatus} in ('met', 'not_applicable') and ${table.conductStatus} in ('met', 'not_applicable')) or (${table.status} = 'not_good' and 'unmet' in (${table.duesStatus}, ${table.attendanceStatus}, ${table.eligibilityStatus}, ${table.conductStatus})) or (${table.status} = 'pending' and 'pending' in (${table.duesStatus}, ${table.attendanceStatus}, ${table.eligibilityStatus}, ${table.conductStatus}))`
    ),
    check(
      'membership_standing_grace_check',
      sql`(${table.status} = 'grace' and ${table.graceEndsAt} is not null and julianday(${table.graceEndsAt}) > julianday(${table.effectiveFrom})) or (${table.status} <> 'grace' and ${table.graceEndsAt} is null)`
    ),
    check(
      'membership_standing_interval_check',
      sql`julianday(${table.effectiveFrom}) is not null and (${table.effectiveTo} is null or julianday(${table.effectiveTo}) > julianday(${table.effectiveFrom}))`
    )
  ]
)

export type MembershipStatus = (typeof membershipStatuses)[number]
export type MembershipEndReason = (typeof membershipEndReasons)[number]
export type MembershipConnectionKind = (typeof membershipConnectionKinds)[number]
export type MemberDisclosureKind = (typeof memberDisclosureKinds)[number]
export type MembershipStandingStatus = (typeof membershipStandingStatuses)[number]
export type Membership = typeof memberships.$inferSelect
export type MembershipPolicy = typeof membershipPolicies.$inferSelect
export type MembershipStandingPeriod = typeof membershipStandingPeriods.$inferSelect
