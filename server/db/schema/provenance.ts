import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { createdAtColumn, updatedAtColumn } from './core'

export const importProviders = ['stripe', 'solidarity', 'discourse', 'pocketbase'] as const
export const importBatchStatuses = ['pending', 'completed', 'failed'] as const

export const importBatches = sqliteTable(
  'import_batches',
  {
    id: text('id').primaryKey(),
    provider: text('provider', { enum: importProviders }).notNull(),
    status: text('status', { enum: importBatchStatuses }).notNull().default('pending'),
    sourceName: text('source_name'),
    sourceChecksum: text('source_checksum'),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
    recordCount: integer('record_count'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index('import_batches_provider_started_idx').on(table.provider, table.startedAt),
    check(
      'import_batches_provider_check',
      sql`${table.provider} in ('stripe', 'solidarity', 'discourse', 'pocketbase')`
    ),
    check('import_batches_status_check', sql`${table.status} in ('pending', 'completed', 'failed')`),
    check('import_batches_started_at_check', sql`julianday(${table.startedAt}) is not null`),
    check(
      'import_batches_completion_check',
      sql`(${table.status} = 'pending' and ${table.completedAt} is null) or (${table.status} in ('completed', 'failed') and ${table.completedAt} is not null and julianday(${table.completedAt}) >= julianday(${table.startedAt}))`
    ),
    check('import_batches_record_count_check', sql`${table.recordCount} is null or ${table.recordCount} >= 0`),
    check(
      'import_batches_checksum_check',
      sql`${table.sourceChecksum} is null or length(trim(${table.sourceChecksum})) between 16 and 128`
    )
  ]
)

export const externalRecordSnapshots = sqliteTable(
  'external_record_snapshots',
  {
    id: text('id').primaryKey(),
    importBatchId: text('import_batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'restrict' }),
    objectType: text('object_type').notNull(),
    externalId: text('external_id').notNull(),
    observedAt: text('observed_at').notNull(),
    payloadHash: text('payload_hash').notNull(),
    rawPayload: text('raw_payload').notNull(),
    createdAt: createdAtColumn()
  },
  (table) => [
    uniqueIndex('external_record_snapshots_batch_object_uidx').on(
      table.importBatchId,
      table.objectType,
      table.externalId
    ),
    index('external_record_snapshots_external_idx').on(table.objectType, table.externalId, table.observedAt),
    check(
      'external_record_snapshots_identity_check',
      sql`length(trim(${table.objectType})) between 1 and 100 and length(trim(${table.externalId})) between 1 and 255`
    ),
    check('external_record_snapshots_hash_check', sql`length(trim(${table.payloadHash})) between 16 and 128`),
    check('external_record_snapshots_payload_check', sql`json_valid(${table.rawPayload})`),
    check('external_record_snapshots_observed_at_check', sql`julianday(${table.observedAt}) is not null`)
  ]
)

export type ImportProvider = (typeof importProviders)[number]
export type ImportBatchStatus = (typeof importBatchStatuses)[number]
export type ImportBatch = typeof importBatches.$inferSelect
export type ExternalRecordSnapshot = typeof externalRecordSnapshots.$inferSelect
