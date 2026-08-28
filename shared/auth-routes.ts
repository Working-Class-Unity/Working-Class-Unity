import { isPublicJoinClaimErrorCallback, isPublicJoinCompletionCallback, parsePublicJoinClaimCallback } from './join'
import type { MembershipDuesOfferingKey } from './billing'

export const authenticatedAppPath = '/app' as const
export const joinReturnPath = '/join' as const
export const membershipJoinReturnPaths = Object.freeze({
  'personal.monthly': '/join?offering=personal.monthly',
  'family.monthly': '/join?offering=family.monthly'
} as const)
export type AuthReturnPath =
  | typeof authenticatedAppPath
  | typeof joinReturnPath
  | (typeof membershipJoinReturnPaths)[MembershipDuesOfferingKey]
  | `/join/complete?id=${string}`

export const authEntryPaths = {
  login: '/login',
  signup: '/signup'
} as const

export type AuthEntryIntent = keyof typeof authEntryPaths
export type AuthCallbackParameter = 'callbackURL' | 'newUserCallbackURL' | 'errorCallbackURL'

export function isAllowedAuthReturnPath(value: unknown): value is AuthReturnPath {
  return (
    value === authenticatedAppPath ||
    value === joinReturnPath ||
    Object.values(membershipJoinReturnPaths).some((path) => path === value) ||
    isPublicJoinCompletionCallback(value)
  )
}

export function membershipJoinReturnPath(offering: MembershipDuesOfferingKey): AuthReturnPath {
  return membershipJoinReturnPaths[offering]
}

export function resolveAuthCallbacks(intent: AuthEntryIntent, returnTo: AuthReturnPath = authenticatedAppPath) {
  return {
    callbackURL: returnTo,
    newUserCallbackURL: returnTo,
    errorCallbackURL: authEntryPaths[intent]
  } as const
}

export function isAllowedAuthCallback(parameter: AuthCallbackParameter, value: unknown): value is string {
  if (typeof value !== 'string') return false

  if (parameter === 'errorCallbackURL') {
    return value === authEntryPaths.login || value === authEntryPaths.signup || isPublicJoinClaimErrorCallback(value)
  }

  return isAllowedAuthReturnPath(value) || parsePublicJoinClaimCallback(value) !== null
}
