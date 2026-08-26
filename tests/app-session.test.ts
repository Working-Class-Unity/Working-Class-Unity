import { describe, expect, it } from 'vitest'
import { appUserIdentity, toAppSession } from '../app/composables/useAppSession'

describe('app-owned session projection', () => {
  it('hides the auth compatibility name and uses only an explicit display name before email fallback', () => {
    const rawSession = {
      user: {
        id: 'profile-user',
        name: 'WCU account',
        email: 'profile@example.test',
        emailVerified: true,
        phoneNumber: '+12095550100',
        phoneNumberVerified: true,
        image: null,
        firstName: 'Private',
        lastName: 'Member',
        displayName: null,
        createdAt: new Date('2026-08-09T00:00:00.000Z'),
        updatedAt: new Date('2026-08-09T00:00:00.000Z')
      },
      session: {
        id: 'profile-session',
        token: 'profile-token',
        userId: 'profile-user',
        expiresAt: new Date('2026-08-10T00:00:00.000Z'),
        createdAt: new Date('2026-08-09T00:00:00.000Z'),
        updatedAt: new Date('2026-08-09T00:00:00.000Z'),
        ipAddress: null,
        userAgent: null
      }
    } as Parameters<typeof toAppSession>[0]

    const projected = toAppSession(rawSession)

    expect(projected?.user).toEqual({
      id: 'profile-user',
      email: 'profile@example.test',
      emailVerified: true,
      phoneNumber: '+12095550100',
      phoneNumberVerified: true,
      image: null,
      displayName: null
    })
    expect(projected?.user).not.toHaveProperty('name')
    expect(projected?.user).not.toHaveProperty('firstName')
    expect(projected?.user).not.toHaveProperty('lastName')
    expect(appUserIdentity(projected!.user)).toBe('profile@example.test')
    expect(appUserIdentity({ ...projected!.user, displayName: 'Union Member' })).toBe('Union Member')
  })

  it('never projects a phone-only placeholder email', () => {
    const digest = 'a'.repeat(64)
    const rawSession = {
      user: {
        id: 'phone-user',
        name: 'WCU account',
        email: `phone-${digest}@accounts.invalid`,
        emailVerified: false,
        phoneNumber: '+12095550101',
        phoneNumberVerified: true,
        image: null,
        firstName: null,
        lastName: null,
        displayName: null,
        createdAt: new Date('2026-08-09T00:00:00.000Z'),
        updatedAt: new Date('2026-08-09T00:00:00.000Z')
      },
      session: {
        id: 'phone-session',
        token: 'phone-token',
        userId: 'phone-user',
        expiresAt: new Date('2026-08-10T00:00:00.000Z'),
        createdAt: new Date('2026-08-09T00:00:00.000Z'),
        updatedAt: new Date('2026-08-09T00:00:00.000Z'),
        ipAddress: null,
        userAgent: null
      }
    } as Parameters<typeof toAppSession>[0]

    const projected = toAppSession(rawSession)

    expect(projected?.user.email).toBeNull()
    expect(projected?.user.emailVerified).toBe(false)
    expect(appUserIdentity(projected!.user)).toBe('+12095550101')
    expect(JSON.stringify(projected)).not.toContain('accounts.invalid')
  })
})
