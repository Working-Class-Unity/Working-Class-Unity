import type { AppRuntimeConfig } from '../../utils/runtime'

type TwilioVerifyConfig = AppRuntimeConfig['twilioVerify']
type FetchImplementation = typeof fetch

const twilioVerifyOrigin = 'https://verify.twilio.com'
const requestTimeoutMs = 10_000

export class TwilioVerifyUnavailableError extends Error {
  constructor() {
    super('Twilio Verify is unavailable')
    this.name = 'TwilioVerifyUnavailableError'
  }
}

export async function sendTwilioVerification(
  config: TwilioVerifyConfig,
  phoneNumber: string,
  fetchImpl: FetchImplementation = fetch
): Promise<void> {
  const response = await requestTwilioVerify(
    config,
    'Verifications',
    new URLSearchParams({ To: phoneNumber, Channel: 'sms', Locale: 'en' }),
    fetchImpl
  )
  if (!response.ok) throw new TwilioVerifyUnavailableError()

  const body = await safeJson(response)
  if (!body || body.status !== 'pending') throw new TwilioVerifyUnavailableError()
}

export async function checkTwilioVerification(
  config: TwilioVerifyConfig,
  phoneNumber: string,
  code: string,
  fetchImpl: FetchImplementation = fetch
): Promise<boolean> {
  const response = await requestTwilioVerify(
    config,
    'VerificationCheck',
    new URLSearchParams({ To: phoneNumber, Code: code }),
    fetchImpl
  )
  if (response.status === 400 || response.status === 404) return false
  if (!response.ok) throw new TwilioVerifyUnavailableError()

  const body = await safeJson(response)
  if (!body || typeof body.status !== 'string') throw new TwilioVerifyUnavailableError()
  return body.status === 'approved'
}

async function requestTwilioVerify(
  config: TwilioVerifyConfig,
  operation: 'Verifications' | 'VerificationCheck',
  body: URLSearchParams,
  fetchImpl: FetchImplementation
): Promise<Response> {
  const path = `/v2/Services/${encodeURIComponent(config.serviceSid)}/${operation}`

  try {
    return await fetchImpl(new URL(path, twilioVerifyOrigin), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Basic ${Buffer.from(`${config.apiKeySid}:${config.apiKeySecret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body,
      signal: AbortSignal.timeout(requestTimeoutMs)
    })
  } catch {
    throw new TwilioVerifyUnavailableError()
  }
}

async function safeJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await response.json()
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}
