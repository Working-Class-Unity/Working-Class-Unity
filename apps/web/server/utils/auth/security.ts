import type { BetterAuthOptions } from 'better-auth'
import type { AppRuntimeConfig } from '../runtime'

type AuthLogWriter = (message: string) => void

export const accountDeletionFreshAgeSeconds = 60 * 60 * 24

export function createRedactedBetterAuthLogger(
  write: AuthLogWriter = (message) => {
    console.error(message)
  }
): NonNullable<BetterAuthOptions['logger']> {
  return {
    level: 'error',
    // Better Auth can pass provider error objects and response details in the
    // remaining arguments. Emit only a fixed severity event; application-owned
    // HTTP errors carry the stable user-facing codes.
    log: (level) => write(`[better-auth] ${level} event`)
  }
}

/**
 * Better Auth 1.6.23 security policy for the single-process baseline.
 *
 * Official references:
 * - https://better-auth.com/docs/reference/security
 * - https://better-auth.com/docs/concepts/cookies
 * - https://better-auth.com/docs/concepts/rate-limit
 * - https://developers.cloudflare.com/fundamentals/reference/http-headers/
 *
 * Pinned 1.6.23 source commit: 9dfceee14021fc15a2fb93023f39635f25b0b5ba.
 * Exact source links and the public-doc/source distinction are maintained in
 * docs/baseline/README.md and must be reverified when the package pin changes.
 */
export function createBetterAuthSecurityOptions(config: AppRuntimeConfig) {
  const authOrigin = new URL(config.betterAuth.url).origin
  const secureCookies = new URL(authOrigin).protocol === 'https:'

  return {
    baseURL: authOrigin,
    basePath: '/api/auth',
    secret: config.betterAuth.secret,
    // Startup requires the app and auth origins to match. Better Auth always
    // includes baseURL's origin, so no wildcard or extra origin is needed.
    trustedOrigins: [],
    logger: createRedactedBetterAuthLogger(),
    advanced: {
      disableCSRFCheck: false,
      disableOriginCheck: false,
      trustedProxyHeaders: false,
      useSecureCookies: secureCookies,
      // Host-only cookies are the baseline. Sharing sessions with sibling
      // subdomains is a separate deployment feature with a larger trust scope.
      crossSubDomainCookies: {
        enabled: false
      },
      defaultCookieAttributes: {
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secure: secureCookies
      },
      ipAddress: {
        disableIpTracking: false,
        // This exact allowlist makes X-Forwarded-For and X-Real-IP inert.
        // Cloudflare documents CF-Connecting-IP as the edge-to-origin visitor
        // address; pinned Better Auth separately rejects a comma-delimited
        // value when no trusted proxy chain is configured.
        ipAddressHeaders: ['cf-connecting-ip']
      }
    },
    telemetry: {
      enabled: false,
      debug: false
    },
    rateLimit: {
      enabled: true,
      // Explicit app policy; do not inherit version-dependent defaults.
      max: 100,
      storage: 'memory',
      window: 60
    },
    session: {
      // Better Auth's delete-user route uses this exact age when no password
      // or verification token is supplied. The app deletion command supplies
      // neither, so authentication at least 24 hours old is rejected.
      freshAge: accountDeletionFreshAgeSeconds
    }
  } satisfies BetterAuthOptions
}
