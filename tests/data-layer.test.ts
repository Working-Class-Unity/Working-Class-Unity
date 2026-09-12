import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { resolveSqlitePath, verifySqliteIntegrityAndForeignKeys } from '../server/db/connect'

describe('data layer foundation', () => {
  it('keeps SQLite URLs resolvable for local and deployed paths', () => {
    expect(resolveSqlitePath(':memory:')).toBe(':memory:')
    expect(resolveSqlitePath('file:./data/app.db')).toContain('data')
  })

  it('accepts SQLite databases with exact integrity and foreign-key checks', () => {
    const sqlite = new Database(':memory:')
    try {
      expect(verifySqliteIntegrityAndForeignKeys(sqlite, 'Test database', failVerification)).toEqual({
        foreignKeys: 'ok',
        integrity: 'ok'
      })
    } finally {
      sqlite.close()
    }
  })

  it('rejects SQLite integrity-check failures', () => {
    const sqlite = {
      pragma: () => [{ integrity_check: 'page 1 is corrupt' }]
    } as Pick<InstanceType<typeof Database>, 'pragma'>
    expect(() => verifySqliteIntegrityAndForeignKeys(sqlite, 'Test database', failVerification)).toThrow(
      'Test database integrity check failed: page 1 is corrupt'
    )
  })

  it('rejects SQLite foreign-key violations', () => {
    const sqlite = new Database(':memory:')
    try {
      sqlite.pragma('foreign_keys = OFF')
      sqlite.exec(
        'create table parent (id integer primary key); create table child (parent_id integer references parent(id)); insert into child (parent_id) values (99)'
      )
      expect(() => verifySqliteIntegrityAndForeignKeys(sqlite, 'Test database', failVerification)).toThrow(
        'Test database foreign-key check failed with 1 violation(s).'
      )
    } finally {
      sqlite.close()
    }
  })
})

function failVerification(message: string): never {
  throw new Error(message)
}
