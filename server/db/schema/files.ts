import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { user } from './auth'
import { createdAtColumn, updatedAtColumn } from './core'

export const fileStatuses = ['pending', 'ready', 'deleted'] as const
export const maxFileUploadBytes = 25 * 1024 * 1024

export const files = sqliteTable(
  'files',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    bucket: text('bucket').notNull(),
    objectKey: text('object_key').notNull(),
    originalName: text('original_name'),
    contentType: text('content_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    contentMd5: text('content_md5').notNull(),
    status: text('status', { enum: fileStatuses }).notNull().default('pending'),
    uploadExpiresAt: text('upload_expires_at').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: text('deleted_at')
  },
  (table) => [
    uniqueIndex('files_object_key_idx').on(table.objectKey),
    index('files_owner_status_created_id_idx').on(table.ownerId, table.status, table.createdAt, table.id),
    index('files_status_upload_expires_id_idx').on(table.status, table.uploadExpiresAt, table.id),
    check('files_identity_check', sql`length(trim(${table.id})) > 0 and length(trim(${table.ownerId})) > 0`),
    check(
      'files_storage_locator_check',
      sql`length(trim(${table.bucket})) > 0 and length(trim(${table.objectKey})) > 0 and length(${table.objectKey}) <= 1024`
    ),
    check(
      'files_metadata_check',
      sql`length(trim(${table.contentType})) between 1 and 180 and ${table.byteSize} between 1 and 26214400 and (${table.originalName} is null or length(trim(${table.originalName})) between 1 and 180)`
    ),
    check('files_status_check', sql`${table.status} in ('pending', 'ready', 'deleted')`),
    check(
      'files_content_md5_check',
      sql`length(${table.contentMd5}) = 24 and substr(${table.contentMd5}, 23, 2) = '==' and substr(${table.contentMd5}, 1, 22) not glob '*[^A-Za-z0-9+/]*' and substr(${table.contentMd5}, 22, 1) in ('A', 'Q', 'g', 'w')`
    ),
    check(
      'files_deletion_state_check',
      sql`(${table.status} = 'deleted' and ${table.deletedAt} is not null) or (${table.status} in ('pending', 'ready') and ${table.deletedAt} is null)`
    ),
    check(
      'files_timestamps_check',
      sql`julianday(${table.createdAt}) is not null and julianday(${table.updatedAt}) is not null and julianday(${table.uploadExpiresAt}) is not null and julianday(${table.updatedAt}) >= julianday(${table.createdAt}) and julianday(${table.uploadExpiresAt}) >= julianday(${table.createdAt}) and (${table.deletedAt} is null or (julianday(${table.deletedAt}) is not null and julianday(${table.deletedAt}) >= julianday(${table.createdAt})))`
    )
  ]
)

export type FileStatus = (typeof fileStatuses)[number]
export type FileMetadata = typeof files.$inferSelect
export type NewFileMetadata = typeof files.$inferInsert
