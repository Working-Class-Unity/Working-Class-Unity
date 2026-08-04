import { createServer, type Server } from 'node:http'
import { createApp, createError, createRouter, defineEventHandler, toNodeListener, type EventHandler } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const sessionMocks = vi.hoisted(() => ({ requireSession: vi.fn() }))
const moduleStateMocks = vi.hoisted(() => ({ getPublicModuleStates: vi.fn() }))

vi.mock('../server/utils/auth/require-session', () => sessionMocks)
vi.mock('../server/utils/module-state', () => moduleStateMocks)

const session = Object.freeze({
  user: {
    id: 'user-one',
    name: 'One Person',
    email: 'one@example.test',
    emailVerified: true,
    image: null,
    createdAt: new Date('2026-07-12T00:00:00.000Z'),
    updatedAt: new Date('2026-07-12T00:00:00.000Z')
  },
  session: {
    id: 'session-one',
    userId: 'user-one',
    token: 'private-session-token',
    activeOrganizationId: 'joined-family-plan'
  }
})
const modules = Object.freeze({
  billing: 'disabled',
  files: 'disabled',
  ai: 'disabled',
  turnstile: 'disabled',
  observability: 'disabled',
  jobs: 'disabled'
})

let server: Server
let baseUrl: string

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', defineEventHandler)
  const meHandler = await import('../server/api/me.get').then((module) => module.default)
  const router = createRouter().get('/api/me', meHandler as EventHandler)
  server = createServer(toNodeListener(createApp().use(router)))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  const address = server.address()
  if (!address || typeof address === 'string') throw new TypeError('Expected a TCP test address')
  baseUrl = `http://127.0.0.1:${address.port}`
})

beforeEach(() => {
  vi.clearAllMocks()
  sessionMocks.requireSession.mockResolvedValue(session)
  moduleStateMocks.getPublicModuleStates.mockReturnValue(modules)
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

describe('personal identity HTTP boundary', () => {
  it('returns only allowlisted identity and public module fields', async () => {
    const response = await fetch(`${baseUrl}/api/me`)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image
      },
      modules
    })
    expect(sessionMocks.requireSession).toHaveBeenCalledOnce()
    expect(moduleStateMocks.getPublicModuleStates).toHaveBeenCalledOnce()
  })

  it('authenticates before resolving module state', async () => {
    sessionMocks.requireSession.mockRejectedValueOnce(
      createError({ statusCode: 401, statusMessage: 'Authentication required' })
    )

    const response = await fetch(`${baseUrl}/api/me`)

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(moduleStateMocks.getPublicModuleStates).not.toHaveBeenCalled()
  })
})
