import { describe, expect, it, vi } from 'vitest'
import { moduleManifest, runtimeModuleIds, type RuntimeModuleId } from '../shared/modules'
import { isPublicModuleReady } from '../shared/module-states'
import { turnstileActions } from '../shared/turnstile'
import { createBillingCheckout, getBillingState } from '../server/services/payments/billing-service'
import { processStripeWebhookEvent } from '../server/services/payments/billing-webhook'
import {
  constructStripeWebhookEvent,
  getStripeClient,
  getStripeWebhookSecret,
  resetStripeClientForTests
} from '../server/services/payments/stripe-client'
import { getOpenAIResponsesAdapter, resetOpenAIResponsesAdapterForTests } from '../server/services/ai/openai'
import { captureException } from '../server/services/observability/capture'
import {
  completeFileUpload,
  createPrivateFileDownload,
  createFileUploadTarget,
  deleteOwnedFile,
  getLocalFileDownload,
  getOwnedFileMetadata,
  listOwnedFiles,
  putFileUploadContent
} from '../server/services/storage/file-service'
import {
  createFileDownloadToken,
  createFileUploadToken,
  verifyFileDownloadToken,
  verifyFileUploadToken
} from '../server/services/storage/file-tokens'
import { useObjectStorage } from '../server/services/storage/object-storage'
import { cleanupOrphanedFileObjects } from '../server/services/storage/orphan-cleanup'
import { verifyTurnstileToken } from '../server/services/security/turnstile'
import {
  getPublicModuleStates,
  moduleDisabledCode,
  moduleForExclusiveRoute,
  requireModuleReady
} from '../server/utils/module-state'
import { evaluateModuleStates } from '../server/utils/runtime'
import * as runtime from '../server/utils/runtime'

const sentryCapture = vi.hoisted(() => vi.fn())
const sentryInit = vi.hoisted(() => vi.fn())
const r2AccountId = '0123456789abcdef0123456789abcdef'
vi.mock('@sentry/nuxt', () => ({
  captureException: sentryCapture,
  init: sentryInit
}))

describe('optional module state contract', () => {
  it('treats disabled modules as healthy even when stale provider values are present', () => {
    const evaluation = runtime.evaluateRuntimeEnvironment(
      coreEnvironment({
        NUXT_STRIPE_SECRET_KEY: 'stale',
        NUXT_STRIPE_WEBHOOK_SECRET: 'stale',
        NUXT_STRIPE_PORTAL_CONFIGURATION_ID: 'stale',
        NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID: 'stale',
        NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID: 'stale',
        NUXT_STRIPE_PERSONAL_ANNUAL_PRICE_ID: 'stale',
        NUXT_STRIPE_FAMILY_MONTHLY_PRICE_ID: 'stale',
        NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID: 'stale',
        NUXT_FILES_DRIVER: 'malformed-stale-driver',
        NUXT_CLOUDFLARE_ACCOUNT_ID: 'stale',
        NUXT_CLOUDFLARE_R2_ENDPOINT: 'not-a-url',
        NUXT_OPENAI_API_KEY: ' stale-openai-key ',
        NUXT_OPENAI_PROJECT_ID: 'stale-openai-project',
        NUXT_OPENAI_MODEL: 'stale-openai-model',
        NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY: 'stale',
        NUXT_PUBLIC_TURNSTILE_SITE_KEY: 'stale',
        NUXT_SENTRY_DSN: 'not-a-url',
        NUXT_PUBLIC_SENTRY_DSN: 'not-a-url'
      })
    )

    expect(evaluateModuleStates(evaluation)).toEqual(disabledStates())
    expect(evaluation.coreIssues).toEqual([])
    for (const moduleId of runtimeModuleIds) expect(evaluation.moduleIssues[moduleId]).toEqual([])
  })

  it('derives every required-config omission and core-only incomplete state from the manifest', () => {
    for (const moduleId of runtimeModuleIds) {
      const required = moduleManifest[moduleId].requiredConfig.filter((requirement) => requirement.required !== false)

      if (!required.length) {
        const environment = singleReadyModuleEnvironment(moduleId)
        environment.NUXT_DATABASE_URL = undefined
        expect(evaluateModuleStates(runtime.evaluateRuntimeEnvironment(environment))[moduleId], moduleId).toBe(
          'incomplete'
        )
        continue
      }

      for (const requirement of required) {
        const environment = singleReadyModuleEnvironment(moduleId, {
          useR2: moduleId === 'files',
          useFileSearch: moduleId === 'ai' && requirement.environmentKey === 'NUXT_OPENAI_FILE_SEARCH_VECTOR_STORE_ID',
          useWebSearch: moduleId === 'ai' && requirement.environmentKey === 'NUXT_OPENAI_WEB_SEARCH_ALLOWED_DOMAINS'
        })
        environment[requirement.environmentKey] = undefined
        expect(
          evaluateModuleStates(runtime.evaluateRuntimeEnvironment(environment))[moduleId],
          `${moduleId}: ${requirement.environmentKey}`
        ).toBe('incomplete')
      }
    }
  })

  it('keeps optional sample-rate omission valid and requires Jobs for Billing and Files', () => {
    const observability = singleReadyModuleEnvironment('observability')
    expect(evaluateModuleStates(runtime.evaluateRuntimeEnvironment(observability)).observability).toBe('ready')

    for (const requirement of moduleManifest.observability.requiredConfig.filter(
      (candidate) => candidate.required === false
    )) {
      const invalid = { ...observability, [requirement.environmentKey]: '' }
      expect(evaluateModuleStates(runtime.evaluateRuntimeEnvironment(invalid)).observability).toBe('incomplete')
    }

    const localFiles = singleReadyModuleEnvironment('files')
    expect(evaluateModuleStates(runtime.evaluateRuntimeEnvironment(localFiles)).files).toBe('ready')
    expect(Object.keys(localFiles).some((key) => key.startsWith('NUXT_CLOUDFLARE_R2_'))).toBe(false)

    const localFilesWithoutJobs = { ...localFiles, NUXT_MODULES_JOBS_ENABLED: 'false' }
    const dependencyEvaluation = runtime.evaluateRuntimeEnvironment(localFilesWithoutJobs)
    expect(evaluateModuleStates(dependencyEvaluation).files).toBe('incomplete')
    expect(dependencyEvaluation.moduleIssues.files).toContainEqual(
      expect.objectContaining({ key: 'NUXT_MODULES_JOBS_ENABLED' })
    )

    const billingWithoutJobs = {
      ...singleReadyModuleEnvironment('billing'),
      NUXT_MODULES_JOBS_ENABLED: 'false'
    }
    const billingDependencyEvaluation = runtime.evaluateRuntimeEnvironment(billingWithoutJobs)
    expect(evaluateModuleStates(billingDependencyEvaluation).billing).toBe('incomplete')
    expect(billingDependencyEvaluation.moduleIssues.billing).toContainEqual(
      expect.objectContaining({ key: 'NUXT_MODULES_JOBS_ENABLED' })
    )
  })

  it('requires restricted Stripe credentials and distinct recognized catalog identifiers only while Billing is enabled', () => {
    const duplicate = singleReadyModuleEnvironment('billing')
    duplicate.NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID = duplicate.NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID
    const duplicateEvaluation = runtime.evaluateRuntimeEnvironment(duplicate)

    expect(evaluateModuleStates(duplicateEvaluation).billing).toBe('incomplete')
    expect(duplicateEvaluation.moduleIssues.billing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID', code: 'invalid' }),
        expect.objectContaining({ key: 'NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID', code: 'invalid' })
      ])
    )
    expect(JSON.stringify(duplicateEvaluation.moduleIssues.billing)).not.toContain(
      duplicate.NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID
    )

    for (const [key, value] of [
      ['NUXT_STRIPE_SECRET_KEY', 'sk_test_unrestricted'],
      ['NUXT_STRIPE_WEBHOOK_SECRET', 'secret_unknown'],
      ['NUXT_STRIPE_PORTAL_CONFIGURATION_ID', 'portal_unknown'],
      ['NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID', 'product_unknown']
    ] as const) {
      const malformed = singleReadyModuleEnvironment('billing')
      malformed[key] = value
      const evaluation = runtime.evaluateRuntimeEnvironment(malformed)
      expect(evaluateModuleStates(evaluation).billing, key).toBe('incomplete')
      expect(evaluation.moduleIssues.billing).toContainEqual(expect.objectContaining({ key, code: 'invalid' }))
    }
  })

  it('fails R2 readiness when provider credentials contain surrounding whitespace', () => {
    const environment = singleReadyModuleEnvironment('files', { useR2: true })
    environment.NUXT_CLOUDFLARE_R2_ACCESS_KEY_ID = ' access'
    environment.NUXT_CLOUDFLARE_R2_SECRET_ACCESS_KEY = 'secret '

    const evaluation = runtime.evaluateRuntimeEnvironment(environment)
    expect(evaluateModuleStates(evaluation).files).toBe('incomplete')
    expect(evaluation.moduleIssues.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'NUXT_CLOUDFLARE_R2_ACCESS_KEY_ID', code: 'invalid' }),
        expect.objectContaining({ key: 'NUXT_CLOUDFLARE_R2_SECRET_ACCESS_KEY', code: 'invalid' })
      ])
    )
  })

  it('reports complete enabled modules as ready and projects only safe state strings', () => {
    const evaluation = runtime.evaluateRuntimeEnvironment(readyEnvironment())
    const config = runtime.assertStartableRuntimeConfig(evaluation)
    const states = getPublicModuleStates(config)

    expect(evaluateModuleStates(evaluation)).toEqual(readyStates())
    expect(states).toEqual(readyStates())
    expect(Object.isFrozen(states)).toBe(true)
    expect(JSON.stringify(states)).not.toMatch(/key|secret|token|url|bucket/i)
  })

  it('gives invalid flag issues precedence over false normalization for all six modules', () => {
    for (const moduleId of runtimeModuleIds) {
      const flag = moduleManifest[moduleId].flagEnvironmentKey

      for (const invalidValue of [undefined, 'TRUE']) {
        const evaluation = runtime.evaluateRuntimeEnvironment(coreEnvironment({ [flag]: invalidValue }))
        expect(evaluateModuleStates(evaluation)[moduleId], `${moduleId}: ${String(invalidValue)}`).toBe('incomplete')
      }

      const environment = coreEnvironment()
      const mismatchedConfig = runtime.runtimeConfigFromEnvironment(environment) as {
        modules: Record<RuntimeModuleId, { enabled: unknown }>
      }
      mismatchedConfig.modules[moduleId].enabled = true
      const mismatch = runtime.evaluateRuntimeConfig(mismatchedConfig, environment)
      expect(evaluateModuleStates(mismatch)[moduleId], `${moduleId}: resolved mismatch`).toBe('incomplete')
    }
  })

  it('keeps File Search subordinate, private, explicit, and independently disabled', () => {
    const disabled = runtime.evaluateRuntimeEnvironment(coreEnvironment())
    expect(evaluateModuleStates(disabled).ai).toBe('disabled')
    expect(disabled.config?.openai.fileSearch).toEqual({ enabled: false, vectorStoreId: '' })
    expect('fileSearch' in disabled.config!.public).toBe(false)

    const enabledWithoutAi = runtime.evaluateRuntimeEnvironment(
      coreEnvironment({
        NUXT_OPENAI_FILE_SEARCH_ENABLED: 'true',
        NUXT_OPENAI_FILE_SEARCH_VECTOR_STORE_ID: 'deployment-corpus-id'
      })
    )
    expect(evaluateModuleStates(enabledWithoutAi).ai).toBe('incomplete')
    expect(enabledWithoutAi.moduleIssues.ai).toContainEqual(
      expect.objectContaining({ code: 'invalid', key: 'NUXT_OPENAI_FILE_SEARCH_ENABLED' })
    )

    const aiWithoutFileSearch = runtime.evaluateRuntimeEnvironment(singleReadyModuleEnvironment('ai'))
    expect(evaluateModuleStates(aiWithoutFileSearch).ai).toBe('ready')
    expect(aiWithoutFileSearch.config?.openai.fileSearch).toEqual({ enabled: false, vectorStoreId: '' })

    const withFileSearch = runtime.evaluateRuntimeEnvironment(
      singleReadyModuleEnvironment('ai', { useFileSearch: true })
    )
    expect(evaluateModuleStates(withFileSearch).ai).toBe('ready')
    expect(withFileSearch.config?.openai.fileSearch).toEqual({
      enabled: true,
      vectorStoreId: 'deployment-corpus-id'
    })

    for (const [value, key] of [
      [undefined, 'NUXT_OPENAI_FILE_SEARCH_ENABLED'],
      ['TRUE', 'NUXT_OPENAI_FILE_SEARCH_ENABLED'],
      [' false ', 'NUXT_OPENAI_FILE_SEARCH_ENABLED'],
      ['', 'NUXT_OPENAI_FILE_SEARCH_VECTOR_STORE_ID'],
      [' deployment-corpus-id', 'NUXT_OPENAI_FILE_SEARCH_VECTOR_STORE_ID'],
      ['x'.repeat(513), 'NUXT_OPENAI_FILE_SEARCH_VECTOR_STORE_ID']
    ] as const) {
      const environment =
        key === 'NUXT_OPENAI_FILE_SEARCH_ENABLED'
          ? coreEnvironment()
          : singleReadyModuleEnvironment('ai', { useFileSearch: true })
      environment[key] = value
      const evaluation = runtime.evaluateRuntimeEnvironment(environment)
      expect(evaluateModuleStates(evaluation).ai, `${key}: ${String(value)}`).toBe('incomplete')
      expect(evaluation.moduleIssues.ai).toContainEqual(expect.objectContaining({ key }))
    }
  })

  it('keeps Web Search subordinate, private, explicit, allowlisted, and independently disabled', () => {
    const disabled = runtime.evaluateRuntimeEnvironment(
      coreEnvironment({ NUXT_OPENAI_WEB_SEARCH_ALLOWED_DOMAINS: 'stale malformed allowlist' })
    )
    expect(evaluateModuleStates(disabled).ai).toBe('disabled')
    expect(disabled.config?.openai.webSearch).toEqual({ enabled: false, allowedDomains: [] })
    expect('webSearch' in disabled.config!.public).toBe(false)
    expect(disabled.moduleIssues.ai).toEqual([])

    const enabledWithoutAi = runtime.evaluateRuntimeEnvironment(
      coreEnvironment({
        NUXT_OPENAI_WEB_SEARCH_ENABLED: 'true',
        NUXT_OPENAI_WEB_SEARCH_ALLOWED_DOMAINS: 'openai.com'
      })
    )
    expect(evaluateModuleStates(enabledWithoutAi).ai).toBe('incomplete')
    expect(enabledWithoutAi.moduleIssues.ai).toContainEqual(
      expect.objectContaining({ code: 'invalid', key: 'NUXT_OPENAI_WEB_SEARCH_ENABLED' })
    )

    const aiWithoutWebSearch = runtime.evaluateRuntimeEnvironment(singleReadyModuleEnvironment('ai'))
    expect(evaluateModuleStates(aiWithoutWebSearch).ai).toBe('ready')
    expect(aiWithoutWebSearch.config?.openai.webSearch).toEqual({ enabled: false, allowedDomains: [] })

    const withWebSearch = runtime.evaluateRuntimeEnvironment(singleReadyModuleEnvironment('ai', { useWebSearch: true }))
    expect(evaluateModuleStates(withWebSearch).ai).toBe('ready')
    expect(withWebSearch.config?.openai.webSearch).toEqual({
      enabled: true,
      allowedDomains: ['openai.com', 'example.org', 'xn--bcher-kva.example']
    })
    expect(Object.isFrozen(withWebSearch.config?.openai.webSearch.allowedDomains)).toBe(true)

    const maximumDomains = Array.from({ length: 100 }, (_, index) => `source-${index}.example`)
    const atLimitEnvironment = singleReadyModuleEnvironment('ai', { useWebSearch: true })
    atLimitEnvironment.NUXT_OPENAI_WEB_SEARCH_ALLOWED_DOMAINS = maximumDomains.join(',')
    const atLimit = runtime.evaluateRuntimeEnvironment(atLimitEnvironment)
    expect(evaluateModuleStates(atLimit).ai).toBe('ready')
    expect(atLimit.config?.openai.webSearch.allowedDomains).toEqual(maximumDomains)

    for (const value of [undefined, 'TRUE', ' false ']) {
      const environment = coreEnvironment()
      environment.NUXT_OPENAI_WEB_SEARCH_ENABLED = value
      const evaluation = runtime.evaluateRuntimeEnvironment(environment)
      expect(evaluateModuleStates(evaluation).ai, `flag: ${String(value)}`).toBe('incomplete')
      expect(evaluation.moduleIssues.ai).toContainEqual(
        expect.objectContaining({ key: 'NUXT_OPENAI_WEB_SEARCH_ENABLED' })
      )
    }

    const invalidAllowlists = [
      undefined,
      '',
      'openai.com, example.org',
      'OpenAI.com',
      'bücher.example',
      'localhost',
      'openai.com.',
      'https://openai.com',
      'openai.com/path',
      'openai.com:443',
      'user@openai.com',
      '*.openai.com',
      '127.0.0.1',
      '127.1',
      '127.000.000.001',
      '0x7f.0.0.1',
      '[::1]',
      'openai.com,openai.com',
      'openai.com,developers.openai.com',
      Array.from({ length: 101 }, (_, index) => `source-${index}.example`).join(',')
    ]

    for (const value of invalidAllowlists) {
      const environment = singleReadyModuleEnvironment('ai', { useWebSearch: true })
      environment.NUXT_OPENAI_WEB_SEARCH_ALLOWED_DOMAINS = value
      const evaluation = runtime.evaluateRuntimeEnvironment(environment)
      expect(evaluateModuleStates(evaluation).ai, `allowlist: ${String(value)}`).toBe('incomplete')
      expect(evaluation.moduleIssues.ai).toContainEqual(
        expect.objectContaining({ key: 'NUXT_OPENAI_WEB_SEARCH_ALLOWED_DOMAINS' })
      )
    }
  })

  it('fails closed for unknown client state values and maps only manifest route boundaries', () => {
    expect(isPublicModuleReady({ billing: 'ready' }, 'billing')).toBe(true)
    expect(isPublicModuleReady({ billing: true }, 'billing')).toBe(false)
    expect(isPublicModuleReady(undefined, 'billing')).toBe(false)
    expect(moduleForExclusiveRoute('/api/account/billing')).toBe('billing')
    expect(moduleForExclusiveRoute('/api/account/billing/checkout')).toBe('billing')
    expect(moduleForExclusiveRoute('/api/webhooks/stripe')).toBe('billing')
    expect(moduleForExclusiveRoute('/api/account/billing-example')).toBeUndefined()
    expect(moduleForExclusiveRoute('/api/webhooks/stripe-example')).toBeUndefined()
    expect(moduleForExclusiveRoute('/account/billing')).toBe('billing')
    expect(moduleForExclusiveRoute('/billing')).toBeUndefined()
    expect(moduleForExclusiveRoute('/observability-client-test')).toBe('observability')
    expect(moduleForExclusiveRoute('/api/storage/objects')).toBeUndefined()
    expect(moduleForExclusiveRoute('/api/projects')).toBeUndefined()
  })

  it('rejects hostile public module-state leaves in both runtime namespaces', () => {
    for (const key of [
      'NUXT_PUBLIC_MODULE_STATES',
      'NUXT_PUBLIC_MODULE_STATES_BILLING',
      'NITRO_PUBLIC_MODULE_STATES_BILLING'
    ]) {
      const evaluation = runtime.evaluateRuntimeEnvironment(coreEnvironment({ [key]: 'ready' }))
      expect(evaluation.coreIssues).toContainEqual(expect.objectContaining({ code: 'invalid', key }))
    }
  })

  it('rejects hostile public module-state input while evaluating the build config', async () => {
    for (const key of [
      'NUXT_PUBLIC_MODULE_STATES',
      'NUXT_PUBLIC_MODULE_STATES_BILLING',
      'NITRO_PUBLIC_MODULE_STATES',
      'NITRO_PUBLIC_MODULE_STATES_BILLING'
    ]) {
      const original = process.env[key]

      try {
        process.env[key] = 'ready'
        vi.resetModules()
        await expect(import('../nuxt.config')).rejects.toThrow(
          `Public module states are server-derived and cannot be supplied at build time: ${key}`
        )
      } finally {
        restoreEnvironment(key, original)
      }
    }

    vi.resetModules()
  })

  it('returns the stable disabled error before direct module service side effects', async () => {
    resetStripeClientForTests()
    resetOpenAIResponsesAdapterForTests()
    const config = runtime.assertStartableRuntimeConfig(
      runtime.evaluateRuntimeEnvironment(
        coreEnvironment({
          NUXT_STRIPE_SECRET_KEY: 'stale-but-valid',
          NUXT_STRIPE_WEBHOOK_SECRET: 'stale-but-valid',
          NUXT_STRIPE_PORTAL_CONFIGURATION_ID: 'stale',
          NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID: 'stale',
          NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID: 'stale',
          NUXT_STRIPE_PERSONAL_ANNUAL_PRICE_ID: 'stale',
          NUXT_STRIPE_FAMILY_MONTHLY_PRICE_ID: 'stale',
          NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID: 'stale',
          NUXT_FILES_DRIVER: 'r2',
          NUXT_OPENAI_API_KEY: 'stale-openai-key',
          NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY: 'stale',
          NUXT_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1'
        })
      )
    )
    vi.spyOn(runtime, 'getAppRuntimeConfig').mockReturnValue(config)
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('disabled module test blocked an unexpected external request'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const session = { user: { id: 'user_1' } } as never
    const trapConnection = new Proxy(
      {},
      {
        get() {
          throw new Error('disabled module touched the database')
        }
      }
    ) as never

    for (const [moduleId, action] of [
      ['billing', () => getBillingState(session)],
      ['billing', () => processStripeWebhookEvent({ id: 'evt_disabled', type: 'test.disabled' } as never)],
      ['billing', () => createBillingCheckout(session, { offering: 'family.monthly' })],
      ['billing', () => getStripeClient()],
      ['billing', () => getStripeWebhookSecret()],
      ['files', () => listOwnedFiles(session)],
      ['files', () => getOwnedFileMetadata(session, 'file_disabled')],
      [
        'files',
        () =>
          createFileUploadTarget(session, {
            filename: 'disabled.txt',
            contentType: 'text/plain',
            byteSize: 1,
            contentMd5: 'ndTkYSaMgDT1yFZOFVxnpg=='
          })
      ],
      [
        'files',
        () =>
          putFileUploadContent(session, 'file_disabled', 'token-disabled', disabledUploadBody(), {
            contentType: 'text/plain',
            contentMd5: 'ndTkYSaMgDT1yFZOFVxnpg==',
            contentLength: '1'
          })
      ],
      ['files', () => completeFileUpload(session, 'file_disabled')],
      ['files', () => createPrivateFileDownload(session, 'file_disabled')],
      ['files', () => getLocalFileDownload(session, 'file_disabled', 'token-disabled')],
      ['files', () => deleteOwnedFile(session, 'file_disabled')],
      [
        'files',
        () =>
          createFileUploadToken({
            fileId: 'file_123e4567-e89b-42d3-a456-426614174000',
            ownerId: 'user_1',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            byteSize: 1,
            contentType: 'text/plain',
            contentMd5: 'ndTkYSaMgDT1yFZOFVxnpg=='
          })
      ],
      [
        'files',
        () =>
          createFileDownloadToken({
            fileId: 'file_123e4567-e89b-42d3-a456-426614174000',
            ownerId: 'user_1',
            expiresAt: new Date(Date.now() + 60_000).toISOString()
          })
      ],
      ['files', () => verifyFileUploadToken('token-disabled')],
      ['files', () => verifyFileDownloadToken('token-disabled')],
      ['files', () => useObjectStorage()],
      ['files', () => cleanupOrphanedFileObjects(trapConnection)],
      ['ai', () => getOpenAIResponsesAdapter().createResponse(openAIRequest())]
    ] as const) {
      await expectModuleDisabled(action, moduleId)
    }

    await expect(
      verifyTurnstileToken({ token: 'stale-token', expectedAction: turnstileActions.magicLink })
    ).resolves.toEqual({ configured: false, success: true })
    await expect(captureException(new Error('local-only'), 'observability-test-error')).resolves.toBeUndefined()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(sentryCapture).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledOnce()
    vi.restoreAllMocks()
  })

  it('executes ready provider boundaries without live network calls', async () => {
    resetStripeClientForTests()
    resetOpenAIResponsesAdapterForTests()
    const config = runtime.assertStartableRuntimeConfig(runtime.evaluateRuntimeEnvironment(readyEnvironment()))
    vi.spyOn(runtime, 'getAppRuntimeConfig').mockReturnValue(config)
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(openAIResponse(), { 'x-request-id': 'request_module_state' }))
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          challenge_ts: '2026-07-15T12:00:00.000Z',
          hostname: 'app.example.test',
          action: turnstileActions.magicLink
        })
      )
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    sentryCapture.mockClear()

    const stripePayload = JSON.stringify({
      id: 'evt_test',
      object: 'event',
      created: Math.floor(Date.now() / 1_000),
      data: { object: {} },
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: 'test.event'
    })
    const stripe = getStripeClient(config)
    const stripeSignature = stripe.webhooks.generateTestHeaderString({
      payload: stripePayload,
      secret: config.stripe.webhookSecret
    })
    const stripeEvent = constructStripeWebhookEvent(stripe, stripePayload, stripeSignature, config.stripe.webhookSecret)
    const chat = await getOpenAIResponsesAdapter().createResponse(openAIRequest())
    const turnstile = await verifyTurnstileToken({
      token: 'turnstile-token',
      expectedAction: turnstileActions.magicLink
    })
    await captureException(new Error('captured-by-double'), 'observability-test-error')

    expect(stripeEvent).toMatchObject({ id: 'evt_test', type: 'test.event' })
    expect(chat).toEqual({
      kind: 'text',
      text: 'hello from OpenAI',
      citations: [],
      model: 'gpt-5.6-luna',
      requestId: 'request_module_state',
      usage: {
        inputTokens: 8,
        outputTokens: 4,
        totalTokens: 12,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        reasoningTokens: 1
      }
    })
    expect(turnstile).toEqual({ configured: true, success: true })
    expect(useObjectStorage().kind).toBe('local')
    expect(() => requireModuleReady('jobs', config)).not.toThrow()
    expect(sentryCapture).toHaveBeenCalledOnce()
    expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([
      'https://api.openai.com/v1/responses',
      'https://challenges.cloudflare.com/turnstile/v0/siteverify'
    ])
    expect(consoleSpy).toHaveBeenCalledOnce()
    resetOpenAIResponsesAdapterForTests()
    resetStripeClientForTests()
    vi.restoreAllMocks()
  })

  it('gates Sentry initialization and attaches the reviewed privacy policy on both boundaries', async () => {
    const relevantKeys = [
      ...Object.keys(readyEnvironment()),
      'NUXT_SENTRY_ENVIRONMENT',
      'NUXT_SENTRY_RELEASE',
      'NUXT_PUBLIC_SENTRY_RELEASE',
      'NUXT_SENTRY_TRACES_SAMPLE_RATE'
    ]
    const originalEnvironment = new Map(relevantKeys.map((key) => [key, process.env[key]]))

    try {
      sentryInit.mockClear()
      const disabledEnvironment = singleReadyModuleEnvironment('observability')
      disabledEnvironment.NUXT_MODULES_OBSERVABILITY_ENABLED = 'false'
      disabledEnvironment.NUXT_SENTRY_DSN = 'https://stale@example.ingest.sentry.io/1'
      applyProcessEnvironment(disabledEnvironment, relevantKeys)
      vi.stubGlobal('useRuntimeConfig', () => ({
        public: {
          moduleStates: { observability: 'disabled' },
          sentryDsn: 'https://stale@example.ingest.sentry.io/1'
        }
      }))
      vi.resetModules()
      await import('../sentry.server.config')
      await import('../sentry.client.config')
      expect(sentryInit).not.toHaveBeenCalled()

      const enabledEnvironment = singleReadyModuleEnvironment('observability')
      applyProcessEnvironment(enabledEnvironment, relevantKeys)
      vi.stubGlobal('useRuntimeConfig', () => ({
        public: {
          moduleStates: { observability: 'ready' },
          sentryDsn: 'https://public@example.ingest.sentry.io/1'
        }
      }))
      vi.resetModules()
      await import('../sentry.server.config')
      await import('../sentry.client.config')
      expect(sentryInit).toHaveBeenCalledTimes(2)

      const serverOptions = sentryInit.mock.calls[0]?.[0] as Record<string, unknown>
      const clientOptions = sentryInit.mock.calls[1]?.[0] as Record<string, unknown>
      const expectedCollectionPolicy = {
        userInfo: false,
        cookies: false,
        httpHeaders: { request: false, response: false },
        httpBodies: [],
        queryParams: false,
        genAI: { inputs: false, outputs: false },
        stackFrameVariables: false,
        frameContextLines: 0
      }

      for (const options of [serverOptions, clientOptions]) {
        expect(options).toMatchObject({
          dsn: 'https://public@example.ingest.sentry.io/1',
          enabled: true,
          dataCollection: expectedCollectionPolicy
        })
        const applyIntegrations = options.integrations as (integrations: Array<{ name: string }>) => Array<{
          name: string
        }>
        expect(applyIntegrations([]).map((integration) => integration.name)).toEqual(['ApplicationTelemetryPrivacy'])
        for (const hook of [
          'beforeBreadcrumb',
          'beforeSend',
          'beforeSendSpan',
          'beforeSendTransaction',
          'tracesSampler'
        ]) {
          expect(options[hook], hook).toBeTypeOf('function')
        }
      }
    } finally {
      for (const [key, value] of originalEnvironment) restoreEnvironment(key, value)
      vi.unstubAllGlobals()
      vi.resetModules()
    }
  })
})

async function expectModuleDisabled(action: () => unknown, moduleId: RuntimeModuleId) {
  try {
    await action()
    throw new Error(`Expected ${moduleId} to be disabled`)
  } catch (error) {
    expect(error).toMatchObject({
      statusCode: 404,
      data: {
        code: moduleDisabledCode,
        module: moduleId
      }
    })
  }
}

async function* disabledUploadBody() {
  yield Buffer.from('x')
}

function coreEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'test',
    NUXT_DATABASE_URL: 'file:../../data/module-states.test.db',
    NUXT_READINESS_TOKEN: 'module-state-readiness-token-with-32-characters',
    NUXT_BETTER_AUTH_SECRET: 'module-state-test-secret-with-32-characters',
    NUXT_BETTER_AUTH_URL: 'https://app.example.test',
    NUXT_SOCIAL_PROVIDERS_GOOGLE_ENABLED: 'false',
    NUXT_EMAIL_TRANSPORT: 'capture',
    NUXT_EMAIL_FROM: 'SmallWiseLabs Base App <no-reply@example.test>',
    NUXT_EMAIL_CAPTURE_DIRECTORY: '../../data/email-capture-module-states',
    NUXT_PUBLIC_APP_URL: 'https://app.example.test',
    NUXT_MODULES_BILLING_ENABLED: 'false',
    NUXT_MODULES_FILES_ENABLED: 'false',
    NUXT_MODULES_AI_ENABLED: 'false',
    NUXT_MODULES_TURNSTILE_ENABLED: 'false',
    NUXT_MODULES_OBSERVABILITY_ENABLED: 'false',
    NUXT_MODULES_JOBS_ENABLED: 'false',
    NUXT_OPENAI_FILE_SEARCH_ENABLED: 'false',
    NUXT_OPENAI_WEB_SEARCH_ENABLED: 'false',
    ...overrides
  }
}

function readyEnvironment() {
  return coreEnvironment({
    NUXT_MODULES_BILLING_ENABLED: 'true',
    NUXT_MODULES_FILES_ENABLED: 'true',
    NUXT_MODULES_AI_ENABLED: 'true',
    NUXT_MODULES_TURNSTILE_ENABLED: 'true',
    NUXT_MODULES_OBSERVABILITY_ENABLED: 'true',
    NUXT_MODULES_JOBS_ENABLED: 'true',
    NUXT_STRIPE_SECRET_KEY: 'rk_test_module_state',
    NUXT_STRIPE_WEBHOOK_SECRET: 'whsec_test',
    NUXT_STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_test',
    NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID: 'price_personal_weekly_test',
    NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID: 'price_personal_monthly_test',
    NUXT_STRIPE_PERSONAL_ANNUAL_PRICE_ID: 'price_personal_annual_test',
    NUXT_STRIPE_FAMILY_MONTHLY_PRICE_ID: 'price_family_monthly_test',
    NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID: 'price_family_annual_test',
    NUXT_FILES_DRIVER: 'local',
    NUXT_CLOUDFLARE_ACCOUNT_ID: 'account',
    NUXT_OPENAI_API_KEY: 'openai-test-key',
    NUXT_OPENAI_PROJECT_ID: 'openai-test-project',
    NUXT_OPENAI_MODEL: 'gpt-5.6-luna',
    NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY: 'turnstile-secret',
    NUXT_PUBLIC_TURNSTILE_SITE_KEY: 'turnstile-site',
    NUXT_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
    NUXT_PUBLIC_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1'
  })
}

function singleReadyModuleEnvironment(
  moduleId: RuntimeModuleId,
  options: { useFileSearch?: boolean; useR2?: boolean; useWebSearch?: boolean } = {}
) {
  const environment = readyEnvironment()
  for (const otherId of runtimeModuleIds) {
    environment[moduleManifest[otherId].flagEnvironmentKey] = otherId === moduleId ? 'true' : 'false'
  }

  if (moduleId === 'billing' || moduleId === 'files') {
    environment.NUXT_MODULES_JOBS_ENABLED = 'true'
  }

  if (moduleId === 'files' && options.useR2) {
    Object.assign(environment, {
      NUXT_FILES_DRIVER: 'r2',
      NUXT_CLOUDFLARE_ACCOUNT_ID: r2AccountId,
      NUXT_CLOUDFLARE_R2_BUCKET: 'bucket',
      NUXT_CLOUDFLARE_R2_ENDPOINT: `https://${r2AccountId}.r2.cloudflarestorage.com`,
      NUXT_CLOUDFLARE_R2_ACCESS_KEY_ID: 'access',
      NUXT_CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'secret'
    })
  }

  if (moduleId === 'files' && !options.useR2) {
    return Object.fromEntries(Object.entries(environment).filter(([key]) => !key.startsWith('NUXT_CLOUDFLARE_R2_')))
  }

  if (moduleId === 'ai' && options.useFileSearch) {
    Object.assign(environment, {
      NUXT_OPENAI_FILE_SEARCH_ENABLED: 'true',
      NUXT_OPENAI_FILE_SEARCH_VECTOR_STORE_ID: 'deployment-corpus-id'
    })
  }

  if (moduleId === 'ai' && options.useWebSearch) {
    Object.assign(environment, {
      NUXT_OPENAI_WEB_SEARCH_ENABLED: 'true',
      NUXT_OPENAI_WEB_SEARCH_ALLOWED_DOMAINS: 'openai.com,example.org,xn--bcher-kva.example'
    })
  }

  return environment
}

function disabledStates() {
  return Object.fromEntries(runtimeModuleIds.map((moduleId) => [moduleId, 'disabled']))
}

function readyStates() {
  return Object.fromEntries(runtimeModuleIds.map((moduleId) => [moduleId, 'ready']))
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

function openAIRequest() {
  return {
    instructions: 'Answer the user plainly.',
    messages: [{ role: 'user', content: 'hello' }] as const,
    safetyIdentifier: '0123456789abcdef0123456789abcdef',
    requestId: '123e4567-e89b-42d3-a456-426614174000',
    maxOutputTokens: 4_096,
    timeoutMs: 60_000
  }
}

function openAIResponse() {
  return {
    id: 'resp_module_state',
    object: 'response',
    created_at: 1_784_096_000,
    status: 'completed',
    error: null,
    incomplete_details: null,
    model: 'gpt-5.6-luna',
    output: [
      {
        id: 'msg_module_state',
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'hello from OpenAI', annotations: [] }]
      }
    ],
    usage: {
      input_tokens: 8,
      output_tokens: 4,
      total_tokens: 12,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 1 }
    }
  }
}

function restoreEnvironment(key: string, value: string | undefined) {
  if (value === undefined) Reflect.deleteProperty(process.env, key)
  else process.env[key] = value
}

function applyProcessEnvironment(environment: Record<string, string | undefined>, keys: readonly string[]) {
  for (const key of keys) restoreEnvironment(key, environment[key])
}
