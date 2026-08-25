import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseConnection } from '../server/db/connect'
import { finalizeAiGenerationAttempt, getAiUsageBucketForOwner } from '../server/db/repositories/ai-conversations'
import * as schema from '../server/db/schema'
import {
  clearOwnedAiConversation,
  createAiConversationService,
  createOwnedAiConversation,
  createOwnedAiMessage,
  deleteOwnedAiConversation,
  getOwnedAiConversation,
  listOwnedAiConversations,
  listOwnedAiMessages,
  type AiConversationServiceDependencies
} from '../server/services/ai/ai-conversation-service'
import { OpenAIProviderError, type OpenAIResponsesAdapter } from '../server/services/ai/openai'
import type { AppSession } from '../server/utils/auth/require-session'
import type { AppRuntimeConfig } from '../server/utils/runtime'

const productionMocks = vi.hoisted(() => ({
  useDatabase: vi.fn(),
  getAppRuntimeConfig: vi.fn(),
  getOpenAIResponsesAdapter: vi.fn()
}))

vi.mock('../server/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/db/client')>()),
  useDatabase: productionMocks.useDatabase
}))
vi.mock('../server/utils/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/utils/runtime')>()),
  getAppRuntimeConfig: productionMocks.getAppRuntimeConfig
}))
vi.mock('../server/services/ai/openai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/services/ai/openai')>()),
  getOpenAIResponsesAdapter: productionMocks.getOpenAIResponsesAdapter
}))

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
const fixedNow = new Date('2026-07-16T12:00:00.000Z')
const rawPromptCanary = 'private-prompt-must-not-enter-diagnostics'

let connection: DatabaseConnection

beforeEach(() => {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle({ client: sqlite, schema })
  migrate(db, { migrationsFolder })
  connection = { sqlite, db, databasePath: ':memory:' }
  productionMocks.useDatabase.mockReturnValue(connection)
  productionMocks.getAppRuntimeConfig.mockReturnValue(runtimeConfig())
  productionMocks.getOpenAIResponsesAdapter.mockReturnValue(successfulProvider())
})

afterEach(() => {
  connection.sqlite.close()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('private AI conversation service', () => {
  it('persists normalized local history, replays one request once, and exposes only public fields', async () => {
    insertUser(connection, 'owner', 'owner@example.test')
    const createResponse = vi.fn<OpenAIResponsesAdapter['createResponse']>().mockResolvedValue({
      kind: 'text',
      text: 'A locally persisted answer.',
      citations: [
        { type: 'file', title: 'Guide One.pdf' },
        { type: 'file', title: 'Guide Two.md' }
      ],
      model: 'gpt-5.6-luna',
      requestId: 'request_provider_normalized',
      usage: usage()
    })
    const provider = vi.fn(() => ({ createResponse }))
    const service = makeService({ provider })

    const conversation = service.createConversation('owner')
    const clientRequestId = randomUUID()
    const created = await service.createMessage('owner', conversation.id, {
      clientRequestId,
      content: 'What is observable behavior?'
    })

    expect(provider).toHaveBeenCalledOnce()
    expect(createResponse).toHaveBeenCalledOnce()
    expect(createResponse).toHaveBeenCalledWith({
      instructions: 'You are a helpful assistant. Answer the user directly and clearly.',
      messages: [{ role: 'user', content: 'What is observable behavior?' }],
      safetyIdentifier: expect.stringMatching(/^[0-9a-f]{64}$/),
      requestId: expect.stringMatching(/^ai_attempt_/),
      maxOutputTokens: 4_096,
      timeoutMs: 60_000
    })
    expect(createResponse.mock.calls[0]![0].safetyIdentifier).not.toContain('owner')
    expect(created).toEqual({
      replayed: false,
      response: {
        conversation: expect.objectContaining({ id: conversation.id }),
        userMessage: expect.objectContaining({
          role: 'user',
          content: 'What is observable behavior?',
          citations: []
        }),
        assistantMessage: expect.objectContaining({
          role: 'assistant',
          content: 'A locally persisted answer.',
          citations: [
            { type: 'file', title: 'Guide One.pdf' },
            { type: 'file', title: 'Guide Two.md' }
          ]
        })
      }
    })
    expect(Object.keys(created.response.conversation).sort()).toEqual(['createdAt', 'id', 'updatedAt'])
    expect(Object.keys(created.response.userMessage).sort()).toEqual([
      'citations',
      'content',
      'createdAt',
      'id',
      'role',
      'sequence'
    ])
    expect(JSON.stringify(created.response)).not.toMatch(
      /attempt|clientRequest|historyRevision|model|provider|request_provider|token/i
    )

    const replayed = await service.createMessage('owner', conversation.id, {
      clientRequestId,
      content: 'What is observable behavior?'
    })
    expect(replayed).toEqual({ ...created, replayed: true })
    expect(provider).toHaveBeenCalledOnce()
    expect(createResponse).toHaveBeenCalledOnce()

    await expect(
      service.createMessage('owner', conversation.id, {
        clientRequestId,
        content: 'A different request using the same idempotency key.'
      })
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(createResponse).toHaveBeenCalledOnce()

    const firstPage = service.listMessages('owner', conversation.id, { limit: 1 })
    expect(firstPage.messages).toEqual([created.response.userMessage])
    expect(firstPage.nextCursor).toEqual(expect.any(String))
    expect(
      service.listMessages('owner', conversation.id, { cursor: firstPage.nextCursor!, limit: 1 }).messages
    ).toEqual([created.response.assistantMessage])
    expect(service.listConversations('owner').conversations).toEqual([created.response.conversation])
    expect(service.getConversation('owner', conversation.id)).toEqual(created.response.conversation)

    expect(
      connection.sqlite
        .prepare(
          `select status, model, provider_request_id as providerRequestId,
                  input_tokens as inputTokens, output_tokens as outputTokens
           from ai_generation_attempts`
        )
        .get()
    ).toEqual({
      status: 'succeeded',
      model: 'gpt-5.6-luna',
      providerRequestId: 'request_provider_normalized',
      inputTokens: 20,
      outputTokens: 7
    })
  })

  it('persists and replays normalized Web Search citations without exposing provider search data', async () => {
    insertUser(connection, 'web-owner', 'web-owner@example.test')
    const createResponse = vi.fn<OpenAIResponsesAdapter['createResponse']>().mockResolvedValue({
      kind: 'text',
      text: 'A current answer with an inline source.',
      citations: [
        {
          type: 'web',
          title: 'Current source',
          url: 'https://reference.test/current',
          startIndex: 25,
          endIndex: 38
        }
      ],
      model: 'gpt-5.6-luna',
      requestId: 'request_provider_web_normalized',
      usage: usage()
    })
    const service = makeService({ provider: () => ({ createResponse }) })
    const conversation = service.createConversation('web-owner')
    const clientRequestId = randomUUID()

    const created = await service.createMessage('web-owner', conversation.id, {
      clientRequestId,
      content: 'What changed recently?'
    })

    expect(created.response.assistantMessage.citations).toEqual([
      {
        type: 'web',
        title: 'Current source',
        url: 'https://reference.test/current',
        startIndex: 25,
        endIndex: 38
      }
    ])
    expect(
      service.listMessages('web-owner', conversation.id).messages.find(({ role }) => role === 'assistant')?.citations
    ).toEqual(created.response.assistantMessage.citations)
    await expect(
      service.createMessage('web-owner', conversation.id, {
        clientRequestId,
        content: 'What changed recently?'
      })
    ).resolves.toEqual({ ...created, replayed: true })
    expect(createResponse).toHaveBeenCalledOnce()
    expect(JSON.stringify(created)).not.toContain('request_provider_web_normalized')
  })

  it('lets every account use AI while keeping conversations private between users', async () => {
    insertUser(connection, 'first-owner', 'first-owner@example.test')
    insertUser(connection, 'second-owner', 'second-owner@example.test')
    const createResponse = vi
      .fn<OpenAIResponsesAdapter['createResponse']>()
      .mockResolvedValue(successfulResult('A private response.'))
    const service = makeService({ provider: () => ({ createResponse }) })
    const firstConversation = service.createConversation('first-owner')

    expect(service.listConversations('second-owner')).toEqual({ conversations: [], nextCursor: null })
    expect(() => service.getConversation('second-owner', firstConversation.id)).toThrow(
      expect.objectContaining({ statusCode: 404 })
    )
    await expect(
      service.createMessage('second-owner', firstConversation.id, {
        clientRequestId: randomUUID(),
        content: 'A foreign conversation is not data access.'
      })
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(connection.sqlite.prepare('select count(*) as count from ai_messages').get()).toEqual({ count: 0 })

    const secondConversation = service.createConversation('second-owner')
    await expect(
      service.createMessage('second-owner', secondConversation.id, {
        clientRequestId: randomUUID(),
        content: 'Every authenticated account may use its own private AI conversation.'
      })
    ).resolves.toMatchObject({ replayed: false })
    expect(createResponse).toHaveBeenCalledOnce()
    expect(() => service.getConversation('first-owner', secondConversation.id)).toThrow(
      expect.objectContaining({ statusCode: 404 })
    )
  })

  it('retains the complete scrollable transcript while independently bounding provider context by bytes', async () => {
    insertUser(connection, 'long-history-owner', 'long-history@example.test')
    const observedInputs: unknown[] = []
    const service = makeService({
      provider: () => ({
        createResponse: vi.fn(async (input) => {
          observedInputs.push(input.messages)
          return {
            kind: 'text',
            text: 'Answer after more than one hundred prior messages.',
            citations: [],
            model: 'gpt-5.6-luna',
            requestId: 'request_long_history',
            usage: usage()
          }
        })
      })
    })
    const conversation = service.createConversation('long-history-owner')
    seedTranscript(connection, conversation.id, 120)

    await service.createMessage('long-history-owner', conversation.id, {
      clientRequestId: randomUUID(),
      content: 'This is message 121.'
    })

    expect(observedInputs).toHaveLength(1)
    expect(observedInputs[0]).toHaveLength(121)
    const firstPage = service.listMessages('long-history-owner', conversation.id, { limit: 100 })
    const secondPage = service.listMessages('long-history-owner', conversation.id, {
      cursor: firstPage.nextCursor!,
      limit: 100
    })
    expect(firstPage.messages).toHaveLength(100)
    expect(secondPage.messages).toHaveLength(22)
    expect(secondPage.nextCursor).toBeNull()
    expect([...firstPage.messages, ...secondPage.messages].map((message) => message.sequence)).toEqual(
      Array.from({ length: 122 }, (_, index) => index + 1)
    )
  })

  it('admits one final retained turn, rejects full and legacy histories without writes, and preserves replay', async () => {
    insertUser(connection, 'row-limit-owner', 'row-limit-owner@example.test')
    const createResponse = vi
      .fn<OpenAIResponsesAdapter['createResponse']>()
      .mockResolvedValue(successfulResult('The final retained assistant message.'))
    const service = makeService({ provider: () => ({ createResponse }) })
    const conversation = service.createConversation('row-limit-owner')
    seedTranscript(connection, conversation.id, 254)
    const clientRequestId = randomUUID()

    const completed = await service.createMessage('row-limit-owner', conversation.id, {
      clientRequestId,
      content: 'This complete turn reaches exactly 256 retained messages.'
    })
    expect(conversationState(connection, 'row-limit-owner', conversation.id)).toMatchObject({
      messages: 256,
      attempts: 1,
      leases: 0,
      requestCount: 1,
      nextSequence: 257
    })
    await expect(
      service.createMessage('row-limit-owner', conversation.id, {
        clientRequestId,
        content: 'This complete turn reaches exactly 256 retained messages.'
      })
    ).resolves.toEqual({ ...completed, replayed: true })
    expect(createResponse).toHaveBeenCalledOnce()

    const beforeFullRejection = conversationState(connection, 'row-limit-owner', conversation.id)
    await expect(
      service.createMessage('row-limit-owner', conversation.id, {
        clientRequestId: randomUUID(),
        content: 'A full transcript cannot grow.'
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'AI conversation history limit reached. Clear it or start a new conversation.'
    })
    expect(conversationState(connection, 'row-limit-owner', conversation.id)).toEqual(beforeFullRejection)
    expect(createResponse).toHaveBeenCalledOnce()

    const legacy = service.createConversation('row-limit-owner')
    seedTranscript(connection, legacy.id, 257)
    expect(conversationState(connection, 'row-limit-owner', legacy.id).messages).toBe(257)
    const beforeLegacyRejection = conversationState(connection, 'row-limit-owner', legacy.id)
    await expect(
      service.createMessage('row-limit-owner', legacy.id, {
        clientRequestId: randomUUID(),
        content: 'Legacy excess remains readable but cannot grow.'
      })
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(conversationState(connection, 'row-limit-owner', legacy.id)).toEqual(beforeLegacyRejection)

    service.clearConversation('row-limit-owner', legacy.id)
    await expect(
      service.createMessage('row-limit-owner', legacy.id, {
        clientRequestId: randomUUID(),
        content: 'Clearing restores retained-history capacity.'
      })
    ).resolves.toMatchObject({ replayed: false })
    expect(createResponse).toHaveBeenCalledTimes(2)
  })

  it('uses exact SQLite UTF-8 bytes for the 2,000,000-byte retained ceiling', async () => {
    insertUser(connection, 'byte-limit-owner', 'byte-limit-owner@example.test')
    insertUser(connection, 'byte-overflow-owner', 'byte-overflow-owner@example.test')
    const exactExistingContent = `${'é'.repeat(967_999)}x`
    const overflowExistingContent = `${exactExistingContent}y`
    const exactAssistantContent = '🙂'.repeat(16_000)
    expect(Buffer.byteLength(exactExistingContent, 'utf8')).toBe(1_935_999)
    expect(Buffer.byteLength(overflowExistingContent, 'utf8')).toBe(1_936_000)
    expect(Buffer.byteLength(exactAssistantContent, 'utf8')).toBe(64_000)

    const createResponse = vi
      .fn<OpenAIResponsesAdapter['createResponse']>()
      .mockResolvedValue(successfulResult(exactAssistantContent))
    const service = makeService({ provider: () => ({ createResponse }) })
    const exact = service.createConversation('byte-limit-owner')
    seedMessages(connection, exact.id, [{ role: 'user', content: exactExistingContent }])

    await expect(
      service.createMessage('byte-limit-owner', exact.id, {
        clientRequestId: randomUUID(),
        content: 'x'
      })
    ).resolves.toMatchObject({ response: { assistantMessage: { content: exactAssistantContent } } })
    expect(
      connection.sqlite
        .prepare(
          `select count(*) as count, coalesce(sum(octet_length(content)), 0) as contentBytes
           from ai_messages where conversation_id = ?`
        )
        .get(exact.id)
    ).toEqual({ count: 3, contentBytes: 2_000_000 })

    const overflow = service.createConversation('byte-overflow-owner')
    seedMessages(connection, overflow.id, [{ role: 'user', content: overflowExistingContent }])
    const beforeOverflow = conversationState(connection, 'byte-overflow-owner', overflow.id)
    await expect(
      service.createMessage('byte-overflow-owner', overflow.id, {
        clientRequestId: randomUUID(),
        content: 'x'
      })
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(conversationState(connection, 'byte-overflow-owner', overflow.id)).toEqual(beforeOverflow)
    expect(createResponse).toHaveBeenCalledOnce()
  })

  it('terminalizes a defensive retained-history race as an idempotent safe conflict', async () => {
    insertUser(connection, 'history-race-owner', 'history-race-owner@example.test')
    let conversationId = ''
    const createResponse = vi.fn<OpenAIResponsesAdapter['createResponse']>().mockImplementation(async () => {
      const conversation = connection.sqlite
        .prepare('select next_sequence as nextSequence from ai_conversations where id = ?')
        .get(conversationId) as { nextSequence: number }
      connection.sqlite.transaction(() => {
        connection.sqlite
          .prepare(
            `insert into ai_messages (id, conversation_id, sequence, role, content, created_at)
             values (?, ?, ?, 'assistant', 'Concurrent retained row.', ?)`
          )
          .run(`ai_message_${randomUUID()}`, conversationId, conversation.nextSequence, fixedNow.toISOString())
        connection.sqlite
          .prepare('update ai_conversations set next_sequence = next_sequence + 1 where id = ?')
          .run(conversationId)
      })()
      return successfulResult('This provider response no longer fits.')
    })
    const service = makeService({ provider: () => ({ createResponse }) })
    conversationId = service.createConversation('history-race-owner').id
    seedTranscript(connection, conversationId, 254)
    const clientRequestId = randomUUID()
    const content = 'A concurrent retained row consumes the reserved assistant slot.'

    await expect(
      service.createMessage('history-race-owner', conversationId, { clientRequestId, content })
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(
      connection.sqlite
        .prepare(
          `select status, error_code as errorCode, assistant_message_id as assistantMessageId
           from ai_generation_attempts where client_request_id = ?`
        )
        .get(clientRequestId)
    ).toEqual({ status: 'failed', errorCode: 'application_history_limit', assistantMessageId: null })
    await expect(
      service.createMessage('history-race-owner', conversationId, { clientRequestId, content })
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(createResponse).toHaveBeenCalledOnce()
  })

  it('enforces the persisted daily quota and one active generation without hidden provider calls', async () => {
    insertUser(connection, 'bounded-owner', 'bounded-owner@example.test')
    const firstResponse = deferred<Awaited<ReturnType<OpenAIResponsesAdapter['createResponse']>>>()
    const createResponse = vi
      .fn<OpenAIResponsesAdapter['createResponse']>()
      .mockImplementation(() => firstResponse.promise)
    const service = makeService({ provider: () => ({ createResponse }) })
    const conversation = service.createConversation('bounded-owner')

    const inFlight = service.createMessage('bounded-owner', conversation.id, {
      clientRequestId: randomUUID(),
      content: 'Keep this provider request pending.'
    })
    await vi.waitFor(() => expect(createResponse).toHaveBeenCalledOnce())
    await expect(
      service.createMessage('bounded-owner', conversation.id, {
        clientRequestId: randomUUID(),
        content: 'This second generation must not reach the provider.'
      })
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(createResponse).toHaveBeenCalledOnce()
    firstResponse.resolve({
      kind: 'text',
      text: 'The first response.',
      citations: [],
      model: 'gpt-5.6-luna',
      requestId: 'request_first',
      usage: usage()
    })
    await expect(inFlight).resolves.toMatchObject({ replayed: false })

    connection.sqlite
      .prepare("update ai_usage_buckets set request_count = 50 where owner_user_id = 'bounded-owner'")
      .run()
    await expect(
      service.createMessage('bounded-owner', conversation.id, {
        clientRequestId: randomUUID(),
        content: 'The quota rejects before another provider call.'
      })
    ).rejects.toMatchObject({ statusCode: 429 })
    expect(createResponse).toHaveBeenCalledOnce()
  })

  it('persists safe terminal failures and refusals without logging or retaining private provider errors', async () => {
    insertUser(connection, 'failure-owner', 'failure-owner@example.test')
    const capture = vi.fn().mockResolvedValue(undefined)
    const createResponse = vi
      .fn<OpenAIResponsesAdapter['createResponse']>()
      .mockRejectedValueOnce(new OpenAIProviderError('timeout', { retryable: true }))
      .mockResolvedValueOnce({
        kind: 'refusal',
        text: 'I cannot help with that request.',
        citations: [],
        model: 'gpt-5.6-luna',
        requestId: 'request_refusal',
        usage: usage()
      })
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn'].map((method) =>
      vi.spyOn(console, method as 'debug').mockImplementation(() => undefined)
    )
    const service = makeService({ provider: () => ({ createResponse }), capture })
    const conversation = service.createConversation('failure-owner')
    const timedOutRequestId = randomUUID()

    await expect(
      service.createMessage('failure-owner', conversation.id, {
        clientRequestId: timedOutRequestId,
        content: rawPromptCanary
      })
    ).rejects.toMatchObject({ statusCode: 504 })
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'OpenAI response failed' }),
      'openai-response-failed'
    )
    expect(JSON.stringify(capture.mock.calls)).not.toContain(rawPromptCanary)
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled()

    await expect(
      service.createMessage('failure-owner', conversation.id, {
        clientRequestId: timedOutRequestId,
        content: rawPromptCanary
      })
    ).rejects.toMatchObject({ statusCode: 504 })
    expect(createResponse).toHaveBeenCalledOnce()

    const refused = await service.createMessage('failure-owner', conversation.id, {
      clientRequestId: randomUUID(),
      content: 'A second request receives a normalized refusal.'
    })
    expect(refused.response.assistantMessage).toMatchObject({
      role: 'assistant',
      content: 'I cannot help with that request.'
    })
    expect(
      connection.sqlite
        .prepare('select status, error_code as errorCode from ai_generation_attempts order by created_at, id')
        .all()
    ).toEqual(
      expect.arrayContaining([
        { status: 'indeterminate', errorCode: 'provider_timeout' },
        { status: 'refused', errorCode: 'provider_refusal' }
      ])
    )
  })

  it('lets clear and delete remove private history while daily usage survives until account deletion', async () => {
    insertUser(connection, 'deletion-owner', 'deletion-owner@example.test')
    const service = makeService({ provider: () => successfulProvider() })
    const first = service.createConversation('deletion-owner')
    await service.createMessage('deletion-owner', first.id, {
      clientRequestId: randomUUID(),
      content: 'Persist then clear this conversation.'
    })
    expect(getAiUsageBucketForOwner(connection, 'deletion-owner', '2026-07-16')?.requestCount).toBe(1)

    service.clearConversation('deletion-owner', first.id)
    expect(service.listMessages('deletion-owner', first.id)).toEqual({ messages: [], nextCursor: null })
    expect(connection.sqlite.prepare('select count(*) as count from ai_generation_attempts').get()).toEqual({
      count: 0
    })
    expect(getAiUsageBucketForOwner(connection, 'deletion-owner', '2026-07-16')?.requestCount).toBe(1)

    service.deleteConversation('deletion-owner', first.id)
    expect(() => service.getConversation('deletion-owner', first.id)).toThrow(
      expect.objectContaining({ statusCode: 404 })
    )
    expect(getAiUsageBucketForOwner(connection, 'deletion-owner', '2026-07-16')?.requestCount).toBe(1)
  })

  it('reaps an expired crashed attempt on idempotent replay without redispatching it', async () => {
    insertUser(connection, 'crashed-owner', 'crashed-owner@example.test')
    let currentTime = fixedNow
    const deferredResponse = deferred<Awaited<ReturnType<OpenAIResponsesAdapter['createResponse']>>>()
    const createResponse = vi
      .fn<OpenAIResponsesAdapter['createResponse']>()
      .mockImplementation(() => deferredResponse.promise)
    const service = createAiConversationService({
      connection,
      config: runtimeConfig(),
      provider: () => ({ createResponse }),
      capture: vi.fn().mockResolvedValue(undefined),
      now: () => currentTime
    })
    const conversation = service.createConversation('crashed-owner')
    const clientRequestId = randomUUID()
    const original = service.createMessage('crashed-owner', conversation.id, {
      clientRequestId,
      content: 'This process appears to crash while the provider call is pending.'
    })
    await vi.waitFor(() => expect(createResponse).toHaveBeenCalledOnce())

    currentTime = new Date(fixedNow.getTime() + 91_000)
    await expect(
      service.createMessage('crashed-owner', conversation.id, {
        clientRequestId,
        content: 'This process appears to crash while the provider call is pending.'
      })
    ).rejects.toMatchObject({ statusCode: 504 })
    expect(createResponse).toHaveBeenCalledOnce()
    expect(
      connection.sqlite
        .prepare(
          'select status, error_code as errorCode, lease_expires_at as leaseExpiresAt from ai_generation_attempts'
        )
        .get()
    ).toEqual({ status: 'indeterminate', errorCode: 'attempt_lease_expired', leaseExpiresAt: null })
    expect(connection.sqlite.prepare('select count(*) as count from ai_generation_leases').get()).toEqual({ count: 0 })

    deferredResponse.resolve({
      kind: 'text',
      text: 'A late response cannot replace the indeterminate state.',
      citations: [],
      model: 'gpt-5.6-luna',
      requestId: 'request_after_crash',
      usage: usage()
    })
    await expect(original).rejects.toMatchObject({ statusCode: 503 })
    expect(createResponse).toHaveBeenCalledOnce()
  })

  it('does not resurrect a provider result after clear or conversation deletion wins the race', async () => {
    insertUser(connection, 'race-owner', 'race-owner@example.test')
    const firstResponse = deferred<Awaited<ReturnType<OpenAIResponsesAdapter['createResponse']>>>()
    const secondResponse = deferred<Awaited<ReturnType<OpenAIResponsesAdapter['createResponse']>>>()
    const createResponse = vi
      .fn<OpenAIResponsesAdapter['createResponse']>()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => secondResponse.promise)
    const service = makeService({ provider: () => ({ createResponse }) })

    const cleared = service.createConversation('race-owner')
    const clearing = service.createMessage('race-owner', cleared.id, {
      clientRequestId: randomUUID(),
      content: 'A clear should win over this late answer.'
    })
    await vi.waitFor(() => expect(createResponse).toHaveBeenCalledTimes(1))
    service.clearConversation('race-owner', cleared.id)
    await expect(
      service.createMessage('race-owner', cleared.id, {
        clientRequestId: randomUUID(),
        content: 'Clearing history must not release the active provider lease.'
      })
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(createResponse).toHaveBeenCalledTimes(1)
    firstResponse.resolve({
      kind: 'text',
      text: 'This late answer must be discarded.',
      citations: [],
      model: 'gpt-5.6-luna',
      requestId: 'request_after_clear',
      usage: usage()
    })
    await expect(clearing).rejects.toMatchObject({ statusCode: 409 })
    expect(service.listMessages('race-owner', cleared.id).messages).toEqual([])

    const deleted = service.createConversation('race-owner')
    const retained = service.createConversation('race-owner')
    const deleting = service.createMessage('race-owner', deleted.id, {
      clientRequestId: randomUUID(),
      content: 'A delete should win over this late answer.'
    })
    await vi.waitFor(() => expect(createResponse).toHaveBeenCalledTimes(2))
    service.deleteConversation('race-owner', deleted.id)
    await expect(
      service.createMessage('race-owner', retained.id, {
        clientRequestId: randomUUID(),
        content: 'Deleting a conversation must not release its active provider lease.'
      })
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(createResponse).toHaveBeenCalledTimes(2)
    secondResponse.resolve({
      kind: 'text',
      text: 'This second late answer must also be discarded.',
      citations: [],
      model: 'gpt-5.6-luna',
      requestId: 'request_after_delete',
      usage: usage()
    })
    await expect(deleting).rejects.toMatchObject({ statusCode: 404 })
    expect(connection.sqlite.prepare('select count(*) as count from ai_messages').get()).toEqual({ count: 0 })

    createResponse.mockResolvedValueOnce({
      kind: 'text',
      text: 'A generation after the prior lease was released.',
      citations: [],
      model: 'gpt-5.6-luna',
      requestId: 'request_after_release',
      usage: usage()
    })
    await expect(
      service.createMessage('race-owner', retained.id, {
        clientRequestId: randomUUID(),
        content: 'The next generation may start after the prior call finalizes.'
      })
    ).resolves.toMatchObject({ replayed: false })
    expect(createResponse).toHaveBeenCalledTimes(3)
  })

  it('enforces the conversation limit and paginates conversations without hiding older rows', () => {
    insertUser(connection, 'list-owner', 'list-owner@example.test')
    const service = makeService({ provider: () => neverProvider() })
    const created = Array.from({ length: 100 }, () => service.createConversation('list-owner'))

    expect(() => service.createConversation('list-owner')).toThrow(expect.objectContaining({ statusCode: 409 }))

    const observedIds: string[] = []
    let cursor: string | undefined
    do {
      const page = service.listConversations('list-owner', { cursor, limit: 17 })
      observedIds.push(...page.conversations.map((conversation) => conversation.id))
      cursor = page.nextCursor ?? undefined
    } while (cursor)

    expect(observedIds).toHaveLength(100)
    expect(new Set(observedIds)).toEqual(new Set(created.map((conversation) => conversation.id)))
  })

  it('rejects malformed opaque cursors and conceals missing CRUD targets', () => {
    insertUser(connection, 'cursor-owner', 'cursor-owner@example.test')
    insertUser(connection, 'cursor-other', 'cursor-other@example.test')
    const service = makeService({ provider: () => neverProvider() })
    const conversation = service.createConversation('cursor-owner')

    for (const cursor of [
      'x'.repeat(513),
      'not-json',
      encodedCursor({ version: 2, kind: 'conversation' }),
      encodedCursor({ version: 1, kind: 'message', sequence: 1, id: 'message' }),
      encodedCursor({ version: 1, kind: 'conversation', updatedAt: null, id: 'conversation' }),
      encodedCursor({ version: 1, kind: 'conversation', updatedAt: 'not-a-date', id: 'conversation' }),
      encodedCursor({ version: 1, kind: 'conversation', updatedAt: fixedNow.toISOString(), id: 7 }),
      encodedCursor({ version: 1, kind: 'conversation', updatedAt: fixedNow.toISOString(), id: '' })
    ]) {
      expect(() => service.listConversations('cursor-owner', { cursor })).toThrow(
        expect.objectContaining({ statusCode: 400 })
      )
    }

    for (const cursor of [
      encodedCursor({ version: 1, kind: 'message', sequence: '1', id: 'message' }),
      encodedCursor({ version: 1, kind: 'message', sequence: 0, id: 'message' }),
      encodedCursor({ version: 1, kind: 'message', sequence: 1, id: 7 }),
      encodedCursor({ version: 1, kind: 'message', sequence: 1, id: '' }),
      encodedCursor({ version: 1, kind: 'conversation', updatedAt: fixedNow.toISOString(), id: conversation.id })
    ]) {
      expect(() => service.listMessages('cursor-owner', conversation.id, { cursor })).toThrow(
        expect.objectContaining({ statusCode: 400 })
      )
    }

    expect(() => service.deleteConversation('cursor-other', conversation.id)).toThrow(
      expect.objectContaining({ statusCode: 404 })
    )
    expect(() => service.clearConversation('cursor-other', conversation.id)).toThrow(
      expect.objectContaining({ statusCode: 404 })
    )
    expect(() => service.listMessages('cursor-other', conversation.id)).toThrow(
      expect.objectContaining({ statusCode: 404 })
    )
  })

  it('validates request IDs, UTF-8 message bounds, and model readiness', async () => {
    insertUser(connection, 'validation-owner', 'validation-owner@example.test')
    const provider = vi.fn(() => neverProvider())
    const service = makeService({ provider })
    const conversation = service.createConversation('validation-owner')

    for (const input of [
      { clientRequestId: 'not-a-uuid', content: 'Valid content.' },
      { clientRequestId: randomUUID(), content: '   ' },
      { clientRequestId: randomUUID(), content: 'é'.repeat(16_001) }
    ]) {
      await expect(service.createMessage('validation-owner', conversation.id, input)).rejects.toMatchObject({
        statusCode: 400
      })
    }

    const noModelConfig = {
      ...runtimeConfig(),
      openai: { ...runtimeConfig().openai, model: '' }
    } as AppRuntimeConfig
    const noModel = makeService({ provider, config: noModelConfig })
    await expect(
      noModel.createMessage('validation-owner', conversation.id, {
        clientRequestId: randomUUID(),
        content: 'A model must be configured.'
      })
    ).rejects.toMatchObject({ statusCode: 503 })

    expect(provider).not.toHaveBeenCalled()
    expect(connection.sqlite.prepare('select count(*) as count from ai_messages').get()).toEqual({ count: 0 })
  })

  it('bounds provider context independently and removes an orphaned leading assistant turn', async () => {
    insertUser(connection, 'context-owner', 'context-owner@example.test')
    const observedMessages: unknown[] = []
    const service = makeService({
      provider: () => ({
        async createResponse(input) {
          observedMessages.push(input.messages)
          return successfulResult('The bounded context was accepted.')
        }
      })
    })
    const conversation = service.createConversation('context-owner')
    seedMessages(connection, conversation.id, [
      { role: 'user', content: 'u'.repeat(100_000) },
      { role: 'assistant', content: 'a'.repeat(100_000) }
    ])

    await service.createMessage('context-owner', conversation.id, {
      clientRequestId: randomUUID(),
      content: 'Only a coherent recent suffix should be sent.'
    })

    expect(observedMessages).toEqual([[{ role: 'user', content: 'Only a coherent recent suffix should be sent.' }]])
    expect(service.listMessages('context-owner', conversation.id).messages).toHaveLength(4)
  })

  it('rejects a provider-context revision race before provider dispatch', async () => {
    insertUser(connection, 'context-race-owner', 'context-race@example.test')
    const provider = vi.fn(() => neverProvider())

    const changed = makeService({ provider })
    const changedConversation = changed.createConversation('context-race-owner')
    const injectedMessageId = `ai_message_${randomUUID()}`
    connection.sqlite.exec(`
      create trigger inject_newer_ai_message
      after update of next_sequence on ai_conversations
      when new.id = '${changedConversation.id}'
      begin
        insert into ai_messages (id, conversation_id, sequence, role, content, created_at)
        values ('${injectedMessageId}', new.id, new.next_sequence, 'assistant', 'Concurrent mutation.', '${fixedNow.toISOString()}');
      end
    `)
    await expect(
      changed.createMessage('context-race-owner', changedConversation.id, {
        clientRequestId: randomUUID(),
        content: 'Detect the newer message.'
      })
    ).rejects.toMatchObject({ statusCode: 409 })
    connection.sqlite.exec('drop trigger inject_newer_ai_message')

    expect(provider).not.toHaveBeenCalled()
  })

  it('maps every normalized provider failure to safe persisted and replayed behavior', async () => {
    insertUser(connection, 'provider-error-owner', 'provider-error@example.test')
    const cases = [
      ['cancelled', 'cancelled', 'provider_cancelled', 503],
      ['timeout', 'indeterminate', 'provider_timeout', 504],
      ['provider_unavailable', 'indeterminate', 'provider_unavailable', 503],
      ['rate_limited', 'failed', 'provider_rate_limited', 503],
      ['provider_configuration', 'failed', 'provider_configuration', 503],
      ['provider_rejected_request', 'failed', 'provider_rejected_request', 502],
      ['incomplete_response', 'failed', 'provider_incomplete_response', 502],
      ['invalid_response', 'failed', 'provider_invalid_response', 502],
      ['invalid_request', 'failed', 'application_invalid_request', 502]
    ] as const
    const errors = cases.map(
      ([code]) => new OpenAIProviderError(code, { retryable: true, requestId: `request_${code}` })
    )
    errors.push(new Error(rawPromptCanary) as OpenAIProviderError)
    const createResponse = vi.fn<OpenAIResponsesAdapter['createResponse']>()
    for (const error of errors) createResponse.mockRejectedValueOnce(error)
    const capture = vi.fn().mockResolvedValue(undefined)
    const service = makeService({ provider: () => ({ createResponse }), capture })
    const conversation = service.createConversation('provider-error-owner')

    for (const [code, expectedStatus, expectedErrorCode, expectedHttpStatus] of cases) {
      const clientRequestId = randomUUID()
      const content = `Exercise ${code} without exposing provider details.`
      await expect(
        service.createMessage('provider-error-owner', conversation.id, { clientRequestId, content })
      ).rejects.toMatchObject({ statusCode: expectedHttpStatus })
      await expect(
        service.createMessage('provider-error-owner', conversation.id, { clientRequestId, content })
      ).rejects.toMatchObject({ statusCode: expectedHttpStatus })
      expect(
        connection.sqlite
          .prepare(
            `select status, error_code as errorCode, provider_request_id as providerRequestId
             from ai_generation_attempts where client_request_id = ?`
          )
          .get(clientRequestId)
      ).toEqual({
        status: expectedStatus,
        errorCode: expectedErrorCode,
        providerRequestId: `request_${code}`
      })
    }

    const unexpectedClientRequestId = randomUUID()
    await expect(
      service.createMessage('provider-error-owner', conversation.id, {
        clientRequestId: unexpectedClientRequestId,
        content: 'An unexpected private provider error is normalized.'
      })
    ).rejects.toMatchObject({ statusCode: 503 })
    expect(
      connection.sqlite
        .prepare('select status, error_code as errorCode from ai_generation_attempts where client_request_id = ?')
        .get(unexpectedClientRequestId)
    ).toEqual({ status: 'indeterminate', errorCode: 'provider_unavailable' })
    expect(createResponse).toHaveBeenCalledTimes(10)
    expect(capture).toHaveBeenCalledTimes(10)
    expect(JSON.stringify(capture.mock.calls)).not.toContain(rawPromptCanary)
  })

  it('replays pending and refused attempts without dispatching duplicate provider requests', async () => {
    insertUser(connection, 'replay-owner', 'replay-owner@example.test')
    const pendingResponse = deferred<Awaited<ReturnType<OpenAIResponsesAdapter['createResponse']>>>()
    const createResponse = vi
      .fn<OpenAIResponsesAdapter['createResponse']>()
      .mockImplementationOnce(() => pendingResponse.promise)
      .mockResolvedValueOnce({
        kind: 'refusal',
        text: 'A safe refusal.',
        citations: [],
        model: 'gpt-5.6-luna',
        requestId: 'request_replayed_refusal',
        usage: usage()
      })
    const service = makeService({ provider: () => ({ createResponse }) })
    const conversation = service.createConversation('replay-owner')
    const pendingId = randomUUID()
    const controller = new AbortController()
    const pending = service.createMessage(
      'replay-owner',
      conversation.id,
      { clientRequestId: pendingId, content: 'This response remains pending.' },
      controller.signal
    )
    await vi.waitFor(() => expect(createResponse).toHaveBeenCalledOnce())
    expect(createResponse.mock.calls[0]![0]).toMatchObject({ signal: controller.signal })
    await expect(
      service.createMessage('replay-owner', conversation.id, {
        clientRequestId: pendingId,
        content: 'This response remains pending.'
      })
    ).rejects.toMatchObject({ statusCode: 409 })
    await expect(
      service.createMessage('replay-owner', conversation.id, {
        clientRequestId: pendingId,
        content: 'Changed content is also rejected while pending.'
      })
    ).rejects.toMatchObject({ statusCode: 409 })
    pendingResponse.resolve(successfulResult('The pending request completed.'))
    await pending

    const refusedId = randomUUID()
    const refused = await service.createMessage('replay-owner', conversation.id, {
      clientRequestId: refusedId,
      content: 'This request receives a refusal.'
    })
    await expect(
      service.createMessage('replay-owner', conversation.id, {
        clientRequestId: refusedId,
        content: 'This request receives a refusal.'
      })
    ).resolves.toEqual({ ...refused, replayed: true })
    expect(createResponse).toHaveBeenCalledTimes(2)
  })

  it('returns an already-finalized provider race exactly once', async () => {
    insertUser(connection, 'finalize-race-owner', 'finalize-race@example.test')
    let conversationId = ''
    const service = makeService({
      provider: () => ({
        async createResponse(input) {
          const attempt = connection.sqlite
            .prepare('select history_revision as historyRevision from ai_generation_attempts where id = ?')
            .get(input.requestId) as { historyRevision: number }
          finalizeAiGenerationAttempt(connection, 'finalize-race-owner', {
            conversationId,
            attemptId: input.requestId,
            historyRevision: attempt.historyRevision,
            status: 'succeeded',
            assistantContent: 'The competing finalizer committed this answer.',
            now: fixedNow
          })
          return successfulResult('The later provider envelope is ignored.')
        }
      })
    })
    conversationId = service.createConversation('finalize-race-owner').id

    await expect(
      service.createMessage('finalize-race-owner', conversationId, {
        clientRequestId: randomUUID(),
        content: 'Only one finalizer may publish an answer.'
      })
    ).resolves.toMatchObject({
      replayed: true,
      response: { assistantMessage: { content: 'The competing finalizer committed this answer.' } }
    })
    expect(service.listMessages('finalize-race-owner', conversationId).messages).toHaveLength(2)
  })

  it('fails safely when persisted terminal ledger links are internally inconsistent', async () => {
    insertUser(connection, 'corrupt-ledger-owner', 'corrupt-ledger@example.test')
    const service = makeService({ provider: () => successfulProvider() })

    const missingUserConversation = service.createConversation('corrupt-ledger-owner')
    const missingUserRequestId = randomUUID()
    await service.createMessage('corrupt-ledger-owner', missingUserConversation.id, {
      clientRequestId: missingUserRequestId,
      content: 'This completed attempt will lose its user-message link target.'
    })

    const missingLinkConversation = service.createConversation('corrupt-ledger-owner')
    const missingLinkRequestId = randomUUID()
    await service.createMessage('corrupt-ledger-owner', missingLinkConversation.id, {
      clientRequestId: missingLinkRequestId,
      content: 'This completed attempt will lose its assistant-message link.'
    })

    const missingAssistantConversation = service.createConversation('corrupt-ledger-owner')
    const missingAssistantRequestId = randomUUID()
    await service.createMessage('corrupt-ledger-owner', missingAssistantConversation.id, {
      clientRequestId: missingAssistantRequestId,
      content: 'This completed attempt will lose its assistant-message link target.'
    })

    connection.sqlite.pragma('foreign_keys = OFF')
    const missingUserMessageId = connection.sqlite
      .prepare('select user_message_id as id from ai_generation_attempts where client_request_id = ?')
      .get(missingUserRequestId) as { id: string }
    connection.sqlite.prepare('delete from ai_messages where id = ?').run(missingUserMessageId.id)
    await expect(
      service.createMessage('corrupt-ledger-owner', missingUserConversation.id, {
        clientRequestId: missingUserRequestId,
        content: 'This completed attempt will lose its user-message link target.'
      })
    ).rejects.toMatchObject({ statusCode: 404 })

    connection.sqlite.pragma('ignore_check_constraints = ON')
    connection.sqlite
      .prepare('update ai_generation_attempts set assistant_message_id = null where client_request_id = ?')
      .run(missingLinkRequestId)
    await expect(
      service.createMessage('corrupt-ledger-owner', missingLinkConversation.id, {
        clientRequestId: missingLinkRequestId,
        content: 'This completed attempt will lose its assistant-message link.'
      })
    ).rejects.toMatchObject({ statusCode: 503 })

    const missingAssistantMessageId = connection.sqlite
      .prepare('select assistant_message_id as id from ai_generation_attempts where client_request_id = ?')
      .get(missingAssistantRequestId) as { id: string }
    connection.sqlite.prepare('delete from ai_messages where id = ?').run(missingAssistantMessageId.id)
    await expect(
      service.createMessage('corrupt-ledger-owner', missingAssistantConversation.id, {
        clientRequestId: missingAssistantRequestId,
        content: 'This completed attempt will lose its assistant-message link target.'
      })
    ).rejects.toMatchObject({ statusCode: 404 })

    let finalizationConversationId = ''
    const finalizationService = makeService({
      provider: () => ({
        async createResponse(input) {
          const attempt = connection.sqlite
            .prepare(
              `select history_revision as historyRevision, user_message_id as userMessageId
               from ai_generation_attempts where id = ?`
            )
            .get(input.requestId) as { historyRevision: number; userMessageId: string }
          finalizeAiGenerationAttempt(connection, 'corrupt-ledger-owner', {
            conversationId: finalizationConversationId,
            attemptId: input.requestId,
            historyRevision: attempt.historyRevision,
            status: 'succeeded',
            assistantContent: 'The first finalizer committed this answer.',
            now: fixedNow
          })
          connection.sqlite.prepare('delete from ai_messages where id = ?').run(attempt.userMessageId)
          return successfulResult('The second finalizer observes the inconsistent link.')
        }
      })
    })
    finalizationConversationId = finalizationService.createConversation('corrupt-ledger-owner').id
    await expect(
      finalizationService.createMessage('corrupt-ledger-owner', finalizationConversationId, {
        clientRequestId: randomUUID(),
        content: 'A terminal race loses its user-message link target.'
      })
    ).rejects.toMatchObject({ statusCode: 503 })
  })

  it('maps successful and failed finalization races after expiry, clear, and delete', async () => {
    insertUser(connection, 'terminal-race-owner', 'terminal-race@example.test')

    let currentTime = fixedNow
    const expiringSuccess = createAiConversationService({
      connection,
      config: runtimeConfig(),
      provider: () => ({
        async createResponse() {
          currentTime = new Date(fixedNow.getTime() + 91_000)
          return successfulResult('This answer arrived after the lease.')
        }
      }),
      capture: vi.fn().mockResolvedValue(undefined),
      now: () => currentTime
    })
    const expiringConversation = expiringSuccess.createConversation('terminal-race-owner')
    await expect(
      expiringSuccess.createMessage('terminal-race-owner', expiringConversation.id, {
        clientRequestId: randomUUID(),
        content: 'Expire while the successful result is in flight.'
      })
    ).rejects.toMatchObject({ statusCode: 504 })

    const clearingServiceHolder: { current?: ReturnType<typeof createAiConversationService> } = {}
    let clearingConversationId = ''
    const clearingService = makeService({
      provider: () => ({
        async createResponse() {
          clearingServiceHolder.current!.clearConversation('terminal-race-owner', clearingConversationId)
          throw new OpenAIProviderError('provider_unavailable', { retryable: true })
        }
      })
    })
    clearingServiceHolder.current = clearingService
    clearingConversationId = clearingService.createConversation('terminal-race-owner').id
    await expect(
      clearingService.createMessage('terminal-race-owner', clearingConversationId, {
        clientRequestId: randomUUID(),
        content: 'Clear while the provider failure is in flight.'
      })
    ).rejects.toMatchObject({ statusCode: 409 })

    const deletingServiceHolder: { current?: ReturnType<typeof createAiConversationService> } = {}
    let deletingConversationId = ''
    const deletingService = makeService({
      provider: () => ({
        async createResponse() {
          deletingServiceHolder.current!.deleteConversation('terminal-race-owner', deletingConversationId)
          throw new OpenAIProviderError('provider_unavailable', { retryable: true })
        }
      })
    })
    deletingServiceHolder.current = deletingService
    deletingConversationId = deletingService.createConversation('terminal-race-owner').id
    await expect(
      deletingService.createMessage('terminal-race-owner', deletingConversationId, {
        clientRequestId: randomUUID(),
        content: 'Delete while the provider failure is in flight.'
      })
    ).rejects.toMatchObject({ statusCode: 404 })

    currentTime = fixedNow
    const expiringFailure = createAiConversationService({
      connection,
      config: runtimeConfig(),
      provider: () => ({
        async createResponse() {
          currentTime = new Date(fixedNow.getTime() + 91_000)
          throw new OpenAIProviderError('provider_unavailable', { retryable: true })
        }
      }),
      capture: vi.fn().mockResolvedValue(undefined),
      now: () => currentTime
    })
    const failureConversation = expiringFailure.createConversation('terminal-race-owner')
    await expect(
      expiringFailure.createMessage('terminal-race-owner', failureConversation.id, {
        clientRequestId: randomUUID(),
        content: 'Expire while the provider failure is in flight.'
      })
    ).rejects.toMatchObject({ statusCode: 504 })
  })

  it('rejects every production entry before runtime, database, quota, or provider access', async () => {
    const session = { user: { id: 'production-owner' } } as AppSession
    const conversationId = `ai_conversation_${randomUUID()}`

    for (const entry of [
      () => createOwnedAiConversation(session),
      () => listOwnedAiConversations(session),
      () => getOwnedAiConversation(session, conversationId),
      () => deleteOwnedAiConversation(session, conversationId),
      () => clearOwnedAiConversation(session, conversationId),
      () => listOwnedAiMessages(session, conversationId)
    ]) {
      expect(entry).toThrow(expect.objectContaining({ statusCode: 404, statusMessage: 'Not Found' }))
    }

    await expect(
      createOwnedAiMessage(session, conversationId, {
        clientRequestId: randomUUID(),
        content: 'The disabled production boundary must not dispatch.'
      })
    ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'Not Found' })

    expect(productionMocks.getAppRuntimeConfig).not.toHaveBeenCalled()
    expect(productionMocks.useDatabase).not.toHaveBeenCalled()
    expect(productionMocks.getOpenAIResponsesAdapter).not.toHaveBeenCalled()
    expect(
      (connection.sqlite.prepare('select count(*) as count from ai_usage_buckets').get() as { count: number }).count
    ).toBe(0)
  })
})

function makeService(
  overrides: Partial<AiConversationServiceDependencies> & Pick<AiConversationServiceDependencies, 'provider'>
) {
  return createAiConversationService({
    connection,
    config: runtimeConfig(),
    capture: vi.fn().mockResolvedValue(undefined),
    now: () => fixedNow,
    ...overrides
  })
}

function runtimeConfig() {
  return {
    betterAuth: { secret: 'test-better-auth-secret-at-least-32-characters' },
    openai: {
      apiKey: 'test-openai-api-key',
      projectId: 'test-openai-project',
      model: 'gpt-5.6-luna',
      fileSearch: { vectorStoreId: 'vs_test_deployment_corpus' },
      webSearch: { allowedDomains: ['example.test'] }
    }
  } as unknown as AppRuntimeConfig
}

function successfulProvider(): OpenAIResponsesAdapter {
  return {
    async createResponse() {
      return successfulResult('A successful fake response.')
    }
  }
}

function successfulResult(text: string) {
  return {
    kind: 'text' as const,
    text,
    citations: [],
    model: 'gpt-5.6-luna',
    requestId: 'request_success',
    usage: usage()
  }
}

function neverProvider(): OpenAIResponsesAdapter {
  return {
    async createResponse() {
      throw new Error('Provider must not be called')
    }
  }
}

function usage() {
  return {
    inputTokens: 20,
    outputTokens: 7,
    totalTokens: 27,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    reasoningTokens: 2
  }
}

function insertUser(target: DatabaseConnection, id: string, email: string) {
  target.sqlite
    .prepare('insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)')
    .run(id, id, email, fixedNow.getTime(), fixedNow.getTime())
}

function seedTranscript(target: DatabaseConnection, conversationId: string, count: number) {
  const insert = target.sqlite.prepare(
    `insert into ai_messages (id, conversation_id, sequence, role, content, created_at)
     values (?, ?, ?, ?, ?, ?)`
  )
  target.sqlite.transaction(() => {
    for (let sequence = 1; sequence <= count; sequence += 1) {
      insert.run(
        `ai_message_${randomUUID()}`,
        conversationId,
        sequence,
        sequence % 2 === 1 ? 'user' : 'assistant',
        `Historical message ${sequence}`,
        new Date(fixedNow.getTime() + sequence).toISOString()
      )
    }
    target.sqlite
      .prepare('update ai_conversations set next_sequence = ?, updated_at = ? where id = ?')
      .run(count + 1, new Date(fixedNow.getTime() + count).toISOString(), conversationId)
  })()
}

function seedMessages(
  target: DatabaseConnection,
  conversationId: string,
  messages: ReadonlyArray<Readonly<{ role: 'user' | 'assistant'; content: string }>>
) {
  const insert = target.sqlite.prepare(
    `insert into ai_messages (id, conversation_id, sequence, role, content, created_at)
     values (?, ?, ?, ?, ?, ?)`
  )
  target.sqlite.transaction(() => {
    for (const [index, message] of messages.entries()) {
      const sequence = index + 1
      insert.run(
        `ai_message_${randomUUID()}`,
        conversationId,
        sequence,
        message.role,
        message.content,
        new Date(fixedNow.getTime() + sequence).toISOString()
      )
    }
    target.sqlite
      .prepare('update ai_conversations set next_sequence = ?, updated_at = ? where id = ?')
      .run(messages.length + 1, new Date(fixedNow.getTime() + messages.length).toISOString(), conversationId)
  })()
}

function conversationState(target: DatabaseConnection, ownerUserId: string, conversationId: string) {
  return target.sqlite
    .prepare(
      `select next_sequence as nextSequence, updated_at as updatedAt,
              (select count(*) from ai_messages where conversation_id = ai_conversations.id) as messages,
              (select count(*) from ai_generation_attempts where conversation_id = ai_conversations.id) as attempts,
              (select count(*) from ai_generation_leases where owner_user_id = ?) as leases,
              coalesce((select sum(request_count) from ai_usage_buckets where owner_user_id = ?), 0) as requestCount
       from ai_conversations where id = ?`
    )
    .get(ownerUserId, ownerUserId, conversationId) as {
    messages: number
    attempts: number
    leases: number
    requestCount: number
    nextSequence: number
    updatedAt: string
  }
}

function encodedCursor(value: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
