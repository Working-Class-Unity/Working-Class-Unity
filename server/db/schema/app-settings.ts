import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { JsonValue } from './core'

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<JsonValue>().notNull()
})
