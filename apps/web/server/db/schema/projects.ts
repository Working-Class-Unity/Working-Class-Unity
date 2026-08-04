import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { user } from './auth'
import { createdAtColumn, updatedAtColumn } from './core'

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [index('projects_owner_user_id_idx').on(table.ownerUserId)]
)

export type Project = typeof projects.$inferSelect
