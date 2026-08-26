import { convertSetCookieToCookie } from 'better-auth/test'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { turnstileActions, turnstileHeaderName } from '../shared/turnstile'
import * as schema from '../server/db/schema'
import { createAuthentication } from '../server/utils/auth/create'
import { isTemporaryPhoneEmail } from '../server/utils/auth/phone'
import type { AppRuntimeConfig } from '../server/utils/runtime'

const baseURL = 'https://phone-auth.example.test'
const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
let fixture: ReturnType<typeof createFixture>

beforeEach(() => {
  fixture = createFixture()
})

afterEach(() => {
  fixture.cleanup()
  vi.unstubAllGlobals()
})

describe('phone-number passwordless HTTP behavior', () => {
  it('normalizes a U.S. number, verifies through Twilio, and repeats without another user', async () => {
    const provider = fakeProvider()
    vi.stubGlobal('fetch', provider.fetch)

    const firstSend = await sendCode('(209) 555-0123', 'challenge-first')
    expect(firstSend.status).toBe(200)
    expect(provider.sentTo).toEqual(['+12095550123'])
    const transient = fixture.sqlite
      .prepare('select identifier, value from verification where identifier = ?')
      .get('+12095550123') as { identifier: string; value: string }
    expect(transient.identifier).toBe('+12095550123')
    expect(transient.value).not.toContain('123456')

    const firstVerification = await verifyCode('1 209 555 0123', '123456')
    expect(firstVerification.status).toBe(200)
    const firstHeaders = convertSetCookieToCookie(new Headers(firstVerification.headers))
    const session = await fixture.auth.handler(authRequest('/api/auth/get-session', { headers: firstHeaders }))
    expect(session.status).toBe(200)

    const firstUser = fixture.sqlite
      .prepare(
        `select email, email_verified as emailVerified, phone_number as phoneNumber,
                phone_number_verified as phoneNumberVerified from user`
      )
      .get() as {
      email: string
      emailVerified: number
      phoneNumber: string
      phoneNumberVerified: number
    }
    expect(firstUser).toMatchObject({
      emailVerified: 0,
      phoneNumber: '+12095550123',
      phoneNumberVerified: 1
    })
    expect(isTemporaryPhoneEmail(firstUser.email)).toBe(true)
    expect(firstUser.email).not.toContain('12095550123')
    expect(count('verification')).toBe(0)
    expect(count('people')).toBe(1)
    expect(count('person_accounts')).toBe(1)
    expect(count('person_contacts')).toBe(1)
    expect(
      fixture.sqlite
        .prepare(
          `select pc.kind, pc.normalized_value as normalizedValue, pa.user_id as userId
           from person_contacts pc join person_accounts pa on pa.person_id = pc.person_id`
        )
        .get()
    ).toEqual({ kind: 'phone', normalizedValue: '+12095550123', userId: expect.any(String) })

    provider.allowAnotherCode()
    expect((await sendCode('+1 209 555 0123', 'challenge-second')).status).toBe(200)
    expect((await verifyCode('+12095550123', '654321')).status).toBe(200)
    expect(provider.sentTo).toEqual(['+12095550123', '+12095550123'])
    expect(count('user')).toBe(1)
    expect(count('session')).toBe(2)
    expect(count('people')).toBe(1)
    expect(count('person_accounts')).toBe(1)
    expect(count('person_contacts')).toBe(1)
  })

  it('requires Turnstile before SMS and rejects non-U.S. or malformed numbers', async () => {
    const provider = fakeProvider()
    vi.stubGlobal('fetch', provider.fetch)

    const missingChallenge = await fixture.auth.handler(
      authRequest('/api/auth/phone-number/send-otp', {
        method: 'POST',
        body: JSON.stringify({ phoneNumber: '+12095550123' })
      })
    )
    expect(missingChallenge.status).toBe(400)
    expect(await missingChallenge.json()).toMatchObject({ code: 'TURNSTILE_CHALLENGE_REJECTED' })
    expect(provider.sentTo).toEqual([])

    for (const phoneNumber of ['+442079460958', '209-155-0123', '2095550123 ext 4']) {
      const response = await sendCode(phoneNumber, `invalid-${phoneNumber}`)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'INVALID_PHONE_NUMBER' })
    }
    expect(provider.turnstileActions).toEqual([])
    expect(provider.sentTo).toEqual([])
    expect(count('verification')).toBe(0)
  })

  it('fails closed for rejected and replayed provider codes', async () => {
    const provider = fakeProvider()
    vi.stubGlobal('fetch', provider.fetch)

    expect((await sendCode('2095550123', 'challenge-code')).status).toBe(200)
    const rejected = await verifyCode('2095550123', '000000')
    expect(rejected.status).toBe(400)
    expect(count('user')).toBe(0)
    expect(count('session')).toBe(0)

    const accepted = await verifyCode('2095550123', '123456')
    expect(accepted.status).toBe(200)
    const replayed = await verifyCode('2095550123', '123456')
    expect(replayed.status).toBe(400)
    expect(count('user')).toBe(1)
    expect(count('session')).toBe(1)
  })
})

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'wcu-phone-auth-'))
  const databasePath = join(directory, 'fixture.sqlite')
  const sqlite = new Database(databasePath)
  sqlite.pragma('foreign_keys = ON')
  migrate(drizzle({ client: sqlite }), { migrationsFolder })
  const connection = { sqlite, db: drizzle({ client: sqlite, schema }), databasePath }
  const auth = createAuthentication(runtimeConfig(), connection, () => ({
    async send() {
      throw new Error('Phone authentication must not deliver email')
    }
  }))

  return {
    auth,
    sqlite,
    cleanup() {
      sqlite.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

function fakeProvider() {
  const sentTo: string[] = []
  const turnstileActionsSeen: string[] = []
  const validCodes = new Set(['123456'])

  return {
    sentTo,
    turnstileActions: turnstileActionsSeen,
    allowAnotherCode() {
      validCodes.add('654321')
    },
    fetch: vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      const body = new URLSearchParams(String(init?.body))

      if (url.hostname === 'challenges.cloudflare.com') {
        turnstileActionsSeen.push(turnstileActions.phoneOtp)
        return jsonResponse({
          success: true,
          challenge_ts: new Date().toISOString(),
          hostname: 'phone-auth.example.test',
          action: turnstileActions.phoneOtp
        })
      }
      if (url.pathname.endsWith('/Verifications')) {
        sentTo.push(body.get('To') ?? '')
        return jsonResponse({ status: 'pending' })
      }
      if (url.pathname.endsWith('/VerificationCheck')) {
        const code = body.get('Code') ?? ''
        if (!validCodes.delete(code)) return jsonResponse({ status: 'pending' })
        return jsonResponse({ status: 'approved' })
      }
      throw new Error('Unexpected provider request')
    })
  }
}

function runtimeConfig(): AppRuntimeConfig {
  return {
    betterAuth: { secret: 'phone-auth-test-secret-with-32-characters', url: baseURL },
    cloudflare: { turnstile: { secretKey: '1x0000000000000000000000000000000AA' } },
    email: {
      transport: 'capture',
      from: 'WCU <no-reply@example.test>',
      captureDirectory: '/tmp/unused-phone-auth-email',
      resend: { apiKey: '' }
    },
    public: {
      appName: 'Phone Auth Test',
      appUrl: baseURL,
      turnstileSiteKey: '1x00000000000000000000AA'
    },
    stripe: {
      membershipDues10PriceId: 'price_phone_auth_membership_10',
      solidarityDues27PriceId: 'price_phone_auth_solidarity_27'
    },
    twilioVerify: {
      apiKeySid: 'SK00000000000000000000000000000000',
      apiKeySecret: 'phone-auth-twilio-secret-at-least-32-characters',
      serviceSid: 'VA00000000000000000000000000000000'
    }
  } as AppRuntimeConfig
}

function sendCode(phoneNumber: string, challenge: string) {
  return fixture.auth.handler(
    authRequest('/api/auth/phone-number/send-otp', {
      method: 'POST',
      headers: { [turnstileHeaderName]: challenge },
      body: JSON.stringify({ phoneNumber })
    })
  )
}

function verifyCode(phoneNumber: string, code: string) {
  return fixture.auth.handler(
    authRequest('/api/auth/phone-number/verify', {
      method: 'POST',
      body: JSON.stringify({ phoneNumber, code })
    })
  )
}

function authRequest(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('cf-connecting-ip', '2001:db8::60')
  if (init.body !== undefined) {
    headers.set('content-type', 'application/json')
    headers.set('origin', baseURL)
  }
  return new Request(new URL(url, baseURL), { ...init, headers, redirect: 'manual' })
}

function count(table: 'people' | 'person_accounts' | 'person_contacts' | 'session' | 'user' | 'verification') {
  return (fixture.sqlite.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}
