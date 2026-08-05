import { createServer, type Server } from 'node:http'
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createApp, createError, defineEventHandler, getRequestHeader, toNodeListener, type EventHandler } from 'h3'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  crossOriginRequestBlockedCode,
  isCommandOriginAllowed,
  requiresCommandOriginPolicy
} from '../server/utils/request-origin'
import * as runtime from '../server/utils/runtime'
import type { AppRuntimeConfig } from '../server/utils/runtime'

const appUrl = 'https://app.example.test/application/path'
const appOrigin = 'https://app.example.test'

beforeAll(() => {
  vi.stubGlobal('defineEventHandler', defineEventHandler)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.stubGlobal('defineEventHandler', defineEventHandler)
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('app command origin policy', () => {
  it('protects every unsafe app API family while keeping safe and non-API requests out of scope', () => {
    for (const [method, pathname] of [
      ['POST', '/api/files/uploads'],
      ['PUT', '/api/files/file_1/content'],
      ['POST', '/api/files/file_1/complete'],
      ['DELETE', '/api/files/file_1'],
      ['POST', '/api/ai/conversations'],
      ['POST', '/api/ai/conversations/ai_conversation_1/messages'],
      ['DELETE', '/api/ai/conversations/ai_conversation_1/messages'],
      ['DELETE', '/api/ai/conversations/ai_conversation_1'],
      ['POST', '/api/account/billing/checkout'],
      ['DELETE', '/api/account']
    ]) {
      expect(requiresCommandOriginPolicy(method, pathname), `${method} ${pathname}`).toBe(true)
    }

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'BREW']) {
      expect(requiresCommandOriginPolicy(method, '/api/ai/conversations')).toBe(true)
      expect(requiresCommandOriginPolicy(method.toLowerCase(), '/api/ai/conversations/ai_conversation_1')).toBe(true)
    }

    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(requiresCommandOriginPolicy(method, '/api/ai/conversations')).toBe(false)
    }

    expect(requiresCommandOriginPolicy('POST', '/ai/conversations')).toBe(false)
    expect(requiresCommandOriginPolicy('POST', '/api-example/ai/conversations')).toBe(false)
  })

  it('keeps unsafe app commands out of non-API Nitro routes that the policy does not cover', () => {
    const routesRoot = resolve(process.cwd(), 'server/routes')
    const routeFiles = existsSync(routesRoot) ? walkFiles(routesRoot) : []
    const potentiallyUnsafe = routeFiles.filter((file) => !/\.(?:get|head|options)\.[cm]?[jt]s$/i.test(file))

    expect(potentiallyUnsafe).toEqual([])
  })

  it('keeps Better Auth lifecycle ownership path-bounded while protecting neighboring app routes', () => {
    for (const [method, pathname] of [
      ['POST', '/api/auth'],
      ['POST', '/api/auth/sign-in/email'],
      ['DELETE', '/api/auth/session']
    ]) {
      expect(requiresCommandOriginPolicy(method, pathname), `${method} ${pathname}`).toBe(false)
    }

    for (const pathname of ['/api/authentic/sign-in', '/api/authz/session', '/api/authentication']) {
      expect(requiresCommandOriginPolicy('POST', pathname), pathname).toBe(true)
    }
  })

  it('keeps provider and operational token exemptions exact while protecting local file capabilities', () => {
    for (const [method, pathname] of [
      ['POST', '/api/webhooks/stripe'],
      ['POST', '/api/observability/client-test'],
      ['POST', '/api/observability/test-error']
    ]) {
      expect(requiresCommandOriginPolicy(method, pathname), `${method} ${pathname}`).toBe(false)
    }

    for (const [method, pathname] of [
      ['POST', '/api/webhooks/stripes'],
      ['PUT', '/api/webhooks/stripe'],
      ['POST', '/api/billing/webhook'],
      ['POST', '/api/files/file_1/content'],
      ['PUT', '/api/files/file_1/content'],
      ['PUT', '/api/files/file_1/content/extra'],
      ['PUT', '/api/files/content'],
      ['PUT', '/api/observability/client-test'],
      ['POST', '/api/observability/client-tests'],
      ['POST', '/api/observability/test-error/again']
    ]) {
      expect(requiresCommandOriginPolicy(method, pathname), `${method} ${pathname}`).toBe(true)
    }
  })

  it('accepts exact Origin, same-origin Fetch Metadata, and same-origin Referer fallback', () => {
    for (const signals of [
      { origin: appOrigin },
      { secFetchSite: 'same-origin' },
      { referer: `${appOrigin}/app?panel=ai` },
      { origin: appOrigin, referer: `${appOrigin}/app`, secFetchSite: 'same-origin' },
      { origin: appOrigin, secFetchSite: 'future-value' },
      { referer: `${appOrigin}/app`, secFetchSite: 'future-value' }
    ]) {
      expect(isCommandOriginAllowed(signals, appUrl), JSON.stringify(signals)).toBe(true)
    }
  })

  it('rejects missing, malformed, conflicting, cross-site, same-site, and direct-navigation signals', () => {
    for (const signals of [
      {},
      { secFetchSite: 'future-value' },
      { origin: 'null' },
      { origin: `${appOrigin}/` },
      { origin: 'https://attacker.invalid', secFetchSite: 'same-origin' },
      { origin: appOrigin, referer: 'https://attacker.invalid/form' },
      { referer: 'not a URL' },
      { referer: 'https://app.example.test.attacker.invalid/form' },
      { origin: appOrigin, secFetchSite: 'cross-site' },
      { origin: appOrigin, secFetchSite: 'same-site' },
      { origin: appOrigin, secFetchSite: 'none' }
    ]) {
      expect(isCommandOriginAllowed(signals, appUrl), JSON.stringify(signals)).toBe(false)
    }

    expect(() => isCommandOriginAllowed({ origin: appOrigin }, 'ftp://app.example.test')).toThrow(TypeError)
  })

  it('returns one stable redacted 403 before an app command handler runs', async () => {
    const config = testConfig()
    vi.spyOn(runtime, 'getAppRuntimeConfig').mockReturnValue(config)
    const crossOrigin = (await import('../server/middleware/02-cross-origin')).default
    const reached = vi.fn(() => ({ reached: true }))
    const server = await startServer([crossOrigin, defineEventHandler(reached)])

    try {
      const hostileOrigin = 'https://sensitive-attacker.invalid'
      const rejected = await request(server, '/api/ai/conversations', {
        method: 'POST',
        headers: { origin: hostileOrigin, cookie: 'session=must-not-authorize-hostile-origin' }
      })
      const rejectedBody = await rejected.text()

      expect(rejected.status).toBe(403)
      expect(rejected.headers.get('cache-control')).toBe('no-store')
      expect(rejected.headers.get('vary')).toBe('Origin, Sec-Fetch-Site')
      expect(rejectedBody).toContain(crossOriginRequestBlockedCode)
      expect(rejectedBody).not.toContain(hostileOrigin)
      expect(reached).not.toHaveBeenCalled()

      const allowed = await request(server, '/api/ai/conversations', {
        method: 'POST',
        headers: { origin: appOrigin, 'sec-fetch-site': 'same-origin' }
      })
      expect(allowed.status).toBe(200)
      expect(allowed.headers.get('cache-control')).toBe('no-store')
      expect(allowed.headers.get('vary')).toBe('Origin, Sec-Fetch-Site')
      expect(await allowed.json()).toEqual({ reached: true })
      expect(reached).toHaveBeenCalledOnce()
    } finally {
      await closeServer(server)
    }
  })

  it('rejects hostile HTTP requests before every required app command family', async () => {
    const config = testConfig()
    vi.spyOn(runtime, 'getAppRuntimeConfig').mockReturnValue(config)
    const crossOrigin = (await import('../server/middleware/02-cross-origin')).default
    const reached = vi.fn(() => ({ reached: true }))
    const server = await startServer([crossOrigin, defineEventHandler(reached)])

    try {
      for (const [family, method, pathname, sourceHeaders] of [
        ['file upload initiation', 'POST', '/api/files/uploads', { origin: 'https://attacker.invalid' }],
        ['local file content upload', 'PUT', '/api/files/file_1/content?token=opaque', {}],
        ['file completion', 'POST', '/api/files/file_1/complete', { origin: 'https://attacker.invalid' }],
        ['file deletion', 'DELETE', '/api/files/file_1', { origin: 'https://attacker.invalid' }],
        ['AI conversation creation', 'POST', '/api/ai/conversations', { origin: 'https://attacker.invalid' }],
        [
          'AI generation',
          'POST',
          '/api/ai/conversations/ai_conversation_1/messages',
          { origin: 'https://attacker.invalid' }
        ],
        [
          'AI history clearing',
          'DELETE',
          '/api/ai/conversations/ai_conversation_1/messages',
          { origin: 'https://attacker.invalid' }
        ],
        [
          'AI conversation deletion',
          'DELETE',
          '/api/ai/conversations/ai_conversation_1',
          { origin: 'https://attacker.invalid' }
        ],
        ['billing', 'POST', '/api/account/billing/checkout', { origin: 'https://attacker.invalid' }],
        ['prospective app-account lifecycle', 'DELETE', '/api/account', { origin: 'https://attacker.invalid' }],
        ['encoded API segment', 'POST', '/%61pi/ai/conversations', { origin: 'https://attacker.invalid' }],
        ['partially encoded API segment without source signals', 'POST', '/a%70i/ai/conversations', {}],
        ['encoded exemption neighbor', 'POST', '/%61pi/webhooks/%73tripes', { origin: 'https://attacker.invalid' }]
      ]) {
        const response = await request(server, pathname, {
          method,
          headers: sourceHeaders
        })
        const body = await response.text()

        expect(response.status, family).toBe(403)
        expect(body, family).toContain(crossOriginRequestBlockedCode)
      }

      expect(reached).not.toHaveBeenCalled()
    } finally {
      await closeServer(server)
    }
  })

  it('leaves exact webhook and operational token routes under their independent authorities', async () => {
    const config = testConfig()
    vi.spyOn(runtime, 'getAppRuntimeConfig').mockReturnValue(config)
    const crossOrigin = (await import('../server/middleware/02-cross-origin')).default
    const authority = vi.fn(
      defineEventHandler((event) => {
        const queryIndex = event.path.indexOf('?')
        const pathname = queryIndex === -1 ? event.path : event.path.slice(0, queryIndex)
        const valid =
          (pathname === '/api/webhooks/stripe' && getRequestHeader(event, 'stripe-signature') === 'valid') ||
          (pathname === '/api/observability/test-error' &&
            getRequestHeader(event, 'x-observability-test-token') === 'valid')

        if (!valid) {
          throw createError({
            statusCode: 401,
            statusMessage: 'Independent authority required',
            data: { code: 'INDEPENDENT_AUTH_REQUIRED' }
          })
        }

        return { authority: 'independent' }
      })
    )
    const server = await startServer([crossOrigin, authority])

    try {
      for (const [label, pathname, init] of [
        [
          'signed webhook with hostile browser metadata',
          '/api/webhooks/stripe',
          {
            method: 'POST',
            headers: {
              origin: 'https://attacker.invalid',
              'sec-fetch-site': 'cross-site',
              'stripe-signature': 'valid'
            }
          }
        ],
        [
          'observability token with hostile browser metadata',
          '/api/observability/test-error',
          {
            method: 'POST',
            headers: {
              origin: 'https://attacker.invalid',
              'sec-fetch-site': 'cross-site',
              'x-observability-test-token': 'valid'
            }
          }
        ],
        [
          'encoded signed webhook keeps signature authority',
          '/%61pi/webhooks/%73tripe',
          {
            method: 'POST',
            headers: {
              origin: 'https://attacker.invalid',
              'sec-fetch-site': 'cross-site',
              'stripe-signature': 'valid'
            }
          }
        ],
        [
          'encoded observability route keeps token authority',
          '/api/%6fbservability/test-error',
          {
            method: 'POST',
            headers: {
              origin: 'https://attacker.invalid',
              'sec-fetch-site': 'cross-site',
              'x-observability-test-token': 'valid'
            }
          }
        ]
      ] as const) {
        const response = await request(server, pathname, init)
        expect(response.status, label).toBe(200)
        expect(await response.json(), label).toEqual({ authority: 'independent' })
      }

      for (const [label, pathname, init] of [
        [
          'session cookie cannot replace a webhook signature',
          '/api/webhooks/stripe',
          { method: 'POST', headers: { cookie: 'session=invalid' } }
        ],
        [
          'session cookie cannot replace an observability token',
          '/api/observability/test-error',
          { method: 'POST', headers: { cookie: 'session=invalid' } }
        ]
      ] as const) {
        const response = await request(server, pathname, init)
        const body = await response.text()
        expect(response.status, label).toBe(401)
        expect(body, label).toContain('INDEPENDENT_AUTH_REQUIRED')
        expect(body, label).not.toContain(crossOriginRequestBlockedCode)
      }

      expect(authority).toHaveBeenCalledTimes(6)
    } finally {
      await closeServer(server)
    }
  })
})

function testConfig(): AppRuntimeConfig {
  return {
    public: {
      appUrl
    }
  } as unknown as AppRuntimeConfig
}

async function startServer(handlers: EventHandler[]): Promise<Server> {
  const app = createApp()
  for (const handler of handlers) app.use(handler)
  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return server
}

async function request(server: Server, pathname: string, init?: RequestInit): Promise<Response> {
  const address = server.address()
  if (!address || typeof address === 'string') throw new TypeError('Expected a TCP test address')
  return fetch(`http://127.0.0.1:${address.port}${pathname}`, init)
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}

function walkFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? walkFiles(path) : [path]
  })
}
