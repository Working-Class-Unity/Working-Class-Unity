import { APIError, createAuthMiddleware } from 'better-auth/api'
import { isAllowedAuthCallback, type AuthCallbackParameter } from '../../../shared/auth-routes'
import { turnstileActions, turnstileHeaderName } from '../../../shared/turnstile'
import { createMagicLinkEmail, type TransactionalEmailSender } from '../../services/email'
import { verifyTurnstileToken } from '../../services/security/turnstile'
import type { AppRuntimeConfig } from '../runtime'

export const disabledPasswordAuthPaths = [
  '/sign-up/email',
  '/sign-in/email',
  '/request-password-reset',
  '/reset-password',
  '/change-password',
  '/verify-password'
] as const

const callbackParameters = [
  'callbackURL',
  'newUserCallbackURL',
  'errorCallbackURL'
] as const satisfies readonly AuthCallbackParameter[]

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

export function createPasswordlessAuthBeforeHook(authUrl: string) {
  const authOrigin = new URL(authUrl).origin

  return createAuthMiddleware(async (context) => {
    if (context.path === '/sign-in/magic-link') {
      const requestOrigin = context.headers?.get('origin')
      if (requestOrigin && requestOrigin !== authOrigin) {
        throw new APIError('FORBIDDEN', {
          code: 'INVALID_ORIGIN',
          message: 'Invalid origin'
        })
      }
    }

    // disabledPaths matches exact endpoint paths. Better Auth also registers a
    // token-bearing password-reset route, so reject that parameterized endpoint
    // before it can run.
    if (context.path === '/reset-password/:token' || context.path?.startsWith('/reset-password/')) {
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

export function createMagicLinkTurnstileBeforeHook(config: AppRuntimeConfig) {
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

function hasStatusCode(error: unknown, statusCode: number): boolean {
  return Boolean(error && typeof error === 'object' && 'statusCode' in error && error.statusCode === statusCode)
}
