import type { Breadcrumb, ErrorEvent, Event } from '@sentry/nuxt'

export const captureDiagnosticDefinitions = {
  'account-deletion-orphan-cleanup-failed': {
    component: 'account-deletion',
    operation: 'file-orphan-cleanup'
  },
  'background-job-execution-failed': {
    component: 'worker',
    operation: 'execute-job'
  },
  'billing-operation-failed': {
    component: 'billing',
    operation: 'provider-operation'
  },
  'observability-test-error': {
    component: 'observability',
    operation: 'test-error'
  },
  'openai-response-failed': {
    component: 'openai',
    operation: 'create-response'
  }
} as const

const strictDataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: {
    request: false,
    response: false
  },
  httpBodies: [],
  queryParams: false,
  genAI: {
    inputs: false,
    outputs: false
  },
  stackFrameVariables: false,
  frameContextLines: 0
} satisfies DataCollection

const healthRouteTelemetryPattern =
  /^(?:[A-Z]+ )?(?:https?:\/\/[^/?#]+)?\/(?:a|%61)(?:p|%70)(?:i|%69)(?:\/|%2f)(?:(?:l|%6c)(?:i|%69)(?:v|%76)(?:e|%65)|(?:r|%72)(?:e|%65)(?:a|%61)(?:d|%64)(?:y|%79))(?:[?#].*)?$/i

export const sentryTracePropagationTargets = [/^\/api\/(?!live(?:[/?#]|$)|ready(?:[/?#]|$))/]

const safeBreadcrumbCategories = new Set([
  'console',
  'fetch',
  'http',
  'navigation',
  'sentry.event',
  'sentry.transaction',
  'ui.click',
  'xhr'
])
const safeBreadcrumbTypes = new Set(['default', 'http', 'navigation', 'query', 'user'])
const safeHttpMethods = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'])
const safeLevels = new Set(['debug', 'error', 'fatal', 'info', 'log', 'warning'])
const safePlatforms = new Set(['javascript', 'node'])
const safeSpanStatuses = new Set([
  'aborted',
  'already_exists',
  'cancelled',
  'data_loss',
  'deadline_exceeded',
  'failed_precondition',
  'internal_error',
  'invalid_argument',
  'not_found',
  'ok',
  'out_of_range',
  'permission_denied',
  'resource_exhausted',
  'unauthenticated',
  'unavailable',
  'unimplemented',
  'unknown_error'
])

const spanOperationLabels = {
  application: 'Application span',
  db: 'Database operation',
  'db.query': 'Database query',
  function: 'Application function',
  'http.client': 'HTTP client request',
  'http.client.stream': 'HTTP client stream',
  'http.server': 'HTTP server request',
  navigation: 'Browser navigation',
  'navigation.redirect': 'Browser redirect',
  pageload: 'Browser page load',
  task: 'Background task',
  test: 'Application test',
  'ui.interaction.click': 'User interface action'
} as const

const eventIdPattern = /^[0-9a-f]{32}$/i
const spanIdPattern = /^[0-9a-f]{16}$/i
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const debugIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type CaptureDiagnosticCode = keyof typeof captureDiagnosticDefinitions

interface SentryPrivacyConfiguration {
  environment: string
  release?: string
  tracesSampleRate: number
}

type ExceptionValue = NonNullable<NonNullable<ErrorEvent['exception']>['values']>[number]
type StackFrame = NonNullable<NonNullable<ExceptionValue['stacktrace']>['frames']>[number]
type NuxtInitOptions = Parameters<(typeof import('@sentry/nuxt'))['init']>[0]
type DataCollection = NonNullable<NuxtInitOptions['dataCollection']>
type SentryIntegration = ReturnType<(typeof import('@sentry/nuxt'))['getDefaultIntegrations']>[number]
type SpanJSON = NonNullable<Event['spans']>[number]
type TracesSamplerSamplingContext = Parameters<NonNullable<NuxtInitOptions['tracesSampler']>>[0]
type TransactionEvent = Omit<Event, 'type'> & { type: 'transaction' }

export function resolveCaptureDiagnostic(code: CaptureDiagnosticCode) {
  return {
    code,
    ...captureDiagnosticDefinitions[code]
  }
}

export function createSentryPrivacyOptions(configuration: SentryPrivacyConfiguration) {
  const metadata = {
    environment: configuration.environment,
    release: configuration.release
  }

  return {
    environment: metadata.environment,
    release: metadata.release,
    sendDefaultPii: false,
    includeServerName: false,
    enableLogs: false,
    enableMetrics: false,
    dataCollection: strictDataCollection,
    integrations(defaultIntegrations: SentryIntegration[]) {
      return [...defaultIntegrations, createPrivacyEnvelopeIntegration(metadata)]
    },
    ignoreTransactions: [healthRouteTelemetryPattern],
    ignoreSpans: [healthRouteTelemetryPattern],
    tracesSampler(context: TracesSamplerSamplingContext) {
      if (isHealthRoute(context.normalizedRequest?.url) || isHealthRoute(context.name)) return 0
      return context.inheritOrSampleWith(configuration.tracesSampleRate)
    },
    beforeBreadcrumb: sanitizeBreadcrumb,
    beforeSend(event: ErrorEvent) {
      return sanitizeErrorEvent(event, metadata)
    },
    beforeSendSpan: sanitizeSpan,
    beforeSendTransaction(event: TransactionEvent) {
      if (isHealthRoute(event.request?.url) || isHealthRoute(event.transaction)) return null
      return sanitizeTransactionEvent(event, metadata)
    }
  }
}

function createPrivacyEnvelopeIntegration(
  metadata: Pick<SentryPrivacyConfiguration, 'environment' | 'release'>
): SentryIntegration {
  return {
    name: 'ApplicationTelemetryPrivacy',
    setup(client) {
      client.on('beforeEnvelope', (envelope) => {
        Reflect.deleteProperty(envelope[0], 'trace')

        for (const item of envelope[1]) {
          const payload = item[1]
          if (item[0].type !== 'event' || !isRecord(payload)) continue

          const mutableItem = item as [(typeof item)[0], unknown]
          mutableItem[1] = sanitizeErrorEvent(payload as unknown as ErrorEvent, metadata)
        }
      })
    }
  }
}

function sanitizeErrorEvent(
  event: ErrorEvent,
  metadata: Pick<SentryPrivacyConfiguration, 'environment' | 'release'>
): ErrorEvent {
  const base = sanitizeEventBase(event, metadata)
  const diagnostic = diagnosticFromTags(event.tags)
  const values = event.exception?.values?.map((value) => sanitizeException(value, diagnostic?.code))
  const debugMeta = sanitizeDebugMeta(event.debug_meta, values)

  return {
    ...base,
    type: undefined,
    ...(values?.length ? { exception: { values } } : { message: diagnostic?.code ?? 'Application event' }),
    ...(diagnostic ? { fingerprint: [diagnostic.code] } : {}),
    ...(debugMeta ? { debug_meta: debugMeta } : {})
  }
}

function sanitizeTransactionEvent(
  event: TransactionEvent,
  metadata: Pick<SentryPrivacyConfiguration, 'environment' | 'release'>
): TransactionEvent {
  const rootOperation = safeSpanOperation(event.contexts?.trace?.op)

  return {
    ...sanitizeEventBase(event, metadata),
    type: 'transaction',
    start_timestamp: finiteNumber(event.start_timestamp),
    transaction: rootOperation.description,
    spans: event.spans?.map(sanitizeSpan) ?? []
  }
}

function sanitizeEventBase(
  event: ErrorEvent | TransactionEvent,
  metadata: Pick<SentryPrivacyConfiguration, 'environment' | 'release'>
) {
  const breadcrumbs = event.breadcrumbs
    ?.map((breadcrumb) => sanitizeBreadcrumb(breadcrumb))
    .filter((breadcrumb): breadcrumb is Breadcrumb => breadcrumb !== null)
  const tags = diagnosticFromTags(event.tags)
  const trace = sanitizeTraceContext(event.contexts?.trace)
  const method = safeHttpMethod(event.request?.method)

  return {
    event_id: eventIdPattern.test(event.event_id ?? '') ? event.event_id : undefined,
    timestamp: finiteNumber(event.timestamp),
    level: safeLevels.has(event.level ?? '') ? event.level : undefined,
    platform: safePlatforms.has(event.platform ?? '') ? event.platform : undefined,
    environment: metadata.environment,
    release: metadata.release,
    ...(method ? { request: { method } } : {}),
    ...(breadcrumbs?.length ? { breadcrumbs } : {}),
    ...(trace ? { contexts: { trace } } : {}),
    ...(tags ? { tags } : {})
  }
}

function sanitizeException(value: ExceptionValue, diagnosticCode?: string): ExceptionValue {
  const frames = value.stacktrace?.frames?.map(sanitizeStackFrame)

  return {
    type: 'Error',
    value: diagnosticCode ?? 'Application error',
    mechanism: {
      type: 'generic',
      ...(typeof value.mechanism?.handled === 'boolean' ? { handled: value.mechanism.handled } : {})
    },
    ...(frames?.length ? { stacktrace: { frames } } : {})
  }
}

function sanitizeStackFrame(frame: StackFrame): StackFrame {
  const assetPath = safeNuxtAssetPath(frame.abs_path) ?? safeNuxtAssetPath(frame.filename)

  return {
    filename: assetPath ?? 'application',
    ...(assetPath ? { abs_path: assetPath } : {}),
    lineno: positiveInteger(frame.lineno),
    colno: positiveInteger(frame.colno),
    ...(typeof frame.in_app === 'boolean' ? { in_app: frame.in_app } : {})
  }
}

function sanitizeDebugMeta(
  debugMeta: ErrorEvent['debug_meta'],
  values: ExceptionValue[] | undefined
): ErrorEvent['debug_meta'] | undefined {
  if (!debugMeta || !Array.isArray(debugMeta.images)) return undefined

  const images: NonNullable<ErrorEvent['debug_meta']>['images'] = []
  const retainedFramePaths = new Set(
    values?.flatMap(
      (value) => value.stacktrace?.frames?.flatMap((frame) => (frame.abs_path ? [frame.abs_path] : [])) ?? []
    )
  )
  const seen = new Set<string>()

  for (const image of debugMeta.images) {
    if (image.type !== 'sourcemap' || !debugIdPattern.test(image.debug_id)) continue

    const codeFile = safeNuxtAssetPath(image.code_file)
    if (!codeFile || !retainedFramePaths.has(codeFile)) continue

    const identity = `${codeFile}\0${image.debug_id.toLowerCase()}`
    if (seen.has(identity)) continue
    seen.add(identity)
    images.push({ type: 'sourcemap', code_file: codeFile, debug_id: image.debug_id.toLowerCase() })
  }

  return images.length ? { images } : undefined
}

function safeNuxtAssetPath(value: unknown) {
  if (typeof value !== 'string') return undefined

  const normalized = value.replaceAll('\\', '/').replace(/[?#].*$/u, '')
  const assetStart = normalized.lastIndexOf('/_nuxt/')
  if (assetStart < 0) return undefined

  const assetPath = normalized.slice(assetStart)
  if (assetPath.includes('..') || !/^\/_nuxt\/[A-Za-z0-9._~/-]+\.(?:m?js)$/u.test(assetPath)) return undefined
  return assetPath
}

function sanitizeBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  const category = safeBreadcrumbCategories.has(breadcrumb.category ?? '') ? breadcrumb.category : undefined
  const type = safeBreadcrumbTypes.has(breadcrumb.type ?? '') ? breadcrumb.type : undefined
  const level = safeLevels.has(breadcrumb.level ?? '') ? breadcrumb.level : undefined
  const data = sanitizeBreadcrumbData(breadcrumb.data)
  const eventId = eventIdPattern.test(breadcrumb.event_id ?? '') ? breadcrumb.event_id : undefined

  if (!category && !type && !level && !data && !eventId) return null

  return {
    timestamp: finiteNumber(breadcrumb.timestamp),
    category,
    type,
    level,
    event_id: eventId,
    data
  }
}

function sanitizeBreadcrumbData(value: Breadcrumb['data']) {
  if (!value) return undefined

  const method = safeHttpMethod(value.method)
  const statusCode = safeStatusCode(value.status_code)
  const requestBodySize = nonNegativeInteger(value.request_body_size)
  const responseBodySize = nonNegativeInteger(value.response_body_size)

  if (!method && statusCode === undefined && requestBodySize === undefined && responseBodySize === undefined) {
    return undefined
  }

  return {
    ...(method ? { method } : {}),
    ...(statusCode !== undefined ? { status_code: statusCode } : {}),
    ...(requestBodySize !== undefined ? { request_body_size: requestBodySize } : {}),
    ...(responseBodySize !== undefined ? { response_body_size: responseBodySize } : {})
  }
}

function sanitizeSpan(span: SpanJSON): SpanJSON {
  const operation = safeSpanOperation(span.op)

  return {
    trace_id: eventIdPattern.test(span.trace_id) ? span.trace_id : '0'.repeat(32),
    span_id: spanIdPattern.test(span.span_id) ? span.span_id : '0'.repeat(16),
    parent_span_id: spanIdPattern.test(span.parent_span_id ?? '') ? span.parent_span_id : undefined,
    start_timestamp: finiteNumber(span.start_timestamp) ?? 0,
    timestamp: finiteNumber(span.timestamp),
    status: safeSpanStatuses.has(span.status ?? '') ? span.status : undefined,
    op: operation.op,
    description: operation.description,
    data: sanitizeSpanData(span.data)
  }
}

function sanitizeSpanData(data: Record<string, unknown>) {
  const httpStatusCode = safeStatusCode(data['http.status_code'])
  const responseStatusCode = safeStatusCode(data['http.response.status_code'])
  const sampleRate = boundedNumber(data['sentry.sample_rate'], 0, 1)

  return {
    ...(httpStatusCode !== undefined ? { 'http.status_code': httpStatusCode } : {}),
    ...(responseStatusCode !== undefined ? { 'http.response.status_code': responseStatusCode } : {}),
    ...(sampleRate !== undefined ? { 'sentry.sample_rate': sampleRate } : {})
  }
}

function sanitizeTraceContext(value: NonNullable<ErrorEvent['contexts']>['trace'] | undefined) {
  if (!isRecord(value)) return undefined

  const traceId = typeof value.trace_id === 'string' && eventIdPattern.test(value.trace_id) ? value.trace_id : undefined
  const spanId = typeof value.span_id === 'string' && spanIdPattern.test(value.span_id) ? value.span_id : undefined
  if (!traceId || !spanId) return undefined

  const operation = safeSpanOperation(value.op)
  return {
    trace_id: traceId,
    span_id: spanId,
    parent_span_id:
      typeof value.parent_span_id === 'string' && spanIdPattern.test(value.parent_span_id)
        ? value.parent_span_id
        : undefined,
    op: operation.op,
    status: typeof value.status === 'string' && safeSpanStatuses.has(value.status) ? value.status : undefined,
    data: sanitizeSpanData(isRecord(value.data) ? value.data : {})
  }
}

function diagnosticFromTags(tags: ErrorEvent['tags']) {
  if (!tags) return undefined

  const diagnostic = diagnosticForCode(tags.code)
  if (!diagnostic) return undefined

  return {
    ...diagnostic,
    ...(typeof tags.correlationId === 'string' && uuidPattern.test(tags.correlationId)
      ? { correlationId: tags.correlationId }
      : {})
  }
}

function diagnosticForCode(code: unknown) {
  if (isCaptureDiagnosticCode(code)) {
    return {
      code,
      ...captureDiagnosticDefinitions[code]
    }
  }

  return undefined
}

function isCaptureDiagnosticCode(code: unknown): code is CaptureDiagnosticCode {
  return typeof code === 'string' && Object.hasOwn(captureDiagnosticDefinitions, code)
}

function isHealthRoute(value: unknown) {
  if (typeof value !== 'string') return false

  const withoutMethod = value.replace(/^[A-Z]+\s+/iu, '')

  try {
    const pathname = decodeURIComponent(new URL(withoutMethod, 'http://sentry.invalid').pathname)
    return pathname === '/api/live' || pathname === '/api/ready'
  } catch {
    return false
  }
}

function safeSpanOperation(value: unknown) {
  if (typeof value === 'string' && Object.hasOwn(spanOperationLabels, value)) {
    const operation = value as keyof typeof spanOperationLabels
    return { op: operation, description: spanOperationLabels[operation] }
  }

  return { op: 'application', description: spanOperationLabels.application }
}

function safeHttpMethod(value: unknown) {
  if (typeof value !== 'string') return undefined
  const method = value.toUpperCase()
  return safeHttpMethods.has(method) ? method : undefined
}

function safeStatusCode(value: unknown) {
  return boundedInteger(value, 100, 599)
}

function positiveInteger(value: unknown) {
  return boundedInteger(value, 1, Number.MAX_SAFE_INTEGER)
}

function nonNegativeInteger(value: unknown) {
  return boundedInteger(value, 0, Number.MAX_SAFE_INTEGER)
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : undefined
}

function boundedNumber(value: unknown, minimum: number, maximum: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum ? value : undefined
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
