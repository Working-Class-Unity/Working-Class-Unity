import { afterEach, describe, expect, it, vi } from 'vitest'
import { convertSetCookieToCookie, getTestInstance } from 'better-auth/test'
import type { AppRuntimeConfig } from '../server/utils/runtime'
import { createBetterAuthSecurityOptions, createRedactedBetterAuthLogger } from '../server/utils/auth/security'
import {
  createAuthenticationBeforeHook,
  createSocialDatabaseHooks,
  createSocialProviders,
  disabledSocialAuthPaths,
  socialAccountOptions
} from '../server/utils/auth/social'

const baseURL = 'http://localhost:3000'
const tokenEndpoint = 'https://oauth2.googleapis.com/token'
const clientId = 'social-test.apps.googleusercontent.com'
const clientSecret = 'social-test-client-secret-sentinel'
let nextClientIpOctet = 10

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('social authentication policy', () => {
  it('rejects missing, parameter-swapped, and retired callback destinations before OAuth state creation', async () => {
    const fixture = await createFixture()

    for (const omitted of ['callbackURL', 'newUserCallbackURL', 'errorCallbackURL'] as const) {
      const body = Object.fromEntries(
        Object.entries({
          provider: 'google',
          callbackURL: '/app',
          newUserCallbackURL: '/app',
          errorCallbackURL: '/login',
          disableRedirect: true
        }).filter(([key]) => key !== omitted)
      )
      const response = await requestSocialSignIn(fixture, body)

      expect(response.status, omitted).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'INVALID_REQUEST' })
      expect(response.headers.getSetCookie()).toEqual([])
      expect(await fixture.db.findMany({ model: 'verification' })).toHaveLength(0)
    }

    for (const overrides of [
      { callbackURL: '/login' },
      { newUserCallbackURL: '/signup' },
      { errorCallbackURL: '/app' },
      { errorCallbackURL: '/invite/Invite_123-opaque' },
      { callbackURL: '/auth' },
      { newUserCallbackURL: '/auth' },
      { errorCallbackURL: '/auth' },
      { scopes: ['https://www.googleapis.com/auth/drive'] },
      { idToken: { token: 'raw-id-token' } },
      { requestSignUp: true },
      { loginHint: 'person@example.test' },
      { additionalData: { source: 'unowned' } }
    ]) {
      const response = await requestSocialSignIn(fixture, {
        provider: 'google',
        callbackURL: '/app',
        newUserCallbackURL: '/app',
        errorCallbackURL: '/login',
        disableRedirect: true,
        ...overrides
      })

      expect(response.status, JSON.stringify(overrides)).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'INVALID_REQUEST' })
      expect(response.headers.getSetCookie()).toEqual([])
      expect(await fixture.db.findMany({ model: 'verification' })).toHaveLength(0)
    }
  })

  it('completes one verified authorization-code flow without retaining provider tokens', async () => {
    const fixture = await createFixture()
    const email = 'verified-social@example.test'
    installGoogleTokenEndpoint({
      validCode: 'verified-code',
      subject: 'google-subject-verified',
      email,
      emailVerified: true
    })

    const authorization = await beginGoogleSignIn(fixture.auth)
    expect(authorization.url.origin).toBe('https://accounts.google.com')
    expect(authorization.url.pathname).toBe('/o/oauth2/v2/auth')
    expect(authorization.url.searchParams.get('client_id')).toBe(clientId)
    expect(authorization.url.searchParams.get('redirect_uri')).toBe(`${baseURL}/api/auth/callback/google`)
    expect(authorization.url.searchParams.get('scope')).toBe('openid email')
    expect(authorization.url.searchParams.get('access_type')).toBe('online')
    expect(authorization.url.searchParams.get('include_granted_scopes')).toBe('true')
    expect(authorization.url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorization.url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(authorization.url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(authorization.url.toString()).not.toContain(clientSecret)
    expect(await fixture.db.findMany({ model: 'verification' })).toHaveLength(1)

    const callback = await completeGoogleCallback(fixture.auth, authorization, 'verified-code')
    expect(callback.response.status).toBe(302)
    expect(new URL(callback.response.headers.get('location')!, baseURL).pathname).toBe('/app')
    expect(await fixture.db.findMany({ model: 'verification' })).toHaveLength(0)

    const users = await fixture.db.findMany({ model: 'user' })
    const accounts = await fixture.db.findMany({ model: 'account' })
    const sessions = await fixture.db.findMany({ model: 'session' })
    expect(users).toHaveLength(1)
    expect(users[0]).toMatchObject({ email, emailVerified: true, name: email })
    expect(accounts).toHaveLength(1)
    expect(accounts[0]).toMatchObject({
      providerId: 'google',
      accountId: 'google-subject-verified',
      userId: users[0]!.id,
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scope: 'openid,email'
    })
    expect(sessions).toHaveLength(1)

    const listed = await fixture.auth.handler(
      new Request(`${baseURL}/api/auth/list-accounts`, { headers: callback.sessionHeaders })
    )
    expect(listed.status).toBe(200)
    const listedText = await listed.text()
    expect(JSON.parse(listedText)).toEqual([
      expect.objectContaining({ providerId: 'google', accountId: 'google-subject-verified' })
    ])
    for (const forbidden of ['access-token-sentinel', 'refresh-token-sentinel', 'id-token-sentinel', clientSecret]) {
      expect(listedText).not.toContain(forbidden)
      expect(fixture.logs.join('\n')).not.toContain(forbidden)
    }

    await fixture.db.create({
      model: 'account',
      data: {
        accountId: 'google-subject-second',
        providerId: 'google',
        userId: users[0]!.id,
        accessToken: null,
        refreshToken: null,
        idToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        scope: 'openid,email',
        password: null,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    })
    expect(await fixture.db.findMany({ model: 'account' })).toHaveLength(2)

    const replay = await completeGoogleCallback(fixture.auth, authorization, 'verified-code')
    expect(replay.response.status).toBe(302)
    expect(await fixture.db.findMany({ model: 'session' })).toHaveLength(1)

    const unlinkHeaders = new Headers(callback.sessionHeaders)
    unlinkHeaders.set('content-type', 'application/json')
    unlinkHeaders.set('origin', baseURL)
    await fixture.db.update({
      model: 'session',
      where: [{ field: 'id', value: sessions[0]!.id }],
      update: { createdAt: new Date(Date.now() - 24 * 60 * 60 * 1_000 - 1) }
    })
    const staleUnlink = await fixture.auth.handler(
      new Request(`${baseURL}/api/auth/unlink-account`, {
        method: 'POST',
        headers: unlinkHeaders,
        body: JSON.stringify({ providerId: 'google', accountId: 'google-subject-verified' })
      })
    )
    expect(staleUnlink.status).toBe(403)
    expect(await staleUnlink.json()).toMatchObject({ code: 'SESSION_NOT_FRESH' })
    expect(await fixture.db.findMany({ model: 'account' })).toHaveLength(2)

    await fixture.db.update({
      model: 'session',
      where: [{ field: 'id', value: sessions[0]!.id }],
      update: { createdAt: new Date() }
    })
    const unlinked = await fixture.auth.handler(
      new Request(`${baseURL}/api/auth/unlink-account`, {
        method: 'POST',
        headers: unlinkHeaders,
        body: JSON.stringify({ providerId: 'google', accountId: 'google-subject-verified' })
      })
    )
    expect(unlinked.status).toBe(200)
    expect(await unlinked.json()).toEqual({ status: true })
    expect(await fixture.db.findMany({ model: 'account' })).toEqual([
      expect.objectContaining({ providerId: 'google', accountId: 'google-subject-second' })
    ])

    const secondUnlink = await fixture.auth.handler(
      new Request(`${baseURL}/api/auth/unlink-account`, {
        method: 'POST',
        headers: unlinkHeaders,
        body: JSON.stringify({ providerId: 'google', accountId: 'google-subject-second' })
      })
    )
    expect(secondUnlink.status).toBe(200)
    expect(await secondUnlink.json()).toEqual({ status: true })
    expect(await fixture.db.findMany({ model: 'account' })).toHaveLength(0)
    expect(await fixture.db.findMany({ model: 'user' })).toHaveLength(1)
    expect(await fixture.db.findMany({ model: 'session' })).toHaveLength(1)
  })

  it('links a verified Google identity only into an already-verified same-email user', async () => {
    const fixture = await createFixture()
    const email = 'verified-local@example.test'
    const context = await fixture.auth.$context
    const localUser = await context.internalAdapter.createUser({
      email,
      emailVerified: true,
      name: 'Verified Local'
    })
    installGoogleTokenEndpoint({
      validCode: 'link-code',
      subject: 'google-subject-link',
      email,
      emailVerified: true
    })

    const authorization = await beginGoogleSignIn(fixture.auth)
    const callback = await completeGoogleCallback(fixture.auth, authorization, 'link-code')

    expect(callback.response.status).toBe(302)
    expect(await fixture.db.findMany({ model: 'user' })).toHaveLength(1)
    expect(await fixture.db.findMany({ model: 'account' })).toEqual([
      expect.objectContaining({ providerId: 'google', accountId: 'google-subject-link', userId: localUser!.id })
    ])
  })

  it('rejects an unverified provider identity without leaving user, account, or session state', async () => {
    const fixture = await createFixture()
    installGoogleTokenEndpoint({
      validCode: 'unverified-code',
      subject: 'google-subject-unverified',
      email: 'unverified-social@example.test',
      emailVerified: false
    })

    const authorization = await beginGoogleSignIn(fixture.auth)
    const callback = await completeGoogleCallback(fixture.auth, authorization, 'unverified-code')

    expect(callback.response.status).toBe(302)
    expect(new URL(callback.response.headers.get('location')!, baseURL).pathname).toBe('/login')
    expect(await fixture.db.findMany({ model: 'verification' })).toHaveLength(0)
    expect(await fixture.db.findMany({ model: 'user' })).toHaveLength(0)
    expect(await fixture.db.findMany({ model: 'account' })).toHaveLength(0)
    expect(await fixture.db.findMany({ model: 'session' })).toHaveLength(0)
    expect(fixture.logs).toContain('[better-auth] error event')
    expect(fixture.logs.join('\n')).not.toContain('unverified-social@example.test')
  })

  it('does not implicitly link a verified provider identity to a locally unverified email', async () => {
    const fixture = await createFixture()
    const email = 'unverified-local@example.test'
    const localUser = await fixture.db.create({
      model: 'user',
      data: {
        email,
        emailVerified: false,
        name: 'Unverified Local',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    })
    installGoogleTokenEndpoint({
      validCode: 'unverified-local-code',
      subject: 'google-subject-unverified-local',
      email,
      emailVerified: true
    })

    const authorization = await beginGoogleSignIn(fixture.auth)
    const callback = await completeGoogleCallback(fixture.auth, authorization, 'unverified-local-code')

    expect(callback.response.status).toBe(302)
    expect(await fixture.db.findMany({ model: 'user' })).toEqual([expect.objectContaining({ id: localUser!.id })])
    expect(await fixture.db.findMany({ model: 'account' })).toHaveLength(0)
    expect(await fixture.db.findMany({ model: 'session' })).toHaveLength(0)
  })

  it('does not implicitly link an unverified provider identity to a locally verified email', async () => {
    const fixture = await createFixture()
    const email = 'verified-local-unverified-provider@example.test'
    const context = await fixture.auth.$context
    const localUser = await context.internalAdapter.createUser({
      email,
      emailVerified: true,
      name: 'Verified Local'
    })
    installGoogleTokenEndpoint({
      validCode: 'unverified-provider-link-code',
      subject: 'google-subject-unverified-provider-link',
      email,
      emailVerified: false
    })

    const authorization = await beginGoogleSignIn(fixture.auth)
    const callback = await completeGoogleCallback(fixture.auth, authorization, 'unverified-provider-link-code')

    expect(callback.response.status).toBe(302)
    expect(await fixture.db.findMany({ model: 'user' })).toEqual([expect.objectContaining({ id: localUser!.id })])
    expect(await fixture.db.findMany({ model: 'account' })).toHaveLength(0)
    expect(await fixture.db.findMany({ model: 'session' })).toHaveLength(0)
  })

  it('cleans failed provider callbacks and cascades a linked account when its user is deleted', async () => {
    const fixture = await createFixture()
    installGoogleTokenEndpoint({
      validCode: 'different-code',
      subject: 'google-subject-cleanup',
      email: 'cleanup-social@example.test',
      emailVerified: true
    })

    const rejectedAuthorization = await beginGoogleSignIn(fixture.auth)
    const rejected = await completeGoogleCallback(fixture.auth, rejectedAuthorization, 'revoked-code')
    expect(rejected.response.status).toBe(302)
    expect(await fixture.db.findMany({ model: 'verification' })).toHaveLength(0)
    expect(await fixture.db.findMany({ model: 'user' })).toHaveLength(0)
    expect(await fixture.db.findMany({ model: 'account' })).toHaveLength(0)
    expect(await fixture.db.findMany({ model: 'session' })).toHaveLength(0)

    const deletionFixture = await createFixture()
    installGoogleTokenEndpoint({
      validCode: 'accepted-cleanup-code',
      subject: 'google-subject-cleanup',
      email: 'cleanup-social@example.test',
      emailVerified: true
    })
    const acceptedAuthorization = await beginGoogleSignIn(deletionFixture.auth)
    const accepted = await completeGoogleCallback(deletionFixture.auth, acceptedAuthorization, 'accepted-cleanup-code')
    expect(accepted.response.status).toBe(302)
    const [user] = await deletionFixture.db.findMany({ model: 'user' })
    expect(user).toBeDefined()
    expect(await deletionFixture.db.findMany({ model: 'account' })).toHaveLength(1)
    expect(await deletionFixture.db.findMany({ model: 'session' })).toHaveLength(1)

    const context = await deletionFixture.auth.$context
    await context.internalAdapter.deleteUser(user!.id)
    expect(await deletionFixture.db.findMany({ model: 'user' })).toHaveLength(0)
    expect(await deletionFixture.db.findMany({ model: 'account' })).toHaveLength(0)
    expect(await deletionFixture.db.findMany({ model: 'session' })).toHaveLength(0)
  })

  it('keeps explicit linking and token/profile APIs absent', async () => {
    const fixture = await createFixture()
    for (const path of disabledSocialAuthPaths) {
      const response = await fixture.auth.handler(
        new Request(`${baseURL}/api/auth${path}`, {
          method: path === '/account-info' ? 'GET' : 'POST',
          headers: { 'content-type': 'application/json', origin: baseURL },
          body: path === '/account-info' ? undefined : '{}'
        })
      )
      expect(response.status, path).toBe(404)
    }
  })
})

function requestSocialSignIn(fixture: Awaited<ReturnType<typeof createFixture>>, body: Record<string, unknown>) {
  return fixture.auth.handler(
    new Request(`${baseURL}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: {
        'cf-connecting-ip': `198.51.100.${nextClientIpOctet++}`,
        'content-type': 'application/json',
        origin: baseURL
      },
      body: JSON.stringify(body)
    })
  )
}

async function createFixture() {
  const config = {
    betterAuth: {
      secret: 'social-test-auth-secret-with-32-characters',
      url: baseURL
    },
    socialProviders: {
      google: {
        enabled: true,
        clientId,
        clientSecret
      }
    }
  } as AppRuntimeConfig
  const logs: string[] = []
  const fixture = await getTestInstance(
    {
      ...createBetterAuthSecurityOptions(config),
      account: socialAccountOptions,
      databaseHooks: createSocialDatabaseHooks(),
      disabledPaths: [...disabledSocialAuthPaths],
      emailAndPassword: { enabled: false },
      hooks: { before: createAuthenticationBeforeHook(config) },
      logger: createRedactedBetterAuthLogger((message) => logs.push(message)),
      socialProviders: createSocialProviders(config)
    },
    { disableTestUser: true }
  )
  return { ...fixture, logs }
}

async function beginGoogleSignIn(auth: Awaited<ReturnType<typeof createFixture>>['auth']) {
  const response = await auth.handler(
    new Request(`${baseURL}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: {
        'cf-connecting-ip': `198.51.100.${nextClientIpOctet++}`,
        'content-type': 'application/json',
        origin: baseURL
      },
      body: JSON.stringify({
        provider: 'google',
        callbackURL: '/app',
        newUserCallbackURL: '/app',
        errorCallbackURL: '/login',
        disableRedirect: true
      })
    })
  )
  expect(response.status).toBe(200)
  const body = (await response.json()) as { url: string; redirect: boolean }
  expect(body.redirect).toBe(false)
  return {
    response,
    requestHeaders: convertSetCookieToCookie(new Headers(response.headers)),
    url: new URL(body.url)
  }
}

async function completeGoogleCallback(
  auth: Awaited<ReturnType<typeof createFixture>>['auth'],
  authorization: Awaited<ReturnType<typeof beginGoogleSignIn>>,
  code: string
) {
  const state = authorization.url.searchParams.get('state')!
  const response = await auth.handler(
    new Request(
      `${baseURL}/api/auth/callback/google?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`,
      {
        headers: {
          ...Object.fromEntries(authorization.requestHeaders.entries()),
          'cf-connecting-ip': `198.51.100.${nextClientIpOctet++}`
        }
      }
    )
  )
  return {
    response,
    sessionHeaders: convertSetCookieToCookie(new Headers(response.headers))
  }
}

function installGoogleTokenEndpoint(input: {
  validCode: string
  subject: string
  email: string
  emailVerified: boolean
  name?: string
}) {
  let available = true
  const fetchMock = vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
    const url = request instanceof Request ? request.url : String(request)
    if (url !== tokenEndpoint) throw new Error(`Unexpected external request: ${url}`)

    const body = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams(String(init?.body ?? ''))
    expect(body.get('client_id')).toBe(clientId)
    expect(body.get('client_secret')).toBe(clientSecret)
    expect(body.get('redirect_uri')).toBe(`${baseURL}/api/auth/callback/google`)
    expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]+$/)
    if (!available || body.get('code') !== input.validCode) {
      return Response.json({ error: 'invalid_grant' }, { status: 400 })
    }

    available = false
    return Response.json({
      access_token: 'access-token-sentinel',
      refresh_token: 'refresh-token-sentinel',
      id_token: unsignedJwt({
        sub: input.subject,
        email: input.email,
        email_verified: input.emailVerified,
        ...(input.name === undefined ? {} : { name: input.name })
      }),
      expires_in: 3600,
      refresh_token_expires_in: 7200,
      scope: 'openid email',
      token_type: 'Bearer'
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function unsignedJwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`
}
