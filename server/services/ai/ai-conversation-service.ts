import { createHmac } from 'node:crypto'
import { createError } from 'h3'
import { assertBasicReleaseCapabilityAvailable } from '../../../shared/basic-release-policy'
import { useDatabase } from '../../db/client'
import type { DatabaseConnection } from '../../db/connect'
import {
  AiConversationLimitReachedError,
  clearAiConversationForOwner,
  createAiConversation,
  deleteAiConversationForOwner,
  finalizeAiGenerationAttempt,
  getAiConversationForOwner,
  getAiMessageForOwner,
  listAiMessageContentsForOwner,
  listAiConversationsForOwner,
  listAiMessagesForOwner,
  listRecentAiMessageMetadataForOwner,
  reapAndGetAiGenerationAttemptForOwner,
  reserveAiGenerationAttempt,
  type AiConversationCursor,
  type AiConversationProjection,
  type AiGenerationAttemptProjection,
  type AiMessageCursor,
  type AiMessageProjection,
  type FinalizeAiGenerationAttemptStatus
} from '../../db/repositories/ai-conversations'
import type { AppSession } from '../../utils/auth/require-session'
import {
  configurationError,
  conflictError,
  notFoundError,
  upstreamServiceError,
  validationError
} from '../../utils/errors'
import { getAppRuntimeConfig, type AppRuntimeConfig } from '../../utils/runtime'
import { captureException } from '../observability/capture'
import { aiPolicy, utf8ByteLength } from './ai-policy'
import {
  getOpenAIResponsesAdapter,
  OpenAIProviderError,
  type OpenAIProviderErrorCode,
  type OpenAIResponsesAdapter,
  type OpenAIVisibleMessage
} from './openai'

const cursorVersion = 1
const applicationInstructions = 'You are a helpful assistant. Answer the user directly and clearly.'
const historyLimitStatusMessage = 'AI conversation history limit reached. Clear it or start a new conversation.'
const clientRequestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type PublicAiConversation = Readonly<{
  id: string
  createdAt: string
  updatedAt: string
}>

export type PublicAiMessage = Readonly<{
  id: string
  sequence: number
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  citations: Array<
    | Readonly<{ type: 'file'; title: string }>
    | Readonly<{ type: 'web'; title: string; url: string; startIndex: number; endIndex: number }>
  >
}>

export type AiConversationServiceDependencies = Readonly<{
  connection: DatabaseConnection
  config: AppRuntimeConfig
  provider: () => OpenAIResponsesAdapter
  capture?: typeof captureException
  now?: () => Date
}>

type ListInput = Readonly<{ cursor?: string; limit?: number }>
type MessageInput = Readonly<{ clientRequestId: string; content: string }>

export function createAiConversationService(dependencies: AiConversationServiceDependencies) {
  const capture = dependencies.capture ?? captureException
  const now = dependencies.now ?? (() => new Date())

  return Object.freeze({
    createConversation(ownerUserId: string) {
      try {
        const conversation = createAiConversation(dependencies.connection, ownerUserId, {
          maximumCount: aiPolicy.maximumConversationCount,
          authorize: () => undefined,
          now: now()
        })
        return publicConversation(conversation)
      } catch (error) {
        if (error instanceof AiConversationLimitReachedError) {
          throw conflictError('AI conversation limit reached')
        }
        throw error
      }
    },

    listConversations(ownerUserId: string, input: ListInput = {}) {
      const page = listAiConversationsForOwner(dependencies.connection, ownerUserId, {
        cursor: input.cursor ? decodeConversationCursor(input.cursor) : undefined,
        limit: input.limit
      })
      return {
        conversations: page.conversations.map(publicConversation),
        nextCursor: page.nextCursor ? encodeCursor('conversation', page.nextCursor) : null
      }
    },

    getConversation(ownerUserId: string, conversationId: string) {
      const conversation = getAiConversationForOwner(dependencies.connection, ownerUserId, conversationId)
      if (!conversation) throw notFoundError('AI conversation not found')
      return publicConversation(conversation)
    },

    deleteConversation(ownerUserId: string, conversationId: string) {
      if (!deleteAiConversationForOwner(dependencies.connection, ownerUserId, conversationId)) {
        throw notFoundError('AI conversation not found')
      }
    },

    clearConversation(ownerUserId: string, conversationId: string) {
      if (!clearAiConversationForOwner(dependencies.connection, ownerUserId, conversationId, now())) {
        throw notFoundError('AI conversation not found')
      }
    },

    listMessages(ownerUserId: string, conversationId: string, input: ListInput = {}) {
      const page = listAiMessagesForOwner(dependencies.connection, ownerUserId, conversationId, {
        cursor: input.cursor ? decodeMessageCursor(input.cursor) : undefined,
        limit: input.limit
      })
      if (!page) throw notFoundError('AI conversation not found')
      return {
        messages: page.messages.map(publicMessage),
        nextCursor: page.nextCursor ? encodeCursor('message', page.nextCursor) : null
      }
    },

    async createMessage(ownerUserId: string, conversationId: string, input: MessageInput, signal?: AbortSignal) {
      validateMessageInput(input)
      const existing = reapAndGetAiGenerationAttemptForOwner(
        dependencies.connection,
        ownerUserId,
        conversationId,
        input.clientRequestId,
        now()
      )
      if (existing) {
        return replayExistingAttempt(dependencies.connection, ownerUserId, existing, input.content)
      }
      if (!getAiConversationForOwner(dependencies.connection, ownerUserId, conversationId)) {
        throw notFoundError('AI conversation not found')
      }
      const model = dependencies.config.openai.model
      if (!model) throw configurationError('AI is temporarily unavailable')
      const reservedAt = now()
      const reservation = reserveAiGenerationAttempt(dependencies.connection, ownerUserId, {
        conversationId,
        clientRequestId: input.clientRequestId,
        content: input.content,
        model,
        usageBucketDate: reservedAt.toISOString().slice(0, 10),
        leaseExpiresAt: new Date(reservedAt.getTime() + aiPolicy.attemptLeaseMs),
        maximumRequestsPerBucket: aiPolicy.dailyProviderAttemptLimit,
        maximumConcurrentAttempts: aiPolicy.maximumConcurrentGenerationsPerUser,
        authorize: () => undefined,
        now: reservedAt
      })

      if (reservation.kind === 'not-found') throw notFoundError('AI conversation not found')
      if (reservation.kind === 'quota-exceeded') throw rateLimitError('Daily AI request limit reached')
      if (reservation.kind === 'concurrency-exceeded') {
        throw conflictError('Another AI response is already in progress')
      }
      if (reservation.kind === 'existing') {
        return replayExistingAttempt(dependencies.connection, ownerUserId, reservation.attempt, input.content)
      }
      if (reservation.kind === 'history-limit-exceeded') throw historyLimitError()

      let messages: OpenAIVisibleMessage[]
      try {
        const providerContext = buildProviderContext(
          dependencies.connection,
          ownerUserId,
          conversationId,
          reservation.userMessage,
          applicationInstructions
        )
        if (!providerContext) throw notFoundError('AI conversation not found')
        messages = providerContext
      } catch (error) {
        const finalized = finalizeAiGenerationAttempt(dependencies.connection, ownerUserId, {
          conversationId,
          attemptId: reservation.attempt.id,
          historyRevision: reservation.attempt.historyRevision,
          status: 'failed',
          errorCode: 'application_context_unavailable',
          now: now()
        })
        if (!isHttpError(error)) {
          await capture(new Error('AI provider context failed'), 'openai-response-failed')
        }
        assertFailureFinalized(finalized)
        if (isHttpError(error)) throw error
        throw configurationError('AI is temporarily unavailable')
      }

      try {
        const result = await dependencies.provider().createResponse({
          instructions: applicationInstructions,
          messages,
          safetyIdentifier: safetyIdentifier(dependencies.config.betterAuth.secret, ownerUserId),
          requestId: reservation.attempt.id,
          maxOutputTokens: aiPolicy.maximumOutputTokens,
          timeoutMs: aiPolicy.providerTimeoutMs,
          ...(signal ? { signal } : {})
        })
        const finalized = finalizeAiGenerationAttempt(dependencies.connection, ownerUserId, {
          conversationId,
          attemptId: reservation.attempt.id,
          historyRevision: reservation.attempt.historyRevision,
          status: result.kind === 'refusal' ? 'refused' : 'succeeded',
          assistantContent: result.text,
          citations: result.citations,
          ...(result.kind === 'refusal' ? { errorCode: 'provider_refusal' } : {}),
          providerRequestId: result.requestId,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          reasoningTokens: result.usage.reasoningTokens,
          cachedInputTokens: result.usage.cachedInputTokens,
          cacheWriteTokens: result.usage.cacheWriteInputTokens,
          now: now()
        })
        return finalizedResponse(dependencies.connection, ownerUserId, finalized)
      } catch (error) {
        if (isHttpError(error)) throw error
        const normalized =
          error instanceof OpenAIProviderError
            ? error
            : new OpenAIProviderError('provider_unavailable', { retryable: true })
        const terminal = terminalAttemptForProviderError(normalized.code)
        const finalized = finalizeAiGenerationAttempt(dependencies.connection, ownerUserId, {
          conversationId,
          attemptId: reservation.attempt.id,
          historyRevision: reservation.attempt.historyRevision,
          status: terminal.status,
          errorCode: terminal.errorCode,
          providerRequestId: normalized.requestId,
          now: now()
        })
        await capture(new Error('OpenAI response failed'), 'openai-response-failed')
        assertFailureFinalized(finalized)
        throw providerHttpError(normalized.code)
      }
    }
  })
}

function productionService() {
  assertBasicReleaseCapabilityAvailable('ai')
  const config = getAppRuntimeConfig()
  return createAiConversationService({
    connection: useDatabase(),
    config,
    provider: () => getOpenAIResponsesAdapter(config)
  })
}

export function createOwnedAiConversation(session: AppSession) {
  return productionService().createConversation(session.user.id)
}

export function listOwnedAiConversations(session: AppSession, input: ListInput = {}) {
  return productionService().listConversations(session.user.id, input)
}

export function getOwnedAiConversation(session: AppSession, conversationId: string) {
  return productionService().getConversation(session.user.id, conversationId)
}

export function deleteOwnedAiConversation(session: AppSession, conversationId: string) {
  return productionService().deleteConversation(session.user.id, conversationId)
}

export function clearOwnedAiConversation(session: AppSession, conversationId: string) {
  return productionService().clearConversation(session.user.id, conversationId)
}

export function listOwnedAiMessages(session: AppSession, conversationId: string, input: ListInput = {}) {
  return productionService().listMessages(session.user.id, conversationId, input)
}

export async function createOwnedAiMessage(
  session: AppSession,
  conversationId: string,
  input: MessageInput,
  signal?: AbortSignal
) {
  return productionService().createMessage(session.user.id, conversationId, input, signal)
}

function buildProviderContext(
  connection: DatabaseConnection,
  ownerUserId: string,
  conversationId: string,
  currentUserMessage: AiMessageProjection,
  instructions: string
): OpenAIVisibleMessage[] | null {
  const metadata = listRecentAiMessageMetadataForOwner(connection, ownerUserId, conversationId)
  if (!metadata) return null
  if (metadata[0]?.id !== currentUserMessage.id || metadata[0].role !== 'user') {
    throw conflictError('AI conversation changed before generation')
  }

  let renderedBytes = utf8ByteLength(instructions)
  const selected = [] as typeof metadata
  for (const message of metadata) {
    const messageBytes = aiPolicy.providerMessageStructuralBytes + message.contentBytes
    if (renderedBytes + messageBytes > aiPolicy.maximumRenderedInputBytes) break
    selected.push(message)
    renderedBytes += messageBytes
  }
  if (!selected.length) throw validationError('AI message exceeds the configured context budget')

  const chronological = selected.reverse()
  while (chronological[0]?.role === 'assistant') chronological.shift()
  if (chronological.at(-1)?.id !== currentUserMessage.id) {
    throw conflictError('AI conversation changed before generation')
  }
  const messages = listAiMessageContentsForOwner(
    connection,
    ownerUserId,
    conversationId,
    chronological.map(({ id }) => id)
  )
  if (!messages) return null
  if (
    messages.length !== chronological.length ||
    messages.some((message, index) => message.role !== chronological[index]!.role)
  ) {
    throw conflictError('AI conversation changed before generation')
  }
  return messages
}

function replayExistingAttempt(
  connection: DatabaseConnection,
  ownerUserId: string,
  attempt: AiGenerationAttemptProjection,
  requestedContent: string
) {
  const conversation = getAiConversationForOwner(connection, ownerUserId, attempt.conversationId)
  const userMessage = conversation
    ? messageById(connection, ownerUserId, attempt.userMessageId, attempt.conversationId)
    : null
  if (!userMessage) throw notFoundError('AI conversation not found')
  if (userMessage.content !== requestedContent) {
    throw conflictError('AI request ID was already used for different content')
  }
  if (attempt.status === 'pending') throw conflictError('AI response is already in progress')
  if (attempt.status === 'succeeded' || attempt.status === 'refused') {
    if (!attempt.assistantMessageId) throw configurationError('AI response state is invalid')
    const assistantMessage = messageById(connection, ownerUserId, attempt.assistantMessageId, attempt.conversationId)
    if (!assistantMessage || !conversation) throw notFoundError('AI conversation not found')
    return {
      replayed: true,
      response: responseBody(conversation, userMessage, assistantMessage)
    }
  }
  throw persistedAttemptHttpError(attempt.errorCode)
}

function finalizedResponse(
  connection: DatabaseConnection,
  ownerUserId: string,
  result: ReturnType<typeof finalizeAiGenerationAttempt>
) {
  switch (result.kind) {
    case 'not-found':
      throw notFoundError('AI conversation not found')
    case 'stale':
      throw conflictError('AI conversation was cleared during generation')
    case 'expired':
      throw upstreamServiceError(504, 'AI response timed out')
    case 'history-limit-exceeded':
      throw historyLimitError()
    case 'existing':
    case 'finalized': {
      if (result.attempt.errorCode === 'application_history_limit') throw historyLimitError()
      if (!result.assistantMessage) throw configurationError('AI response state is invalid')
      const userMessage = messageById(
        connection,
        ownerUserId,
        result.attempt.userMessageId,
        result.attempt.conversationId
      )
      if (!userMessage) throw configurationError('AI response state is invalid')
      return {
        replayed: result.kind === 'existing',
        response: responseBody(result.conversation, userMessage, result.assistantMessage)
      }
    }
  }
}

function assertFailureFinalized(result: ReturnType<typeof finalizeAiGenerationAttempt>) {
  if (result.kind === 'not-found') throw notFoundError('AI conversation not found')
  if (result.kind === 'stale') throw conflictError('AI conversation was cleared during generation')
  if (result.kind === 'expired') throw upstreamServiceError(504, 'AI response timed out')
  if (
    result.kind === 'history-limit-exceeded' ||
    (result.kind === 'existing' && result.attempt.errorCode === 'application_history_limit')
  ) {
    throw historyLimitError()
  }
}

function terminalAttemptForProviderError(code: OpenAIProviderErrorCode): {
  status: Exclude<FinalizeAiGenerationAttemptStatus, 'succeeded' | 'refused'>
  errorCode: string
} {
  switch (code) {
    case 'cancelled':
      return { status: 'cancelled', errorCode: 'provider_cancelled' }
    case 'timeout':
      return { status: 'indeterminate', errorCode: 'provider_timeout' }
    case 'provider_unavailable':
      return { status: 'indeterminate', errorCode: 'provider_unavailable' }
    case 'rate_limited':
      return { status: 'failed', errorCode: 'provider_rate_limited' }
    case 'provider_configuration':
      return { status: 'failed', errorCode: 'provider_configuration' }
    case 'provider_rejected_request':
      return { status: 'failed', errorCode: 'provider_rejected_request' }
    case 'incomplete_response':
      return { status: 'failed', errorCode: 'provider_incomplete_response' }
    case 'invalid_response':
      return { status: 'failed', errorCode: 'provider_invalid_response' }
    case 'invalid_request':
      return { status: 'failed', errorCode: 'application_invalid_request' }
  }
}

function providerHttpError(code: OpenAIProviderErrorCode) {
  switch (code) {
    case 'timeout':
      return upstreamServiceError(504, 'AI response timed out')
    case 'provider_rejected_request':
    case 'incomplete_response':
    case 'invalid_response':
    case 'invalid_request':
      return upstreamServiceError(502, 'AI provider rejected or returned an unusable response')
    case 'cancelled':
    case 'rate_limited':
    case 'provider_configuration':
    case 'provider_unavailable':
      return upstreamServiceError(503, 'AI is temporarily unavailable')
  }
}

function persistedAttemptHttpError(errorCode: string | null) {
  if (errorCode === 'application_history_limit') return historyLimitError()
  if (errorCode === 'provider_timeout' || errorCode === 'attempt_lease_expired') {
    return upstreamServiceError(504, 'AI response timed out')
  }
  if (
    errorCode === 'provider_rejected_request' ||
    errorCode === 'provider_incomplete_response' ||
    errorCode === 'provider_invalid_response' ||
    errorCode === 'application_invalid_request'
  ) {
    return upstreamServiceError(502, 'AI provider rejected or returned an unusable response')
  }
  return upstreamServiceError(503, 'AI is temporarily unavailable')
}

function validateMessageInput(input: MessageInput) {
  if (!clientRequestIdPattern.test(input.clientRequestId)) {
    throw validationError('Invalid AI request ID')
  }
  if (!input.content.trim() || utf8ByteLength(input.content) > aiPolicy.maximumUserMessageBytes) {
    throw validationError('AI message must contain at most 32000 UTF-8 bytes')
  }
}

function safetyIdentifier(secret: string, ownerUserId: string) {
  return createHmac('sha256', secret).update('openai-safety-identifier:v1\0').update(ownerUserId).digest('hex')
}

function responseBody(
  conversation: AiConversationProjection,
  userMessage: AiMessageProjection,
  assistantMessage: AiMessageProjection
) {
  return {
    conversation: publicConversation(conversation),
    userMessage: publicMessage(userMessage),
    assistantMessage: publicMessage(assistantMessage)
  }
}

function publicConversation(conversation: AiConversationProjection): PublicAiConversation {
  return {
    id: conversation.id,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt
  }
}

function publicMessage(message: AiMessageProjection): PublicAiMessage {
  return {
    id: message.id,
    sequence: message.sequence,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    citations: message.citations.map((citation) => ({ ...citation }))
  }
}

function messageById(
  connection: DatabaseConnection,
  ownerUserId: string,
  messageId: string,
  conversationId: string
): AiMessageProjection | null {
  return getAiMessageForOwner(connection, ownerUserId, conversationId, messageId)
}

function encodeCursor(kind: 'conversation' | 'message', cursor: AiConversationCursor | AiMessageCursor) {
  return Buffer.from(JSON.stringify({ version: cursorVersion, kind, ...cursor })).toString('base64url')
}

function decodeConversationCursor(value: string): AiConversationCursor {
  const parsed = decodeCursor(value, 'conversation')
  if (
    typeof parsed.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(parsed.updatedAt)) ||
    typeof parsed.id !== 'string' ||
    !parsed.id
  ) {
    throw validationError('Invalid AI conversation cursor')
  }
  return { updatedAt: parsed.updatedAt, id: parsed.id }
}

function decodeMessageCursor(value: string): AiMessageCursor {
  const parsed = decodeCursor(value, 'message')
  if (
    !Number.isSafeInteger(parsed.sequence) ||
    (parsed.sequence as number) < 1 ||
    typeof parsed.id !== 'string' ||
    !parsed.id
  ) {
    throw validationError('Invalid AI message cursor')
  }
  return { sequence: parsed.sequence as number, id: parsed.id }
}

function decodeCursor(value: string, kind: 'conversation' | 'message'): Record<string, unknown> {
  try {
    if (value.length > 512) throw new Error('cursor too long')
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    if (parsed.version !== cursorVersion || parsed.kind !== kind) throw new Error('invalid cursor')
    return parsed
  } catch {
    throw validationError(`Invalid AI ${kind} cursor`)
  }
}

function rateLimitError(statusMessage: string) {
  return createError({ statusCode: 429, statusMessage })
}

function historyLimitError() {
  return conflictError(historyLimitStatusMessage)
}

function isHttpError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'statusCode' in error &&
    typeof (error as { statusCode?: unknown }).statusCode === 'number'
  )
}
