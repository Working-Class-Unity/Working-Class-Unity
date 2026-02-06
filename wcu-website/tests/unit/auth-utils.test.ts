import { describe, expect, it } from 'vitest'

import { hasMinimumRole, isDuesCurrent } from '../../server/lib/auth/rbac'
import {
  buildMagicLinkUrl,
  generateMagicLinkToken,
  getMagicLinkExpiryIso,
  hashMagicLinkToken,
  isMagicLinkExpired,
  sanitizeNextPath,
} from '../../server/lib/auth/magic-links'
import type { SessionUser } from '../../shared/types/auth'

describe('Magic link helpers', () => {
  it('creates unique base64url tokens', () => {
    const tokenA = generateMagicLinkToken()
    const tokenB = generateMagicLinkToken()

    expect(tokenA).not.toEqual(tokenB)
    expect(tokenA).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(tokenB).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('hashes tokens deterministically', () => {
    const token = 'sample-token'
    const hashA = hashMagicLinkToken(token)
    const hashB = hashMagicLinkToken(token)

    expect(hashA).toEqual(hashB)
    expect(hashA).toMatch(/^[a-f0-9]{64}$/)
  })

  it('builds verify URLs and sanitizes redirect paths', () => {
    const url = buildMagicLinkUrl('https://workingclassunity.com/', 'abc123', '/member')

    expect(url).toContain('/api/v1/auth/verify')
    expect(url).toContain('token=abc123')
    expect(url).toContain('next=%2Fmember')

    expect(sanitizeNextPath('/member')).toBe('/member')
    expect(sanitizeNextPath('https://evil.example')).toBeNull()
    expect(sanitizeNextPath('//evil.example')).toBeNull()
  })

  it('flags expired links', () => {
    const now = new Date('2026-01-01T12:00:00.000Z')
    const expiry = getMagicLinkExpiryIso(now, 20)

    expect(isMagicLinkExpired(expiry, new Date('2026-01-01T12:10:00.000Z'))).toBe(false)
    expect(isMagicLinkExpired(expiry, new Date('2026-01-01T12:30:01.000Z'))).toBe(true)
  })
})

describe('RBAC helpers', () => {
  const session: SessionUser = {
    userId: 'u_1',
    email: 'member@example.com',
    role: 'organizer',
    duesPaidThrough: '2026-01-01T00:00:00.000Z',
  }

  it('compares role priorities correctly', () => {
    expect(hasMinimumRole('organizer', 'member')).toBe(true)
    expect(hasMinimumRole('organizer', 'organizer')).toBe(true)
    expect(hasMinimumRole('organizer', 'treasurer')).toBe(false)
  })

  it('applies dues grace period', () => {
    expect(isDuesCurrent(session, new Date('2026-02-15T00:00:00.000Z'))).toBe(true)
    expect(isDuesCurrent(session, new Date('2026-03-03T00:00:00.000Z'))).toBe(false)
  })
})
