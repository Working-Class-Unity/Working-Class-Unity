import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
  type ClientOptions
} from 'openai'
import { isIP } from 'node:net'
import { domainToASCII } from 'node:url'
import type { Response, ResponseCreateParamsNonStreaming, ResponseUsage } from 'openai/resources/responses/responses'
import { requireModuleReady } from '../../utils/module-state'
import { getAppRuntimeConfig, type AppRuntimeConfig } from '../../utils/runtime'

export const OPENAI_API_BASE_URL = 'https://api.openai.com/v1'
export const OPENAI_MAX_OUTPUT_TOKENS = 4_096
export const OPENAI_MAX_REQUEST_TIMEOUT_MS = 60_000
export const OPENAI_FILE_SEARCH_MAX_RESULTS = 10
export const OPENAI_FILE_CITATION_TITLE_MAX_LENGTH = 512
export const OPENAI_WEB_SEARCH_MAX_CITATIONS = 20
export const OPENAI_WEB_CITATION_URL_MAX_LENGTH = 4_096
export const OPENAI_WEB_SEARCH_CONTEXT_SIZE = 'medium'

const maxInstructionsBytes = 32_000
const maxRenderedInputBytes = 200_000
const renderedMessageStructuralBytes = 32
const maxRetryAfterMs = 24 * 60 * 60 * 1_000
const safetyIdentifierPattern = /^[A-Za-z0-9_-]{16,64}$/
const visibleAsciiPattern = /^[\x21-\x7e]+$/
const unicodeControlPattern = /\p{C}/u

export type OpenAIVisibleMessage = Readonly<{
  role: 'user' | 'assistant'
  content: string
}>

export type OpenAIResponseInput = Readonly<{
  instructions: string
  messages: readonly OpenAIVisibleMessage[]
  safetyIdentifier: string
  requestId: string
  maxOutputTokens: number
  timeoutMs: number
  signal?: AbortSignal
}>

export type OpenAIResponseUsage = Readonly<{
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  reasoningTokens: number
}>

export type OpenAIFileCitation = Readonly<{
  type: 'file'
  title: string
}>

export type OpenAIWebCitation = Readonly<{
  type: 'web'
  title: string
  url: string
  startIndex: number
  endIndex: number
}>

export type OpenAICitation = OpenAIFileCitation | OpenAIWebCitation

export type OpenAIResponseResult = Readonly<{
  kind: 'text' | 'refusal'
  text: string
  citations: OpenAICitation[]
  model: string
  requestId?: string
  usage: OpenAIResponseUsage
}>

type NormalizedOpenAIResponseInput = Readonly<{
  instructions: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  safetyIdentifier: string
  requestId: string
  maxOutputTokens: number
  timeoutMs: number
  signal?: AbortSignal
}>

type OpenAIResponseEnvelope = Response & { readonly _request_id?: string | null }
type OpenAIResponseCreateRequest = ResponseCreateParamsNonStreaming & {
  // The current Responses reference documents this request field, while exact
  // openai@6.47.0 omits it from ResponseCreateParamsBase. Keep the bridge local
  // to this adapter and protect the serialized contract with an exact wire test.
  max_tool_calls?: number
}

export type OpenAIProviderErrorCode =
  | 'cancelled'
  | 'incomplete_response'
  | 'invalid_request'
  | 'invalid_response'
  | 'provider_configuration'
  | 'provider_rejected_request'
  | 'provider_unavailable'
  | 'rate_limited'
  | 'timeout'

export class OpenAIProviderError extends Error {
  readonly code: OpenAIProviderErrorCode
  readonly retryable: boolean
  readonly requestId?: string
  readonly retryAfterMs?: number

  constructor(
    code: OpenAIProviderErrorCode,
    options: Readonly<{
      retryable?: boolean
      requestId?: string
      retryAfterMs?: number
    }> = {}
  ) {
    super(providerErrorMessage(code))
    this.name = 'OpenAIProviderError'
    this.code = code
    this.retryable = options.retryable ?? false
    this.requestId = options.requestId
    this.retryAfterMs = options.retryAfterMs
  }
}

export interface OpenAIResponsesAdapter {
  createResponse(input: OpenAIResponseInput): Promise<OpenAIResponseResult>
}

export type OpenAIAdapterConfig = AppRuntimeConfig['openai']

export type OpenAIAdapterOptions = Readonly<{
  fetch?: ClientOptions['fetch']
}>

let productionAdapter: OpenAIResponsesAdapter | undefined

export function createOpenAIResponsesAdapter(
  config: OpenAIAdapterConfig,
  options: OpenAIAdapterOptions = {}
): OpenAIResponsesAdapter {
  const apiKey = requireConfiguredValue(config.apiKey)
  const projectId = requireConfiguredValue(config.projectId)
  const model = requireAllowedModel(config.model)
  const fileSearch = normalizeFileSearchConfig(config.fileSearch)
  const webSearch = normalizeWebSearchConfig(config.webSearch)
  const client = new OpenAI({
    apiKey,
    project: projectId,
    organization: null,
    baseURL: OPENAI_API_BASE_URL,
    maxRetries: 0,
    timeout: OPENAI_MAX_REQUEST_TIMEOUT_MS,
    logLevel: 'off',
    ...(options.fetch ? { fetch: options.fetch } : {})
  })

  return Object.freeze({
    async createResponse(input: OpenAIResponseInput) {
      const normalizedInput = normalizeInput(input)
      const request: OpenAIResponseCreateRequest = {
        model,
        instructions: normalizedInput.instructions,
        input: normalizedInput.messages,
        store: false,
        background: false,
        reasoning: { effort: 'low' },
        max_output_tokens: normalizedInput.maxOutputTokens,
        truncation: 'disabled',
        prompt_cache_options: { mode: 'explicit' }
      }
      request.safety_identifier = normalizedInput.safetyIdentifier
      const tools: NonNullable<ResponseCreateParamsNonStreaming['tools']> = []
      if (fileSearch) {
        tools.push({
          type: 'file_search',
          vector_store_ids: [fileSearch.vectorStoreId],
          max_num_results: OPENAI_FILE_SEARCH_MAX_RESULTS
        })
      }
      if (webSearch) {
        tools.push({
          type: 'web_search',
          filters: { allowed_domains: [...webSearch.allowedDomains] },
          search_context_size: OPENAI_WEB_SEARCH_CONTEXT_SIZE
        })
      }
      if (tools.length) {
        request.tools = tools
        request.tool_choice = 'auto'
        request.parallel_tool_calls = false
        request.max_tool_calls = 1
      }

      try {
        const response = await client.responses.create(request, {
          headers: { 'X-Client-Request-Id': normalizedInput.requestId },
          maxRetries: 0,
          timeout: normalizedInput.timeoutMs,
          ...(normalizedInput.signal ? { signal: normalizedInput.signal } : {})
        })
        return normalizeResponse(response, model, {
          fileSearchEnabled: Boolean(fileSearch),
          webSearchAllowedDomains: webSearch?.allowedDomains ?? null
        })
      } catch (error) {
        throw normalizeProviderError(error)
      }
    }
  })
}

export function getOpenAIResponsesAdapter(config: AppRuntimeConfig = getAppRuntimeConfig()): OpenAIResponsesAdapter {
  requireModuleReady('ai', config)
  productionAdapter ??= createOpenAIResponsesAdapter(config.openai)
  return productionAdapter
}

export function resetOpenAIResponsesAdapterForTests(): void {
  if (process.env.NODE_ENV === 'test') productionAdapter = undefined
}

function normalizeInput(input: OpenAIResponseInput): NormalizedOpenAIResponseInput {
  const instructionsBytes = Buffer.byteLength(input.instructions, 'utf8')
  if (!input.instructions.trim() || instructionsBytes > maxInstructionsBytes) {
    throw new OpenAIProviderError('invalid_request')
  }
  if (!input.messages.length) throw new OpenAIProviderError('invalid_request')

  let renderedInputBytes = instructionsBytes
  const messages = input.messages.map((message) => {
    if ((message.role !== 'user' && message.role !== 'assistant') || !message.content.trim()) {
      throw new OpenAIProviderError('invalid_request')
    }
    renderedInputBytes += renderedMessageStructuralBytes + Buffer.byteLength(message.content, 'utf8')
    if (renderedInputBytes > maxRenderedInputBytes) {
      throw new OpenAIProviderError('invalid_request')
    }
    return { role: message.role, content: message.content }
  })

  if (!safetyIdentifierPattern.test(input.safetyIdentifier)) {
    throw new OpenAIProviderError('invalid_request')
  }
  if (input.requestId.length > 512 || input.requestId.length === 0 || !visibleAsciiPattern.test(input.requestId)) {
    throw new OpenAIProviderError('invalid_request')
  }

  requireBoundedInteger(input.maxOutputTokens, OPENAI_MAX_OUTPUT_TOKENS)
  requireBoundedInteger(input.timeoutMs, OPENAI_MAX_REQUEST_TIMEOUT_MS)

  return {
    instructions: input.instructions,
    messages,
    safetyIdentifier: input.safetyIdentifier,
    requestId: input.requestId,
    maxOutputTokens: input.maxOutputTokens,
    timeoutMs: input.timeoutMs,
    signal: input.signal
  }
}

function normalizeResponse(
  response: OpenAIResponseEnvelope,
  expectedModel: string,
  capabilities: Readonly<{
    fileSearchEnabled: boolean
    webSearchAllowedDomains: readonly string[] | null
  }>
): OpenAIResponseResult {
  const requestId = normalizeRequestId(response._request_id)

  if (response.status !== 'completed' || response.error || response.incomplete_details) {
    throw new OpenAIProviderError('incomplete_response', { requestId })
  }
  if (response.model !== expectedModel) {
    throw new OpenAIProviderError('invalid_response', { requestId })
  }

  const unsupportedOutput = response.output.some(
    (item) =>
      item.type !== 'message' &&
      item.type !== 'reasoning' &&
      item.type !== 'file_search_call' &&
      item.type !== 'web_search_call'
  )
  if (unsupportedOutput) throw new OpenAIProviderError('invalid_response', { requestId })

  const fileSearchCalls = response.output.filter((item) => item.type === 'file_search_call')
  const webSearchCalls = response.output.filter((item) => item.type === 'web_search_call')
  if (
    (!capabilities.fileSearchEnabled && fileSearchCalls.length) ||
    (!capabilities.webSearchAllowedDomains && webSearchCalls.length) ||
    fileSearchCalls.length + webSearchCalls.length > 1 ||
    fileSearchCalls.length > 1 ||
    webSearchCalls.length > 1 ||
    fileSearchCalls.some((call) => call.status !== 'completed') ||
    webSearchCalls.some(
      (call) =>
        call.status !== 'completed' || !isSupportedWebSearchAction(call.action, capabilities.webSearchAllowedDomains!)
    )
  ) {
    throw new OpenAIProviderError('invalid_response', { requestId })
  }

  const messages = response.output.filter((item) => item.type === 'message')
  if (
    !messages.length ||
    messages.some(
      (message) =>
        message.status !== 'completed' ||
        message.role !== 'assistant' ||
        message.content.some((content) => content.type !== 'output_text' && content.type !== 'refusal')
    )
  ) {
    throw new OpenAIProviderError('invalid_response', { requestId })
  }

  const textParts = messages.flatMap((message) =>
    message.content.flatMap((content) => (content.type === 'output_text' ? [content] : []))
  )
  const refusalParts = messages.flatMap((message) =>
    message.content.flatMap((content) => (content.type === 'refusal' ? [content.refusal] : []))
  )
  if (textParts.length && refusalParts.length) {
    throw new OpenAIProviderError('invalid_response', { requestId })
  }

  const annotations = textParts.flatMap((part) => part.annotations)
  const citations = normalizeCitations(textParts, annotations, {
    requestId,
    fileSearchCallCount: fileSearchCalls.length,
    webSearchCallCount: webSearchCalls.length,
    webSearchAllowedDomains: capabilities.webSearchAllowedDomains
  })

  const usage = normalizeUsage(response.usage, requestId)
  const text = textParts.map((part) => part.text).join('')
  if (textParts.length) {
    if (!text.trim()) throw new OpenAIProviderError('invalid_response', { requestId })
    return Object.freeze({ kind: 'text', text, citations, model: expectedModel, requestId, usage })
  }

  const refusal = refusalParts.join('\n')
  if (!refusal.trim() || text) throw new OpenAIProviderError('invalid_response', { requestId })
  return Object.freeze({ kind: 'refusal', text: refusal, citations: [], model: expectedModel, requestId, usage })
}

function isSupportedWebSearchAction(value: unknown, allowedDomains: readonly string[]): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const action = value as Record<string, unknown>

  if (action.type === 'search') {
    if (action.sources === undefined) return true
    return (
      Array.isArray(action.sources) &&
      action.sources.every(
        (source) =>
          source !== null &&
          typeof source === 'object' &&
          !Array.isArray(source) &&
          (source as Record<string, unknown>).type === 'url' &&
          isAllowedWebSearchUrl((source as Record<string, unknown>).url, allowedDomains)
      )
    )
  }

  if (action.type === 'open_page') {
    return action.url === undefined || action.url === null || isAllowedWebSearchUrl(action.url, allowedDomains)
  }

  return action.type === 'find_in_page' && isAllowedWebSearchUrl(action.url, allowedDomains)
}

function isAllowedWebSearchUrl(value: unknown, allowedDomains: readonly string[]): boolean {
  try {
    normalizeWebCitationUrl(value, allowedDomains, undefined)
    return true
  } catch {
    return false
  }
}

function normalizeCitations(
  textParts: ReadonlyArray<Readonly<{ text: string; annotations: readonly unknown[] }>>,
  annotations: readonly unknown[],
  options: Readonly<{
    requestId: string | undefined
    fileSearchCallCount: number
    webSearchCallCount: number
    webSearchAllowedDomains: readonly string[] | null
  }>
): OpenAICitation[] {
  const fileAnnotations: Record<string, unknown>[] = []
  const webAnnotations: Record<string, unknown>[] = []

  for (const annotation of annotations) {
    if (!annotation || typeof annotation !== 'object' || Array.isArray(annotation)) {
      throw new OpenAIProviderError('invalid_response', { requestId: options.requestId })
    }
    const candidate = annotation as Record<string, unknown>
    if (candidate.type === 'file_citation') fileAnnotations.push(candidate)
    else if (candidate.type === 'url_citation') webAnnotations.push(candidate)
    else throw new OpenAIProviderError('invalid_response', { requestId: options.requestId })
  }

  if (
    (fileAnnotations.length > 0 && options.fileSearchCallCount !== 1) ||
    (webAnnotations.length > 0 && options.webSearchCallCount !== 1) ||
    (options.webSearchCallCount === 1 && textParts.length > 0 && webAnnotations.length === 0)
  ) {
    throw new OpenAIProviderError('invalid_response', { requestId: options.requestId })
  }

  return [
    ...normalizeFileCitations(fileAnnotations, options.requestId),
    ...normalizeWebCitations(textParts, webAnnotations, options.webSearchAllowedDomains, options.requestId)
  ]
}

function normalizeFileCitations(
  annotations: readonly Record<string, unknown>[],
  requestId: string | undefined
): OpenAIFileCitation[] {
  const fileIds = new Map<string, string>()
  const titles = new Map<string, string>()
  const citations: OpenAIFileCitation[] = []

  for (const annotation of annotations) {
    const candidate = annotation
    const fileId = normalizeProviderFileId(candidate.file_id, requestId)
    const title = normalizeCitationTitle(candidate.filename, requestId)
    if (fileIds.has(fileId) && fileIds.get(fileId) !== title) {
      throw new OpenAIProviderError('invalid_response', { requestId })
    }
    if (titles.has(title) && titles.get(title) !== fileId) {
      throw new OpenAIProviderError('invalid_response', { requestId })
    }
    fileIds.set(fileId, title)
    titles.set(title, fileId)
    if (citations.some((citation) => citation.title === title)) continue
    if (citations.length >= OPENAI_FILE_SEARCH_MAX_RESULTS) {
      throw new OpenAIProviderError('invalid_response', { requestId })
    }
    citations.push(Object.freeze({ type: 'file', title }))
  }

  return citations
}

function normalizeWebCitations(
  textParts: ReadonlyArray<Readonly<{ text: string }>>,
  annotations: readonly Record<string, unknown>[],
  allowedDomains: readonly string[] | null,
  requestId: string | undefined
): OpenAIWebCitation[] {
  if (!annotations.length) return []
  if (!allowedDomains || textParts.length !== 1) {
    throw new OpenAIProviderError('invalid_response', { requestId })
  }

  const text = textParts[0]!.text
  const titlesByUrl = new Map<string, string>()
  const exactCitations = new Set<string>()
  const citations: OpenAIWebCitation[] = []

  for (const candidate of annotations) {
    const title = normalizeCitationTitle(candidate.title, requestId)
    const url = normalizeWebCitationUrl(candidate.url, allowedDomains, requestId)
    const startIndex = normalizeCitationIndex(candidate.start_index, text.length, requestId)
    const endIndex = normalizeCitationIndex(candidate.end_index, text.length, requestId)
    if (startIndex >= endIndex) throw new OpenAIProviderError('invalid_response', { requestId })

    const knownTitle = titlesByUrl.get(url)
    if (knownTitle !== undefined && knownTitle !== title) {
      throw new OpenAIProviderError('invalid_response', { requestId })
    }
    titlesByUrl.set(url, title)

    const identity = `${startIndex}\0${endIndex}\0${url}`
    if (exactCitations.has(identity)) continue
    exactCitations.add(identity)
    if (citations.length >= OPENAI_WEB_SEARCH_MAX_CITATIONS) {
      throw new OpenAIProviderError('invalid_response', { requestId })
    }
    citations.push(Object.freeze({ type: 'web', title, url, startIndex, endIndex }))
  }

  return citations
}

function normalizeWebCitationUrl(
  value: unknown,
  allowedDomains: readonly string[],
  requestId: string | undefined
): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== value.trim() ||
    value.length > OPENAI_WEB_CITATION_URL_MAX_LENGTH ||
    unicodeControlPattern.test(value)
  ) {
    throw new OpenAIProviderError('invalid_response', { requestId })
  }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new OpenAIProviderError('invalid_response', { requestId })
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    !allowedDomains.some((domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`))
  ) {
    throw new OpenAIProviderError('invalid_response', { requestId })
  }

  const normalized = parsed.href
  if (normalized.length > OPENAI_WEB_CITATION_URL_MAX_LENGTH) {
    throw new OpenAIProviderError('invalid_response', { requestId })
  }
  return normalized
}

function normalizeCitationIndex(value: unknown, maximum: number, requestId: string | undefined): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new OpenAIProviderError('invalid_response', { requestId })
  }
  return value as number
}

function normalizeProviderFileId(value: unknown, requestId: string | undefined): string {
  if (typeof value !== 'string' || !value || value.length > 512 || !visibleAsciiPattern.test(value)) {
    throw new OpenAIProviderError('invalid_response', { requestId })
  }
  return value
}

function normalizeCitationTitle(value: unknown, requestId: string | undefined): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== value.trim() ||
    Array.from(value).length > OPENAI_FILE_CITATION_TITLE_MAX_LENGTH ||
    unicodeControlPattern.test(value)
  ) {
    throw new OpenAIProviderError('invalid_response', { requestId })
  }
  return value
}

function normalizeUsage(usage: ResponseUsage | undefined, requestId: string | undefined): OpenAIResponseUsage {
  if (!usage) throw new OpenAIProviderError('invalid_response', { requestId })

  const normalized = {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    cachedInputTokens: usage.input_tokens_details.cached_tokens,
    cacheWriteInputTokens: usage.input_tokens_details.cache_write_tokens,
    reasoningTokens: usage.output_tokens_details.reasoning_tokens
  }
  if (
    Object.values(normalized).some((value) => !Number.isSafeInteger(value) || value < 0) ||
    normalized.totalTokens !== normalized.inputTokens + normalized.outputTokens ||
    normalized.cachedInputTokens > normalized.inputTokens ||
    normalized.cacheWriteInputTokens > normalized.inputTokens ||
    normalized.reasoningTokens > normalized.outputTokens ||
    normalized.cachedInputTokens !== 0 ||
    normalized.cacheWriteInputTokens !== 0
  ) {
    throw new OpenAIProviderError('invalid_response', { requestId })
  }
  return Object.freeze(normalized)
}

function normalizeProviderError(error: unknown): OpenAIProviderError {
  if (error instanceof OpenAIProviderError) return error
  if (error instanceof APIUserAbortError) return new OpenAIProviderError('cancelled')
  if (error instanceof APIConnectionTimeoutError) {
    return new OpenAIProviderError('timeout', { retryable: true })
  }
  if (error instanceof RateLimitError) {
    return new OpenAIProviderError('rate_limited', {
      retryable: true,
      requestId: normalizeRequestId(error.requestID),
      retryAfterMs: parseRetryAfterMs(error.headers)
    })
  }
  if (
    error instanceof AuthenticationError ||
    error instanceof PermissionDeniedError ||
    error instanceof NotFoundError
  ) {
    return new OpenAIProviderError('provider_configuration', {
      requestId: normalizeRequestId(error.requestID)
    })
  }
  if (error instanceof BadRequestError || error instanceof UnprocessableEntityError) {
    return new OpenAIProviderError('provider_rejected_request', {
      requestId: normalizeRequestId(error.requestID)
    })
  }
  if (error instanceof ConflictError || error instanceof InternalServerError || error instanceof APIConnectionError) {
    return new OpenAIProviderError('provider_unavailable', {
      retryable: true,
      requestId: normalizeRequestId(error.requestID)
    })
  }
  if (error instanceof APIError) {
    return new OpenAIProviderError('provider_unavailable', {
      retryable: error.status === 408 || error.status === 409 || error.status === 429 || Number(error.status) >= 500,
      requestId: normalizeRequestId(error.requestID)
    })
  }
  return new OpenAIProviderError('provider_unavailable')
}

function parseRetryAfterMs(headers: Headers): number | undefined {
  const millisecondValue = parseFiniteNumber(headers.get('retry-after-ms'))
  if (millisecondValue !== undefined) return boundRetryAfterMs(millisecondValue)

  const value = headers.get('retry-after')
  const seconds = parseFiniteNumber(value)
  if (seconds !== undefined) return boundRetryAfterMs(seconds * 1_000)
  if (!value) return undefined

  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? boundRetryAfterMs(Math.max(0, timestamp - Date.now())) : undefined
}

function parseFiniteNumber(value: string | null): number | undefined {
  if (value === null || !value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function boundRetryAfterMs(value: number): number {
  return Math.min(maxRetryAfterMs, Math.ceil(value))
}

function normalizeRequestId(value: string | null | undefined): string | undefined {
  return value && value.length <= 512 && visibleAsciiPattern.test(value) ? value : undefined
}

function requireBoundedInteger(value: number, maximum: number): void {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new OpenAIProviderError('invalid_request')
  }
}

function requireConfiguredValue(value: string): string {
  if (!value || value !== value.trim()) throw new OpenAIProviderError('provider_configuration')
  return value
}

function requireAllowedModel(value: string): 'gpt-5.6-luna' {
  if (value !== 'gpt-5.6-luna') throw new OpenAIProviderError('provider_configuration')
  return value
}

function normalizeFileSearchConfig(
  config: OpenAIAdapterConfig['fileSearch']
): Readonly<{ vectorStoreId: string }> | null {
  if (!config.enabled) return null
  return { vectorStoreId: requireConfiguredValue(config.vectorStoreId) }
}

function normalizeWebSearchConfig(
  config: OpenAIAdapterConfig['webSearch']
): Readonly<{ allowedDomains: readonly string[] }> | null {
  if (!config.enabled) return null
  if (!Array.isArray(config.allowedDomains) || config.allowedDomains.length < 1 || config.allowedDomains.length > 100) {
    throw new OpenAIProviderError('provider_configuration')
  }

  const allowedDomains = config.allowedDomains.map((value) => requireCanonicalDomain(value))
  if (new Set(allowedDomains).size !== allowedDomains.length) {
    throw new OpenAIProviderError('provider_configuration')
  }
  for (const [index, domain] of allowedDomains.entries()) {
    if (allowedDomains.some((other, otherIndex) => otherIndex !== index && domain.endsWith(`.${other}`))) {
      throw new OpenAIProviderError('provider_configuration')
    }
  }
  return Object.freeze({ allowedDomains: Object.freeze(allowedDomains) })
}

function requireCanonicalDomain(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 253 ||
    value !== value.toLowerCase() ||
    !value.includes('.') ||
    value.endsWith('.') ||
    isIP(value) !== 0 ||
    domainToASCII(value) !== value ||
    !value.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  ) {
    throw new OpenAIProviderError('provider_configuration')
  }
  try {
    if (new URL(`https://${value}`).hostname !== value) {
      throw new OpenAIProviderError('provider_configuration')
    }
  } catch (error) {
    if (error instanceof OpenAIProviderError) throw error
    throw new OpenAIProviderError('provider_configuration')
  }
  return value
}

function providerErrorMessage(code: OpenAIProviderErrorCode): string {
  switch (code) {
    case 'cancelled':
      return 'OpenAI request was cancelled'
    case 'timeout':
      return 'OpenAI request timed out'
    case 'rate_limited':
      return 'OpenAI request was rate limited'
    case 'provider_configuration':
      return 'OpenAI is not configured'
    case 'provider_rejected_request':
      return 'OpenAI rejected the request'
    case 'incomplete_response':
      return 'OpenAI returned an incomplete response'
    case 'invalid_response':
      return 'OpenAI returned an invalid response'
    case 'invalid_request':
      return 'OpenAI adapter input is invalid'
    case 'provider_unavailable':
      return 'OpenAI is temporarily unavailable'
  }
}
