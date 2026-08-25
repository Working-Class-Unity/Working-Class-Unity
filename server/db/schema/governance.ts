import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { createdAtColumn, updatedAtColumn } from './core'
import { eventSessions } from './events'
import { memberships } from './membership'
import { people } from './people'
import { externalRecordSnapshots } from './provenance'

export const meetingKinds = ['general', 'steering'] as const
export const motionStatuses = ['proposed', 'adopted', 'rejected', 'tabled', 'withdrawn', 'no_vote'] as const
export const motionPersonRoles = ['mover', 'seconder'] as const
export const voteStatuses = ['draft', 'open', 'closed', 'canceled'] as const
export const voteOutcomes = ['passed', 'failed', 'tied', 'recorded'] as const
export const quorumScopes = ['meeting', 'vote'] as const

export const meetings = sqliteTable(
  'meetings',
  {
    eventSessionId: text('event_session_id')
      .primaryKey()
      .references(() => eventSessions.id, { onDelete: 'restrict' }),
    kind: text('kind', { enum: meetingKinds }).notNull(),
    sourceUrl: text('source_url'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index('meetings_kind_session_idx').on(table.kind, table.eventSessionId),
    check('meetings_kind_check', sql`${table.kind} in ('general', 'steering')`),
    check(
      'meetings_source_url_check',
      sql`${table.sourceUrl} is null or length(trim(${table.sourceUrl})) between 1 and 2000`
    )
  ]
)

export const agendaItems = sqliteTable(
  'agenda_items',
  {
    id: text('id').primaryKey(),
    meetingEventSessionId: text('meeting_event_session_id')
      .notNull()
      .references(() => meetings.eventSessionId, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    kind: text('kind').notNull().default('other'),
    sourceUrl: text('source_url'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex('agenda_items_meeting_position_uidx').on(table.meetingEventSessionId, table.position),
    index('agenda_items_meeting_idx').on(table.meetingEventSessionId, table.id),
    check('agenda_items_position_check', sql`${table.position} >= 1`),
    check('agenda_items_title_check', sql`length(trim(${table.title})) between 1 and 500`),
    check('agenda_items_kind_check', sql`length(trim(${table.kind})) between 1 and 100`),
    check(
      'agenda_items_source_url_check',
      sql`${table.sourceUrl} is null or length(trim(${table.sourceUrl})) between 1 and 2000`
    )
  ]
)

export const motions = sqliteTable(
  'motions',
  {
    id: text('id').primaryKey(),
    agendaItemId: text('agenda_item_id')
      .notNull()
      .references(() => agendaItems.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
    text: text('text').notNull(),
    status: text('status', { enum: motionStatuses }).notNull().default('proposed'),
    sourceUrl: text('source_url'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex('motions_agenda_position_uidx').on(table.agendaItemId, table.position),
    uniqueIndex('motions_agenda_id_id_uidx').on(table.agendaItemId, table.id),
    index('motions_status_idx').on(table.status, table.agendaItemId),
    check('motions_position_check', sql`${table.position} >= 1`),
    check('motions_text_check', sql`length(trim(${table.text})) between 1 and 10000`),
    check(
      'motions_status_check',
      sql`${table.status} in ('proposed', 'adopted', 'rejected', 'tabled', 'withdrawn', 'no_vote')`
    ),
    check(
      'motions_source_url_check',
      sql`${table.sourceUrl} is null or length(trim(${table.sourceUrl})) between 1 and 2000`
    )
  ]
)

export const motionPeople = sqliteTable(
  'motion_people',
  {
    motionId: text('motion_id')
      .notNull()
      .references(() => motions.id, { onDelete: 'restrict' }),
    personId: text('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'restrict' }),
    role: text('role', { enum: motionPersonRoles }).notNull(),
    createdAt: createdAtColumn()
  },
  (table) => [
    uniqueIndex('motion_people_motion_person_role_uidx').on(table.motionId, table.personId, table.role),
    index('motion_people_person_idx').on(table.personId, table.motionId),
    check('motion_people_role_check', sql`${table.role} in ('mover', 'seconder')`)
  ]
)

export const votes = sqliteTable(
  'votes',
  {
    id: text('id').primaryKey(),
    agendaItemId: text('agenda_item_id')
      .notNull()
      .references(() => agendaItems.id, { onDelete: 'restrict' }),
    motionId: text('motion_id'),
    position: integer('position').notNull(),
    round: integer('round').notNull().default(1),
    question: text('question').notNull(),
    decisionRule: text('decision_rule').notNull(),
    status: text('status', { enum: voteStatuses }).notNull().default('draft'),
    outcome: text('outcome', { enum: voteOutcomes }),
    openedAt: text('opened_at'),
    closedAt: text('closed_at'),
    sourceUrl: text('source_url'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    foreignKey({
      columns: [table.agendaItemId, table.motionId],
      foreignColumns: [motions.agendaItemId, motions.id],
      name: 'votes_agenda_motion_fk'
    }).onDelete('restrict'),
    uniqueIndex('votes_agenda_position_uidx').on(table.agendaItemId, table.position),
    uniqueIndex('votes_motion_round_uidx')
      .on(table.motionId, table.round)
      .where(sql`${table.motionId} is not null`),
    index('votes_status_idx').on(table.status, table.openedAt),
    check('votes_position_round_check', sql`${table.position} >= 1 and ${table.round} >= 1`),
    check('votes_question_check', sql`length(trim(${table.question})) between 1 and 10000`),
    check('votes_decision_rule_check', sql`length(trim(${table.decisionRule})) between 1 and 500`),
    check('votes_status_check', sql`${table.status} in ('draft', 'open', 'closed', 'canceled')`),
    check(
      'votes_outcome_check',
      sql`${table.outcome} is null or ${table.outcome} in ('passed', 'failed', 'tied', 'recorded')`
    ),
    check(
      'votes_lifecycle_check',
      sql`(${table.status} = 'draft' and ${table.openedAt} is null and ${table.closedAt} is null and ${table.outcome} is null) or (${table.status} = 'open' and ${table.openedAt} is not null and julianday(${table.openedAt}) is not null and ${table.closedAt} is null and ${table.outcome} is null) or (${table.status} = 'closed' and ${table.openedAt} is not null and ${table.closedAt} is not null and julianday(${table.closedAt}) >= julianday(${table.openedAt}) and ${table.outcome} is not null) or (${table.status} = 'canceled' and ${table.outcome} is null and (${table.openedAt} is null or julianday(${table.openedAt}) is not null) and (${table.closedAt} is null or (${table.openedAt} is not null and julianday(${table.closedAt}) >= julianday(${table.openedAt}))))`
    ),
    check(
      'votes_source_url_check',
      sql`${table.sourceUrl} is null or length(trim(${table.sourceUrl})) between 1 and 2000`
    )
  ]
)

export const voteOptions = sqliteTable(
  'vote_options',
  {
    id: text('id').primaryKey(),
    voteId: text('vote_id')
      .notNull()
      .references(() => votes.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    label: text('label').notNull(),
    position: integer('position').notNull(),
    countsTowardDecision: integer('counts_toward_decision', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAtColumn()
  },
  (table) => [
    uniqueIndex('vote_options_vote_id_id_uidx').on(table.voteId, table.id),
    uniqueIndex('vote_options_vote_code_uidx').on(table.voteId, table.code),
    uniqueIndex('vote_options_vote_position_uidx').on(table.voteId, table.position),
    check('vote_options_code_check', sql`length(trim(${table.code})) between 1 and 100`),
    check('vote_options_label_check', sql`length(trim(${table.label})) between 1 and 500`),
    check('vote_options_position_check', sql`${table.position} >= 1`)
  ]
)

export const voteEligibilitySnapshots = sqliteTable(
  'vote_eligibility_snapshots',
  {
    id: text('id').primaryKey(),
    voteId: text('vote_id')
      .notNull()
      .references(() => votes.id, { onDelete: 'restrict' }),
    personId: text('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'restrict' }),
    membershipId: text('membership_id'),
    standingStatus: text('standing_status').notNull(),
    capturedAt: text('captured_at').notNull(),
    createdAt: createdAtColumn()
  },
  (table) => [
    foreignKey({
      columns: [table.personId, table.membershipId],
      foreignColumns: [memberships.personId, memberships.id],
      name: 'vote_eligibility_person_membership_fk'
    }).onDelete('restrict'),
    uniqueIndex('vote_eligibility_vote_person_uidx').on(table.voteId, table.personId),
    index('vote_eligibility_person_idx').on(table.personId, table.voteId),
    check('vote_eligibility_standing_check', sql`${table.standingStatus} in ('good', 'grace')`),
    check('vote_eligibility_captured_at_check', sql`julianday(${table.capturedAt}) is not null`)
  ]
)

export const voteCasts = sqliteTable(
  'vote_casts',
  {
    id: text('id').primaryKey(),
    voteId: text('vote_id')
      .notNull()
      .references(() => votes.id, { onDelete: 'restrict' }),
    optionId: text('option_id').notNull(),
    personId: text('person_id').notNull(),
    castAt: text('cast_at').notNull(),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    foreignKey({
      columns: [table.voteId, table.optionId],
      foreignColumns: [voteOptions.voteId, voteOptions.id],
      name: 'vote_casts_vote_option_fk'
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.voteId, table.personId],
      foreignColumns: [voteEligibilitySnapshots.voteId, voteEligibilitySnapshots.personId],
      name: 'vote_casts_eligible_person_fk'
    }).onDelete('restrict'),
    uniqueIndex('vote_casts_vote_person_uidx').on(table.voteId, table.personId),
    index('vote_casts_person_idx').on(table.personId, table.castAt),
    check('vote_casts_cast_at_check', sql`julianday(${table.castAt}) is not null`)
  ]
)

export const quorumSnapshots = sqliteTable(
  'quorum_snapshots',
  {
    id: text('id').primaryKey(),
    meetingEventSessionId: text('meeting_event_session_id').references(() => meetings.eventSessionId, {
      onDelete: 'restrict'
    }),
    voteId: text('vote_id').references(() => votes.id, { onDelete: 'restrict' }),
    scope: text('scope', { enum: quorumScopes }).notNull(),
    eligibleMemberCount: integer('eligible_member_count').notNull(),
    eligiblePresentCount: integer('eligible_present_count').notNull(),
    totalPresentCount: integer('total_present_count').notNull(),
    requiredCount: integer('required_count').notNull(),
    met: integer('met', { mode: 'boolean' }).notNull(),
    basis: text('basis').notNull(),
    capturedAt: text('captured_at').notNull(),
    createdAt: createdAtColumn()
  },
  (table) => [
    uniqueIndex('quorum_snapshots_vote_uidx')
      .on(table.voteId)
      .where(sql`${table.voteId} is not null`),
    index('quorum_snapshots_meeting_captured_idx').on(table.meetingEventSessionId, table.capturedAt),
    check('quorum_snapshots_scope_check', sql`${table.scope} in ('meeting', 'vote')`),
    check(
      'quorum_snapshots_scope_target_check',
      sql`(${table.scope} = 'meeting' and ${table.meetingEventSessionId} is not null and ${table.voteId} is null) or (${table.scope} = 'vote' and ${table.meetingEventSessionId} is null and ${table.voteId} is not null)`
    ),
    check(
      'quorum_snapshots_counts_check',
      sql`${table.eligibleMemberCount} >= 0 and ${table.eligiblePresentCount} >= 0 and ${table.totalPresentCount} >= 0 and ${table.requiredCount} >= 0 and ${table.eligiblePresentCount} <= ${table.eligibleMemberCount} and ${table.eligiblePresentCount} <= ${table.totalPresentCount}`
    ),
    check(
      'quorum_snapshots_result_check',
      sql`(${table.met} = 1 and ${table.eligiblePresentCount} >= ${table.requiredCount}) or (${table.met} = 0 and ${table.eligiblePresentCount} < ${table.requiredCount})`
    ),
    check('quorum_snapshots_basis_check', sql`length(trim(${table.basis})) between 1 and 1000`),
    check('quorum_snapshots_captured_at_check', sql`julianday(${table.capturedAt}) is not null`)
  ]
)

export type MeetingKind = (typeof meetingKinds)[number]
export type MotionStatus = (typeof motionStatuses)[number]
export type VoteStatus = (typeof voteStatuses)[number]
export type VoteOutcome = (typeof voteOutcomes)[number]
export type Meeting = typeof meetings.$inferSelect
export type AgendaItem = typeof agendaItems.$inferSelect
export type Motion = typeof motions.$inferSelect
export type Vote = typeof votes.$inferSelect
export type VoteCast = typeof voteCasts.$inferSelect
