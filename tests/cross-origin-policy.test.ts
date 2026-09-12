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

const appUrl = 'https://app.example.test'
const appOrigin = appUrl

beforeAll(() => vi.stubGlobal('defineEventHandler', defineEventHandler))
afterEach(() => vi.restoreAllMocks())
afterAll(() => vi.unstubAllGlobals())

describe('public website command origin policy', () => {
  it('protects unsafe API requests while allowing safe public reads and non-API requests', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'BREW']) {
      expect(requiresCommandOriginPolicy(method, '/api/events')).toBe(true)
      expect(requiresCommandOriginPolicy(method.toLowerCase(), '/api/events')).toBe(true)
    }
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(requiresCommandOriginPolicy(method, '/api/events')).toBe(false)
    }
    expect(requiresCommandOriginPolicy('POST', '/calendar')).toBe(false)
    expect(requiresCommandOriginPolicy('POST', '/api-example/events')).toBe(false)
  })

  it('keeps unsafe commands out of non-API Nitro routes that the policy does not cover', () => {
    const routesRoot = resolve(process.cwd(), 'server/routes')
    const routeFiles = existsSync(routesRoot) ? walkFiles(routesRoot) : []
    expect(routeFiles.filter((file) => !/\.(?:get|head|options)\.[cm]?[jt]s$/i.test(file))).toEqual([])
  })

  it('exempts only exact operational token routes, with no retired auth or webhook exemptions', () => {
    for (const pathname of ['/api/observability/client-test', '/api/observability/test-error']) {
      expect(requiresCommandOriginPolicy('POST', pathname)).toBe(false)
      expect(requiresCommandOriginPolicy('PUT', pathname)).toBe(true)
      expect(requiresCommandOriginPolicy('POST', `${pathname}s`)).toBe(true)
      expect(requiresCommandOriginPolicy('POST', `${pathname}/again`)).toBe(true)
    }
    for (const pathname of ['/api/auth', '/api/auth/sign-in/email', '/api/webhooks/stripe']) {
      expect(requiresCommandOriginPolicy('POST', pathname)).toBe(true)
    }
  })

  it('accepts exact Origin, same-origin Fetch Metadata, and same-origin Referer fallback', () => {
    for (const signals of [
      { origin: appOrigin },
      { secFetchSite: 'same-origin' },
      { referer: `${appOrigin}/calendar?month=9` },
      { origin: appOrigin, referer: `${appOrigin}/calendar`, secFetchSite: 'same-origin' },
      { origin: appOrigin, secFetchSite: 'future-value' },
      { referer: `${appOrigin}/calendar`, secFetchSite: 'future-value' }
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

  it('returns a stable redacted 403 before an unsafe handler runs, including encoded API paths', async () => {
    vi.spyOn(runtime, 'getAppRuntimeConfig').mockReturnValue(testConfig())
    const crossOrigin = (await import('../server/middleware/02-cross-origin')).default
    const reached = vi.fn(() => ({ reached: true }))
    const server = await startServer([crossOrigin, defineEventHandler(reached)])

    try {
      const hostileOrigin = 'https://private-attacker.invalid'
      for (const pathname of ['/api/events', '/%61pi/events', '/a%70i/events']) {
        const rejected = await request(server, pathname, { method: 'POST', headers: { origin: hostileOrigin } })
        const body = await rejected.text()
        expect(rejected.status).toBe(403)
        expect(rejected.headers.get('cache-control')).toBe('no-store')
        expect(rejected.headers.get('vary')).toBe('Origin, Sec-Fetch-Site')
        expect(body).toContain(crossOriginRequestBlockedCode)
        expect(body).not.toContain(hostileOrigin)
      }
      expect(reached).not.toHaveBeenCalled()
      const allowed = await request(server, '/api/events', {
        method: 'POST',
        headers: { origin: appOrigin, 'sec-fetch-site': 'same-origin' }
      })
      expect(allowed.status).toBe(200)
      expect(await allowed.json()).toEqual({ reached: true })
      expect(reached).toHaveBeenCalledOnce()
    } finally {
      await closeServer(server)
    }
  })

  it('allows public event reads without requiring browser origin headers', async () => {
    const crossOrigin = (await import('../server/middleware/02-cross-origin')).default
    const reached = vi.fn(() => ({ events: [] }))
    const server = await startServer([crossOrigin, defineEventHandler(reached)])
    try {
      const response = await request(server, '/api/events')
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ events: [] })
    } finally {
      await closeServer(server)
    }
  })

  it('leaves operational test routes under their independent token authority', async () => {
    const crossOrigin = (await import('../server/middleware/02-cross-origin')).default
    const authority = defineEventHandler((event) => {
      if (getRequestHeader(event, 'x-observability-test-token') !== 'valid') {
        throw createError({ statusCode: 401, statusMessage: 'Independent authority required' })
      }
      return { authority: 'independent' }
    })
    const server = await startServer([crossOrigin, authority])
    try {
      for (const pathname of ['/api/observability/test-error', '/api/%6fbservability/test-error']) {
        const allowed = await request(server, pathname, {
          method: 'POST',
          headers: {
            origin: 'https://attacker.invalid',
            'sec-fetch-site': 'cross-site',
            'x-observability-test-token': 'valid'
          }
        })
        expect(allowed.status).toBe(200)
        expect(await allowed.json()).toEqual({ authority: 'independent' })
        const rejected = await request(server, pathname, {
          method: 'POST',
          headers: { cookie: 'legacy-session=invalid' }
        })
        expect(rejected.status).toBe(401)
        expect(await rejected.text()).not.toContain(crossOriginRequestBlockedCode)
      }
    } finally {
      await closeServer(server)
    }
  })
})

function testConfig(): AppRuntimeConfig {
  return { public: { appUrl } } as AppRuntimeConfig
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
