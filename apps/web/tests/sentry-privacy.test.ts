import { describe, expect, it, vi } from 'vitest'
import {
  createSentryPrivacyOptions,
  resolveCaptureDiagnostic,
  sentryTracePropagationTargets
} from '../shared/sentry-privacy'

const eventId = 'a'.repeat(32)
const traceId = 'b'.repeat(32)
const spanId = 'c'.repeat(16)
const parentSpanId = 'd'.repeat(16)
const clientDebugId = '123e4567-e89b-42d3-a456-426614174000'

describe('Sentry privacy allowlist', () => {
  it('keeps diagnostic codes finite and samples exact decoded health routes locally', () => {
    const policy = createPolicy()
    const inheritOrSampleWith = vi.fn((rate: number) => rate)

    expect(resolveCaptureDiagnostic('background-job-execution-failed')).toEqual({
      code: 'background-job-execution-failed',
      component: 'worker',
      operation: 'execute-job'
    })
    expect(resolveCaptureDiagnostic('openai-response-failed')).toEqual({
      code: 'openai-response-failed',
      component: 'openai',
      operation: 'create-response'
    })

    expect(
      policy.tracesSampler({
        name: 'GET /api/ready',
        normalizedRequest: { url: 'https://app.example.test/api/projects' },
        inheritOrSampleWith
      } as never)
    ).toBe(0)
    expect(
      policy.tracesSampler({
        name: undefined,
        normalizedRequest: { url: 'http://%' },
        inheritOrSampleWith
      } as never)
    ).toBe(0.25)
    expect(inheritOrSampleWith).toHaveBeenCalledExactlyOnceWith(0.25)

    const [traceTarget] = sentryTracePropagationTargets
    expect(traceTarget).toBeInstanceOf(RegExp)
    expect((traceTarget as RegExp).test('/api/live?probe=1')).toBe(false)
    expect((traceTarget as RegExp).test('/api/ready#probe')).toBe(false)
    expect((traceTarget as RegExp).test('/api/readiness')).toBe(true)
  })

  it('rebuilds event, exception, trace, and breadcrumb data from safe fields', () => {
    const policy = createPolicy()

    expect(policy.beforeSend({} as never)).toEqual({
      event_id: undefined,
      timestamp: undefined,
      level: undefined,
      platform: undefined,
      environment: 'privacy-policy-test',
      release: undefined,
      type: undefined,
      message: 'Application event'
    })

    expect(
      policy.beforeSend({
        event_id: eventId,
        timestamp: 10,
        level: 'debug',
        platform: 'javascript',
        request: { method: 'get' },
        tags: {
          code: 'unclassified-application-error',
          correlationId: 'not-a-uuid',
          private: 'discarded'
        },
        breadcrumbs: [{}],
        contexts: { trace: 'not-a-record' }
      } as never)
    ).toEqual({
      event_id: eventId,
      timestamp: 10,
      level: 'debug',
      platform: 'javascript',
      environment: 'privacy-policy-test',
      release: undefined,
      request: { method: 'GET' },
      type: undefined,
      message: 'Application event'
    })

    const sanitizedException = policy.beforeSend({
      debug_meta: {
        images: [
          {
            type: 'sourcemap',
            code_file: 'https://cdn.example.test/_nuxt/entry.mjs?private=query',
            debug_id: clientDebugId,
            private: 'discarded'
          },
          {
            type: 'sourcemap',
            code_file: '/_nuxt/entry.mjs',
            debug_id: clientDebugId.toUpperCase()
          },
          {
            type: 'sourcemap',
            code_file: '/_nuxt/unmatched.js',
            debug_id: '223e4567-e89b-42d3-a456-426614174000'
          },
          {
            type: 'sourcemap',
            code_file: '/_nuxt/entry.mjs',
            debug_id: '123e4567-e89b-12d3-a456-426614174000'
          },
          { type: 'proguard', uuid: clientDebugId }
        ]
      },
      exception: {
        values: [
          {
            type: 'PrivateError',
            value: 'private message',
            mechanism: {},
            stacktrace: {
              frames: [
                {
                  filename: 'C:\\build\\_nuxt\\entry.mjs?private=query',
                  lineno: 12,
                  colno: 4,
                  in_app: false,
                  debug_id: '123e4567-e89b-42d3-a456-426614174000',
                  function: 'privateFunction',
                  context_line: 'private source'
                },
                { filename: undefined, lineno: 0, colno: Number.NaN, in_app: 'private', debug_id: 'private' },
                { filename: '/private/source.ts' },
                { filename: '/_nuxt/../private.js' },
                { filename: '/_nuxt/private.ts' }
              ]
            }
          },
          { type: 'PrivateCause', value: 'private cause', mechanism: { handled: false } }
        ]
      }
    } as never)

    expect(sanitizedException.exception).toEqual({
      values: [
        {
          type: 'Error',
          value: 'Application error',
          mechanism: { type: 'generic' },
          stacktrace: {
            frames: [
              {
                filename: '/_nuxt/entry.mjs',
                abs_path: '/_nuxt/entry.mjs',
                lineno: 12,
                colno: 4,
                in_app: false
              },
              { filename: 'application', lineno: undefined, colno: undefined },
              { filename: 'application', lineno: undefined, colno: undefined },
              { filename: 'application', lineno: undefined, colno: undefined },
              { filename: 'application', lineno: undefined, colno: undefined }
            ]
          }
        },
        {
          type: 'Error',
          value: 'Application error',
          mechanism: { type: 'generic', handled: false }
        }
      ]
    })
    expect(sanitizedException.debug_meta).toEqual({
      images: [{ type: 'sourcemap', code_file: '/_nuxt/entry.mjs', debug_id: clientDebugId }]
    })

    const safeBreadcrumbs = [
      { category: 'http' },
      { type: 'navigation' },
      { level: 'warning' },
      { data: { method: 'patch' } },
      { event_id: eventId }
    ].map((breadcrumb) => policy.beforeBreadcrumb(breadcrumb))
    expect(safeBreadcrumbs.every((breadcrumb) => breadcrumb !== null)).toBe(true)
    expect(policy.beforeBreadcrumb({})).toBeNull()
    expect(
      policy.beforeBreadcrumb({
        timestamp: 20,
        category: 'private',
        type: 'private',
        level: 'private',
        event_id: 'private',
        message: 'private',
        data: {
          method: 123,
          status_code: '200',
          request_body_size: 0.5,
          response_body_size: -1
        }
      } as never)
    ).toBeNull()
    expect(
      policy.beforeBreadcrumb({
        data: { status_code: 204, request_body_size: 0, response_body_size: 1 }
      })
    ).toEqual({
      timestamp: undefined,
      category: undefined,
      type: undefined,
      level: undefined,
      event_id: undefined,
      data: { status_code: 204, request_body_size: 0, response_body_size: 1 }
    })
    expect(policy.beforeBreadcrumb({ data: { method: 'TRACE' } })).toBeNull()

    for (const trace of [null, [], { trace_id: traceId }, { trace_id: 1, span_id: spanId }]) {
      expect(policy.beforeSend({ contexts: { trace } } as never)).not.toHaveProperty('contexts')
    }

    expect(
      policy.beforeSend({
        contexts: {
          trace: {
            trace_id: traceId,
            span_id: spanId,
            parent_span_id: parentSpanId,
            op: 'db.query',
            status: 'ok',
            data: {
              'http.status_code': 200,
              'http.response.status_code': 201,
              'sentry.sample_rate': 0.5
            }
          }
        }
      } as never)
    ).toMatchObject({
      contexts: {
        trace: {
          trace_id: traceId,
          span_id: spanId,
          parent_span_id: parentSpanId,
          op: 'db.query',
          status: 'ok',
          data: {
            'http.status_code': 200,
            'http.response.status_code': 201,
            'sentry.sample_rate': 0.5
          }
        }
      }
    })

    expect(
      policy.beforeSend({
        contexts: {
          trace: {
            trace_id: traceId,
            span_id: spanId,
            parent_span_id: 'private',
            op: 'private',
            status: 'private',
            data: []
          }
        }
      } as never)
    ).toMatchObject({
      contexts: {
        trace: {
          parent_span_id: undefined,
          op: 'application',
          status: undefined,
          data: {}
        }
      }
    })
  })

  it('rebuilds transactions and spans and rejects every health root fallback', () => {
    const policy = createPolicy()

    expect(
      policy.beforeSendTransaction({
        type: 'transaction',
        request: { url: 'https://app.example.test/%61pi/%6cive?probe=1' },
        transaction: 'private'
      } as never)
    ).toBeNull()
    expect(
      policy.beforeSendTransaction({
        type: 'transaction',
        request: { url: 'https://app.example.test/api/projects' },
        transaction: 'POST /api/ready'
      } as never)
    ).toBeNull()

    expect(
      policy.beforeSendTransaction({
        type: 'transaction',
        start_timestamp: Number.NaN,
        transaction: 'private',
        contexts: { trace: null }
      } as never)
    ).toMatchObject({
      type: 'transaction',
      start_timestamp: undefined,
      transaction: 'Application span',
      spans: []
    })

    expect(
      policy.beforeSendSpan({
        trace_id: traceId,
        span_id: spanId,
        parent_span_id: parentSpanId,
        start_timestamp: 1,
        timestamp: 2,
        status: 'ok',
        op: 'db',
        description: 'private',
        data: {
          'http.status_code': 200,
          'http.response.status_code': 299,
          'sentry.sample_rate': 0
        }
      } as never)
    ).toEqual({
      trace_id: traceId,
      span_id: spanId,
      parent_span_id: parentSpanId,
      start_timestamp: 1,
      timestamp: 2,
      status: 'ok',
      op: 'db',
      description: 'Database operation',
      data: {
        'http.status_code': 200,
        'http.response.status_code': 299,
        'sentry.sample_rate': 0
      }
    })

    const invalidSamples = ['private', Number.NaN, -0.1, 1.1]
    for (const [index, sampleRate] of invalidSamples.entries()) {
      expect(
        policy.beforeSendSpan({
          trace_id: 'private',
          span_id: 'private',
          parent_span_id: 'private',
          start_timestamp: Number.NaN,
          timestamp: Number.POSITIVE_INFINITY,
          status: index === 0 ? undefined : 'private',
          op: Symbol('private'),
          data: {
            'http.status_code': 99,
            'http.response.status_code': 600,
            'sentry.sample_rate': sampleRate
          }
        } as never)
      ).toEqual({
        trace_id: '0'.repeat(32),
        span_id: '0'.repeat(16),
        parent_span_id: undefined,
        start_timestamp: 0,
        timestamp: undefined,
        status: undefined,
        op: 'application',
        description: 'Application span',
        data: {}
      })
    }
  })
})

function createPolicy() {
  return createSentryPrivacyOptions({
    environment: 'privacy-policy-test',
    tracesSampleRate: 0.25
  })
}
