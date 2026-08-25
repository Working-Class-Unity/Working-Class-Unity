import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { DatabaseConnection } from '../server/db/connect'
import {
  AiConversationLimitReachedError,
  clearAiConversationForOwner,
  createAiConversation,
  deleteAiConversationForOwner,
  finalizeAiGenerationAttempt,
  getAiConversationForOwner,
  getAiGenerationAttemptForOwner,
  getAiMessageForOwner,
  getAiUsageBucketForOwner,
  listAiMessageContentsForOwner,
  listAiConversationsForOwner,
  listRecentAiMessageMetadataForOwner,
  listAiMessagesForOwner,
  reapAndGetAiGenerationAttemptForOwner,
  reserveAiGenerationAttempt
} from '../server/db/repositories/ai-conversations'
import * as schema from '../server/db/schema'

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
const ownerId = 'ai-repository-owner'
const foreignOwnerId = 'ai-repository-foreign'
const bucketDate = '2026-07-16'

describe('AI conversation repository', () => {
  it('owns immutable conversation history and replays one client request without duplicate usage', () => {
    withDatabase('history', ({ connection, sqlite }) => {
      insertUser(sqlite, ownerId)
      insertUser(sqlite, foreignOwnerId)
      let authorizationChecks = 0
      const conversation = createAiConversation(connection, ownerId, {
        maximumCount: 2,
        now: atMinute(0),
        authorize: (current) => {
          authorizationChecks += 1
          expect(current.sqlite.prepare('select id from user where id = ?').get(ownerId)).toEqual({ id: ownerId })
        }
      })

      expect(authorizationChecks).toBe(1)
      expect(conversation).toMatchObject({
        id: expect.stringMatching(/^ai_conversation_[0-9a-f-]{36}$/),
        historyRevision: 0,
        nextSequence: 1
      })
      expect(getAiConversationForOwner(connection, foreignOwnerId, conversation.id)).toBeNull()
      expect(listAiConversationsForOwner(connection, foreignOwnerId).conversations).toEqual([])

      const reserved = reserveAiGenerationAttempt(connection, ownerId, {
        conversationId: conversation.id,
        clientRequestId: '11111111-1111-4111-8111-111111111111',
        content: 'Private question',
        model: 'gpt-5.6-luna',
        usageBucketDate: bucketDate,
        leaseExpiresAt: atMinute(2),
        maximumRequestsPerBucket: 10,
        maximumConcurrentAttempts: 1,
        authorize: persistedAuthorization(ownerId),
        now: atMinute(1)
      })
      expect(reserved.kind).toBe('reserved')
      if (reserved.kind !== 'reserved') throw new Error('Expected a reserved attempt')
      expect(reserved.userMessage).toMatchObject({ sequence: 1, role: 'user', content: 'Private question' })
      expect(reserved.attempt).toMatchObject({
        id: expect.stringMatching(/^ai_attempt_[0-9a-f-]{36}$/),
        historyRevision: 0,
        status: 'pending',
        providerRequestId: null
      })
      expect(reserved.usage).toMatchObject({ requestCount: 1, inputTokens: 0, outputTokens: 0 })

      const replay = reserveAiGenerationAttempt(connection, ownerId, {
        conversationId: conversation.id,
        clientRequestId: '11111111-1111-4111-8111-111111111111',
        content: 'A different retry body is ignored',
        model: 'gpt-5.6-luna',
        usageBucketDate: bucketDate,
        leaseExpiresAt: atMinute(2),
        maximumRequestsPerBucket: 10,
        maximumConcurrentAttempts: 1,
        authorize: () => {
          throw new Error('entitlement-revoked-after-reservation')
        },
        now: atMinute(1)
      })
      expect(replay).toMatchObject({
        kind: 'existing',
        userMessage: { id: reserved.userMessage.id, content: 'Private question' },
        attempt: { id: reserved.attempt.id }
      })
      expect(getAiUsageBucketForOwner(connection, ownerId, bucketDate)?.requestCount).toBe(1)

      const finalized = finalizeAiGenerationAttempt(connection, ownerId, {
        conversationId: conversation.id,
        attemptId: reserved.attempt.id,
        historyRevision: reserved.attempt.historyRevision,
        status: 'succeeded',
        assistantContent: 'Private answer',
        citations: [
          { type: 'file', title: 'Guide One.pdf' },
          { type: 'file', title: 'Guide Two.md' }
        ],
        providerRequestId: 'req_safe_123',
        inputTokens: 12,
        outputTokens: 7,
        reasoningTokens: 3,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        now: atMinute(1, 30)
      })
      expect(finalized).toMatchObject({
        kind: 'finalized',
        assistantMessage: {
          sequence: 2,
          role: 'assistant',
          content: 'Private answer',
          citations: [
            { type: 'file', title: 'Guide One.pdf' },
            { type: 'file', title: 'Guide Two.md' }
          ]
        },
        attempt: {
          status: 'succeeded',
          providerRequestId: 'req_safe_123',
          inputTokens: 12,
          outputTokens: 7,
          reasoningTokens: 3,
          cachedInputTokens: 0,
          cacheWriteTokens: 0
        }
      })
      if (finalized.kind !== 'finalized' || !finalized.assistantMessage) {
        throw new Error('Expected a finalized cited assistant message')
      }

      const repeatedFinalization = finalizeAiGenerationAttempt(connection, ownerId, {
        conversationId: conversation.id,
        attemptId: reserved.attempt.id,
        historyRevision: 0,
        status: 'succeeded',
        assistantContent: 'Must not replace the stored answer',
        inputTokens: 999,
        outputTokens: 999,
        now: atMinute(1, 45)
      })
      expect(repeatedFinalization).toMatchObject({
        kind: 'existing',
        assistantMessage: {
          content: 'Private answer',
          citations: [
            { type: 'file', title: 'Guide One.pdf' },
            { type: 'file', title: 'Guide Two.md' }
          ]
        }
      })
      expect(getAiUsageBucketForOwner(connection, ownerId, bucketDate)).toMatchObject({
        requestCount: 1,
        inputTokens: 12,
        outputTokens: 7,
        reasoningTokens: 3,
        cachedInputTokens: 0,
        cacheWriteTokens: 0
      })
      expect(listAiMessagesForOwner(connection, ownerId, conversation.id)).toMatchObject({
        messages: [
          { sequence: 1, role: 'user', content: 'Private question', citations: [] },
          {
            sequence: 2,
            role: 'assistant',
            content: 'Private answer',
            citations: [
              { type: 'file', title: 'Guide One.pdf' },
              { type: 'file', title: 'Guide Two.md' }
            ]
          }
        ],
        nextCursor: null
      })
      expect(getAiMessageForOwner(connection, ownerId, conversation.id, finalized.assistantMessage.id)).toMatchObject({
        content: 'Private answer',
        citations: [
          { type: 'file', title: 'Guide One.pdf' },
          { type: 'file', title: 'Guide Two.md' }
        ]
      })
      expect(
        getAiMessageForOwner(connection, foreignOwnerId, conversation.id, finalized.assistantMessage.id)
      ).toBeNull()
      expect(listAiMessagesForOwner(connection, foreignOwnerId, conversation.id)).toBeNull()
      expect(
        getAiGenerationAttemptForOwner(connection, foreignOwnerId, conversation.id, reserved.attempt.clientRequestId)
      ).toBeNull()
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
    })
  })

  it('atomically persists, hydrates, paginates, and replays inline Web citations', () => {
    withDatabase('web-citations', ({ connection, sqlite }) => {
      insertUser(sqlite, ownerId)
      const conversation = createAiConversation(connection, ownerId, {
        maximumCount: 10,
        authorize: persistedAuthorization(ownerId),
        now: atMinute(0)
      })
      const reserved = reserveAiGenerationAttempt(connection, ownerId, {
        ...reservation(conversation.id, '11999999-9999-4999-8999-999999999999'),
        leaseExpiresAt: atMinute(3),
        now: atMinute(1)
      })
      if (reserved.kind !== 'reserved') throw new Error('Expected a Web citation reservation')
      const citations = [
        {
          type: 'web' as const,
          title: 'Primary guide',
          url: 'https://docs.example.test/guides/primary',
          startIndex: 0,
          endIndex: 7
        },
        {
          type: 'web' as const,
          title: 'Primary guide',
          url: 'https://docs.example.test/guides/primary',
          startIndex: 12,
          endIndex: 19
        }
      ]

      expect(
        finalizeAiGenerationAttempt(connection, ownerId, {
          conversationId: conversation.id,
          attemptId: reserved.attempt.id,
          historyRevision: 0,
          status: 'succeeded',
          assistantContent: 'Grounded answer with inline citations.',
          citations,
          now: atMinute(2)
        })
      ).toMatchObject({ kind: 'finalized', assistantMessage: { citations } })
      expect(count(sqlite, 'ai_message_file_citations')).toBe(0)
      expect(count(sqlite, 'ai_message_web_citations')).toBe(2)
      expect(listAiMessagesForOwner(connection, ownerId, conversation.id, { limit: 1 })).toMatchObject({
        messages: [{ sequence: 1, citations: [] }],
        nextCursor: { sequence: 1, id: reserved.userMessage.id }
      })
      expect(
        reserveAiGenerationAttempt(connection, ownerId, {
          ...reservation(conversation.id, reserved.attempt.clientRequestId),
          content: 'Ignored retry body',
          leaseExpiresAt: atMinute(4),
          now: atMinute(2, 30)
        })
      ).toMatchObject({ kind: 'existing', assistantMessage: { citations } })
      expect(clearAiConversationForOwner(connection, ownerId, conversation.id, atMinute(3))).toMatchObject({
        historyRevision: 1,
        nextSequence: 1
      })
      expect(count(sqlite, 'ai_message_web_citations')).toBe(0)
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
    })
  })

  it('reads at most 256 UTF-8 metadata rows before loading only selected citation-free content', () => {
    const queries: string[] = []
    withDatabase(
      'provider-context',
      ({ connection, sqlite }) => {
        insertUser(sqlite, ownerId)
        const conversation = createAiConversation(connection, ownerId, {
          maximumCount: 10,
          authorize: persistedAuthorization(ownerId),
          now: atMinute(0)
        })
        const maximumSizeContent = '🙂'.repeat(250_000)
        expect(Buffer.byteLength(maximumSizeContent, 'utf8')).toBe(1_000_000)
        const messageIds = insertRawMessages(
          sqlite,
          conversation.id,
          1,
          257,
          (sequence) => (sequence === 2 ? maximumSizeContent : sequence === 257 ? '🙂é' : `m${sequence}`),
          (sequence) => (sequence === 255 ? 'user' : sequence % 2 === 1 ? 'user' : 'assistant')
        )
        sqlite.transaction(() => {
          for (const [messageId, title] of [
            [messageIds.get(255)!, 'selected-user-canary.pdf'],
            [messageIds.get(1)!, 'excluded-user-canary.pdf']
          ]) {
            sqlite
              .prepare('insert into ai_message_file_citations (message_id, ordinal, title) values (?, 1, ?)')
              .run(messageId, title)
          }
        })()

        expect(() => getAiMessageForOwner(connection, ownerId, conversation.id, messageIds.get(255)!)).toThrow(
          'AI citation referred to a non-assistant message'
        )
        queries.length = 0

        const metadata = listRecentAiMessageMetadataForOwner(connection, ownerId, conversation.id)
        expect(metadata).toHaveLength(256)
        expect(metadata?.[0]).toMatchObject({ sequence: 257, role: 'user', contentBytes: 6 })
        expect(metadata?.at(-1)).toMatchObject({ sequence: 2, contentBytes: 1_000_000 })
        expect(metadata?.some(({ sequence }) => sequence === 1)).toBe(false)
        expect(Object.keys(metadata![0]!).sort()).toEqual(['contentBytes', 'createdAt', 'id', 'role', 'sequence'])

        const contents = listAiMessageContentsForOwner(connection, ownerId, conversation.id, [
          messageIds.get(255)!,
          messageIds.get(257)!
        ])
        expect(contents).toEqual([
          { role: 'user', content: 'm255' },
          { role: 'user', content: '🙂é' }
        ])

        const metadataQuery = queries.find((query) => query.includes('octet_length(content)'))
        const contentQuery = queries.find((query) => /select\s+role,\s*content\s+from ai_messages/i.test(query))
        expect(metadataQuery).toMatch(/order by sequence desc\s+limit 256/i)
        expect(metadataQuery).not.toMatch(/select\s+[^]*\bcontent\s*(?:,|from)/i)
        expect(contentQuery).toMatch(/where conversation_id = .* and id in \(/i)
        expect(contentQuery).toMatch(/order by sequence asc/i)
        expect(queries.join('\n')).not.toMatch(/ai_message_(?:file|web)_citations/)
      },
      {
        verbose(message) {
          if (typeof message === 'string') queries.push(message)
        }
      }
    )
  })

  it('fails closed while hydrating corrupt persisted Web citation fields', () => {
    const corruptions = [
      { name: 'blank-title', title: '', url: 'https://example.test/source', startIndex: 0, endIndex: 8 },
      { name: 'padded-title', title: ' padded ', url: 'https://example.test/source', startIndex: 0, endIndex: 8 },
      {
        name: 'control-title',
        title: 'unsafe\u202etitle',
        url: 'https://example.test/source',
        startIndex: 0,
        endIndex: 8
      },
      {
        name: 'oversized-title',
        title: 'x'.repeat(513),
        url: 'https://example.test/source',
        startIndex: 0,
        endIndex: 8
      },
      { name: 'non-https-url', title: 'Source', url: 'http://example.test/source', startIndex: 0, endIndex: 8 },
      {
        name: 'credential-url',
        title: 'Source',
        url: 'https://user:secret@example.test/source',
        startIndex: 0,
        endIndex: 8
      },
      {
        name: 'port-url',
        title: 'Source',
        url: 'https://example.test:8443/source',
        startIndex: 0,
        endIndex: 8
      },
      {
        name: 'noncanonical-url',
        title: 'Source',
        url: 'https://EXAMPLE.test/source',
        startIndex: 0,
        endIndex: 8
      },
      {
        name: 'fractional-span',
        title: 'Source',
        url: 'https://example.test/source',
        startIndex: 0.5,
        endIndex: 8
      },
      {
        name: 'reversed-span',
        title: 'Source',
        url: 'https://example.test/source',
        startIndex: 8,
        endIndex: 8
      },
      {
        name: 'span-beyond-message',
        title: 'Source',
        url: 'https://example.test/source',
        startIndex: 0,
        endIndex: 17
      }
    ] as const

    for (const corruption of corruptions) {
      withDatabase(`corrupt-web-citation-${corruption.name}`, ({ connection, sqlite }) => {
        insertUser(sqlite, ownerId)
        const completed = seedCompletedAiMessages(connection)
        sqlite.pragma('ignore_check_constraints = ON')
        sqlite
          .prepare(
            `insert into ai_message_web_citations (
               message_id, ordinal, title, url, start_index, end_index
             ) values (?, 1, ?, ?, ?, ?)`
          )
          .run(
            completed.assistantMessageId,
            corruption.title,
            corruption.url,
            corruption.startIndex,
            corruption.endIndex
          )

        expect(() =>
          getAiMessageForOwner(connection, ownerId, completed.conversationId, completed.assistantMessageId)
        ).toThrow(RangeError)
      })
    }
  })

  it('rejects persisted citations attached to a non-assistant message', () => {
    withDatabase('corrupt-web-citation-role', ({ connection, sqlite }) => {
      insertUser(sqlite, ownerId)
      const completed = seedCompletedAiMessages(connection)
      sqlite
        .prepare(
          `insert into ai_message_web_citations (
             message_id, ordinal, title, url, start_index, end_index
           ) values (?, 1, 'Source', 'https://example.test/source', 0, 8)`
        )
        .run(completed.userMessageId)

      expect(() => listAiMessagesForOwner(connection, ownerId, completed.conversationId)).toThrow(
        'AI citation referred to a non-assistant message'
      )
    })
  })

  it('rejects a persisted File citation attached to a non-assistant message', () => {
    withDatabase('corrupt-file-citation-role', ({ connection, sqlite }) => {
      insertUser(sqlite, ownerId)
      const completed = seedCompletedAiMessages(connection)
      sqlite
        .prepare('insert into ai_message_file_citations (message_id, ordinal, title) values (?, 1, ?)')
        .run(completed.userMessageId, 'Invalid user source.pdf')

      expect(() => listAiMessagesForOwner(connection, ownerId, completed.conversationId)).toThrow(
        'AI citation referred to a non-assistant message'
      )
    })
  })

  it('rejects one persisted Web URL with conflicting titles', () => {
    withDatabase('corrupt-web-citation-title-conflict', ({ connection, sqlite }) => {
      insertUser(sqlite, ownerId)
      const completed = seedCompletedAiMessages(connection)
      const insert = sqlite.prepare(
        `insert into ai_message_web_citations (
           message_id, ordinal, title, url, start_index, end_index
         ) values (?, ?, ?, 'https://example.test/source', ?, ?)`
      )
      insert.run(completed.assistantMessageId, 1, 'First title', 0, 4)
      insert.run(completed.assistantMessageId, 2, 'Conflicting title', 4, 8)

      expect(() =>
        getAiMessageForOwner(connection, ownerId, completed.conversationId, completed.assistantMessageId)
      ).toThrow('AI web citation URLs must use one consistent title within a message')
    })
  })

  it('continues rejecting persisted mixed File and Web citation types', () => {
    withDatabase('corrupt-mixed-citation-types', ({ connection, sqlite }) => {
      insertUser(sqlite, ownerId)
      const completed = seedCompletedAiMessages(connection)
      sqlite
        .prepare('insert into ai_message_file_citations (message_id, ordinal, title) values (?, 1, ?)')
        .run(completed.assistantMessageId, 'File source.pdf')
      sqlite
        .prepare(
          `insert into ai_message_web_citations (
             message_id, ordinal, title, url, start_index, end_index
           ) values (?, 1, 'Web source', 'https://example.test/source', 0, 8)`
        )
        .run(completed.assistantMessageId)

      expect(() =>
        getAiMessageForOwner(connection, ownerId, completed.conversationId, completed.assistantMessageId)
      ).toThrow('AI message unexpectedly contained multiple citation types')
    })
  })

  it('cascades cited assistant sources through clear and conversation deletion', () => {
    withDatabase('citation-lifecycle', ({ connection, sqlite }) => {
      insertUser(sqlite, ownerId)
      const conversation = createAiConversation(connection, ownerId, {
        maximumCount: 10,
        authorize: persistedAuthorization(ownerId),
        now: atMinute(0)
      })

      for (const [index, requestId] of [
        '12111111-1111-4111-8111-111111111111',
        '12222222-2222-4222-8222-222222222222'
      ].entries()) {
        const reserved = reserveAiGenerationAttempt(connection, ownerId, {
          ...reservation(conversation.id, requestId),
          leaseExpiresAt: atMinute(3 + index * 2),
          now: atMinute(1 + index * 2)
        })
        if (reserved.kind !== 'reserved') throw new Error('Expected a citation lifecycle reservation')
        expect(
          finalizeAiGenerationAttempt(connection, ownerId, {
            conversationId: conversation.id,
            attemptId: reserved.attempt.id,
            historyRevision: reserved.attempt.historyRevision,
            status: 'succeeded',
            assistantContent: `Cited answer ${index + 1}`,
            citations: [{ type: 'file', title: `Source ${index + 1}.pdf` }],
            now: atMinute(2 + index * 2)
          })
        ).toMatchObject({
          kind: 'finalized',
          assistantMessage: { citations: [{ type: 'file', title: `Source ${index + 1}.pdf` }] }
        })
        expect(count(sqlite, 'ai_message_file_citations')).toBe(1)

        if (index === 0) {
          expect(clearAiConversationForOwner(connection, ownerId, conversation.id, atMinute(2, 30))).toMatchObject({
            historyRevision: 1,
            nextSequence: 1
          })
          expect(count(sqlite, 'ai_message_file_citations')).toBe(0)
        }
      }

      expect(deleteAiConversationForOwner(connection, foreignOwnerId, conversation.id)).toBe(false)
      expect(count(sqlite, 'ai_message_file_citations')).toBe(1)
      expect(deleteAiConversationForOwner(connection, ownerId, conversation.id)).toBe(true)
      expect(count(sqlite, 'ai_message_file_citations')).toBe(0)
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
    })
  })

  it('serializes persisted authorization, concurrency, lease expiry, and daily quota decisions', () => {
    withDatabase('limits', ({ connection, sqlite }) => {
      insertUser(sqlite, ownerId)
      const first = createAiConversation(connection, ownerId, {
        maximumCount: 2,
        authorize: persistedAuthorization(ownerId),
        now: atMinute(0)
      })
      const second = createAiConversation(connection, ownerId, {
        maximumCount: 2,
        authorize: persistedAuthorization(ownerId),
        now: atMinute(1)
      })
      expect(() =>
        createAiConversation(connection, ownerId, {
          maximumCount: 2,
          authorize: persistedAuthorization(ownerId),
          now: atMinute(2)
        })
      ).toThrow(AiConversationLimitReachedError)
      expect(() =>
        createAiConversation(connection, ownerId, {
          maximumCount: 3,
          authorize: () => {
            throw new Error('entitlement-revoked')
          },
          now: atMinute(2)
        })
      ).toThrow('entitlement-revoked')
      expect(listAiConversationsForOwner(connection, ownerId).conversations).toHaveLength(2)

      const pending = reserveAiGenerationAttempt(connection, ownerId, {
        ...reservation(first.id, '22222222-2222-4222-8222-222222222222'),
        leaseExpiresAt: atMinute(3),
        now: atMinute(2)
      })
      expect(pending.kind).toBe('reserved')
      const blocked = reserveAiGenerationAttempt(connection, ownerId, {
        ...reservation(second.id, '33333333-3333-4333-8333-333333333333'),
        leaseExpiresAt: atMinute(4),
        now: atMinute(2, 30)
      })
      expect(blocked).toEqual({ kind: 'concurrency-exceeded' })
      expect(getAiUsageBucketForOwner(connection, ownerId, bucketDate)?.requestCount).toBe(1)

      expect(
        reapAndGetAiGenerationAttemptForOwner(
          connection,
          ownerId,
          first.id,
          '22222222-2222-4222-8222-222222222222',
          atMinute(4)
        )
      ).toMatchObject({
        status: 'indeterminate',
        errorCode: 'attempt_lease_expired',
        leaseExpiresAt: null
      })
      expect(generationLease(sqlite, ownerId)).toBeNull()

      expect(() =>
        reserveAiGenerationAttempt(connection, ownerId, {
          ...reservation(second.id, '44444444-4444-4444-8444-444444444444'),
          authorize: () => {
            throw new Error('persisted-entitlement-lost')
          },
          leaseExpiresAt: atMinute(5),
          now: atMinute(4)
        })
      ).toThrow('persisted-entitlement-lost')
      expect(listAiMessagesForOwner(connection, ownerId, second.id)?.messages).toEqual([])

      const afterExpiry = reserveAiGenerationAttempt(connection, ownerId, {
        ...reservation(second.id, '55555555-5555-4555-8555-555555555555'),
        maximumRequestsPerBucket: 2,
        leaseExpiresAt: atMinute(6),
        now: atMinute(4)
      })
      expect(afterExpiry.kind).toBe('reserved')
      if (afterExpiry.kind !== 'reserved') throw new Error('Expected a reservation after lease expiry')
      expect(
        getAiGenerationAttemptForOwner(connection, ownerId, first.id, '22222222-2222-4222-8222-222222222222')
      ).toMatchObject({ status: 'indeterminate', errorCode: 'attempt_lease_expired', leaseExpiresAt: null })
      expect(getAiUsageBucketForOwner(connection, ownerId, bucketDate)?.requestCount).toBe(2)
      expect(
        finalizeAiGenerationAttempt(connection, ownerId, {
          conversationId: second.id,
          attemptId: afterExpiry.attempt.id,
          historyRevision: afterExpiry.attempt.historyRevision,
          status: 'failed',
          errorCode: 'provider_timeout',
          now: atMinute(6)
        })
      ).toEqual({ kind: 'expired' })
      expect(generationLease(sqlite, ownerId)).toBeNull()

      const quota = reserveAiGenerationAttempt(connection, ownerId, {
        ...reservation(first.id, '66666666-6666-4666-8666-666666666666'),
        maximumRequestsPerBucket: 2,
        leaseExpiresAt: atMinute(7),
        now: atMinute(6)
      })
      expect(quota).toMatchObject({ kind: 'quota-exceeded', usage: { requestCount: 2 } })
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
    })
  })

  it('reserves one complete retained turn before rejecting growth without writes', () => {
    const queries: string[] = []
    withDatabase(
      'retained-history-limits',
      ({ connection, sqlite }) => {
        insertUser(sqlite, ownerId)
        const conversation = createAiConversation(connection, ownerId, {
          maximumCount: 10,
          authorize: persistedAuthorization(ownerId),
          now: atMinute(0)
        })
        insertRawMessages(sqlite, conversation.id, 1, 254)

        const reserved = reserveAiGenerationAttempt(connection, ownerId, {
          ...reservation(conversation.id, '18888888-8888-4888-8888-888888888888'),
          content: 'é',
          leaseExpiresAt: atMinute(3),
          now: atMinute(1)
        })
        expect(reserved).toMatchObject({ kind: 'reserved', userMessage: { sequence: 255 } })
        if (reserved.kind !== 'reserved') throw new Error('Expected the final complete turn to be reserved')

        const exactMaximumAssistant = '🙂'.repeat(16_000)
        expect(Buffer.byteLength(exactMaximumAssistant, 'utf8')).toBe(64_000)
        expect(
          finalizeAiGenerationAttempt(connection, ownerId, {
            conversationId: conversation.id,
            attemptId: reserved.attempt.id,
            historyRevision: reserved.attempt.historyRevision,
            status: 'succeeded',
            assistantContent: exactMaximumAssistant,
            now: atMinute(2)
          })
        ).toMatchObject({ kind: 'finalized', assistantMessage: { sequence: 256 } })
        expect(count(sqlite, 'ai_messages')).toBe(256)

        const beforeRejectedReservation = {
          messages: count(sqlite, 'ai_messages'),
          attempts: count(sqlite, 'ai_generation_attempts'),
          leases: count(sqlite, 'ai_generation_leases'),
          usage: getAiUsageBucketForOwner(connection, ownerId, bucketDate),
          conversation: getAiConversationForOwner(connection, ownerId, conversation.id)
        }
        expect(
          reserveAiGenerationAttempt(connection, ownerId, {
            ...reservation(conversation.id, '18888888-8888-4888-8888-888888888889'),
            leaseExpiresAt: atMinute(5),
            now: atMinute(4)
          })
        ).toEqual({ kind: 'history-limit-exceeded' })
        expect({
          messages: count(sqlite, 'ai_messages'),
          attempts: count(sqlite, 'ai_generation_attempts'),
          leases: count(sqlite, 'ai_generation_leases'),
          usage: getAiUsageBucketForOwner(connection, ownerId, bucketDate),
          conversation: getAiConversationForOwner(connection, ownerId, conversation.id)
        }).toEqual(beforeRejectedReservation)
        expect(queries.find((query) => query.includes('sum(contentBytes)'))).toMatch(
          /from \(\s*select octet_length\(content\) as contentBytes\s+from ai_messages\s+where conversation_id = .*\s+order by sequence desc\s+limit 257\s*\)/i
        )
      },
      {
        verbose(message) {
          if (typeof message === 'string') queries.push(message)
        }
      }
    )
  })

  it('uses history revisions to discard late results while retaining minimized usage across clear and delete', () => {
    withDatabase('lifecycle', ({ connection, sqlite }) => {
      insertUser(sqlite, ownerId)
      const conversation = createAiConversation(connection, ownerId, {
        maximumCount: 10,
        authorize: persistedAuthorization(ownerId),
        now: atMinute(0)
      })
      const otherConversation = createAiConversation(connection, ownerId, {
        maximumCount: 10,
        authorize: persistedAuthorization(ownerId),
        now: atMinute(0, 30)
      })
      const reserved = reserveAiGenerationAttempt(connection, ownerId, {
        ...reservation(conversation.id, '77777777-7777-4777-8777-777777777777'),
        leaseExpiresAt: atMinute(5),
        now: atMinute(1)
      })
      if (reserved.kind !== 'reserved') throw new Error('Expected a reserved attempt')

      const cleared = clearAiConversationForOwner(connection, ownerId, conversation.id, atMinute(2))
      expect(cleared).toMatchObject({ historyRevision: 1, nextSequence: 1 })
      expect(listAiMessagesForOwner(connection, ownerId, conversation.id)?.messages).toEqual([])
      expect(
        getAiGenerationAttemptForOwner(connection, ownerId, conversation.id, reserved.attempt.clientRequestId)
      ).toBeNull()
      expect(generationLease(sqlite, ownerId)).toMatchObject({ attemptId: reserved.attempt.id })
      expect(getAiUsageBucketForOwner(connection, ownerId, bucketDate)?.requestCount).toBe(1)

      expect(
        reserveAiGenerationAttempt(connection, ownerId, {
          ...reservation(otherConversation.id, '99999999-9999-4999-8999-999999999991'),
          leaseExpiresAt: atMinute(6),
          now: atMinute(2, 30)
        })
      ).toEqual({ kind: 'concurrency-exceeded' })

      expect(
        finalizeAiGenerationAttempt(connection, ownerId, {
          conversationId: conversation.id,
          attemptId: reserved.attempt.id,
          historyRevision: reserved.attempt.historyRevision,
          status: 'succeeded',
          assistantContent: 'Late result must disappear',
          now: atMinute(3)
        })
      ).toEqual({ kind: 'stale' })
      expect(generationLease(sqlite, ownerId)).toBeNull()

      const afterClear = reserveAiGenerationAttempt(connection, ownerId, {
        ...reservation(conversation.id, reserved.attempt.clientRequestId),
        leaseExpiresAt: atMinute(6),
        now: atMinute(3)
      })
      if (afterClear.kind !== 'reserved') throw new Error('Expected a reservation after stale finalization')
      expect(afterClear).toMatchObject({
        kind: 'reserved',
        conversation: { historyRevision: 1, nextSequence: 2 },
        userMessage: { sequence: 1 }
      })
      expect(getAiUsageBucketForOwner(connection, ownerId, bucketDate)?.requestCount).toBe(2)

      expect(deleteAiConversationForOwner(connection, foreignOwnerId, conversation.id)).toBe(false)
      expect(deleteAiConversationForOwner(connection, ownerId, conversation.id)).toBe(true)
      expect(getAiConversationForOwner(connection, ownerId, conversation.id)).toBeNull()
      expect(generationLease(sqlite, ownerId)).toMatchObject({ attemptId: afterClear.attempt.id })
      expect(
        reserveAiGenerationAttempt(connection, ownerId, {
          ...reservation(otherConversation.id, '99999999-9999-4999-8999-999999999992'),
          leaseExpiresAt: atMinute(7),
          now: atMinute(4)
        })
      ).toEqual({ kind: 'concurrency-exceeded' })

      expect(
        finalizeAiGenerationAttempt(connection, ownerId, {
          conversationId: conversation.id,
          attemptId: afterClear.attempt.id,
          historyRevision: afterClear.attempt.historyRevision,
          status: 'failed',
          errorCode: 'late_after_delete',
          now: atMinute(4, 10)
        })
      ).toEqual({ kind: 'not-found' })
      expect(generationLease(sqlite, ownerId)).toBeNull()

      const afterDelete = reserveAiGenerationAttempt(connection, ownerId, {
        ...reservation(otherConversation.id, '99999999-9999-4999-8999-999999999993'),
        leaseExpiresAt: atMinute(7),
        now: atMinute(4, 20)
      })
      if (afterDelete.kind !== 'reserved') throw new Error('Expected a reservation after missing finalization')
      expect(
        finalizeAiGenerationAttempt(connection, ownerId, {
          conversationId: otherConversation.id,
          attemptId: afterDelete.attempt.id,
          historyRevision: afterDelete.attempt.historyRevision,
          status: 'failed',
          errorCode: 'provider_unavailable',
          now: atMinute(4, 30)
        })
      ).toMatchObject({ kind: 'finalized', attempt: { status: 'failed' } })

      const newer = reserveAiGenerationAttempt(connection, ownerId, {
        ...reservation(otherConversation.id, '99999999-9999-4999-8999-999999999994'),
        leaseExpiresAt: atMinute(8),
        now: atMinute(5)
      })
      if (newer.kind !== 'reserved') throw new Error('Expected terminal finalization to release its lease')
      expect(
        finalizeAiGenerationAttempt(connection, ownerId, {
          conversationId: otherConversation.id,
          attemptId: afterDelete.attempt.id,
          historyRevision: afterDelete.attempt.historyRevision,
          status: 'failed',
          errorCode: 'provider_unavailable',
          now: atMinute(5, 10)
        })
      ).toMatchObject({ kind: 'existing', attempt: { id: afterDelete.attempt.id, status: 'failed' } })
      expect(generationLease(sqlite, ownerId)).toMatchObject({ attemptId: newer.attempt.id })
      expect(
        reserveAiGenerationAttempt(connection, ownerId, {
          ...reservation(otherConversation.id, '99999999-9999-4999-8999-999999999995'),
          leaseExpiresAt: atMinute(8),
          now: atMinute(5, 20)
        })
      ).toEqual({ kind: 'concurrency-exceeded' })
      expect(
        finalizeAiGenerationAttempt(connection, ownerId, {
          conversationId: otherConversation.id,
          attemptId: newer.attempt.id,
          historyRevision: newer.attempt.historyRevision,
          status: 'failed',
          errorCode: 'provider_unavailable',
          now: atMinute(5, 30)
        })
      ).toMatchObject({ kind: 'finalized' })

      expect(deleteAiConversationForOwner(connection, ownerId, otherConversation.id)).toBe(true)
      expect(count(sqlite, 'ai_messages')).toBe(0)
      expect(count(sqlite, 'ai_generation_attempts')).toBe(0)
      expect(generationLease(sqlite, ownerId)).toBeNull()
      expect(getAiUsageBucketForOwner(connection, ownerId, bucketDate)?.requestCount).toBe(4)
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
    })
  })

  it('fails closed when an attempt message points at a different conversation', () => {
    withDatabase('message-invariant', ({ connection, sqlite }) => {
      insertUser(sqlite, ownerId)
      const conversation = createAiConversation(connection, ownerId, {
        maximumCount: 2,
        authorize: persistedAuthorization(ownerId),
        now: atMinute(0)
      })
      const otherConversation = createAiConversation(connection, ownerId, {
        maximumCount: 2,
        authorize: persistedAuthorization(ownerId),
        now: atMinute(0, 30)
      })
      const reserved = reserveAiGenerationAttempt(connection, ownerId, {
        ...reservation(conversation.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
        leaseExpiresAt: atMinute(5),
        now: atMinute(1)
      })
      if (reserved.kind !== 'reserved') throw new Error('Expected a reserved attempt')

      const foreignUserMessageId = 'ai_message_00000000-0000-4000-8000-000000000090'
      const foreignAssistantMessageId = 'ai_message_00000000-0000-4000-8000-000000000091'
      sqlite
        .prepare(
          `insert into ai_messages (id, conversation_id, sequence, role, content, created_at)
           values (?, ?, 1, 'user', 'other prompt', ?), (?, ?, 2, 'assistant', 'other answer', ?)`
        )
        .run(
          foreignUserMessageId,
          otherConversation.id,
          atMinute(1).toISOString(),
          foreignAssistantMessageId,
          otherConversation.id,
          atMinute(1).toISOString()
        )
      sqlite
        .prepare('update ai_generation_attempts set user_message_id = ? where id = ?')
        .run(foreignUserMessageId, reserved.attempt.id)

      expect(() =>
        reserveAiGenerationAttempt(connection, ownerId, {
          ...reservation(conversation.id, reserved.attempt.clientRequestId),
          authorize: () => {
            throw new Error('existing replay must not authorize')
          },
          leaseExpiresAt: atMinute(5),
          now: atMinute(2)
        })
      ).toThrow('AI conversation message invariant failed')

      sqlite
        .prepare('update ai_generation_attempts set user_message_id = ? where id = ?')
        .run(reserved.userMessage.id, reserved.attempt.id)
      expect(
        finalizeAiGenerationAttempt(connection, ownerId, {
          conversationId: conversation.id,
          attemptId: reserved.attempt.id,
          historyRevision: reserved.attempt.historyRevision,
          status: 'succeeded',
          assistantContent: 'correct answer',
          now: atMinute(2)
        })
      ).toMatchObject({ kind: 'finalized' })
      sqlite
        .prepare('update ai_generation_attempts set assistant_message_id = ? where id = ?')
        .run(foreignAssistantMessageId, reserved.attempt.id)

      expect(() =>
        finalizeAiGenerationAttempt(connection, ownerId, {
          conversationId: conversation.id,
          attemptId: reserved.attempt.id,
          historyRevision: reserved.attempt.historyRevision,
          status: 'succeeded',
          assistantContent: 'ignored replay content',
          now: atMinute(3)
        })
      ).toThrow('AI conversation message invariant failed')
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
    })
  })

  it('persists a normalized visible refusal and no raw provider envelope fields', () => {
    withDatabase('refusal', ({ connection, sqlite }) => {
      insertUser(sqlite, ownerId)
      const conversation = createAiConversation(connection, ownerId, {
        maximumCount: 10,
        authorize: persistedAuthorization(ownerId),
        now: atMinute(0)
      })
      const reserved = reserveAiGenerationAttempt(connection, ownerId, {
        ...reservation(conversation.id, '88888888-8888-4888-8888-888888888888'),
        leaseExpiresAt: atMinute(5),
        now: atMinute(1)
      })
      if (reserved.kind !== 'reserved') throw new Error('Expected a reserved attempt')

      expect(
        finalizeAiGenerationAttempt(connection, ownerId, {
          conversationId: conversation.id,
          attemptId: reserved.attempt.id,
          historyRevision: 0,
          status: 'refused',
          assistantContent: 'I cannot help with that request.',
          errorCode: 'provider_refused',
          providerRequestId: 'req_refused',
          inputTokens: 9,
          outputTokens: 4,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          now: atMinute(2)
        })
      ).toMatchObject({
        kind: 'finalized',
        assistantMessage: { role: 'assistant', content: 'I cannot help with that request.' },
        attempt: { status: 'refused', errorCode: 'provider_refused', providerRequestId: 'req_refused' }
      })
      expect(columnNames(sqlite, 'ai_generation_attempts')).not.toContain('provider_response_id')
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
    })
  })

  it('paginates owner-scoped conversations and complete transcripts with stable cursors', () => {
    withDatabase('pagination', ({ connection, sqlite }) => {
      insertUser(sqlite, ownerId)
      insertUser(sqlite, foreignOwnerId)
      const sameTimestamp = atMinute(0)
      const conversations = Array.from({ length: 3 }, () =>
        createAiConversation(connection, ownerId, {
          maximumCount: 10,
          authorize: persistedAuthorization(ownerId),
          now: sameTimestamp
        })
      )

      const firstPage = listAiConversationsForOwner(connection, ownerId, { limit: 2 })
      expect(firstPage.conversations).toHaveLength(2)
      expect(firstPage.nextCursor).toEqual({
        updatedAt: firstPage.conversations[1]!.updatedAt,
        id: firstPage.conversations[1]!.id
      })
      const secondPage = listAiConversationsForOwner(connection, ownerId, {
        cursor: firstPage.nextCursor,
        limit: 2
      })
      expect(secondPage).toMatchObject({ conversations: [{ id: expect.any(String) }], nextCursor: null })
      expect(new Set([...firstPage.conversations, ...secondPage.conversations].map(({ id }) => id))).toEqual(
        new Set(conversations.map(({ id }) => id))
      )
      expect(listAiConversationsForOwner(connection, foreignOwnerId, { cursor: firstPage.nextCursor })).toEqual({
        conversations: [],
        nextCursor: null
      })

      const conversation = conversations[0]!
      for (const [index, requestId] of [
        '10000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000002'
      ].entries()) {
        const reserved = reserveAiGenerationAttempt(connection, ownerId, {
          ...reservation(conversation.id, requestId),
          leaseExpiresAt: atMinute(2 + index),
          now: atMinute(1 + index)
        })
        if (reserved.kind !== 'reserved') throw new Error('Expected transcript reservation')
        expect(
          finalizeAiGenerationAttempt(connection, ownerId, {
            conversationId: conversation.id,
            attemptId: reserved.attempt.id,
            historyRevision: reserved.attempt.historyRevision,
            status: 'succeeded',
            assistantContent: `Answer ${index + 1}`,
            citations: [{ type: 'file', title: `Paged source ${index + 1}.pdf` }],
            now: atMinute(1 + index, 30)
          })
        ).toMatchObject({ kind: 'finalized' })
      }

      const transcript: Array<{
        sequence: number
        content: string
        citations: Array<{ type: 'file'; title: string }>
      }> = []
      let cursor = null
      do {
        const page = listAiMessagesForOwner(connection, ownerId, conversation.id, { cursor, limit: 1 })
        if (!page) throw new Error('Expected an owned transcript')
        transcript.push(...page.messages)
        cursor = page.nextCursor
      } while (cursor)
      expect(transcript.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4])
      expect(transcript.map(({ content }) => content)).toEqual([
        'Question 10000000-0000-4000-8000-000000000001',
        'Answer 1',
        'Question 10000000-0000-4000-8000-000000000002',
        'Answer 2'
      ])
      expect(transcript.map(({ citations }) => citations)).toEqual([
        [],
        [{ type: 'file', title: 'Paged source 1.pdf' }],
        [],
        [{ type: 'file', title: 'Paged source 2.pdf' }]
      ])
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
    })
  })

  it('uses the current clock by default and replays a completed request with its assistant response', () => {
    withDatabase('clock-defaults', ({ connection, sqlite }) => {
      insertUser(sqlite, ownerId)
      const conversation = createAiConversation(connection, ownerId, {
        maximumCount: 10,
        authorize: persistedAuthorization(ownerId)
      })
      const requestId = '10000000-0000-4000-8000-000000000009'
      const reserved = reserveAiGenerationAttempt(connection, ownerId, {
        ...reservation(conversation.id, requestId),
        usageBucketDate: new Date().toISOString().slice(0, 10),
        leaseExpiresAt: new Date(Date.now() + 60_000)
      })
      if (reserved.kind !== 'reserved') throw new Error('Expected a current-clock reservation')
      expect(
        finalizeAiGenerationAttempt(connection, ownerId, {
          conversationId: conversation.id,
          attemptId: reserved.attempt.id,
          historyRevision: reserved.attempt.historyRevision,
          status: 'succeeded',
          assistantContent: 'Completed response',
          citations: [{ type: 'file', title: 'Replay source.md' }]
        })
      ).toMatchObject({ kind: 'finalized' })

      expect(
        reserveAiGenerationAttempt(connection, ownerId, {
          ...reservation(conversation.id, requestId),
          usageBucketDate: new Date().toISOString().slice(0, 10),
          leaseExpiresAt: new Date(Date.now() + 60_000),
          authorize: () => {
            throw new Error('completed replay must not reauthorize')
          }
        })
      ).toMatchObject({
        kind: 'existing',
        userMessage: { content: `Question ${requestId}` },
        assistantMessage: { content: 'Completed response', citations: [{ type: 'file', title: 'Replay source.md' }] },
        attempt: { status: 'succeeded' }
      })
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
    })
  })

  it('rejects malformed bounds and dates before changing persisted conversation state', () => {
    withDatabase('validation', ({ connection, sqlite }) => {
      insertUser(sqlite, ownerId)
      const conversation = createAiConversation(connection, ownerId, {
        maximumCount: 10,
        authorize: persistedAuthorization(ownerId),
        now: atMinute(0)
      })

      expect(() =>
        createAiConversation(connection, ownerId, {
          maximumCount: 0,
          authorize: persistedAuthorization(ownerId),
          now: atMinute(0)
        })
      ).toThrow(RangeError)
      expect(() =>
        createAiConversation(connection, ownerId, {
          maximumCount: 1.5,
          authorize: persistedAuthorization(ownerId),
          now: atMinute(0)
        })
      ).toThrow(RangeError)
      expect(() =>
        createAiConversation(connection, ownerId, {
          maximumCount: 10,
          authorize: persistedAuthorization(ownerId),
          now: new Date(Number.NaN)
        })
      ).toThrow(RangeError)
      expect(() =>
        listAiConversationsForOwner(connection, ownerId, {
          cursor: { id: conversation.id, updatedAt: 'not-a-timestamp' }
        })
      ).toThrow(RangeError)
      for (const limit of [0, 1.5, 101]) {
        expect(() => listAiConversationsForOwner(connection, ownerId, { limit })).toThrow(RangeError)
      }
      expect(clearAiConversationForOwner(connection, foreignOwnerId, conversation.id, atMinute(1))).toBeNull()
      expect(clearAiConversationForOwner(connection, ownerId, 'ai_conversation_missing', atMinute(1))).toBeNull()

      for (const sequence of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() =>
          listAiMessagesForOwner(connection, ownerId, conversation.id, {
            cursor: { sequence, id: 'ai_message_cursor' }
          })
        ).toThrow(RangeError)
      }
      expect(listRecentAiMessageMetadataForOwner(connection, foreignOwnerId, conversation.id)).toBeNull()
      expect(listAiMessageContentsForOwner(connection, foreignOwnerId, conversation.id, ['message'])).toBeNull()
      for (const messageIds of [[], Array.from({ length: 257 }, (_, index) => `message-${index}`)]) {
        expect(() => listAiMessageContentsForOwner(connection, ownerId, conversation.id, messageIds)).toThrow(
          RangeError
        )
      }
      expect(
        reapAndGetAiGenerationAttemptForOwner(
          connection,
          foreignOwnerId,
          conversation.id,
          '10000000-0000-4000-8000-000000000010',
          atMinute(1)
        )
      ).toBeNull()
      expect(() =>
        reapAndGetAiGenerationAttemptForOwner(connection, ownerId, conversation.id, ' ', atMinute(1))
      ).toThrow(RangeError)
      expect(getAiUsageBucketForOwner(connection, ownerId, bucketDate)).toBeNull()
      for (const invalidDate of ['invalid', '2026-02-30']) {
        expect(() => getAiUsageBucketForOwner(connection, ownerId, invalidDate)).toThrow(RangeError)
      }

      const base = {
        ...reservation(conversation.id, '10000000-0000-4000-8000-000000000011'),
        leaseExpiresAt: atMinute(3),
        now: atMinute(2)
      }
      expect(
        reserveAiGenerationAttempt(connection, ownerId, {
          ...base,
          conversationId: 'ai_conversation_missing'
        })
      ).toEqual({ kind: 'not-found' })
      expect(() => reserveAiGenerationAttempt(connection, ownerId, { ...base, leaseExpiresAt: atMinute(2) })).toThrow(
        RangeError
      )
      expect(() =>
        reserveAiGenerationAttempt(connection, ownerId, { ...base, leaseExpiresAt: new Date(Number.NaN) })
      ).toThrow(RangeError)
      expect(() => reserveAiGenerationAttempt(connection, ownerId, { ...base, now: new Date(Number.NaN) })).toThrow(
        RangeError
      )
      for (const maximumRequestsPerBucket of [0, 1.5]) {
        expect(() => reserveAiGenerationAttempt(connection, ownerId, { ...base, maximumRequestsPerBucket })).toThrow(
          RangeError
        )
      }
      for (const maximumConcurrentAttempts of [0, 2]) {
        expect(() => reserveAiGenerationAttempt(connection, ownerId, { ...base, maximumConcurrentAttempts })).toThrow(
          RangeError
        )
      }
      for (const usageBucketDate of ['invalid', '2026-02-30']) {
        expect(() => reserveAiGenerationAttempt(connection, ownerId, { ...base, usageBucketDate })).toThrow(RangeError)
      }
      for (const clientRequestId of ['', ' padded', 'x'.repeat(129)]) {
        expect(() => reserveAiGenerationAttempt(connection, ownerId, { ...base, clientRequestId })).toThrow(RangeError)
      }
      for (const model of ['', ' padded', 'x'.repeat(129)]) {
        expect(() => reserveAiGenerationAttempt(connection, ownerId, { ...base, model })).toThrow(RangeError)
      }
      for (const content of ['', 'x'.repeat(1_000_001)]) {
        expect(() => reserveAiGenerationAttempt(connection, ownerId, { ...base, content })).toThrow(RangeError)
      }

      expect(getAiConversationForOwner(connection, ownerId, conversation.id)).toMatchObject({ nextSequence: 1 })
      expect(listAiMessagesForOwner(connection, ownerId, conversation.id)?.messages).toEqual([])
      expect(count(sqlite, 'ai_generation_attempts')).toBe(0)
      expect(count(sqlite, 'ai_usage_buckets')).toBe(0)
    })
  })

  it('validates terminal results and persists each non-response terminal status without an assistant message', () => {
    withDatabase('terminal-statuses', ({ connection, sqlite }) => {
      insertUser(sqlite, ownerId)
      const conversation = createAiConversation(connection, ownerId, {
        maximumCount: 10,
        authorize: persistedAuthorization(ownerId),
        now: atMinute(0)
      })
      const invalidBase = {
        conversationId: conversation.id,
        attemptId: 'ai_attempt_00000000-0000-4000-8000-000000000000',
        historyRevision: 0,
        status: 'failed' as const,
        errorCode: 'provider_failed',
        now: atMinute(1)
      }
      const assistantOverflow = `${'🙂'.repeat(16_000)}a`
      expect(Buffer.byteLength(assistantOverflow, 'utf8')).toBe(64_001)

      for (const historyRevision of [-1, 0.5]) {
        expect(() => finalizeAiGenerationAttempt(connection, ownerId, { ...invalidBase, historyRevision })).toThrow(
          RangeError
        )
      }
      for (const candidate of [
        { status: 'succeeded' as const, errorCode: undefined },
        { status: 'succeeded' as const, assistantContent: assistantOverflow, errorCode: undefined },
        { status: 'succeeded' as const, assistantContent: 'answer', errorCode: 'not_allowed' },
        { status: 'refused' as const, errorCode: 'provider_refused' },
        { status: 'refused' as const, assistantContent: assistantOverflow, errorCode: 'provider_refused' },
        { status: 'refused' as const, assistantContent: 'visible refusal', errorCode: undefined },
        { status: 'refused' as const, assistantContent: 'visible refusal', errorCode: 'Unsafe Code' },
        { status: 'failed' as const, assistantContent: 'must not persist', errorCode: 'provider_failed' },
        { status: 'failed' as const, errorCode: undefined },
        { status: 'failed' as const, errorCode: 'Unsafe Code' }
      ]) {
        expect(() => finalizeAiGenerationAttempt(connection, ownerId, { ...invalidBase, ...candidate })).toThrow(
          TypeError
        )
      }
      const invalidCitationBase = {
        ...invalidBase,
        status: 'succeeded' as const,
        assistantContent: 'A visible answer',
        errorCode: undefined
      }
      expect(() =>
        finalizeAiGenerationAttempt(connection, ownerId, {
          ...invalidCitationBase,
          citations: {} as never
        })
      ).toThrow(TypeError)
      for (const citations of [
        [{ type: 'file', title: '' }],
        [{ type: 'file', title: ' padded.pdf' }],
        [{ type: 'file', title: 'unsafe\nname.pdf' }],
        [{ type: 'file', title: 'unsafe\u202ename.pdf' }],
        [{ type: 'file', title: 'x'.repeat(513) }],
        [
          { type: 'file', title: 'duplicate.pdf' },
          { type: 'file', title: 'duplicate.pdf' }
        ],
        Array.from({ length: 11 }, (_, index) => ({ type: 'file', title: `source-${index}.pdf` }))
      ]) {
        expect(() => finalizeAiGenerationAttempt(connection, ownerId, { ...invalidCitationBase, citations })).toThrow(
          RangeError
        )
      }
      for (const citations of [
        [null],
        [{}],
        [{ type: 'file', title: 'source.pdf', providerFileId: 'must-not-enter-persistence' }]
      ] as unknown[][]) {
        expect(() =>
          finalizeAiGenerationAttempt(connection, ownerId, {
            ...invalidCitationBase,
            citations: citations as never
          })
        ).toThrow(TypeError)
      }
      const validWebCitation = {
        type: 'web' as const,
        title: 'Example',
        url: 'https://example.test/source',
        startIndex: 0,
        endIndex: 7
      }
      for (const citations of [
        [{ ...validWebCitation, title: '' }],
        [{ ...validWebCitation, title: ' unsafe ' }],
        [{ ...validWebCitation, title: 'unsafe\u202etitle' }],
        [{ ...validWebCitation, title: 'x'.repeat(513) }],
        [{ ...validWebCitation, url: 'http://example.test/source' }],
        [{ ...validWebCitation, url: 'https://user:secret@example.test/source' }],
        [{ ...validWebCitation, url: 'https://example.test:8443/source' }],
        [{ ...validWebCitation, url: 'https://EXAMPLE.test/source' }],
        [{ ...validWebCitation, url: `https://example.test/${'x'.repeat(4_100)}` }],
        [{ ...validWebCitation, startIndex: -1 }],
        [{ ...validWebCitation, endIndex: 0 }],
        [{ ...validWebCitation, endIndex: 100 }],
        [{ ...validWebCitation, startIndex: 0.5 }],
        [{ ...validWebCitation, endIndex: 1_000_001 }],
        [validWebCitation, validWebCitation],
        [validWebCitation, { ...validWebCitation, title: 'Duplicate span' }],
        Array.from({ length: 21 }, (_, index) => ({
          ...validWebCitation,
          startIndex: index * 2,
          endIndex: index * 2 + 1
        }))
      ]) {
        expect(() =>
          finalizeAiGenerationAttempt(connection, ownerId, {
            ...invalidCitationBase,
            citations
          })
        ).toThrow(RangeError)
      }
      for (const citations of [
        [{ ...validWebCitation, providerEnvelope: 'must-not-enter-persistence' }],
        [{ type: 'web', title: 'incomplete' }],
        [{ type: 'unknown', title: 'unsupported' }],
        [{ type: 'file', title: 'File.pdf' }, validWebCitation]
      ] as unknown[][]) {
        expect(() =>
          finalizeAiGenerationAttempt(connection, ownerId, {
            ...invalidCitationBase,
            citations: citations as never
          })
        ).toThrow(TypeError)
      }
      expect(() =>
        finalizeAiGenerationAttempt(connection, ownerId, {
          ...invalidBase,
          status: 'refused',
          assistantContent: 'Visible refusal',
          errorCode: 'provider_refused',
          citations: [{ type: 'file', title: 'not-allowed.pdf' }]
        })
      ).toThrow(TypeError)
      for (const providerRequestId of ['', ' padded', 'x'.repeat(513)]) {
        expect(() => finalizeAiGenerationAttempt(connection, ownerId, { ...invalidBase, providerRequestId })).toThrow(
          RangeError
        )
      }
      for (const inputTokens of [-1, 0.5]) {
        expect(() => finalizeAiGenerationAttempt(connection, ownerId, { ...invalidBase, inputTokens })).toThrow(
          RangeError
        )
      }

      expect(finalizeAiGenerationAttempt(connection, ownerId, invalidBase)).toEqual({ kind: 'not-found' })
      expect(
        finalizeAiGenerationAttempt(connection, foreignOwnerId, {
          ...invalidBase,
          conversationId: conversation.id
        })
      ).toEqual({ kind: 'not-found' })

      for (const [index, status] of (['failed', 'indeterminate', 'cancelled'] as const).entries()) {
        const requestId = `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
        const reserved = reserveAiGenerationAttempt(connection, ownerId, {
          ...reservation(conversation.id, requestId),
          leaseExpiresAt: atMinute(3 + index),
          now: atMinute(2 + index)
        })
        if (reserved.kind !== 'reserved') throw new Error(`Expected ${status} reservation`)
        const finalized = finalizeAiGenerationAttempt(connection, ownerId, {
          conversationId: conversation.id,
          attemptId: reserved.attempt.id,
          historyRevision: reserved.attempt.historyRevision,
          status,
          errorCode: `${status}_safely_normalized`,
          providerRequestId: null,
          inputTokens: index === 0 ? null : index,
          outputTokens: index === 0 ? null : index + 1,
          reasoningTokens: index === 0 ? null : index + 2,
          cachedInputTokens: index === 0 ? null : index + 3,
          cacheWriteTokens: index === 0 ? null : index + 4,
          now: atMinute(2 + index, 30)
        })
        expect(finalized).toMatchObject({
          kind: 'finalized',
          assistantMessage: null,
          attempt: { status, errorCode: `${status}_safely_normalized`, assistantMessageId: null }
        })
      }
      expect(listAiMessagesForOwner(connection, ownerId, conversation.id)?.messages.map(({ role }) => role)).toEqual([
        'user',
        'user',
        'user'
      ])
      expect(getAiUsageBucketForOwner(connection, ownerId, bucketDate)).toMatchObject({
        requestCount: 3,
        inputTokens: 3,
        outputTokens: 5,
        reasoningTokens: 7,
        cachedInputTokens: 9,
        cacheWriteTokens: 11
      })
      expect(getAiGenerationAttemptForOwner(connection, ownerId, conversation.id, 'missing-request')).toBeNull()
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
    })
  })

  it('conceals missing attempts and rejects stale or expired results without corrupting the transcript', () => {
    withDatabase('finalization-races', ({ connection, sqlite }) => {
      insertUser(sqlite, ownerId)
      const conversation = createAiConversation(connection, ownerId, {
        maximumCount: 10,
        authorize: persistedAuthorization(ownerId),
        now: atMinute(0)
      })

      expect(
        finalizeAiGenerationAttempt(connection, ownerId, {
          conversationId: conversation.id,
          attemptId: 'ai_attempt_00000000-0000-4000-8000-000000000000',
          historyRevision: 0,
          status: 'failed',
          errorCode: 'missing_attempt',
          now: atMinute(1)
        })
      ).toEqual({ kind: 'not-found' })

      const stale = reserveAiGenerationAttempt(connection, ownerId, {
        ...reservation(conversation.id, '30000000-0000-4000-8000-000000000001'),
        leaseExpiresAt: atMinute(3),
        now: atMinute(1)
      })
      if (stale.kind !== 'reserved') throw new Error('Expected stale-attempt reservation')
      sqlite.prepare('update ai_generation_attempts set history_revision = 1 where id = ?').run(stale.attempt.id)
      expect(
        finalizeAiGenerationAttempt(connection, ownerId, {
          conversationId: conversation.id,
          attemptId: stale.attempt.id,
          historyRevision: 0,
          status: 'failed',
          errorCode: 'stale_attempt',
          now: atMinute(1, 30)
        })
      ).toEqual({ kind: 'stale' })
      expect(generationLease(sqlite, ownerId)).toBeNull()

      const noLease = reserveAiGenerationAttempt(connection, ownerId, {
        ...reservation(conversation.id, '30000000-0000-4000-8000-000000000002'),
        leaseExpiresAt: atMinute(4),
        now: atMinute(2)
      })
      if (noLease.kind !== 'reserved') throw new Error('Expected missing-lease reservation')
      sqlite.pragma('ignore_check_constraints = ON')
      sqlite.prepare('update ai_generation_attempts set lease_expires_at = null where id = ?').run(noLease.attempt.id)
      sqlite.pragma('ignore_check_constraints = OFF')
      expect(
        finalizeAiGenerationAttempt(connection, ownerId, {
          conversationId: conversation.id,
          attemptId: noLease.attempt.id,
          historyRevision: 0,
          status: 'failed',
          errorCode: 'provider_failed',
          inputTokens: 5,
          outputTokens: 4,
          reasoningTokens: 3,
          cachedInputTokens: 2,
          cacheWriteTokens: 1,
          now: atMinute(2, 30)
        })
      ).toEqual({ kind: 'expired' })
      expect(
        getAiGenerationAttemptForOwner(connection, ownerId, conversation.id, noLease.attempt.clientRequestId)
      ).toMatchObject({ status: 'indeterminate', errorCode: 'attempt_lease_expired' })
      expect(getAiUsageBucketForOwner(connection, ownerId, bucketDate)).toMatchObject({
        requestCount: 2,
        inputTokens: 5,
        outputTokens: 4,
        reasoningTokens: 3,
        cachedInputTokens: 2,
        cacheWriteTokens: 1
      })
      expect(listAiMessagesForOwner(connection, ownerId, conversation.id)?.messages.map(({ role }) => role)).toEqual([
        'user',
        'user'
      ])
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
    })
  })

  it('rolls back atomically when transactional ledger invariants stop matching', () => {
    withDatabase('create-invariant', ({ connection, sqlite }) => {
      insertUser(sqlite, ownerId)
      sqlite.exec(`
        create trigger remove_new_conversation
        after insert on ai_conversations
        begin
          delete from ai_conversations where id = new.id;
        end
      `)
      expect(() =>
        createAiConversation(connection, ownerId, {
          maximumCount: 10,
          authorize: persistedAuthorization(ownerId),
          now: atMinute(0)
        })
      ).toThrow(Error)
      expect(count(sqlite, 'ai_conversations')).toBe(0)
    })

    withDatabase('clear-invariant', ({ connection, sqlite }) => {
      insertUser(sqlite, ownerId)
      const conversation = createAiConversation(connection, ownerId, {
        maximumCount: 10,
        authorize: persistedAuthorization(ownerId),
        now: atMinute(0)
      })
      sqlite.exec(`
        create trigger ignore_conversation_clear
        before update of history_revision on ai_conversations
        when new.history_revision > old.history_revision
        begin
          select raise(ignore);
        end
      `)
      expect(() => clearAiConversationForOwner(connection, ownerId, conversation.id, atMinute(1))).toThrow(Error)
      expect(getAiConversationForOwner(connection, ownerId, conversation.id)).toMatchObject({ historyRevision: 0 })
    })

    for (const invariant of ['conversation', 'attempt', 'usage'] as const) {
      withDatabase(`reserve-${invariant}-invariant`, ({ connection, sqlite }) => {
        insertUser(sqlite, ownerId)
        const conversation = createAiConversation(connection, ownerId, {
          maximumCount: 10,
          authorize: persistedAuthorization(ownerId),
          now: atMinute(0)
        })
        if (invariant === 'conversation') {
          sqlite.exec(`
            create trigger advance_conversation_early
            after insert on ai_generation_leases
            begin
              update ai_conversations
              set next_sequence = next_sequence + 1
              where owner_user_id = new.owner_user_id;
            end
          `)
        } else if (invariant === 'attempt') {
          sqlite.exec(`
            create trigger remove_new_attempt
            after insert on ai_generation_attempts
            begin
              delete from ai_generation_attempts where id = new.id;
            end
          `)
        } else {
          sqlite.exec(`
            create trigger remove_new_usage_bucket
            after insert on ai_usage_buckets
            begin
              delete from ai_usage_buckets
              where owner_user_id = new.owner_user_id and bucket_date = new.bucket_date;
            end
          `)
        }
        expect(() =>
          reserveAiGenerationAttempt(connection, ownerId, {
            ...reservation(conversation.id, `40000000-0000-4000-8000-00000000000${invariant.length}`),
            leaseExpiresAt: atMinute(3),
            now: atMinute(1)
          })
        ).toThrow(Error)
        expect(getAiConversationForOwner(connection, ownerId, conversation.id)).toMatchObject({ nextSequence: 1 })
        expect(count(sqlite, 'ai_messages')).toBe(0)
        expect(count(sqlite, 'ai_generation_attempts')).toBe(0)
        expect(count(sqlite, 'ai_generation_leases')).toBe(0)
        expect(count(sqlite, 'ai_usage_buckets')).toBe(0)
      })
    }

    for (const invariant of ['conversation', 'attempt', 'usage', 'citation', 'web-citation'] as const) {
      withDatabase(`finalize-${invariant}-invariant`, ({ connection, sqlite }) => {
        insertUser(sqlite, ownerId)
        const conversation = createAiConversation(connection, ownerId, {
          maximumCount: 10,
          authorize: persistedAuthorization(ownerId),
          now: atMinute(0)
        })
        const reserved = reserveAiGenerationAttempt(connection, ownerId, {
          ...reservation(conversation.id, `50000000-0000-4000-8000-00000000000${invariant.length}`),
          leaseExpiresAt: atMinute(3),
          now: atMinute(1)
        })
        if (reserved.kind !== 'reserved') throw new Error('Expected invariant reservation')
        if (invariant === 'conversation') {
          sqlite.exec(`
            create trigger ignore_response_sequence_advance
            before update of next_sequence on ai_conversations
            begin
              select raise(ignore);
            end
          `)
        } else if (invariant === 'attempt') {
          sqlite.exec(`
            create trigger ignore_response_attempt_update
            before update of assistant_message_id on ai_generation_attempts
            begin
              select raise(ignore);
            end
          `)
        } else if (invariant === 'usage') {
          sqlite.exec(`
            create trigger ignore_usage_update
            before update on ai_usage_buckets
            begin
              select raise(ignore);
            end
          `)
        } else if (invariant === 'citation') {
          sqlite.exec(`
            create trigger ignore_new_file_citation
            before insert on ai_message_file_citations
            begin
              select raise(ignore);
            end
          `)
        } else {
          sqlite.exec(`
            create trigger ignore_new_web_citation
            before insert on ai_message_web_citations
            begin
              select raise(ignore);
            end
          `)
        }
        expect(() =>
          finalizeAiGenerationAttempt(connection, ownerId, {
            conversationId: conversation.id,
            attemptId: reserved.attempt.id,
            historyRevision: 0,
            status: 'succeeded',
            assistantContent: 'Must roll back',
            citations:
              invariant === 'web-citation'
                ? [
                    {
                      type: 'web',
                      title: 'Must roll back',
                      url: 'https://example.test/must-roll-back',
                      startIndex: 0,
                      endIndex: 4
                    }
                  ]
                : [{ type: 'file', title: 'Must roll back.pdf' }],
            now: atMinute(2)
          })
        ).toThrow(Error)
        expect(
          getAiGenerationAttemptForOwner(connection, ownerId, conversation.id, reserved.attempt.clientRequestId)
        ).toMatchObject({ status: 'pending', assistantMessageId: null })
        expect(listAiMessagesForOwner(connection, ownerId, conversation.id)?.messages).toHaveLength(1)
        expect(count(sqlite, 'ai_message_file_citations')).toBe(0)
        expect(count(sqlite, 'ai_message_web_citations')).toBe(0)
        expect(generationLease(sqlite, ownerId)).toMatchObject({ attemptId: reserved.attempt.id })
        expect(getAiUsageBucketForOwner(connection, ownerId, bucketDate)).toMatchObject({
          requestCount: 1,
          inputTokens: 0,
          outputTokens: 0
        })
      })
    }

    withDatabase('terminal-attempt-invariant', ({ connection, sqlite }) => {
      insertUser(sqlite, ownerId)
      const conversation = createAiConversation(connection, ownerId, {
        maximumCount: 10,
        authorize: persistedAuthorization(ownerId),
        now: atMinute(0)
      })
      const reserved = reserveAiGenerationAttempt(connection, ownerId, {
        ...reservation(conversation.id, '60000000-0000-4000-8000-000000000001'),
        leaseExpiresAt: atMinute(3),
        now: atMinute(1)
      })
      if (reserved.kind !== 'reserved') throw new Error('Expected terminal invariant reservation')
      sqlite.exec(`
        create trigger ignore_terminal_attempt_update
        before update of status on ai_generation_attempts
        when new.assistant_message_id is null
        begin
          select raise(ignore);
        end
      `)
      expect(() =>
        finalizeAiGenerationAttempt(connection, ownerId, {
          conversationId: conversation.id,
          attemptId: reserved.attempt.id,
          historyRevision: 0,
          status: 'failed',
          errorCode: 'provider_failed',
          now: atMinute(2)
        })
      ).toThrow(Error)
      expect(
        getAiGenerationAttemptForOwner(connection, ownerId, conversation.id, reserved.attempt.clientRequestId)
      ).toMatchObject({ status: 'pending' })
      expect(generationLease(sqlite, ownerId)).toMatchObject({ attemptId: reserved.attempt.id })
    })
  })
})

type DatabaseFixture = Readonly<{
  connection: DatabaseConnection
  sqlite: InstanceType<typeof Database>
}>

function withDatabase(name: string, run: (fixture: DatabaseFixture) => void, options: Database.Options = {}) {
  const directory = mkdtempSync(join(tmpdir(), `swl-ai-repository-${name}-`))
  const databasePath = join(directory, 'app.db')
  const sqlite = new Database(databasePath, options)
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle({ client: sqlite, schema })
  migrate(db, { migrationsFolder })
  try {
    run({ connection: { sqlite, db, databasePath }, sqlite })
  } finally {
    sqlite.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

function insertRawMessages(
  sqlite: InstanceType<typeof Database>,
  conversationId: string,
  startSequence: number,
  messageCount: number,
  contentForSequence: (sequence: number) => string = (sequence) => `Historical message ${sequence}`,
  roleForSequence: (sequence: number) => 'user' | 'assistant' = (sequence) =>
    sequence % 2 === 1 ? 'user' : 'assistant'
) {
  const messageIds = new Map<number, string>()
  const insert = sqlite.prepare(
    `insert into ai_messages (id, conversation_id, sequence, role, content, created_at)
     values (?, ?, ?, ?, ?, ?)`
  )
  sqlite.transaction(() => {
    for (let offset = 0; offset < messageCount; offset += 1) {
      const sequence = startSequence + offset
      const messageId = `ai_message_${randomUUID()}`
      messageIds.set(sequence, messageId)
      insert.run(
        messageId,
        conversationId,
        sequence,
        roleForSequence(sequence),
        contentForSequence(sequence),
        new Date(fixedRepositoryTime.getTime() + sequence).toISOString()
      )
    }
    sqlite
      .prepare('update ai_conversations set next_sequence = ?, updated_at = ? where id = ?')
      .run(
        startSequence + messageCount,
        new Date(fixedRepositoryTime.getTime() + startSequence + messageCount).toISOString(),
        conversationId
      )
  })()
  return messageIds
}

function insertUser(sqlite: InstanceType<typeof Database>, id: string) {
  sqlite
    .prepare('insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, 1, 1)')
    .run(id, id, `${id}@example.test`)
}

function persistedAuthorization(expectedUserId: string) {
  return (connection: DatabaseConnection) => {
    expect(connection.sqlite.prepare('select id from user where id = ?').get(expectedUserId)).toEqual({
      id: expectedUserId
    })
  }
}

function reservation(conversationId: string, clientRequestId: string) {
  return {
    conversationId,
    clientRequestId,
    content: `Question ${clientRequestId}`,
    model: 'gpt-5.6-luna',
    usageBucketDate: bucketDate,
    maximumRequestsPerBucket: 10,
    maximumConcurrentAttempts: 1,
    authorize: persistedAuthorization(ownerId)
  }
}

function seedCompletedAiMessages(connection: DatabaseConnection) {
  const conversation = createAiConversation(connection, ownerId, {
    maximumCount: 10,
    authorize: persistedAuthorization(ownerId),
    now: atMinute(0)
  })
  const reserved = reserveAiGenerationAttempt(connection, ownerId, {
    ...reservation(conversation.id, '12345678-1234-4234-8234-123456789012'),
    leaseExpiresAt: atMinute(3),
    now: atMinute(1)
  })
  if (reserved.kind !== 'reserved') throw new Error('Expected corrupt-citation test reservation')
  const finalized = finalizeAiGenerationAttempt(connection, ownerId, {
    conversationId: conversation.id,
    attemptId: reserved.attempt.id,
    historyRevision: reserved.attempt.historyRevision,
    status: 'succeeded',
    assistantContent: 'Grounded answer.',
    now: atMinute(2)
  })
  if (finalized.kind !== 'finalized' || !finalized.assistantMessage) {
    throw new Error('Expected corrupt-citation test finalization')
  }
  return {
    conversationId: conversation.id,
    userMessageId: reserved.userMessage.id,
    assistantMessageId: finalized.assistantMessage.id
  }
}

function atMinute(minutes: number, seconds = 0) {
  return new Date(Date.UTC(2026, 6, 16, 12, minutes, seconds))
}

const fixedRepositoryTime = new Date(Date.UTC(2026, 6, 16, 13))

function count(sqlite: InstanceType<typeof Database>, table: string) {
  return (sqlite.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count
}

function columnNames(sqlite: InstanceType<typeof Database>, table: string) {
  return (sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>).map(({ name }) => name)
}

function generationLease(sqlite: InstanceType<typeof Database>, userId: string) {
  return (
    (sqlite
      .prepare(
        `select attempt_id as attemptId, lease_expires_at as leaseExpiresAt
         from ai_generation_leases where owner_user_id = ?`
      )
      .get(userId) as { attemptId: string; leaseExpiresAt: string } | undefined) ?? null
  )
}
