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

  it('always allows the documented Turnstile script and frame origin', () => {
    const base = createBaseContentSecurityPolicy(true)
    const extended = withBrowserProviderSources(base, providerConfig())

    expect(extended).toEqual({
      ...base,
      'frame-src': ['https://challenges.cloudflare.com'],
      'script-src': ["'self'", "'strict-dynamic'", "'nonce-{{nonce}}'", 'https://challenges.cloudflare.com']
    })
    expect(extended).not.toBe(base)
  })

  it('adds only the configured Sentry DSN origin to the always-active provider policy', () => {
    const base = createBaseContentSecurityPolicy(true)
    const extended = withBrowserProviderSources(
      base,
      providerConfig({
        sentryDsn: 'https://public-key@o123.ingest.sentry.io/456?ignored=yes'
      })
    )

    expect(extended).toEqual({
      ...base,
      'connect-src': ["'self'", 'https://o123.ingest.sentry.io'],
      'frame-src': ['https://challenges.cloudflare.com'],
      'script-src': ["'self'", "'strict-dynamic'", "'nonce-{{nonce}}'", 'https://challenges.cloudflare.com']
    })
    expect(base['connect-src']).toEqual(["'self'"])
    expect(JSON.stringify(extended)).not.toContain('public-key')
    expect(JSON.stringify(extended)).not.toContain('/456')
  })

  it('fails closed when a configured browser Sentry DSN is invalid', () => {
    expect(() =>
      withBrowserProviderSources(createBaseContentSecurityPolicy(true), providerConfig({ sentryDsn: 'not-a-url' }))
    ).toThrow(TypeError)
  })

  it('allows only the exact configured R2 bucket origin for browser file capabilities', () => {
    const base = createBaseContentSecurityPolicy(true)
    const fileRequestOrigin = 'https://private-files.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.r2.cloudflarestorage.com'
    const extended = withBrowserProviderSources(base, providerConfig({ fileRequestOrigin }))

    expect(extended['connect-src']).toEqual(["'self'", fileRequestOrigin])
    expect(() =>
      withBrowserProviderSources(base, providerConfig({ fileRequestOrigin: `${fileRequestOrigin}/objects` }))
    ).toThrow('exact HTTPS origin')
  })
})

function providerConfig({
  sentryDsn = '',
  fileRequestOrigin = ''
}: {
  sentryDsn?: string
  fileRequestOrigin?: string
} = {}) {
  return { sentryDsn, fileRequestOrigin }
}
