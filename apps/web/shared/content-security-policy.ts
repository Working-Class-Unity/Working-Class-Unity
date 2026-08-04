import type { ContentSecurityPolicyValue } from 'nuxt-security'

const turnstileOrigin = 'https://challenges.cloudflare.com'

type BrowserProviderConfig = Readonly<{
  modules: {
    observability: { enabled: boolean }
    turnstile: { enabled: boolean }
  }
  public: {
    sentryDsn: string
  }
}>

export function createBaseContentSecurityPolicy(isProduction: boolean): ContentSecurityPolicyValue {
  return {
    'base-uri': ["'none'"],
    'default-src': ["'none'"],
    'connect-src': ["'self'"],
    'font-src': ["'self'", 'data:'],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'frame-src': ["'none'"],
    'img-src': ["'self'", 'data:'],
    'manifest-src': ["'self'"],
    'media-src': ["'self'"],
    'object-src': ["'none'"],
    'script-src': ["'self'", "'strict-dynamic'", "'nonce-{{nonce}}'"],
    'script-src-attr': ["'none'"],
    // Vite and Nuxt DevTools inject development-only style elements after the
    // document nonce is issued. The pinned module documents that a nonce would
    // cancel this fallback, so production alone uses nonce-authorized styles.
    'style-src': isProduction ? ["'self'", "'nonce-{{nonce}}'"] : ["'self'", "'unsafe-inline'"],
    // Reka UI positions floating menus with element style properties. This
    // allowance does not permit inline scripts or untrusted style elements.
    'style-src-attr': ["'unsafe-inline'"],
    'worker-src': ["'self'"],
    'upgrade-insecure-requests': isProduction
  }
}

export function withBrowserProviderSources(
  policy: ContentSecurityPolicyValue,
  config: BrowserProviderConfig
): ContentSecurityPolicyValue {
  const extended = structuredClone(policy)

  if (config.modules.observability.enabled) {
    appendSource(extended, 'connect-src', new URL(config.public.sentryDsn).origin)
  }

  if (config.modules.turnstile.enabled) {
    appendSource(extended, 'script-src', turnstileOrigin)
    appendSource(extended, 'frame-src', turnstileOrigin)
  }

  return extended
}

function appendSource(
  policy: ContentSecurityPolicyValue,
  directive: 'connect-src' | 'frame-src' | 'script-src',
  source: string
) {
  const configured = policy[directive]
  if (!Array.isArray(configured)) {
    throw new TypeError(`The ${directive} CSP directive must be an explicit source list`)
  }

  const sources = configured.filter((value) => value !== "'none'")
  if (!sources.includes(source)) sources.push(source)
  policy[directive] = sources
}
