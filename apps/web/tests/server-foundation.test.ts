import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import nodemailer from 'nodemailer'
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
import { getPublicSocialProviderStates } from '../server/utils/auth/social'
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
  RuntimeConfigValidationError,
  runtimeModuleIds,
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

  it('uses authenticated TLS-only SMTP options and normalizes provider rejection', async () => {
    const input = completeRuntimeConfig()
    input.email = {
      transport: 'smtp',
      from: 'baseline@example.test',
      captureDirectory: '',
      smtp: {
        host: 'smtp.example.test',
        port: '587',
        security: 'starttls',
        username: ' exact-user ',
        password: ' exact-password '
      }
    }
    const environment = runtimeEnvironment({
      NUXT_EMAIL_TRANSPORT: 'smtp',
      NUXT_EMAIL_CAPTURE_DIRECTORY: undefined,
      NUXT_EMAIL_SMTP_HOST: 'smtp.example.test',
      NUXT_EMAIL_SMTP_PORT: '587',
      NUXT_EMAIL_SMTP_SECURITY: 'starttls',
      NUXT_EMAIL_SMTP_USERNAME: ' exact-user ',
      NUXT_EMAIL_SMTP_PASSWORD: ' exact-password '
    })
    const config = validateRuntimeConfig(input, environment)
    const sendMail = vi.fn().mockResolvedValue({ accepted: ['person@example.test'], rejected: [] })
    const createTransport = vi
      .spyOn(nodemailer, 'createTransport')
      .mockReturnValue({ sendMail } as unknown as ReturnType<typeof nodemailer.createTransport>)

    try {
      const sender = createTransactionalEmailSender(config.email)
      const message = createMagicLinkEmail({
        appName: 'Baseline App',
        to: 'person@example.test',
        url: 'https://app.example.test/api/auth/magic-link/verify?token=provider-secret'
      })
      await sender.send(message)

      expect(config.email.smtp.username).toBe(' exact-user ')
      expect(config.email.smtp.password).toBe(' exact-password ')
      expect('email' in config.public).toBe(false)
      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'smtp.example.test',
          port: 587,
          secure: false,
          requireTLS: true,
          ignoreTLS: false,
          opportunisticTLS: false,
          logger: false,
          debug: false,
          transactionLog: false,
          disableFileAccess: true,
          disableUrlAccess: true,
          auth: { user: ' exact-user ', pass: ' exact-password ' },
          tls: { rejectUnauthorized: true, servername: 'smtp.example.test' }
        })
      )
      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'baseline@example.test',
          to: 'person@example.test',
          disableFileAccess: true,
          disableUrlAccess: true
        })
      )

      sendMail.mockResolvedValueOnce({ accepted: [], rejected: ['person@example.test'] })
      const failure = await sender.send(message).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(TransactionalEmailDeliveryError)
      expect((failure as Error).message).toBe('Transactional email delivery failed')
      expect((failure as Error).message).not.toContain('person@example.test')
      expect((failure as Error).message).not.toContain('provider-secret')
    } finally {
      createTransport.mockRestore()
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

  it('fails core validation for incomplete email config and production capture outside CI', () => {
    const missing = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NUXT_EMAIL_TRANSPORT: undefined,
        NUXT_EMAIL_FROM: undefined,
        NUXT_EMAIL_CAPTURE_DIRECTORY: undefined
      })
    )
    expect(missing.coreIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'NUXT_EMAIL_TRANSPORT' }),
        expect.objectContaining({ key: 'NUXT_EMAIL_FROM' })
      ])
    )

    const missingCaptureDirectory = evaluateRuntimeEnvironment(
      runtimeEnvironment({ NUXT_EMAIL_CAPTURE_DIRECTORY: undefined })
    )
    expect(missingCaptureDirectory.coreIssues).toContainEqual(
      expect.objectContaining({ code: 'missing', key: 'NUXT_EMAIL_CAPTURE_DIRECTORY' })
    )

    const incompleteSmtp = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NUXT_EMAIL_TRANSPORT: 'smtp',
        NUXT_EMAIL_CAPTURE_DIRECTORY: undefined
      })
    )
    for (const key of [
      'NUXT_EMAIL_SMTP_HOST',
      'NUXT_EMAIL_SMTP_PORT',
      'NUXT_EMAIL_SMTP_SECURITY',
      'NUXT_EMAIL_SMTP_USERNAME',
      'NUXT_EMAIL_SMTP_PASSWORD'
    ]) {
      expect(incompleteSmtp.coreIssues).toContainEqual(expect.objectContaining({ key }))
    }

    const deployedCapture = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NODE_ENV: 'production',
        CI: undefined,
        NUXT_DATABASE_URL: 'file:/tmp/test.db',
        NUXT_EMAIL_SMTP_PASSWORD: 'smtp-secret-sentinel'
      })
    )
    expect(deployedCapture.coreIssues).toContainEqual(
      expect.objectContaining({ code: 'invalid', key: 'NUXT_EMAIL_TRANSPORT' })
    )
    expect(new RuntimeConfigValidationError(deployedCapture.coreIssues).message).not.toContain('smtp-secret-sentinel')

    const invalidSmtp = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NUXT_EMAIL_TRANSPORT: ' smtp ',
        NUXT_EMAIL_FROM: 'sender@example.test\r\nBcc: attacker@example.test',
        NUXT_EMAIL_CAPTURE_DIRECTORY: undefined,
        NUXT_EMAIL_SMTP_HOST: 'smtp.example.test\r\nInjected: value',
        NUXT_EMAIL_SMTP_PORT: '65536',
        NUXT_EMAIL_SMTP_SECURITY: 'starttls',
        NUXT_EMAIL_SMTP_USERNAME: 'smtp-user',
        NUXT_EMAIL_SMTP_PASSWORD: 'smtp-password'
      })
    )
    for (const key of ['NUXT_EMAIL_TRANSPORT', 'NUXT_EMAIL_FROM', 'NUXT_EMAIL_SMTP_HOST', 'NUXT_EMAIL_SMTP_PORT']) {
      expect(invalidSmtp.coreIssues).toContainEqual(expect.objectContaining({ code: 'invalid', key }))
    }
  })

  it('keeps Google independently disabled without credentials and exposes only server-derived state', () => {
    const evaluation = evaluateRuntimeEnvironment(runtimeEnvironment())

    expect(evaluation.coreIssues).toEqual([])
    expect(evaluation.config?.socialProviders.google).toEqual({
      enabled: false,
      clientId: '',
      clientSecret: ''
    })
    expect(getPublicSocialProviderStates(evaluation.config!)).toEqual({ google: 'disabled' })
    expect(Object.isFrozen(getPublicSocialProviderStates(evaluation.config!))).toBe(true)
    expect('socialProviders' in evaluation.config!.public).toBe(false)
    expect(canonicalAppRuntimePaths).toEqual(
      expect.arrayContaining([
        ['SOCIAL_PROVIDERS', 'object'],
        ['SOCIAL_PROVIDERS_GOOGLE', 'object'],
        ['SOCIAL_PROVIDERS_GOOGLE_ENABLED', 'leaf'],
        ['SOCIAL_PROVIDERS_GOOGLE_CLIENT_ID', 'leaf'],
        ['SOCIAL_PROVIDERS_GOOGLE_CLIENT_SECRET', 'leaf']
      ])
    )
  })

  it('requires complete enabled Google credentials and preserves the private secret bytes', () => {
    const clientId = 'google-client-id.apps.googleusercontent.com'
    const clientSecret = ' exact-google-client-secret '
    const enabled = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NUXT_SOCIAL_PROVIDERS_GOOGLE_ENABLED: 'true',
        NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_ID: clientId,
        NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_SECRET: clientSecret
      })
    )

    expect(enabled.coreIssues).toEqual([])
    expect(enabled.config?.socialProviders.google).toEqual({ enabled: true, clientId, clientSecret })
    expect(getPublicSocialProviderStates(enabled.config!)).toEqual({ google: 'ready' })

    const invalidCases = [
      {
        environment: runtimeEnvironment({
          NUXT_SOCIAL_PROVIDERS_GOOGLE_ENABLED: undefined,
          NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_ID: clientId,
          NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_SECRET: clientSecret
        }),
        key: 'NUXT_SOCIAL_PROVIDERS_GOOGLE_ENABLED'
      },
      {
        environment: runtimeEnvironment({
          NUXT_SOCIAL_PROVIDERS_GOOGLE_ENABLED: 'TRUE',
          NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_ID: clientId,
          NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_SECRET: clientSecret
        }),
        key: 'NUXT_SOCIAL_PROVIDERS_GOOGLE_ENABLED'
      },
      {
        environment: runtimeEnvironment({
          NUXT_SOCIAL_PROVIDERS_GOOGLE_ENABLED: 'true',
          NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_ID: undefined,
          NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_SECRET: clientSecret
        }),
        key: 'NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_ID'
      },
      {
        environment: runtimeEnvironment({
          NUXT_SOCIAL_PROVIDERS_GOOGLE_ENABLED: 'true',
          NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_ID: clientId,
          NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_SECRET: undefined
        }),
        key: 'NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_SECRET'
      },
      {
        environment: runtimeEnvironment({
          NUXT_SOCIAL_PROVIDERS_GOOGLE_ENABLED: 'true',
          NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_ID: ` ${clientId}`,
          NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_SECRET: clientSecret
        }),
        key: 'NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_ID'
      },
      {
        environment: runtimeEnvironment({
          NUXT_SOCIAL_PROVIDERS_GOOGLE_ENABLED: 'true',
          NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_ID: clientId,
          NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_SECRET: 'true'
        }),
        key: 'NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_SECRET'
      }
    ]

    for (const { environment, key } of invalidCases) {
      const invalid = evaluateRuntimeEnvironment(environment)
      expect(invalid.coreIssues).toContainEqual(expect.objectContaining({ key }))
      expect(new RuntimeConfigValidationError(invalid.coreIssues).message).not.toContain(clientSecret)
    }
  })

  it('validates, freezes, and preserves exact runtime credential bytes', () => {
    const input = completeRuntimeConfig()
    input.betterAuth.secret = '  exact-runtime-secret-with-32-characters  '
    input.stripe.secretKey = '  sk_exact_bytes  '
    const config = validateRuntimeConfig(
      input,
      runtimeEnvironment({
        NUXT_BETTER_AUTH_SECRET: '  exact-runtime-secret-with-32-characters  '
      })
    )

    expect(config.betterAuth.secret).toBe('  exact-runtime-secret-with-32-characters  ')
    expect(config.stripe.secretKey).toBe('  sk_exact_bytes  ')
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
    expect(canonicalAppRuntimePaths).toContainEqual(['OPENAI_FILE_SEARCH_ENABLED', 'leaf'])
    expect(canonicalAppRuntimePaths).toContainEqual(['OPENAI_FILE_SEARCH_VECTOR_STORE_ID', 'leaf'])
    expect(canonicalAppRuntimePaths).toContainEqual(['OPENAI_WEB_SEARCH', 'object'])
    expect(canonicalAppRuntimePaths).toContainEqual(['OPENAI_WEB_SEARCH_ENABLED', 'leaf'])
    expect(canonicalAppRuntimePaths).toContainEqual(['OPENAI_WEB_SEARCH_ALLOWED_DOMAINS', 'leaf'])
  })

  it('rejects malformed readiness tokens and the committed local value in production without exposing bytes', () => {
    const missing = evaluateRuntimeEnvironment(runtimeEnvironment({ NUXT_READINESS_TOKEN: undefined }))
    expect(missing.coreIssues).toContainEqual(expect.objectContaining({ code: 'missing', key: 'NUXT_READINESS_TOKEN' }))

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
      expect(evaluation.coreIssues).toContainEqual(expect.objectContaining({ key: 'NUXT_READINESS_TOKEN' }))
      if (readinessToken) {
        expect(new RuntimeConfigValidationError(evaluation.coreIssues).message).not.toContain(readinessToken)
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
    expect(production.coreIssues).toContainEqual(
      expect.objectContaining({ code: 'invalid', key: 'NUXT_READINESS_TOKEN' })
    )
    expect(new RuntimeConfigValidationError(production.coreIssues).message).not.toContain(localSample)
  })

  it('reports missing core and strict module flags without echoing configured values', () => {
    const input = completeRuntimeConfig()
    input.databaseUrl = ''
    input.betterAuth.secret = 'sensitive-short-value'
    input.betterAuth.url = ''
    input.public.appUrl = ''
    const environment = runtimeEnvironment({
      NUXT_DATABASE_URL: undefined,
      NUXT_BETTER_AUTH_SECRET: undefined,
      NUXT_BETTER_AUTH_URL: undefined,
      NUXT_PUBLIC_APP_URL: undefined,
      NUXT_MODULES_BILLING_ENABLED: 'TRUE',
      NUXT_MODULES_FILES_ENABLED: undefined
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
      expect((error as Error).message).toContain('NUXT_MODULES_BILLING_ENABLED')
      expect((error as Error).message).toContain('NUXT_MODULES_FILES_ENABLED')
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
      expect(evaluation.coreIssues).toContainEqual(expect.objectContaining({ code: 'missing', key }))
    }
    const message = new RuntimeConfigValidationError(evaluation.coreIssues).message
    for (const value of Object.values(legacyValues)) expect(message).not.toContain(value)
  })

  it('requires each enabled provider module to be complete', () => {
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
      ['files', ['NUXT_FILES_DRIVER']],
      ['ai', ['NUXT_OPENAI_API_KEY', 'NUXT_OPENAI_PROJECT_ID', 'NUXT_OPENAI_MODEL']],
      ['turnstile', ['NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY', 'NUXT_PUBLIC_TURNSTILE_SITE_KEY']],
      ['observability', ['NUXT_SENTRY_DSN', 'NUXT_PUBLIC_SENTRY_DSN']]
    ] as const

    for (const [moduleId, expectedKeys] of cases) {
      const input = completeRuntimeConfig()
      input.modules[moduleId].enabled = true
      const environment = runtimeEnvironment({
        [`NUXT_MODULES_${moduleId.toUpperCase()}_ENABLED`]: 'true'
      })

      try {
        validateRuntimeConfig(input, environment)
        throw new Error(`Expected ${moduleId} validation to fail`)
      } catch (error) {
        expect(error).toBeInstanceOf(RuntimeConfigValidationError)
        for (const key of expectedKeys) {
          expect((error as Error).message).toContain(key)
        }
      }
    }
  })

  it('accepts complete enabled modules and core-only jobs', () => {
    const input = completeRuntimeConfig()
    const environment = runtimeEnvironment()
    for (const moduleId of runtimeModuleIds) {
      input.modules[moduleId].enabled = true
      environment[`NUXT_MODULES_${moduleId.toUpperCase()}_ENABLED`] = 'true'
    }
    input.stripe.secretKey = 'rk_test_runtime'
    input.stripe.webhookSecret = 'whsec_runtime'
    input.stripe.portalConfigurationId = 'bpc_runtime'
    input.stripe.personalWeeklyPriceId = 'price_personal_weekly_runtime'
    input.stripe.personalMonthlyPriceId = 'price_personal_monthly_runtime'
    input.stripe.personalAnnualPriceId = 'price_personal_annual_runtime'
    input.stripe.familyMonthlyPriceId = 'price_family_monthly_runtime'
    input.stripe.familyAnnualPriceId = 'price_family_annual_runtime'
    input.files.driver = 'r2'
    input.cloudflare.accountId = r2AccountId
    input.cloudflare.r2 = {
      bucket: 'bucket',
      endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
      accessKeyId: 'access',
      secretAccessKey: 'secret'
    }
    input.openai = {
      apiKey: 'openai-runtime-key',
      projectId: 'openai-runtime-project',
      model: 'gpt-5.6-luna',
      fileSearch: { enabled: false, vectorStoreId: '' },
      webSearch: { enabled: false, allowedDomains: '' }
    }
    input.cloudflare.turnstile.secretKey = 'turnstile-secret'
    input.public.turnstileSiteKey = 'turnstile-site'
    input.sentryDsn = 'https://public@example.ingest.sentry.io/1'
    input.public.sentryDsn = 'https://public@example.ingest.sentry.io/1'
    Object.assign(environment, {
      NUXT_STRIPE_SECRET_KEY: 'rk_test_runtime',
      NUXT_STRIPE_WEBHOOK_SECRET: 'whsec_runtime',
      NUXT_STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_runtime',
      NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID: 'price_personal_weekly_runtime',
      NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID: 'price_personal_monthly_runtime',
      NUXT_STRIPE_PERSONAL_ANNUAL_PRICE_ID: 'price_personal_annual_runtime',
      NUXT_STRIPE_FAMILY_MONTHLY_PRICE_ID: 'price_family_monthly_runtime',
      NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID: 'price_family_annual_runtime',
      NUXT_FILES_DRIVER: 'r2',
      NUXT_CLOUDFLARE_ACCOUNT_ID: r2AccountId,
      NUXT_CLOUDFLARE_R2_BUCKET: 'bucket',
      NUXT_CLOUDFLARE_R2_ENDPOINT: `https://${r2AccountId}.r2.cloudflarestorage.com`,
      NUXT_CLOUDFLARE_R2_ACCESS_KEY_ID: 'access',
      NUXT_CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'secret',
      NUXT_OPENAI_API_KEY: 'openai-runtime-key',
      NUXT_OPENAI_PROJECT_ID: 'openai-runtime-project',
      NUXT_OPENAI_MODEL: 'gpt-5.6-luna',
      NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY: 'turnstile-secret',
      NUXT_PUBLIC_TURNSTILE_SITE_KEY: 'turnstile-site',
      NUXT_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
      NUXT_PUBLIC_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1'
    })

    expect(validateRuntimeConfig(input, environment).modules.jobs.enabled).toBe(true)
  })

  it('requires Jobs whenever Billing or Files is enabled', () => {
    for (const [moduleId, requirements] of [
      [
        'billing',
        {
          NUXT_MODULES_BILLING_ENABLED: 'true',
          NUXT_STRIPE_SECRET_KEY: 'rk_test_server_foundation',
          NUXT_STRIPE_WEBHOOK_SECRET: 'whsec_test',
          NUXT_STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_test',
          NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID: 'price_personal_weekly',
          NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID: 'price_personal_monthly',
          NUXT_STRIPE_PERSONAL_ANNUAL_PRICE_ID: 'price_personal_annual',
          NUXT_STRIPE_FAMILY_MONTHLY_PRICE_ID: 'price_family_monthly',
          NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID: 'price_family_annual'
        }
      ],
      ['files', { NUXT_MODULES_FILES_ENABLED: 'true', NUXT_FILES_DRIVER: 'local' }]
    ] as const) {
      const withoutJobs = { ...requirements, NUXT_MODULES_JOBS_ENABLED: 'false' }
      for (const environment of [
        runtimeEnvironment(withoutJobs),
        runtimeEnvironment({ ...withoutJobs, NODE_ENV: 'production' })
      ]) {
        const evaluation = evaluateRuntimeEnvironment(environment)
        expect(evaluation.moduleIssues[moduleId]).toContainEqual({
          code: 'invalid',
          key: 'NUXT_MODULES_JOBS_ENABLED',
          message: `must be true when ${moduleId === 'billing' ? 'Billing' : 'Files'} is enabled`
        })
        expect(() => assertStartableRuntimeConfig(evaluation)).toThrow(/NUXT_MODULES_JOBS_ENABLED/)
      }
    }
  })

  it('accepts only the configured account Cloudflare R2 S3 endpoint', () => {
    const base = {
      NUXT_MODULES_FILES_ENABLED: 'true',
      NUXT_MODULES_JOBS_ENABLED: 'true',
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
      expect(evaluation.moduleIssues.files).toEqual([])
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
      expect(evaluation.moduleIssues.files).toContainEqual(
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
      expect(evaluation.moduleIssues.files).toContainEqual(
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
    expect(invalidBucket.moduleIssues.files).toContainEqual(
      expect.objectContaining({ key: 'NUXT_CLOUDFLARE_R2_BUCKET', code: 'invalid' })
    )
  })

  it('contains every official Turnstile test key to paired non-production module configuration', () => {
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
            NUXT_MODULES_TURNSTILE_ENABLED: 'true',
            NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY: pairedSecretKey,
            NUXT_PUBLIC_TURNSTILE_SITE_KEY: siteKey
          })
        ).moduleIssues.turnstile
      ).toEqual([])

      const production = evaluateRuntimeEnvironment(
        runtimeEnvironment({
          NODE_ENV: 'production',
          NUXT_MODULES_TURNSTILE_ENABLED: 'true',
          NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY: pairedSecretKey,
          NUXT_PUBLIC_TURNSTILE_SITE_KEY: siteKey
        })
      )
      expect(production.moduleIssues.turnstile).toContainEqual(
        expect.objectContaining({ code: 'invalid', key: 'NUXT_PUBLIC_TURNSTILE_SITE_KEY' })
      )
    }

    for (const secretKey of testSecretKeys) {
      expect(
        evaluateRuntimeEnvironment(
          runtimeEnvironment({
            NUXT_MODULES_TURNSTILE_ENABLED: 'true',
            NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY: secretKey,
            NUXT_PUBLIC_TURNSTILE_SITE_KEY: pairedSiteKey
          })
        ).moduleIssues.turnstile
      ).toEqual([])

      const production = evaluateRuntimeEnvironment(
        runtimeEnvironment({
          NODE_ENV: 'production',
          NUXT_MODULES_TURNSTILE_ENABLED: 'true',
          NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY: secretKey,
          NUXT_PUBLIC_TURNSTILE_SITE_KEY: pairedSiteKey
        })
      )
      expect(production.moduleIssues.turnstile).toContainEqual(
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
      const evaluation = evaluateRuntimeEnvironment(
        runtimeEnvironment({
          NUXT_MODULES_TURNSTILE_ENABLED: 'true',
          ...mixed
        })
      )
      expect(evaluation.moduleIssues.turnstile).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'invalid', key: 'NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY' }),
          expect.objectContaining({ code: 'invalid', key: 'NUXT_PUBLIC_TURNSTILE_SITE_KEY' })
        ])
      )
      const message = new RuntimeConfigValidationError(evaluation.moduleIssues.turnstile).message
      for (const value of Object.values(mixed)) expect(message).not.toContain(value)
    }
  })

  it('keeps normalized config while separating core and module evaluation issues', () => {
    const input = completeRuntimeConfig()
    input.databaseUrl = ''
    input.modules.billing.enabled = true
    input.modules.jobs.enabled = true
    const evaluation = evaluateRuntimeConfig(
      input,
      runtimeEnvironment({
        NUXT_DATABASE_URL: undefined,
        NUXT_MODULES_BILLING_ENABLED: 'true',
        NUXT_MODULES_JOBS_ENABLED: 'true'
      })
    )

    expect(evaluation.config).toBeDefined()
    expect(evaluation.coreIssues.map((issue) => issue.key)).toContain('NUXT_DATABASE_URL')
    expect(evaluation.moduleIssues.billing.map((issue) => issue.key)).toEqual([
      'NUXT_STRIPE_SECRET_KEY',
      'NUXT_STRIPE_WEBHOOK_SECRET',
      'NUXT_STRIPE_PORTAL_CONFIGURATION_ID',
      'NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID',
      'NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID',
      'NUXT_STRIPE_PERSONAL_ANNUAL_PRICE_ID',
      'NUXT_STRIPE_FAMILY_MONTHLY_PRICE_ID',
      'NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID'
    ])
    for (const moduleId of runtimeModuleIds.filter((id) => id !== 'billing')) {
      expect(evaluation.moduleIssues[moduleId]).toEqual([])
      expect(Object.isFrozen(evaluation.moduleIssues[moduleId])).toBe(true)
    }
    expect(Object.isFrozen(evaluation.config)).toBe(true)
    expect(Object.isFrozen(evaluation.moduleIssues)).toBe(true)
  })

  it('requires every R2 field independently when the files module selects r2', () => {
    const complete = completeRuntimeConfig()
    complete.modules.files.enabled = true
    complete.modules.jobs.enabled = true
    complete.files.driver = 'r2'
    complete.cloudflare.accountId = r2AccountId
    complete.cloudflare.r2 = {
      bucket: 'bucket',
      endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
      accessKeyId: 'access',
      secretAccessKey: 'secret'
    }
    const completeEnvironment = runtimeEnvironment({
      NUXT_MODULES_FILES_ENABLED: 'true',
      NUXT_MODULES_JOBS_ENABLED: 'true',
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

    expect(validateRuntimeConfig(invalidDriver, runtimeEnvironment()).files.driver).toBe('')
    invalidDriver.modules.files.enabled = true
    expect(() =>
      validateRuntimeConfig(
        invalidDriver,
        runtimeEnvironment({
          NUXT_MODULES_FILES_ENABLED: 'true',
          NUXT_FILES_DRIVER: 'implicit-fallback'
        })
      )
    ).toThrow(/NUXT_FILES_DRIVER/)

    const invalidSamples = completeRuntimeConfig()
    invalidSamples.sentryDsn = 'https://public@example.ingest.sentry.io/1'
    invalidSamples.public.sentryDsn = 'https://public@example.ingest.sentry.io/1'
    invalidSamples.sentryTracesSampleRate = 'NaN'
    invalidSamples.public.sentryTracesSampleRate = '1.1'

    expect(validateRuntimeConfig(invalidSamples, runtimeEnvironment()).modules.observability.enabled).toBe(false)
    invalidSamples.modules.observability.enabled = true

    try {
      validateRuntimeConfig(
        invalidSamples,
        runtimeEnvironment({
          NUXT_MODULES_OBSERVABILITY_ENABLED: 'true',
          NUXT_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
          NUXT_PUBLIC_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1'
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
    input.modules.observability.enabled = true
    input.sentryDsn = 'https://public@example.ingest.sentry.io/1'
    input.public.sentryDsn = 'https://public@example.ingest.sentry.io/1'

    const environment = runtimeEnvironment({
      NUXT_MODULES_OBSERVABILITY_ENABLED: 'true',
      NUXT_SENTRY_DSN: input.sentryDsn,
      NUXT_PUBLIC_SENTRY_DSN: input.public.sentryDsn,
      NUXT_SENTRY_TRACES_SAMPLE_RATE: '0.9',
      NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: '0.8'
    })

    const evaluation = evaluateRuntimeConfig(input, environment)
    expect(evaluation.moduleIssues.observability).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'mismatch', key: 'NUXT_SENTRY_TRACES_SAMPLE_RATE' }),
        expect.objectContaining({ code: 'mismatch', key: 'NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE' })
      ])
    )
  })

  it('accepts valid sample-rate spellings after Nitro numeric normalization', () => {
    const input = completeRuntimeConfig()
    input.modules.observability.enabled = true
    input.sentryDsn = 'https://public@example.ingest.sentry.io/1'
    input.public.sentryDsn = 'https://public@example.ingest.sentry.io/1'
    input.sentryTracesSampleRate = '0.05'
    input.public.sentryTracesSampleRate = '0.1'

    expect(() =>
      validateRuntimeConfig(
        input,
        runtimeEnvironment({
          NUXT_MODULES_OBSERVABILITY_ENABLED: 'true',
          NUXT_SENTRY_DSN: input.sentryDsn,
          NUXT_PUBLIC_SENTRY_DSN: input.public.sentryDsn,
          NUXT_SENTRY_TRACES_SAMPLE_RATE: '0.050',
          NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: '1e-1'
        })
      )
    ).not.toThrow()
  })

  it('detects runtime values that do not match Nuxt-resolved core, provider, and flag values', () => {
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
          input.databaseUrl = 'file:../../data/build-sentinel.db'
          environment.NUXT_DATABASE_URL = 'file:../../data/runtime-sentinel.db'
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
        key: 'NUXT_SOCIAL_PROVIDERS_GOOGLE_ENABLED',
        arrange: (input, environment) => {
          input.socialProviders.google = {
            enabled: false,
            clientId: 'google-client.apps.googleusercontent.com',
            clientSecret: 'google-client-secret'
          }
          Object.assign(environment, {
            NUXT_SOCIAL_PROVIDERS_GOOGLE_ENABLED: 'true',
            NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_ID: input.socialProviders.google.clientId,
            NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_SECRET: input.socialProviders.google.clientSecret
          })
        }
      },
      {
        key: 'NUXT_MODULES_BILLING_ENABLED',
        arrange: (_input, environment) => {
          environment.NUXT_MODULES_BILLING_ENABLED = 'true'
        }
      },
      {
        key: 'NUXT_STRIPE_SECRET_KEY',
        arrange: (input, environment) => {
          input.modules.billing.enabled = true
          input.modules.jobs.enabled = true
          input.stripe.secretKey = 'build-stripe-sentinel'
          input.stripe.webhookSecret = 'matching-webhook-secret'
          input.stripe.portalConfigurationId = 'bpc_matching'
          input.stripe.personalWeeklyPriceId = 'price_matching_personal_weekly'
          input.stripe.personalMonthlyPriceId = 'price_matching_personal_monthly'
          input.stripe.personalAnnualPriceId = 'price_matching_personal_annual'
          input.stripe.familyMonthlyPriceId = 'price_matching_family_monthly'
          input.stripe.familyAnnualPriceId = 'price_matching_family_annual'
          Object.assign(environment, {
            NUXT_MODULES_BILLING_ENABLED: 'true',
            NUXT_MODULES_JOBS_ENABLED: 'true',
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
          input.modules.ai.enabled = true
          input.openai = {
            apiKey: 'build-openai-sentinel',
            projectId: 'matching-openai-project',
            model: 'gpt-5.6-luna',
            fileSearch: { enabled: false, vectorStoreId: '' },
            webSearch: { enabled: false, allowedDomains: '' }
          }
          Object.assign(environment, {
            NUXT_MODULES_AI_ENABLED: 'true',
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
      const issues = [
        ...evaluation.coreIssues,
        ...runtimeModuleIds.flatMap((moduleId) => evaluation.moduleIssues[moduleId])
      ]

      expect(issues).toContainEqual(expect.objectContaining({ code: 'mismatch', key }))
      const message = new RuntimeConfigValidationError(issues).message
      expect(message).not.toContain('build-')
      expect(message).not.toContain('runtime-')
    }
  })

  it('ignores stale provider values for disabled startup-completeness checks only', () => {
    const evaluation = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NUXT_FILES_DRIVER: 'true',
        NUXT_OPENAI_API_KEY: '{"stale":true}',
        NUXT_OPENAI_FILE_SEARCH_VECTOR_STORE_ID: 'stale-vector-store-id',
        NUXT_OPENAI_WEB_SEARCH_ALLOWED_DOMAINS: 'stale malformed domains',
        NUXT_SENTRY_DSN: '123',
        NUXT_PUBLIC_SENTRY_DSN: '{"stale":true}',
        NUXT_SENTRY_TRACES_SAMPLE_RATE: 'NaN',
        NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: '1.1',
        NUXT_STRIPE_SECRET_KEY: '123',
        NUXT_STRIPE_WEBHOOK_SECRET: '{"stale":true}',
        NUXT_STRIPE_PORTAL_CONFIGURATION_ID: 'stale',
        NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID: 'stale',
        NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID: 'stale',
        NUXT_STRIPE_PERSONAL_ANNUAL_PRICE_ID: 'stale',
        NUXT_STRIPE_FAMILY_MONTHLY_PRICE_ID: 'stale',
        NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID: 'stale'
      })
    )

    expect(evaluation.coreIssues).toEqual([])
    for (const moduleId of runtimeModuleIds) expect(evaluation.moduleIssues[moduleId]).toEqual([])
    expect(evaluation.config?.files.driver).toBe('')
    expect(evaluation.config?.sentryTracesSampleRate).toBe('NaN')
    expect(evaluation.config?.stripe.secretKey).toBe('')
    expect(evaluation.config?.openai.apiKey).toBe('')
    expect(evaluation.config?.openai.fileSearch).toEqual({ enabled: false, vectorStoreId: '' })
    expect(evaluation.config?.openai.webSearch).toEqual({ enabled: false, allowedDomains: [] })
    expect(evaluation.config?.sentryDsn).toBe('')
  })

  it('fails malformed destr-resolved provider leaves when their startup checks are enabled', () => {
    const cases = [
      {
        moduleId: 'billing',
        key: 'NUXT_STRIPE_SECRET_KEY',
        values: {
          NUXT_STRIPE_SECRET_KEY: '123',
          NUXT_STRIPE_WEBHOOK_SECRET: 'valid-webhook-secret',
          NUXT_MODULES_JOBS_ENABLED: 'true',
          NUXT_STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_test',
          NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID: 'price_personal_weekly',
          NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID: 'price_personal_monthly',
          NUXT_STRIPE_PERSONAL_ANNUAL_PRICE_ID: 'price_personal_annual',
          NUXT_STRIPE_FAMILY_MONTHLY_PRICE_ID: 'price_family_monthly',
          NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID: 'price_family_annual'
        }
      },
      {
        moduleId: 'files',
        key: 'NUXT_FILES_DRIVER',
        values: { NUXT_FILES_DRIVER: 'true' }
      },
      {
        moduleId: 'ai',
        key: 'NUXT_OPENAI_API_KEY',
        values: {
          NUXT_OPENAI_API_KEY: '{"stale":true}',
          NUXT_OPENAI_PROJECT_ID: 'openai-project',
          NUXT_OPENAI_MODEL: 'gpt-5.6-luna'
        }
      },
      {
        moduleId: 'observability',
        key: 'NUXT_SENTRY_DSN',
        values: {
          NUXT_SENTRY_DSN: '123',
          NUXT_PUBLIC_SENTRY_DSN: '{"stale":true}'
        }
      }
    ] as const

    for (const { moduleId, key, values } of cases) {
      const evaluation = evaluateRuntimeEnvironment(
        runtimeEnvironment({
          [`NUXT_MODULES_${moduleId.toUpperCase()}_ENABLED`]: 'true',
          ...values
        })
      )

      expect(evaluation.config).toBeDefined()
      expect(evaluation.moduleIssues[moduleId]).toContainEqual(expect.objectContaining({ key }))
    }
  })

  it('keeps core shape failures separate from disabled malformed provider subtrees', () => {
    const malformedPublic = evaluateRuntimeConfig(
      { ...completeRuntimeConfig(), public: undefined },
      runtimeEnvironment()
    )
    expect(malformedPublic.config).toBeUndefined()
    expect(malformedPublic.coreIssues.some((issue) => issue.code === 'shape')).toBe(true)

    const malformedCloudflare = evaluateRuntimeConfig(
      { ...completeRuntimeConfig(), cloudflare: 'invalid' },
      runtimeEnvironment()
    )
    expect(malformedCloudflare.config?.cloudflare.accountId).toBe('')
    expect(malformedCloudflare.coreIssues).toEqual([])
    for (const moduleId of runtimeModuleIds) expect(malformedCloudflare.moduleIssues[moduleId]).toEqual([])
    expect(Object.isFrozen(malformedCloudflare)).toBe(true)
  })

  it('reports core and strict raw-flag issues together after tolerant flag normalization', () => {
    const evaluation = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NUXT_DATABASE_URL: undefined,
        NUXT_BETTER_AUTH_URL: undefined,
        NUXT_MODULES_FILES_ENABLED: undefined,
        NUXT_MODULES_AI_ENABLED: 'TRUE'
      })
    )

    expect(evaluation.config).toBeDefined()
    expect(evaluation.coreIssues.map((issue) => issue.key)).toEqual(
      expect.arrayContaining(['NUXT_DATABASE_URL', 'NUXT_BETTER_AUTH_URL'])
    )
    expect(evaluation.moduleIssues.files).toContainEqual(
      expect.objectContaining({ code: 'invalid', key: 'NUXT_MODULES_FILES_ENABLED' })
    )
    expect(evaluation.moduleIssues.ai).toContainEqual(
      expect.objectContaining({ code: 'invalid', key: 'NUXT_MODULES_AI_ENABLED' })
    )
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
      const issues = [
        ...evaluation.coreIssues,
        ...runtimeModuleIds.flatMap((moduleId) => evaluation.moduleIssues[moduleId])
      ]

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
    expect(allowedControls.coreIssues).toEqual([])
  })

  it.each(['NUXT_SECURITY', 'NUXT_SECURITY_ENABLED', 'NITRO_SECURITY', 'NITRO_SECURITY_HEADERS'])(
    'rejects the %s runtime escape hatch before it can weaken the reviewed security policy',
    (key) => {
      const sentinel = `sensitive-${key.toLowerCase()}-override`
      const evaluation = evaluateRuntimeEnvironment(runtimeEnvironment({ [key]: sentinel }))

      expect(evaluation.coreIssues).toContainEqual(expect.objectContaining({ code: 'invalid', key }))
      expect(new RuntimeConfigValidationError(evaluation.coreIssues).message).not.toContain(sentinel)
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
      expect(evaluation.coreIssues).toContainEqual(expect.objectContaining({ code: 'invalid', key }))
      expect(new RuntimeConfigValidationError(evaluation.coreIssues).message).not.toContain(sentinel)
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
      expect(production.coreIssues).toContainEqual(
        expect.objectContaining({ code: 'invalid', key: 'NUXT_BETTER_AUTH_SECRET' })
      )
      expect(new RuntimeConfigValidationError(production.coreIssues).message).not.toContain(secret)
    }

    const local = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NODE_ENV: 'development',
        NUXT_BETTER_AUTH_SECRET: 'local-development-secret-change-me-32-chars'
      })
    )
    expect(local.coreIssues).toEqual([])
  })

  it('requires the canonical auth URL to be an origin without a path, query, or fragment', () => {
    for (const authUrl of [
      'https://auth.example.test/api/auth',
      'https://auth.example.test/?tenant=one',
      'https://auth.example.test/#fragment'
    ]) {
      const evaluation = evaluateRuntimeEnvironment(runtimeEnvironment({ NUXT_BETTER_AUTH_URL: authUrl }))
      expect(evaluation.coreIssues).toContainEqual(
        expect.objectContaining({ code: 'invalid', key: 'NUXT_BETTER_AUTH_URL' })
      )
    }

    const differentOrigin = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NUXT_BETTER_AUTH_URL: 'https://auth.example.test',
        NUXT_PUBLIC_APP_URL: 'https://app.example.test'
      })
    )
    expect(differentOrigin.coreIssues).toContainEqual(
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
    expect(insecureProduction.coreIssues).toContainEqual(
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
      expect(loopback.coreIssues).toEqual([])
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

      expect(evaluation.coreIssues).toContainEqual(expect.objectContaining({ key: 'NUXT_PUBLIC_APP_NAME' }))
      if (appName === 'null') {
        expect(evaluation.config?.public.appName).toBe('SmallWiseLabs Base App')
        expect(evaluation.coreIssues).toContainEqual(
          expect.objectContaining({ code: 'mismatch', key: 'NUXT_PUBLIC_APP_NAME' })
        )
      }
    }

    const valid = evaluateRuntimeEnvironment(runtimeEnvironment({ NUXT_PUBLIC_APP_NAME: 'Runtime Name' }))
    expect(valid.coreIssues).toEqual([])
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
      expect(evaluation.coreIssues).toContainEqual(expect.objectContaining({ code: 'invalid', key }))
      expect(new RuntimeConfigValidationError(evaluation.coreIssues).message).not.toContain('example.test')
    }
  })

  it('defaults omitted sample rates and app name, preserves numeric spelling, and rejects raw Sentry splits', () => {
    const sentryDsn = 'https://public@example.ingest.sentry.io/1'
    const omitted = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NUXT_MODULES_OBSERVABILITY_ENABLED: 'true',
        NUXT_SENTRY_DSN: sentryDsn,
        NUXT_PUBLIC_SENTRY_DSN: sentryDsn
      })
    )
    expect(omitted.moduleIssues.observability).toEqual([])
    expect(omitted.config?.sentryTracesSampleRate).toBe('0.05')
    expect(omitted.config?.public.sentryTracesSampleRate).toBe('0.05')
    expect(omitted.config?.public.appName).toBe('SmallWiseLabs Base App')

    const alternateSpellings = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NUXT_MODULES_OBSERVABILITY_ENABLED: 'true',
        NUXT_SENTRY_DSN: sentryDsn,
        NUXT_PUBLIC_SENTRY_DSN: sentryDsn,
        NUXT_SENTRY_TRACES_SAMPLE_RATE: '0.050',
        NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: '1e-1'
      })
    )
    expect(alternateSpellings.moduleIssues.observability).toEqual([])
    expect(alternateSpellings.config?.sentryTracesSampleRate).toBe('0.05')
    expect(alternateSpellings.config?.public.sentryTracesSampleRate).toBe('0.1')

    const invalidRawValues = evaluateRuntimeEnvironment(
      runtimeEnvironment({
        NUXT_MODULES_OBSERVABILITY_ENABLED: 'true',
        NUXT_SENTRY_DSN: ` ${sentryDsn}`,
        NUXT_PUBLIC_SENTRY_DSN: `${sentryDsn} `,
        NUXT_SENTRY_TRACES_SAMPLE_RATE: '',
        NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: '   '
      })
    )
    expect(invalidRawValues.moduleIssues.observability.map((issue) => issue.key)).toEqual(
      expect.arrayContaining([
        'NUXT_SENTRY_DSN',
        'NUXT_PUBLIC_SENTRY_DSN',
        'NUXT_SENTRY_TRACES_SAMPLE_RATE',
        'NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE'
      ])
    )
  })

  it('routes malformed module shape to that module and fails closed without normalized config', () => {
    const input = completeRuntimeConfig()
    ;(input.modules as Partial<typeof input.modules>).billing = undefined
    const evaluation = evaluateRuntimeConfig(input, runtimeEnvironment())

    expect(evaluation.config).toBeUndefined()
    expect(evaluation.moduleIssues.billing).toContainEqual(
      expect.objectContaining({ code: 'shape', key: 'NUXT_MODULES_BILLING' })
    )
    expect(() => assertStartableRuntimeConfig(evaluation)).toThrow(RuntimeConfigValidationError)
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
        NUXT_DATABASE_URL: 'file:../../data/app.db'
      })
    ).toThrow(/absolute path/)
    expect(() => readDatabaseUrl({ DATABASE_URL: 'file:/legacy/only.db' })).toThrow(/NUXT_DATABASE_URL/)
  })

  it('keeps the standalone cache unset after invalid input, then freezes one environment-evaluated config', () => {
    const validEnvironment = runtimeEnvironment({
      NUXT_MODULES_FILES_ENABLED: 'true',
      NUXT_MODULES_JOBS_ENABLED: 'true',
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
      NUXT_MODULES_FILES_ENABLED: 'true',
      NUXT_MODULES_JOBS_ENABLED: 'true',
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
      nuxtInput.public.appName = 'SmallWiseLabs Base App'
      nuxtInput.modules.files.enabled = true
      nuxtInput.modules.jobs.enabled = true
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
    NUXT_DATABASE_URL: 'file:../../data/test.db',
    NUXT_READINESS_TOKEN:
      nodeEnvironment === 'production'
        ? 'test-production-readiness-token-with-32-characters'
        : 'local-readiness-token-change-me-32-chars',
    NUXT_BETTER_AUTH_SECRET: 'test-runtime-secret-with-32-characters',
    NUXT_BETTER_AUTH_URL: 'http://127.0.0.1:3000',
    NUXT_SOCIAL_PROVIDERS_GOOGLE_ENABLED: 'false',
    NUXT_EMAIL_TRANSPORT: 'capture',
    NUXT_EMAIL_FROM: 'baseline@example.test',
    NUXT_EMAIL_CAPTURE_DIRECTORY: '../../data/test-email-capture',
    NUXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
    ...Object.fromEntries(runtimeModuleIds.map((id) => [`NUXT_MODULES_${id.toUpperCase()}_ENABLED`, 'false'])),
    NUXT_OPENAI_FILE_SEARCH_ENABLED: 'false',
    NUXT_OPENAI_WEB_SEARCH_ENABLED: 'false',
    ...overrides
  }
}

function completeRuntimeConfig() {
  return {
    databaseUrl: 'file:../../data/test.db',
    readinessToken: 'local-readiness-token-change-me-32-chars',
    betterAuth: {
      secret: 'test-runtime-secret-with-32-characters',
      url: 'http://127.0.0.1:3000'
    },
    socialProviders: {
      google: {
        enabled: false,
        clientId: '',
        clientSecret: ''
      }
    },
    email: {
      transport: 'capture' as '' | 'capture' | 'smtp',
      from: 'baseline@example.test',
      captureDirectory: '../../data/test-email-capture',
      smtp: {
        host: '',
        port: '',
        security: '' as '' | 'tls' | 'starttls',
        username: '',
        password: ''
      }
    },
    modules: Object.fromEntries(runtimeModuleIds.map((id) => [id, { enabled: false }])) as Record<
      (typeof runtimeModuleIds)[number],
      { enabled: boolean }
    >,
    stripe: {
      secretKey: '',
      webhookSecret: '',
      portalConfigurationId: '',
      personalWeeklyPriceId: '',
      personalMonthlyPriceId: '',
      personalAnnualPriceId: '',
      familyMonthlyPriceId: '',
      familyAnnualPriceId: ''
    },
    files: {
      driver: '' as '' | 'local' | 'r2'
    },
    openai: {
      apiKey: '',
      projectId: '',
      model: '' as '' | 'gpt-5.6-luna',
      fileSearch: {
        enabled: false,
        vectorStoreId: ''
      },
      webSearch: {
        enabled: false,
        allowedDomains: ''
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
        secretKey: ''
      }
    },
    public: {
      appName: 'Test app',
      appUrl: 'http://127.0.0.1:3000',
      sentryDsn: '',
      sentryEnvironment: '',
      sentryRelease: '',
      sentryTracesSampleRate: '0.05',
      turnstileSiteKey: ''
    }
  }
}
