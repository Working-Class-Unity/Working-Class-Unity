import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import Database from 'better-sqlite3'
import { createApp, createError, createRouter, defineEventHandler, toNodeListener, type EventHandler } from 'h3'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseConnection } from '../server/db/connect'
import * as schema from '../server/db/schema'

const databaseMocks = vi.hoisted(() => ({ useDatabase: vi.fn() }))
const sessionMocks = vi.hoisted(() => ({ requireSession: vi.fn() }))

vi.mock('../server/db/client', () => databaseMocks)
vi.mock('../server/utils/auth/require-session', () => sessionMocks)

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
const userId = 'user-current'
const otherUserId = 'user-other'
const unrelatedUserId = 'user-unrelated'
const familyA = { id: 'organization-a', slug: 'family-a' }
const familyB = { id: 'organization-b', slug: 'family-b' }
const familyC = { id: 'organization-c', slug: 'family-c' }

let connection: DatabaseConnection
let cleanupFixture: (() => void) | undefined
let currentSession = sessionFor(userId, familyB.id)
let server: Server
let baseUrl: string

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', defineEventHandler)
  const [list, create, read, update, remove] = await Promise.all([
    import('../server/api/projects/index.get').then((module) => module.default),
    import('../server/api/projects/index.post').then((module) => module.default),
    import('../server/api/projects/[projectId].get').then((module) => module.default),
    import('../server/api/projects/[projectId].patch').then((module) => module.default),
    import('../server/api/projects/[projectId].delete').then((module) => module.default)
  ])
  const router = createRouter()
    .get('/api/projects', list as EventHandler)
    .post('/api/projects', create as EventHandler)
    .get('/api/projects/:projectId', read as EventHandler)
    .patch('/api/projects/:projectId', update as EventHandler)
    .delete('/api/projects/:projectId', remove as EventHandler)
  server = createServer(toNodeListener(createApp().use(router)))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new TypeError('Expected a TCP test address')
  baseUrl = `http://127.0.0.1:${address.port}`
})

beforeEach(() => {
  const fixture = createFixture()
  connection = fixture.connection
  cleanupFixture = fixture.cleanup
  currentSession = sessionFor(userId, familyB.id)
  databaseMocks.useDatabase.mockReturnValue(connection)
  sessionMocks.requireSession.mockImplementation(async () => currentSession)
})

afterEach(() => {
  cleanupFixture?.()
  cleanupFixture = undefined
  vi.clearAllMocks()
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

describe('user-owned project HTTP boundaries', () => {
  it('runs complete user-owned CRUD through /api/projects', async () => {
    const created = await createProject({ name: 'First project' })
    expect(created.response.status).toBe(201)
    expect(created.response.headers.get('cache-control')).toBe('private, no-store')
    expect(Object.keys(created.project).sort()).toEqual(['createdAt', 'id', 'name', 'updatedAt'])
    expect(
      connection.sqlite
        .prepare('select owner_user_id as ownerUserId from projects where id = ?')
        .get(created.project.id)
    ).toEqual({
      ownerUserId: userId
    })

    const listed = await fetch(`${baseUrl}/api/projects`)
    expect(listed.status).toBe(200)
    expect(listed.headers.get('cache-control')).toBe('private, no-store')
    expect(await listed.json()).toEqual({ projects: [created.project] })

    const read = await fetch(`${baseUrl}/api/projects/${created.project.id}`)
    expect(read.status).toBe(200)
    expect(await read.json()).toEqual({ project: created.project })

    const updated = await jsonRequest(`/api/projects/${created.project.id}`, 'PATCH', { name: 'Renamed project' })
    expect(updated.status).toBe(200)
    const updatedProject = (await updated.json()).project as ProjectJson
    expect(updatedProject).toMatchObject({ id: created.project.id, name: 'Renamed project' })

    const removed = await fetch(`${baseUrl}/api/projects/${created.project.id}`, { method: 'DELETE' })
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ status: 'deleted' })
    expect((await fetch(`${baseUrl}/api/projects/${created.project.id}`)).status).toBe(404)
  })

  it('authenticates before parsing and rejects every caller-supplied ownership field', async () => {
    sessionMocks.requireSession.mockRejectedValueOnce(
      createError({ statusCode: 401, statusMessage: 'Authentication required' })
    )
    const anonymous = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{'
    })
    expect(anonymous.status).toBe(401)
    expect((await fetch(`${baseUrl}/api/projects/%20`)).status).toBe(400)

    for (const body of [
      { name: 'Obsolete slug', slug: 'obsolete-slug' },
      { name: 'Legacy owner', ownerId: userId },
      { name: 'Direct owner', ownerUserId: userId },
      { name: 'Organization owner', organizationId: familyB.id }
    ]) {
      expect((await jsonRequest('/api/projects', 'POST', body)).status).toBe(400)
    }
    expect(connection.sqlite.prepare('select count(*) as count from projects').get()).toEqual({ count: 0 })

    const created = await createProject({ name: 'Existing' })
    for (const body of [
      { slug: 'obsolete-slug' },
      { ownerId: otherUserId },
      { ownerUserId: otherUserId },
      { organizationId: familyA.id }
    ]) {
      expect((await jsonRequest(`/api/projects/${created.project.id}`, 'PATCH', body)).status).toBe(400)
    }
    expect(connection.sqlite.prepare('select name from projects where id = ?').get(created.project.id)).toEqual({
      name: 'Existing'
    })

    expect((await fetch(`${baseUrl}/api/workspaces/${familyA.slug}/projects`)).status).toBe(404)
  })

  it('allows duplicate names for the same owner and across owners', async () => {
    const first = await createProject({ name: 'Same name' })
    setSession(otherUserId, familyA.id)
    const second = await createProject({ name: 'Same name' })
    expect([first.response.status, second.response.status]).toEqual([201, 201])

    setSession(userId, familyB.id)
    const concurrent = await Promise.all([
      jsonRequest('/api/projects', 'POST', { name: 'Same name' }),
      jsonRequest('/api/projects', 'POST', { name: 'Same name' })
    ])
    expect(concurrent.map((response) => response.status).sort()).toEqual([201, 201])
    expect(
      connection.sqlite
        .prepare('select count(*) as count from projects where owner_user_id = ? and name = ?')
        .get(userId, 'Same name')
    ).toEqual({ count: 3 })
  })

  it('conceals same-plan users projects for reads and mutations', async () => {
    const currentProject = await createProject({ name: 'Current private' })
    setSession(otherUserId, familyA.id)
    const otherProject = await createProject({ name: 'Other private' })

    expect((await (await fetch(`${baseUrl}/api/projects`)).json()).projects).toEqual([otherProject.project])

    const unknown = await fetch(`${baseUrl}/api/projects/project_unknown`)
    const foreign = await fetch(`${baseUrl}/api/projects/${currentProject.project.id}`)
    expect([unknown.status, foreign.status]).toEqual([404, 404])
    expect(await foreign.text()).toBe(await unknown.text())

    const foreignPatch = await jsonRequest(`/api/projects/${currentProject.project.id}`, 'PATCH', {
      name: 'Foreign mutation'
    })
    const foreignDelete = await fetch(`${baseUrl}/api/projects/${currentProject.project.id}`, { method: 'DELETE' })
    expect([foreignPatch.status, foreignDelete.status]).toEqual([404, 404])
    expect(connection.sqlite.prepare('select name from projects where id = ?').get(currentProject.project.id)).toEqual({
      name: 'Current private'
    })

    setSession(userId, familyB.id)
    expect((await (await fetch(`${baseUrl}/api/projects`)).json()).projects).toEqual([currentProject.project])
  })

  it('ignores unrelated memberships and activeOrganizationId for private project authority', async () => {
    const project = await createProject({ name: 'Stable private' })

    setSession(userId, 'organization-not-joined')
    expect((await fetch(`${baseUrl}/api/projects/${project.project.id}`)).status).toBe(200)

    connection.sqlite.prepare('delete from member where id = ?').run('member-other-a')
    connection.sqlite
      .prepare('insert into member (id, organization_id, user_id, role, created_at) values (?, ?, ?, ?, 1)')
      .run('member-current-unrelated', familyC.id, userId, 'member')
    expect((await fetch(`${baseUrl}/api/projects/${project.project.id}`)).status).toBe(200)

    setSession(otherUserId, familyA.id)
    expect((await fetch(`${baseUrl}/api/projects/${project.project.id}`)).status).toBe(404)
  })

  it('gives concurrent deletes one success and one concealed miss without touching another owner', async () => {
    const currentProject = await createProject({ name: 'Delete once' })
    setSession(otherUserId, familyA.id)
    const otherProject = await createProject({ name: 'Keep other' })
    setSession(userId, familyB.id)

    const responses = await Promise.all([
      fetch(`${baseUrl}/api/projects/${currentProject.project.id}`, { method: 'DELETE' }),
      fetch(`${baseUrl}/api/projects/${currentProject.project.id}`, { method: 'DELETE' })
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 404])
    expect(connection.sqlite.prepare('select id from projects where id = ?').get(otherProject.project.id)).toEqual({
      id: otherProject.project.id
    })
  })
})

type ProjectJson = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

async function createProject(body: { name: string }) {
  const response = await jsonRequest('/api/projects', 'POST', body)
  return { response, project: (await response.json()).project as ProjectJson }
}

async function jsonRequest(path: string, method: 'POST' | 'PATCH', body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

function setSession(sessionUserId: string, activeOrganizationId: string | null) {
  currentSession = sessionFor(sessionUserId, activeOrganizationId)
}

function sessionFor(sessionUserId: string, activeOrganizationId: string | null) {
  return {
    user: {
      id: sessionUserId,
      name: sessionUserId === userId ? 'Current User' : 'Other User',
      email: `${sessionUserId}@example.test`,
      image: null
    },
    session: {
      id: `session-${sessionUserId}`,
      userId: sessionUserId,
      activeOrganizationId
    }
  }
}

function createFixture(): { connection: DatabaseConnection; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'swl-user-project-http-'))
  const databasePath = join(directory, 'app.db')
  const sqlite = new Database(databasePath)
  sqlite.pragma('foreign_keys = ON')
  migrate(drizzle({ client: sqlite }), { migrationsFolder })
  sqlite.exec('drop trigger if exists user_personal_organization_after_insert')
  const fixtureConnection = { sqlite, db: drizzle({ client: sqlite, schema }), databasePath }

  insertUser(fixtureConnection, userId, 'Current User')
  insertUser(fixtureConnection, otherUserId, 'Other User')
  insertUser(fixtureConnection, unrelatedUserId, 'Unrelated User')
  insertOrganization(fixtureConnection, familyA.id, 'Family A', familyA.slug, userId)
  insertOrganization(fixtureConnection, familyB.id, 'Family B', familyB.slug, otherUserId)
  insertOrganization(fixtureConnection, familyC.id, 'Family C', familyC.slug, unrelatedUserId)
  insertMember(fixtureConnection, 'member-current-a', familyA.id, userId, 'owner')
  insertMember(fixtureConnection, 'member-other-a', familyA.id, otherUserId, 'member')
  insertMember(fixtureConnection, 'member-other-b', familyB.id, otherUserId, 'owner')
  insertMember(fixtureConnection, 'member-unrelated-c', familyC.id, unrelatedUserId, 'owner')

  return {
    connection: fixtureConnection,
    cleanup: () => {
      sqlite.close()
      rmSync(directory, { force: true, recursive: true })
    }
  }
}

function insertUser(database: DatabaseConnection, id: string, name: string) {
  database.sqlite
    .prepare('insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, 1, 1)')
    .run(id, name, `${id}@example.test`)
}

function insertOrganization(
  database: DatabaseConnection,
  id: string,
  name: string,
  slug: string,
  personalOwnerUserId: string
) {
  database.sqlite
    .prepare('insert into organization (id, name, slug, created_at, personal_owner_user_id) values (?, ?, ?, 1, ?)')
    .run(id, name, slug, personalOwnerUserId)
}

function insertMember(
  database: DatabaseConnection,
  id: string,
  organizationId: string,
  memberUserId: string,
  role: 'owner' | 'member'
) {
  database.sqlite
    .prepare('insert into member (id, organization_id, user_id, role, created_at) values (?, ?, ?, ?, 1)')
    .run(id, organizationId, memberUserId, role)
}
