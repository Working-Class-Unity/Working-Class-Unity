import { defineConfig } from 'drizzle-kit'
import { readDatabaseUrl } from './server/utils/runtime'

const databaseUrl = readDatabaseUrl()
const sqliteFile = databaseUrl.startsWith('file:') ? databaseUrl.slice('file:'.length) : databaseUrl

export default defineConfig({
  schema: './server/db/schema/index.ts',
  out: './server/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: sqliteFile
  },
  strict: true,
  verbose: true
})
