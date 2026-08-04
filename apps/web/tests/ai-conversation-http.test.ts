import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import Database from 'better-sqlite3'
import { createApp, createError, createRouter, defineEventHandler, toNodeListener, type EventHandler } from 'h3'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, request as httpRequest, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseConnection } from '../server/db/connect'
import * as schema from '../server/db/schema'
import { OpenAIProviderError } from '../server/services/ai/openai'
import type { AppRuntimeConfig } from '../server/utils/runtime'

const databaseMocks = vi.hoisted(() => ({ useDatabase: vi.fn() }))
const sessionMocks = vi.hoisted(() => ({ requireSession: vi.fn() }))
const runtimeMocks = vi.hoisted(() => ({ getAppRuntimeConfig: vi.fn() }))
const providerMocks = vi.hoisted(() => ({
  getOpenAIResponsesAdapter: vi.fn(),
  createResponse: vi.fn()
}))

vi.mock('../server/db/client', () => databaseMocks)
vi.mock('../server/utils/auth/require-session', () => sessionMocks)
vi.mock('../server/utils/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/utils/runtime')>()),
  getAppRuntimeConfig: runtimeMocks.getAppRuntimeConfig
}))
vi.mock('../server/services/ai/openai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/services/ai/openai')>()),
  getOpenAIResponsesAdapter: providerMocks.getOpenAIResponsesAdapter
}))

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
const currentUserId = 'user-ai-http-current'
const otherUserId = 'user-ai-http-other'
const sharedFamilyId = 'organization-ai-http-shared'
const missingConversationId = 'ai_conversation_00000000-0000-4000-8000-000000000000'
const firstClientRequestId = '11111111-1111-4111-8111-111111111111'

let server: Server
let baseUrl: string
let connection: DatabaseConnection
let cleanupFixture: (() => void) | undefined
let currentSession = sessionFor(currentUserId)

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', defineEventHandler)
  vi.stubGlobal('useRuntimeConfig', () => runtimeMocks.getAppRuntimeConfig())

  const [
    moduleBoundary,
    conversationList,
    conversationCreate,
    conversationRead,
    conversationDelete,
    messageList,
    messageCreate,
    messageClear
  ] = await Promise.all([
    import('../server/middleware/01-module-boundary').then((module) => module.default),
    import('../server/api/ai/conversations/index.get').then((module) => module.default),
    import('../server/api/ai/conversations/index.post').then((module) => module.default),
    import('../server/api/ai/conversations/[conversationId].get').then((module) => module.default),
    import('../server/api/ai/conversations/[conversationId].delete').then((module) => module.default),
    import('../server/api/ai/conversations/[conversationId]/messages/index.get').then((module) => module.default),
    import('../server/api/ai/conversations/[conversationId]/messages/index.post').then((module) => module.default),
    import('../server/api/ai/conversations/[conversationId]/messages/index.delete').then((module) => module.default)
  ])

  const router = createRouter()
    .get('/api/ai/conversations', conversationList as EventHandler)
    .post('/api/ai/conversations', conversationCreate as EventHandler)
    .get('/api/ai/conversations/:conversationId', conversationRead as EventHandler)
    .delete('/api/ai/conversations/:conversationId', conversationDelete as EventHandler)
    .get('/api/ai/conversations/:conversationId/messages', messageList as EventHandler)
    .post('/api/ai/conversations/:conversationId/messages', messageCreate as EventHandler)
    .delete('/api/ai/conversations/:conversationId/messages', messageClear as EventHandler)

  server = createServer(toNodeListener(createApp().use(moduleBoundary).use(router)))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new TypeError('Expected a TCP test address')
  baseUrl = `http://127.0.0.1:${address.port}`
})

beforeEach(() => {
  vi.clearAllMocks()
  const fixture = createFixture()
  connection = fixture.connection
  cleanupFixture = fixture.cleanup
  currentSession = sessionFor(currentUserId)
  databaseMocks.useDatabase.mockReturnValue(connection)
  runtimeMocks.getAppRuntimeConfig.mockReturnValue(runtimeConfig(true))
  sessionMocks.requireSession.mockImplementation(async () => currentSession)
  providerMocks.getOpenAIResponsesAdapter.mockReturnValue({ createResponse: providerMocks.createResponse })
  providerMocks.createResponse.mockResolvedValue({
    kind: 'text',
    text: 'A deterministic local answer.',
    citations: [
      {
        type: 'web',
        title: 'HTTP reference',
        url: 'https://reference.test/http',
        startIndex: 2,
        endIndex: 15
      }
    ],
    model: 'gpt-5.6-luna',
    requestId: 'provider_request_private',
    usage: {
      inputTokens: 13,
      outputTokens: 7,
      totalTokens: 20,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      reasoningTokens: 2
    }
  })
})

afterEach(() => {
  cleanupFixture?.()
  cleanupFixture = undefined
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

describe('private AI conversation HTTP boundary', () => {
  it('authenticates before parsing and rejects caller-supplied authority or provider fields', async () => {
    sessionMocks.requireSession.mockRejectedValueOnce(
      createError({ statusCode: 401, statusMessage: 'Authentication required' })
    )
    const anonymous = await request('/api/ai/conversations', 'POST', '{')
    expect(anonymous.status).toBe(401)
    expect(databaseMocks.useDatabase).not.toHaveBeenCalled()
    expect(providerMocks.getOpenAIResponsesAdapter).not.toHaveBeenCalled()

    for (const body of [
      { ownerUserId: currentUserId },
      { organizationId: sharedFamilyId },
      { model: 'caller-model' },
      { provider: 'openai' }
    ]) {
      expect((await jsonRequest('/api/ai/conversations', 'POST', body)).status).toBe(400)
    }
    expect(connection.sqlite.prepare('select count(*) as count from ai_conversations').get()).toEqual({ count: 0 })
  })

  it('runs CRUD and deterministic generation without exposing internal provider or ledger state', async () => {
    const created = await createConversation()
    expect(created.response.status).toBe(201)
    expect(created.response.headers.get('cache-control')).toBe('private, no-store')
    expect(Object.keys(created.conversation).sort()).toEqual(['createdAt', 'id', 'updatedAt'])

    const listed = await fetch(`${baseUrl}/api/ai/conversations`)
    expect(listed.status).toBe(200)
    expect(await listed.json()).toEqual({ conversations: [created.conversation], nextCursor: null })

    const read = await fetch(`${baseUrl}/api/ai/conversations/${created.conversation.id}`)
    expect(read.status).toBe(200)
    expect(await read.json()).toEqual({ conversation: created.conversation })

    const generated = await jsonRequest(`/api/ai/conversations/${created.conversation.id}/messages`, 'POST', {
      clientRequestId: firstClientRequestId,
      content: 'What should I consider?'
    })
    expect(generated.status).toBe(201)
    expect(generated.headers.get('cache-control')).toBe('private, no-store')
    const generatedBody = (await generated.json()) as GenerationJson
    expect(Object.keys(generatedBody).sort()).toEqual(['assistantMessage', 'conversation', 'userMessage'])
    expect(Object.keys(generatedBody.conversation).sort()).toEqual(['createdAt', 'id', 'updatedAt'])
    expect(Object.keys(generatedBody.userMessage).sort()).toEqual([
      'citations',
      'content',
      'createdAt',
      'id',
      'role',
      'sequence'
    ])
    expect(Object.keys(generatedBody.assistantMessage).sort()).toEqual([
      'citations',
      'content',
      'createdAt',
      'id',
      'role',
      'sequence'
    ])
    expect(generatedBody).toMatchObject({
      userMessage: { sequence: 1, role: 'user', content: 'What should I consider?', citations: [] },
      assistantMessage: {
        sequence: 2,
        role: 'assistant',
        content: 'A deterministic local answer.',
        citations: [
          {
            type: 'web',
            title: 'HTTP reference',
            url: 'https://reference.test/http',
            startIndex: 2,
            endIndex: 15
          }
        ]
      }
    })
    expect(JSON.stringify(generatedBody)).not.toMatch(
      /provider_request_private|gpt-5\.6-luna|clientRequestId|attempt|usage|token|safetyIdentifier/i
    )
    expect(providerMocks.getOpenAIResponsesAdapter).toHaveBeenCalledOnce()
    expect(providerMocks.createResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.any(String),
        messages: [{ role: 'user', content: 'What should I consider?' }],
        requestId: expect.stringMatching(/^ai_attempt_[0-9a-f-]{36}$/),
        safetyIdentifier: expect.stringMatching(/^[0-9a-f]{64}$/)
      })
    )

    const replay = await jsonRequest(`/api/ai/conversations/${created.conversation.id}/messages`, 'POST', {
      clientRequestId: firstClientRequestId,
      content: 'What should I consider?'
    })
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual(generatedBody)
    expect(providerMocks.createResponse).toHaveBeenCalledOnce()

    const messages = await fetch(`${baseUrl}/api/ai/conversations/${created.conversation.id}/messages`)
    expect(messages.status).toBe(200)
    expect(await messages.json()).toEqual({
      messages: [generatedBody.userMessage, generatedBody.assistantMessage],
      nextCursor: null
    })

    const cleared = await request(`/api/ai/conversations/${created.conversation.id}/messages`, 'DELETE')
    expect(cleared.status).toBe(200)
    expect(await cleared.json()).toEqual({ status: 'cleared' })
    expect(await (await fetch(`${baseUrl}/api/ai/conversations/${created.conversation.id}/messages`)).json()).toEqual({
      messages: [],
      nextCursor: null
    })

    const removed = await request(`/api/ai/conversations/${created.conversation.id}`, 'DELETE')
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ status: 'deleted' })
    expect((await fetch(`${baseUrl}/api/ai/conversations/${created.conversation.id}`)).status).toBe(404)
  })

  it('conceals same-family foreign conversations exactly like missing conversations', async () => {
    const created = await createConversation()
    currentSession = sessionFor(otherUserId)

    const foreign = await fetch(`${baseUrl}/api/ai/conversations/${created.conversation.id}`)
    const missing = await fetch(`${baseUrl}/api/ai/conversations/${missingConversationId}`)
    expect([foreign.status, missing.status]).toEqual([404, 404])
    expect(await foreign.text()).toBe(await missing.text())

    for (const [method, suffix, body] of [
      ['GET', '/messages', undefined],
      ['DELETE', '/messages', undefined],
      ['DELETE', '', undefined],
      ['POST', '/messages', { clientRequestId: '22222222-2222-4222-8222-222222222222', content: 'Foreign question' }]
    ] as const) {
      const response = body
        ? await jsonRequest(`/api/ai/conversations/${created.conversation.id}${suffix}`, method, body)
        : await request(`/api/ai/conversations/${created.conversation.id}${suffix}`, method)
      expect(response.status, `${method} ${suffix}`).toBe(404)
    }
    expect(providerMocks.getOpenAIResponsesAdapter).not.toHaveBeenCalled()

    currentSession = sessionFor(currentUserId)
    expect((await fetch(`${baseUrl}/api/ai/conversations/${created.conversation.id}`)).status).toBe(200)
  })

  it('strictly validates route IDs, query keys, request IDs, UTF-8 bytes, and request fields', async () => {
    const created = await createConversation()

    expect((await fetch(`${baseUrl}/api/ai/conversations/not-an-ai-id`)).status).toBe(400)
    expect((await fetch(`${baseUrl}/api/ai/conversations?ownerUserId=${otherUserId}`)).status).toBe(400)
    expect((await fetch(`${baseUrl}/api/ai/conversations?cursor=not-a-cursor`)).status).toBe(400)

    for (const body of [
      { content: 'Missing request ID' },
      { clientRequestId: 'caller-defined-string', content: 'Invalid request ID' },
      { clientRequestId: firstClientRequestId, content: '   ' },
      { clientRequestId: firstClientRequestId, content: 'Question', ownerUserId: otherUserId },
      { clientRequestId: firstClientRequestId, content: 'Question', model: 'caller-model' },
      { clientRequestId: firstClientRequestId, content: 'Question', tools: [{ type: 'web_search' }] },
      { clientRequestId: firstClientRequestId, content: 'Question', allowedDomains: ['example.com'] },
      { clientRequestId: firstClientRequestId, content: 'Question', searchContextSize: 'high' },
      { clientRequestId: firstClientRequestId, content: 'Question', maxToolCalls: 2 },
      { clientRequestId: firstClientRequestId, content: 'Question', timeoutMs: 120_000 },
      { clientRequestId: firstClientRequestId, content: 'Question', maxOutputTokens: 8_192 },
      { clientRequestId: firstClientRequestId, content: 'Question', quota: 1_000 },
      { clientRequestId: firstClientRequestId, content: '\ud83d\ude00'.repeat(10_000) }
    ]) {
      const response = await jsonRequest(`/api/ai/conversations/${created.conversation.id}/messages`, 'POST', body)
      expect(response.status).toBe(400)
    }
    expect(providerMocks.getOpenAIResponsesAdapter).not.toHaveBeenCalled()
    expect(connection.sqlite.prepare('select count(*) as count from ai_messages').get()).toEqual({ count: 0 })
  })

  it('aborts the in-flight provider boundary when the HTTP client disconnects', async () => {
    const created = await createConversation()
    let providerSignal: AbortSignal | undefined
    providerMocks.createResponse.mockImplementationOnce(
      (input: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          providerSignal = input.signal
          input.signal?.addEventListener('abort', () => reject(new OpenAIProviderError('cancelled')), { once: true })
        })
    )
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const payload = JSON.stringify({
      clientRequestId: '33333333-3333-4333-8333-333333333333',
      content: 'Cancel this request when its client connection closes.'
    })
    const request = httpRequest(`${baseUrl}/api/ai/conversations/${created.conversation.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
    })
    request.on('error', () => undefined)
    request.end(payload)

    await vi.waitFor(() => expect(providerSignal).toBeInstanceOf(AbortSignal))
    request.destroy()
    await vi.waitFor(() => expect(providerSignal?.aborted).toBe(true))
    await vi.waitFor(() =>
      expect(
        connection.sqlite.prepare('select status, error_code as errorCode from ai_generation_attempts').get()
      ).toEqual({ status: 'cancelled', errorCode: 'provider_cancelled' })
    )
    expect(connection.sqlite.prepare('select count(*) as count from ai_generation_leases').get()).toEqual({ count: 0 })
  })

  it('does not begin generation when the client disconnects during authentication', async () => {
    const created = await createConversation()
    sessionMocks.requireSession.mockClear()
    let authenticationResumed: (() => void) | undefined
    const authenticationDidResume = new Promise<void>((resolve) => {
      authenticationResumed = resolve
    })
    sessionMocks.requireSession.mockImplementationOnce(
      (event: Parameters<typeof sessionMocks.requireSession>[0]) =>
        new Promise((resolve) => {
          event.node.req.socket.once('close', () => {
            authenticationResumed?.()
            resolve(currentSession)
          })
        })
    )
    databaseMocks.useDatabase.mockClear()
    const payload = JSON.stringify({
      clientRequestId: '44444444-4444-4444-8444-444444444444',
      content: 'Do not start this request after its client has gone away.'
    })
    const clientController = new AbortController()
    const requestFinished = fetch(`${baseUrl}/api/ai/conversations/${created.conversation.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      signal: clientController.signal
    }).then(
      () => undefined,
      (error: unknown) => error
    )

    await vi.waitFor(() => expect(sessionMocks.requireSession).toHaveBeenCalledOnce())
    clientController.abort()
    expect(await requestFinished).toBeInstanceOf(Error)
    await authenticationDidResume
    for (let turn = 0; turn < 3; turn += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }

    expect(databaseMocks.useDatabase).not.toHaveBeenCalled()
    expect(providerMocks.getOpenAIResponsesAdapter).not.toHaveBeenCalled()
    expect(providerMocks.createResponse).not.toHaveBeenCalled()
  })

  it('conceals disabled AI without credentials before auth, parsing, database, or provider work', async () => {
    runtimeMocks.getAppRuntimeConfig.mockReturnValue(runtimeConfig(false))
    databaseMocks.useDatabase.mockClear()
    sessionMocks.requireSession.mockClear()

    const response = await request('/api/ai/conversations', 'POST', '{')
    const body = await response.text()
    expect(response.status).toBe(404)
    expect(body).toContain('MODULE_DISABLED')
    expect(sessionMocks.requireSession).not.toHaveBeenCalled()
    expect(databaseMocks.useDatabase).not.toHaveBeenCalled()
    expect(providerMocks.getOpenAIResponsesAdapter).not.toHaveBeenCalled()
    expect(providerMocks.createResponse).not.toHaveBeenCalled()
  })
})

type PublicConversationJson = {
  id: string
  createdAt: string
  updatedAt: string
}

type PublicMessageJson = {
  id: string
  sequence: number
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  citations: Array<
    { type: 'file'; title: string } | { type: 'web'; title: string; url: string; startIndex: number; endIndex: number }
  >
}

type GenerationJson = {
  conversation: PublicConversationJson
  userMessage: PublicMessageJson
  assistantMessage: PublicMessageJson
}

async function createConversation() {
  const response = await jsonRequest('/api/ai/conversations', 'POST', {})
  const body = (await response.json()) as { conversation: PublicConversationJson }
  return { response, conversation: body.conversation }
}

function jsonRequest(path: string, method: string, body: unknown) {
  return request(path, method, JSON.stringify(body), { 'content-type': 'application/json' })
}

function request(path: string, method: string, body?: string, headers?: Record<string, string>) {
  return fetch(`${baseUrl}${path}`, { method, ...(headers ? { headers } : {}), ...(body ? { body } : {}) })
}

function sessionFor(userId: string) {
  return {
    user: { id: userId, name: userId, email: `${userId}@example.test`, image: null },
    session: { id: `session-${userId}`, userId, activeOrganizationId: sharedFamilyId }
  }
}

function runtimeConfig(aiEnabled: boolean): AppRuntimeConfig {
  return {
    betterAuth: { secret: 'ai-http-test-secret-with-at-least-thirty-two-bytes', url: 'https://app.example.test' },
    modules: {
      billing: { enabled: false },
      files: { enabled: false },
      ai: { enabled: aiEnabled },
      turnstile: { enabled: false },
      observability: { enabled: false },
      jobs: { enabled: false }
    },
    openai: {
      apiKey: aiEnabled ? 'fake-openai-key-never-sent' : '',
      projectId: aiEnabled ? 'fake-openai-project' : '',
      model: aiEnabled ? 'gpt-5.6-luna' : '',
      fileSearch: { enabled: false, vectorStoreId: '' },
      webSearch: { enabled: false, allowedDomains: [] }
    },
    public: {
      appUrl: 'https://app.example.test',
      moduleStates: {
        billing: 'disabled',
        files: 'disabled',
        ai: aiEnabled ? 'ready' : 'disabled',
        turnstile: 'disabled',
        observability: 'disabled',
        jobs: 'disabled'
      }
    }
  } as unknown as AppRuntimeConfig
}

function createFixture(): { connection: DatabaseConnection; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'swl-ai-conversation-http-'))
  const databasePath = join(directory, 'app.db')
  const sqlite = new Database(databasePath)
  sqlite.pragma('foreign_keys = ON')
  migrate(drizzle({ client: sqlite }), { migrationsFolder })
  sqlite.exec('drop trigger if exists user_personal_organization_after_insert')
  const fixtureConnection = { sqlite, db: drizzle({ client: sqlite, schema }), databasePath }

  insertUser(sqlite, currentUserId)
  insertUser(sqlite, otherUserId)
  sqlite
    .prepare('insert into organization (id, name, slug, created_at, personal_owner_user_id) values (?, ?, ?, 1, ?)')
    .run(sharedFamilyId, 'Shared family', 'shared-ai-http-family', currentUserId)
  sqlite
    .prepare('insert into organization (id, name, slug, created_at, personal_owner_user_id) values (?, ?, ?, 1, ?)')
    .run('organization-ai-http-other', 'Other personal family', 'other-ai-http-family', otherUserId)
  sqlite
    .prepare('insert into member (id, organization_id, user_id, role, created_at) values (?, ?, ?, ?, 1)')
    .run('member-ai-http-current', sharedFamilyId, currentUserId, 'owner')
  sqlite
    .prepare('insert into member (id, organization_id, user_id, role, created_at) values (?, ?, ?, ?, 1)')
    .run('member-ai-http-other', sharedFamilyId, otherUserId, 'member')

  return {
    connection: fixtureConnection,
    cleanup: () => {
      sqlite.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

function insertUser(sqlite: InstanceType<typeof Database>, id: string) {
  sqlite
    .prepare('insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, 1, 1)')
    .run(id, id, `${id}@example.test`)
}
