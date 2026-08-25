import { createServer, type Server } from 'node:http'
import { createApp, defineEventHandler, toNodeListener, type EventHandler } from 'h3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  vi.stubGlobal('defineEventHandler', defineEventHandler)
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('basic-release lockdown', () => {
  it('returns a generic non-cacheable 404 before excluded handlers run', async () => {
    const lockdown = (await import('../server/middleware/01-basic-release')).default
    const reached = vi.fn(() => ({ reached: true }))
    const server = await startServer([lockdown, defineEventHandler(reached)])

    try {
      for (const [method, pathname] of [
        ['GET', '/api/ai'],
        ['POST', '/api/ai/'],
        ['DELETE', '/api/ai/conversations/ai_123?confirm=true'],
        ['GET', '/api/files'],
        ['PUT', '/api/files/file_123/content'],
        ['POST', '/%61pi/%66iles/uploads']
      ]) {
        const response = await request(server, pathname, { method })
        const body = await response.text()

        expect(response.status, `${method} ${pathname}`).toBe(404)
        expect(response.headers.get('cache-control'), `${method} ${pathname}`).toBe('no-store')
        expect(body, `${method} ${pathname}`).toContain('Not Found')
        expect(body, `${method} ${pathname}`).not.toContain('AI')
        expect(body, `${method} ${pathname}`).not.toContain('Files')
      }

      expect(reached).not.toHaveBeenCalled()
    } finally {
      await closeServer(server)
    }
  })

  it('does not capture neighboring or non-API routes', async () => {
    const lockdown = (await import('../server/middleware/01-basic-release')).default
    const reached = vi.fn(() => ({ reached: true }))
    const server = await startServer([lockdown, defineEventHandler(reached)])

    try {
      for (const pathname of ['/api/aix', '/api/filesystem', '/files', '/api/account']) {
        const response = await request(server, pathname)
        expect(response.status, pathname).toBe(200)
        expect(await response.json(), pathname).toEqual({ reached: true })
      }

      expect(reached).toHaveBeenCalledTimes(4)
    } finally {
      await closeServer(server)
    }
  })
})

async function startServer(handlers: EventHandler[]) {
  const app = createApp()
  for (const handler of handlers) app.use(handler)
  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return server
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

function request(server: Server, pathname: string, init: RequestInit = {}) {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP address')
  return fetch(`http://127.0.0.1:${address.port}${pathname}`, init)
}
