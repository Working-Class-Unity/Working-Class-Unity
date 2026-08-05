import { randomUUID } from 'node:crypto'
import { aiPolicy, utf8ByteLength } from '../../services/ai/ai-policy'
import type { DatabaseConnection } from '../connect'
import type { AiGenerationAttemptStatus, AiMessageRole } from '../schema'

const defaultPageSize = 50
const maximumPageSize = 100
const maximumFileCitationsPerMessage = 10
const maximumWebCitationsPerMessage = 20
const maximumFileCitationTitleCharacters = 512
const maximumWebCitationTitleCharacters = 512
const maximumWebCitationUrlCharacters = 4_096
const maximumWebCitationEndIndex = 1_000_000
const safeAttemptErrorCodePattern = /^[a-z0-9_-]{1,64}$/
const unicodeControlOrFormatPattern = /\p{C}/u

export type AiConversationProjection = Readonly<{
  id: string
  historyRevision: number
  nextSequence: number
  createdAt: string
  updatedAt: string
}>

export type AiConversationCursor = Readonly<{
  updatedAt: string
  id: string
}>

export type AiConversationPage = Readonly<{
  conversations: AiConversationProjection[]
  nextCursor: AiConversationCursor | null
}>

export type AiMessageProjection = Readonly<{
  id: string
  sequence: number
  role: AiMessageRole
  content: string
  createdAt: string
  citations: AiMessageCitationProjection[]
}>

export type AiMessageFileCitationProjection = Readonly<{
  type: 'file'
  title: string
}>

export type AiMessageWebCitationProjection = Readonly<{
  type: 'web'
  title: string
  url: string
  startIndex: number
  endIndex: number
}>

export type AiMessageCitationProjection = AiMessageFileCitationProjection | AiMessageWebCitationProjection

type AiMessageRow = Omit<AiMessageProjection, 'citations'>

export type AiMessageMetadataProjection = Readonly<{
  id: string
  sequence: number
  role: AiMessageRole
  contentBytes: number
  createdAt: string
}>

export type AiMessageContentProjection = Readonly<{
  role: AiMessageRole
  content: string
}>

type AiMessageFileCitationRow = Readonly<{
  messageId: string
  ordinal: number
  title: string
}>

type AiMessageWebCitationRow = Readonly<{
  messageId: string
  ordinal: number
  title: string
  url: string
  startIndex: number
  endIndex: number
}>

export type AiMessageCursor = Readonly<{
  sequence: number
  id: string
}>

export type AiMessagePage = Readonly<{
  messages: AiMessageProjection[]
  nextCursor: AiMessageCursor | null
}>

export type AiGenerationAttemptProjection = Readonly<{
  id: string
  conversationId: string
  userMessageId: string
  assistantMessageId: string | null
  clientRequestId: string
  historyRevision: number
  usageBucketDate: string
  status: AiGenerationAttemptStatus
  model: string
  providerRequestId: string | null
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  cachedInputTokens: number | null
  cacheWriteTokens: number | null
  errorCode: string | null
  leaseExpiresAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}>

export type AiUsageBucketProjection = Readonly<{
  bucketDate: string
  requestCount: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  createdAt: string
  updatedAt: string
}>

export class AiConversationLimitReachedError extends Error {
  constructor() {
    super('AI conversation limit reached')
    this.name = 'AiConversationLimitReachedError'
  }
}

export type ReserveAiGenerationAttemptResult =
  | Readonly<{ kind: 'not-found' }>
  | Readonly<{ kind: 'quota-exceeded'; usage: AiUsageBucketProjection }>
  | Readonly<{ kind: 'concurrency-exceeded' }>
  | Readonly<{ kind: 'history-limit-exceeded' }>
  | Readonly<{
      kind: 'existing'
      conversation: AiConversationProjection
      userMessage: AiMessageProjection
      assistantMessage: AiMessageProjection | null
      attempt: AiGenerationAttemptProjection
    }>
  | Readonly<{
      kind: 'reserved'
      conversation: AiConversationProjection
      userMessage: AiMessageProjection
      attempt: AiGenerationAttemptProjection
      usage: AiUsageBucketProjection
    }>

export type FinalizeAiGenerationAttemptStatus = Exclude<AiGenerationAttemptStatus, 'pending'>

export type FinalizeAiGenerationAttemptResult =
  | Readonly<{ kind: 'not-found' | 'stale' | 'expired' | 'history-limit-exceeded' }>
  | Readonly<{
      kind: 'existing' | 'finalized'
      conversation: AiConversationProjection
      assistantMessage: AiMessageProjection | null
      attempt: AiGenerationAttemptProjection
    }>

export function createAiConversation(
  connection: DatabaseConnection,
  ownerUserId: string,
  options: Readonly<{
    maximumCount: number
    authorize: (connection: DatabaseConnection) => void
    now?: Date
  }>
): AiConversationProjection {
  const maximumCount = boundedPositiveInteger(options.maximumCount, 'AI conversation limit')
  const now = isoTimestamp(options.now ?? new Date())

  return connection.sqlite
    .transaction(() => {
      options.authorize(connection)
      const current = connection.sqlite
        .prepare('select count(*) as count from ai_conversations where owner_user_id = ?')
        .get(ownerUserId) as { count: number }
      if (current.count >= maximumCount) throw new AiConversationLimitReachedError()

      const id = `ai_conversation_${randomUUID()}`
      connection.sqlite
        .prepare(
          `insert into ai_conversations (
             id, owner_user_id, history_revision, next_sequence, created_at, updated_at
           ) values (?, ?, 0, 1, ?, ?)`
        )
        .run(id, ownerUserId, now, now)

      return requireConversationForOwner(connection, ownerUserId, id)
    })
    .immediate()
}

export function listAiConversationsForOwner(
  connection: DatabaseConnection,
  ownerUserId: string,
  options: Readonly<{ cursor?: AiConversationCursor | null; limit?: number }> = {}
): AiConversationPage {
  const limit = boundedPageSize(options.limit)
  const cursor = options.cursor
  if (cursor) isoTimestamp(new Date(cursor.updatedAt))

  const rows = connection.sqlite
    .prepare(
      `select
         id,
         history_revision as historyRevision,
         next_sequence as nextSequence,
         created_at as createdAt,
         updated_at as updatedAt
       from ai_conversations
       where owner_user_id = ?
         and (? is null or updated_at < ? or (updated_at = ? and id < ?))
       order by updated_at desc, id desc
       limit ?`
    )
    .all(
      ownerUserId,
      cursor?.updatedAt ?? null,
      cursor?.updatedAt ?? null,
      cursor?.updatedAt ?? null,
      cursor?.id ?? null,
      limit + 1
    ) as AiConversationProjection[]

  const page = rows.slice(0, limit)
  const last = rows.length > limit ? page.at(-1) : undefined
  return {
    conversations: page,
    nextCursor: last ? { updatedAt: last.updatedAt, id: last.id } : null
  }
}

export function getAiConversationForOwner(
  connection: DatabaseConnection,
  ownerUserId: string,
  conversationId: string
): AiConversationProjection | null {
  return conversationForOwner(connection, ownerUserId, conversationId)
}

export function getAiMessageForOwner(
  connection: DatabaseConnection,
  ownerUserId: string,
  conversationId: string,
  messageId: string
): AiMessageProjection | null {
  if (!conversationForOwner(connection, ownerUserId, conversationId)) return null
  const message = messageForConversation(connection, conversationId, messageId)
  return message ? hydrateMessageCitations(connection, [message])[0]! : null
}

export function deleteAiConversationForOwner(
  connection: DatabaseConnection,
  ownerUserId: string,
  conversationId: string
): boolean {
  return (
    connection.sqlite
      .prepare('delete from ai_conversations where id = ? and owner_user_id = ?')
      .run(conversationId, ownerUserId).changes === 1
  )
}

export function clearAiConversationForOwner(
  connection: DatabaseConnection,
  ownerUserId: string,
  conversationId: string,
  now = new Date()
): AiConversationProjection | null {
  const updatedAt = isoTimestamp(now)

  return connection.sqlite
    .transaction(() => {
      const conversation = conversationForOwner(connection, ownerUserId, conversationId)
      if (!conversation) return null

      connection.sqlite.prepare('delete from ai_generation_attempts where conversation_id = ?').run(conversationId)
      connection.sqlite.prepare('delete from ai_messages where conversation_id = ?').run(conversationId)
      const updated = connection.sqlite
        .prepare(
          `update ai_conversations
           set history_revision = history_revision + 1, next_sequence = 1, updated_at = ?
           where id = ? and owner_user_id = ? and history_revision = ?`
        )
        .run(updatedAt, conversationId, ownerUserId, conversation.historyRevision)
      if (updated.changes !== 1) throw new Error('AI conversation changed while clearing history')
      return requireConversationForOwner(connection, ownerUserId, conversationId)
    })
    .immediate()
}

export function listAiMessagesForOwner(
  connection: DatabaseConnection,
  ownerUserId: string,
  conversationId: string,
  options: Readonly<{ cursor?: AiMessageCursor | null; limit?: number }> = {}
): AiMessagePage | null {
  if (!conversationForOwner(connection, ownerUserId, conversationId)) return null

  const limit = boundedPageSize(options.limit)
  const cursor = options.cursor
  if (cursor && (!Number.isSafeInteger(cursor.sequence) || cursor.sequence < 1)) {
    throw new RangeError('AI message cursor sequence must be a positive safe integer')
  }
  const rows = connection.sqlite
    .prepare(
      `select id, sequence, role, content, created_at as createdAt
       from ai_messages
       where conversation_id = ?
         and (? is null or sequence > ? or (sequence = ? and id > ?))
       order by sequence asc, id asc
       limit ?`
    )
    .all(
      conversationId,
      cursor?.sequence ?? null,
      cursor?.sequence ?? null,
      cursor?.sequence ?? null,
      cursor?.id ?? null,
      limit + 1
    ) as AiMessageRow[]

  const page = rows.slice(0, limit)
  const last = rows.length > limit ? page.at(-1) : undefined
  return {
    messages: hydrateMessageCitations(connection, page),
    nextCursor: last ? { sequence: last.sequence, id: last.id } : null
  }
}

export function listRecentAiMessageMetadataForOwner(
  connection: DatabaseConnection,
  ownerUserId: string,
  conversationId: string
): AiMessageMetadataProjection[] | null {
  if (!conversationForOwner(connection, ownerUserId, conversationId)) return null

  return connection.sqlite
    .prepare(
      `select id, sequence, role, octet_length(content) as contentBytes, created_at as createdAt
       from ai_messages
       where conversation_id = ?
       order by sequence desc
       limit ${aiPolicy.maximumRetainedMessages}`
    )
    .all(conversationId) as AiMessageMetadataProjection[]
}

export function listAiMessageContentsForOwner(
  connection: DatabaseConnection,
  ownerUserId: string,
  conversationId: string,
  messageIds: readonly string[]
): AiMessageContentProjection[] | null {
  if (!conversationForOwner(connection, ownerUserId, conversationId)) return null
  if (
    !Array.isArray(messageIds) ||
    messageIds.length < 1 ||
    messageIds.length > aiPolicy.maximumRetainedMessages ||
    new Set(messageIds).size !== messageIds.length
  ) {
    throw new RangeError(`AI context must select between 1 and ${aiPolicy.maximumRetainedMessages} unique messages`)
  }

  const placeholders = messageIds.map(() => '?').join(', ')
  return connection.sqlite
    .prepare(
      `select role, content
       from ai_messages
       where conversation_id = ? and id in (${placeholders})
       order by sequence asc`
    )
    .all(conversationId, ...messageIds) as AiMessageContentProjection[]
}

export function getAiGenerationAttemptForOwner(
  connection: DatabaseConnection,
  ownerUserId: string,
  conversationId: string,
  clientRequestId: string
): AiGenerationAttemptProjection | null {
  if (!conversationForOwner(connection, ownerUserId, conversationId)) return null
  return attemptByClientRequest(connection, conversationId, clientRequestId)
}

export function reapAndGetAiGenerationAttemptForOwner(
  connection: DatabaseConnection,
  ownerUserId: string,
  conversationId: string,
  clientRequestId: string,
  now = new Date()
): AiGenerationAttemptProjection | null {
  const reapedAt = isoTimestamp(now)
  const boundedClientRequestId = nonBlankBounded(clientRequestId, 128, 'AI client request ID')

  return connection.sqlite
    .transaction(() => {
      if (!conversationForOwner(connection, ownerUserId, conversationId)) return null
      expireStaleAttemptsForOwner(connection, ownerUserId, reapedAt)
      purgeExpiredGenerationLeaseForOwner(connection, ownerUserId, reapedAt)
      return attemptByClientRequest(connection, conversationId, boundedClientRequestId)
    })
    .immediate()
}

export function getAiUsageBucketForOwner(
  connection: DatabaseConnection,
  ownerUserId: string,
  bucketDate: string
): AiUsageBucketProjection | null {
  assertUtcDate(bucketDate)
  return usageBucketForOwner(connection, ownerUserId, bucketDate)
}

export function reserveAiGenerationAttempt(
  connection: DatabaseConnection,
  ownerUserId: string,
  input: Readonly<{
    conversationId: string
    clientRequestId: string
    content: string
    model: string
    usageBucketDate: string
    leaseExpiresAt: Date
    maximumRequestsPerBucket: number
    maximumConcurrentAttempts: number
    authorize: (connection: DatabaseConnection) => void
    now?: Date
  }>
): ReserveAiGenerationAttemptResult {
  const now = input.now ?? new Date()
  const createdAt = isoTimestamp(now)
  const leaseExpiresAt = isoTimestamp(input.leaseExpiresAt)
  if (input.leaseExpiresAt.getTime() <= now.getTime()) {
    throw new RangeError('AI attempt lease must expire after reservation')
  }
  const maximumRequests = boundedPositiveInteger(input.maximumRequestsPerBucket, 'AI request quota')
  if (boundedPositiveInteger(input.maximumConcurrentAttempts, 'AI concurrency limit') !== 1) {
    throw new RangeError('AI concurrency limit must equal the supported owner lease limit of 1')
  }
  assertUtcDate(input.usageBucketDate)
  const clientRequestId = nonBlankBounded(input.clientRequestId, 128, 'AI client request ID')
  const model = nonBlankBounded(input.model, 128, 'AI model')
  if (!input.content.length || input.content.length > 1_000_000) {
    throw new RangeError('AI message content must contain between 1 and 1000000 characters')
  }

  return connection.sqlite
    .transaction((): ReserveAiGenerationAttemptResult => {
      const conversation = conversationForOwner(connection, ownerUserId, input.conversationId)
      if (!conversation) return { kind: 'not-found' }

      expireStaleAttemptsForOwner(connection, ownerUserId, createdAt)
      purgeExpiredGenerationLeaseForOwner(connection, ownerUserId, createdAt)

      const existing = attemptByClientRequest(connection, conversation.id, clientRequestId)
      if (existing) {
        return {
          kind: 'existing',
          conversation: requireConversationForOwner(connection, ownerUserId, conversation.id),
          userMessage: requireMessageForConversation(connection, existing.conversationId, existing.userMessageId),
          assistantMessage: existing.assistantMessageId
            ? requireMessageForConversation(connection, existing.conversationId, existing.assistantMessageId)
            : null,
          attempt: existing
        }
      }

      input.authorize(connection)

      if (generationLeaseForOwner(connection, ownerUserId)) return { kind: 'concurrency-exceeded' }

      const currentUsage = usageBucketForOwner(connection, ownerUserId, input.usageBucketDate)
      if (currentUsage && currentUsage.requestCount >= maximumRequests) {
        return { kind: 'quota-exceeded', usage: currentUsage }
      }

      const retainedHistory = retainedHistoryForConversation(connection, conversation.id)
      if (
        retainedHistory.messageCount + 2 > aiPolicy.maximumRetainedMessages ||
        retainedHistory.contentBytes + utf8ByteLength(input.content) + aiPolicy.maximumAssistantMessageBytes >
          aiPolicy.maximumRetainedContentBytes
      ) {
        return { kind: 'history-limit-exceeded' }
      }

      const messageId = `ai_message_${randomUUID()}`
      const attemptId = `ai_attempt_${randomUUID()}`
      connection.sqlite
        .prepare(
          `insert into ai_messages (id, conversation_id, sequence, role, content, created_at)
           values (?, ?, ?, 'user', ?, ?)`
        )
        .run(messageId, conversation.id, conversation.nextSequence, input.content, createdAt)
      connection.sqlite
        .prepare(
          `insert into ai_generation_attempts (
             id, conversation_id, user_message_id, client_request_id, history_revision,
             usage_bucket_date, status, model, lease_expires_at, created_at, updated_at
           ) values (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
        )
        .run(
          attemptId,
          conversation.id,
          messageId,
          clientRequestId,
          conversation.historyRevision,
          input.usageBucketDate,
          model,
          leaseExpiresAt,
          createdAt,
          createdAt
        )
      connection.sqlite
        .prepare(
          `insert into ai_generation_leases (
             owner_user_id, attempt_id, lease_expires_at, created_at, updated_at
           ) values (?, ?, ?, ?, ?)`
        )
        .run(ownerUserId, attemptId, leaseExpiresAt, createdAt, createdAt)
      const advanced = connection.sqlite
        .prepare(
          `update ai_conversations
           set next_sequence = next_sequence + 1, updated_at = ?
           where id = ? and owner_user_id = ? and history_revision = ? and next_sequence = ?`
        )
        .run(createdAt, conversation.id, ownerUserId, conversation.historyRevision, conversation.nextSequence)
      if (advanced.changes !== 1) throw new Error('AI conversation changed while reserving an attempt')

      connection.sqlite
        .prepare(
          `insert into ai_usage_buckets (
             owner_user_id, bucket_date, request_count, input_tokens, output_tokens, created_at, updated_at
           ) values (?, ?, 1, 0, 0, ?, ?)
           on conflict (owner_user_id, bucket_date) do update set
             request_count = request_count + 1,
             updated_at = excluded.updated_at`
        )
        .run(ownerUserId, input.usageBucketDate, createdAt, createdAt)

      return {
        kind: 'reserved',
        conversation: requireConversationForOwner(connection, ownerUserId, conversation.id),
        userMessage: {
          id: messageId,
          sequence: conversation.nextSequence,
          role: 'user',
          content: input.content,
          createdAt,
          citations: []
        },
        attempt: requireAttemptById(connection, attemptId),
        usage: requireUsageBucketForOwner(connection, ownerUserId, input.usageBucketDate)
      }
    })
    .immediate()
}

export function finalizeAiGenerationAttempt(
  connection: DatabaseConnection,
  ownerUserId: string,
  input: Readonly<{
    conversationId: string
    attemptId: string
    historyRevision: number
    status: FinalizeAiGenerationAttemptStatus
    assistantContent?: string
    citations?: readonly AiMessageCitationProjection[]
    errorCode?: string
    providerRequestId?: string | null
    inputTokens?: number | null
    outputTokens?: number | null
    reasoningTokens?: number | null
    cachedInputTokens?: number | null
    cacheWriteTokens?: number | null
    now?: Date
  }>
): FinalizeAiGenerationAttemptResult {
  if (!Number.isSafeInteger(input.historyRevision) || input.historyRevision < 0) {
    throw new RangeError('AI history revision must be a non-negative safe integer')
  }
  const assistantContentBytes = utf8ByteLength(input.assistantContent ?? '')
  if (input.status === 'succeeded') {
    if (
      !input.assistantContent?.length ||
      assistantContentBytes > aiPolicy.maximumAssistantMessageBytes ||
      input.errorCode
    ) {
      throw new TypeError('A successful AI attempt requires bounded assistant content and no error code')
    }
  } else if (input.status === 'refused') {
    if (
      !input.assistantContent?.length ||
      assistantContentBytes > aiPolicy.maximumAssistantMessageBytes ||
      !input.errorCode ||
      !safeAttemptErrorCodePattern.test(input.errorCode)
    ) {
      throw new TypeError('A refused AI attempt requires bounded visible content and one safe error code')
    }
  } else if (
    input.assistantContent !== undefined ||
    !input.errorCode ||
    !safeAttemptErrorCodePattern.test(input.errorCode)
  ) {
    throw new TypeError('A non-successful AI attempt requires one safe error code and no assistant content')
  }
  const citations = normalizeCitations(input.citations)
  if (input.status !== 'succeeded' && citations.length) {
    throw new TypeError('Only a successful AI response may contain citations')
  }
  if (citations.some((citation) => citation.type === 'web' && citation.endIndex > input.assistantContent!.length)) {
    throw new RangeError('AI web citation spans must remain within the assistant content')
  }
  const providerRequestId = optionalBounded(input.providerRequestId, 512, 'OpenAI request ID')
  const inputTokens = optionalNonNegativeInteger(input.inputTokens, 'OpenAI input-token usage')
  const outputTokens = optionalNonNegativeInteger(input.outputTokens, 'OpenAI output-token usage')
  const reasoningTokens = optionalNonNegativeInteger(input.reasoningTokens, 'OpenAI reasoning-token usage')
  const cachedInputTokens = optionalNonNegativeInteger(input.cachedInputTokens, 'OpenAI cached-input-token usage')
  const cacheWriteTokens = optionalNonNegativeInteger(input.cacheWriteTokens, 'OpenAI cache-write-token usage')
  const completedAt = isoTimestamp(input.now ?? new Date())

  return connection.sqlite
    .transaction((): FinalizeAiGenerationAttemptResult => {
      releaseGenerationLeaseForAttempt(connection, ownerUserId, input.attemptId)
      const conversation = conversationForOwner(connection, ownerUserId, input.conversationId)
      if (!conversation) return { kind: 'not-found' }
      if (conversation.historyRevision !== input.historyRevision) return { kind: 'stale' }
      const attempt = attemptByIdForConversation(connection, conversation.id, input.attemptId)
      if (!attempt) return { kind: 'not-found' }
      if (attempt.status !== 'pending') {
        return {
          kind: 'existing',
          conversation,
          assistantMessage: attempt.assistantMessageId
            ? requireMessageForConversation(connection, attempt.conversationId, attempt.assistantMessageId)
            : null,
          attempt
        }
      }
      if (attempt.historyRevision !== input.historyRevision) return { kind: 'stale' }
      if (!attempt.leaseExpiresAt || Date.parse(attempt.leaseExpiresAt) <= Date.parse(completedAt)) {
        finishAttemptWithoutAssistant(connection, attempt.id, {
          status: 'indeterminate',
          errorCode: 'attempt_lease_expired',
          providerRequestId,
          inputTokens,
          outputTokens,
          reasoningTokens,
          cachedInputTokens,
          cacheWriteTokens,
          completedAt
        })
        addUsageTokens(connection, ownerUserId, attempt.usageBucketDate, {
          inputTokens,
          outputTokens,
          reasoningTokens,
          cachedInputTokens,
          cacheWriteTokens,
          updatedAt: completedAt
        })
        return { kind: 'expired' }
      }

      let assistantMessage: AiMessageProjection | null = null
      if (input.status === 'succeeded' || input.status === 'refused') {
        const retainedHistory = retainedHistoryForConversation(connection, conversation.id)
        if (
          retainedHistory.messageCount + 1 > aiPolicy.maximumRetainedMessages ||
          retainedHistory.contentBytes + assistantContentBytes > aiPolicy.maximumRetainedContentBytes
        ) {
          finishAttemptWithoutAssistant(connection, attempt.id, {
            status: 'failed',
            errorCode: 'application_history_limit',
            providerRequestId,
            inputTokens,
            outputTokens,
            reasoningTokens,
            cachedInputTokens,
            cacheWriteTokens,
            completedAt
          })
          addUsageTokens(connection, ownerUserId, attempt.usageBucketDate, {
            inputTokens,
            outputTokens,
            reasoningTokens,
            cachedInputTokens,
            cacheWriteTokens,
            updatedAt: completedAt
          })
          return { kind: 'history-limit-exceeded' }
        }

        const assistantMessageId = `ai_message_${randomUUID()}`
        connection.sqlite
          .prepare(
            `insert into ai_messages (id, conversation_id, sequence, role, content, created_at)
             values (?, ?, ?, 'assistant', ?, ?)`
          )
          .run(assistantMessageId, conversation.id, conversation.nextSequence, input.assistantContent, completedAt)
        insertMessageCitations(connection, assistantMessageId, citations)
        const advanced = connection.sqlite
          .prepare(
            `update ai_conversations
             set next_sequence = next_sequence + 1, updated_at = ?
             where id = ? and owner_user_id = ? and history_revision = ? and next_sequence = ?`
          )
          .run(completedAt, conversation.id, ownerUserId, conversation.historyRevision, conversation.nextSequence)
        if (advanced.changes !== 1) throw new Error('AI conversation changed while finalizing an attempt')
        const updated = connection.sqlite
          .prepare(
            `update ai_generation_attempts
             set status = ?, assistant_message_id = ?, provider_request_id = ?, input_tokens = ?,
                 output_tokens = ?, reasoning_tokens = ?, cached_input_tokens = ?, cache_write_tokens = ?, error_code = ?,
                 lease_expires_at = null, completed_at = ?, updated_at = ?
             where id = ? and conversation_id = ? and history_revision = ? and status = 'pending'`
          )
          .run(
            input.status,
            assistantMessageId,
            providerRequestId,
            inputTokens,
            outputTokens,
            reasoningTokens,
            cachedInputTokens,
            cacheWriteTokens,
            input.status === 'refused' ? input.errorCode : null,
            completedAt,
            completedAt,
            attempt.id,
            conversation.id,
            input.historyRevision
          )
        if (updated.changes !== 1) throw new Error('AI attempt changed while committing its response')
        assistantMessage = requireMessageForConversation(connection, conversation.id, assistantMessageId)
      } else {
        finishAttemptWithoutAssistant(connection, attempt.id, {
          status: input.status,
          errorCode: input.errorCode!,
          providerRequestId,
          inputTokens,
          outputTokens,
          reasoningTokens,
          cachedInputTokens,
          cacheWriteTokens,
          completedAt
        })
      }

      addUsageTokens(connection, ownerUserId, attempt.usageBucketDate, {
        inputTokens,
        outputTokens,
        reasoningTokens,
        cachedInputTokens,
        cacheWriteTokens,
        updatedAt: completedAt
      })
      return {
        kind: 'finalized',
        conversation: requireConversationForOwner(connection, ownerUserId, conversation.id),
        assistantMessage,
        attempt: requireAttemptById(connection, attempt.id)
      }
    })
    .immediate()
}

function expireStaleAttemptsForOwner(connection: DatabaseConnection, ownerUserId: string, now: string) {
  connection.sqlite
    .prepare(
      `update ai_generation_attempts
       set status = 'indeterminate', error_code = 'attempt_lease_expired', lease_expires_at = null,
           completed_at = ?, updated_at = ?
       where status = 'pending'
         and julianday(lease_expires_at) <= julianday(?)
         and conversation_id in (select id from ai_conversations where owner_user_id = ?)`
    )
    .run(now, now, now, ownerUserId)
}

function purgeExpiredGenerationLeaseForOwner(connection: DatabaseConnection, ownerUserId: string, now: string) {
  connection.sqlite
    .prepare(
      `delete from ai_generation_leases
       where owner_user_id = ? and julianday(lease_expires_at) <= julianday(?)`
    )
    .run(ownerUserId, now)
}

function generationLeaseForOwner(connection: DatabaseConnection, ownerUserId: string) {
  return connection.sqlite
    .prepare('select attempt_id as attemptId from ai_generation_leases where owner_user_id = ?')
    .get(ownerUserId) as { attemptId: string } | undefined
}

function releaseGenerationLeaseForAttempt(connection: DatabaseConnection, ownerUserId: string, attemptId: string) {
  connection.sqlite
    .prepare('delete from ai_generation_leases where owner_user_id = ? and attempt_id = ?')
    .run(ownerUserId, attemptId)
}

function finishAttemptWithoutAssistant(
  connection: DatabaseConnection,
  attemptId: string,
  input: Readonly<{
    status: Exclude<FinalizeAiGenerationAttemptStatus, 'succeeded' | 'refused'>
    errorCode: string
    providerRequestId: string | null
    inputTokens: number | null
    outputTokens: number | null
    reasoningTokens: number | null
    cachedInputTokens: number | null
    cacheWriteTokens: number | null
    completedAt: string
  }>
) {
  const updated = connection.sqlite
    .prepare(
      `update ai_generation_attempts
       set status = ?, assistant_message_id = null, provider_request_id = ?, input_tokens = ?,
           output_tokens = ?, reasoning_tokens = ?, cached_input_tokens = ?, cache_write_tokens = ?,
           error_code = ?, lease_expires_at = null,
           completed_at = ?, updated_at = ?
       where id = ? and status = 'pending'`
    )
    .run(
      input.status,
      input.providerRequestId,
      input.inputTokens,
      input.outputTokens,
      input.reasoningTokens,
      input.cachedInputTokens,
      input.cacheWriteTokens,
      input.errorCode,
      input.completedAt,
      input.completedAt,
      attemptId
    )
  if (updated.changes !== 1) throw new Error('AI attempt changed while committing its terminal state')
}

function addUsageTokens(
  connection: DatabaseConnection,
  ownerUserId: string,
  bucketDate: string,
  input: Readonly<{
    inputTokens: number | null
    outputTokens: number | null
    reasoningTokens: number | null
    cachedInputTokens: number | null
    cacheWriteTokens: number | null
    updatedAt: string
  }>
) {
  const updated = connection.sqlite
    .prepare(
      `update ai_usage_buckets
       set input_tokens = input_tokens + ?, output_tokens = output_tokens + ?,
           reasoning_tokens = reasoning_tokens + ?, cached_input_tokens = cached_input_tokens + ?,
           cache_write_tokens = cache_write_tokens + ?, updated_at = ?
       where owner_user_id = ? and bucket_date = ?`
    )
    .run(
      input.inputTokens ?? 0,
      input.outputTokens ?? 0,
      input.reasoningTokens ?? 0,
      input.cachedInputTokens ?? 0,
      input.cacheWriteTokens ?? 0,
      input.updatedAt,
      ownerUserId,
      bucketDate
    )
  if (updated.changes !== 1) throw new Error('AI usage bucket is missing while finalizing an attempt')
}

function retainedHistoryForConversation(
  connection: DatabaseConnection,
  conversationId: string
): Readonly<{ messageCount: number; contentBytes: number }> {
  return connection.sqlite
    .prepare(
      `select count(*) as messageCount, coalesce(sum(contentBytes), 0) as contentBytes
       from (
         select octet_length(content) as contentBytes
         from ai_messages
         where conversation_id = ?
         order by sequence desc
         limit ${aiPolicy.maximumRetainedMessages + 1}
       )`
    )
    .get(conversationId) as { messageCount: number; contentBytes: number }
}

function conversationForOwner(
  connection: DatabaseConnection,
  ownerUserId: string,
  conversationId: string
): AiConversationProjection | null {
  return (
    (connection.sqlite
      .prepare(
        `select id, history_revision as historyRevision, next_sequence as nextSequence,
                created_at as createdAt, updated_at as updatedAt
         from ai_conversations where id = ? and owner_user_id = ?`
      )
      .get(conversationId, ownerUserId) as AiConversationProjection | undefined) ?? null
  )
}

function requireConversationForOwner(
  connection: DatabaseConnection,
  ownerUserId: string,
  conversationId: string
): AiConversationProjection {
  const conversation = conversationForOwner(connection, ownerUserId, conversationId)
  if (!conversation) throw new Error('AI conversation disappeared during its transaction')
  return conversation
}

function attemptByClientRequest(
  connection: DatabaseConnection,
  conversationId: string,
  clientRequestId: string
): AiGenerationAttemptProjection | null {
  return (
    (connection.sqlite
      .prepare(`${attemptProjectionSql} where conversation_id = ? and client_request_id = ?`)
      .get(conversationId, clientRequestId) as AiGenerationAttemptProjection | undefined) ?? null
  )
}

function attemptByIdForConversation(
  connection: DatabaseConnection,
  conversationId: string,
  attemptId: string
): AiGenerationAttemptProjection | null {
  return (
    (connection.sqlite
      .prepare(`${attemptProjectionSql} where conversation_id = ? and id = ?`)
      .get(conversationId, attemptId) as AiGenerationAttemptProjection | undefined) ?? null
  )
}

function requireAttemptById(connection: DatabaseConnection, attemptId: string): AiGenerationAttemptProjection {
  const attempt = connection.sqlite.prepare(`${attemptProjectionSql} where id = ?`).get(attemptId) as
    AiGenerationAttemptProjection | undefined
  if (!attempt) throw new Error('AI attempt disappeared during its transaction')
  return attempt
}

function requireMessageForConversation(
  connection: DatabaseConnection,
  conversationId: string,
  messageId: string
): AiMessageProjection {
  const message = messageForConversation(connection, conversationId, messageId)
  if (!message) throw new Error('AI conversation message invariant failed during its transaction')
  return hydrateMessageCitations(connection, [message])[0]!
}

function messageForConversation(connection: DatabaseConnection, conversationId: string, messageId: string) {
  return (
    (connection.sqlite
      .prepare(
        `select id, sequence, role, content, created_at as createdAt
       from ai_messages where id = ? and conversation_id = ?`
      )
      .get(messageId, conversationId) as AiMessageRow | undefined) ?? null
  )
}

function hydrateMessageCitations(
  connection: DatabaseConnection,
  messages: readonly AiMessageRow[]
): AiMessageProjection[] {
  if (!messages.length) return []
  if (messages.length > maximumPageSize) {
    throw new RangeError('AI citation hydration exceeded its bounded message count')
  }

  const placeholders = messages.map(() => '?').join(', ')
  const fileRows = connection.sqlite
    .prepare(
      `select message_id as messageId, ordinal, title
       from ai_message_file_citations
       where message_id in (${placeholders})
       order by message_id asc, ordinal asc`
    )
    .all(...messages.map(({ id }) => id)) as AiMessageFileCitationRow[]
  const webRows = connection.sqlite
    .prepare(
      `select message_id as messageId, ordinal, title, url,
              start_index as startIndex, end_index as endIndex
       from ai_message_web_citations
       where message_id in (${placeholders})
       order by message_id asc, ordinal asc`
    )
    .all(...messages.map(({ id }) => id)) as AiMessageWebCitationRow[]
  const messagesById = new Map(messages.map((message) => [message.id, message]))
  const citationsByMessage = new Map(messages.map(({ id }) => [id, [] as AiMessageCitationProjection[]]))
  const webRowsByMessage = new Map(messages.map(({ id }) => [id, [] as AiMessageWebCitationRow[]]))
  for (const row of fileRows) {
    const message = messagesById.get(row.messageId)
    if (!message) throw new Error('AI file citation referred to an unexpected message')
    if (message.role !== 'assistant') throw new Error('AI citation referred to a non-assistant message')
    const citations = citationsByMessage.get(row.messageId)
    if (!citations) throw new Error('AI file citation hydration invariant failed')
    citations.push({ type: 'file', title: row.title })
  }
  for (const row of webRows) {
    const message = messagesById.get(row.messageId)
    if (!message) throw new Error('AI web citation referred to an unexpected message')
    if (message.role !== 'assistant') throw new Error('AI citation referred to a non-assistant message')
    const citations = citationsByMessage.get(row.messageId)
    const persistedRows = webRowsByMessage.get(row.messageId)
    if (!citations || !persistedRows) throw new Error('AI web citation hydration invariant failed')
    if (citations[0]?.type === 'file') throw new Error('AI message unexpectedly contained multiple citation types')
    persistedRows.push(row)
  }
  for (const message of messages) {
    const rows = webRowsByMessage.get(message.id)
    if (!rows?.length) continue
    const citations = normalizeWebCitations(
      rows.map(({ title, url, startIndex, endIndex }) => ({ type: 'web', title, url, startIndex, endIndex }))
    )
    if (citations.some(({ endIndex }) => endIndex > message.content.length)) {
      throw new RangeError('AI web citation spans must remain within assistant message content')
    }
    citationsByMessage.set(message.id, citations)
  }

  return messages.map((message) => ({ ...message, citations: citationsByMessage.get(message.id)! }))
}

function insertMessageCitations(
  connection: DatabaseConnection,
  messageId: string,
  citations: readonly AiMessageCitationProjection[]
) {
  if (!citations.length) return
  if (citations[0]!.type === 'file') {
    const insert = connection.sqlite.prepare(
      'insert into ai_message_file_citations (message_id, ordinal, title) values (?, ?, ?)'
    )
    for (const [index, citation] of citations.entries()) {
      if (citation.type !== 'file') throw new Error('AI message citation types changed during finalization')
      if (insert.run(messageId, index + 1, citation.title).changes !== 1) {
        throw new Error('AI file citation disappeared while finalizing its message')
      }
    }
    return
  }

  const insert = connection.sqlite.prepare(
    `insert into ai_message_web_citations (
       message_id, ordinal, title, url, start_index, end_index
     ) values (?, ?, ?, ?, ?, ?)`
  )
  for (const [index, citation] of citations.entries()) {
    if (citation.type !== 'web') throw new Error('AI message citation types changed during finalization')
    if (
      insert.run(messageId, index + 1, citation.title, citation.url, citation.startIndex, citation.endIndex).changes !==
      1
    ) {
      throw new Error('AI web citation disappeared while finalizing its message')
    }
  }
}

function usageBucketForOwner(
  connection: DatabaseConnection,
  ownerUserId: string,
  bucketDate: string
): AiUsageBucketProjection | null {
  return (
    (connection.sqlite
      .prepare(
        `select bucket_date as bucketDate, request_count as requestCount, input_tokens as inputTokens,
                output_tokens as outputTokens, reasoning_tokens as reasoningTokens,
                cached_input_tokens as cachedInputTokens, cache_write_tokens as cacheWriteTokens,
                created_at as createdAt, updated_at as updatedAt
         from ai_usage_buckets where owner_user_id = ? and bucket_date = ?`
      )
      .get(ownerUserId, bucketDate) as AiUsageBucketProjection | undefined) ?? null
  )
}

function requireUsageBucketForOwner(
  connection: DatabaseConnection,
  ownerUserId: string,
  bucketDate: string
): AiUsageBucketProjection {
  const usage = usageBucketForOwner(connection, ownerUserId, bucketDate)
  if (!usage) throw new Error('AI usage bucket disappeared during its transaction')
  return usage
}

const attemptProjectionSql = `select
  id,
  conversation_id as conversationId,
  user_message_id as userMessageId,
  assistant_message_id as assistantMessageId,
  client_request_id as clientRequestId,
  history_revision as historyRevision,
  usage_bucket_date as usageBucketDate,
  status,
  model,
  provider_request_id as providerRequestId,
  input_tokens as inputTokens,
  output_tokens as outputTokens,
  reasoning_tokens as reasoningTokens,
  cached_input_tokens as cachedInputTokens,
  cache_write_tokens as cacheWriteTokens,
  error_code as errorCode,
  lease_expires_at as leaseExpiresAt,
  completed_at as completedAt,
  created_at as createdAt,
  updated_at as updatedAt
from ai_generation_attempts`

function boundedPageSize(limit = defaultPageSize) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumPageSize) {
    throw new RangeError(`AI page limit must be between 1 and ${maximumPageSize}`)
  }
  return limit
}

function boundedPositiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${label} must be a positive safe integer`)
  return value
}

function optionalNonNegativeInteger(value: number | null | undefined, label: string) {
  if (value === null || value === undefined) return null
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer`)
  return value
}

function nonBlankBounded(value: string, maximum: number, label: string) {
  if (!value.trim() || value !== value.trim() || value.length > maximum) {
    throw new RangeError(`${label} must be nonblank, already trimmed, and at most ${maximum} characters`)
  }
  return value
}

function optionalBounded(value: string | null | undefined, maximum: number, label: string) {
  return value === null || value === undefined ? null : nonBlankBounded(value, maximum, label)
}

function normalizeCitations(
  citations: readonly AiMessageCitationProjection[] | undefined
): AiMessageCitationProjection[] {
  if (citations === undefined) return []
  if (!Array.isArray(citations)) throw new TypeError('AI citations must be an array')
  if (!citations.length) return []

  const citationType = citations[0]?.type
  if (citationType !== 'file' && citationType !== 'web') {
    throw new TypeError('Each AI citation must identify its supported type')
  }
  if (citations.some((citation) => citation?.type !== citationType)) {
    throw new TypeError('An AI message may contain only one citation type')
  }

  return citationType === 'file' ? normalizeFileCitations(citations) : normalizeWebCitations(citations)
}

function normalizeFileCitations(citations: readonly AiMessageCitationProjection[]): AiMessageFileCitationProjection[] {
  if (citations.length > maximumFileCitationsPerMessage) {
    throw new RangeError(`AI file citations must contain at most ${maximumFileCitationsPerMessage} entries`)
  }

  const titles = new Set<string>()
  return citations.map((citation) => {
    if (
      !citation ||
      typeof citation !== 'object' ||
      Array.isArray(citation) ||
      Object.keys(citation).length !== 2 ||
      citation.type !== 'file' ||
      typeof citation.title !== 'string'
    ) {
      throw new TypeError('Each AI file citation must contain only its type and title')
    }
    const title = citation.title
    if (
      !title.trim() ||
      title !== title.trim() ||
      [...title].length > maximumFileCitationTitleCharacters ||
      unicodeControlOrFormatPattern.test(title)
    ) {
      throw new RangeError(
        `AI file citation titles must be trimmed, control-free, and at most ${maximumFileCitationTitleCharacters} characters`
      )
    }
    if (titles.has(title)) throw new RangeError('AI file citation titles must be unique within a message')
    titles.add(title)
    return { type: 'file', title }
  })
}

function normalizeWebCitations(citations: readonly AiMessageCitationProjection[]): AiMessageWebCitationProjection[] {
  if (citations.length > maximumWebCitationsPerMessage) {
    throw new RangeError(`AI web citations must contain at most ${maximumWebCitationsPerMessage} entries`)
  }

  const urlSpans = new Set<string>()
  const titlesByUrl = new Map<string, string>()
  return citations.map((citation) => {
    if (
      !citation ||
      typeof citation !== 'object' ||
      Array.isArray(citation) ||
      Object.keys(citation).length !== 5 ||
      citation.type !== 'web' ||
      typeof citation.title !== 'string' ||
      typeof citation.url !== 'string'
    ) {
      throw new TypeError('Each AI web citation must contain only its type, title, URL, and span')
    }
    const title = citation.title
    if (
      !title.trim() ||
      title !== title.trim() ||
      [...title].length > maximumWebCitationTitleCharacters ||
      unicodeControlOrFormatPattern.test(title)
    ) {
      throw new RangeError(
        `AI web citation titles must be trimmed, control-free, and at most ${maximumWebCitationTitleCharacters} characters`
      )
    }
    const url = canonicalWebCitationUrl(citation.url)
    const knownTitle = titlesByUrl.get(url)
    if (knownTitle !== undefined && knownTitle !== title) {
      throw new RangeError('AI web citation URLs must use one consistent title within a message')
    }
    titlesByUrl.set(url, title)
    if (
      !Number.isSafeInteger(citation.startIndex) ||
      !Number.isSafeInteger(citation.endIndex) ||
      citation.startIndex < 0 ||
      citation.startIndex >= citation.endIndex ||
      citation.endIndex > maximumWebCitationEndIndex
    ) {
      throw new RangeError(
        `AI web citation spans must satisfy 0 <= startIndex < endIndex <= ${maximumWebCitationEndIndex}`
      )
    }
    const urlSpan = JSON.stringify([url, citation.startIndex, citation.endIndex])
    if (urlSpans.has(urlSpan)) throw new RangeError('AI web citation URL spans must be unique within a message')
    urlSpans.add(urlSpan)
    return { type: 'web', title, url, startIndex: citation.startIndex, endIndex: citation.endIndex }
  })
}

function canonicalWebCitationUrl(value: string) {
  if (
    !value ||
    value !== value.trim() ||
    [...value].length > maximumWebCitationUrlCharacters ||
    unicodeControlOrFormatPattern.test(value)
  ) {
    throw new RangeError(
      `AI web citation URLs must be canonical, control-free HTTPS URLs of at most ${maximumWebCitationUrlCharacters} characters`
    )
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new RangeError('AI web citation URLs must be valid canonical HTTPS URLs')
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.port || url.href !== value) {
    throw new RangeError('AI web citation URLs must be valid canonical HTTPS URLs without credentials or ports')
  }
  return url.href
}

function assertUtcDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new RangeError('AI usage bucket date must be a real UTC calendar date')
  }
}

function isoTimestamp(value: Date) {
  if (!Number.isFinite(value.getTime())) throw new RangeError('AI timestamp must be valid')
  return value.toISOString()
}
