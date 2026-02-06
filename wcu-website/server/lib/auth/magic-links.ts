import { createHash, randomBytes } from 'node:crypto'

const DEFAULT_MAGIC_LINK_TTL_MINUTES = 20
const MAGIC_LINK_TOKEN_BYTES = 32

export function generateMagicLinkToken(): string {
  return randomBytes(MAGIC_LINK_TOKEN_BYTES).toString('base64url')
}

export function hashMagicLinkToken(token: string): string {
  return createHash('sha256').update(token, 'utf-8').digest('hex')
}

export function getMagicLinkTtlMinutes(): number {
  const config = useRuntimeConfig()

  if (typeof config.pocketbaseMagicLinkTtlMinutes !== 'number' || Number.isNaN(config.pocketbaseMagicLinkTtlMinutes)) {
    return DEFAULT_MAGIC_LINK_TTL_MINUTES
  }

  return config.pocketbaseMagicLinkTtlMinutes
}

export function getMagicLinkExpiryIso(now = new Date(), ttlMinutes = DEFAULT_MAGIC_LINK_TTL_MINUTES): string {
  const expires = new Date(now)
  expires.setMinutes(expires.getMinutes() + ttlMinutes)
  return expires.toISOString()
}

export function isMagicLinkExpired(expiresAtIso: string, now = new Date()): boolean {
  const expiresAt = new Date(expiresAtIso)
  if (Number.isNaN(expiresAt.getTime())) return true

  return now > expiresAt
}

export function sanitizeNextPath(next: string | undefined): string | null {
  if (!next || next.length === 0) return null
  if (!next.startsWith('/')) return null
  if (next.startsWith('//')) return null
  if (next.includes('://')) return null

  return next
}

export function buildMagicLinkUrl(origin: string, token: string, next?: string): string {
  const normalizedOrigin = origin.replace(/\/$/, '')
  const url = new URL('/api/v1/auth/verify', normalizedOrigin)
  url.searchParams.set('token', token)

  const safeNext = sanitizeNextPath(next)
  if (safeNext) {
    url.searchParams.set('next', safeNext)
  }

  return url.toString()
}
