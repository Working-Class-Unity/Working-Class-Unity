import { describe, expect, it, vi } from 'vitest'
import type { AppRuntimeConfig } from '../server/utils/runtime'
import {
  checkTwilioVerification,
  sendTwilioVerification,
  TwilioVerifyUnavailableError
} from '../server/services/security/twilio-verify'
import { isTemporaryPhoneEmail, normalizeUsPhoneNumber, temporaryPhoneEmail } from '../server/utils/auth/phone'

const config = {
  apiKeySid: 'SK00000000000000000000000000000000',
  apiKeySecret: 'test-twilio-api-secret-at-least-32-chars',
  serviceSid: 'VA00000000000000000000000000000000'
} satisfies AppRuntimeConfig['twilioVerify']

describe('Twilio Verify adapter', () => {
  it('starts one SMS verification with the exact provider request', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ status: 'pending' }))

    await sendTwilioVerification(config, '+12095550123', fetchImpl)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(String(url)).toBe('https://verify.twilio.com/v2/Services/VA00000000000000000000000000000000/Verifications')
    expect(init?.method).toBe('POST')
    expect(new URLSearchParams(String(init?.body))).toEqual(
      new URLSearchParams({ To: '+12095550123', Channel: 'sms', Locale: 'en' })
    )
    expect(new Headers(init?.headers).get('authorization')).toBe(
      `Basic ${Buffer.from(`${config.apiKeySid}:${config.apiKeySecret}`).toString('base64')}`
    )
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('accepts only an approved verification result', async () => {
    const approved = vi.fn<typeof fetch>(async () => jsonResponse({ status: 'approved' }))
    const pending = vi.fn<typeof fetch>(async () => jsonResponse({ status: 'pending' }))
    const expired = vi.fn<typeof fetch>(async () => jsonResponse({ message: 'private provider detail' }, 404))

    await expect(checkTwilioVerification(config, '+12095550123', '123456', approved)).resolves.toBe(true)
    await expect(checkTwilioVerification(config, '+12095550123', '123456', pending)).resolves.toBe(false)
    await expect(checkTwilioVerification(config, '+12095550123', '123456', expired)).resolves.toBe(false)

    const body = new URLSearchParams(String(approved.mock.calls[0]?.[1]?.body))
    expect(body.get('To')).toBe('+12095550123')
    expect(body.get('Code')).toBe('123456')
  })

  it('normalizes failures without exposing provider or credential details', async () => {
    const providerFailure = vi.fn<typeof fetch>(async () =>
      jsonResponse({ message: `private ${config.apiKeySecret} +12095550123` }, 503)
    )
    const networkFailure = vi.fn<typeof fetch>(async () => {
      throw new Error(`private ${config.apiKeySecret}`)
    })

    for (const operation of [
      sendTwilioVerification(config, '+12095550123', providerFailure),
      checkTwilioVerification(config, '+12095550123', '123456', networkFailure)
    ]) {
      const error = await operation.catch((value: unknown) => value)
      expect(error).toBeInstanceOf(TwilioVerifyUnavailableError)
      expect(String(error)).not.toMatch(/private|12095550123|test-twilio/i)
    }
  })
})

describe('United States phone identity normalization', () => {
  it.each([
    ['(209) 555-0123', '+12095550123'],
    ['209-555-0123', '+12095550123'],
    ['1 209 555 0123', '+12095550123'],
    ['+1 (209) 555-0123', '+12095550123']
  ])('normalizes %s', (input, expected) => {
    expect(normalizeUsPhoneNumber(input)).toBe(expected)
  })

  it.each(['+442079460958', '1209555012', '10955550123', '209-155-0123', '2095550123 ext 4'])('rejects %s', (input) => {
    expect(normalizeUsPhoneNumber(input)).toBeNull()
  })

  it('derives a deterministic non-deliverable email without embedding the phone number', () => {
    const value = temporaryPhoneEmail('test-secret-at-least-32-characters', '+12095550123')
    expect(value).toMatch(/^phone-[a-f0-9]{64}@accounts\.invalid$/)
    expect(value).not.toContain('12095550123')
    expect(isTemporaryPhoneEmail(value)).toBe(true)
    expect(isTemporaryPhoneEmail('member@example.test')).toBe(false)
  })
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}
