import { convertSetCookieToCookie } from 'better-auth/test'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../server/db/schema'
import { createAuthentication } from '../server/utils/auth/create'
import type { AppRuntimeConfig } from '../server/utils/runtime'

const baseURL = 'http://localhost:3000'
const tokenEndpoint = 'https://oauth2.googleapis.com/token'
const googleClientId = 'organization-provisioning.apps.googleusercontent.com'
const googleClientSecret = 'organization-provisioning-client-secret'
let nextClientIpOctet = 20

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('personal organization provisioning', () => {
  it('rolls a failed magic-link user insert back and provisions exactly once on clean retry', async () => {
    const fixture = createFixture(false)
    const email = 'magic-organization@example.test'

    try {
      installInsertFailure(fixture.sqlite, 'member')

      const failedLink = await requestMagicLink(fixture, email, 'Magic Person')
      const failedRedemption = await settleHandlerRequest(fixture.auth, failedLink)
      expectRejectedAuthRequest(failedRedemption)
      expectNoIdentityRows(fixture.sqlite, email)

      removeInsertFailure(fixture.sqlite, 'member')

      const retryLink = await requestMagicLink(fixture, email, 'Magic Person')
      const retry = await fixture.auth.handler(request(retryLink))
      expectSuccessfulCallback(retry)
      const personalOrganization = expectOnePersonalOrganization(fixture.sqlite, email)

      const returningLink = await requestMagicLink(fixture, email, 'Changed Display Name')
      const returning = await fixture.auth.handler(request(returningLink))
      expectSuccessfulCallback(returning)
      expect(expectOnePersonalOrganization(fixture.sqlite, email)).toEqual(personalOrganization)
    } finally {
      fixture.cleanup()
    }
  })

  it('rolls a failed Google user insert back and provisions exactly once on clean retry', async () => {
    const fixture = createFixture(true)
    const email = 'google-organization@example.test'
    installGoogleTokenEndpoint(
      new Map([
        ['google-failed-code', { subject: 'google-personal-subject', email }],
        ['google-retry-code', { subject: 'google-personal-subject', email }],
        ['google-returning-code', { subject: 'google-personal-subject', email }]
      ])
    )

    try {
      installInsertFailure(fixture.sqlite, 'organization')

      const failedAuthorization = await beginGoogleSignIn(fixture)
      const failedCallback = await settleHandlerRequest(
        fixture.auth,
        googleCallbackRequest(failedAuthorization, 'google-failed-code')
      )
      expectRejectedAuthRequest(failedCallback)
      expectNoIdentityRows(fixture.sqlite, email)

      removeInsertFailure(fixture.sqlite, 'organization')

      const retryAuthorization = await beginGoogleSignIn(fixture)
      const retry = await fixture.auth.handler(googleCallbackRequest(retryAuthorization, 'google-retry-code'))
      expectSuccessfulCallback(retry)
      const personalOrganization = expectOnePersonalOrganization(fixture.sqlite, email, { accountCount: 1 })

      const returningAuthorization = await beginGoogleSignIn(fixture)
      const returning = await fixture.auth.handler(
        googleCallbackRequest(returningAuthorization, 'google-returning-code')
      )
      expectSuccessfulCallback(returning)
      expect(expectOnePersonalOrganization(fixture.sqlite, email, { accountCount: 1 })).toEqual(personalOrganization)
    } finally {
      fixture.cleanup()
    }
  })

  it('applies production social linking and token-retention policy through the configured adapter', async () => {
    const fixture = createFixture(true)
    const email = 'production-composition-unverified@example.test'
    const userId = 'production-composition-unverified-user'
    const now = Math.floor(Date.now() / 1_000)
    fixture.sqlite
      .prepare('insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, ?, ?, ?)')
      .run(userId, 'Unverified Local', email, 0, now, now)
    installGoogleTokenEndpoint(
      new Map([['production-composition-code', { subject: 'production-composition-google', email }]])
    )

    try {
      const authorization = await beginGoogleSignIn(fixture)
      expect(fixture.sqlite.prepare('select count(*) as count from verification').get()).toEqual({ count: 1 })
      const response = await fixture.auth.handler(googleCallbackRequest(authorization, 'production-composition-code'))
      expect(response.status).toBe(302)
      expect(fixture.sqlite.prepare('select count(*) as count from verification').get()).toEqual({ count: 0 })
      expect(
        fixture.sqlite.prepare('select id, email_verified as emailVerified from user where email = ?').all(email)
      ).toEqual([{ id: userId, emailVerified: 0 }])
      expect(fixture.sqlite.prepare('select count(*) as count from account').get()).toEqual({ count: 0 })
      expect(fixture.sqlite.prepare('select count(*) as count from session').get()).toEqual({ count: 0 })
    } finally {
      fixture.cleanup()
    }
  })

  it('keeps organization lifecycle, broad reads, invitations, teams, and dynamic roles unavailable', async () => {
    const fixture = createFixture(false)
    const blockedRequests = [
      ['POST', '/organization/create'],
      ['POST', '/organization/check-slug'],
      ['POST', '/organization/update'],
      ['POST', '/organization/delete'],
      ['POST', '/organization/set-active'],
      ['POST', '/organization/leave'],
      ['GET', '/organization/get-full-organization'],
      ['GET', '/organization/list'],
      ['GET', '/organization/list-members'],
      ['GET', '/organization/get-active-member'],
      ['GET', '/organization/get-active-member-role'],
      ['POST', '/organization/remove-member'],
      ['POST', '/organization/update-member-role'],
      ['POST', '/organization/has-permission'],
      ['POST', '/organization/invite-member'],
      ['POST', '/organization/cancel-invitation'],
      ['POST', '/organization/accept-invitation'],
      ['GET', '/organization/get-invitation'],
      ['POST', '/organization/reject-invitation'],
      ['GET', '/organization/list-invitations'],
      ['GET', '/organization/list-user-invitations'],
      ['POST', '/organization/create-team'],
      ['POST', '/organization/create-role']
    ] as const

    try {
      for (const [method, path] of blockedRequests) {
        const response = await fixture.auth.handler(
          request(`${baseURL}/api/auth${path}`, {
            method,
            ...(method === 'POST' ? { body: '{}' } : {})
          })
        )
        expect(response.status, `${method} ${path}`).toBe(404)
      }
    } finally {
      fixture.cleanup()
    }
  })
})

function createFixture(googleEnabled: boolean) {
  const directory = mkdtempSync(join(tmpdir(), 'swl-organization-provisioning-'))
  const databasePath = join(directory, 'fixture.sqlite')
  const sqlite = new Database(databasePath)
  sqlite.pragma('foreign_keys = ON')
  migrate(drizzle({ client: sqlite }), {
    migrationsFolder: fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
  })

  const config = testRuntimeConfig(googleEnabled)
  const database = drizzle({ client: sqlite, schema })
  const magicLinks = new Map<string, string>()
  const authentication = createAuthentication(config, { sqlite, db: database, databasePath }, () => ({
    async send(message) {
      const link = message.text.match(/https?:\/\/\S+/)?.[0]
      if (!link) throw new Error('Expected the magic-link message to contain a URL')
      magicLinks.set(message.to, link)
    }
  }))

  return {
    auth: authentication,
    magicLinks,
    sqlite,
    cleanup() {
      sqlite.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

function testRuntimeConfig(googleEnabled: boolean): AppRuntimeConfig {
  return {
    betterAuth: {
      secret: 'organization-provisioning-secret-with-32-characters',
      url: baseURL
    },
    modules: { turnstile: { enabled: false } },
    cloudflare: { turnstile: { secretKey: '' } },
    socialProviders: {
      google: googleEnabled
        ? { enabled: true, clientId: googleClientId, clientSecret: googleClientSecret }
        : { enabled: false, clientId: '', clientSecret: '' }
    },
    public: {
      appName: 'Organization provisioning test',
      appUrl: baseURL,
      turnstileSiteKey: ''
    }
  } as AppRuntimeConfig
}

type Fixture = ReturnType<typeof createFixture>
type Authentication = Fixture['auth']

function request(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('cf-connecting-ip', `198.51.100.${nextClientIpOctet++}`)
  if (init.body !== undefined) {
    headers.set('content-type', 'application/json')
    headers.set('origin', baseURL)
  }
  return new Request(url, { ...init, headers, redirect: 'manual' })
}

async function requestMagicLink(fixture: Fixture, email: string, name: string) {
  fixture.magicLinks.delete(email)
  const response = await fixture.auth.handler(
    request(`${baseURL}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      body: JSON.stringify({
        email,
        name,
        callbackURL: '/app',
        newUserCallbackURL: '/app',
        errorCallbackURL: '/login'
      })
    })
  )

  expect(response.status).toBe(200)
  const link = fixture.magicLinks.get(email)
  expect(link).toMatch(/^http:\/\/localhost:3000\/api\/auth\/magic-link\/verify\?/)
  return link!
}

async function beginGoogleSignIn(fixture: Fixture) {
  const response = await fixture.auth.handler(
    request(`${baseURL}/api/auth/sign-in/social`, {
      method: 'POST',
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
  expect(new URL(body.url).origin).toBe('https://accounts.google.com')

  return {
    cookies: convertSetCookieToCookie(new Headers(response.headers)),
    state: new URL(body.url).searchParams.get('state')!
  }
}

function googleCallbackRequest(authorization: Awaited<ReturnType<typeof beginGoogleSignIn>>, code: string) {
  return request(
    `${baseURL}/api/auth/callback/google?state=${encodeURIComponent(authorization.state)}&code=${encodeURIComponent(code)}`,
    { headers: authorization.cookies }
  )
}

function installGoogleTokenEndpoint(grants: Map<string, { subject: string; email: string }>) {
  const consumed = new Set<string>()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url !== tokenEndpoint) throw new Error(`Unexpected external request: ${url}`)

      const body = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams(String(init?.body ?? ''))
      const code = body.get('code') ?? ''
      const grant = grants.get(code)
      if (!grant || consumed.has(code)) {
        return Response.json({ error: 'invalid_grant' }, { status: 400 })
      }
      consumed.add(code)

      expect(body.get('client_id')).toBe(googleClientId)
      expect(body.get('client_secret')).toBe(googleClientSecret)
      expect(body.get('redirect_uri')).toBe(`${baseURL}/api/auth/callback/google`)
      expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]+$/)

      return Response.json({
        access_token: `access-${code}`,
        refresh_token: `refresh-${code}`,
        id_token: unsignedJwt({
          sub: grant.subject,
          email: grant.email,
          email_verified: true,
          name: 'Google Person'
        }),
        expires_in: 3600,
        scope: 'openid email',
        token_type: 'Bearer'
      })
    })
  )
}

function unsignedJwt(payload: Record<string, unknown>) {
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`
}

function installInsertFailure(sqlite: InstanceType<typeof Database>, table: 'organization' | 'member') {
  sqlite.exec(`
    CREATE TRIGGER test_fail_${table}_insert
    BEFORE INSERT ON ${table}
    BEGIN
      SELECT RAISE(ABORT, 'injected ${table} failure');
    END
  `)
}

function removeInsertFailure(sqlite: InstanceType<typeof Database>, table: 'organization' | 'member') {
  sqlite.exec(`DROP TRIGGER test_fail_${table}_insert`)
}

async function settleHandlerRequest(auth: Authentication, authRequest: Request) {
  try {
    return { response: await auth.handler(authRequest) }
  } catch (error) {
    return { error }
  }
}

function expectRejectedAuthRequest(outcome: Awaited<ReturnType<typeof settleHandlerRequest>>) {
  if ('error' in outcome) {
    expect(outcome.error).toBeDefined()
    return
  }

  if (outcome.response.status === 302) {
    const location = new URL(outcome.response.headers.get('location')!, baseURL)
    expect(location.searchParams.has('error')).toBe(true)
    return
  }

  expect(outcome.response.status).toBeGreaterThanOrEqual(400)
}

function expectSuccessfulCallback(response: Response) {
  expect(response.status).toBe(302)
  const location = new URL(response.headers.get('location')!, baseURL)
  expect(location.pathname).toBe('/app')
  expect(location.searchParams.has('error')).toBe(false)
}

function expectNoIdentityRows(sqlite: InstanceType<typeof Database>, email: string) {
  expect(sqlite.prepare('select count(*) as count from user where email = ?').get(email)).toEqual({ count: 0 })
  expect(sqlite.prepare('select count(*) as count from organization').get()).toEqual({ count: 0 })
  expect(sqlite.prepare('select count(*) as count from member').get()).toEqual({ count: 0 })
  expect(sqlite.prepare('select count(*) as count from account').get()).toEqual({ count: 0 })
  expect(sqlite.prepare('select count(*) as count from session').get()).toEqual({ count: 0 })
}

function expectOnePersonalOrganization(
  sqlite: InstanceType<typeof Database>,
  email: string,
  options: { accountCount?: number } = {}
) {
  const users = sqlite.prepare('select id from user where email = ?').all(email) as Array<{ id: string }>
  expect(users).toHaveLength(1)
  const userId = users[0]!.id
  const organizations = sqlite
    .prepare('select id, name, slug, personal_owner_user_id as personalOwnerUserId from organization')
    .all() as Array<{ id: string; name: string; slug: string; personalOwnerUserId: string }>
  expect(organizations).toHaveLength(1)
  expect(organizations[0]).toMatchObject({
    id: expect.stringMatching(/^organization_[0-9a-f]{32}$/),
    name: expect.any(String),
    slug: expect.stringMatching(/^workspace-[0-9a-f]{32}$/),
    personalOwnerUserId: userId
  })
  expect(organizations[0]!.slug).not.toContain(userId)
  expect(organizations[0]!.name.length).toBeGreaterThan(0)

  expect(sqlite.prepare('select organization_id as organizationId, user_id as userId, role from member').all()).toEqual(
    [
      {
        organizationId: organizations[0]!.id,
        userId,
        role: 'owner'
      }
    ]
  )
  expect(sqlite.prepare('select count(*) as count from account').get()).toEqual({
    count: options.accountCount ?? 0
  })
  if (options.accountCount) {
    expect(
      sqlite
        .prepare('select access_token as accessToken, refresh_token as refreshToken, id_token as idToken from account')
        .all()
    ).toEqual([{ accessToken: null, refreshToken: null, idToken: null }])
  }

  return { id: organizations[0]!.id, slug: organizations[0]!.slug }
}
