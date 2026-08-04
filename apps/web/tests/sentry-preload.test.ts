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
  it('fails startup when Observability is enabled without an early Sentry client', async () => {
    const plugin = await loadPlugin({ observabilityEnabled: true, preloaded: false })
    expect(() => plugin()).toThrow('Sentry must be preloaded before the production application starts')
  })

  it('allows startup after Sentry was preloaded', async () => {
    const plugin = await loadPlugin({ observabilityEnabled: true, preloaded: true })
    expect(() => plugin()).not.toThrow()
  })

  it('remains inert when Observability is disabled', async () => {
    const plugin = await loadPlugin({ observabilityEnabled: false, preloaded: false })
    expect(() => plugin()).not.toThrow()
  })
})

async function loadPlugin({
  observabilityEnabled,
  preloaded
}: {
  observabilityEnabled: boolean
  preloaded: boolean
}): Promise<() => void> {
  mocks.getClient.mockReturnValue(preloaded ? {} : undefined)
  mocks.getAppRuntimeConfig.mockReturnValue({
    modules: { observability: { enabled: observabilityEnabled } }
  })
  vi.stubGlobal('defineNitroPlugin', (plugin: () => void) => plugin)

  return (await import('../server/plugins/01-observability-preload')).default as () => void
}
