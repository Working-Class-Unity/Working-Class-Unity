import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createFileUploadRequestSchema } from '../server/db/schema'
import { resolveSqlitePath, verifySqliteIntegrityAndForeignKeys } from '../server/db/connect'
import { resolveLocalObjectStoragePath } from '../server/services/storage/object-storage'

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))

describe('data layer foundation', () => {
  it('keeps SQLite URLs resolvable for local and deployed paths', () => {
    expect(resolveSqlitePath(':memory:')).toBe(':memory:')
    expect(resolveSqlitePath('file:./data/app.db')).toContain('data')
  })

  it('keeps explicit local object bytes beside the persistent SQLite database', () => {
    expect(resolveLocalObjectStoragePath('file:/app/data/app.db')).toBe('/app/data/objects')
    expect(resolveLocalObjectStoragePath('file:./data/app.db')).toBe(resolveSqlitePath('file:./data/objects'))
    expect(resolveLocalObjectStoragePath(':memory:')).toBe(resolveSqlitePath('file:./data/objects'))
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

  it('cascades Better Auth identity state in migrated SQLite', () => {
    const sqlite = createMigratedDatabase()
    try {
      insertUser(sqlite, 'identity-delete-user', 'identity-delete@example.test')
      sqlite.exec(`
        insert into account (
          id, account_id, provider_id, user_id, created_at, updated_at
        ) values (
          'identity-delete-account', 'identity-delete-subject', 'credential', 'identity-delete-user', 1, 1
        );
        insert into session (
          id, expires_at, token, created_at, updated_at, user_id
        ) values (
          'identity-delete-session', 2, 'identity-delete-token', 1, 1, 'identity-delete-user'
        );
      `)

      expect(
        sqlite.prepare("select count(*) as count from account where user_id = 'identity-delete-user'").get()
      ).toEqual({ count: 1 })
      expect(
        sqlite.prepare("select count(*) as count from session where user_id = 'identity-delete-user'").get()
      ).toEqual({ count: 1 })

      sqlite.prepare("delete from user where id = 'identity-delete-user'").run()

      expect(
        sqlite.prepare("select count(*) as count from account where user_id = 'identity-delete-user'").get()
      ).toEqual({ count: 0 })
      expect(
        sqlite.prepare("select count(*) as count from session where user_id = 'identity-delete-user'").get()
      ).toEqual({ count: 0 })
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
    } finally {
      sqlite.close()
    }
  })

  it('defaults users to the non-admin role and enforces the closed role set', () => {
    const sqlite = createMigratedDatabase()
    try {
      insertUser(sqlite, 'ordinary-user', 'ordinary@example.com', 'Ordinary User')
      expect(sqlite.prepare("select name, image, role from user where id = 'ordinary-user'").get()).toEqual({
        name: 'Ordinary User',
        image: null,
        role: 'user'
      })

      sqlite
        .prepare("update user set role = 'admin', image = 'https://cdn.example.test/avatar.png' where id = ?")
        .run('ordinary-user')
      expect(sqlite.prepare("select image, role from user where id = 'ordinary-user'").get()).toEqual({
        image: 'https://cdn.example.test/avatar.png',
        role: 'admin'
      })
      expect(() => sqlite.prepare("update user set role = 'owner' where id = 'ordinary-user'").run()).toThrow(
        /CHECK constraint failed/
      )
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
    } finally {
      sqlite.close()
    }
  })

  it('defines file metadata separately from object bytes', () => {
    expect(
      createFileUploadRequestSchema.parse({
        filename: 'avatar.png',
        contentType: ' IMAGE/PNG ',
        byteSize: 2048,
        contentMd5: '1B2M2Y8AsgTpgAmY7PhCfg=='
      })
    ).toEqual({
      filename: 'avatar.png',
      contentType: 'image/png',
      byteSize: 2048,
      contentMd5: '1B2M2Y8AsgTpgAmY7PhCfg=='
    })

    expect(() =>
      createFileUploadRequestSchema.parse({
        filename: 'oversized.bin',
        contentType: 'application/octet-stream',
        byteSize: 26 * 1024 * 1024,
        contentMd5: '1B2M2Y8AsgTpgAmY7PhCfg=='
      })
    ).toThrow()
    expect(() =>
      createFileUploadRequestSchema.parse({
        filename: 'parameterized.txt',
        contentType: 'text/plain; charset=utf-8',
        byteSize: 1,
        contentMd5: '1B2M2Y8AsgTpgAmY7PhCfg=='
      })
    ).toThrow()
    expect(() =>
      createFileUploadRequestSchema.parse({
        filename: 'header-injection.txt',
        contentType: 'text/plain\r\nx-file: unsafe',
        byteSize: 1,
        contentMd5: '1B2M2Y8AsgTpgAmY7PhCfg=='
      })
    ).toThrow()
    expect(() =>
      createFileUploadRequestSchema.parse({
        filename: 'noncanonical.bin',
        contentType: 'application/octet-stream',
        byteSize: 1,
        contentMd5: 'AAAAAAAAAAAAAAAAAAAAAB=='
      })
    ).toThrow()
  })
})

function failVerification(message: string): never {
  throw new Error(message)
}

function createMigratedDatabase() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  migrateDatabase(sqlite)
  return sqlite
}

function migrateDatabase(sqlite: InstanceType<typeof Database>) {
  migrate(drizzle({ client: sqlite }), { migrationsFolder })
}

function insertUser(sqlite: InstanceType<typeof Database>, id: string, email: string, name = id) {
  sqlite
    .prepare('insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)')
    .run(id, name, email, 1, 1)
}
