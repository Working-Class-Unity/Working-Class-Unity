import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { turnstileTokenSchema, type TurnstileAction } from '../../../shared/turnstile'
import { upstreamServiceError, validationError } from '../../utils/errors'
import { getAppRuntimeConfig, type AppRuntimeConfig } from '../../utils/runtime'

const siteverifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const siteverifyTimeoutMs = 5_000
const siteverifyMaxAttempts = 2
const challengeRejectionCodes = new Set(['missing-input-response', 'invalid-input-response', 'timeout-or-duplicate'])
const providerConfigurationCodes = new Set(['missing-input-secret', 'invalid-input-secret', 'bad-request'])

const successfulTurnstileResponseSchema = z.object({
  success: z.literal(true),
  challenge_ts: z.iso.datetime({ offset: true }),
  hostname: z.string().min(1),
  action: z.string().min(1)
})

const failedTurnstileResponseSchema = z.object({
  success: z.literal(false),
  'error-codes': z.array(z.string()).min(1)
})

const turnstileResponseSchema = z.discriminatedUnion('success', [
  successfulTurnstileResponseSchema,
  failedTurnstileResponseSchema
])

type VerifyTurnstileTokenInput = Readonly<{
  token?: string
  expectedAction: TurnstileAction
  config?: AppRuntimeConfig
  fetchImpl?: typeof fetch
  timeoutMs?: number
}>

type SiteverifyAttempt = Readonly<{ kind: 'non-2xx' }> | Readonly<{ kind: 'response'; payload: unknown }>

export async function verifyTurnstileToken(input: VerifyTurnstileTokenInput) {
  const config = input.config ?? getAppRuntimeConfig()

  if (!config.modules.turnstile.enabled) {
    return {
      configured: false,
      success: true
    }
  }

  const expectedHostname = configuredTurnstileHostname(config)
  const token = turnstileTokenSchema.safeParse(input.token)
  if (!token.success) throw turnstileChallengeRejected()

  const idempotencyKey = randomUUID()
  const fetchImpl = input.fetchImpl ?? globalThis.fetch
  const timeoutMs = input.timeoutMs ?? siteverifyTimeoutMs

  for (let attempt = 0; attempt < siteverifyMaxAttempts; attempt += 1) {
    let result: SiteverifyAttempt
    try {
      result = await requestSiteverify({
        fetchImpl,
        secretKey: config.cloudflare.turnstile.secretKey,
        token: token.data,
        idempotencyKey,
        timeoutMs
      })
    } catch {
      if (attempt + 1 < siteverifyMaxAttempts) continue
      throw turnstileUnavailable()
    }

    if (result.kind === 'non-2xx') {
      if (attempt + 1 < siteverifyMaxAttempts) continue
      throw turnstileUnavailable()
    }

    const payload = turnstileResponseSchema.safeParse(result.payload)
    if (!payload.success) {
      if (attempt + 1 < siteverifyMaxAttempts) continue
      throw turnstileUnavailable()
    }

    if (!payload.data.success) {
      const errorCodes = payload.data['error-codes']
      if (errorCodes.length === 1 && errorCodes[0] === 'internal-error') {
        if (attempt + 1 < siteverifyMaxAttempts) continue
        throw turnstileUnavailable()
      }
      if (errorCodes.length === 1 && challengeRejectionCodes.has(errorCodes[0] ?? '')) {
        throw turnstileChallengeRejected()
      }
      if (errorCodes.length === 1 && providerConfigurationCodes.has(errorCodes[0] ?? '')) {
        throw turnstileUnavailable()
      }
      throw turnstileUnavailable()
    }

    if (payload.data.action !== input.expectedAction || payload.data.hostname !== expectedHostname) {
      throw turnstileChallengeRejected()
    }

    return {
      configured: true,
      success: true
    }
  }

  throw turnstileUnavailable()
}

function configuredTurnstileHostname(config: AppRuntimeConfig): string {
  const secretKey = config.cloudflare.turnstile.secretKey
  const siteKey = config.public.turnstileSiteKey
  const appUrl = config.public.appUrl

  if (!secretKey.trim() || !siteKey.trim() || !appUrl || appUrl !== appUrl.trim()) {
    throw turnstileUnavailable()
  }

  try {
    const url = new URL(appUrl)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) throw new Error()
    return url.hostname
  } catch {
    throw turnstileUnavailable()
  }
}

async function requestSiteverify(input: {
  fetchImpl: typeof fetch
  secretKey: string
  token: string
  idempotencyKey: string
  timeoutMs: number
}): Promise<SiteverifyAttempt> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort()
      reject(new Error('Siteverify request timed out'))
    }, input.timeoutMs)
  })
  const requestPromise = (async (): Promise<SiteverifyAttempt> => {
    const body = new URLSearchParams({
      secret: input.secretKey,
      response: input.token,
      idempotency_key: input.idempotencyKey
    })
    const response = await input.fetchImpl(siteverifyUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body,
      signal: controller.signal
    })

    if (!response.ok) return { kind: 'non-2xx' }
    return { kind: 'response', payload: await response.json() }
  })()

  try {
    return await Promise.race([requestPromise, timeoutPromise])
  } finally {
    clearTimeout(timeout)
  }
}

function turnstileChallengeRejected() {
  return validationError('Turnstile challenge rejected', {
    code: 'TURNSTILE_CHALLENGE_REJECTED'
  })
}

function turnstileUnavailable() {
  return upstreamServiceError(503, 'Turnstile verification is temporarily unavailable', {
    code: 'TURNSTILE_UNAVAILABLE'
  })
}
