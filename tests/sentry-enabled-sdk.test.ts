import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { inspect, promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { createSentryPrivacyOptions } from '../shared/sentry-privacy'

const execFileAsync = promisify(execFile)
const clientDebugId = '123e4567-e89b-42d3-a456-426614174000'

const canaries = {
  breadcrumbData: 'private-breadcrumb-data-about-cygnus',
  breadcrumbMessage: 'private-breadcrumb-message-about-cygnus',
  cookie: 'session=private-cookie-value',
  email: 'private-person@example.test',
  eventMessage: 'private-message-event-about-cygnus',
  exceptionCause: 'private-exception-cause-about-cygnus',
  exceptionMessage: 'private-exception-message-about-cygnus',
  fileContents: 'private-file-contents-about-cygnus',
  prompt: 'Please compare these private family choices',
  processorFailure: 'private-event-processor-failure-about-cygnus',
  providerResponse: 'private-provider-response-about-cygnus',
  routeParameter: 'project_private_route_parameter',
  spanName: 'private-child-span-about-cygnus',
  token: 'private-bearer-token-about-cygnus',
  transactionName: 'private-root-transaction-about-cygnus',
  userId: 'private-user-identifier-about-cygnus'
} as const

describe('serialized Sentry privacy policy', () => {
  it('allowlists events, exceptions, breadcrumbs, transactions, and spans while excluding health traces', async () => {
    const serializedEnvelopes: string[] = []
    const dsn = 'http://public@example.test/1'
    stubRuntimeEnvironment(dsn)

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let Sentry: typeof import('@sentry/nuxt') | undefined

    try {
      vi.resetModules()
      Sentry = await import('@sentry/nuxt')
      const privacyOptions = createSentryPrivacyOptions({
        environment: 'privacy-test',
        release: 'r028b-test',
        tracesSampleRate: 1
      })

      Sentry.init({
        dsn,
        enabled: true,
        ...privacyOptions,
        includeLocalVariables: false,
        transport: (options) =>
          Sentry!.createTransport(options, async (request) => {
            serializedEnvelopes.push(serializedBody(request.body))
            return { statusCode: 200 }
          })
      })

      const inheritOrSampleWith = vi.fn((rate: number) => rate)
      expect(
        privacyOptions.tracesSampler({
          name: 'GET /api/projects',
          normalizedRequest: {
            url: 'https://app.example.test/%61pi/%6cive?probe=private'
          },
          inheritOrSampleWith
        } as never)
      ).toBe(0)
      expect(inheritOrSampleWith).not.toHaveBeenCalled()
      expect(
        privacyOptions.tracesSampler({
          name: 'GET /api/liveness',
          normalizedRequest: {
            url: 'https://app.example.test/api/liveness'
          },
          inheritOrSampleWith
        } as never)
      ).toBe(1)
      expect(inheritOrSampleWith).toHaveBeenCalledExactlyOnceWith(1)

      Sentry.addBreadcrumb({
        type: 'http',
        category: 'http',
        level: 'info',
        message: canaries.breadcrumbMessage,
        data: {
          method: 'POST',
          status_code: 418,
          url: `https://app.example.test/projects/${canaries.routeParameter}`,
          providerResponse: canaries.breadcrumbData
        }
      })

      Sentry.captureEvent({
        message: canaries.eventMessage,
        level: 'warning',
        environment: canaries.providerResponse,
        release: canaries.token,
        server_name: canaries.userId,
        request: {
          method: 'POST',
          url: `https://app.example.test/projects/${canaries.routeParameter}?token=${canaries.token}`,
          headers: {
            authorization: `Bearer ${canaries.token}`,
            cookie: canaries.cookie
          },
          cookies: { session: canaries.cookie },
          data: { prompt: canaries.prompt }
        },
        user: {
          id: canaries.userId,
          email: canaries.email
        },
        tags: {
          code: canaries.prompt,
          component: canaries.fileContents,
          operation: canaries.providerResponse
        },
        extra: {
          fileContents: canaries.fileContents,
          providerResponse: canaries.providerResponse
        },
        contexts: {
          nuxt: {
            path: `/projects/${canaries.routeParameter}`,
            prompt: canaries.prompt
          },
          private: {
            response: canaries.providerResponse
          }
        }
      })

      Sentry.captureEvent({
        exception: {
          values: [
            {
              type: 'PrivateClientError',
              value: canaries.exceptionMessage,
              stacktrace: {
                frames: [
                  {
                    filename: `https://app.example.test/_nuxt/app.js?token=${canaries.token}`,
                    abs_path: `https://app.example.test/_nuxt/app.js?token=${canaries.token}`,
                    function: canaries.fileContents,
                    lineno: 9,
                    colno: 4
                  }
                ]
              }
            }
          ]
        },
        debug_meta: {
          images: [
            {
              type: 'sourcemap',
              code_file: `https://app.example.test/_nuxt/app.js?token=${canaries.token}`,
              debug_id: clientDebugId
            },
            {
              type: 'sourcemap',
              code_file: '/_nuxt/unmatched.js',
              debug_id: '223e4567-e89b-42d3-a456-426614174000'
            }
          ]
        }
      })

      const { captureException } = await import('../server/services/observability/capture')
      await captureException(privateError(), 'observability-test-error')

      await Sentry.startSpan(
        {
          name: canaries.transactionName,
          op: 'test',
          attributes: {
            'gen_ai.request.messages': canaries.prompt,
            'gen_ai.response.text': canaries.providerResponse,
            'url.path.parameter.projectId': canaries.routeParameter
          }
        },
        async () => {
          await Sentry!.startSpan(
            {
              name: 'GET /%61pi/%6cive?probe=1',
              op: 'http.client',
              attributes: { url: `/api/live?token=${canaries.token}` }
            },
            async () => undefined
          )
          await Sentry!.startSpan(
            {
              name: 'GET https://app.example.test/%61pi%2f%72eady#probe',
              op: 'http.client',
              attributes: { url: `/api/ready?token=${canaries.token}` }
            },
            async () => undefined
          )
          await Sentry!.startSpan(
            {
              name: canaries.spanName,
              op: 'http.client',
              attributes: {
                'http.response.status_code': 299,
                prompt: canaries.prompt
              }
            },
            async () => undefined
          )
        }
      )

      expect(await Sentry.flush(5_000)).toBe(true)
      const transactionCountBeforeHealthRoots = serializedItems(serializedEnvelopes, 'transaction').length
      expect(transactionCountBeforeHealthRoots).toBe(1)

      for (const path of ['/api/live', '/api/ready']) {
        await Sentry.startSpan({ name: `GET ${path}`, op: 'http.server' }, async () => undefined)
      }

      expect(await Sentry.flush(5_000)).toBe(true)
      expect(serializedItems(serializedEnvelopes, 'transaction')).toHaveLength(transactionCountBeforeHealthRoots)

      Sentry.withScope((scope) => {
        scope.addEventProcessor(() => {
          throw new Error(canaries.processorFailure)
        })
        Sentry!.captureMessage('processor failure fixture')
      })
      expect(await Sentry.flush(5_000)).toBe(true)

      const completeWireOutput = serializedEnvelopes.join('\n')
      const localErrorOutput = inspect(consoleError.mock.calls, { customInspect: false, depth: 10, getters: false })
      const localWarningOutput = inspect(consoleWarn.mock.calls, { customInspect: false, depth: 10, getters: false })
      for (const [name, value] of Object.entries(canaries)) {
        expect(completeWireOutput.includes(value), name).toBe(false)
        expect(localErrorOutput.includes(value), `${name} local diagnostic`).toBe(false)
        expect(localWarningOutput.includes(value), `${name} local warning`).toBe(false)
      }
      for (const envelope of serializedEnvelopes) {
        expect(parseJsonRecord(envelope.split('\n')[0])).not.toHaveProperty('trace')
      }

      const eventPayloads = serializedItems(serializedEnvelopes, 'event')
      expect(eventPayloads).toHaveLength(4)
      expect(eventPayloads).toContainEqual(
        expect.objectContaining({
          message: 'Application event',
          environment: 'privacy-test',
          release: 'r028b-test',
          request: { method: 'POST' },
          breadcrumbs: [
            expect.objectContaining({
              type: 'http',
              category: 'http',
              level: 'info',
              data: { method: 'POST', status_code: 418 }
            })
          ]
        })
      )
      expect(eventPayloads).toContainEqual(
        expect.objectContaining({
          environment: 'privacy-test',
          release: 'r028b-test',
          exception: {
            values: [
              expect.objectContaining({
                type: 'Error',
                value: 'Application error',
                stacktrace: {
                  frames: [
                    expect.objectContaining({
                      filename: '/_nuxt/app.js',
                      abs_path: '/_nuxt/app.js',
                      lineno: 9,
                      colno: 4
                    })
                  ]
                }
              })
            ]
          },
          debug_meta: {
            images: [{ type: 'sourcemap', code_file: '/_nuxt/app.js', debug_id: clientDebugId }]
          }
        })
      )
      expect(eventPayloads).toContainEqual(
        expect.objectContaining({
          environment: 'privacy-test',
          release: 'r028b-test',
          exception: {
            values: expect.arrayContaining([
              expect.objectContaining({
                type: 'Error',
                value: 'Application error',
                mechanism: { type: 'generic', handled: false }
              })
            ])
          }
        })
      )
      expect(eventPayloads).toContainEqual(
        expect.objectContaining({
          environment: 'privacy-test',
          release: 'r028b-test',
          exception: {
            values: expect.arrayContaining([
              expect.objectContaining({
                type: 'Error',
                value: 'observability-test-error'
              })
            ])
          },
          tags: expect.objectContaining({
            code: 'observability-test-error',
            component: 'observability',
            operation: 'test-error',
            correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/)
          })
        })
      )

      const [transactionPayload] = serializedItems(serializedEnvelopes, 'transaction')
      expect(transactionPayload).toMatchObject({
        type: 'transaction',
        transaction: 'Application test',
        environment: 'privacy-test',
        release: 'r028b-test',
        spans: [
          expect.objectContaining({
            op: 'http.client',
            description: 'HTTP client request',
            data: { 'http.response.status_code': 299 }
          })
        ]
      })
    } finally {
      try {
        if (Sentry) await Sentry.close(2_000)
      } finally {
        consoleError.mockRestore()
        consoleWarn.mockRestore()
        vi.unstubAllEnvs()
        vi.resetModules()
      }
    }
  }, 15_000)

  it('sanitizes a browser standalone span payload and envelope header after SDK serialization', async () => {
    const fixture = fileURLToPath(new URL('./fixtures/sentry-browser-standalone.mts', import.meta.url))
    const { stdout, stderr } = await execFileAsync(process.execPath, ['--conditions=browser', fixture], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: {
        CI: '1',
        NODE_ENV: 'test'
      }
    })
    const evidence = JSON.parse(stdout) as Record<string, unknown>

    expect(stderr).toBe('')
    expect(evidence).toEqual({
      data: { 'sentry.sample_rate': 1 },
      description: 'User interface action',
      flushSucceeded: true,
      hasEnvelopeTrace: false,
      op: 'ui.interaction.click',
      privateDataAbsent: true,
      privateDiagnosticsAbsent: true,
      serializedSpanCount: 1
    })
  })
})

function privateError() {
  const error = Object.assign(new Error(canaries.exceptionMessage, { cause: new Error(canaries.exceptionCause) }), {
    cookie: canaries.cookie,
    email: canaries.email,
    fileContents: canaries.fileContents,
    prompt: canaries.prompt,
    providerResponse: canaries.providerResponse,
    token: canaries.token,
    userId: canaries.userId
  })
  error.stack = `Error: ${canaries.exceptionMessage}\n    at privateFrame (/private/${canaries.fileContents}.ts:1:1)`
  return error
}

function serializedBody(body: string | Uint8Array) {
  return typeof body === 'string' ? body : new TextDecoder().decode(body)
}

function serializedItems(envelopes: string[], type: 'event' | 'transaction') {
  return envelopes.flatMap((envelope) => {
    const lines = envelope.split('\n')
    const payloads: Array<Record<string, unknown>> = []

    for (let index = 1; index < lines.length - 1; index += 1) {
      const header = parseJsonRecord(lines[index])
      if (header?.type !== type) continue

      const payload = parseJsonRecord(lines[index + 1])
      if (payload) payloads.push(payload)
    }

    return payloads
  })
}

function parseJsonRecord(value: string | undefined) {
  if (!value) return undefined

  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

function stubRuntimeEnvironment(dsn: string) {
  const environment = {
    NODE_ENV: 'test',
    NUXT_DATABASE_URL: 'file:/tmp/swl-sentry-enabled-sdk.test.db',
    NUXT_READINESS_TOKEN: 'sentry-test-readiness-token-with-32-characters',
    NUXT_BETTER_AUTH_SECRET: 'sentry-test-auth-secret-with-32-characters',
    NUXT_BETTER_AUTH_URL: 'https://app.example.test',
    NUXT_EMAIL_TRANSPORT: 'capture',
    NUXT_EMAIL_FROM: 'Working Class Unity <no-reply@example.test>',
    NUXT_EMAIL_CAPTURE_DIRECTORY: './data/email-capture-sentry-test',
    NUXT_PUBLIC_APP_URL: 'https://app.example.test',
    NUXT_STRIPE_SECRET_KEY: 'rk_test_sentry_not_a_provider_credential',
    NUXT_STRIPE_WEBHOOK_SECRET: 'whsec_sentry_not_a_provider_credential',
    NUXT_STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_sentry',
    NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID: 'price_sentry_personal_weekly',
    NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID: 'price_sentry_personal_monthly',
    NUXT_STRIPE_PERSONAL_ANNUAL_PRICE_ID: 'price_sentry_personal_annual',
    NUXT_STRIPE_FAMILY_MONTHLY_PRICE_ID: 'price_sentry_family_monthly',
    NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID: 'price_sentry_family_annual',
    NUXT_FILES_DRIVER: 'local',
    NUXT_OPENAI_API_KEY: 'sentry-openai-key-not-a-provider-credential',
    NUXT_OPENAI_PROJECT_ID: 'proj_sentry_test',
    NUXT_OPENAI_MODEL: 'gpt-5.6-luna',
    NUXT_OPENAI_FILE_SEARCH_VECTOR_STORE_ID: 'vs_sentry_empty',
    NUXT_OPENAI_WEB_SEARCH_ALLOWED_DOMAINS: 'example.test',
    NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY: 'sentry-turnstile-secret-not-a-provider-credential',
    NUXT_PUBLIC_TURNSTILE_SITE_KEY: 'sentry-turnstile-site-not-a-provider-credential',
    NUXT_SENTRY_DSN: dsn,
    NUXT_PUBLIC_SENTRY_DSN: dsn,
    NUXT_SENTRY_ENVIRONMENT: 'privacy-test',
    NUXT_PUBLIC_SENTRY_ENVIRONMENT: 'privacy-test',
    NUXT_SENTRY_RELEASE: 'r028b-test',
    NUXT_PUBLIC_SENTRY_RELEASE: 'r028b-test',
    NUXT_SENTRY_TRACES_SAMPLE_RATE: '1',
    NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: '1'
  }

  for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value)
}
