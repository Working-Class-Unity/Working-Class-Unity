import { isInvitationReturnPath } from './invitation-path'

export const authenticatedAppPath = '/app' as const

export const authEntryPaths = {
  login: '/login',
  signup: '/signup'
} as const

export type AuthEntryIntent = keyof typeof authEntryPaths
export type AuthCallbackParameter = 'callbackURL' | 'newUserCallbackURL' | 'errorCallbackURL'

export function resolveAuthCallbacks(intent: AuthEntryIntent, returnTo: unknown) {
  const successPath = isInvitationReturnPath(returnTo) ? returnTo : authenticatedAppPath

  return {
    callbackURL: successPath,
    newUserCallbackURL: successPath,
    errorCallbackURL: authEntryPaths[intent]
  } as const
}

export function isAllowedAuthCallback(parameter: AuthCallbackParameter, value: unknown): value is string {
  if (typeof value !== 'string') return false

  if (parameter === 'errorCallbackURL') {
    return value === authEntryPaths.login || value === authEntryPaths.signup
  }

  return value === authenticatedAppPath || isInvitationReturnPath(value)
}
