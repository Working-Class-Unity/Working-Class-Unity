import { describe, expect, it, vi } from 'vitest'
import { turnstileActions, turnstileHeaderName, turnstileTokenSchema, type TurnstileAction } from '../shared/turnstile'
import { verifyTurnstileToken } from '../server/services/security/turnstile'
import {
  assertStartableRuntimeConfig,
  evaluateRuntimeEnvironment,
  type AppRuntimeConfig
} from '../server/utils/runtime'

describe('Turnstile boundary', () => {
  it('shares one opaque 2,048-character token and action contract', () => {
    const opaqueToken = ' \u0000opaque token\n'

    expect(turnstileTokenSchema.parse(opaqueToken)).toBe(opaqueToken)
    expect(turnstileTokenSchema.parse('x'.repeat(2_048))).toHaveLength(2_048)
    expect(turnstileTokenSchema.safeParse('')).toMatchObject({ success: false })
    expect(turnstileTokenSchema.safeParse('x'.repeat(2_049))).toMatchObject({ success: false })
    expect(turnstileActions).toEqual({ magicLink: 'auth_magic_link', phoneOtp: 'auth_phone_otp' })
    expect(turnstileHeaderName).toBe('x-turnstile-token')
  })

  it.each([
    ['secret key', (config: AppRuntimeConfig) => incompleteConfig(config, { secretKey: '' })],
    ['site key', (config: AppRuntimeConfig) => incompleteConfig(config, { siteKey: '' })],
    ['application URL', (config: AppRuntimeConfig) => incompleteConfig(config, { appUrl: '' })]
  ])('fails closed without provider I/O when configuration lacks the %s', async (_label, arrange) => {
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(
      verifyTurnstileToken({
        token: 'opaque-token',
        expectedAction: turnstileActions.magicLink,
        config: arrange(turnstileConfig()),
        fetchImpl
      })
    ).rejects.toMatchObject(
      turnstileError(503, 'Turnstile verification is temporarily unavailable', 'TURNSTILE_UNAVAILABLE')
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('submits the exact opaque token, action-bound hostname, and one UUID without remote IP data', async () => {
    const config = turnstileConfig()
    const token = ' opaque+token/with bytes '
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(siteverifyResponse(successPayload(turnstileActions.magicLink)))

    await expect(
      verifyTurnstileToken({ token, expectedAction: turnstileActions.magicLink, config, fetchImpl })
    ).resolves.toEqual({ configured: true, success: true })

    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = fetchImpl.mock.calls[0] ?? []
    const body = new URLSearchParams(String(init?.body))
    expect(String(url)).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: expect.any(AbortSignal)
    })
    expect(body.get('secret')).toBe(config.cloudflare.turnstile.secretKey)
    expect(body.get('response')).toBe(token)
    expect(body.get('idempotency_key')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(body.has('remoteip')).toBe(false)
  })

  it.each([undefined, '', 'x'.repeat(2_049)])('rejects an invalid token before provider I/O', async (token) => {
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(
      verifyTurnstileToken({ token, expectedAction: turnstileActions.magicLink, config: turnstileConfig(), fetchImpl })
    ).rejects.toMatchObject(turnstileError(400, 'Turnstile challenge rejected', 'TURNSTILE_CHALLENGE_REJECTED'))
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    ['action', successPayload('unexpected_action')],
    ['hostname', successPayload(turnstileActions.magicLink, { hostname: 'hostile.example.test' })]
  ])('rejects a successful provider response with the wrong %s without retrying', async (_label, payload) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(siteverifyResponse(payload))

    await expect(
      verifyTurnstileToken({
        token: 'opaque-token',
        expectedAction: turnstileActions.magicLink,
        config: turnstileConfig(),
        fetchImpl
      })
    ).rejects.toMatchObject(turnstileError(400, 'Turnstile challenge rejected', 'TURNSTILE_CHALLENGE_REJECTED'))
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it.each(['missing-input-response', 'invalid-input-response', 'timeout-or-duplicate'])(
    'maps deterministic provider challenge failure %s to a redacted 400 without retry',
    async (errorCode) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(siteverifyResponse(failurePayload(errorCode)))

      await expect(
        verifyTurnstileToken({
          token: 'opaque-token',
          expectedAction: turnstileActions.magicLink,
          config: turnstileConfig(),
          fetchImpl
        })
      ).rejects.toMatchObject(turnstileError(400, 'Turnstile challenge rejected', 'TURNSTILE_CHALLENGE_REJECTED'))
      expect(fetchImpl).toHaveBeenCalledOnce()
    }
  )

  it.each([
    ['missing-input-secret', ['missing-input-secret']],
    ['invalid-input-secret', ['invalid-input-secret']],
    ['bad-request', ['bad-request']],
    ['unknown code', ['undocumented-provider-code']],
    ['mixed codes', ['internal-error', 'invalid-input-response']]
  ])('maps provider failure %s to a redacted 503 without retry', async (_label, errorCodes) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(siteverifyResponse(failurePayload(...errorCodes)))

    let caught: unknown
    try {
      await verifyTurnstileToken({
        token: 'private-token-sentinel',
        expectedAction: turnstileActions.magicLink,
        config: turnstileConfig(),
        fetchImpl
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject(
      turnstileError(503, 'Turnstile verification is temporarily unavailable', 'TURNSTILE_UNAVAILABLE')
    )
    expect(JSON.stringify(caught)).not.toContain('private-token-sentinel')
    for (const errorCode of errorCodes) expect(JSON.stringify(caught)).not.toContain(errorCode)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it.each([
    ['network failure', () => Promise.reject(new Error('private network detail'))],
    ['non-2xx response', () => Promise.resolve(siteverifyResponse({ private: 'detail' }, 502))],
    ['malformed JSON', () => Promise.resolve(new Response('{'))],
    ['malformed schema', () => Promise.resolve(siteverifyResponse({ success: true }))]
  ])('retries one ambiguous %s with the initial UUID', async (_label, firstAttempt) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(firstAttempt)
      .mockResolvedValueOnce(siteverifyResponse(successPayload(turnstileActions.magicLink)))

    await expect(
      verifyTurnstileToken({
        token: 'opaque-token',
        expectedAction: turnstileActions.magicLink,
        config: turnstileConfig(),
        fetchImpl
      })
    ).resolves.toEqual({ configured: true, success: true })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(idempotencyKeys(fetchImpl)).toHaveLength(2)
    expect(new Set(idempotencyKeys(fetchImpl)).size).toBe(1)
  })

  it('retries a sole internal-error once with the initial UUID and then succeeds', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(siteverifyResponse(failurePayload('internal-error')))
      .mockResolvedValueOnce(siteverifyResponse(successPayload(turnstileActions.magicLink)))

    await expect(
      verifyTurnstileToken({
        token: 'opaque-token',
        expectedAction: turnstileActions.magicLink,
        config: turnstileConfig(),
        fetchImpl
      })
    ).resolves.toEqual({ configured: true, success: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(new Set(idempotencyKeys(fetchImpl)).size).toBe(1)
  })

  it('enforces the five-second attempt timeout and retries at most once', async () => {
    vi.useFakeTimers()
    try {
      let firstSignal: AbortSignal | undefined
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockImplementationOnce(
          (_url, init) =>
            new Promise<Response>((_resolve, reject) => {
              firstSignal = init?.signal ?? undefined
              firstSignal?.addEventListener('abort', () => reject(firstSignal?.reason), { once: true })
            })
        )
        .mockResolvedValueOnce(siteverifyResponse(successPayload(turnstileActions.magicLink)))
      const verification = verifyTurnstileToken({
        token: 'opaque-token',
        expectedAction: turnstileActions.magicLink,
        config: turnstileConfig(),
        fetchImpl
      })

      await vi.advanceTimersByTimeAsync(4_999)
      expect(fetchImpl).toHaveBeenCalledOnce()
      expect(firstSignal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)

      await expect(verification).resolves.toEqual({ configured: true, success: true })
      expect(firstSignal?.aborted).toBe(true)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      expect(new Set(idempotencyKeys(fetchImpl)).size).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops after two ambiguous attempts and returns only the fixed unavailable error', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('private provider detail'))

    let caught: unknown
    try {
      await verifyTurnstileToken({
        token: 'private-token-sentinel',
        expectedAction: turnstileActions.magicLink,
        config: turnstileConfig(),
        fetchImpl
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject(
      turnstileError(503, 'Turnstile verification is temporarily unavailable', 'TURNSTILE_UNAVAILABLE')
    )
    expect(JSON.stringify(caught)).not.toMatch(/private-token-sentinel|private provider detail/)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('stops after two non-2xx attempts and redacts the provider response', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(siteverifyResponse({ private: 'provider response detail' }, 502))

    let caught: unknown
    try {
      await verifyTurnstileToken({
        token: 'private-token-sentinel',
        expectedAction: turnstileActions.magicLink,
        config: turnstileConfig(),
        fetchImpl
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject(
      turnstileError(503, 'Turnstile verification is temporarily unavailable', 'TURNSTILE_UNAVAILABLE')
    )
    expect(JSON.stringify(caught)).not.toMatch(/private-token-sentinel|provider response detail/)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(new Set(idempotencyKeys(fetchImpl)).size).toBe(1)
  })
})

function turnstileConfig(): AppRuntimeConfig {
  return assertStartableRuntimeConfig(
    evaluateRuntimeEnvironment({
      CI: 'true',
      NODE_ENV: 'test',
      NUXT_DATABASE_URL: 'file:./data/turnstile.test.db',
      NUXT_READINESS_TOKEN: 'turnstile-readiness-token-with-32-characters',
      NUXT_BETTER_AUTH_SECRET: 'turnstile-auth-secret-with-32-characters',
      NUXT_BETTER_AUTH_URL: 'https://app.example.test',
      NUXT_EMAIL_TRANSPORT: 'capture',
      NUXT_EMAIL_FROM: 'Turnstile test <no-reply@example.test>',
      NUXT_EMAIL_CAPTURE_DIRECTORY: './data/email-capture-turnstile',
      NUXT_TWILIO_VERIFY_API_KEY_SID: 'SK88888888888888888888888888888888',
      NUXT_TWILIO_VERIFY_API_KEY_SECRET: 'turnstile-twilio-secret-not-a-credential',
      NUXT_TWILIO_VERIFY_SERVICE_SID: 'VA88888888888888888888888888888888',
      NUXT_PUBLIC_APP_URL: 'https://app.example.test/product',
      NUXT_STRIPE_SECRET_KEY: 'rk_test_turnstile_not_a_provider_credential',
      NUXT_STRIPE_WEBHOOK_SECRET: 'whsec_turnstile_not_a_provider_credential',
      NUXT_STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_turnstile',
      NUXT_STRIPE_MEMBERSHIP_DUES10_PRICE_ID: 'price_turnstile_personal_monthly',
      NUXT_STRIPE_SOLIDARITY_DUES27_PRICE_ID: 'price_turnstile_family_monthly',
      NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY: 'live-turnstile-secret',
      NUXT_PUBLIC_TURNSTILE_SITE_KEY: 'live-turnstile-site'
    })
  )
}

function incompleteConfig(
  config: AppRuntimeConfig,
  replacement: { secretKey?: string; siteKey?: string; appUrl?: string }
): AppRuntimeConfig {
  return {
    ...config,
    cloudflare: {
      ...config.cloudflare,
      turnstile: {
        secretKey: replacement.secretKey ?? config.cloudflare.turnstile.secretKey
      }
    },
    public: {
      ...config.public,
      appUrl: replacement.appUrl ?? config.public.appUrl,
      turnstileSiteKey: replacement.siteKey ?? config.public.turnstileSiteKey
    }
  }
}

function successPayload(action: TurnstileAction, replacement: { hostname?: string } = {}) {
  return {
    success: true,
    challenge_ts: '2022-02-28T15:14:30.096Z',
    hostname: replacement.hostname ?? 'app.example.test',
    action
  }
}

function failurePayload(...errorCodes: string[]) {
  return {
    success: false,
    'error-codes': errorCodes
  }
}

function siteverifyResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function idempotencyKeys(fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>): string[] {
  return fetchImpl.mock.calls.map(([, init]) => new URLSearchParams(String(init?.body)).get('idempotency_key') ?? '')
}

function turnstileError(statusCode: number, statusMessage: string, code: string) {
  return {
    statusCode,
    statusMessage,
    data: { code }
  }
}
