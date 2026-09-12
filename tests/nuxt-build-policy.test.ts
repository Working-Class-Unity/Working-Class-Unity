import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'

interface TestedNuxtConfig {
  experimental?: {
    nitroAutoImports?: boolean
  }
  future?: {
    compatibilityVersion?: number
  }
  nitro?: {
    experimental?: {
      envExpansion?: boolean
    }
  }
  sentry?: {
    errorHandler?: (error: Error) => void
    sourcemaps?: {
      disable?: boolean
      ignore?: string | string[]
    }
  }
  sourcemap?: {
    client?: boolean | 'hidden'
    server?: boolean | 'hidden'
  }
  security?: {
    allowedMethodsRestricter?: unknown
    basicAuth?: unknown
    contentSecurityPolicyReportOnly?: unknown
    corsHandler?: unknown
    csrf?: unknown
    enabled?: unknown
    headers?: {
      crossOriginEmbedderPolicy?: unknown
    }
    hidePoweredBy?: unknown
    nonce?: unknown
    rateLimiter?: unknown
    removeLoggers?: unknown
    requestSizeLimiter?: unknown
    sri?: unknown
    ssg?: unknown
    xssValidator?: unknown
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('Nuxt build policy', () => {
  it('keeps the committed build environment assignment-free', () => {
    const buildEnvironment = readFileSync(new URL('../.env.build', import.meta.url), 'utf8')
    expect(parseEnv(buildEnvironment)).toEqual({})
  })

  it('disables Nitro environment expansion in the evaluated Nuxt config', async () => {
    const config = await loadNuxtConfig({ sentryAuthToken: '' })
    expect(config.nitro?.experimental?.envExpansion).toBe(false)
  })

  it('adopts Nuxt 5 defaults while retaining the reviewed Nitro autoimport contract', async () => {
    const config = await loadNuxtConfig({ sentryAuthToken: '' })

    expect(config.future?.compatibilityVersion).toBe(5)
    expect(config.experimental?.nitroAutoImports).toBe(true)
  })

  it('delegates only fully expressible standard protections to nuxt-security', async () => {
    const config = await loadNuxtConfig({ sentryAuthToken: '' })

    expect(config.security).toMatchObject({
      allowedMethodsRestricter: false,
      basicAuth: false,
      contentSecurityPolicyReportOnly: false,
      corsHandler: false,
      csrf: false,
      enabled: true,
      headers: { crossOriginEmbedderPolicy: false },
      hidePoweredBy: true,
      nonce: true,
      rateLimiter: false,
      removeLoggers: false,
      requestSizeLimiter: false,
      sri: true,
      ssg: false,
      xssValidator: false
    })
  })

  it.each([
    { label: 'missing token', token: '', org: 'org', project: 'project' },
    { label: 'missing organization', token: 'token', org: '', project: 'project' },
    { label: 'missing project', token: 'token', org: 'org', project: '' },
    { label: 'non-exact token', token: ' token ', org: 'org', project: 'project' }
  ])('generates no source maps for $label', async ({ org, project, token }) => {
    const config = await loadNuxtConfig({
      sentryAuthToken: token,
      sentryOrg: org,
      sentryProject: project
    })

    expect(config.sourcemap).toEqual({ client: false, server: false })
    expect(config.sentry?.sourcemaps?.disable).toBe(true)
  })

  it('uses the official fatal client-only upload lifecycle only for complete production configuration', async () => {
    const config = await loadNuxtConfig({
      sentryAuthToken: 'test-token',
      sentryOrg: 'test-org',
      sentryProject: 'test-project'
    })
    const uploadError = new Error('upload rejected')

    expect(config.sourcemap).toEqual({ client: 'hidden', server: false })
    expect(config.sentry?.sourcemaps).toEqual({
      disable: false,
      ignore: ['**/.nuxt/dist/server/**', '**/.output/server/**']
    })
    expect(() => config.sentry?.errorHandler?.(uploadError)).toThrow(uploadError)
  })
})

async function loadNuxtConfig({
  sentryAuthToken,
  sentryOrg = '',
  sentryProject = ''
}: {
  sentryAuthToken: string
  sentryOrg?: string
  sentryProject?: string
}): Promise<TestedNuxtConfig> {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('SENTRY_AUTH_TOKEN', sentryAuthToken)
  vi.stubEnv('SENTRY_ORG', sentryOrg)
  vi.stubEnv('SENTRY_PROJECT', sentryProject)
  vi.resetModules()
  return (await import('../nuxt.config')).default as TestedNuxtConfig
}
