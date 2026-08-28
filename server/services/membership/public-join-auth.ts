import { createHmac, timingSafeEqual } from 'node:crypto'
import type { PublicJoinAttempt } from '../../db/schema/public-join'
import {
  isPublicJoinClaimErrorCallback,
  parsePublicJoinClaimCallback,
  publicJoinClaimCallback,
  publicJoinClaimErrorCallback
} from '../../../shared/join'

const publicJoinMagicLinkPurpose = 'membership-claim' as const

export type PublicJoinMagicLinkBody = Readonly<{
  email: string
  name: string
  callbackURL: string
  newUserCallbackURL: string
  errorCallbackURL: string
  metadata: Readonly<{
    purpose: typeof publicJoinMagicLinkPurpose
    attemptId: string
    authorization: string
  }>
}>

export function publicJoinClaimToken(attempt: PublicJoinAttempt, secret: string): string {
  if (
    !secret ||
    !attempt.email ||
    !attempt.claimExpiresAt ||
    !attempt.stripeSessionId ||
    !attempt.stripeCustomerId ||
    !attempt.stripeSubscriptionId
  ) {
    throw new TypeError('Public join attempt is not claimable')
  }
  return hmac(
    secret,
    'claim',
    attempt.id,
    attempt.email,
    attempt.claimExpiresAt,
    attempt.stripeSessionId,
    attempt.stripeCustomerId,
    attempt.stripeSubscriptionId
  )
}

export function publicJoinMagicLinkBody(attempt: PublicJoinAttempt, secret: string): PublicJoinMagicLinkBody {
  const token = publicJoinClaimToken(attempt, secret)
  const callbackURL = publicJoinClaimCallback(attempt.id, token)
  const errorCallbackURL = publicJoinClaimErrorCallback(attempt.id)
  return Object.freeze({
    email: attempt.email!,
    name: 'WCU account',
    callbackURL,
    newUserCallbackURL: callbackURL,
    errorCallbackURL,
    metadata: Object.freeze({
      purpose: publicJoinMagicLinkPurpose,
      attemptId: attempt.id,
      authorization: magicLinkAuthorization(secret, attempt.id, attempt.email!, token, callbackURL, errorCallbackURL)
    })
  })
}

export function isAuthorizedPublicJoinMagicLinkRequest(body: unknown, secret: string): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !secret) return false
  const value = body as Record<string, unknown>
  if (
    Object.keys(value).sort().join(',') !== 'callbackURL,email,errorCallbackURL,metadata,name,newUserCallbackURL' ||
    value.name !== 'WCU account'
  )
    return false
  const metadata = value.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false
  const claim = parsePublicJoinClaimCallback(value.callbackURL)
  const newUserClaim = parsePublicJoinClaimCallback(value.newUserCallbackURL)
  if (
    !claim ||
    !newUserClaim ||
    claim.attemptId !== newUserClaim.attemptId ||
    claim.token !== newUserClaim.token ||
    !isPublicJoinClaimErrorCallback(value.errorCallbackURL) ||
    typeof value.email !== 'string' ||
    value.email !== value.email.trim().toLowerCase()
  )
    return false

  const meta = metadata as Record<string, unknown>
  if (
    Object.keys(meta).sort().join(',') !== 'attemptId,authorization,purpose' ||
    meta.purpose !== publicJoinMagicLinkPurpose ||
    meta.attemptId !== claim.attemptId ||
    typeof meta.authorization !== 'string'
  )
    return false

  const expected = magicLinkAuthorization(
    secret,
    claim.attemptId,
    value.email,
    claim.token,
    value.callbackURL as string,
    value.errorCallbackURL as string
  )
  return safeEqual(meta.authorization, expected)
}

export function publicJoinClaimTokenMatches(attempt: PublicJoinAttempt, secret: string, token: string): boolean {
  try {
    return safeEqual(token, publicJoinClaimToken(attempt, secret))
  } catch {
    return false
  }
}

function magicLinkAuthorization(
  secret: string,
  attemptId: string,
  email: string,
  claimToken: string,
  callbackURL: string,
  errorCallbackURL: string
): string {
  return hmac(secret, 'magic-link', attemptId, email, claimToken, callbackURL, errorCallbackURL)
}

function hmac(secret: string, ...parts: string[]): string {
  return createHmac('sha256', secret).update(JSON.stringify(parts)).digest('base64url')
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}
