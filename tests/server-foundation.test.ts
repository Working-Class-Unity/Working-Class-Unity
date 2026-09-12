import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { safeErrorData } from '../server/utils/errors'
import { validateWithZod } from '../server/utils/validation'
import {
  assertStartableRuntimeConfig,
  canonicalAppRuntimePaths,
  evaluateRuntimeConfig,
  evaluateRuntimeEnvironment,
  readDatabaseUrl,
  readinessTokenPattern,
  RuntimeConfigValidationError,
  runtimeConfigFromEnvironment,
  validateRuntimeConfig
} from '../server/utils/runtime'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('public website server foundation', () => {
  it('adapts Zod schemas to HTTP validation errors', () => {
    const validate = validateWithZod(z.object({ name: z.string().min(2) }), 'Invalid test payload')
    expect(validate({ name: 'ok' })).toEqual({ name: 'ok' })
    expect(() => validate({ name: '' })).toThrowError(
      expect.objectContaining({
        statusCode: 400,
        statusMessage: 'Invalid test payload',
        data: { formErrors: [], fieldErrors: { name: expect.any(Array) } }
      })
    )
  })

  it('redacts sensitive error fields before exposing error data', () => {
    expect(
      safeErrorData({ message: 'upstream failed', token: 'private-token', nested: { password: 'secret', ok: true } })
    ).toEqual({ message: 'upstream failed', token: '[redacted]', nested: { password: '[redacted]', ok: true } })
  })

  it('starts a production public website without account or payment-provider credentials', () => {
    const environment = runtimeEnvironment({ NODE_ENV: 'production' })
    const config = assertStartableRuntimeConfig(evaluateRuntimeEnvironment(environment))

    expect(config.databaseUrl).toBe(environment.NUXT_DATABASE_URL)
    expect(config.public.appUrl).toBe(environment.NUXT_PUBLIC_APP_URL)
    expect(config.sentryDsn).toBe('')
    expect(config.public.sentryDsn).toBe('')
    expect(config.public.appName).toBe('Working Class Unity')
    expect(Object.isFrozen(config)).toBe(true)
    expect(Object.isFrozen(config.public)).toBe(true)
  })

  it('keeps the readiness token private and preserves its exact validated bytes', () => {
    const readinessToken = 'ready-Exact.Token_Bytes~+/1234567890'
    const environment = runtimeEnvironment({ NUXT_READINESS_TOKEN: readinessToken })
    const config = validateRuntimeConfig(runtimeConfigFromEnvironment(environment), environment)

    expect(readinessTokenPattern.test(readinessToken)).toBe(true)
    expect(config.readinessToken).toBe(readinessToken)
    expect('readinessToken' in config.public).toBe(false)
    expect(() => {
      ;(config as { readinessToken: string }).readinessToken = 'mutated'
    }).toThrow()
  })

  it('rejects malformed readiness credentials and the local sample in production without leaking them', () => {
    for (const token of [
      undefined,
      '',
      ' ready-12345678901234567890123456789012',
      'ready-12345678901234567890123456789012 ',
      'ready-too-short',
      '9ready-12345678901234567890123456789012',
      'ready-123456789012345678901234567890:12',
      'ready-123456789012345678901234567890é12',
      'local-readiness-token-change-me-32-chars'
    ]) {
      const evaluation = evaluateRuntimeEnvironment(
        runtimeEnvironment({ NODE_ENV: 'production', NUXT_READINESS_TOKEN: token })
      )
      expect(evaluation.issues).toContainEqual(expect.objectContaining({ key: 'NUXT_READINESS_TOKEN' }))
      if (token) expect(new RuntimeConfigValidationError(evaluation.issues).message).not.toContain(token)
    }
  })

  it('requires canonical database, readiness, and app URL variables without substituting legacy aliases', () => {
    const evaluation = evaluateRuntimeEnvironment({
      NODE_ENV: 'production',
      DATABASE_URL: 'file:/private/legacy.db',
      APP_URL: 'https://legacy.example.test'
    })
    for (const key of ['NUXT_DATABASE_URL', 'NUXT_READINESS_TOKEN', 'NUXT_PUBLIC_APP_URL']) {
      expect(evaluation.issues).toContainEqual(expect.objectContaining({ key, code: 'missing' }))
    }
    const message = new RuntimeConfigValidationError(evaluation.issues).message
    expect(message).not.toContain('/private/legacy.db')
    expect(message).not.toContain('legacy.example.test')
  })

  it('uses only canonical SQLite configuration and requires an absolute production path', () => {
    expect(
      readDatabaseUrl({
        NODE_ENV: 'production',
        NUXT_DATABASE_URL: 'file:/app/data/events.db',
        DATABASE_URL: 'file:/legacy.db'
      })
    ).toBe('file:/app/data/events.db')
    for (const value of ['file:', 'https://database.example.test/events.db', 'file:./data/events.db']) {
      expect(() => readDatabaseUrl({ NODE_ENV: 'production', NUXT_DATABASE_URL: value })).toThrow(
        RuntimeConfigValidationError
      )
    }
    expect(() => readDatabaseUrl({ DATABASE_URL: 'file:/legacy.db' })).toThrow(/NUXT_DATABASE_URL/)
  })

  it('requires an exact HTTP(S) app origin and HTTPS for a deployed production site', () => {
    for (const appUrl of [
      'https://app.example.test/path',
      'https://app.example.test?private=query',
      'https://app.example.test#fragment',
      'https://user:secret@app.example.test',
      'ftp://app.example.test',
      ' https://app.example.test',
      'http://app.example.test'
    ]) {
      const evaluation = evaluateRuntimeEnvironment(
        runtimeEnvironment({ NODE_ENV: 'production', NUXT_PUBLIC_APP_URL: appUrl })
      )
      expect(evaluation.issues).toContainEqual(expect.objectContaining({ key: 'NUXT_PUBLIC_APP_URL', code: 'invalid' }))
      expect(new RuntimeConfigValidationError(evaluation.issues).message).not.toContain(appUrl)
    }
    expect(
      evaluateRuntimeEnvironment(
        runtimeEnvironment({ NODE_ENV: 'production', NUXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000' })
      ).issues
    ).toEqual([])
  })

  it('detects Nuxt-resolved values that disagree with the deployment environment', () => {
    const environment = runtimeEnvironment()
    const input = runtimeConfigFromEnvironment(environment)
    const evaluation = evaluateRuntimeConfig({ ...input, databaseUrl: 'file:/different/events.db' }, environment)
    expect(evaluation.issues).toContainEqual(expect.objectContaining({ code: 'mismatch', key: 'NUXT_DATABASE_URL' }))
    expect(() => assertStartableRuntimeConfig(evaluation)).toThrow(RuntimeConfigValidationError)
  })

  it('rejects object-node and NITRO aliases without exposing their values', () => {
    const forbiddenKeys = [
      ...canonicalAppRuntimePaths.filter(([, kind]) => kind === 'object').map(([path]) => `NUXT_${path}`),
      ...canonicalAppRuntimePaths.map(([path]) => `NITRO_${path}`),
      'NITRO_ENV_EXPANSION'
    ]
    for (const key of forbiddenKeys) {
      const sentinel = `private-${key.toLowerCase()}-value`
      const evaluation = evaluateRuntimeEnvironment(runtimeEnvironment({ [key]: sentinel }))
      expect(evaluation.issues).toContainEqual(expect.objectContaining({ code: 'invalid', key }))
      expect(new RuntimeConfigValidationError(evaluation.issues).message).not.toContain(sentinel)
    }
    expect(
      evaluateRuntimeEnvironment(
        runtimeEnvironment({ NITRO_PRESET: 'node-server', NITRO_HOST: '127.0.0.1', NITRO_PORT: '3000' })
      ).issues
    ).toEqual([])
  })

  it.each(['NUXT_SECURITY', 'NUXT_SECURITY_ENABLED', 'NITRO_SECURITY', 'NITRO_SECURITY_HEADERS'])(
    'rejects %s overrides that could weaken the security policy',
    (key) => {
      const evaluation = evaluateRuntimeEnvironment(runtimeEnvironment({ [key]: 'private-override' }))
      expect(evaluation.issues).toContainEqual(expect.objectContaining({ code: 'invalid', key }))
      expect(new RuntimeConfigValidationError(evaluation.issues).message).not.toContain('private-override')
    }
  )

  it('requires Sentry DSNs as a complete optional pair', () => {
    for (const key of ['NUXT_SENTRY_DSN', 'NUXT_PUBLIC_SENTRY_DSN']) {
      const evaluation = evaluateRuntimeEnvironment(runtimeEnvironment({ [key]: 'https://public@example.test/1' }))
      const missing = key === 'NUXT_SENTRY_DSN' ? 'NUXT_PUBLIC_SENTRY_DSN' : 'NUXT_SENTRY_DSN'
      expect(evaluation.issues).toContainEqual(expect.objectContaining({ code: 'missing', key: missing }))
    }
    const evaluation = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NUXT_SENTRY_DSN: 'https://private@example.test/1',
        NUXT_PUBLIC_SENTRY_DSN: 'https://public@example.test/2'
      })
    )
    expect(evaluation.issues).toEqual([])
    expect(evaluation.config?.sentryTracesSampleRate).toBe('0.05')
    expect(evaluation.config?.public.sentryTracesSampleRate).toBe('0.05')
  })

  it('validates sample rates after Nitro numeric normalization', () => {
    const environment = runtimeEnvironment({
      NUXT_SENTRY_TRACES_SAMPLE_RATE: '0.050',
      NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: '1e-1'
    })
    const evaluation = evaluateRuntimeEnvironment(environment)
    expect(evaluation.issues).toEqual([])
    expect(evaluation.config?.sentryTracesSampleRate).toBe('0.05')
    expect(evaluation.config?.public.sentryTracesSampleRate).toBe('0.1')
    const input = runtimeConfigFromEnvironment(runtimeEnvironment())
    expect(evaluateRuntimeConfig(input, environment).issues).toContainEqual(
      expect.objectContaining({ code: 'mismatch', key: 'NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE' })
    )
    for (const value of ['', ' ', 'NaN', '-0.1', '1.1']) {
      expect(
        evaluateRuntimeEnvironment(runtimeEnvironment({ NUXT_SENTRY_TRACES_SAMPLE_RATE: value })).issues
      ).toContainEqual(expect.objectContaining({ key: 'NUXT_SENTRY_TRACES_SAMPLE_RATE' }))
    }
  })

  it('does not cache failed standalone configuration before a valid startup', async () => {
    const environment = runtimeEnvironment()
    for (const key of Object.keys(process.env).filter((key) => key.startsWith('NUXT_') || key.startsWith('NITRO_'))) {
      vi.stubEnv(key, undefined)
    }
    for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value)
    vi.stubEnv('NUXT_DATABASE_URL', undefined)
    vi.resetModules()
    const runtime = await import('../server/utils/runtime')
    expect(() => runtime.getAppRuntimeConfig()).toThrow(/NUXT_DATABASE_URL/)
    vi.stubEnv('NUXT_DATABASE_URL', environment.NUXT_DATABASE_URL)
    const config = runtime.getAppRuntimeConfig()
    expect(config.databaseUrl).toBe(environment.NUXT_DATABASE_URL)
    expect(Object.isFrozen(config)).toBe(true)
    expect(runtime.getAppRuntimeConfig()).toBe(config)
  })
})

function runtimeEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'test',
    NUXT_DATABASE_URL: 'file:/tmp/wcu-runtime-test.db',
    NUXT_READINESS_TOKEN: 'Runtime-test-readiness-token-with-32-characters',
    NUXT_PUBLIC_APP_URL: 'https://app.example.test',
    ...overrides
  }
}
