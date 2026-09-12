const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])
const recognizedFetchSites = new Set(['cross-site', 'same-origin', 'same-site', 'none'])
const observabilityTokenPaths = new Set(['/api/observability/client-test', '/api/observability/test-error'])

export const crossOriginRequestBlockedCode = 'CROSS_ORIGIN_REQUEST_BLOCKED' as const

export type CommandOriginSignals = Readonly<{
  origin?: string
  referer?: string
  secFetchSite?: string
}>

/**
 * Only the two operational test routes bypass browser origin checks; each
 * authenticates its dedicated operator token before doing any work.
 */
export function requiresCommandOriginPolicy(method: string, pathname: string): boolean {
  const normalizedMethod = method.toUpperCase()

  if (safeMethods.has(normalizedMethod) || !isApiPath(pathname)) return false
  return !isCommandOriginExempt(normalizedMethod, pathname)
}

/**
 * App-owned command-origin policy derived from OWASP's Origin/Referer checks
 * and Fetch Metadata's Sec-Fetch-Site relationship. Every provided recognized
 * signal must agree; an unknown future Fetch Metadata value is ignored only
 * when Origin or Referer independently verifies the configured origin.
 */
export function isCommandOriginAllowed(signals: CommandOriginSignals, configuredAppUrl: string): boolean {
  const configuredOrigin = httpOrigin(configuredAppUrl)
  let verified = false

  if (signals.origin !== undefined) {
    if (!isExactOrigin(signals.origin, configuredOrigin)) return false
    verified = true
  }

  if (signals.referer !== undefined) {
    if (!hasOrigin(signals.referer, configuredOrigin)) return false
    verified = true
  }

  if (signals.secFetchSite !== undefined) {
    if (recognizedFetchSites.has(signals.secFetchSite)) {
      if (signals.secFetchSite !== 'same-origin') return false
      verified = true
    }
  }

  return verified
}

export function isCommandOriginExempt(method: string, pathname: string): boolean {
  return method === 'POST' && observabilityTokenPaths.has(pathname)
}

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/')
}

function isExactOrigin(value: string, expectedOrigin: string): boolean {
  try {
    const parsed = new URL(value)
    return (
      isHttpUrl(parsed) &&
      !parsed.username &&
      !parsed.password &&
      value === parsed.origin &&
      parsed.origin === expectedOrigin
    )
  } catch {
    return false
  }
}

function hasOrigin(value: string, expectedOrigin: string): boolean {
  try {
    const parsed = new URL(value)
    return isHttpUrl(parsed) && !parsed.username && !parsed.password && parsed.origin === expectedOrigin
  } catch {
    return false
  }
}

function httpOrigin(value: string): string {
  const parsed = new URL(value)
  if (!isHttpUrl(parsed)) throw new TypeError('Configured application URL must use HTTP(S)')
  return parsed.origin
}

function isHttpUrl(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:'
}
