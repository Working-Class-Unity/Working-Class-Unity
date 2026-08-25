import { APIError, createAuthMiddleware } from 'better-auth/api'
import { isAllowedAuthCallback, type AuthCallbackParameter } from '../../../shared/auth-routes'
import { turnstileActions, turnstileHeaderName } from '../../../shared/turnstile'
import { createMagicLinkEmail, type TransactionalEmailSender } from '../../services/email'
import { verifyTurnstileToken } from '../../services/security/turnstile'
import type { AppRuntimeConfig } from '../runtime'

const disabledPasswordAuthPaths = [
  '/sign-up/email',
  '/sign-in/email',
  '/request-password-reset',
  '/reset-password',
  '/change-password',
  '/verify-password'
] as const

export const disabledNonMagicLinkAuthPaths = [
  ...disabledPasswordAuthPaths,
  '/sign-in/social',
  '/callback/:id',
  '/link-social',
  '/list-accounts',
  '/unlink-account',
  '/get-access-token',
  '/refresh-token',
  '/account-info'
] as const

const callbackParameters = [
  'callbackURL',
  'newUserCallbackURL',
  'errorCallbackURL'
] as const satisfies readonly AuthCallbackParameter[]

const authenticationCompatibilityName = 'WCU account'

export { isAllowedAuthCallback }

export function createMagicLinkDelivery(
  appName: string,
  getSender: () => TransactionalEmailSender
): (input: { email: string; url: string }) => Promise<void> {
  return async ({ email, url }) => {
    try {
      await getSender().send(
        createMagicLinkEmail({
          to: email,
          url,
          appName
        })
      )
    } catch {
      throw new APIError('SERVICE_UNAVAILABLE', {
        code: 'EMAIL_DELIVERY_UNAVAILABLE',
        message: 'Email delivery is temporarily unavailable.'
      })
    }
  }
}

function createPasswordlessAuthBeforeHook(authUrl: string) {
  const authOrigin = new URL(authUrl).origin

  return createAuthMiddleware(async (context) => {
    if (context.path === '/sign-in/magic-link') {
      // Better Auth 1.6.23 persists its core `name` during first magic-link
      // verification. Keep that compatibility field server-owned so auth
      // requests contain no user-facing profile data.
      if (context.body) context.body.name = authenticationCompatibilityName
      const requestOrigin = context.headers?.get('origin')
      if (requestOrigin && requestOrigin !== authOrigin) {
        throw new APIError('FORBIDDEN', {
          code: 'INVALID_ORIGIN',
          message: 'Invalid origin'
        })
      }
    }

    if (context.path === '/update-user' && context.body && 'name' in context.body) {
      throw new APIError('BAD_REQUEST', {
        code: 'INVALID_PROFILE_UPDATE',
        message: 'Invalid profile update.'
      })
    }

    // disabledPaths matches exact request paths. Reject parameterized password
    // reset and OAuth callback routes before either handler can run.
    if (context.path === '/reset-password/:token' || context.path?.startsWith('/reset-password/')) {
      throw new APIError('NOT_FOUND', {
        code: 'NOT_FOUND',
        message: 'Not Found'
      })
    }

    if (context.path === '/callback/:id' || context.path?.startsWith('/callback/')) {
      throw new APIError('NOT_FOUND', {
        code: 'NOT_FOUND',
        message: 'Not Found'
      })
    }

    const usesAuthCallbacks = context.path === '/sign-in/magic-link' || context.path === '/magic-link/verify'
    if (!usesAuthCallbacks) return

    const callbackSource = context.path === '/sign-in/magic-link' ? context.body : context.query

    for (const parameter of callbackParameters) {
      const value = callbackSource?.[parameter]

      if (!isAllowedAuthCallback(parameter, value)) {
        throw new APIError('BAD_REQUEST', {
          code: 'INVALID_REQUEST',
          message: 'Invalid request.'
        })
      }
    }
  })
}

function createMagicLinkTurnstileBeforeHook(config: AppRuntimeConfig) {
  return createAuthMiddleware(async (context) => {
    if (context.path !== '/sign-in/magic-link') return

    try {
      await verifyTurnstileToken({
        token: context.headers?.get(turnstileHeaderName) ?? undefined,
        expectedAction: turnstileActions.magicLink,
        config
      })
    } catch (error) {
      if (hasStatusCode(error, 400)) {
        throw new APIError('BAD_REQUEST', {
          code: 'TURNSTILE_CHALLENGE_REJECTED',
          message: 'Security check failed. Try again.'
        })
      }

      throw new APIError('SERVICE_UNAVAILABLE', {
        code: 'TURNSTILE_UNAVAILABLE',
        message: 'Security check is temporarily unavailable. Please try again.'
      })
    }
  })
}

export function createAuthenticationBeforeHook(config: AppRuntimeConfig) {
  const passwordlessBeforeHook = createPasswordlessAuthBeforeHook(config.betterAuth.url)
  const magicLinkTurnstileBeforeHook = createMagicLinkTurnstileBeforeHook(config)

  return createAuthMiddleware(async (context) => {
    await passwordlessBeforeHook(context)
    await magicLinkTurnstileBeforeHook(context)
  })
}

function hasStatusCode(error: unknown, statusCode: number): boolean {
  return Boolean(error && typeof error === 'object' && 'statusCode' in error && error.statusCode === statusCode)
}
