import { describe, expect, it } from 'vitest'
import {
  authenticatedAppPath,
  authEntryPaths,
  isAllowedAuthCallback,
  resolveAuthCallbacks,
  type AuthCallbackParameter
} from '../shared/auth-routes'

describe('app-owned authentication routes', () => {
  it('resolves ordinary login and signup intent to the personal app with an intent-specific error route', () => {
    expect(resolveAuthCallbacks('login')).toEqual({
      callbackURL: '/app',
      newUserCallbackURL: '/app',
      errorCallbackURL: '/login'
    })
    expect(resolveAuthCallbacks('signup')).toEqual({
      callbackURL: '/app',
      newUserCallbackURL: '/app',
      errorCallbackURL: '/signup'
    })
    expect(authenticatedAppPath).toBe('/app')
    expect(authEntryPaths).toEqual({ login: '/login', signup: '/signup' })
  })

  it('applies distinct allowlists to success and error callback parameters', () => {
    const successParameters = ['callbackURL', 'newUserCallbackURL'] as const satisfies readonly AuthCallbackParameter[]

    for (const parameter of successParameters) {
      expect(isAllowedAuthCallback(parameter, '/app')).toBe(true)
      expect(isAllowedAuthCallback(parameter, '/invite/Abc_123-xyz')).toBe(false)
      expect(isAllowedAuthCallback(parameter, '/login')).toBe(false)
      expect(isAllowedAuthCallback(parameter, '/signup')).toBe(false)
    }

    expect(isAllowedAuthCallback('errorCallbackURL', '/login')).toBe(true)
    expect(isAllowedAuthCallback('errorCallbackURL', '/signup')).toBe(true)
    expect(isAllowedAuthCallback('errorCallbackURL', '/app')).toBe(false)
    expect(isAllowedAuthCallback('errorCallbackURL', '/invite/Abc_123-xyz')).toBe(false)

    for (const parameter of [...successParameters, 'errorCallbackURL'] as const) {
      for (const value of [
        '/',
        '/auth',
        '/billing',
        '/invite/',
        '/invite/id?next=/billing',
        '//hostile.example.test',
        'https://hostile.example.test/callback',
        7,
        null
      ]) {
        expect(isAllowedAuthCallback(parameter, value), `${parameter}: ${String(value)}`).toBe(false)
      }
    }
  })
})
