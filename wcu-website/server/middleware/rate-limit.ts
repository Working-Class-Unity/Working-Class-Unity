import type { H3Event } from 'h3'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

interface RateLimitPolicy {
  id: string
  windowMs: number
  max: number
}

interface RateLimitState {
  count: number
  resetAt: number
}

const states = new Map<string, RateLimitState>()

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000
const CLEANUP_SIZE_THRESHOLD = 5000

let lastCleanupAt = 0

const cleanupExpired = (now: number): void => {
  if (states.size < CLEANUP_SIZE_THRESHOLD && now - lastCleanupAt < CLEANUP_INTERVAL_MS) return

  for (const [key, state] of states) {
    if (state.resetAt <= now) {
      states.delete(key)
    }
  }

  lastCleanupAt = now
}

const getClientIp = (event: H3Event): string => {
  const ipFromHeaders = getRequestIP(event, { xForwardedFor: true })
  if (ipFromHeaders) return ipFromHeaders

  const socketIp = event?.node?.req?.socket?.remoteAddress
  if (typeof socketIp === 'string' && socketIp.length > 0) return socketIp

  return 'unknown'
}

const getPolicyForRequest = (pathname: string, method: HttpMethod): RateLimitPolicy => {
  if (pathname === '/api/v1/auth/request-link' && method === 'POST') {
    return { id: 'auth-request-link', windowMs: 15 * 60 * 1000, max: 5 }
  }

  if (pathname === '/api/v1/auth/verify' && method === 'GET') {
    return { id: 'auth-verify', windowMs: 15 * 60 * 1000, max: 20 }
  }

  if (pathname.startsWith('/api/v1/auth/')) {
    return { id: 'auth-default', windowMs: 5 * 60 * 1000, max: 60 }
  }

  if (pathname.startsWith('/api/v1/')) {
    return { id: 'api-v1-default', windowMs: 5 * 60 * 1000, max: 120 }
  }

  return { id: 'api-default', windowMs: 5 * 60 * 1000, max: 120 }
}

const asHttpMethod = (value: unknown): HttpMethod => {
  switch (value) {
    case 'GET':
    case 'POST':
    case 'PUT':
    case 'PATCH':
    case 'DELETE':
      return value
    default:
      return 'GET'
  }
}

export default defineEventHandler((event) => {
  const { pathname } = getRequestURL(event)

  if (!pathname.startsWith('/api/')) {
    return
  }

  const method = asHttpMethod(event.node.req.method)
  const policy = getPolicyForRequest(pathname, method)
  const ip = getClientIp(event)

  const now = Date.now()
  cleanupExpired(now)

  const key = `${policy.id}:${method}:${ip}`
  const state = states.get(key)

  const activeState: RateLimitState = !state || state.resetAt <= now
    ? { count: 0, resetAt: now + policy.windowMs }
    : state

  activeState.count += 1
  states.set(key, activeState)

  const remaining = Math.max(policy.max - activeState.count, 0)

  setHeader(event, 'X-RateLimit-Limit', String(policy.max))
  setHeader(event, 'X-RateLimit-Remaining', String(remaining))
  setHeader(event, 'X-RateLimit-Reset', String(Math.ceil(activeState.resetAt / 1000)))

  if (activeState.count > policy.max) {
    const retryAfterSeconds = Math.max(1, Math.ceil((activeState.resetAt - now) / 1000))
    setHeader(event, 'Retry-After', retryAfterSeconds)

    throw createError({
      statusCode: 429,
      statusMessage: 'Too many requests',
    })
  }
})
