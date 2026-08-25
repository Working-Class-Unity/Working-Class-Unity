import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createdAtColumn, type JsonValue, updatedAtColumn } from './core'

export const jobQueue = sqliteTable(
  'job_queue',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type').notNull(),
    status: text('status', { enum: ['queued', 'running', 'succeeded', 'failed'] })
      .notNull()
      .default('queued'),
    payload: text('payload', { mode: 'json' }).$type<JsonValue>().notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    runAfter: text('run_after'),
    lockedAt: text('locked_at'),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index('job_queue_status_run_after_idx').on(table.status, table.runAfter),
    index('job_queue_type_idx').on(table.type)
  ]
)
