import { inspect } from 'node:util'
import * as Sentry from '@sentry/nuxt'
import { createSentryPrivacyOptions } from '../../shared/sentry-privacy.ts'

const privateValues = [
  'private-browser-standalone-name-about-cygnus',
  'private-browser-route-parameter-about-cygnus',
  'private-browser-prompt-about-cygnus'
]
const serializedEnvelopes: string[] = []
const consoleError = console.error
const consoleWarn = console.warn
const errorCalls: unknown[][] = []
const warningCalls: unknown[][] = []

console.error = (...arguments_) => errorCalls.push(arguments_)
console.warn = (...arguments_) => warningCalls.push(arguments_)

try {
  const privacyOptions = createSentryPrivacyOptions({
    environment: 'privacy-browser-test',
    release: 'r028b-browser-test',
    tracesSampleRate: 1
  })

  Sentry.init({
    dsn: 'http://public@example.test/1',
    enabled: true,
    ...privacyOptions,
    defaultIntegrations: false,
    integrations: privacyOptions.integrations([]),
    transport: (options) =>
      Sentry.createTransport(options, async (request) => {
        serializedEnvelopes.push(
          typeof request.body === 'string' ? request.body : new TextDecoder().decode(request.body)
        )
        return { statusCode: 200 }
      })
  })

  await Sentry.startSpan(
    {
      name: privateValues[0],
      op: 'ui.interaction.click',
      attributes: {
        prompt: privateValues[2],
        routeParameter: privateValues[1]
      },
      experimental: { standalone: true }
    },
    async () => undefined
  )

  const flushSucceeded = await Sentry.flush(5_000)
  const serializedSpans = serializedItems(serializedEnvelopes, 'span')
  const [spanPayload] = serializedSpans
  const hasEnvelopeTrace = serializedEnvelopes.some((envelope) => {
    const header = parseJsonRecord(envelope.split('\n')[0])
    return header ? Object.hasOwn(header, 'trace') : true
  })

  process.stdout.write(
    JSON.stringify({
      data: spanPayload?.data,
      description: spanPayload?.description,
      flushSucceeded,
      hasEnvelopeTrace,
      op: spanPayload?.op,
      privateDataAbsent: privateValues.every(
        (value) =>
          !serializedEnvelopes.some((envelope) => envelope.includes(value)) &&
          !JSON.stringify(spanPayload).includes(value)
      ),
      privateDiagnosticsAbsent: privateValues.every(
        (value) =>
          !inspect(errorCalls, { customInspect: false, depth: 10, getters: false }).includes(value) &&
          !inspect(warningCalls, { customInspect: false, depth: 10, getters: false }).includes(value)
      ),
      serializedSpanCount: serializedSpans.length
    })
  )
} finally {
  await Sentry.close(2_000)
  console.error = consoleError
  console.warn = consoleWarn
}

function serializedItems(envelopes: string[], type: 'span') {
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
