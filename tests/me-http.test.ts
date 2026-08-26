import { createServer, type Server } from 'node:http'
import { createApp, createError, createRouter, defineEventHandler, toNodeListener, type EventHandler } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const sessionMocks = vi.hoisted(() => ({ requireSession: vi.fn() }))
const databaseMocks = vi.hoisted(() => ({ get: vi.fn(), prepare: vi.fn() }))

vi.mock('../server/utils/auth/require-session', () => sessionMocks)
vi.mock('../server/db/client', () => ({
  useDatabase: () => ({ sqlite: { prepare: databaseMocks.prepare } })
}))

const session = Object.freeze({
  user: {
    id: 'user-one',
    name: 'One Person',
    email: 'one@example.test',
    emailVerified: true,
    phoneNumber: '+12095550100',
    phoneNumberVerified: true,
    image: null,
    firstName: 'One',
    lastName: 'Person',
    displayName: 'Organizer One',
    role: 'admin',
    createdAt: new Date('2026-07-12T00:00:00.000Z'),
    updatedAt: new Date('2026-07-12T00:00:00.000Z')
  },
  session: {
    id: 'session-one',
    userId: 'user-one',
    token: 'private-session-token'
  }
})
const accountIdentity = Object.freeze({
  email: 'one@example.test',
  emailVerified: 1,
  phoneNumber: '+12095550100',
  phoneNumberVerified: 1,
  firstName: 'One',
  lastName: 'Person',
  displayName: 'Organizer One'
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
  databaseMocks.prepare.mockReturnValue({ get: databaseMocks.get })
  databaseMocks.get.mockReturnValue(accountIdentity)
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

describe('personal identity HTTP boundary', () => {
  it('returns only allowlisted identity fields', async () => {
    const response = await fetch(`${baseUrl}/api/me`)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      user: {
        id: session.user.id,
        email: accountIdentity.email,
        emailVerified: true,
        phoneNumber: accountIdentity.phoneNumber,
        phoneNumberVerified: true,
        image: session.user.image,
        firstName: accountIdentity.firstName,
        lastName: accountIdentity.lastName,
        displayName: accountIdentity.displayName
      }
    })
    expect(sessionMocks.requireSession).toHaveBeenCalledOnce()
    expect(databaseMocks.get).toHaveBeenCalledExactlyOnceWith(session.user.id)
  })

  it('never returns a phone-only placeholder email', async () => {
    databaseMocks.get.mockReturnValueOnce({
      ...accountIdentity,
      email: `phone-${'a'.repeat(64)}@accounts.invalid`,
      emailVerified: 0
    })

    const response = await fetch(`${baseUrl}/api/me`)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.user).toMatchObject({ email: null, emailVerified: false, phoneNumber: '+12095550100' })
    expect(JSON.stringify(body)).not.toContain('accounts.invalid')
  })

  it('requires authentication', async () => {
    sessionMocks.requireSession.mockRejectedValueOnce(
      createError({ statusCode: 401, statusMessage: 'Authentication required' })
    )

    const response = await fetch(`${baseUrl}/api/me`)

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(databaseMocks.prepare).not.toHaveBeenCalled()
  })
})
