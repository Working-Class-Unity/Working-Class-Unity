import type { ClientOptions } from 'openai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as runtime from '../server/utils/runtime'
import {
  OPENAI_FILE_SEARCH_MAX_RESULTS,
  OPENAI_MAX_OUTPUT_TOKENS,
  OPENAI_MAX_REQUEST_TIMEOUT_MS,
  OPENAI_WEB_CITATION_URL_MAX_LENGTH,
  OPENAI_WEB_SEARCH_CONTEXT_SIZE,
  OPENAI_WEB_SEARCH_MAX_CITATIONS,
  OpenAIProviderError,
  createOpenAIResponsesAdapter,
  getOpenAIResponsesAdapter,
  resetOpenAIResponsesAdapterForTests,
  type OpenAIResponseInput
} from '../server/services/ai/openai'
import type { AppRuntimeConfig } from '../server/utils/runtime'

const rawEnvelopeCanary = 'raw-provider-envelope-must-not-escape'
const providerErrorCanary = 'raw-provider-error-must-not-escape'
const webSearchText = 'A current answer cites source one and source two.'

afterEach(() => {
  resetOpenAIResponsesAdapterForTests()
  vi.restoreAllMocks()
})

describe('direct OpenAI Responses adapter', () => {
  it('sends the fixed private bounded request and returns only normalized visible data', async () => {
    const requests: Request[] = []
    const fakeFetch: NonNullable<ClientOptions['fetch']> = vi.fn(async (input, init) => {
      requests.push(new Request(input, init))
      return jsonResponse(successResponse(), {
        'x-request-id': 'request_openai_success'
      })
    })
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn'].map((method) =>
      vi.spyOn(console, method as 'debug').mockImplementation(() => undefined)
    )
    const originalLogLevel = process.env.OPENAI_LOG
    process.env.OPENAI_LOG = 'debug'

    try {
      const result = await createOpenAIResponsesAdapter(adapterConfig(), { fetch: fakeFetch }).createResponse(
        validInput()
      )

      expect(fakeFetch).toHaveBeenCalledOnce()
      expect(requests).toHaveLength(1)
      expect(requests[0].url).toBe('https://api.openai.com/v1/responses')
      expect(requests[0].method).toBe('POST')
      expect(requests[0].headers.get('authorization')).toBe('Bearer test-openai-key')
      expect(requests[0].headers.get('openai-project')).toBe('test-openai-project')
      expect(requests[0].headers.get('x-client-request-id')).toBe(validInput().requestId)
      await expect(requests[0].clone().json()).resolves.toEqual({
        model: 'gpt-5.6-luna',
        instructions: validInput().instructions,
        input: validInput().messages,
        store: false,
        background: false,
        reasoning: { effort: 'low' },
        max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
        truncation: 'disabled',
        prompt_cache_options: { mode: 'explicit' },
        safety_identifier: validInput().safetyIdentifier
      })
      expect(result).toEqual({
        kind: 'text',
        text: 'A safe visible answer.',
        citations: [],
        model: 'gpt-5.6-luna',
        requestId: 'request_openai_success',
        usage: {
          inputTokens: 20,
          outputTokens: 7,
          totalTokens: 27,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          reasoningTokens: 2
        }
      })
      expect(JSON.stringify(result)).not.toContain(rawEnvelopeCanary)
      for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled()
    } finally {
      restoreEnvironment('OPENAI_LOG', originalLogLevel)
    }
  })

  it('normalizes a refusal as visible application data without returning its envelope', async () => {
    const fakeFetch: NonNullable<ClientOptions['fetch']> = vi.fn(async () =>
      jsonResponse(refusalResponse(), { 'x-request-id': 'request_openai_refusal' })
    )
    const result = await createOpenAIResponsesAdapter(adapterConfig(), { fetch: fakeFetch }).createResponse(
      validInput()
    )

    expect(fakeFetch).toHaveBeenCalledOnce()
    expect(result).toEqual({
      kind: 'refusal',
      text: 'I cannot help with that request.',
      citations: [],
      model: 'gpt-5.6-luna',
      requestId: 'request_openai_refusal',
      usage: {
        inputTokens: 20,
        outputTokens: 7,
        totalTokens: 27,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        reasoningTokens: 2
      }
    })
    expect(JSON.stringify(result)).not.toContain(rawEnvelopeCanary)
  })

  it('adds one bounded deployment-owned File Search tool and returns only normalized citation titles', async () => {
    const requests: Request[] = []
    const fakeFetch: NonNullable<ClientOptions['fetch']> = vi.fn(async (input, init) => {
      requests.push(new Request(input, init))
      return jsonResponse(fileSearchResponse(), { 'x-request-id': 'request_openai_file_search' })
    })

    const result = await createOpenAIResponsesAdapter(fileSearchAdapterConfig(), { fetch: fakeFetch }).createResponse(
      validInput()
    )

    expect(fakeFetch).toHaveBeenCalledOnce()
    await expect(requests[0].clone().json()).resolves.toEqual({
      model: 'gpt-5.6-luna',
      instructions: validInput().instructions,
      input: validInput().messages,
      store: false,
      background: false,
      reasoning: { effort: 'low' },
      max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
      truncation: 'disabled',
      prompt_cache_options: { mode: 'explicit' },
      safety_identifier: validInput().safetyIdentifier,
      tools: [
        {
          type: 'file_search',
          vector_store_ids: ['vs_test_deployment_corpus'],
          max_num_results: OPENAI_FILE_SEARCH_MAX_RESULTS
        }
      ],
      tool_choice: 'auto',
      parallel_tool_calls: false,
      max_tool_calls: 1
    })
    expect(result).toEqual({
      kind: 'text',
      text: 'A grounded visible answer.',
      citations: [
        { type: 'file', title: 'Guide One.pdf' },
        { type: 'file', title: 'Guide Two.md' }
      ],
      model: 'gpt-5.6-luna',
      requestId: 'request_openai_file_search',
      usage: {
        inputTokens: 20,
        outputTokens: 7,
        totalTokens: 27,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        reasoningTokens: 2
      }
    })
    expect(JSON.stringify(result)).not.toContain('file_private')
    expect(JSON.stringify(result)).not.toContain(rawEnvelopeCanary)
  })

  it('adds one server-owned Web Search tool and returns only normalized, deduplicated allowlisted citations', async () => {
    const requests: Request[] = []
    const fakeFetch: NonNullable<ClientOptions['fetch']> = vi.fn(async (input, init) => {
      requests.push(new Request(input, init))
      return jsonResponse(webSearchResponse(), { 'x-request-id': 'request_openai_web_search' })
    })

    const result = await createOpenAIResponsesAdapter(webSearchAdapterConfig(), { fetch: fakeFetch }).createResponse(
      validInput()
    )

    expect(fakeFetch).toHaveBeenCalledOnce()
    await expect(requests[0].clone().json()).resolves.toEqual({
      model: 'gpt-5.6-luna',
      instructions: validInput().instructions,
      input: validInput().messages,
      store: false,
      background: false,
      reasoning: { effort: 'low' },
      max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
      truncation: 'disabled',
      prompt_cache_options: { mode: 'explicit' },
      safety_identifier: validInput().safetyIdentifier,
      tools: [
        {
          type: 'web_search',
          filters: { allowed_domains: ['example.com', 'reference.test'] },
          search_context_size: OPENAI_WEB_SEARCH_CONTEXT_SIZE
        }
      ],
      tool_choice: 'auto',
      parallel_tool_calls: false,
      max_tool_calls: 1
    })
    expect(result).toEqual({
      kind: 'text',
      text: webSearchText,
      citations: [
        {
          type: 'web',
          title: 'Current reference',
          url: 'https://news.example.com/current?source=openai',
          startIndex: 17,
          endIndex: 25
        },
        {
          type: 'web',
          title: 'Current reference',
          url: 'https://news.example.com/current?source=openai',
          startIndex: 27,
          endIndex: 35
        }
      ],
      model: 'gpt-5.6-luna',
      requestId: 'request_openai_web_search',
      usage: {
        inputTokens: 20,
        outputTokens: 7,
        totalTokens: 27,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        reasoningTokens: 2
      }
    })
    expect(JSON.stringify(result)).not.toContain('query_private')
    expect(JSON.stringify(result)).not.toContain(rawEnvelopeCanary)
  })

  it.each([
    {
      label: 'search without an expanded source list',
      action: { type: 'search', queries: ['provider-only-query'] }
    },
    {
      label: 'open_page',
      action: { type: 'open_page', url: 'https://reference.test/opened-provider-page' }
    },
    {
      label: 'find_in_page',
      action: {
        type: 'find_in_page',
        url: 'https://news.example.com/searched-provider-page',
        pattern: 'provider-only-pattern'
      }
    }
  ])('accepts a completed allowlisted $label action without exposing provider action data', async ({ action }) => {
    const body = webSearchResponse()
    body.output = [{ ...webSearchCall(), action }, ...body.output.slice(1)]
    const fakeFetch: NonNullable<ClientOptions['fetch']> = vi.fn(async () => jsonResponse(body))

    const result = await createOpenAIResponsesAdapter(webSearchAdapterConfig(), { fetch: fakeFetch }).createResponse(
      validInput()
    )

    expect(result).toMatchObject({ kind: 'text', citations: expect.any(Array) })
    expect(JSON.stringify(result)).not.toContain('provider-page')
    expect(JSON.stringify(result)).not.toContain('provider-only-pattern')
    expect(JSON.stringify(result)).not.toContain('provider-only-query')
  })

  it('offers File Search and Web Search together while preserving one total built-in call', async () => {
    const requests: Request[] = []
    const fakeFetch: NonNullable<ClientOptions['fetch']> = vi.fn(async (input, init) => {
      requests.push(new Request(input, init))
      return jsonResponse(successResponse())
    })

    await createOpenAIResponsesAdapter(combinedSearchAdapterConfig(), { fetch: fakeFetch }).createResponse(validInput())

    const body = (await requests[0]!.clone().json()) as Record<string, unknown>
    expect(body).toMatchObject({
      tools: [
        {
          type: 'file_search',
          vector_store_ids: ['vs_test_deployment_corpus'],
          max_num_results: OPENAI_FILE_SEARCH_MAX_RESULTS
        },
        {
          type: 'web_search',
          filters: { allowed_domains: ['example.com', 'reference.test'] },
          search_context_size: OPENAI_WEB_SEARCH_CONTEXT_SIZE
        }
      ],
      tool_choice: 'auto',
      parallel_tool_calls: false,
      max_tool_calls: 1
    })
    expect(body).not.toHaveProperty('include')
    expect(JSON.stringify(body)).not.toContain('user_location')
    expect(JSON.stringify(body)).not.toContain('external_web_access')
    expect(JSON.stringify(body)).not.toContain('blocked_domains')
    expect(JSON.stringify(body)).not.toContain('return_token_budget')
  })

  it.each([
    { label: 'File Search', body: fileSearchResponse(), citationType: 'file' },
    { label: 'Web Search', body: webSearchResponse(), citationType: 'web' }
  ])('accepts one completed $label call when both tools are available', async ({ body, citationType }) => {
    const fakeFetch: NonNullable<ClientOptions['fetch']> = vi.fn(async () => jsonResponse(body))

    const result = await createOpenAIResponsesAdapter(combinedSearchAdapterConfig(), {
      fetch: fakeFetch
    }).createResponse(validInput())

    expect(result.citations[0]?.type).toBe(citationType)
  })

  it('leaves the disabled request tool-free even when stale subordinate values exist', async () => {
    const requests: Request[] = []
    const fakeFetch: NonNullable<ClientOptions['fetch']> = vi.fn(async (input, init) => {
      requests.push(new Request(input, init))
      return jsonResponse(successResponse())
    })
    const config = {
      ...adapterConfig(),
      fileSearch: { enabled: false, vectorStoreId: 'vs_stale_ignored' },
      webSearch: { enabled: false, allowedDomains: ['stale.example'] }
    } as const

    await createOpenAIResponsesAdapter(config, { fetch: fakeFetch }).createResponse(validInput())

    const body = (await requests[0].clone().json()) as Record<string, unknown>
    expect(body).not.toHaveProperty('tools')
    expect(body).not.toHaveProperty('tool_choice')
    expect(body).not.toHaveProperty('parallel_tool_calls')
    expect(body).not.toHaveProperty('max_tool_calls')
    expect(JSON.stringify(body)).not.toContain('vs_stale_ignored')
    expect(JSON.stringify(body)).not.toContain('stale.example')
  })

  it('guards, lazily constructs, caches, and resets the production adapter without making a live request', async () => {
    const fakeFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(successResponse(), {
        'x-request-id': 'request_openai_lazy'
      })
    )
    const disabledConfig = adapterRuntimeConfig(false)

    expect(() => getOpenAIResponsesAdapter(disabledConfig)).toThrowError(
      expect.objectContaining({
        statusCode: 404,
        data: { code: 'MODULE_DISABLED', module: 'ai' }
      })
    )
    expect(fakeFetch).not.toHaveBeenCalled()

    const readyConfig = adapterRuntimeConfig(true)
    const runtimeConfig = vi.spyOn(runtime, 'getAppRuntimeConfig').mockReturnValue(readyConfig)
    const first = getOpenAIResponsesAdapter()

    expect(getOpenAIResponsesAdapter(readyConfig)).toBe(first)
    expect(fakeFetch).not.toHaveBeenCalled()
    await expect(getOpenAIResponsesAdapter().createResponse(validInput())).resolves.toMatchObject({
      kind: 'text',
      requestId: 'request_openai_lazy'
    })
    expect(runtimeConfig).toHaveBeenCalledTimes(2)
    expect(fakeFetch).toHaveBeenCalledOnce()

    resetOpenAIResponsesAdapterForTests()
    expect(getOpenAIResponsesAdapter(readyConfig)).not.toBe(first)
  })

  it.each([
    { apiKey: '' },
    { apiKey: ' test-openai-key' },
    { projectId: '' },
    { projectId: 'test-openai-project ' },
    { model: '' },
    { model: 'gpt-unapproved' },
    { fileSearch: { enabled: true, vectorStoreId: '' } },
    { fileSearch: { enabled: true, vectorStoreId: ' vs_untrimmed' } },
    { webSearch: { enabled: true, allowedDomains: [] } },
    { webSearch: { enabled: true, allowedDomains: ['Example.com'] } },
    { webSearch: { enabled: true, allowedDomains: ['127.0.0.01'] } },
    { webSearch: { enabled: true, allowedDomains: ['*.example.com'] } },
    { webSearch: { enabled: true, allowedDomains: ['example.com', 'news.example.com'] } },
    { webSearch: { enabled: true, allowedDomains: ['example.com', 'example.com'] } }
  ])('rejects incomplete or altered provider configuration: %o', (override) => {
    expect(() =>
      createOpenAIResponsesAdapter({
        ...adapterConfig(),
        ...override
      } as unknown as ReturnType<typeof adapterConfig>)
    ).toThrowError(expect.objectContaining({ code: 'provider_configuration' }))
  })

  it.each([
    [429, 'rate_limited', true],
    [500, 'provider_unavailable', true],
    [401, 'provider_configuration', false],
    [400, 'provider_rejected_request', false],
    [403, 'provider_configuration', false],
    [404, 'provider_configuration', false],
    [408, 'provider_unavailable', true],
    [409, 'provider_unavailable', true],
    [418, 'provider_unavailable', false],
    [422, 'provider_rejected_request', false],
    [502, 'provider_unavailable', true]
  ] as const)('normalizes HTTP %i without an SDK retry or raw error leakage', async (status, code, retryable) => {
    const fakeFetch: NonNullable<ClientOptions['fetch']> = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            message: providerErrorCanary,
            type: 'provider_error',
            code: 'provider_canary'
          }
        },
        {
          'x-request-id': `request_openai_${status}`,
          'retry-after': status === 429 ? '2' : ''
        },
        status
      )
    )
    const adapter = createOpenAIResponsesAdapter(adapterConfig(), { fetch: fakeFetch })

    const error = await adapter.createResponse(validInput()).catch((caught: unknown) => caught)

    expect(fakeFetch).toHaveBeenCalledOnce()
    expect(error).toBeInstanceOf(OpenAIProviderError)
    expect(error).toMatchObject({ code, retryable, requestId: `request_openai_${status}` })
    if (status === 429) expect(error).toMatchObject({ retryAfterMs: 2_000 })
    expect((error as Error).message).not.toContain(providerErrorCanary)
    expect((error as Error).stack).not.toContain(providerErrorCanary)
    expect(JSON.stringify(error)).not.toContain(providerErrorCanary)
  })

  it.each([
    {
      label: 'millisecond header',
      headers: { 'retry-after-ms': '12.2' },
      expected: 13
    },
    {
      label: 'fractional-second header',
      headers: { 'retry-after': '1.25' },
      expected: 1_250
    },
    {
      label: 'maximum bound',
      headers: { 'retry-after-ms': String(48 * 60 * 60 * 1_000) },
      expected: 24 * 60 * 60 * 1_000
    },
    {
      label: 'missing header',
      headers: {},
      expected: undefined
    },
    {
      label: 'blank header',
      headers: { 'retry-after': ' ' },
      expected: undefined
    },
    {
      label: 'negative millisecond header',
      headers: { 'retry-after-ms': '-1' },
      expected: undefined
    },
    {
      label: 'non-finite millisecond header',
      headers: { 'retry-after-ms': 'Infinity' },
      expected: undefined
    },
    {
      label: 'invalid date header',
      headers: { 'retry-after': 'not-a-date' },
      expected: undefined
    }
  ])('normalizes retry timing from a $label', async ({ headers, expected }) => {
    const error = await rateLimitError(headers)

    expect(error).toMatchObject({ code: 'rate_limited', retryable: true })
    expect(error.retryAfterMs).toBe(expected)
  })

  it('normalizes an HTTP-date retry hint relative to the current time', async () => {
    const now = Date.parse('2026-07-16T12:00:00.000Z')
    vi.spyOn(Date, 'now').mockReturnValue(now)

    const future = await rateLimitError({
      'retry-after': new Date(now + 5_000).toUTCString()
    })
    const past = await rateLimitError({
      'retry-after': new Date(now - 5_000).toUTCString()
    })

    expect(future.retryAfterMs).toBe(5_000)
    expect(past.retryAfterMs).toBe(0)
  })

  it('normalizes connection failures without retaining their cause and calls fetch once', async () => {
    const fakeFetch: NonNullable<ClientOptions['fetch']> = vi.fn(async () => {
      throw new Error(providerErrorCanary)
    })
    const adapter = createOpenAIResponsesAdapter(adapterConfig(), { fetch: fakeFetch })

    const error = await adapter.createResponse(validInput()).catch((caught: unknown) => caught)

    expect(fakeFetch).toHaveBeenCalledOnce()
    expect(error).toMatchObject({ code: 'provider_unavailable', retryable: true })
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined()
    expect((error as Error).message).not.toContain(providerErrorCanary)
    expect((error as Error).stack).not.toContain(providerErrorCanary)
  })

  it('sanitizes a malformed JSON response as an unknown provider failure', async () => {
    const fakeFetch: NonNullable<ClientOptions['fetch']> = vi.fn(
      async () => new Response('{not-json', { headers: { 'content-type': 'application/json' } })
    )

    const error = await createOpenAIResponsesAdapter(adapterConfig(), { fetch: fakeFetch })
      .createResponse(validInput())
      .catch((caught: unknown) => caught)

    expect(fakeFetch).toHaveBeenCalledOnce()
    expect(error).toMatchObject({ code: 'provider_unavailable', retryable: false })
    expect((error as Error).message).not.toContain('not-json')
  })

  it('enforces the caller timeout without retrying', async () => {
    const fakeFetch: NonNullable<ClientOptions['fetch']> = vi.fn(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException(providerErrorCanary, 'AbortError')), {
            once: true
          })
        })
    )
    const adapter = createOpenAIResponsesAdapter(adapterConfig(), { fetch: fakeFetch })

    const error = await adapter.createResponse({ ...validInput(), timeoutMs: 1 }).catch((caught: unknown) => caught)

    expect(fakeFetch).toHaveBeenCalledOnce()
    expect(error).toMatchObject({ code: 'timeout', retryable: true })
    expect((error as Error).message).not.toContain(providerErrorCanary)
  })

  it('honors caller cancellation before making a provider request', async () => {
    const fakeFetch: NonNullable<ClientOptions['fetch']> = vi.fn(async () => jsonResponse(successResponse()))
    const controller = new AbortController()
    controller.abort()
    const adapter = createOpenAIResponsesAdapter(adapterConfig(), { fetch: fakeFetch })

    await expect(adapter.createResponse({ ...validInput(), signal: controller.signal })).rejects.toMatchObject({
      code: 'cancelled',
      retryable: false
    })
    expect(fakeFetch).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: 'incomplete status',
      body: { ...successResponse(), status: 'incomplete' },
      code: 'incomplete_response'
    },
    {
      label: 'provider error',
      body: { ...successResponse(), error: { code: 'provider_error', message: rawEnvelopeCanary } },
      code: 'incomplete_response'
    },
    {
      label: 'incomplete details',
      body: { ...successResponse(), incomplete_details: { reason: 'max_output_tokens' } },
      code: 'incomplete_response'
    },
    {
      label: 'unexpected model',
      body: { ...successResponse(), model: 'unexpected-model' },
      code: 'invalid_response'
    },
    {
      label: 'unsupported output item',
      body: {
        ...successResponse(),
        output: [{ id: 'image_private', type: 'image_generation_call', status: 'completed' }]
      },
      code: 'invalid_response'
    },
    {
      label: 'missing message output',
      body: {
        ...successResponse(),
        output: [{ id: 'reasoning_private', type: 'reasoning', summary: [] }]
      },
      code: 'invalid_response'
    },
    {
      label: 'incomplete message output',
      body: {
        ...successResponse(),
        output: [assistantMessage([{ type: 'output_text', text: 'not complete', annotations: [] }], 'incomplete')]
      },
      code: 'invalid_response'
    },
    {
      label: 'annotated text',
      body: {
        ...successResponse(),
        output: [
          assistantMessage([
            {
              type: 'output_text',
              text: 'citation-bearing text is outside this baseline contract',
              annotations: [
                { type: 'url_citation', url: 'https://example.test', title: 'Example', start_index: 0, end_index: 1 }
              ]
            }
          ])
        ]
      },
      code: 'invalid_response'
    },
    {
      label: 'mixed text and refusal',
      body: {
        ...successResponse(),
        output: [
          assistantMessage([
            { type: 'output_text', text: 'partial text', annotations: [] },
            { type: 'refusal', refusal: 'partial refusal' }
          ])
        ]
      },
      code: 'invalid_response'
    },
    {
      label: 'empty text',
      body: {
        ...successResponse(),
        output: [assistantMessage([{ type: 'output_text', text: '  ', annotations: [] }])]
      },
      code: 'invalid_response'
    },
    {
      label: 'empty refusal',
      body: {
        ...successResponse(),
        output: [assistantMessage([{ type: 'refusal', refusal: '  ' }])]
      },
      code: 'invalid_response'
    },
    {
      label: 'unknown message content',
      body: {
        ...successResponse(),
        output: [assistantMessage([{ type: 'unknown_private_content', value: rawEnvelopeCanary }])]
      },
      code: 'invalid_response'
    },
    {
      label: 'known text mixed with unknown message content',
      body: {
        ...successResponse(),
        output: [
          assistantMessage([
            { type: 'output_text', text: 'do not accept a partial projection', annotations: [] },
            { type: 'unknown_private_content', value: rawEnvelopeCanary }
          ])
        ]
      },
      code: 'invalid_response'
    },
    {
      label: 'unexpected message role',
      body: {
        ...successResponse(),
        output: [
          {
            ...assistantMessage([{ type: 'output_text', text: 'wrong role', annotations: [] }]),
            role: 'user'
          }
        ]
      },
      code: 'invalid_response'
    }
  ])('rejects $label without leaking its provider envelope', async ({ body, code }) => {
    const fakeFetch: NonNullable<ClientOptions['fetch']> = vi.fn(async () =>
      jsonResponse(body, { 'x-request-id': 'request_openai_invalid' })
    )
    const error = await createOpenAIResponsesAdapter(adapterConfig(), { fetch: fakeFetch })
      .createResponse(validInput())
      .catch((caught: unknown) => caught)

    expect(fakeFetch).toHaveBeenCalledOnce()
    expect(error).toBeInstanceOf(OpenAIProviderError)
    expect(error).toMatchObject({ code, requestId: 'request_openai_invalid' })
    expect(JSON.stringify(error)).not.toContain(rawEnvelopeCanary)
  })

  it.each([
    {
      label: 'File Search output while disabled',
      config: adapterConfig(),
      body: fileSearchResponse()
    },
    {
      label: 'citation without a completed File Search call',
      config: fileSearchAdapterConfig(),
      body: {
        ...fileSearchResponse(),
        output: fileSearchResponse().output.filter((item) => item.type !== 'file_search_call')
      }
    },
    {
      label: 'multiple File Search calls',
      config: fileSearchAdapterConfig(),
      body: {
        ...fileSearchResponse(),
        output: [fileSearchCall(), fileSearchCall('search_private_second'), ...fileSearchResponse().output.slice(1)]
      }
    },
    {
      label: 'non-completed File Search call',
      config: fileSearchAdapterConfig(),
      body: {
        ...fileSearchResponse(),
        output: [{ ...fileSearchCall(), status: 'failed' }, ...fileSearchResponse().output.slice(1)]
      }
    },
    {
      label: 'unsupported citation type',
      config: fileSearchAdapterConfig(),
      body: fileSearchResponse([{ type: 'container_file_citation', container_id: 'container_private' }])
    },
    {
      label: 'null citation annotation',
      config: fileSearchAdapterConfig(),
      body: fileSearchResponse([null])
    },
    {
      label: 'non-string provider file ID',
      config: fileSearchAdapterConfig(),
      body: fileSearchResponse([{ type: 'file_citation', file_id: 42, filename: 'Guide.pdf', index: 0 }])
    },
    {
      label: 'non-string citation title',
      config: fileSearchAdapterConfig(),
      body: fileSearchResponse([{ type: 'file_citation', file_id: 'file_private_one', filename: 42, index: 0 }])
    },
    {
      label: 'blank citation title',
      config: fileSearchAdapterConfig(),
      body: fileSearchResponse([fileCitation('file_private_one', '   ')])
    },
    {
      label: 'control character in citation title',
      config: fileSearchAdapterConfig(),
      body: fileSearchResponse([fileCitation('file_private_one', 'unsafe\u202etitle.pdf')])
    },
    {
      label: 'invalid provider file ID',
      config: fileSearchAdapterConfig(),
      body: fileSearchResponse([fileCitation('file private one', 'Guide.pdf')])
    },
    {
      label: 'one provider file ID with conflicting titles',
      config: fileSearchAdapterConfig(),
      body: fileSearchResponse([
        fileCitation('file_private_one', 'Guide One.pdf'),
        fileCitation('file_private_one', 'Guide Two.pdf')
      ])
    },
    {
      label: 'one title assigned to conflicting provider files',
      config: fileSearchAdapterConfig(),
      body: fileSearchResponse([
        fileCitation('file_private_one', 'Guide.pdf'),
        fileCitation('file_private_two', 'Guide.pdf')
      ])
    },
    {
      label: 'more unique citations than the retrieval result ceiling',
      config: fileSearchAdapterConfig(),
      body: fileSearchResponse(
        Array.from({ length: OPENAI_FILE_SEARCH_MAX_RESULTS + 1 }, (_, index) =>
          fileCitation(`file_private_${index}`, `Guide ${index}.pdf`)
        )
      )
    }
  ])('rejects $label without retaining provider-only File Search data', async ({ config, body }) => {
    const fakeFetch: NonNullable<ClientOptions['fetch']> = vi.fn(async () =>
      jsonResponse(body, { 'x-request-id': 'request_openai_invalid_file_search' })
    )

    const error = await createOpenAIResponsesAdapter(config, { fetch: fakeFetch })
      .createResponse(validInput())
      .catch((caught: unknown) => caught)

    expect(fakeFetch).toHaveBeenCalledOnce()
    expect(error).toMatchObject({ code: 'invalid_response', requestId: 'request_openai_invalid_file_search' })
    expect(JSON.stringify(error)).not.toContain('file_private')
    expect(JSON.stringify(error)).not.toContain(rawEnvelopeCanary)
  })

  it('accepts a completed automatic search with no citations', async () => {
    const fakeFetch: NonNullable<ClientOptions['fetch']> = vi.fn(async () =>
      jsonResponse(fileSearchResponse([]), { 'x-request-id': 'request_openai_empty_file_search' })
    )

    await expect(
      createOpenAIResponsesAdapter(fileSearchAdapterConfig(), { fetch: fakeFetch }).createResponse(validInput())
    ).resolves.toMatchObject({ kind: 'text', citations: [] })
  })

  it.each([
    {
      label: 'Web Search output while disabled',
      config: adapterConfig(),
      body: webSearchResponse()
    },
    {
      label: 'citation without a completed Web Search call',
      config: webSearchAdapterConfig(),
      body: {
        ...webSearchResponse(),
        output: webSearchResponse().output.filter((item) => item.type !== 'web_search_call')
      }
    },
    {
      label: 'multiple Web Search calls',
      config: webSearchAdapterConfig(),
      body: {
        ...webSearchResponse(),
        output: [webSearchCall(), webSearchCall('web_search_private_second'), ...webSearchResponse().output.slice(1)]
      }
    },
    {
      label: 'File Search and Web Search calls in one response',
      config: combinedSearchAdapterConfig(),
      body: {
        ...webSearchResponse(),
        output: [fileSearchCall(), ...webSearchResponse().output]
      }
    },
    {
      label: 'failed Web Search call',
      config: webSearchAdapterConfig(),
      body: {
        ...webSearchResponse(),
        output: [{ ...webSearchCall(), status: 'failed' }, ...webSearchResponse().output.slice(1)]
      }
    },
    {
      label: 'unsupported Web Search action',
      config: webSearchAdapterConfig(),
      body: {
        ...webSearchResponse(),
        output: [
          { ...webSearchCall(), action: { type: 'private_unknown_action', query: rawEnvelopeCanary } },
          ...webSearchResponse().output.slice(1)
        ]
      }
    },
    {
      label: 'null Web Search action',
      config: webSearchAdapterConfig(),
      body: {
        ...webSearchResponse(),
        output: [{ ...webSearchCall(), action: null }, ...webSearchResponse().output.slice(1)]
      }
    },
    {
      label: 'foreign Web Search source URL',
      config: webSearchAdapterConfig(),
      body: {
        ...webSearchResponse(),
        output: [
          {
            ...webSearchCall(),
            action: {
              type: 'search',
              queries: ['query_private'],
              sources: [{ type: 'url', url: 'https://foreign.example/source' }]
            }
          },
          ...webSearchResponse().output.slice(1)
        ]
      }
    },
    {
      label: 'foreign open-page URL',
      config: webSearchAdapterConfig(),
      body: {
        ...webSearchResponse(),
        output: [
          { ...webSearchCall(), action: { type: 'open_page', url: 'https://foreign.example/page' } },
          ...webSearchResponse().output.slice(1)
        ]
      }
    },
    {
      label: 'foreign find-in-page URL',
      config: webSearchAdapterConfig(),
      body: {
        ...webSearchResponse(),
        output: [
          {
            ...webSearchCall(),
            action: { type: 'find_in_page', url: 'https://foreign.example/page', pattern: 'query_private' }
          },
          ...webSearchResponse().output.slice(1)
        ]
      }
    },
    {
      label: 'searched text without a URL citation',
      config: webSearchAdapterConfig(),
      body: webSearchResponse([])
    },
    {
      label: 'File citation after a Web Search call',
      config: webSearchAdapterConfig(),
      body: webSearchResponse([fileCitation('file_private_one', 'Guide.pdf')])
    },
    {
      label: 'null Web citation',
      config: webSearchAdapterConfig(),
      body: webSearchResponse([null])
    },
    {
      label: 'non-string Web citation title',
      config: webSearchAdapterConfig(),
      body: webSearchResponse([webCitation('https://example.com/source', 42, 0, 1)])
    },
    {
      label: 'unsafe-scheme citation URL',
      config: webSearchAdapterConfig(),
      body: webSearchResponse([webCitation('http://example.com/source', 'Example', 0, 1)])
    },
    {
      label: 'credential-bearing citation URL',
      config: webSearchAdapterConfig(),
      body: webSearchResponse([webCitation('https://user:secret@example.com/source', 'Example', 0, 1)])
    },
    {
      label: 'nondefault-port citation URL',
      config: webSearchAdapterConfig(),
      body: webSearchResponse([webCitation('https://example.com:444/source', 'Example', 0, 1)])
    },
    {
      label: 'foreign suffix-lookalike citation URL',
      config: webSearchAdapterConfig(),
      body: webSearchResponse([webCitation('https://notexample.com/source', 'Example', 0, 1)])
    },
    {
      label: 'malformed citation URL',
      config: webSearchAdapterConfig(),
      body: webSearchResponse([webCitation('not a URL', 'Example', 0, 1)])
    },
    {
      label: 'oversized citation URL',
      config: webSearchAdapterConfig(),
      body: webSearchResponse([
        webCitation(`https://example.com/${'a'.repeat(OPENAI_WEB_CITATION_URL_MAX_LENGTH)}`, 'Example', 0, 1)
      ])
    },
    {
      label: 'citation URL oversized after canonical encoding',
      config: webSearchAdapterConfig(),
      body: webSearchResponse([webCitation(`https://example.com/${'é'.repeat(1_000)}`, 'Example', 0, 1)])
    },
    {
      label: 'control character in Web citation title',
      config: webSearchAdapterConfig(),
      body: webSearchResponse([webCitation('https://example.com/source', 'unsafe\u202etitle', 0, 1)])
    },
    {
      label: 'one URL with conflicting titles',
      config: webSearchAdapterConfig(),
      body: webSearchResponse([
        webCitation('https://example.com/source', 'First title', 0, 1),
        webCitation('https://example.com/source', 'Second title', 2, 3)
      ])
    },
    {
      label: 'fractional citation start index',
      config: webSearchAdapterConfig(),
      body: webSearchResponse([webCitation('https://example.com/source', 'Example', 0.5, 1)])
    },
    {
      label: 'negative citation start index',
      config: webSearchAdapterConfig(),
      body: webSearchResponse([webCitation('https://example.com/source', 'Example', -1, 1)])
    },
    {
      label: 'inverted citation span',
      config: webSearchAdapterConfig(),
      body: webSearchResponse([webCitation('https://example.com/source', 'Example', 2, 2)])
    },
    {
      label: 'citation end beyond its text part',
      config: webSearchAdapterConfig(),
      body: webSearchResponse([webCitation('https://example.com/source', 'Example', 0, webSearchText.length + 1)])
    },
    {
      label: 'more Web citations than the application ceiling',
      config: webSearchAdapterConfig(),
      body: webSearchResponse(
        Array.from({ length: OPENAI_WEB_SEARCH_MAX_CITATIONS + 1 }, (_, index) =>
          webCitation(`https://example.com/source-${index}`, `Example ${index}`, 0, 1)
        )
      )
    },
    {
      label: 'multipart citation offsets',
      config: webSearchAdapterConfig(),
      body: {
        ...webSearchResponse(),
        output: [
          webSearchCall(),
          assistantMessage([
            { type: 'output_text', text: 'First part.', annotations: [] },
            {
              type: 'output_text',
              text: 'Second part.',
              annotations: [webCitation('https://example.com/source', 'Example', 0, 1)]
            }
          ])
        ]
      }
    }
  ])('rejects $label without retaining provider-only Web Search data', async ({ config, body }) => {
    const fakeFetch: NonNullable<ClientOptions['fetch']> = vi.fn(async () =>
      jsonResponse(body, { 'x-request-id': 'request_openai_invalid_web_search' })
    )

    const error = await createOpenAIResponsesAdapter(config, { fetch: fakeFetch })
      .createResponse(validInput())
      .catch((caught: unknown) => caught)

    expect(fakeFetch).toHaveBeenCalledOnce()
    expect(error).toMatchObject({ code: 'invalid_response', requestId: 'request_openai_invalid_web_search' })
    expect(JSON.stringify(error)).not.toContain('query_private')
    expect(JSON.stringify(error)).not.toContain(rawEnvelopeCanary)
  })

  it('accepts an uncited refusal after one completed Web Search call', async () => {
    const fakeFetch: NonNullable<ClientOptions['fetch']> = vi.fn(async () =>
      jsonResponse({
        ...refusalResponse(),
        output: [webSearchCall(), ...refusalResponse().output]
      })
    )

    await expect(
      createOpenAIResponsesAdapter(webSearchAdapterConfig(), { fetch: fakeFetch }).createResponse(validInput())
    ).resolves.toMatchObject({ kind: 'refusal', citations: [] })
  })

  it.each([
    { label: 'missing usage', invalidUsage: undefined },
    { label: 'fractional token count', invalidUsage: { ...usage(), input_tokens: 1.5 } },
    { label: 'negative token count', invalidUsage: { ...usage(), input_tokens: -1 } },
    { label: 'inconsistent total', invalidUsage: { ...usage(), total_tokens: 28 } },
    {
      label: 'cached input beyond input',
      invalidUsage: { ...usage(), input_tokens_details: { cached_tokens: 21, cache_write_tokens: 0 } }
    },
    {
      label: 'cache write beyond input',
      invalidUsage: { ...usage(), input_tokens_details: { cached_tokens: 0, cache_write_tokens: 21 } }
    },
    {
      label: 'reasoning beyond output',
      invalidUsage: { ...usage(), output_tokens_details: { reasoning_tokens: 8 } }
    },
    {
      label: 'unexpected cached input',
      invalidUsage: { ...usage(), input_tokens_details: { cached_tokens: 1, cache_write_tokens: 0 } }
    },
    {
      label: 'unexpected cache write',
      invalidUsage: { ...usage(), input_tokens_details: { cached_tokens: 0, cache_write_tokens: 1 } }
    }
  ])('rejects $label usage without exposing provider data', async ({ invalidUsage }) => {
    const fakeFetch: NonNullable<ClientOptions['fetch']> = vi.fn(async () =>
      jsonResponse({ ...successResponse(), usage: invalidUsage }, { 'x-request-id': 'request_openai_invalid_usage' })
    )

    const error = await createOpenAIResponsesAdapter(adapterConfig(), { fetch: fakeFetch })
      .createResponse(validInput())
      .catch((caught: unknown) => caught)

    expect(fakeFetch).toHaveBeenCalledOnce()
    expect(error).toMatchObject({ code: 'invalid_response', requestId: 'request_openai_invalid_usage' })
    expect(JSON.stringify(error)).not.toContain(rawEnvelopeCanary)
  })

  it.each([
    { label: 'missing', requestId: undefined },
    { label: 'empty', requestId: '' },
    { label: 'non-visible ASCII', requestId: 'request id' },
    { label: 'too long', requestId: 'r'.repeat(513) }
  ])('omits a $label provider request ID from normalized visible data', async ({ requestId }) => {
    const headers = requestId === undefined ? {} : { 'x-request-id': requestId }
    const fakeFetch: NonNullable<ClientOptions['fetch']> = vi.fn(async () => jsonResponse(successResponse(), headers))

    const result = await createOpenAIResponsesAdapter(adapterConfig(), { fetch: fakeFetch }).createResponse(
      validInput()
    )

    expect(result).toMatchObject({ kind: 'text' })
    expect(result.requestId).toBeUndefined()
  })

  it('accepts a history message over 32,000 characters when the rendered context stays within 200,000 bytes', async () => {
    const largeHistoryMessage = 'a'.repeat(40_000)
    const requests: Request[] = []
    const fakeFetch: NonNullable<ClientOptions['fetch']> = vi.fn(async (input, init) => {
      requests.push(new Request(input, init))
      return jsonResponse(successResponse())
    })
    const adapter = createOpenAIResponsesAdapter(adapterConfig(), { fetch: fakeFetch })

    await expect(
      adapter.createResponse({
        ...validInput(),
        messages: [
          { role: 'user', content: 'Earlier question' },
          { role: 'assistant', content: largeHistoryMessage },
          { role: 'user', content: 'Current question' }
        ]
      })
    ).resolves.toMatchObject({ kind: 'text' })

    expect(fakeFetch).toHaveBeenCalledOnce()
    const body = (await requests[0].clone().json()) as { input: Array<{ content: string }> }
    expect(body.input[1]?.content).toBe(largeHistoryMessage)
  })

  it.each([
    {
      label: 'multibyte instructions beyond 32,000 UTF-8 bytes',
      override: { instructions: '🙂'.repeat(8_001) }
    },
    {
      label: 'messages beyond the 200,000-byte rendered context',
      override: {
        instructions: 'i',
        messages: [{ role: 'user' as const, content: 'a'.repeat(199_968) }]
      }
    }
  ])('rejects $label before any provider call', async ({ override }) => {
    const fakeFetch: NonNullable<ClientOptions['fetch']> = vi.fn(async () => jsonResponse(successResponse()))
    const adapter = createOpenAIResponsesAdapter(adapterConfig(), { fetch: fakeFetch })

    await expect(adapter.createResponse({ ...validInput(), ...override } as OpenAIResponseInput)).rejects.toMatchObject(
      {
        code: 'invalid_request'
      }
    )
    expect(fakeFetch).not.toHaveBeenCalled()
  })

  it.each([
    { instructions: '   ' },
    { messages: [] },
    { messages: [{ role: 'system', content: 'not allowed' }] },
    { messages: [{ role: 'user', content: '   ' }] },
    { timeoutMs: 1.5 },
    { timeoutMs: 0 },
    { timeoutMs: OPENAI_MAX_REQUEST_TIMEOUT_MS + 1 },
    { maxOutputTokens: 1.5 },
    { maxOutputTokens: 0 },
    { maxOutputTokens: OPENAI_MAX_OUTPUT_TOKENS + 1 },
    { safetyIdentifier: 'too-short' },
    { safetyIdentifier: 'a'.repeat(65) },
    { safetyIdentifier: 'person@example.test' },
    { requestId: '' },
    { requestId: 'r'.repeat(513) },
    { requestId: 'contains a space' }
  ])('rejects out-of-contract input before any provider call: %o', async (override) => {
    const fakeFetch: NonNullable<ClientOptions['fetch']> = vi.fn(async () => jsonResponse(successResponse()))
    const adapter = createOpenAIResponsesAdapter(adapterConfig(), { fetch: fakeFetch })

    await expect(adapter.createResponse({ ...validInput(), ...override })).rejects.toMatchObject({
      code: 'invalid_request'
    })
    expect(fakeFetch).not.toHaveBeenCalled()
  })
})

function adapterConfig() {
  return {
    apiKey: 'test-openai-key',
    projectId: 'test-openai-project',
    model: 'gpt-5.6-luna',
    fileSearch: { enabled: false, vectorStoreId: '' },
    webSearch: { enabled: false, allowedDomains: [] }
  } as const
}

function fileSearchAdapterConfig() {
  return {
    ...adapterConfig(),
    fileSearch: { enabled: true, vectorStoreId: 'vs_test_deployment_corpus' }
  } as const
}

function webSearchAdapterConfig() {
  return {
    ...adapterConfig(),
    webSearch: { enabled: true, allowedDomains: ['example.com', 'reference.test'] }
  } as const
}

function combinedSearchAdapterConfig() {
  return {
    ...fileSearchAdapterConfig(),
    webSearch: { enabled: true, allowedDomains: ['example.com', 'reference.test'] }
  } as const
}

function adapterRuntimeConfig(enabled: boolean): AppRuntimeConfig {
  return {
    modules: { ai: { enabled } },
    openai: adapterConfig()
  } as unknown as AppRuntimeConfig
}

function validInput(): OpenAIResponseInput {
  return {
    instructions: 'Answer helpfully without using tools.',
    messages: [
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Follow-up question' }
    ],
    safetyIdentifier: '0123456789abcdef0123456789abcdef',
    requestId: '123e4567-e89b-42d3-a456-426614174000',
    maxOutputTokens: OPENAI_MAX_OUTPUT_TOKENS,
    timeoutMs: OPENAI_MAX_REQUEST_TIMEOUT_MS
  }
}

function successResponse() {
  return {
    id: rawEnvelopeCanary,
    object: 'response',
    created_at: 1_784_096_000,
    status: 'completed',
    error: null,
    incomplete_details: null,
    instructions: rawEnvelopeCanary,
    metadata: { private: rawEnvelopeCanary },
    model: 'gpt-5.6-luna',
    output: [
      {
        id: `reasoning_${rawEnvelopeCanary}`,
        type: 'reasoning',
        summary: [],
        encrypted_content: rawEnvelopeCanary
      },
      {
        id: `message_${rawEnvelopeCanary}`,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'A safe visible answer.', annotations: [] }]
      }
    ],
    usage: usage()
  }
}

function refusalResponse() {
  return {
    ...successResponse(),
    output: [
      {
        id: `message_${rawEnvelopeCanary}`,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'refusal', refusal: 'I cannot help with that request.' }]
      }
    ]
  }
}

function fileSearchResponse(annotations: unknown[] = defaultFileCitations()) {
  return {
    ...successResponse(),
    output: [
      fileSearchCall(),
      {
        id: `reasoning_${rawEnvelopeCanary}`,
        type: 'reasoning',
        summary: [],
        encrypted_content: rawEnvelopeCanary
      },
      assistantMessage([{ type: 'output_text', text: 'A grounded visible answer.', annotations }])
    ]
  }
}

function fileSearchCall(id = 'search_private') {
  return {
    id,
    type: 'file_search_call',
    status: 'completed',
    queries: [rawEnvelopeCanary],
    results: null
  }
}

function webSearchResponse(annotations: unknown[] = defaultWebCitations()) {
  return {
    ...successResponse(),
    output: [
      webSearchCall(),
      {
        id: `reasoning_${rawEnvelopeCanary}`,
        type: 'reasoning',
        summary: [],
        encrypted_content: rawEnvelopeCanary
      },
      assistantMessage([{ type: 'output_text', text: webSearchText, annotations }])
    ]
  }
}

function webSearchCall(id = 'web_search_private') {
  return {
    id,
    type: 'web_search_call',
    status: 'completed',
    action: {
      type: 'search',
      queries: ['query_private'],
      sources: [{ type: 'url', url: `https://news.example.com/${rawEnvelopeCanary}` }]
    }
  }
}

function defaultFileCitations() {
  return [
    fileCitation('file_private_one', 'Guide One.pdf'),
    fileCitation('file_private_one', 'Guide One.pdf'),
    fileCitation('file_private_two', 'Guide Two.md')
  ]
}

function fileCitation(fileId: string, filename: string) {
  return { type: 'file_citation', file_id: fileId, filename, index: 992 }
}

function defaultWebCitations() {
  return [
    webCitation('https://news.example.com/current?source=openai', 'Current reference', 17, 25),
    webCitation('https://news.example.com/current?source=openai', 'Current reference', 17, 25),
    webCitation('https://news.example.com/current?source=openai', 'Current reference', 27, 35)
  ]
}

function webCitation(url: unknown, title: unknown, startIndex: unknown, endIndex: unknown) {
  return {
    type: 'url_citation',
    url,
    title,
    start_index: startIndex,
    end_index: endIndex
  }
}

function assistantMessage(content: unknown[], status = 'completed') {
  return {
    id: `message_${rawEnvelopeCanary}`,
    type: 'message',
    status,
    role: 'assistant',
    content
  }
}

async function rateLimitError(headers: Record<string, string>): Promise<OpenAIProviderError> {
  const fakeFetch: NonNullable<ClientOptions['fetch']> = vi.fn(async () =>
    jsonResponse(
      {
        error: {
          message: providerErrorCanary,
          type: 'rate_limit_error',
          code: 'rate_limit_canary'
        }
      },
      { 'x-request-id': 'request_openai_retry_after', ...headers },
      429
    )
  )

  return (await createOpenAIResponsesAdapter(adapterConfig(), { fetch: fakeFetch })
    .createResponse(validInput())
    .catch((caught: unknown) => caught)) as OpenAIProviderError
}

function usage() {
  return {
    input_tokens: 20,
    output_tokens: 7,
    total_tokens: 27,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 2 }
  }
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

function restoreEnvironment(key: string, value: string | undefined) {
  if (value === undefined) Reflect.deleteProperty(process.env, key)
  else process.env[key] = value
}
