import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { runtimeModuleIds } from '../shared/modules'
import {
  areRuntimeModulesHealthy,
  evaluateReadiness,
  isReadinessAuthorizationValid,
  probeSqliteReadiness,
  readinessReadyResponse,
  readinessUnauthorizedResponse,
  readinessUnavailableResponse
} from '../server/utils/readiness'
import type { AppRuntimeConfig } from '../server/utils/runtime'

const readinessToken = 'Readiness-token-for-focused-tests-123456789'
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'swl-readiness-'))

beforeAll(() => {
  vi.stubGlobal('defineEventHandler', defineEventHandler)
})

afterAll(() => {
  vi.unstubAllGlobals()
  rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('liveness boundary', () => {
  it('returns an exact empty 204 response without cache storage', async () => {
    const moduleBoundary = (await import('../server/middleware/01-module-boundary')).default
    const crossOrigin = (await import('../server/middleware/02-cross-origin')).default
    const handler = (await import('../server/api/live.get')).default
    const app = createApp()
    app.use(moduleBoundary)
    app.use(crossOrigin)
    app.use(handler)
    const server = createServer(toNodeListener(app))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new TypeError('Expected a TCP test address')

      const response = await fetch(`http://127.0.0.1:${address.port}/api/live`)
      expect(response.status).toBe(204)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.text()).toBe('')

      const encodedResponse = await fetch(`http://127.0.0.1:${address.port}/%61pi/%6cive`)
      expect(encodedResponse.status).toBe(204)
      expect(encodedResponse.headers.get('cache-control')).toBe('no-store')
      expect(await encodedResponse.text()).toBe('')
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  })
})

describe('protected readiness boundary', () => {
  it('keeps every redacted response frozen with an exact key set', () => {
    expect(readinessUnauthorizedResponse).toEqual({
      status: 'unauthorized',
      code: 'READINESS_AUTH_REQUIRED'
    })
    expect(Object.keys(readinessUnauthorizedResponse)).toEqual(['status', 'code'])

    expect(readinessReadyResponse).toEqual({ status: 'ready' })
    expect(Object.keys(readinessReadyResponse)).toEqual(['status'])

    expect(readinessUnavailableResponse).toEqual({
      status: 'not_ready',
      code: 'SERVICE_NOT_READY'
    })
    expect(Object.keys(readinessUnavailableResponse)).toEqual(['status', 'code'])

    for (const response of [readinessUnauthorizedResponse, readinessReadyResponse, readinessUnavailableResponse]) {
      expect(Object.isFrozen(response)).toBe(true)
      expect(JSON.stringify(response)).not.toMatch(/database|sqlite|module|provider|token|duration|path/i)
    }
  })

  it('accepts only the exact Bearer credential', () => {
    expect(isReadinessAuthorizationValid(`Bearer ${readinessToken}`, readinessToken)).toBe(true)

    for (const authorization of [
      undefined,
      '',
      readinessToken,
      `bearer ${readinessToken}`,
      `Bearer  ${readinessToken}`,
      `Bearer ${readinessToken} `,
      `Bearer ${readinessToken},other`,
      'Bearer wrong-token'
    ]) {
      expect(isReadinessAuthorizationValid(authorization, readinessToken), String(authorization)).toBe(false)
    }
  })

  it('authenticates before database work and returns only stable evaluations', () => {
    const config = testConfig()
    const probeDatabase = vi.fn(() => true)

    expect(evaluateReadiness(undefined, config, probeDatabase)).toBe(readinessUnauthorizedResponse)
    expect(probeDatabase).not.toHaveBeenCalled()

    probeDatabase.mockReturnValueOnce(false)
    expect(evaluateReadiness(`Bearer ${readinessToken}`, config, probeDatabase)).toBe(readinessUnavailableResponse)
    expect(probeDatabase).toHaveBeenCalledOnce()

    probeDatabase.mockClear()
    expect(evaluateReadiness(`Bearer ${readinessToken}`, config, probeDatabase)).toBe(readinessReadyResponse)
    expect(probeDatabase).toHaveBeenCalledExactlyOnceWith(config.databaseUrl)
  })

  it('treats manifest-defined disabled and ready modules as healthy without reading provider config', () => {
    for (const enabled of [false, true]) {
      const config = providerGuardedConfig(enabled)
      expect(areRuntimeModulesHealthy(config)).toBe(true)
    }
  })

  it('uses a fresh read-only SQLite probe and fails closed without creating a missing database', () => {
    const databasePath = join(temporaryDirectory, 'ready.db')
    const setup = new Database(databasePath)
    setup.exec('create table readiness_fixture (id integer primary key)')
    setup.close()

    expect(probeSqliteReadiness(`file:${databasePath}`)).toBe(true)
    expect(probeSqliteReadiness(`file:${databasePath}`)).toBe(true)

    const missingPath = join(temporaryDirectory, 'missing.db')
    expect(probeSqliteReadiness(`file:${missingPath}`)).toBe(false)
    expect(existsSync(missingPath)).toBe(false)
  })
})

function testConfig(enabled = false): AppRuntimeConfig {
  return {
    readinessToken,
    databaseUrl: 'file:/tmp/readiness-test.db',
    modules: Object.fromEntries(runtimeModuleIds.map((moduleId) => [moduleId, { enabled }]))
  } as unknown as AppRuntimeConfig
}

function providerGuardedConfig(enabled: boolean): AppRuntimeConfig {
  const config = testConfig(enabled) as unknown as Record<string, unknown>
  return new Proxy(config, {
    get(target, property, receiver) {
      if (!['readinessToken', 'databaseUrl', 'modules'].includes(String(property))) {
        throw new Error(`Readiness accessed optional provider configuration: ${String(property)}`)
      }
      return Reflect.get(target, property, receiver)
    }
  }) as unknown as AppRuntimeConfig
}
