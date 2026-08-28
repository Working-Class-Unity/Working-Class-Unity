import type { MembershipDuesOfferingKey } from './billing'

export const publicJoinAttemptIdPattern =
  /^join_checkout_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export const publicJoinClaimTokenPattern = /^[A-Za-z0-9_-]{43}$/

export const publicJoinPaths = Object.freeze({
  claim: '/join/claim',
  complete: '/join/complete',
  join: '/join'
})

export type PublicJoinStatus = 'active' | 'check_email' | 'failed' | 'needs_attestation' | 'processing' | 'review'

export type PublicJoinStatusResponse = Readonly<{
  attemptId: string | null
  offering: MembershipDuesOfferingKey | null
  status: PublicJoinStatus
}>

export function isPublicJoinAttemptId(value: unknown): value is string {
  return typeof value === 'string' && publicJoinAttemptIdPattern.test(value)
}

export function isPublicJoinClaimToken(value: unknown): value is string {
  return typeof value === 'string' && publicJoinClaimTokenPattern.test(value)
}

export function publicJoinClaimCallback(attemptId: string, token: string): string {
  if (!isPublicJoinAttemptId(attemptId) || !isPublicJoinClaimToken(token)) {
    throw new TypeError('Invalid public join claim callback')
  }
  const query = new URLSearchParams({ id: attemptId, token })
  return `${publicJoinPaths.claim}?${query.toString()}`
}

export function publicJoinClaimErrorCallback(attemptId: string): string {
  if (!isPublicJoinAttemptId(attemptId)) throw new TypeError('Invalid public join error callback')
  const query = new URLSearchParams({ id: attemptId, status: 'link-error' })
  return `${publicJoinPaths.complete}?${query.toString()}`
}

export function publicJoinCompletionCallback(attemptId: string): string {
  if (!isPublicJoinAttemptId(attemptId)) throw new TypeError('Invalid public join completion callback')
  return `${publicJoinPaths.complete}?${new URLSearchParams({ id: attemptId }).toString()}`
}

export function isPublicJoinCompletionCallback(value: unknown): value is string {
  const url = localUrl(value)
  return Boolean(
    url &&
    url.pathname === publicJoinPaths.complete &&
    !url.hash &&
    hasOnlyQueryKeys(url, ['id']) &&
    isPublicJoinAttemptId(url.searchParams.get('id'))
  )
}

export function parsePublicJoinClaimCallback(value: unknown): Readonly<{ attemptId: string; token: string }> | null {
  const url = localUrl(value)
  if (!url || url.pathname !== publicJoinPaths.claim || url.hash || !hasOnlyQueryKeys(url, ['id', 'token'])) return null
  const attemptId = url.searchParams.get('id')
  const token = url.searchParams.get('token')
  return isPublicJoinAttemptId(attemptId) && isPublicJoinClaimToken(token) ? { attemptId, token } : null
}

export function isPublicJoinClaimErrorCallback(value: unknown): value is string {
  const url = localUrl(value)
  return Boolean(
    url &&
    url.pathname === publicJoinPaths.complete &&
    !url.hash &&
    hasOnlyQueryKeys(url, ['id', 'status']) &&
    isPublicJoinAttemptId(url.searchParams.get('id')) &&
    url.searchParams.get('status') === 'link-error'
  )
}

function localUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || !value.startsWith('/')) return null
  try {
    const parsed = new URL(value, 'https://wcu.invalid')
    return parsed.origin === 'https://wcu.invalid' ? parsed : null
  } catch {
    return null
  }
}

function hasOnlyQueryKeys(url: URL, expected: readonly string[]): boolean {
  const keys = [...url.searchParams.keys()]
  return keys.length === expected.length && expected.every((key) => keys.filter((value) => value === key).length === 1)
}
