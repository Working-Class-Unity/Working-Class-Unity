import { describe, expect, it } from 'vitest'
import { createBaseContentSecurityPolicy, withBrowserProviderSources } from '../shared/content-security-policy'

describe('browser Content Security Policy', () => {
  it('uses nonce-authorized production scripts and styles without broad browser-provider access', () => {
    const policy = createBaseContentSecurityPolicy(true)

    expect(policy['default-src']).toEqual(["'none'"])
    expect(policy['script-src']).toEqual(["'self'", "'strict-dynamic'", "'nonce-{{nonce}}'"])
    expect(policy['script-src-attr']).toEqual(["'none'"])
    expect(policy['style-src']).toEqual(["'self'", "'nonce-{{nonce}}'"])
    expect(policy['style-src-attr']).toEqual(["'unsafe-inline'"])
    expect(policy['connect-src']).toEqual(["'self'"])
    expect(policy['frame-src']).toEqual(["'none'"])
    expect(policy['upgrade-insecure-requests']).toBe(true)
  })

  it('keeps development style injection functional without weakening production styles', () => {
    expect(createBaseContentSecurityPolicy(true)['upgrade-insecure-requests']).toBe(true)
    expect(createBaseContentSecurityPolicy(false)['upgrade-insecure-requests']).toBe(false)
    expect(createBaseContentSecurityPolicy(false)['style-src']).toEqual(["'self'", "'unsafe-inline'"])
    expect(createBaseContentSecurityPolicy(false)['style-src']).not.toContain("'nonce-{{nonce}}'")
  })

  it('leaves disabled browser providers out of the policy', () => {
    const base = createBaseContentSecurityPolicy(true)
    const extended = withBrowserProviderSources(base, providerConfig())

    expect(extended).toEqual(base)
    expect(extended).not.toBe(base)
  })

  it('allows only the Sentry DSN origin when browser observability is enabled', () => {
    const base = createBaseContentSecurityPolicy(true)
    const extended = withBrowserProviderSources(
      base,
      providerConfig({
        observability: true,
        sentryDsn: 'https://public-key@o123.ingest.sentry.io/456?ignored=yes'
      })
    )

    expect(extended).toEqual({ ...base, 'connect-src': ["'self'", 'https://o123.ingest.sentry.io'] })
    expect(base['connect-src']).toEqual(["'self'"])
    expect(JSON.stringify(extended)).not.toContain('public-key')
    expect(JSON.stringify(extended)).not.toContain('/456')
  })

  it('allows the documented Turnstile script and frame origin only when Turnstile is enabled', () => {
    const base = createBaseContentSecurityPolicy(true)
    const extended = withBrowserProviderSources(base, providerConfig({ turnstile: true }))

    expect(extended).toEqual({
      ...base,
      'frame-src': ['https://challenges.cloudflare.com'],
      'script-src': ["'self'", "'strict-dynamic'", "'nonce-{{nonce}}'", 'https://challenges.cloudflare.com']
    })
  })

  it('fails closed when enabled observability has no valid browser DSN', () => {
    expect(() =>
      withBrowserProviderSources(
        createBaseContentSecurityPolicy(true),
        providerConfig({ observability: true, sentryDsn: 'not-a-url' })
      )
    ).toThrow(TypeError)
  })
})

function providerConfig({
  observability = false,
  sentryDsn = '',
  turnstile = false
}: {
  observability?: boolean
  sentryDsn?: string
  turnstile?: boolean
} = {}) {
  return {
    modules: {
      observability: { enabled: observability },
      turnstile: { enabled: turnstile }
    },
    public: { sentryDsn }
  }
}
