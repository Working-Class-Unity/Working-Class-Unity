import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureException } from '../server/services/observability/capture'

const moduleReady = vi.hoisted(() => vi.fn())
const sentryCapture = vi.hoisted(() => vi.fn())

vi.mock('../server/utils/module-state', () => ({
  isModuleReady: moduleReady
}))

vi.mock('@sentry/nuxt', () => ({
  captureException: sentryCapture
}))

const canaries = {
  cause: 'cause-value-without-a-sensitive-keyword',
  cookie: 'session=browser-cookie-value',
  email: 'private-person@example.test',
  file: 'private-file-contents-about-orion',
  message: 'exception-message-about-a-private-family-choice',
  payload: '{"provider":"private-provider-body"}',
  prompt: 'Please compare these private baby names',
  stack: 'stack-frame-with-private-source-value',
  token: 'opaque-bearer-value-12345',
  userId: 'private-user-identifier'
} as const

beforeEach(() => {
  moduleReady.mockReset()
  sentryCapture.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('safe local observability diagnostics', () => {
  it('emits only reviewed metadata for a disabled provider', async () => {
    moduleReady.mockReturnValue(false)
    const error = privateError()
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await expect(captureException(error, 'observability-test-error')).resolves.toBeUndefined()

    const diagnostic = emittedDiagnostic(stderr)
    expect(diagnostic).toEqual({
      event: 'application-error',
      code: 'observability-test-error',
      component: 'observability',
      operation: 'test-error',
      correlationId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    })
    expectNoCanary(JSON.stringify(stderr.mock.calls))
    expect(stdout).not.toHaveBeenCalled()
    expect(sentryCapture).not.toHaveBeenCalled()
  })
})

function privateError() {
  const error = Object.assign(new Error(canaries.message, { cause: new Error(canaries.cause) }), {
    cookie: canaries.cookie,
    email: canaries.email,
    fileContents: canaries.file,
    prompt: canaries.prompt,
    providerPayload: canaries.payload,
    token: canaries.token,
    userId: canaries.userId
  })
  error.stack = canaries.stack
  return error
}

function emittedDiagnostic(stderr: ReturnType<typeof vi.spyOn>) {
  expect(stderr).toHaveBeenCalledOnce()
  expect(stderr.mock.calls[0]).toHaveLength(1)
  return JSON.parse(String(stderr.mock.calls[0]?.[0])) as Record<string, unknown>
}

function expectNoCanary(output: string) {
  for (const value of Object.values(canaries)) expect(output).not.toContain(value)
}
