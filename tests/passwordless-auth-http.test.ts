import { randomUUID } from 'node:crypto'
import { convertSetCookieToCookie } from 'better-auth/test'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { turnstileHeaderName } from '../shared/turnstile'
import * as schema from '../server/db/schema'
import type { TransactionalEmailMessage } from '../server/services/email'
import { readPublicJoinAttempt } from '../server/services/membership/public-join'
import { publicJoinMagicLinkBody } from '../server/services/membership/public-join-auth'
import { createAuthentication } from '../server/utils/auth/create'
import type { AppRuntimeConfig } from '../server/utils/runtime'

const baseURL = 'https://passwordless.example.test'
const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
let nextClientIp = 0x10
let fixture: ReturnType<typeof createFixture>
let fixtureReady = false

beforeEach(() => {
  vi.unstubAllGlobals()
  fixtureReady = false
  fixture = createFixture()
  fixtureReady = true
  vi.stubGlobal('fetch', successfulSiteverify)
})

afterEach(() => {
  if (fixtureReady) fixture.cleanup()
  fixtureReady = false
  vi.unstubAllGlobals()
})

describe('configured passwordless HTTP behavior', () => {
  it('registers a new user from an email-only magic-link request', async () => {
    const email = 'email-only-registration@example.test'
    const issued = await issueMagicLink(email)

    expect(issued.response.status).toBe(200)
    expect(JSON.parse(issued.body)).toEqual({ status: true })
    expect(JSON.parse(issued.verification.value)).toMatchObject({ email })

    const verified = await fixture.auth.handler(authRequest(issued.url))
    expect(redirectOutcome(verified).error).toBeUndefined()
    const sessionHeaders = convertSetCookieToCookie(new Headers(verified.headers))

    expect(
      fixture.sqlite
        .prepare(
          'select email, name, first_name as firstName, last_name as lastName, display_name as displayName from user where email = ?'
        )
        .get(email)
    ).toEqual({
      email,
      name: 'WCU account',
      firstName: null,
      lastName: null,
      displayName: null
    })

    const session = await fixture.auth.handler(authRequest('/api/auth/get-session', { headers: sessionHeaders }))
    const sessionBody = await session.json()
    expect(sessionBody).toMatchObject({ user: { email, displayName: null } })
    expect(sessionBody.user).not.toHaveProperty('firstName')
    expect(sessionBody.user).not.toHaveProperty('lastName')
    expect(
      fixture.sqlite
        .prepare(
          `select pc.kind, pc.normalized_value as normalizedValue, pc.verified_at as verifiedAt
           from person_accounts pa
           join user u on u.id = pa.user_id
           join person_contacts pc on pc.person_id = pa.person_id
           where u.email = ?`
        )
        .get(email)
    ).toEqual({
      kind: 'email',
      normalizedValue: email,
      verifiedAt: expect.any(String)
    })

    const forgedEmail = 'forged-signup-profile@example.test'
    const forged = await issueMagicLink(forgedEmail, {}, nextUniqueClientIp(), {
      ...magicLinkBody(forgedEmail),
      name: 'Forged auth name',
      firstName: 'Forged first name',
      lastName: 'Forged last name',
      displayName: 'Forged display name'
    })
    const forgedVerified = await fixture.auth.handler(authRequest(forged.url))
    expect(forgedVerified.status).toBe(302)
    expect(profileRow(forgedEmail)).toEqual({
      name: 'WCU account',
      firstName: null,
      lastName: null,
      displayName: null
    })
  })

  it('creates and claims a new same-email account from an authorized paid-join magic link without public Turnstile input', async () => {
    const email = 'paid-join-registration@example.test'
    const attemptId = seedPaidPublicJoin(email)
    const attempt = readPublicJoinAttempt(
      { sqlite: fixture.sqlite, db: undefined as never, databasePath: ':memory:' },
      attemptId
    )!
    const siteverify = vi.fn(successfulSiteverify)
    vi.stubGlobal('fetch', siteverify)

    const issued = await fixture.auth.handler(
      authRequest('/api/auth/sign-in/magic-link', {
        method: 'POST',
        body: JSON.stringify(publicJoinMagicLinkBody(attempt, testRuntimeConfig().betterAuth.secret))
      })
    )
    expect(issued.status).toBe(200)
    expect(siteverify).not.toHaveBeenCalled()
    expect(fixture.deliveries).toHaveLength(1)

    const magicLink = fixture.deliveries[0]?.text.match(/https?:\/\/\S+/)?.[0]
    if (!magicLink) throw new Error('Expected the public join email to contain one magic link')
    const verified = await fixture.auth.handler(authRequest(magicLink))
    expect(verified.status).toBe(302)
    const redirect = new URL(verified.headers.get('location') ?? '', baseURL)
    expect(redirect.origin).toBe(baseURL)
    expect(redirect.pathname).toBe('/join/claim')
    expect(redirect.searchParams.get('error')).toBeNull()
    expect(
      fixture.sqlite
        .prepare(
          `select attempt.state, attempt.email, user.email as accountEmail
           from public_join_attempts attempt join user on user.id = attempt.claimed_user_id
           where attempt.id = ?`
        )
        .get(attemptId)
    ).toEqual({ state: 'claimed', email, accountEmail: email })
  })

  it('recovers an unclaimed paid join with a fresh public magic link after the original link expires', async () => {
    const email = 'paid-join-recovery@example.test'
    const attemptId = seedPaidPublicJoin(email)
    const connection = { sqlite: fixture.sqlite, db: undefined as never, databasePath: ':memory:' }
    const attempt = readPublicJoinAttempt(connection, attemptId)!
    const siteverify = vi.fn(successfulSiteverify)
    vi.stubGlobal('fetch', siteverify)
    const original = await issueMagicLink(
      email,
      {},
      nextUniqueClientIp(),
      publicJoinMagicLinkBody(attempt, testRuntimeConfig().betterAuth.secret)
    )
    expect(siteverify).not.toHaveBeenCalled()
    fixture.sqlite
      .prepare('update verification set expires_at = ? where identifier = ?')
      .run(Math.floor(Date.now() / 1_000) - 1, original.verification.identifier)

    const expired = await fixture.auth.handler(authRequest(original.url))
    expect(expired.status).toBe(302)
    expect(new URL(expired.headers.get('location') ?? '', baseURL).searchParams.get('status')).toBe('link-error')
    expect(readPublicJoinAttempt(connection, attemptId)?.state).toBe('paid')

    const completionPath = `/join/complete?id=${attemptId}`
    const recovery = await issueMagicLink(email, {}, nextUniqueClientIp(), {
      email,
      callbackURL: completionPath,
      newUserCallbackURL: completionPath,
      errorCallbackURL: '/login'
    })
    expect(siteverify).toHaveBeenCalledTimes(1)
    const recovered = await fixture.auth.handler(authRequest(recovery.url))
    expect(recovered.status).toBe(302)
    const recoveredLocation = new URL(recovered.headers.get('location') ?? '', baseURL)
    expect(`${recoveredLocation.pathname}${recoveredLocation.search}`).toBe(completionPath)
    expect(readPublicJoinAttempt(connection, attemptId)).toMatchObject({
      claimedUserId: expect.any(String),
      state: 'claimed'
    })
  })

  it('provisions a canonical identity when an existing website account logs in', async () => {
    const email = 'existing-account@example.test'
    fixture.sqlite
      .prepare(
        `insert into user (id, name, email, email_verified, created_at, updated_at)
         values ('existing-account', 'WCU account', ?, 1, 1, 1)`
      )
      .run(email)

    const issued = await issueMagicLink(email)
    const verified = await fixture.auth.handler(authRequest(issued.url))

    expect(redirectOutcome(verified).error).toBeUndefined()
    expect(
      fixture.sqlite
        .prepare(
          `select pa.user_id as userId, pc.normalized_value as normalizedValue
           from person_accounts pa
           join person_contacts pc on pc.person_id = pa.person_id
           where pa.user_id = 'existing-account'`
        )
        .get()
    ).toEqual({ normalizedValue: email, userId: 'existing-account' })
    expect(fixture.sqlite.prepare('select count(*) as count from people').get()).toEqual({ count: 1 })
  })

  it('normalizes, isolates, validates, and clears optional account profile fields', async () => {
    const ownerEmail = 'profile-owner@example.test'
    const otherEmail = 'profile-other@example.test'
    const ownerIssued = await issueMagicLink(ownerEmail)
    const otherIssued = await issueMagicLink(otherEmail)
    const ownerVerified = await fixture.auth.handler(authRequest(ownerIssued.url))
    const otherVerified = await fixture.auth.handler(authRequest(otherIssued.url))
    const ownerHeaders = convertSetCookieToCookie(new Headers(ownerVerified.headers))
    const other = fixture.sqlite.prepare('select id from user where email = ?').get(otherEmail) as { id: string }

    const anonymous = await fixture.auth.handler(
      authRequest('/api/auth/update-user', {
        method: 'POST',
        body: JSON.stringify({ displayName: 123 })
      })
    )
    expect(anonymous.status).toBe(401)

    const updated = await fixture.auth.handler(
      authRequest('/api/auth/update-user', {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({
          userId: other.id,
          firstName: '  Chíma  ',
          lastName: '  联合  ',
          displayName: '  Worker 🌹  '
        })
      })
    )
    expect(updated.status).toBe(200)
    expect(profileRow(ownerEmail)).toEqual({
      name: 'WCU account',
      firstName: 'Chíma',
      lastName: '联合',
      displayName: 'Worker 🌹'
    })
    expect(profileRow(otherEmail)).toEqual({
      name: 'WCU account',
      firstName: null,
      lastName: null,
      displayName: null
    })

    const session = await fixture.auth.handler(authRequest('/api/auth/get-session', { headers: ownerHeaders }))
    const sessionBody = await session.json()
    expect(sessionBody).toMatchObject({ user: { email: ownerEmail, displayName: 'Worker 🌹' } })
    expect(sessionBody.user).not.toHaveProperty('firstName')
    expect(sessionBody.user).not.toHaveProperty('lastName')

    const coreNameUpdate = await fixture.auth.handler(
      authRequest('/api/auth/update-user', {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({ name: 'Caller-owned core name' })
      })
    )
    expect(coreNameUpdate.status).toBe(400)
    expect(await coreNameUpdate.json()).toMatchObject({ code: 'INVALID_PROFILE_UPDATE' })

    const astralBoundary = '🌹'.repeat(50)
    const acceptedAstralBoundary = await fixture.auth.handler(
      authRequest('/api/auth/update-user', {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({ firstName: astralBoundary })
      })
    )
    expect(acceptedAstralBoundary.status).toBe(200)
    expect(profileRow(ownerEmail)).toMatchObject({ firstName: astralBoundary })

    for (const body of [
      { firstName: 'x'.repeat(101) },
      { firstName: '🌹'.repeat(51) },
      { lastName: 123 },
      { displayName: 'x'.repeat(101) }
    ]) {
      const invalid = await fixture.auth.handler(
        authRequest('/api/auth/update-user', {
          method: 'POST',
          headers: ownerHeaders,
          body: JSON.stringify(body)
        })
      )
      expect(invalid.status).toBe(400)
      expect(profileRow(ownerEmail)).toEqual({
        name: 'WCU account',
        firstName: astralBoundary,
        lastName: '联合',
        displayName: 'Worker 🌹'
      })
    }

    const cleared = await fixture.auth.handler(
      authRequest('/api/auth/update-user', {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({ firstName: ' ', lastName: '\t', displayName: '' })
      })
    )
    expect(cleared.status).toBe(200)
    expect(profileRow(ownerEmail)).toEqual({
      name: 'WCU account',
      firstName: null,
      lastName: null,
      displayName: null
    })

    expect(otherVerified.status).toBe(302)
  })

  it('requires the bounded header challenge before magic-link side effects and redacts verification failures', async () => {
    const siteverify = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body))
      const token = body.get('response')

      if (token === 'provider-rejected-token') {
        return jsonResponse({
          success: false,
          'error-codes': ['invalid-input-response'],
          private_detail: 'private-provider-rejection-detail'
        })
      }
      if (token === 'provider-unavailable-token') {
        throw new Error('private-provider-network-detail')
      }

      return jsonResponse({
        success: true,
        challenge_ts: new Date().toISOString(),
        hostname: 'passwordless.example.test',
        action: 'auth_magic_link'
      })
    })
    vi.stubGlobal('fetch', siteverify)

    const deliveriesBefore = fixture.deliveries.length
    const verificationsBefore = count('verification')
    for (const token of [undefined, 'x'.repeat(2_049)]) {
      const headers = token === undefined ? undefined : { [turnstileHeaderName]: token }
      const response = await fixture.auth.handler(
        authRequest('/api/auth/sign-in/magic-link', {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...magicLinkBody('bounded-challenge@example.test'), turnstileToken: 'body-token' })
        })
      )
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'TURNSTILE_CHALLENGE_REJECTED' })
    }
    expect(siteverify).not.toHaveBeenCalled()
    expect(fixture.deliveries.length).toBe(deliveriesBefore)
    expect(count('verification')).toBe(verificationsBefore)

    const rejected = await fixture.auth.handler(
      authRequest('/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: { [turnstileHeaderName]: 'provider-rejected-token' },
        body: JSON.stringify(magicLinkBody('rejected-challenge@example.test'))
      })
    )
    expect(rejected.status).toBe(400)
    const rejectedBody = await rejected.text()
    expect(rejectedBody).toContain('TURNSTILE_CHALLENGE_REJECTED')
    expect(rejectedBody).not.toMatch(/private-provider|provider-rejected-token/i)

    const unavailable = await fixture.auth.handler(
      authRequest('/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: { [turnstileHeaderName]: 'provider-unavailable-token' },
        body: JSON.stringify(magicLinkBody('unavailable-challenge@example.test'))
      })
    )
    expect(unavailable.status).toBe(503)
    const unavailableBody = await unavailable.text()
    expect(unavailableBody).toContain('TURNSTILE_UNAVAILABLE')
    expect(unavailableBody).not.toMatch(/private-provider|provider-unavailable-token/i)
    expect(fixture.deliveries.length).toBe(deliveriesBefore)
    expect(count('verification')).toBe(verificationsBefore)

    const accepted = await fixture.auth.handler(
      authRequest('/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: { [turnstileHeaderName]: 'accepted-challenge-token' },
        body: JSON.stringify(magicLinkBody('accepted-challenge@example.test'))
      })
    )
    expect(accepted.status).toBe(200)
    expect(fixture.deliveries.length).toBe(deliveriesBefore + 1)
    expect(count('verification')).toBe(verificationsBefore + 1)

    const acceptedRequest = siteverify.mock.calls.at(-1)
    const acceptedBody = new URLSearchParams(String(acceptedRequest?.[1]?.body))
    expect(acceptedBody.get('response')).toBe('accepted-challenge-token')
    expect(acceptedBody.has('remoteip')).toBe(false)
    expect(acceptedBody.get('idempotency_key')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('keeps Better Auth request limiting ahead of Turnstile verification', async () => {
    const siteverify = vi.fn(async () =>
      jsonResponse({
        success: true,
        challenge_ts: new Date().toISOString(),
        hostname: 'passwordless.example.test',
        action: 'auth_magic_link'
      })
    )
    vi.stubGlobal('fetch', siteverify)

    const statuses: number[] = []
    for (let index = 0; index < 6; index += 1) {
      const response = await fixture.auth.handler(
        authRequest(
          '/api/auth/sign-in/magic-link',
          {
            method: 'POST',
            headers: { [turnstileHeaderName]: `rate-limited-challenge-${index}` },
            body: JSON.stringify(magicLinkBody('turnstile-rate-limit@example.test'))
          },
          '198.51.100.90'
        )
      )
      statuses.push(response.status)
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429])
    expect(siteverify).toHaveBeenCalledTimes(5)
  })

  it('rejects an invalid application request before consuming its Turnstile challenge', async () => {
    const siteverify = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', siteverify)
    const deliveriesBefore = fixture.deliveries.length
    const verificationsBefore = count('verification')

    const response = await fixture.auth.handler(
      authRequest('/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: {
          origin: 'https://attacker.invalid',
          [turnstileHeaderName]: 'unconsumed-hostile-origin-challenge'
        },
        body: JSON.stringify(magicLinkBody('turnstile-origin-policy@example.test'))
      })
    )

    expect(response.status).toBe(403)
    expect(siteverify).not.toHaveBeenCalled()
    expect(fixture.deliveries.length).toBe(deliveriesBefore)
    expect(count('verification')).toBe(verificationsBefore)
  })

  it('rejects hostile origins and unsafe return paths before email delivery or token creation', async () => {
    const email = 'origin-policy@example.test'
    const hostile = await fixture.auth.handler(
      authRequest(
        '/api/auth/sign-in/magic-link',
        {
          method: 'POST',
          headers: {
            origin: 'https://attacker.invalid',
            'x-forwarded-host': 'attacker.invalid',
            'x-forwarded-proto': 'https'
          },
          body: JSON.stringify(magicLinkBody(email))
        },
        '198.51.100.10'
      )
    )
    expect(hostile.status).toBe(403)
    expect(hostile.headers.getSetCookie().length).toBe(0)

    const disallowed = await fixture.auth.handler(
      authRequest('/api/auth/sign-in/magic-link', {
        method: 'POST',
        body: JSON.stringify({ ...magicLinkBody(email), callbackURL: '/billing' })
      })
    )
    expect(disallowed.status).toBe(400)
    expect(await disallowed.json()).toMatchObject({ code: 'INVALID_REQUEST' })

    const foreign = await fixture.auth.handler(
      authRequest('/api/auth/sign-in/magic-link', {
        method: 'POST',
        body: JSON.stringify({ ...magicLinkBody(email), callbackURL: 'https://attacker.invalid/callback' })
      })
    )
    expect(foreign.status).toBe(403)
    expect(await foreign.json()).toMatchObject({ code: 'INVALID_CALLBACK_URL' })

    for (const omitted of ['callbackURL', 'newUserCallbackURL', 'errorCallbackURL'] as const) {
      const body = Object.fromEntries(Object.entries(magicLinkBody(email)).filter(([key]) => key !== omitted))
      const response = await fixture.auth.handler(
        authRequest('/api/auth/sign-in/magic-link', {
          method: 'POST',
          body: JSON.stringify(body)
        })
      )
      expect(response.status, omitted).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'INVALID_REQUEST' })
    }

    for (const callbacks of [
      { callbackURL: '/login' },
      { newUserCallbackURL: '/signup' },
      { errorCallbackURL: '/app' },
      { errorCallbackURL: '/account' },
      { callbackURL: '/auth' },
      { newUserCallbackURL: '/auth' },
      { errorCallbackURL: '/auth' }
    ]) {
      const response = await fixture.auth.handler(
        authRequest('/api/auth/sign-in/magic-link', {
          method: 'POST',
          body: JSON.stringify({ ...magicLinkBody(email), ...callbacks })
        })
      )
      expect(response.status, JSON.stringify(callbacks)).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'INVALID_REQUEST' })
    }

    expect(fixture.deliveries.length).toBe(0)
    expect(count('verification')).toBe(0)
  })

  it('stores only a five-minute token hash and rejects callbacks without consuming it', async () => {
    const issued = await issueMagicLink('hashed-token@example.test', {
      'x-forwarded-host': 'attacker.invalid',
      'x-forwarded-proto': 'http'
    })
    expect(issued.response.status).toBe(200)
    expect(issued.body).toBe('{"status":true}')
    expect(issued.message.to).toBe('hashed-token@example.test')
    expect(issued.url.origin).toBe(baseURL)

    const stored = issued.verification
    expect(stored.identifier !== issued.token).toBe(true)
    expect(!stored.value.includes(issued.token)).toBe(true)
    const nowSeconds = Date.now() / 1_000
    expect(stored.expiresAt).toBeGreaterThanOrEqual(nowSeconds + 295)
    expect(stored.expiresAt).toBeLessThanOrEqual(nowSeconds + 305)

    for (const omitted of ['callbackURL', 'newUserCallbackURL', 'errorCallbackURL'] as const) {
      const incomplete = new URL(issued.url)
      incomplete.searchParams.delete(omitted)
      const response = await fixture.auth.handler(authRequest(incomplete))
      expect(response.status, omitted).toBe(400)
      expect(findVerification(issued.verification.identifier)).not.toBeNull()
    }

    for (const callbackURL of ['//attacker.invalid/callback', '/billing']) {
      const unsafe = new URL(issued.url)
      unsafe.searchParams.set('callbackURL', callbackURL)
      const response = await fixture.auth.handler(authRequest(unsafe))
      expect(response.status).toBe(400)
      expect(findVerification(issued.verification.identifier)).not.toBeNull()
    }
  })

  it('consumes a token atomically, rejects replay and expiry, and preserves session cookie policy', async () => {
    const email = 'session-owner@example.test'
    const issued = await issueMagicLink(email)
    const [left, right] = await Promise.all([
      fixture.auth.handler(authRequest(issued.url, {}, '198.51.100.20')),
      fixture.auth.handler(authRequest(issued.url, {}, '198.51.100.21'))
    ])
    const outcomes = [left, right].map(redirectOutcome)
    expect(outcomes.filter((outcome) => outcome.error === undefined).length).toBe(1)
    expect(outcomes.filter((outcome) => outcome.error === 'INVALID_TOKEN').length).toBe(1)
    expect(findVerification(issued.verification.identifier)).toBeNull()
    expect(countWhere('user', 'email', email)).toBe(1)
    expect(fixture.sqlite.prepare('select role from user where email = ?').get(email)).toEqual({ role: 'user' })
    expect(sessionCount(email)).toBe(1)

    const accepted = outcomes.find((outcome) => outcome.error === undefined)!.response
    assertSessionCookie(accepted)
    const sessionHeaders = convertSetCookieToCookie(new Headers(accepted.headers))
    expect(await sessionEmail(sessionHeaders)).toBe(email)

    const replay = await fixture.auth.handler(authRequest(issued.url, {}, '198.51.100.22'))
    expect(redirectOutcome(replay).error).toBe('INVALID_TOKEN')
    expect(sessionCount(email)).toBe(1)

    const rejectedSignOut = await fixture.auth.handler(
      authRequest('/api/auth/sign-out', {
        method: 'POST',
        headers: { ...Object.fromEntries(sessionHeaders), origin: 'https://attacker.invalid' },
        body: '{}'
      })
    )
    expect(rejectedSignOut.status).toBe(403)
    expect(rejectedSignOut.headers.getSetCookie().length).toBe(0)
    expect(await sessionEmail(sessionHeaders)).toBe(email)

    const signOut = await fixture.auth.handler(
      authRequest('/api/auth/sign-out', {
        method: 'POST',
        headers: sessionHeaders,
        body: '{}'
      })
    )
    expect(signOut.status).toBe(200)
    expect(await sessionEmail(sessionHeaders)).toBeNull()

    const restored = await issueMagicLink(email)
    const restoredResponse = await fixture.auth.handler(authRequest(restored.url, {}, '198.51.100.23'))
    expect(redirectOutcome(restoredResponse).error).toBeUndefined()
    assertSessionCookie(restoredResponse)

    const expiring = await issueMagicLink('expired-token@example.test')
    fixture.sqlite
      .prepare('update verification set expires_at = ? where identifier = ?')
      .run(Math.floor(Date.now() / 1_000) - 1, expiring.verification.identifier)
    const sessionCountBefore = count('session')
    const expired = await fixture.auth.handler(authRequest(expiring.url, {}, '198.51.100.24'))
    expect(redirectOutcome(expired).error).toBe('INVALID_TOKEN')
    expect(findVerification(expiring.verification.identifier)).toBeNull()
    expect(count('session')).toBe(sessionCountBefore)
  })

  it('keeps known and unknown responses identical and normalizes sender failure', async () => {
    insertExistingIdentity('known@example.test')
    const known = await issueMagicLink('known@example.test')
    const unknown = await issueMagicLink('unknown@example.test')
    expect(known.response.status).toBe(unknown.response.status)
    expect(known.body).toBe(unknown.body)
    expect(known.body).toBe('{"status":true}')

    const deliveryEmail = 'private-delivery@example.test'
    const providerDetail = 'smtp-private-provider-detail'
    fixture.deliveryFailure = new Error(providerDetail)
    const failed = await fixture.auth.handler(
      authRequest('/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: { [turnstileHeaderName]: `delivery-failure-${randomUUID()}` },
        body: JSON.stringify(magicLinkBody(deliveryEmail))
      })
    )
    expect(failed.status).toBe(503)
    const serialized = await failed.text()
    expect(serialized).not.toMatch(/private-delivery|smtp-private|capture|filesystem/i)
  })

  it('keeps password, social, and OIDC registration surfaces absent through the configured handler', async () => {
    expect(await sessionEmail(new Headers())).toBeNull()
    const paths = [
      ['/api/auth/sign-up/email', 'POST'],
      ['/api/auth/sign-in/email', 'POST'],
      ['/api/auth/request-password-reset', 'POST'],
      ['/api/auth/reset-password', 'POST'],
      ['/api/auth/reset-password/private-token', 'GET'],
      ['/api/auth/change-password', 'POST'],
      ['/api/auth/verify-password', 'POST'],
      ['/api/auth/sign-in/social', 'POST'],
      ['/api/auth/callback/google', 'GET'],
      ['/api/auth/link-social', 'POST'],
      ['/api/auth/list-accounts', 'GET'],
      ['/api/auth/unlink-account', 'POST'],
      ['/api/auth/get-access-token', 'POST'],
      ['/api/auth/refresh-token', 'POST'],
      ['/api/auth/account-info', 'POST'],
      ['/api/auth/oauth2/register', 'POST']
    ] as const

    for (const [path, method] of paths) {
      const response = await fixture.auth.handler(
        authRequest(path, {
          method,
          body:
            method === 'POST'
              ? JSON.stringify({ email: 'legacy@example.test', password: 'DisabledPassword123!' })
              : undefined
        })
      )
      expect(response.status, `${method} ${path}`).toBe(404)
      expect(response.headers.getSetCookie().length).toBe(0)
    }
    expect(fixture.sqlite.prepare('select count(*) as count from account where password is not null').get()).toEqual({
      count: 0
    })
  })

  it('uses trusted single-valued client addresses and limits before sender or token work', async () => {
    const requestEmail = 'request-rate@example.test'
    const capturesBefore = fixture.deliveries.length
    const verificationsBefore = count('verification')
    const requestStatuses: number[] = []
    for (let index = 0; index < 6; index += 1) {
      const response = await fixture.auth.handler(
        authRequest(
          '/api/auth/sign-in/magic-link',
          {
            method: 'POST',
            headers: {
              [turnstileHeaderName]: `request-rate-${index}-${randomUUID()}`,
              'x-forwarded-for': `203.0.113.${80 + index}, 10.0.0.2`,
              'x-real-ip': `192.0.2.${40 + index}`
            },
            body: JSON.stringify(magicLinkBody(requestEmail))
          },
          '198.51.100.40'
        )
      )
      requestStatuses.push(response.status)
      if (index === 5) expect(Number(response.headers.get('x-retry-after'))).toBeGreaterThan(0)
    }
    expect(requestStatuses).toEqual([200, 200, 200, 200, 200, 429])
    expect(fixture.deliveries.length).toBe(capturesBefore + 5)
    expect(count('verification')).toBe(verificationsBefore + 5)

    const separateClient = await fixture.auth.handler(
      authRequest(
        '/api/auth/sign-in/magic-link',
        {
          method: 'POST',
          headers: { [turnstileHeaderName]: `separate-client-${randomUUID()}` },
          body: JSON.stringify(magicLinkBody(requestEmail))
        },
        '198.51.100.41'
      )
    )
    expect(separateClient.status).toBe(200)

    const valid = await issueMagicLink('verification-rate@example.test', {}, '198.51.100.50')
    for (let index = 0; index < 5; index += 1) {
      const invalid = new URL('/api/auth/magic-link/verify', baseURL)
      invalid.searchParams.set('token', `invalid-rate-token-${index}`)
      invalid.searchParams.set('callbackURL', '/app')
      invalid.searchParams.set('newUserCallbackURL', '/app')
      invalid.searchParams.set('errorCallbackURL', '/login')
      const response = await fixture.auth.handler(authRequest(invalid, {}, '198.51.100.60'))
      expect(redirectOutcome(response).error).toBe('INVALID_TOKEN')
    }
    const limited = await fixture.auth.handler(authRequest(valid.url, {}, '198.51.100.60'))
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('x-retry-after'))).toBeGreaterThan(0)
    expect(findVerification(valid.verification.identifier)).not.toBeNull()
    const accepted = await fixture.auth.handler(authRequest(valid.url, {}, '198.51.100.61'))
    expect(redirectOutcome(accepted).error).toBeUndefined()
    expect(findVerification(valid.verification.identifier)).toBeNull()

    const malformedCapturesBefore = fixture.deliveries.length
    const malformedVerificationsBefore = count('verification')
    const malformedStatuses: number[] = []
    for (let index = 0; index < 6; index += 1) {
      const response = await fixture.auth.handler(
        authRequest(
          '/api/auth/sign-in/magic-link',
          {
            method: 'POST',
            headers: { [turnstileHeaderName]: `malformed-rate-${index}-${randomUUID()}` },
            body: JSON.stringify(magicLinkBody('malformed-rate@example.test'))
          },
          `198.51.100.${70 + index}, 10.0.0.2`
        )
      )
      malformedStatuses.push(response.status)
    }
    expect(malformedStatuses).toEqual([200, 200, 200, 200, 200, 429])
    expect(fixture.deliveries.length).toBe(malformedCapturesBefore + 5)
    expect(count('verification')).toBe(malformedVerificationsBefore + 5)
  })
})

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'swl-passwordless-http-'))
  const databasePath = join(directory, 'fixture.sqlite')
  const sqlite = new Database(databasePath)
  try {
    sqlite.pragma('foreign_keys = ON')
    migrate(drizzle({ client: sqlite }), { migrationsFolder })
    const connection = { sqlite, db: drizzle({ client: sqlite, schema }), databasePath }
    const deliveries: TransactionalEmailMessage[] = []
    const state: { deliveryFailure?: Error } = {}
    const auth = createAuthentication(testRuntimeConfig(), connection, () => ({
      async send(message) {
        if (state.deliveryFailure) throw state.deliveryFailure
        deliveries.push(message)
      }
    }))

    return {
      auth,
      deliveries,
      sqlite,
      set deliveryFailure(error: Error | undefined) {
        state.deliveryFailure = error
      },
      cleanup() {
        sqlite.close()
        rmSync(directory, { recursive: true, force: true })
      }
    }
  } catch (error) {
    sqlite.close()
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
}

function testRuntimeConfig(): AppRuntimeConfig {
  return {
    betterAuth: { secret: 'passwordless-http-secret-with-32-characters', url: baseURL },
    cloudflare: { turnstile: { secretKey: '1x0000000000000000000000000000000AA' } },
    public: {
      appName: 'Passwordless HTTP Test',
      appUrl: baseURL,
      turnstileSiteKey: '1x00000000000000000000AA'
    },
    stripe: {
      membershipDues10PriceId: 'price_passwordless_membership_10',
      solidarityDues27PriceId: 'price_passwordless_solidarity_27'
    }
  } as AppRuntimeConfig
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function successfulSiteverify() {
  return Promise.resolve(
    jsonResponse({
      success: true,
      challenge_ts: new Date().toISOString(),
      hostname: 'passwordless.example.test',
      action: 'auth_magic_link'
    })
  )
}

async function issueMagicLink(
  email: string,
  headers: Record<string, string> = {},
  clientIp = nextUniqueClientIp(),
  requestBody: Record<string, unknown> = magicLinkBody(email)
) {
  const deliveryIndex = fixture.deliveries.length
  const verificationIdsBefore = new Set(verificationRows().map((row) => row.identifier))
  const response = await fixture.auth.handler(
    authRequest(
      '/api/auth/sign-in/magic-link',
      {
        method: 'POST',
        headers: { [turnstileHeaderName]: `issue-${randomUUID()}`, ...headers },
        body: JSON.stringify(requestBody)
      },
      clientIp
    )
  )
  const body = await response.text()
  expect(fixture.deliveries.length).toBe(deliveryIndex + 1)
  const message = fixture.deliveries[deliveryIndex]
  if (!message) throw new Error('Expected one fake-provider magic-link delivery')
  const link = message.text.match(/https?:\/\/\S+/)?.[0]
  if (!link) throw new Error('Expected the fake-provider message to contain a link')
  const url = new URL(link)
  const token = url.searchParams.get('token')
  if (!token) throw new Error('Expected the magic-link URL to contain a token')
  const newVerifications = verificationRows().filter((row) => !verificationIdsBefore.has(row.identifier))
  expect(newVerifications.length).toBe(1)
  const verification = newVerifications[0]
  if (!verification) throw new Error('Expected one verification record for the delivered link')
  return { response, body, message, token, url, verification }
}

function magicLinkBody(email: string) {
  return {
    email,
    callbackURL: '/app',
    newUserCallbackURL: '/app',
    errorCallbackURL: '/login'
  }
}

function seedPaidPublicJoin(email: string): string {
  const id = `join_checkout_${randomUUID()}`
  const timestamp = new Date()
  fixture.sqlite
    .prepare(
      `insert into public_join_attempts (
         id, plan_key, cadence, stripe_price_id, stripe_session_id, idempotency_key, state,
         success_url, cancel_url, stripe_customer_id, stripe_subscription_id,
         stripe_subscription_item_id, subscription_status, current_period_start,
         current_period_end, projection_event_id, email, claim_expires_at
       ) values (?, 'personal', 'monthly', 'price_passwordless_membership_10', ?, ?, 'paid',
         ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      `cs_${randomUUID()}`,
      `public-join-auth-${randomUUID()}`,
      `${baseURL}/join/complete?id=${id}`,
      `${baseURL}/join`,
      `cus_${randomUUID()}`,
      `sub_${randomUUID()}`,
      `si_${randomUUID()}`,
      new Date(timestamp.getTime() - 60_000).toISOString(),
      new Date(timestamp.getTime() + 30 * 24 * 60 * 60 * 1_000).toISOString(),
      `evt_${randomUUID()}`,
      email,
      new Date(timestamp.getTime() + 60 * 60 * 1_000).toISOString()
    )
  return id
}

function profileRow(email: string) {
  return fixture.sqlite
    .prepare(
      'select name, first_name as firstName, last_name as lastName, display_name as displayName from user where email = ?'
    )
    .get(email)
}

function authRequest(url: string | URL, init: RequestInit = {}, clientIp = nextUniqueClientIp()) {
  const headers = new Headers(init.headers)
  headers.set('cf-connecting-ip', clientIp)
  if (init.body !== undefined) {
    headers.set('content-type', 'application/json')
    if (!headers.has('origin')) headers.set('origin', baseURL)
  }
  return new Request(new URL(url, baseURL), { ...init, headers, redirect: 'manual' })
}

function nextUniqueClientIp() {
  return `2001:db8:${(nextClientIp++).toString(16)}::1`
}

function verificationRows() {
  return fixture.sqlite.prepare('select identifier, value, expires_at as expiresAt from verification').all() as Array<{
    identifier: string
    value: string
    expiresAt: number
  }>
}

function findVerification(identifier: string) {
  return verificationRows().find((row) => row.identifier === identifier) ?? null
}

function redirectOutcome(response: Response) {
  const location = response.headers.get('location')
  if (response.status !== 302 || !location) throw new Error(`Expected redirect response, received ${response.status}`)
  const target = new URL(location, baseURL)
  expect(target.origin).toBe(baseURL)
  const error = target.searchParams.get('error') ?? undefined
  expect(target.pathname).toBe(error ? '/login' : '/app')
  return { error, response }
}

function assertSessionCookie(response: Response) {
  const cookie = response.headers.getSetCookie().find((value) => value.includes('session_token='))
  expect(Boolean(cookie?.startsWith('__Secure-'))).toBe(true)
  const attributes = new Set(
    (cookie ?? '')
      .split(';')
      .slice(1)
      .map((attribute) => attribute.trim().toLowerCase())
  )
  for (const attribute of ['httponly', 'path=/', 'samesite=lax', 'secure']) {
    expect(attributes.has(attribute)).toBe(true)
  }
  expect([...attributes].some((attribute) => attribute.startsWith('domain='))).toBe(false)
}

async function sessionEmail(headers: Headers) {
  const response = await fixture.auth.handler(authRequest('/api/auth/get-session', { headers }))
  expect(response.status).toBe(200)
  const body = (await response.json()) as null | { user: { email: string } }
  return body?.user.email ?? null
}

function insertExistingIdentity(email: string) {
  const userId = `existing-user-${randomUUID()}`
  const now = Math.floor(Date.now() / 1_000)
  fixture.sqlite
    .prepare('insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)')
    .run(userId, 'Existing User', email, now, now)
}

function count(table: 'session' | 'verification') {
  return (fixture.sqlite.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count
}

function countWhere(table: string, column: string, value: string, suffix = '') {
  return (
    fixture.sqlite.prepare(`select count(*) as count from ${table} where ${column} = ? ${suffix}`).get(value) as {
      count: number
    }
  ).count
}

function sessionCount(email: string) {
  return (
    fixture.sqlite
      .prepare('select count(*) as count from session join user on user.id = session.user_id where user.email = ?')
      .get(email) as { count: number }
  ).count
}
