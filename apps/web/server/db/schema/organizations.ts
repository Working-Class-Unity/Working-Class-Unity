import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { user } from './auth'

export const organizationRoles = ['owner', 'member'] as const

const organizationTimestamp = (name: string) => integer(name, { mode: 'timestamp_ms' }).notNull()

/**
 * Better Auth Organization's pinned 1.6.23 fields plus baseline-owned
 * personal-owner, unique-membership, and owner/member constraints. The custom
 * runtime-invariants baseline migration adds relational triggers that require
 * owner-for-the-marker and member-for-everyone-else.
 */
export const organization = sqliteTable(
  'organization',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    logo: text('logo'),
    createdAt: organizationTimestamp('created_at'),
    metadata: text('metadata'),
    billingDeletionPending: integer('billing_deletion_pending', { mode: 'boolean' }).notNull().default(false),
    personalOwnerUserId: text('personal_owner_user_id')
      .unique()
      .references(() => user.id, { onDelete: 'restrict' })
  },
  (table) => [uniqueIndex('organization_slug_uidx').on(table.slug)]
)

export const member = sqliteTable(
  'member',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', { enum: organizationRoles }).notNull().default('member'),
    createdAt: organizationTimestamp('created_at')
  },
  (table) => [
    index('member_organizationId_idx').on(table.organizationId),
    index('member_userId_idx').on(table.userId),
    uniqueIndex('member_one_external_family_uidx')
      .on(table.userId)
      .where(sql`${table.role} = 'member'`),
    uniqueIndex('member_organization_id_user_id_uidx').on(table.organizationId, table.userId),
    check('member_single_role_check', sql`${table.role} in ('owner', 'member')`)
  ]
)

export const invitation = sqliteTable(
  'invitation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    status: text('status').notNull().default('pending'),
    expiresAt: organizationTimestamp('expires_at'),
    createdAt: organizationTimestamp('created_at').default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' })
  },
  (table) => [
    index('invitation_organizationId_idx').on(table.organizationId),
    index('invitation_email_idx').on(table.email)
  ]
)

export type Organization = typeof organization.$inferSelect
export type Member = typeof member.$inferSelect
export type Invitation = typeof invitation.$inferSelect
export type OrganizationRole = (typeof organizationRoles)[number]
