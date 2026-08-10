import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { safeErrorData } from '../server/utils/errors'
import { createBetterAuthSecurityOptions, createRedactedBetterAuthLogger } from '../server/utils/auth/security'
import { validateWithZod } from '../server/utils/validation'
import {
  createMagicLinkEmail,
  createTransactionalEmailSender,
  getTransactionalEmailSender,
  TransactionalEmailDeliveryError
} from '../server/services/email'
import { createMagicLinkDelivery } from '../server/utils/auth/passwordless'
import * as runtime from '../server/utils/runtime'
import {
  assertStartableRuntimeConfig,
  assertSafeBetterAuthBuildEnvironment,
  canonicalAppRuntimePaths,
  evaluateRuntimeConfig,
  evaluateRuntimeEnvironment,
  forbiddenBetterAuthBuildEnvironmentKeys,
  forbiddenBetterAuthRuntimeEnvironmentKeys,
  getAppRuntimeConfig,
  readDatabaseUrl,
  readinessTokenPattern,
  retiredCapabilitySwitchEnvironmentKeys,
  RuntimeConfigValidationError,
  validateRuntimeConfig
} from '../server/utils/runtime'

const r2AccountId = '0123456789abcdef0123456789abcdef'

describe('server foundation utilities', () => {
  it('adapts Zod schemas to h3 validation helpers', () => {
    const validate = validateWithZod(
      z.object({
        name: z.string().min(2)
      }),
      'Invalid test payload'
    )

    expect(validate({ name: 'ok' })).toEqual({ name: 'ok' })

    try {
      validate({ name: '' })
      throw new Error('Expected validation to fail')
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 400,
        statusMessage: 'Invalid test payload',
        data: {
          formErrors: [],
          fieldErrors: {
            name: expect.any(Array)
          }
        }
      })
    }
  })

  it('redacts sensitive provider error fields before exposing error data', () => {
    expect(
      safeErrorData({
        message: 'upstream failed',
        token: 'abc123',
        nested: {
          password: 'secret',
          ok: true
        }
      })
    ).toEqual({
      message: 'upstream failed',
      token: '[redacted]',
      nested: {
        password: '[redacted]',
        ok: true
      }
    })
  })

  it('delivers magic-link email through an injected sender and exposes only a generic failure', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const getSender = vi.fn(() => ({ send }))
    const deliver = createMagicLinkDelivery('Baseline <App>', getSender)
    const input = {
      email: 'person@example.test',
      url: 'https://app.example.test/api/auth/magic-link/verify?token=private-token'
    }

    await expect(deliver(input)).resolves.toBeUndefined()
    expect(getSender).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'person@example.test',
        subject: 'Your sign-in link',
        text: expect.stringContaining('private-token'),
        html: expect.stringContaining('Baseline &lt;App&gt;')
      })
    )

    send.mockRejectedValueOnce(new Error('provider-secret-sentinel'))
    const failure = await deliver(input).catch((error: unknown) => error)
    expect(failure).toMatchObject({
      statusCode: 503,
      body: {
        code: 'EMAIL_DELIVERY_UNAVAILABLE',
        message: 'Email delivery is temporarily unavailable.'
      }
    })
    expect((failure as Error).message).not.toContain('provider-secret-sentinel')
    expect((failure as Error).message).not.toContain('person@example.test')
    expect((failure as Error).message).not.toContain('private-token')
  })

  it('captures a private magic-link email atomically and normalizes capture failures', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'swl-email-capture-test-'))
    const captureDirectory = join(sandbox, 'captures')
    const input = completeRuntimeConfig()
    input.email.captureDirectory = captureDirectory
    const config = validateRuntimeConfig(input, runtimeEnvironment({ NUXT_EMAIL_CAPTURE_DIRECTORY: captureDirectory }))
    const sender = createTransactionalEmailSender(config.email)
    const message = createMagicLinkEmail({
      appName: 'Baseline <App>',
      to: 'person@example.test',
      url: 'https://app.example.test/api/auth/magic-link/verify?token=private-token'
    })

    try {
      await sender.send(message)
      const files = readdirSync(captureDirectory)
      expect(files).toHaveLength(1)
      expect(files[0]).toMatch(/^[0-9a-f-]+\.json$/)
      expect(statSync(captureDirectory).mode & 0o777).toBe(0o700)
      expect(statSync(join(captureDirectory, files[0])).mode & 0o777).toBe(0o600)

      const capture = JSON.parse(readFileSync(join(captureDirectory, files[0]), 'utf8'))
      expect(capture).toMatchObject({
        version: 1,
        transport: 'capture',
        message: {
          from: 'baseline@example.test',
          to: 'person@example.test',
          subject: 'Your sign-in link'
        }
      })
      expect(capture.message.text).toContain('private-token')
      expect(capture.message.html).toContain('Baseline &lt;App&gt;')
      expect(capture.message.html).not.toContain('Baseline <App>')

      rmSync(captureDirectory, { recursive: true })
      writeFileSync(captureDirectory, 'not a directory', { mode: 0o600 })
      const failure = await sender.send(message).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(TransactionalEmailDeliveryError)
      expect((failure as Error).message).toBe('Transactional email delivery failed')
      expect((failure as Error).message).not.toContain('person@example.test')
      expect((failure as Error).message).not.toContain('private-token')
      expect((failure as Error).message).not.toContain(captureDirectory)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })

  it('rejects malformed transactional email input before transport side effects', async () => {
    const input = completeRuntimeConfig()
    const config = validateRuntimeConfig(input, runtimeEnvironment())
    const sender = createTransactionalEmailSender(config.email)
    const message = createMagicLinkEmail({
      appName: 'Baseline App',
      to: 'person@example.test',
      url: 'https://app.example.test/api/auth/magic-link/verify?token=private-token'
    })

    expect(() => createTransactionalEmailSender({ ...config.email, transport: 'invalid-transport' } as never)).toThrow(
      TransactionalEmailDeliveryError
    )
    for (const invalidMessage of [
      { ...message, to: 'person@example.test\r\nBcc: attacker@example.test' },
      { ...message, text: '' },
      { ...message, html: '' }
    ]) {
      await expect(sender.send(invalidMessage)).rejects.toThrow(TransactionalEmailDeliveryError)
    }
    expect(() =>
      createMagicLinkEmail({ appName: '\r\n', to: 'person@example.test', url: 'https://app.example.test' })
    ).toThrow(TransactionalEmailDeliveryError)
    expect(() =>
      createMagicLinkEmail({ appName: 'Baseline App', to: 'person@example.test', url: 'ftp://example.test/link' })
    ).toThrow(TransactionalEmailDeliveryError)
    expect(() =>
      createMagicLinkEmail({ appName: 'Baseline App', to: 'person@example.test', url: 'not a URL' })
    ).toThrow(TransactionalEmailDeliveryError)

    const runtimeConfig = vi.spyOn(runtime, 'getAppRuntimeConfig').mockReturnValue(config)
    try {
      expect(getTransactionalEmailSender()).toBe(getTransactionalEmailSender())
      expect(runtimeConfig).toHaveBeenCalledOnce()
    } finally {
      runtimeConfig.mockRestore()
    }
  })

  it('fails core validation for incomplete email config and production capture outside loopback CI', () => {
    const missing = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NUXT_EMAIL_TRANSPORT: undefined,
        NUXT_EMAIL_FROM: undefined,
        NUXT_EMAIL_CAPTURE_DIRECTORY: undefined
      })
    )
    expect(missing.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'NUXT_EMAIL_TRANSPORT' }),
        expect.objectContaining({ key: 'NUXT_EMAIL_FROM' })
      ])
    )

    const missingCaptureDirectory = evaluateRuntimeEnvironment(
      runtimeEnvironment({ NUXT_EMAIL_CAPTURE_DIRECTORY: undefined })
    )
    expect(missingCaptureDirectory.issues).toContainEqual(
      expect.objectContaining({ code: 'missing', key: 'NUXT_EMAIL_CAPTURE_DIRECTORY' })
    )

    const incompleteResend = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NUXT_EMAIL_TRANSPORT: 'resend',
        NUXT_EMAIL_CAPTURE_DIRECTORY: undefined,
        NUXT_EMAIL_RESEND_API_KEY: undefined
      })
    )
    expect(incompleteResend.issues).toContainEqual(
      expect.objectContaining({ code: 'missing', key: 'NUXT_EMAIL_RESEND_API_KEY' })
    )

    const deployedCapture = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NODE_ENV: 'production',
        CI: undefined,
        NUXT_DATABASE_URL: 'file:/tmp/test.db',
        NUXT_EMAIL_RESEND_API_KEY: 'resend-secret-sentinel'
      })
    )
    expect(deployedCapture.issues).toContainEqual(
      expect.objectContaining({ code: 'invalid', key: 'NUXT_EMAIL_TRANSPORT' })
    )
    expect(new RuntimeConfigValidationError(deployedCapture.issues).message).not.toContain('resend-secret-sentinel')

    const nonLoopbackCiCapture = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NODE_ENV: 'production',
        CI: 'true',
        NUXT_DATABASE_URL: 'file:/tmp/test.db',
        NUXT_PUBLIC_APP_URL: 'https://wcu.example.test',
        NUXT_BETTER_AUTH_URL: 'https://wcu.example.test'
      })
    )
    expect(nonLoopbackCiCapture.issues).toContainEqual(
      expect.objectContaining({ code: 'invalid', key: 'NUXT_EMAIL_TRANSPORT' })
    )

    const invalidEmail = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NUXT_EMAIL_TRANSPORT: ' resend ',
        NUXT_EMAIL_FROM: 'sender@example.test\r\nBcc: attacker@example.test',
        NUXT_EMAIL_CAPTURE_DIRECTORY: undefined,
        NUXT_EMAIL_RESEND_API_KEY: 'resend-private-key'
      })
    )
    for (const key of ['NUXT_EMAIL_TRANSPORT', 'NUXT_EMAIL_FROM']) {
      expect(invalidEmail.issues).toContainEqual(expect.objectContaining({ code: 'invalid', key }))
    }
  })

  it('validates, freezes, and preserves exact runtime credential bytes', () => {
    const input = completeRuntimeConfig()
    input.betterAuth.secret = '  exact-runtime-secret-with-32-characters  '
    const config = validateRuntimeConfig(
      input,
      runtimeEnvironment({
        NUXT_BETTER_AUTH_SECRET: '  exact-runtime-secret-with-32-characters  '
      })
    )

    expect(config.betterAuth.secret).toBe('  exact-runtime-secret-with-32-characters  ')
    expect(Object.isFrozen(config)).toBe(true)
    expect(Object.isFrozen(config.betterAuth)).toBe(true)
    expect(() => {
      ;(config.betterAuth as { secret: string }).secret = 'mutated'
    }).toThrow()
  })

  it('keeps the required readiness token private and preserves its exact validated bytes', () => {
    const readinessToken = 'ready-Exact.Token_Bytes~+/1234567890'
    const input = completeRuntimeConfig()
    input.readinessToken = readinessToken
    const config = validateRuntimeConfig(input, runtimeEnvironment({ NUXT_READINESS_TOKEN: readinessToken }))

    expect(readinessTokenPattern.test(readinessToken)).toBe(true)
    expect(config.readinessToken).toBe(readinessToken)
    expect('readinessToken' in config.public).toBe(false)
    expect(canonicalAppRuntimePaths).toContainEqual(['READINESS_TOKEN', 'leaf'])
    expect(canonicalAppRuntimePaths).not.toContainEqual(['PUBLIC_READINESS_TOKEN', 'leaf'])
    expect(canonicalAppRuntimePaths).toContainEqual(['OPENAI_FILE_SEARCH', 'object'])
    expect(canonicalAppRuntimePaths).not.toContainEqual(['OPENAI_FILE_SEARCH_ENABLED', 'leaf'])
    expect(canonicalAppRuntimePaths).toContainEqual(['OPENAI_FILE_SEARCH_VECTOR_STORE_ID', 'leaf'])
    expect(canonicalAppRuntimePaths).toContainEqual(['OPENAI_WEB_SEARCH', 'object'])
    expect(canonicalAppRuntimePaths).not.toContainEqual(['OPENAI_WEB_SEARCH_ENABLED', 'leaf'])
    expect(canonicalAppRuntimePaths).toContainEqual(['OPENAI_WEB_SEARCH_ALLOWED_DOMAINS', 'leaf'])
  })

  it('rejects malformed readiness tokens and the committed local value in production without exposing bytes', () => {
    const missing = evaluateRuntimeEnvironment(runtimeEnvironment({ NUXT_READINESS_TOKEN: undefined }))
    expect(missing.issues).toContainEqual(expect.objectContaining({ code: 'missing', key: 'NUXT_READINESS_TOKEN' }))

    const malformedTokens = [
      '',
      ' ready-12345678901234567890123456789012',
      'ready-12345678901234567890123456789012 ',
      'ready-too-short',
      '9ready-12345678901234567890123456789012',
      'ready-123456789012345678901234567890:12',
      'ready-123456789012345678901234567890é12'
    ]

    for (const readinessToken of malformedTokens) {
      const evaluation = evaluateRuntimeEnvironment(runtimeEnvironment({ NUXT_READINESS_TOKEN: readinessToken }))
      expect(evaluation.issues).toContainEqual(expect.objectContaining({ key: 'NUXT_READINESS_TOKEN' }))
      if (readinessToken) {
        expect(new RuntimeConfigValidationError(evaluation.issues).message).not.toContain(readinessToken)
      }
    }

    const localSample = 'local-readiness-token-change-me-32-chars'
    const production = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NODE_ENV: 'production',
        NUXT_DATABASE_URL: 'file:/tmp/test.db',
        NUXT_READINESS_TOKEN: localSample
      })
    )
    expect(production.issues).toContainEqual(expect.objectContaining({ code: 'invalid', key: 'NUXT_READINESS_TOKEN' }))
    expect(new RuntimeConfigValidationError(production.issues).message).not.toContain(localSample)
  })

  it('reports missing core values without echoing configured values', () => {
    const input = completeRuntimeConfig()
    input.databaseUrl = ''
    input.betterAuth.secret = 'sensitive-short-value'
    input.betterAuth.url = ''
    input.public.appUrl = ''
    const environment = runtimeEnvironment({
      NUXT_DATABASE_URL: undefined,
      NUXT_BETTER_AUTH_SECRET: undefined,
      NUXT_BETTER_AUTH_URL: undefined,
      NUXT_PUBLIC_APP_URL: undefined
    })

    expect(() => validateRuntimeConfig(input, environment)).toThrow(RuntimeConfigValidationError)

    try {
      validateRuntimeConfig(input, environment)
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeConfigValidationError)
      expect((error as Error).message).toContain('NUXT_DATABASE_URL')
      expect((error as Error).message).toContain('NUXT_BETTER_AUTH_SECRET')
      expect((error as Error).message).toContain('NUXT_BETTER_AUTH_URL')
      expect((error as Error).message).toContain('NUXT_PUBLIC_APP_URL')
      expect((error as Error).message).not.toContain('sensitive-short-value')
    }
  })

  it('does not substitute legacy aliases for missing canonical core variables', () => {
    const legacyValues = {
      DATABASE_URL: 'file:/legacy/must-not-win.db',
      BETTER_AUTH_SECRET: 'legacy-auth-secret-sentinel-with-32-characters',
      BETTER_AUTH_URL: 'https://legacy-auth.example.test',
      APP_URL: 'https://legacy-app.example.test'
    }
    const evaluation = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        ...legacyValues,
        NUXT_DATABASE_URL: undefined,
        NUXT_BETTER_AUTH_SECRET: undefined,
        NUXT_BETTER_AUTH_URL: undefined,
        NUXT_PUBLIC_APP_URL: undefined
      })
    )

    for (const key of ['NUXT_DATABASE_URL', 'NUXT_BETTER_AUTH_SECRET', 'NUXT_BETTER_AUTH_URL', 'NUXT_PUBLIC_APP_URL']) {
      expect(evaluation.issues).toContainEqual(expect.objectContaining({ code: 'missing', key }))
    }
    const message = new RuntimeConfigValidationError(evaluation.issues).message
    for (const value of Object.values(legacyValues)) expect(message).not.toContain(value)
  })

  it('requires each active basic-release provider capability to be complete', () => {
    const cases = [
      [
        'billing',
        [
          'NUXT_STRIPE_SECRET_KEY',
          'NUXT_STRIPE_WEBHOOK_SECRET',
          'NUXT_STRIPE_PORTAL_CONFIGURATION_ID',
          'NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID',
          'NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID',
          'NUXT_STRIPE_PERSONAL_ANNUAL_PRICE_ID',
          'NUXT_STRIPE_FAMILY_MONTHLY_PRICE_ID',
          'NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID'
        ]
      ],
      ['turnstile', ['NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY', 'NUXT_PUBLIC_TURNSTILE_SITE_KEY']],
      ['observability', ['NUXT_SENTRY_DSN', 'NUXT_PUBLIC_SENTRY_DSN']]
    ] as const

    for (const [capabilityId, expectedKeys] of cases) {
      const environment = runtimeEnvironment({
        ...(capabilityId === 'observability'
          ? { NODE_ENV: 'production', NUXT_DATABASE_URL: 'file:/tmp/foundation-provider-test.db' }
          : {}),
        ...Object.fromEntries(expectedKeys.map((key) => [key, undefined]))
      })
      const evaluation = evaluateRuntimeEnvironment(environment)

      for (const key of expectedKeys) {
        expect(evaluation.issues, capabilityId).toContainEqual(expect.objectContaining({ key }))
      }
    }
  })

  it('starts without excluded Files, R2, or OpenAI provider configuration', () => {
    const environment = runtimeEnvironment({
      NUXT_CLOUDFLARE_ACCOUNT_ID: undefined,
      NUXT_FILES_DRIVER: undefined,
      NUXT_CLOUDFLARE_R2_BUCKET: undefined,
      NUXT_CLOUDFLARE_R2_ENDPOINT: undefined,
      NUXT_CLOUDFLARE_R2_ACCESS_KEY_ID: undefined,
      NUXT_CLOUDFLARE_R2_SECRET_ACCESS_KEY: undefined,
      NUXT_OPENAI_API_KEY: undefined,
      NUXT_OPENAI_PROJECT_ID: undefined,
      NUXT_OPENAI_MODEL: undefined,
      NUXT_OPENAI_FILE_SEARCH_VECTOR_STORE_ID: undefined,
      NUXT_OPENAI_WEB_SEARCH_ALLOWED_DOMAINS: undefined
    })
    const config = assertStartableRuntimeConfig(evaluateRuntimeEnvironment(environment))

    expect(config.files.driver).toBe('')
    expect(config.cloudflare.r2.bucket).toBe('')
    expect(config.openai.apiKey).toBe('')
    expect(config.openai.fileSearch.vectorStoreId).toBe('')
    expect(config.openai.webSearch.allowedDomains).toEqual([])
  })

  it('continues to validate supplied dormant provider configuration', () => {
    const config = assertStartableRuntimeConfig(evaluateRuntimeEnvironment(runtimeEnvironment()))

    expect(config.files.driver).toBe('local')
    expect(config.openai.fileSearch.vectorStoreId).toBe('vs_foundation_empty')
    expect(config.openai.webSearch.allowedDomains).toEqual(['example.test'])
  })

  it('limits production local Files storage to isolated CI loopback runtimes', () => {
    const deployedLocal = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NODE_ENV: 'production',
        CI: undefined,
        NUXT_DATABASE_URL: 'file:/tmp/wcu-production-local.db',
        NUXT_PUBLIC_APP_URL: 'https://wcu.example.test',
        NUXT_BETTER_AUTH_URL: 'https://wcu.example.test',
        NUXT_EMAIL_TRANSPORT: 'resend',
        NUXT_EMAIL_CAPTURE_DIRECTORY: undefined,
        NUXT_EMAIL_RESEND_API_KEY: 're_production_local_test'
      })
    )
    expect(deployedLocal.issues).toContainEqual(expect.objectContaining({ code: 'invalid', key: 'NUXT_FILES_DRIVER' }))

    const isolatedLocal = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NODE_ENV: 'production',
        CI: 'true',
        NUXT_DATABASE_URL: 'file:/tmp/wcu-isolated-local.db'
      })
    )
    expect(isolatedLocal.issues).toEqual([])
  })

  it('rejects every retired capability switch', () => {
    for (const key of retiredCapabilitySwitchEnvironmentKeys) {
      const evaluation = evaluateRuntimeEnvironment(runtimeEnvironment({ [key]: 'false' }))
      expect(evaluation.issues).toContainEqual(
        expect.objectContaining({ code: 'invalid', key, message: expect.stringContaining('source-controlled') })
      )
    }
  })

  it('accepts only the configured account Cloudflare R2 S3 endpoint', () => {
    const base = {
      NUXT_FILES_DRIVER: 'r2',
      NUXT_CLOUDFLARE_ACCOUNT_ID: r2AccountId,
      NUXT_CLOUDFLARE_R2_BUCKET: 'bucket',
      NUXT_CLOUDFLARE_R2_ACCESS_KEY_ID: 'access',
      NUXT_CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'secret'
    }

    for (const endpoint of [
      `https://${r2AccountId}.r2.cloudflarestorage.com`,
      `https://${r2AccountId}.eu.r2.cloudflarestorage.com`,
      `https://${r2AccountId}.fedramp.r2.cloudflarestorage.com`
    ]) {
      const evaluation = evaluateRuntimeEnvironment(
        runtimeEnvironment({ ...base, NUXT_CLOUDFLARE_R2_ENDPOINT: endpoint })
      )
      expect(evaluation.issues).toEqual([])
    }

    for (const endpoint of [
      `http://${r2AccountId}.r2.cloudflarestorage.com`,
      'https://other.r2.cloudflarestorage.com',
      `https://${r2AccountId}.r2.cloudflarestorage.com.attacker.invalid`,
      `https://${r2AccountId}.r2.cloudflarestorage.com/bucket`,
      `https://${r2AccountId}.r2.cloudflarestorage.com?credential=leak`
    ]) {
      const evaluation = evaluateRuntimeEnvironment(
        runtimeEnvironment({ ...base, NUXT_CLOUDFLARE_R2_ENDPOINT: endpoint })
      )
      expect(evaluation.issues).toContainEqual(
        expect.objectContaining({ key: 'NUXT_CLOUDFLARE_R2_ENDPOINT', code: 'invalid' })
      )
    }

    for (const accountId of ['account', r2AccountId.toUpperCase()]) {
      const evaluation = evaluateRuntimeEnvironment(
        runtimeEnvironment({
          ...base,
          NUXT_CLOUDFLARE_ACCOUNT_ID: accountId,
          NUXT_CLOUDFLARE_R2_ENDPOINT: `https://${accountId}.r2.cloudflarestorage.com`
        })
      )
      expect(evaluation.issues).toContainEqual(
        expect.objectContaining({ key: 'NUXT_CLOUDFLARE_ACCOUNT_ID', code: 'invalid' })
      )
    }

    const invalidBucket = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        ...base,
        NUXT_CLOUDFLARE_R2_BUCKET: 'Invalid_Bucket',
        NUXT_CLOUDFLARE_R2_ENDPOINT: `https://${r2AccountId}.r2.cloudflarestorage.com`
      })
    )
    expect(invalidBucket.issues).toContainEqual(
      expect.objectContaining({ key: 'NUXT_CLOUDFLARE_R2_BUCKET', code: 'invalid' })
    )
  })

  it('contains every official Turnstile test key to paired non-production configuration', () => {
    const testSiteKeys = [
      '1x00000000000000000000AA',
      '2x00000000000000000000AB',
      '1x00000000000000000000BB',
      '2x00000000000000000000BB',
      '3x00000000000000000000FF'
    ]
    const testSecretKeys = [
      '1x0000000000000000000000000000000AA',
      '2x0000000000000000000000000000000AA',
      '3x0000000000000000000000000000000AA'
    ]
    const pairedSiteKey = testSiteKeys[0] ?? ''
    const pairedSecretKey = testSecretKeys[0] ?? ''

    for (const siteKey of testSiteKeys) {
      expect(
        evaluateRuntimeEnvironment(
          runtimeEnvironment({
            NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY: pairedSecretKey,
            NUXT_PUBLIC_TURNSTILE_SITE_KEY: siteKey
          })
        ).issues
      ).toEqual([])

      const production = evaluateRuntimeEnvironment(
        runtimeEnvironment({
          NODE_ENV: 'production',
          NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY: pairedSecretKey,
          NUXT_PUBLIC_TURNSTILE_SITE_KEY: siteKey
        })
      )
      expect(production.issues).toContainEqual(
        expect.objectContaining({ code: 'invalid', key: 'NUXT_PUBLIC_TURNSTILE_SITE_KEY' })
      )
    }

    for (const secretKey of testSecretKeys) {
      expect(
        evaluateRuntimeEnvironment(
          runtimeEnvironment({
            NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY: secretKey,
            NUXT_PUBLIC_TURNSTILE_SITE_KEY: pairedSiteKey
          })
        ).issues
      ).toEqual([])

      const production = evaluateRuntimeEnvironment(
        runtimeEnvironment({
          NODE_ENV: 'production',
          NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY: secretKey,
          NUXT_PUBLIC_TURNSTILE_SITE_KEY: pairedSiteKey
        })
      )
      expect(production.issues).toContainEqual(
        expect.objectContaining({ code: 'invalid', key: 'NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY' })
      )
    }

    for (const mixed of [
      {
        NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY: pairedSecretKey,
        NUXT_PUBLIC_TURNSTILE_SITE_KEY: 'live-site-key'
      },
      {
        NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY: 'live-secret-key',
        NUXT_PUBLIC_TURNSTILE_SITE_KEY: pairedSiteKey
      }
    ]) {
      const evaluation = evaluateRuntimeEnvironment(runtimeEnvironment(mixed))
      expect(evaluation.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'invalid', key: 'NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY' }),
          expect.objectContaining({ code: 'invalid', key: 'NUXT_PUBLIC_TURNSTILE_SITE_KEY' })
        ])
      )
      const message = new RuntimeConfigValidationError(evaluation.issues).message
      for (const value of Object.values(mixed)) expect(message).not.toContain(value)
    }
  })

  it('keeps normalized config alongside a frozen unified issue list', () => {
    const input = completeRuntimeConfig()
    input.databaseUrl = ''
    const evaluation = evaluateRuntimeConfig(input, runtimeEnvironment({ NUXT_DATABASE_URL: undefined }))

    expect(evaluation.config).toBeDefined()
    expect(evaluation.issues.map((issue) => issue.key)).toContain('NUXT_DATABASE_URL')
    expect(Object.isFrozen(evaluation.config)).toBe(true)
    expect(Object.isFrozen(evaluation.issues)).toBe(true)
  })

  it('requires every R2 field independently when files use r2', () => {
    const complete = completeRuntimeConfig()
    complete.files.driver = 'r2'
    complete.cloudflare.accountId = r2AccountId
    complete.cloudflare.r2 = {
      bucket: 'bucket',
      endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
      accessKeyId: 'access',
      secretAccessKey: 'secret'
    }
    const completeEnvironment = runtimeEnvironment({
      NUXT_FILES_DRIVER: 'r2',
      NUXT_CLOUDFLARE_ACCOUNT_ID: r2AccountId,
      NUXT_CLOUDFLARE_R2_BUCKET: 'bucket',
      NUXT_CLOUDFLARE_R2_ENDPOINT: `https://${r2AccountId}.r2.cloudflarestorage.com`,
      NUXT_CLOUDFLARE_R2_ACCESS_KEY_ID: 'access',
      NUXT_CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'secret'
    })
    const omissions: Array<
      [
        string,
        (config: ReturnType<typeof completeRuntimeConfig>, environment: Record<string, string | undefined>) => void
      ]
    > = [
      [
        'NUXT_CLOUDFLARE_ACCOUNT_ID',
        (config, environment) => {
          config.cloudflare.accountId = ''
          environment.NUXT_CLOUDFLARE_ACCOUNT_ID = undefined
        }
      ],
      [
        'NUXT_CLOUDFLARE_R2_BUCKET',
        (config, environment) => {
          config.cloudflare.r2.bucket = ''
          environment.NUXT_CLOUDFLARE_R2_BUCKET = undefined
        }
      ],
      [
        'NUXT_CLOUDFLARE_R2_ENDPOINT',
        (config, environment) => {
          config.cloudflare.r2.endpoint = ''
          environment.NUXT_CLOUDFLARE_R2_ENDPOINT = undefined
        }
      ],
      [
        'NUXT_CLOUDFLARE_R2_ACCESS_KEY_ID',
        (config, environment) => {
          config.cloudflare.r2.accessKeyId = ''
          environment.NUXT_CLOUDFLARE_R2_ACCESS_KEY_ID = undefined
        }
      ],
      [
        'NUXT_CLOUDFLARE_R2_SECRET_ACCESS_KEY',
        (config, environment) => {
          config.cloudflare.r2.secretAccessKey = ''
          environment.NUXT_CLOUDFLARE_R2_SECRET_ACCESS_KEY = undefined
        }
      ]
    ]

    for (const [expectedKey, omit] of omissions) {
      const input = structuredClone(complete)
      const environment = { ...completeEnvironment }
      omit(input, environment)
      expect(() => validateRuntimeConfig(input, environment)).toThrow(expectedKey)
    }
  })

  it('rejects invalid file drivers and optional Sentry sample rates', () => {
    const invalidDriver = {
      ...completeRuntimeConfig(),
      files: { driver: 'implicit-fallback' }
    }

    expect(() =>
      validateRuntimeConfig(invalidDriver, runtimeEnvironment({ NUXT_FILES_DRIVER: 'implicit-fallback' }))
    ).toThrow(/NUXT_FILES_DRIVER/)

    const invalidSamples = completeRuntimeConfig()
    invalidSamples.sentryDsn = 'https://public@example.ingest.sentry.io/1'
    invalidSamples.public.sentryDsn = 'https://public@example.ingest.sentry.io/1'
    invalidSamples.sentryTracesSampleRate = 'NaN'
    invalidSamples.public.sentryTracesSampleRate = '1.1'

    try {
      validateRuntimeConfig(
        invalidSamples,
        runtimeEnvironment({
          NUXT_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
          NUXT_PUBLIC_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
          NUXT_SENTRY_TRACES_SAMPLE_RATE: 'NaN',
          NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: '1.1'
        })
      )
      throw new Error('Expected runtime validation to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeConfigValidationError)
      expect((error as Error).message).toContain('NUXT_SENTRY_TRACES_SAMPLE_RATE')
      expect((error as Error).message).toContain('NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE')
    }
  })

  it('rejects runtime Sentry sample rates that do not match Nuxt-resolved values', () => {
    const input = completeRuntimeConfig()
    input.sentryDsn = 'https://public@example.ingest.sentry.io/1'
    input.public.sentryDsn = 'https://public@example.ingest.sentry.io/1'

    const environment = runtimeEnvironment({
      NUXT_SENTRY_DSN: input.sentryDsn,
      NUXT_PUBLIC_SENTRY_DSN: input.public.sentryDsn,
      NUXT_SENTRY_TRACES_SAMPLE_RATE: '0.9',
      NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: '0.8'
    })

    const evaluation = evaluateRuntimeConfig(input, environment)
    expect(evaluation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'mismatch', key: 'NUXT_SENTRY_TRACES_SAMPLE_RATE' }),
        expect.objectContaining({ code: 'mismatch', key: 'NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE' })
      ])
    )
  })

  it('accepts valid sample-rate spellings after Nitro numeric normalization', () => {
    const input = completeRuntimeConfig()
    input.sentryDsn = 'https://public@example.ingest.sentry.io/1'
    input.public.sentryDsn = 'https://public@example.ingest.sentry.io/1'
    input.sentryTracesSampleRate = '0.05'
    input.public.sentryTracesSampleRate = '0.1'

    expect(() =>
      validateRuntimeConfig(
        input,
        runtimeEnvironment({
          NUXT_SENTRY_DSN: input.sentryDsn,
          NUXT_PUBLIC_SENTRY_DSN: input.public.sentryDsn,
          NUXT_SENTRY_TRACES_SAMPLE_RATE: '0.050',
          NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: '1e-1'
        })
      )
    ).not.toThrow()
  })

  it('detects runtime values that do not match Nuxt-resolved core and provider values', () => {
    const cases: Array<{
      key: string
      arrange: (
        input: ReturnType<typeof completeRuntimeConfig>,
        environment: Record<string, string | undefined>
      ) => void
    }> = [
      {
        key: 'NUXT_DATABASE_URL',
        arrange: (input, environment) => {
          input.databaseUrl = 'file:./data/build-sentinel.db'
          environment.NUXT_DATABASE_URL = 'file:./data/runtime-sentinel.db'
        }
      },
      {
        key: 'NUXT_BETTER_AUTH_SECRET',
        arrange: (input, environment) => {
          input.betterAuth.secret = 'build-secret-sentinel-with-32-characters'
          environment.NUXT_BETTER_AUTH_SECRET = 'runtime-secret-sentinel-with-32-characters'
        }
      },
      {
        key: 'NUXT_BETTER_AUTH_URL',
        arrange: (input, environment) => {
          input.betterAuth.url = 'https://build-auth.example.test'
          environment.NUXT_BETTER_AUTH_URL = 'https://runtime-auth.example.test'
        }
      },
      {
        key: 'NUXT_PUBLIC_APP_URL',
        arrange: (input, environment) => {
          input.public.appUrl = 'https://build-app.example.test'
          environment.NUXT_PUBLIC_APP_URL = 'https://runtime-app.example.test'
        }
      },
      {
        key: 'NUXT_STRIPE_SECRET_KEY',
        arrange: (input, environment) => {
          input.stripe.secretKey = 'build-stripe-sentinel'
          input.stripe.webhookSecret = 'matching-webhook-secret'
          input.stripe.portalConfigurationId = 'bpc_matching'
          input.stripe.personalWeeklyPriceId = 'price_matching_personal_weekly'
          input.stripe.personalMonthlyPriceId = 'price_matching_personal_monthly'
          input.stripe.personalAnnualPriceId = 'price_matching_personal_annual'
          input.stripe.familyMonthlyPriceId = 'price_matching_family_monthly'
          input.stripe.familyAnnualPriceId = 'price_matching_family_annual'
          Object.assign(environment, {
            NUXT_STRIPE_SECRET_KEY: 'runtime-stripe-sentinel',
            NUXT_STRIPE_WEBHOOK_SECRET: 'matching-webhook-secret',
            NUXT_STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_matching',
            NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID: 'price_matching_personal_weekly',
            NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID: 'price_matching_personal_monthly',
            NUXT_STRIPE_PERSONAL_ANNUAL_PRICE_ID: 'price_matching_personal_annual',
            NUXT_STRIPE_FAMILY_MONTHLY_PRICE_ID: 'price_matching_family_monthly',
            NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID: 'price_matching_family_annual'
          })
        }
      },
      {
        key: 'NUXT_OPENAI_API_KEY',
        arrange: (input, environment) => {
          input.openai = {
            apiKey: 'build-openai-sentinel',
            projectId: 'matching-openai-project',
            model: 'gpt-5.6-luna',
            fileSearch: { vectorStoreId: 'vs_foundation_empty' },
            webSearch: { allowedDomains: 'example.test' }
          }
          Object.assign(environment, {
            NUXT_OPENAI_API_KEY: 'runtime-openai-sentinel',
            NUXT_OPENAI_PROJECT_ID: 'matching-openai-project',
            NUXT_OPENAI_MODEL: 'gpt-5.6-luna'
          })
        }
      }
    ]

    for (const { key, arrange } of cases) {
      const input = completeRuntimeConfig()
      const environment = runtimeEnvironment()
      arrange(input, environment)
      const evaluation = evaluateRuntimeConfig(input, environment)
      const issues = evaluation.issues

      expect(issues).toContainEqual(expect.objectContaining({ code: 'mismatch', key }))
      const message = new RuntimeConfigValidationError(issues).message
      expect(message).not.toContain('build-')
      expect(message).not.toContain('runtime-')
    }
  })

  it('fails malformed destr-resolved leaves for configured providers', () => {
    const cases = [
      {
        key: 'NUXT_STRIPE_SECRET_KEY',
        values: {
          NUXT_STRIPE_SECRET_KEY: '123',
          NUXT_STRIPE_WEBHOOK_SECRET: 'valid-webhook-secret',
          NUXT_STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_test',
          NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID: 'price_personal_weekly',
          NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID: 'price_personal_monthly',
          NUXT_STRIPE_PERSONAL_ANNUAL_PRICE_ID: 'price_personal_annual',
          NUXT_STRIPE_FAMILY_MONTHLY_PRICE_ID: 'price_family_monthly',
          NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID: 'price_family_annual'
        }
      },
      {
        key: 'NUXT_FILES_DRIVER',
        values: { NUXT_FILES_DRIVER: 'true' }
      },
      {
        key: 'NUXT_OPENAI_API_KEY',
        values: {
          NUXT_OPENAI_API_KEY: '{"stale":true}',
          NUXT_OPENAI_PROJECT_ID: 'openai-project',
          NUXT_OPENAI_MODEL: 'gpt-5.6-luna'
        }
      },
      {
        key: 'NUXT_SENTRY_DSN',
        values: {
          NUXT_SENTRY_DSN: '123',
          NUXT_PUBLIC_SENTRY_DSN: '{"stale":true}'
        }
      }
    ] as const

    for (const { key, values } of cases) {
      const evaluation = evaluateRuntimeEnvironment(runtimeEnvironment(values))

      expect(evaluation.config).toBeDefined()
      expect(evaluation.issues).toContainEqual(expect.objectContaining({ key }))
    }
  })

  it('fails closed on malformed core shape and reports malformed provider configuration', () => {
    const malformedPublic = evaluateRuntimeConfig(
      { ...completeRuntimeConfig(), public: undefined },
      runtimeEnvironment()
    )
    expect(malformedPublic.config).toBeUndefined()
    expect(malformedPublic.issues.some((issue) => issue.code === 'shape')).toBe(true)

    const malformedCloudflare = evaluateRuntimeConfig(
      { ...completeRuntimeConfig(), cloudflare: 'invalid' },
      runtimeEnvironment()
    )
    expect(malformedCloudflare.config?.cloudflare.accountId).toBe('')
    expect(malformedCloudflare.issues).toContainEqual(
      expect.objectContaining({ key: 'NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY' })
    )
    expect(Object.isFrozen(malformedCloudflare)).toBe(true)
  })

  it('rejects object-node and NITRO aliases from one complete key inventory without exposing values', () => {
    const forbiddenKeys = [
      ...canonicalAppRuntimePaths.filter(([, kind]) => kind === 'object').map(([path]) => `NUXT_${path}`),
      ...canonicalAppRuntimePaths.map(([path]) => `NITRO_${path}`),
      'NITRO_ENV_EXPANSION'
    ]

    for (const key of forbiddenKeys) {
      const sentinel = `sensitive-${key.toLowerCase()}-value`
      const evaluation = evaluateRuntimeConfig(undefined, runtimeEnvironment({ [key]: sentinel }))
      const issues = evaluation.issues

      expect(issues).toContainEqual(expect.objectContaining({ code: 'invalid', key }))
      expect(new RuntimeConfigValidationError(issues).message).not.toContain(sentinel)
    }

    const allowedControls = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NITRO_PRESET: 'node-server',
        NITRO_HOST: '127.0.0.1',
        NITRO_PORT: '3000',
        NITRO_ENV_PREFIX: 'IGNORED_'
      })
    )
    expect(allowedControls.issues).toEqual([])
  })

  it.each(['NUXT_SECURITY', 'NUXT_SECURITY_ENABLED', 'NITRO_SECURITY', 'NITRO_SECURITY_HEADERS'])(
    'rejects the %s runtime escape hatch before it can weaken the reviewed security policy',
    (key) => {
      const sentinel = `sensitive-${key.toLowerCase()}-override`
      const evaluation = evaluateRuntimeEnvironment(runtimeEnvironment({ [key]: sentinel }))

      expect(evaluation.issues).toContainEqual(expect.objectContaining({ code: 'invalid', key }))
      expect(new RuntimeConfigValidationError(evaluation.issues).message).not.toContain(sentinel)
    }
  )

  it('rejects every Better Auth runtime and build escape hatch without exposing its value', () => {
    for (const key of [...forbiddenBetterAuthRuntimeEnvironmentKeys, ...forbiddenBetterAuthBuildEnvironmentKeys]) {
      const sentinel = `sensitive-runtime-${key.toLowerCase()}-value`
      const evaluation = evaluateRuntimeEnvironment(
        runtimeEnvironment({
          [key]: sentinel,
          ...(key === 'TEST' ? { NODE_ENV: 'production', NUXT_DATABASE_URL: 'file:/tmp/test.db' } : {})
        })
      )
      expect(evaluation.issues).toContainEqual(expect.objectContaining({ code: 'invalid', key }))
      expect(new RuntimeConfigValidationError(evaluation.issues).message).not.toContain(sentinel)
    }

    for (const key of forbiddenBetterAuthBuildEnvironmentKeys) {
      const sentinel = `sensitive-build-${key.toLowerCase()}-value`
      let caught: unknown
      try {
        assertSafeBetterAuthBuildEnvironment({ [key]: sentinel })
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(RuntimeConfigValidationError)
      expect(caught).toMatchObject({ issues: [expect.objectContaining({ code: 'invalid', key })] })
      expect((caught as Error).message).not.toContain(sentinel)
    }

    expect(() => assertSafeBetterAuthBuildEnvironment({ NODE_ENV: 'production' })).not.toThrow()
  })

  it('rejects known development/default auth secrets only in production', () => {
    const unsafeSecrets = [
      'better-auth-secret-12345678901234567890',
      ' better-auth-secret-12345678901234567890 ',
      'development-only-change-before-production',
      'local-development-secret-change-me-32-chars'
    ]

    for (const secret of unsafeSecrets) {
      const production = evaluateRuntimeEnvironment(
        runtimeEnvironment({ NODE_ENV: 'production', NUXT_BETTER_AUTH_SECRET: secret })
      )
      expect(production.issues).toContainEqual(
        expect.objectContaining({ code: 'invalid', key: 'NUXT_BETTER_AUTH_SECRET' })
      )
      expect(new RuntimeConfigValidationError(production.issues).message).not.toContain(secret)
    }

    const local = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NODE_ENV: 'development',
        NUXT_BETTER_AUTH_SECRET: 'local-development-secret-change-me-32-chars'
      })
    )
    expect(local.issues).toEqual([])
  })

  it('requires the canonical auth URL to be an origin without a path, query, or fragment', () => {
    for (const authUrl of [
      'https://auth.example.test/api/auth',
      'https://auth.example.test/?tenant=one',
      'https://auth.example.test/#fragment'
    ]) {
      const evaluation = evaluateRuntimeEnvironment(runtimeEnvironment({ NUXT_BETTER_AUTH_URL: authUrl }))
      expect(evaluation.issues).toContainEqual(
        expect.objectContaining({ code: 'invalid', key: 'NUXT_BETTER_AUTH_URL' })
      )
    }

    const differentOrigin = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NUXT_BETTER_AUTH_URL: 'https://auth.example.test',
        NUXT_PUBLIC_APP_URL: 'https://app.example.test'
      })
    )
    expect(differentOrigin.issues).toContainEqual(
      expect.objectContaining({ code: 'invalid', key: 'NUXT_BETTER_AUTH_URL' })
    )

    const insecureProduction = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NODE_ENV: 'production',
        NUXT_DATABASE_URL: 'file:/tmp/test.db',
        NUXT_BETTER_AUTH_URL: 'http://app.example.test',
        NUXT_PUBLIC_APP_URL: 'http://app.example.test'
      })
    )
    expect(insecureProduction.issues).toContainEqual(
      expect.objectContaining({ code: 'invalid', key: 'NUXT_BETTER_AUTH_URL' })
    )

    for (const loopbackUrl of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
      const loopback = evaluateRuntimeEnvironment(
        runtimeEnvironment({
          NODE_ENV: 'production',
          NUXT_DATABASE_URL: 'file:/tmp/test.db',
          NUXT_BETTER_AUTH_URL: loopbackUrl,
          NUXT_PUBLIC_APP_URL: loopbackUrl
        })
      )
      expect(loopback.issues).toEqual([])
    }
  })

  it('builds one explicit Better Auth origin, proxy, CSRF, cookie, telemetry, IP, and rate policy', () => {
    const input = completeRuntimeConfig()
    input.betterAuth.url = 'https://app.example.test'
    input.public.appUrl = 'https://app.example.test/product'
    const config = validateRuntimeConfig(
      input,
      runtimeEnvironment({
        NUXT_BETTER_AUTH_URL: input.betterAuth.url,
        NUXT_PUBLIC_APP_URL: input.public.appUrl
      })
    )

    expect(createBetterAuthSecurityOptions(config)).toMatchObject({
      basePath: '/api/auth',
      baseURL: 'https://app.example.test',
      secret: config.betterAuth.secret,
      trustedOrigins: [],
      logger: { level: 'error', log: expect.any(Function) },
      advanced: {
        disableCSRFCheck: false,
        disableOriginCheck: false,
        trustedProxyHeaders: false,
        useSecureCookies: true,
        crossSubDomainCookies: { enabled: false },
        defaultCookieAttributes: {
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
          secure: true
        },
        ipAddress: {
          disableIpTracking: false,
          ipAddressHeaders: ['cf-connecting-ip']
        }
      },
      telemetry: { debug: false, enabled: false },
      rateLimit: { enabled: true, max: 100, storage: 'memory', window: 60 }
    })

    const loopback = validateRuntimeConfig(completeRuntimeConfig(), runtimeEnvironment())
    expect(createBetterAuthSecurityOptions(loopback)).toMatchObject({
      trustedOrigins: [],
      advanced: {
        useSecureCookies: false,
        defaultCookieAttributes: { secure: false }
      }
    })

    const written: string[] = []
    const logger = createRedactedBetterAuthLogger((message) => written.push(message))
    logger.log?.('error', 'access-token-sentinel', { refreshToken: 'refresh-token-sentinel' })
    expect(written).toEqual(['[better-auth] error event'])
    expect(written.join(' ')).not.toContain('token-sentinel')

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      createRedactedBetterAuthLogger().log?.('warn', 'provider-secret-sentinel')
      expect(consoleError).toHaveBeenCalledWith('[better-auth] warn event')
    } finally {
      consoleError.mockRestore()
    }
  })

  it('requires a present optional app name to be nonblank, trimmed, and equal to Nitro resolution', () => {
    for (const appName of ['', '   ', ' padded name ', 'null']) {
      const evaluation = evaluateRuntimeEnvironment(
        runtimeEnvironment({
          NUXT_PUBLIC_APP_NAME: appName
        })
      )

      expect(evaluation.issues).toContainEqual(expect.objectContaining({ key: 'NUXT_PUBLIC_APP_NAME' }))
      if (appName === 'null') {
        expect(evaluation.config?.public.appName).toBe('Working Class Unity')
        expect(evaluation.issues).toContainEqual(
          expect.objectContaining({ code: 'mismatch', key: 'NUXT_PUBLIC_APP_NAME' })
        )
      }
    }

    const valid = evaluateRuntimeEnvironment(runtimeEnvironment({ NUXT_PUBLIC_APP_NAME: 'Runtime Name' }))
    expect(valid.issues).toEqual([])
    expect(valid.config?.public.appName).toBe('Runtime Name')
  })

  it('rejects each malformed core variant with a safe keyed issue', () => {
    const cases: Array<{
      key: string
      arrange: (
        input: ReturnType<typeof completeRuntimeConfig>,
        environment: Record<string, string | undefined>
      ) => void
    }> = [
      {
        key: 'NUXT_DATABASE_URL',
        arrange: (input, environment) => {
          input.databaseUrl = 'https://database.example.test/app.db'
          environment.NUXT_DATABASE_URL = input.databaseUrl
        }
      },
      {
        key: 'NUXT_DATABASE_URL',
        arrange: (input, environment) => {
          input.databaseUrl = 'file:'
          environment.NUXT_DATABASE_URL = input.databaseUrl
        }
      },
      {
        key: 'NUXT_BETTER_AUTH_SECRET',
        arrange: (input, environment) => {
          input.betterAuth.secret = 'too-short'
          environment.NUXT_BETTER_AUTH_SECRET = input.betterAuth.secret
        }
      },
      {
        key: 'NUXT_BETTER_AUTH_URL',
        arrange: (input, environment) => {
          input.betterAuth.url = 'ftp://auth.example.test'
          environment.NUXT_BETTER_AUTH_URL = input.betterAuth.url
        }
      },
      {
        key: 'NUXT_PUBLIC_APP_URL',
        arrange: (input, environment) => {
          input.public.appUrl = 'file:///tmp/app'
          environment.NUXT_PUBLIC_APP_URL = input.public.appUrl
        }
      },
      {
        key: 'NUXT_PUBLIC_APP_URL',
        arrange: (input, environment) => {
          input.public.appUrl = ' http://127.0.0.1:3000 '
          environment.NUXT_PUBLIC_APP_URL = input.public.appUrl
        }
      }
    ]

    for (const { key, arrange } of cases) {
      const input = completeRuntimeConfig()
      const environment = runtimeEnvironment()
      arrange(input, environment)
      const evaluation = evaluateRuntimeConfig(input, environment)
      expect(evaluation.issues).toContainEqual(expect.objectContaining({ code: 'invalid', key }))
      expect(new RuntimeConfigValidationError(evaluation.issues).message).not.toContain('example.test')
    }
  })

  it('defaults omitted sample rates and app name, preserves numeric spelling, and rejects raw Sentry splits', () => {
    const sentryDsn = 'https://public@example.ingest.sentry.io/1'
    const omitted = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NUXT_SENTRY_DSN: sentryDsn,
        NUXT_PUBLIC_SENTRY_DSN: sentryDsn
      })
    )
    expect(omitted.issues).toEqual([])
    expect(omitted.config?.sentryTracesSampleRate).toBe('0.05')
    expect(omitted.config?.public.sentryTracesSampleRate).toBe('0.05')
    expect(omitted.config?.public.appName).toBe('Working Class Unity')

    const alternateSpellings = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NUXT_SENTRY_DSN: sentryDsn,
        NUXT_PUBLIC_SENTRY_DSN: sentryDsn,
        NUXT_SENTRY_TRACES_SAMPLE_RATE: '0.050',
        NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: '1e-1'
      })
    )
    expect(alternateSpellings.issues).toEqual([])
    expect(alternateSpellings.config?.sentryTracesSampleRate).toBe('0.05')
    expect(alternateSpellings.config?.public.sentryTracesSampleRate).toBe('0.1')

    const invalidRawValues = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NUXT_SENTRY_DSN: ` ${sentryDsn}`,
        NUXT_PUBLIC_SENTRY_DSN: `${sentryDsn} `,
        NUXT_SENTRY_TRACES_SAMPLE_RATE: '',
        NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: '   '
      })
    )
    expect(invalidRawValues.issues.map((issue) => issue.key)).toEqual(
      expect.arrayContaining([
        'NUXT_SENTRY_DSN',
        'NUXT_PUBLIC_SENTRY_DSN',
        'NUXT_SENTRY_TRACES_SAMPLE_RATE',
        'NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE'
      ])
    )
  })

  it('uses only NUXT_DATABASE_URL and requires an absolute production SQLite path', () => {
    expect(
      readDatabaseUrl({
        NODE_ENV: 'production',
        NUXT_DATABASE_URL: 'file:/app/data/app.db',
        DATABASE_URL: 'file:/legacy/must-not-win.db'
      })
    ).toBe('file:/app/data/app.db')
    expect(() =>
      readDatabaseUrl({
        NODE_ENV: 'production',
        NUXT_DATABASE_URL: 'file:./data/app.db'
      })
    ).toThrow(/absolute path/)
    expect(() => readDatabaseUrl({ DATABASE_URL: 'file:/legacy/only.db' })).toThrow(/NUXT_DATABASE_URL/)
  })

  it('keeps the standalone cache unset after invalid input, then freezes one environment-evaluated config', () => {
    const validEnvironment = runtimeEnvironment({
      NUXT_FILES_DRIVER: 'local'
    })
    const managedKeys = new Set([
      ...Object.keys(process.env).filter((key) => key.startsWith('NUXT_') || key.startsWith('NITRO_')),
      ...Object.keys(validEnvironment),
      'NODE_ENV'
    ])
    const previousValues = new Map([...managedKeys].map((key) => [key, process.env[key]]))

    try {
      for (const key of managedKeys) Reflect.deleteProperty(process.env, key)
      for (const [key, value] of Object.entries(validEnvironment)) {
        if (value !== undefined) process.env[key] = value
      }
      delete process.env.NUXT_DATABASE_URL

      let invalidError: unknown
      try {
        getAppRuntimeConfig()
      } catch (error) {
        invalidError = error
      }
      expect(invalidError).toBeInstanceOf(RuntimeConfigValidationError)
      expect((invalidError as RuntimeConfigValidationError).issues).toContainEqual(
        expect.objectContaining({ key: 'NUXT_DATABASE_URL' })
      )
      expect((invalidError as Error).message).not.toContain(validEnvironment.NUXT_BETTER_AUTH_SECRET)

      process.env.NUXT_DATABASE_URL = validEnvironment.NUXT_DATABASE_URL
      const config = getAppRuntimeConfig()
      expect(config.files.driver).toBe('local')
      expect(Object.isFrozen(config)).toBe(true)
      expect(getAppRuntimeConfig()).toBe(config)
    } finally {
      for (const key of managedKeys) {
        const previousValue = previousValues.get(key)
        if (previousValue === undefined) Reflect.deleteProperty(process.env, key)
        else process.env[key] = previousValue
      }
    }
  })

  it('uses a present Nuxt runtime binding without masking its failures', async () => {
    const validEnvironment = runtimeEnvironment({
      NUXT_FILES_DRIVER: 'local'
    })
    const managedKeys = new Set([
      ...Object.keys(process.env).filter((key) => key.startsWith('NUXT_') || key.startsWith('NITRO_')),
      ...Object.keys(validEnvironment),
      'NODE_ENV'
    ])
    const previousValues = new Map([...managedKeys].map((key) => [key, process.env[key]]))
    const runtimeGlobal = globalThis as typeof globalThis & { useRuntimeConfig?: unknown }
    const previousRuntimeBinding = Object.getOwnPropertyDescriptor(runtimeGlobal, 'useRuntimeConfig')

    try {
      for (const key of managedKeys) Reflect.deleteProperty(process.env, key)
      for (const [key, value] of Object.entries(validEnvironment)) {
        if (value !== undefined) process.env[key] = value
      }

      const nuxtInput = completeRuntimeConfig()
      nuxtInput.public.appName = 'Working Class Unity'
      nuxtInput.files.driver = 'local'
      const bindingFailure = { exact: 'nuxt-runtime-binding-failure' }
      const runtimeBinding = vi.fn(() => nuxtInput)
      runtimeBinding.mockImplementationOnce(() => {
        throw bindingFailure
      })
      runtimeGlobal.useRuntimeConfig = runtimeBinding
      vi.resetModules()
      const nuxtRuntime = await import('../server/utils/runtime')
      let thrownBindingFailure: unknown
      try {
        nuxtRuntime.getAppRuntimeConfig()
      } catch (error) {
        thrownBindingFailure = error
      }
      expect(thrownBindingFailure).toBe(bindingFailure)
      const config = nuxtRuntime.getAppRuntimeConfig()
      expect(config.files.driver).toBe('local')
      expect(Object.isFrozen(config)).toBe(true)
      expect(nuxtRuntime.getAppRuntimeConfig()).toBe(config)
      expect(runtimeBinding).toHaveBeenCalledTimes(2)
    } finally {
      vi.resetModules()
      if (previousRuntimeBinding) Object.defineProperty(runtimeGlobal, 'useRuntimeConfig', previousRuntimeBinding)
      else delete runtimeGlobal.useRuntimeConfig
      for (const key of managedKeys) {
        const previousValue = previousValues.get(key)
        if (previousValue === undefined) Reflect.deleteProperty(process.env, key)
        else process.env[key] = previousValue
      }
    }
  })
})

function runtimeEnvironment(overrides: Record<string, string | undefined> = {}) {
  const nodeEnvironment = overrides.NODE_ENV ?? 'test'
  return {
    CI: 'true',
    NODE_ENV: nodeEnvironment,
    NUXT_DATABASE_URL: 'file:./data/test.db',
    NUXT_READINESS_TOKEN:
      nodeEnvironment === 'production'
        ? 'test-production-readiness-token-with-32-characters'
        : 'local-readiness-token-change-me-32-chars',
    NUXT_BETTER_AUTH_SECRET: 'test-runtime-secret-with-32-characters',
    NUXT_BETTER_AUTH_URL: 'http://127.0.0.1:3000',
    NUXT_EMAIL_TRANSPORT: 'capture',
    NUXT_EMAIL_FROM: 'baseline@example.test',
    NUXT_EMAIL_CAPTURE_DIRECTORY: './data/test-email-capture',
    NUXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
    NUXT_STRIPE_SECRET_KEY: 'rk_test_foundation_not_a_provider_credential',
    NUXT_STRIPE_WEBHOOK_SECRET: 'whsec_foundation_not_a_provider_credential',
    NUXT_STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_foundation',
    NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID: 'price_foundation_personal_weekly',
    NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID: 'price_foundation_personal_monthly',
    NUXT_STRIPE_PERSONAL_ANNUAL_PRICE_ID: 'price_foundation_personal_annual',
    NUXT_STRIPE_FAMILY_MONTHLY_PRICE_ID: 'price_foundation_family_monthly',
    NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID: 'price_foundation_family_annual',
    NUXT_FILES_DRIVER: 'local',
    NUXT_OPENAI_API_KEY: 'foundation-openai-key-not-a-provider-credential',
    NUXT_OPENAI_PROJECT_ID: 'proj_foundation_test',
    NUXT_OPENAI_MODEL: 'gpt-5.6-luna',
    NUXT_OPENAI_FILE_SEARCH_VECTOR_STORE_ID: 'vs_foundation_empty',
    NUXT_OPENAI_WEB_SEARCH_ALLOWED_DOMAINS: 'example.test',
    NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY: 'foundation-turnstile-secret-not-a-provider-credential',
    NUXT_PUBLIC_TURNSTILE_SITE_KEY: 'foundation-turnstile-site-not-a-provider-credential',
    ...(nodeEnvironment === 'production'
      ? {
          NUXT_SENTRY_DSN: 'https://private@example.test/1',
          NUXT_PUBLIC_SENTRY_DSN: 'https://public@example.test/2'
        }
      : {}),
    ...overrides
  }
}

function completeRuntimeConfig() {
  return {
    databaseUrl: 'file:./data/test.db',
    readinessToken: 'local-readiness-token-change-me-32-chars',
    betterAuth: {
      secret: 'test-runtime-secret-with-32-characters',
      url: 'http://127.0.0.1:3000'
    },
    email: {
      transport: 'capture' as '' | 'capture' | 'resend',
      from: 'baseline@example.test',
      captureDirectory: './data/test-email-capture',
      resend: {
        apiKey: ''
      }
    },
    stripe: {
      secretKey: 'rk_test_foundation_not_a_provider_credential',
      webhookSecret: 'whsec_foundation_not_a_provider_credential',
      portalConfigurationId: 'bpc_foundation',
      personalWeeklyPriceId: 'price_foundation_personal_weekly',
      personalMonthlyPriceId: 'price_foundation_personal_monthly',
      personalAnnualPriceId: 'price_foundation_personal_annual',
      familyMonthlyPriceId: 'price_foundation_family_monthly',
      familyAnnualPriceId: 'price_foundation_family_annual'
    },
    files: {
      driver: 'local' as '' | 'local' | 'r2'
    },
    openai: {
      apiKey: 'foundation-openai-key-not-a-provider-credential',
      projectId: 'proj_foundation_test',
      model: 'gpt-5.6-luna' as '' | 'gpt-5.6-luna',
      fileSearch: {
        vectorStoreId: 'vs_foundation_empty'
      },
      webSearch: {
        allowedDomains: 'example.test'
      }
    },
    sentryDsn: '',
    sentryEnvironment: '',
    sentryRelease: '',
    sentryTracesSampleRate: '0.05',
    observability: {
      testToken: ''
    },
    cloudflare: {
      accountId: '',
      r2: {
        bucket: '',
        endpoint: '',
        accessKeyId: '',
        secretAccessKey: ''
      },
      turnstile: {
        secretKey: 'foundation-turnstile-secret-not-a-provider-credential'
      }
    },
    public: {
      appName: 'Test app',
      appUrl: 'http://127.0.0.1:3000',
      sentryDsn: '',
      sentryEnvironment: '',
      sentryRelease: '',
      sentryTracesSampleRate: '0.05',
      turnstileSiteKey: 'foundation-turnstile-site-not-a-provider-credential'
    }
  }
}
