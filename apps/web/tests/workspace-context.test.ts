import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { DatabaseConnection } from '../server/db/connect'
import {
  getPersonalWorkspaceForUser,
  resolveWorkspaceMembershipByOrganizationIdForUser
} from '../server/db/repositories/workspaces'
import * as schema from '../server/db/schema'

const cleanupTasks: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanupTasks.splice(0).reverse()) {
    cleanup()
  }
})

describe('Better Auth family-plan repository', () => {
  it('returns the joined personal organization only when the caller still has persisted membership', () => {
    const connection = createFixture()
    insertUser(connection, 'personal-user', 'Personal User')
    insertOrganization(connection, 'personal-org', 'Personal', 'personal-opaque', 'personal-user')

    expect(getPersonalWorkspaceForUser(connection, 'personal-user')).toBeNull()

    insertMember(connection, 'personal-member', 'personal-org', 'personal-user', 'owner')
    expect(getPersonalWorkspaceForUser(connection, 'personal-user')).toEqual({
      id: 'personal-org',
      name: 'Personal',
      slug: 'personal-opaque',
      role: 'owner',
      isPersonal: true
    })
    expect(() => connection.sqlite.prepare('delete from member where id = ?').run('personal-member')).toThrow(
      /family-plan owner membership cannot be deleted directly/
    )
    expect(getPersonalWorkspaceForUser(connection, 'personal-user')).toMatchObject({ role: 'owner' })
    expect(getPersonalWorkspaceForUser(connection, 'unrelated-user')).toBeNull()
  })

  it('reauthorizes membership by immutable organization ID without mutating Better Auth state', () => {
    const connection = createFixture()
    insertUser(connection, 'resolve-user', 'Resolve User')
    insertUser(connection, 'shared-owner', 'Shared Owner')
    insertUser(connection, 'foreign-user', 'Foreign User')
    insertOrganization(connection, 'personal-org', 'Personal', 'personal-opaque', 'resolve-user')
    insertOrganization(connection, 'shared-org', 'Shared', 'shared-opaque', 'shared-owner')
    insertOrganization(connection, 'foreign-org', 'Foreign', 'foreign-opaque', 'foreign-user')
    insertMember(connection, 'personal-member', 'personal-org', 'resolve-user', 'owner')
    insertMember(connection, 'shared-owner-member', 'shared-org', 'shared-owner', 'owner')
    insertMember(connection, 'shared-member', 'shared-org', 'resolve-user', 'member')
    insertMember(connection, 'foreign-member', 'foreign-org', 'foreign-user', 'owner')
    const stateBefore = connection.sqlite
      .prepare('select id, organization_id, user_id, role, created_at from member order by id')
      .all()

    expect(resolveWorkspaceMembershipByOrganizationIdForUser(connection, 'resolve-user', 'personal-org')).toEqual({
      id: 'personal-org',
      name: 'Personal',
      slug: 'personal-opaque',
      role: 'owner',
      isPersonal: true
    })
    expect(resolveWorkspaceMembershipByOrganizationIdForUser(connection, 'resolve-user', 'shared-org')).toEqual({
      id: 'shared-org',
      name: 'Shared',
      slug: 'shared-opaque',
      role: 'member',
      isPersonal: false
    })
    expect(resolveWorkspaceMembershipByOrganizationIdForUser(connection, 'resolve-user', 'foreign-org')).toBeNull()
    expect(resolveWorkspaceMembershipByOrganizationIdForUser(connection, 'resolve-user', 'missing-org')).toBeNull()
    expect(
      connection.sqlite.prepare('select id, organization_id, user_id, role, created_at from member order by id').all()
    ).toEqual(stateBefore)
  })
})

function createFixture(): DatabaseConnection {
  const directory = mkdtempSync(join(tmpdir(), 'swl-workspace-context-'))
  const databasePath = join(directory, 'app.db')
  const sqlite = new Database(databasePath)
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 1000')
  migrate(drizzle({ client: sqlite }), {
    migrationsFolder: fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
  })
  sqlite.exec('drop trigger user_personal_organization_after_insert')
  const connection = {
    sqlite,
    db: drizzle({ client: sqlite, schema }),
    databasePath
  }
  cleanupTasks.push(() => {
    sqlite.close()
    rmSync(directory, { force: true, recursive: true })
  })
  return connection
}

function insertUser(connection: DatabaseConnection, id: string, name: string) {
  connection.sqlite
    .prepare('insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)')
    .run(id, name, `${id}@example.test`, 1, 1)
}

function insertOrganization(
  connection: DatabaseConnection,
  id: string,
  name: string,
  slug: string,
  personalOwnerUserId: string | null = null
) {
  connection.sqlite
    .prepare('insert into organization (id, name, slug, created_at, personal_owner_user_id) values (?, ?, ?, ?, ?)')
    .run(id, name, slug, 1, personalOwnerUserId)
}

function insertMember(
  connection: DatabaseConnection,
  id: string,
  organizationId: string,
  userId: string,
  role: 'owner' | 'member'
) {
  connection.sqlite
    .prepare('insert into member (id, organization_id, user_id, role, created_at) values (?, ?, ?, ?, ?)')
    .run(id, organizationId, userId, role, 1)
}
