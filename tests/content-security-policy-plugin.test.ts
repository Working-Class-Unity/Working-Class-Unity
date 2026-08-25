import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContentSecurityPolicyValue } from 'nuxt-security'
import { createBaseContentSecurityPolicy } from '../shared/content-security-policy'

const runtimeMocks = vi.hoisted(() => ({ getAppRuntimeConfig: vi.fn() }))

vi.mock('../server/utils/runtime', () => ({
  getAppRuntimeConfig: runtimeMocks.getAppRuntimeConfig
}))

type RouteRules = Record<
  string,
  { headers?: { contentSecurityPolicy?: ContentSecurityPolicyValue; [key: string]: unknown } }
>
type RouteRulesHook = (routeRules: RouteRules) => unknown
type NitroPlugin = (nitroApp: { hooks: { hook: (name: string, callback: RouteRulesHook) => void } }) => void

describe('browser provider CSP plugin', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    runtimeMocks.getAppRuntimeConfig.mockReset()
  })

  it('registers the documented hook without widening CSP for stale user-file R2 configuration', async () => {
    runtimeMocks.getAppRuntimeConfig.mockReturnValue({
      files: { driver: 'r2' },
      cloudflare: {
        accountId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        r2: {
          bucket: 'private-files',
          endpoint: 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.r2.cloudflarestorage.com'
        }
      },
      public: { sentryDsn: 'https://public-key@o123.ingest.sentry.io/456' }
    })
    vi.stubGlobal('defineNitroPlugin', (plugin: NitroPlugin) => plugin)

    const plugin = (await import('../server/plugins/01-content-security-policy')).default as unknown as NitroPlugin
    let hookName = ''
    let routeRulesHook: RouteRulesHook | undefined
    plugin({
      hooks: {
        hook(name, callback) {
          hookName = name
          routeRulesHook = callback
        }
      }
    })

    const base = createBaseContentSecurityPolicy(true)
    const routeRules: RouteRules = { '/**': { headers: { contentSecurityPolicy: base } } }
    expect(hookName).toBe('nuxt-security:routeRules')
    if (!routeRulesHook) throw new Error('The provider policy hook was not registered')
    await routeRulesHook(routeRules)

    expect(routeRules['/**']?.headers?.contentSecurityPolicy).toEqual({
      ...base,
      'connect-src': ["'self'", 'https://o123.ingest.sentry.io'],
      'frame-src': ['https://challenges.cloudflare.com'],
      'script-src': ["'self'", "'strict-dynamic'", "'nonce-{{nonce}}'", 'https://challenges.cloudflare.com']
    })
  })
})
