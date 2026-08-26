import { sql } from 'drizzle-orm'
import { check, index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { user } from './auth'
import { createdAtColumn, updatedAtColumn } from './core'
import { people } from './people'

export const identityReviewReasons = [
  'ambiguous_verified_email',
  'conflicting_verified_email',
  'phone_match_requires_verified_email',
  'conflicting_verified_identifiers'
] as const

export const identityLinkReviews = sqliteTable(
  'identity_link_reviews',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    reason: text('reason', { enum: identityReviewReasons }).notNull(),
    identifierHash: text('identifier_hash').notNull(),
    status: text('status', { enum: ['open', 'resolved'] })
      .notNull()
      .default('open'),
    resolvedPersonId: text('resolved_person_id').references(() => people.id, { onDelete: 'restrict' }),
    resolvedAt: text('resolved_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex('identity_link_reviews_one_open_user_uidx')
      .on(table.userId)
      .where(sql`${table.status} = 'open'`),
    index('identity_link_reviews_status_idx').on(table.status, table.createdAt),
    check(
      'identity_link_reviews_reason_check',
      sql`${table.reason} in ('ambiguous_verified_email', 'conflicting_verified_email', 'phone_match_requires_verified_email', 'conflicting_verified_identifiers')`
    ),
    check(
      'identity_link_reviews_hash_check',
      sql`${table.identifierHash} not glob '*[^0-9a-f]*' and length(${table.identifierHash}) = 64`
    ),
    check(
      'identity_link_reviews_resolution_check',
      sql`(${table.status} = 'open' and ${table.resolvedPersonId} is null and ${table.resolvedAt} is null) or (${table.status} = 'resolved' and ${table.resolvedPersonId} is not null and ${table.resolvedAt} is not null and julianday(${table.resolvedAt}) is not null)`
    )
  ]
)

export type IdentityReviewReason = (typeof identityReviewReasons)[number]
export type IdentityLinkReview = typeof identityLinkReviews.$inferSelect
