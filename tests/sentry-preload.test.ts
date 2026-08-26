import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAppRuntimeConfig: vi.fn(),
  getClient: vi.fn()
}))

vi.mock('@sentry/nuxt', () => ({ getClient: mocks.getClient }))
vi.mock('../server/utils/runtime', () => ({ getAppRuntimeConfig: mocks.getAppRuntimeConfig }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('production Sentry preload invariant', () => {
  it('fails production startup without an early Sentry client', async () => {
    const plugin = await loadPlugin({ nodeEnvironment: 'production', preloaded: false, enabled: true })
    expect(() => plugin()).toThrow('Sentry must be preloaded before the production application starts')
  })

  it('allows startup after Sentry was preloaded', async () => {
    const plugin = await loadPlugin({ nodeEnvironment: 'production', preloaded: true, enabled: true })
    expect(() => plugin()).not.toThrow()
  })

  it('allows production startup without a preload when Sentry is disabled', async () => {
    const plugin = await loadPlugin({ nodeEnvironment: 'production', preloaded: false, enabled: false })
    expect(() => plugin()).not.toThrow()
  })

  it('does not require the production preload outside production', async () => {
    const plugin = await loadPlugin({ nodeEnvironment: 'test', preloaded: false, enabled: true })
    expect(() => plugin()).not.toThrow()
  })
})

async function loadPlugin({
  nodeEnvironment,
  preloaded,
  enabled
}: {
  nodeEnvironment: string
  preloaded: boolean
  enabled: boolean
}): Promise<() => void> {
  vi.stubEnv('NODE_ENV', nodeEnvironment)
  mocks.getClient.mockReturnValue(preloaded ? {} : undefined)
  mocks.getAppRuntimeConfig.mockReturnValue({ sentryDsn: enabled ? 'https://server@example.ingest.sentry.io/1' : '' })
  vi.stubGlobal('defineNitroPlugin', (plugin: () => void) => plugin)

  return (await import('../server/plugins/01-observability-preload')).default as () => void
}
