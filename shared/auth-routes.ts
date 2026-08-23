export const authenticatedAppPath = '/app' as const

export const authEntryPaths = {
  login: '/login',
  signup: '/signup'
} as const

export type AuthEntryIntent = keyof typeof authEntryPaths
export type AuthCallbackParameter = 'callbackURL' | 'newUserCallbackURL' | 'errorCallbackURL'

export function resolveAuthCallbacks(intent: AuthEntryIntent) {
  return {
    callbackURL: authenticatedAppPath,
    newUserCallbackURL: authenticatedAppPath,
    errorCallbackURL: authEntryPaths[intent]
  } as const
}

export function isAllowedAuthCallback(parameter: AuthCallbackParameter, value: unknown): value is string {
  if (typeof value !== 'string') return false

  if (parameter === 'errorCallbackURL') {
    return value === authEntryPaths.login || value === authEntryPaths.signup
  }

  return value === authenticatedAppPath
}
