import { sql } from 'drizzle-orm'
import { text } from 'drizzle-orm/sqlite-core'

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export const createdAtColumn = () =>
  text('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
export const updatedAtColumn = () =>
  text('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
