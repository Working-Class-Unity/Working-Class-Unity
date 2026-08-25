import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const authTimestamp = (name: string) => integer(name, { mode: 'timestamp' }).notNull()
const optionalAuthTimestamp = (name: string) => integer(name, { mode: 'timestamp' })
export const userRoles = ['user', 'admin'] as const

export const user = sqliteTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    image: text('image'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    displayName: text('display_name'),
    role: text('role', { enum: userRoles }).notNull().default('user'),
    createdAt: authTimestamp('created_at'),
    updatedAt: authTimestamp('updated_at')
  },
  (table) => [
    uniqueIndex('user_email_idx').on(table.email),
    check('user_name_check', sql`${table.name} = trim(${table.name}) and length(${table.name}) between 1 and 100`),
    check(
      'user_first_name_check',
      sql`${table.firstName} is null or (${table.firstName} = trim(${table.firstName}) and length(${table.firstName}) between 1 and 100)`
    ),
    check(
      'user_last_name_check',
      sql`${table.lastName} is null or (${table.lastName} = trim(${table.lastName}) and length(${table.lastName}) between 1 and 100)`
    ),
    check(
      'user_display_name_check',
      sql`${table.displayName} is null or (${table.displayName} = trim(${table.displayName}) and length(${table.displayName}) between 1 and 100)`
    ),
    check('user_role_check', sql`${table.role} in ('user', 'admin')`)
  ]
)

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: authTimestamp('expires_at'),
    token: text('token').notNull(),
    createdAt: authTimestamp('created_at'),
    updatedAt: authTimestamp('updated_at'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' })
  },
  (table) => [uniqueIndex('session_token_idx').on(table.token), index('session_user_id_idx').on(table.userId)]
)

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: optionalAuthTimestamp('access_token_expires_at'),
    refreshTokenExpiresAt: optionalAuthTimestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: authTimestamp('created_at'),
    updatedAt: authTimestamp('updated_at')
  },
  (table) => [
    index('account_user_id_idx').on(table.userId),
    uniqueIndex('account_provider_account_idx').on(table.providerId, table.accountId)
  ]
)

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: authTimestamp('expires_at'),
    createdAt: authTimestamp('created_at'),
    updatedAt: authTimestamp('updated_at')
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)]
)

export type User = typeof user.$inferSelect
export type UserRole = (typeof userRoles)[number]
export type Session = typeof session.$inferSelect
export type Account = typeof account.$inferSelect
export type Verification = typeof verification.$inferSelect
