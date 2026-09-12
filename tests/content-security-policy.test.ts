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

  it('does not grant script, frame, or connection access to removed account providers', () => {
    const base = createBaseContentSecurityPolicy(true)
    const extended = withBrowserProviderSources(base, { sentryDsn: '' })

    expect(extended).toEqual(base)
    expect(extended).not.toBe(base)
    expect(extended['frame-src']).toEqual(["'none'"])
  })

  it('adds only the configured Sentry DSN origin without disclosing DSN credentials', () => {
    const base = createBaseContentSecurityPolicy(true)
    const extended = withBrowserProviderSources(base, {
      sentryDsn: 'https://public-key@o123.ingest.sentry.io/456?ignored=yes'
    })

    expect(extended).toEqual({
      ...base,
      'connect-src': ["'self'", 'https://o123.ingest.sentry.io']
    })
    expect(base['connect-src']).toEqual(["'self'"])
    expect(JSON.stringify(extended)).not.toContain('public-key')
    expect(JSON.stringify(extended)).not.toContain('/456')
  })

  it('fails closed when a configured browser Sentry DSN is invalid', () => {
    expect(() => withBrowserProviderSources(createBaseContentSecurityPolicy(true), { sentryDsn: 'not-a-url' })).toThrow(
      TypeError
    )
  })
})
