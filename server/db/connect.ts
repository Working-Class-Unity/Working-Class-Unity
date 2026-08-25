import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import * as schema from './schema/index'

export type DatabaseConnection = {
  sqlite: InstanceType<typeof Database>
  db: BetterSQLite3Database<typeof schema>
  databasePath: string
}

type SqlitePragmaReader = Pick<InstanceType<typeof Database>, 'pragma'>

const connections = new Map<string, DatabaseConnection>()

export function connectDatabase(databaseUrl: string): DatabaseConnection {
  const databasePath = resolveSqlitePath(databaseUrl)
  const cached = connections.get(databasePath)

  if (cached) {
    return cached
  }

  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true })
  }

  const sqlite = new Database(databasePath)
  sqlite.pragma('foreign_keys = ON')

  if (databasePath !== ':memory:') {
    sqlite.pragma('journal_mode = WAL')
  }

  const connection = {
    sqlite,
    db: drizzle({ client: sqlite, schema }),
    databasePath
  }

  connections.set(databasePath, connection)
  return connection
}

export function resolveSqlitePath(databaseUrl: string): string {
  if (databaseUrl === ':memory:') {
    return databaseUrl
  }

  const rawPath = databaseUrl.startsWith('file:') ? databaseUrl.slice('file:'.length) : databaseUrl
  return isAbsolute(rawPath) ? rawPath : resolve(process.cwd(), rawPath)
}

export function verifySqliteIntegrityAndForeignKeys(
  sqlite: SqlitePragmaReader,
  context: string,
  fail: (message: string) => never
) {
  const rows = sqlite.pragma('integrity_check') as Array<{ integrity_check: string }>
  const integrity = rows.map((row) => row.integrity_check).join('; ')
  if (integrity !== 'ok') {
    fail(`${context} integrity check failed: ${integrity}`)
  }

  const foreignKeyViolations = sqlite.pragma('foreign_key_check') as unknown[]
  if (foreignKeyViolations.length) {
    fail(`${context} foreign-key check failed with ${foreignKeyViolations.length} violation(s).`)
  }

  return { foreignKeys: 'ok', integrity }
}
