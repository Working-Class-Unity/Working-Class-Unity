import { createServer, type Server } from 'node:http'
import { createApp, createError, createRouter, defineEventHandler, toNodeListener, type EventHandler } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const databaseMocks = vi.hoisted(() => ({ useDatabase: vi.fn() }))
const removalMocks = vi.hoisted(() => ({ removeFamilyMember: vi.fn() }))
const moduleMocks = vi.hoisted(() => ({ requireModuleReady: vi.fn() }))
const sessionMocks = vi.hoisted(() => ({ requireSession: vi.fn() }))

vi.mock('../server/db/client', () => databaseMocks)
vi.mock('../server/services/family-member-removal', () => removalMocks)
vi.mock('../server/utils/auth/require-session', () => sessionMocks)
vi.mock('../server/utils/module-state', () => moduleMocks)

const connection = Object.freeze({ test: 'family-removal-database' })
const session = Object.freeze({
  user: { id: 'family-manager-user' },
  session: { id: 'family-manager-session' }
})

let server: Server
let baseUrl: string

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', defineEventHandler)
  const remove = await import('../server/api/account/family/members/remove.post').then((module) => module.default)
  const router = createRouter().post('/api/account/family/members/remove', remove as EventHandler)
  server = createServer(toNodeListener(createApp().use(router)))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new TypeError('Expected a TCP test address')
  baseUrl = `http://127.0.0.1:${address.port}`
})

beforeEach(() => {
  vi.clearAllMocks()
  databaseMocks.useDatabase.mockReturnValue(connection)
  sessionMocks.requireSession.mockResolvedValue(session)
  removalMocks.removeFamilyMember.mockResolvedValue({ status: 'removed' })
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

describe('manager Family member-removal HTTP boundary', () => {
  it('authenticates before the Billing gate and validates a strict opaque-reference command afterward', async () => {
    sessionMocks.requireSession.mockRejectedValueOnce(
      createError({ statusCode: 401, statusMessage: 'Authentication required' })
    )
    const anonymous = await request('{')
    expect(anonymous.status).toBe(401)
    expect(moduleMocks.requireModuleReady).not.toHaveBeenCalled()
    expect(removalMocks.removeFamilyMember).not.toHaveBeenCalled()

    const invalidInputs = [
      {},
      { memberReference: '' },
      { memberReference: 'relative@example.test' },
      { memberReference: 'member_reference', email: 'relative@example.test' },
      { memberReference: 'member_reference', role: 'member' },
      { memberReference: 'member_reference', organizationId: 'client_scope' }
    ]
    for (const body of invalidInputs) {
      expect((await jsonRequest(body)).status).toBe(400)
    }
    expect(moduleMocks.requireModuleReady).toHaveBeenCalledTimes(invalidInputs.length)
    expect(moduleMocks.requireModuleReady).toHaveBeenCalledWith('billing')
    expect(removalMocks.removeFamilyMember).not.toHaveBeenCalled()
  })

  it('checks a disabled Billing module before parsing private input', async () => {
    moduleMocks.requireModuleReady.mockImplementationOnce(() => {
      throw createError({ statusCode: 404, statusMessage: 'Module disabled' })
    })

    const response = await request('{')
    expect(response.status).toBe(404)
    expect(sessionMocks.requireSession).toHaveBeenCalledTimes(1)
    expect(removalMocks.removeFamilyMember).not.toHaveBeenCalled()
  })

  it('passes only the authenticated manager and opaque reference and returns no identifiers', async () => {
    const response = await jsonRequest({ memberReference: 'member_Opaque_123' })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ status: 'removed' })
    expect(removalMocks.removeFamilyMember).toHaveBeenCalledWith({ connection }, session.user.id, 'member_Opaque_123')
  })
})

function jsonRequest(body: unknown) {
  return request(JSON.stringify(body))
}

function request(body: string) {
  return fetch(`${baseUrl}/api/account/family/members/remove`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body
  })
}
