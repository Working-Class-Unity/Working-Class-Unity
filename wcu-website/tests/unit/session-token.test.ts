import { describe, expect, it } from 'vitest'

import { decodeSessionToken, encodeSessionToken } from '../../server/lib/auth/session'
import type { SessionUser } from '../../shared/types/auth'

describe('Session token helpers', () => {
  const user: SessionUser = {
    userId: 'u_1',
    email: 'member@example.com',
    role: 'member',
    duesPaidThrough: '2026-02-01T00:00:00.000Z',
  }
  const secret = 'test-secret-value'

  it('encodes and decodes a token roundtrip', () => {
    const token = encodeSessionToken(user, secret, 300)
    const decoded = decodeSessionToken(token, secret)

    expect(decoded).toEqual(user)
  })

  it('returns null for tampered tokens', () => {
    const token = encodeSessionToken(user, secret, 300)
    const [payload, signature] = token.split('.')
    const tamperedSignature = signature?.replace(/^./, (char) => (char === 'a' ? 'b' : 'a'))
    const tampered = `${payload}.${tamperedSignature}`

    expect(decodeSessionToken(tampered, secret)).toBeNull()
  })

  it('returns null for expired tokens', () => {
    const expiredToken = encodeSessionToken(user, secret, -1)

    expect(decodeSessionToken(expiredToken, secret)).toBeNull()
  })
})
