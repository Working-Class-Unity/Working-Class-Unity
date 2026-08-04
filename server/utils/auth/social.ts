import {
  socialProviderManifest,
  socialProviderIds,
  type PublicSocialProviderStates,
  type SocialProviderId
} from '../../../shared/auth-providers'
import type { BetterAuthOptions } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { isAllowedAuthCallback } from '../../../shared/auth-routes'
import { getAppRuntimeConfig, type AppRuntimeConfig } from '../runtime'
import { createMagicLinkTurnstileBeforeHook, createPasswordlessAuthBeforeHook } from './passwordless'

export const disabledSocialAuthPaths = ['/link-social', '/get-access-token', '/refresh-token', '/account-info'] as const

const socialReturnParameters = ['callbackURL', 'newUserCallbackURL', 'errorCallbackURL'] as const
const forbiddenSocialRequestFields = ['idToken', 'scopes', 'requestSignUp', 'loginHint', 'additionalData'] as const

export const socialAccountOptions = {
  // Defense in depth for access/refresh tokens. The database hooks below are
  // authoritative because pinned Better Auth leaves ID tokens unencrypted on
  // ordinary callbacks and direct-token flows have separate persistence paths.
  encryptOAuthTokens: true,
  updateAccountOnSignIn: false,
  storeStateStrategy: 'database',
  skipStateCookieCheck: false,
  storeAccountCookie: false,
  accountLinking: {
    enabled: true,
    // The app selects Better Auth's verified-email policy: both the existing
    // local row and the IdP assertion must be verified. No provider is trusted
    // to bypass the IdP verification signal.
    disableImplicitLinking: false,
    requireLocalEmailVerified: true,
    trustedProviders: [],
    allowDifferentEmails: false,
    // Magic link is the universal fallback and creates no account row, so the
    // only social account can be removed without locking the user out.
    allowUnlinkingAll: true,
    updateUserInfoOnLink: false
  }
} as const satisfies NonNullable<BetterAuthOptions['account']>

export function createSocialProviders(config: AppRuntimeConfig): NonNullable<BetterAuthOptions['socialProviders']> {
  if (!config.socialProviders.google.enabled) return {}

  return {
    google: {
      clientId: config.socialProviders.google.clientId,
      clientSecret: config.socialProviders.google.clientSecret,
      accessType: 'online',
      disableDefaultScope: true,
      disableIdTokenSignIn: true,
      // Google documents `name` under the optional profile scope, while this
      // authentication-only flow intentionally requests only `openid email`.
      // The verified email claim therefore supplies the required local display
      // name when the ID token omits profile claims.
      mapProfileToUser: (profile) => ({
        name: profile.name?.trim() || profile.email
      }),
      scope: [...socialProviderManifest.google.scopes]
    }
  }
}

export function createSocialAuthBeforeHook(config: AppRuntimeConfig) {
  const authOrigin = new URL(config.betterAuth.url).origin

  return createAuthMiddleware(async (context) => {
    if (context.path !== '/sign-in/social') return

    const body = context.body
    if (!body || typeof body !== 'object') {
      throw new APIError('BAD_REQUEST', {
        code: 'INVALID_REQUEST',
        message: 'Invalid request.'
      })
    }

    const requestOrigin = context.headers?.get('origin')
    if (requestOrigin && requestOrigin !== authOrigin) {
      throw new APIError('FORBIDDEN', {
        code: 'INVALID_ORIGIN',
        message: 'Invalid origin'
      })
    }

    if (body.provider !== 'google' || !config.socialProviders.google.enabled) {
      throw new APIError('NOT_FOUND', {
        code: 'PROVIDER_NOT_FOUND',
        message: 'Provider not found'
      })
    }

    for (const field of forbiddenSocialRequestFields) {
      if (body[field] !== undefined) {
        throw new APIError('BAD_REQUEST', {
          code: 'INVALID_REQUEST',
          message: 'Invalid request.'
        })
      }
    }

    for (const parameter of socialReturnParameters) {
      const value = body[parameter]
      if (!isAllowedAuthCallback(parameter, value)) {
        throw new APIError('BAD_REQUEST', {
          code: 'INVALID_REQUEST',
          message: 'Invalid request.'
        })
      }
    }
  })
}

export function createAuthenticationBeforeHook(config: AppRuntimeConfig) {
  const passwordlessBeforeHook = createPasswordlessAuthBeforeHook(config.betterAuth.url)
  const magicLinkTurnstileBeforeHook = createMagicLinkTurnstileBeforeHook(config)
  const socialBeforeHook = createSocialAuthBeforeHook(config)

  return createAuthMiddleware(async (context) => {
    await passwordlessBeforeHook(context)
    await magicLinkTurnstileBeforeHook(context)
    await socialBeforeHook(context)
  })
}

export function createSocialDatabaseHooks(): NonNullable<BetterAuthOptions['databaseHooks']> {
  const stripTokens = async () => ({
    data: {
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null
    }
  })

  return {
    user: {
      create: {
        before: async (user) => {
          if (user.emailVerified !== true) {
            throw new APIError('UNAUTHORIZED', {
              code: 'VERIFIED_EMAIL_REQUIRED',
              message: 'Verified email is required.'
            })
          }
        }
      }
    },
    account: {
      create: { before: stripTokens },
      update: { before: stripTokens }
    }
  }
}

export function getPublicSocialProviderStates(
  config: AppRuntimeConfig = getAppRuntimeConfig()
): PublicSocialProviderStates {
  return Object.freeze(
    Object.fromEntries(
      socialProviderIds.map((providerId) => [
        providerId,
        config.socialProviders[providerId].enabled ? 'ready' : 'disabled'
      ])
    ) as Record<SocialProviderId, 'disabled' | 'ready'>
  )
}
