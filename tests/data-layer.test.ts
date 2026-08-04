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
      insertUser(sqlite, 'social-delete-user', 'social-delete@example.test')
      sqlite.exec(`
        insert into account (
          id, account_id, provider_id, user_id, created_at, updated_at
        ) values (
          'social-delete-account', 'google-delete-subject', 'google', 'social-delete-user', 1, 1
        );
        insert into session (
          id, expires_at, token, created_at, updated_at, user_id
        ) values (
          'social-delete-session', 2, 'social-delete-token', 1, 1, 'social-delete-user'
        );
      `)

      expect(
        sqlite.prepare("select count(*) as count from account where user_id = 'social-delete-user'").get()
      ).toEqual({ count: 1 })
      expect(
        sqlite.prepare("select count(*) as count from session where user_id = 'social-delete-user'").get()
      ).toEqual({ count: 1 })

      sqlite.prepare("delete from organization where personal_owner_user_id = 'social-delete-user'").run()
      sqlite.prepare("delete from user where id = 'social-delete-user'").run()

      expect(
        sqlite.prepare("select count(*) as count from account where user_id = 'social-delete-user'").get()
      ).toEqual({ count: 0 })
      expect(
        sqlite.prepare("select count(*) as count from session where user_id = 'social-delete-user'").get()
      ).toEqual({ count: 0 })
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
    } finally {
      sqlite.close()
    }
  })

  it('provisions one personal organization atomically for each inserted user and retries cleanly', () => {
    const sqlite = createMigratedDatabase()
    try {
      insertUser(sqlite, 'committed-user', 'committed@example.com', 'Committed User')
      expect(readPersonalOrganizationState(sqlite, 'committed-user')).toEqual({
        members: [{ role: 'owner', userId: 'committed-user' }],
        organizations: [
          {
            name: "Committed User's workspace",
            personalOwnerUserId: 'committed-user'
          }
        ]
      })

      sqlite.prepare("update user set name = 'Renamed User', updated_at = 2 where id = 'committed-user'").run()
      expect(readPersonalOrganizationState(sqlite, 'committed-user').organizations).toHaveLength(1)
      expect(readPersonalOrganizationState(sqlite, 'committed-user').members).toHaveLength(1)

      sqlite.exec(`
        create trigger injected_personal_member_failure
        before insert on member
        when new.user_id = 'retry-user'
        begin
          select raise(abort, 'injected member provisioning failure');
        end;
      `)

      expect(() => insertUser(sqlite, 'retry-user', 'retry@example.com', 'Retry User')).toThrow(
        /injected member provisioning failure/
      )
      expect(sqlite.prepare("select count(*) as count from user where id = 'retry-user'").get()).toEqual({ count: 0 })
      expect(readPersonalOrganizationState(sqlite, 'retry-user')).toEqual({ members: [], organizations: [] })

      sqlite.exec('drop trigger injected_personal_member_failure')
      insertUser(sqlite, 'retry-user', 'retry@example.com', 'Retry User')
      expect(readPersonalOrganizationState(sqlite, 'retry-user')).toEqual({
        members: [{ role: 'owner', userId: 'retry-user' }],
        organizations: [{ name: "Retry User's workspace", personalOwnerUserId: 'retry-user' }]
      })
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
    } finally {
      sqlite.close()
    }
  })

  it('enforces owner/member, invitation, and immutable personal-owner invariants in fresh state', () => {
    const sqlite = createMigratedDatabase()
    try {
      insertUser(sqlite, 'family-owner', 'family-owner@example.test')
      insertUser(sqlite, 'family-member', 'family-member@example.test')
      const familyOrganizationId = personalOrganizationId(sqlite, 'family-owner')

      expect(() =>
        sqlite
          .prepare(
            `insert into member (id, organization_id, user_id, role, created_at)
             values ('family-wrong-owner-membership', ?, 'family-member', 'owner', 1)`
          )
          .run(familyOrganizationId)
      ).toThrow(/member role must match family-plan owner marker/)
      sqlite
        .prepare(
          `insert into member (id, organization_id, user_id, role, created_at)
           values ('family-member-membership', ?, 'family-member', 'member', 1)`
        )
        .run(familyOrganizationId)
      expect(() =>
        sqlite
          .prepare(
            `insert into member (id, organization_id, user_id, role, created_at)
             values ('family-admin-membership', ?, 'family-member', 'admin', 1)`
          )
          .run(familyOrganizationId)
      ).toThrow()
      expect(() =>
        sqlite.prepare("update member set role = 'owner' where id = 'family-member-membership'").run()
      ).toThrow(/member role must match family-plan owner marker/)
      expect(() =>
        sqlite
          .prepare("delete from member where organization_id = ? and user_id = 'family-owner'")
          .run(familyOrganizationId)
      ).toThrow(/family-plan owner membership cannot be deleted directly/)
      expect(() =>
        sqlite
          .prepare(
            `insert into invitation (
              id, organization_id, email, role, status, expires_at, created_at, inviter_id
            ) values ('owner-invitation', ?, 'owner@example.test', 'owner', 'pending', 9999999999999, 1, 'family-owner')`
          )
          .run(familyOrganizationId)
      ).toThrow(/pending family-plan invitations must use member role/)
      sqlite
        .prepare(
          `insert into invitation (
            id, organization_id, email, role, status, expires_at, created_at, inviter_id
          ) values ('member-invitation', ?, 'member@example.test', 'member', 'pending', 9999999999999, 1, 'family-owner')`
        )
        .run(familyOrganizationId)
      expect(() => sqlite.prepare("update invitation set role = 'owner' where id = 'member-invitation'").run()).toThrow(
        /pending family-plan invitations must use member role/
      )
      expect(() =>
        sqlite
          .prepare('update organization set personal_owner_user_id = ? where id = ?')
          .run('family-member', familyOrganizationId)
      ).toThrow(/family-plan owner marker is immutable/)
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
    } finally {
      sqlite.close()
    }
  })

  it('cascades organization-owned rows and retains the private owner deletion guard', () => {
    const sqlite = createMigratedDatabase()
    try {
      insertUser(sqlite, 'protected-user', 'protected@example.com')
      insertUser(sqlite, 'inviter-user', 'inviter@example.com')
      const personalOrganization = sqlite
        .prepare('select id from organization where personal_owner_user_id = ?')
        .get('protected-user') as { id: string }
      sqlite
        .prepare(
          `insert into invitation (
            id, organization_id, email, role, status, expires_at, created_at, inviter_id
          ) values (?, ?, ?, 'member', 'pending', 3000, 1000, ?)`
        )
        .run('deletion-invitation', personalOrganization.id, 'future@example.com', 'inviter-user')

      expect(() => sqlite.prepare("delete from user where id = 'protected-user'").run()).toThrow(
        /family-plan owner membership cannot be deleted directly|FOREIGN KEY constraint failed/
      )
      expect(
        sqlite.prepare('select count(*) as count from organization where id = ?').get(personalOrganization.id)
      ).toEqual({ count: 1 })
      expect(
        sqlite.prepare('select count(*) as count from member where organization_id = ?').get(personalOrganization.id)
      ).toEqual({ count: 1 })
      expect(sqlite.prepare('select count(*) as count from invitation').get()).toEqual({ count: 1 })

      sqlite.prepare('delete from organization where id = ?').run(personalOrganization.id)
      expect(
        sqlite.prepare('select count(*) as count from member where organization_id = ?').get(personalOrganization.id)
      ).toEqual({ count: 0 })
      expect(sqlite.prepare('select count(*) as count from invitation').get()).toEqual({ count: 0 })
      expect(sqlite.prepare("select count(*) as count from user where id = 'protected-user'").get()).toEqual({
        count: 1
      })

      sqlite.prepare("delete from user where id = 'protected-user'").run()
      expect(sqlite.prepare("select count(*) as count from user where id = 'protected-user'").get()).toEqual({
        count: 0
      })
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

function readPersonalOrganizationState(sqlite: InstanceType<typeof Database>, userId: string) {
  return {
    members: sqlite
      .prepare(
        `select member.user_id as userId, member.role
        from member
        join organization on organization.id = member.organization_id
        where organization.personal_owner_user_id = ?
        order by member.id`
      )
      .all(userId),
    organizations: sqlite
      .prepare(
        `select name, personal_owner_user_id as personalOwnerUserId
        from organization where personal_owner_user_id = ? order by id`
      )
      .all(userId)
  }
}

function insertUser(sqlite: InstanceType<typeof Database>, id: string, email: string, name = id) {
  sqlite
    .prepare('insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)')
    .run(id, name, email, 1, 1)
}

function personalOrganizationId(sqlite: InstanceType<typeof Database>, userId: string): string {
  const row = sqlite.prepare('select id from organization where personal_owner_user_id = ?').get(userId) as
    { id: string } | undefined
  if (!row) throw new Error(`Personal organization missing for ${userId}`)
  return row.id
}
