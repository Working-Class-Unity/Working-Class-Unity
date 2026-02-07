import { createHmac, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'

import type { SessionUser } from '~~/shared/types/auth'

const SESSION_COOKIE_NAME = 'wcu_session'
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 14

interface SessionTokenPayload {
  sub: string
  email: string
  role: SessionUser['role']
  duesPaidThrough: string | null
  iat: number
  exp: number
}

const toBase64Url = (value: Buffer | string): string =>
  Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')

const fromBase64Url = (value: string): Buffer => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - (normalized.length % 4 || 4)) % 4)
  return Buffer.from(`${normalized}${padding}`, 'base64')
}

const signSegment = (payloadSegment: string, secret: string): string => {
  const signature = createHmac('sha256', secret).update(payloadSegment).digest()
  return toBase64Url(signature)
}

export function encodeSessionToken(
  sessionUser: SessionUser,
  secret: string,
  ttlSeconds = DEFAULT_SESSION_TTL_SECONDS
): string {
  const now = Math.floor(Date.now() / 1000)

  const payload: SessionTokenPayload = {
    sub: sessionUser.userId,
    email: sessionUser.email,
    role: sessionUser.role,
    duesPaidThrough: sessionUser.duesPaidThrough,
    iat: now,
    exp: now + ttlSeconds,
  }

  const payloadSegment = toBase64Url(JSON.stringify(payload))
  const signatureSegment = signSegment(payloadSegment, secret)

  return `${payloadSegment}.${signatureSegment}`
}

export function decodeSessionToken(token: string, secret: string): SessionUser | null {
  const [payloadSegment, signatureSegment] = token.split('.')
  if (!payloadSegment || !signatureSegment) return null

  const expectedSignature = signSegment(payloadSegment, secret)
  let actualSignature: Buffer
  let expectedSignatureBuffer: Buffer

  try {
    actualSignature = fromBase64Url(signatureSegment)
    expectedSignatureBuffer = fromBase64Url(expectedSignature)
  } catch {
    return null
  }

  if (
    actualSignature.length !== expectedSignatureBuffer.length
    || !timingSafeEqual(actualSignature, expectedSignatureBuffer)
  ) {
    return null
  }

  try {
    const payloadBuffer = fromBase64Url(payloadSegment)
    const payload = JSON.parse(payloadBuffer.toString('utf-8')) as SessionTokenPayload

    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      return null
    }

    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      duesPaidThrough: payload.duesPaidThrough,
    }
  } catch {
    return null
  }
}

const getSessionSecret = (): string => {
  const config = useRuntimeConfig()

  if (!config.authSessionSecret) {
    throw createError({
      statusCode: 500,
      statusMessage: 'AUTH_SESSION_SECRET is not configured',
    })
  }

  return config.authSessionSecret
}

const getSessionTtlSeconds = (): number => {
  const config = useRuntimeConfig()

  if (typeof config.authSessionTtlSeconds !== 'number' || Number.isNaN(config.authSessionTtlSeconds)) {
    return DEFAULT_SESSION_TTL_SECONDS
  }

  return config.authSessionTtlSeconds
}

export function getSessionFromEvent(event: H3Event): SessionUser | null {
  const token = getCookie(event, SESSION_COOKIE_NAME)
  if (!token) return null

  return decodeSessionToken(token, getSessionSecret())
}

export function requireSession(event: H3Event): SessionUser {
  const session = getSessionFromEvent(event)

  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Authentication required',
    })
  }

  return session
}

export function setSessionForEvent(event: H3Event, sessionUser: SessionUser): void {
  const token = encodeSessionToken(sessionUser, getSessionSecret(), getSessionTtlSeconds())

  setCookie(event, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !import.meta.dev,
    path: '/',
    maxAge: getSessionTtlSeconds(),
  })
}

export function clearSessionForEvent(event: H3Event): void {
  deleteCookie(event, SESSION_COOKIE_NAME, {
    path: '/',
  })
}
