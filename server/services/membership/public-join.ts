import { randomUUID } from 'node:crypto'
import type Stripe from 'stripe'
import {
  getBillingOffering,
  isMembershipDuesOfferingKey,
  type MembershipDuesOfferingKey
} from '../../../shared/billing'
import { isPublicJoinAttemptId, type PublicJoinStatusResponse } from '../../../shared/join'
import type { MembershipConnectionKind } from '../../db/schema/membership'
import type { PublicJoinAttempt } from '../../db/schema/public-join'
import { conflictError, forbiddenError, upstreamServiceError } from '../../utils/errors'
import {
  hasOpenWebsiteAccountIdentityReview,
  recordWebsiteAccountIdentityReviewInTransaction
} from './account-identity'
import { commitBillingProjectionInTransaction } from '../payments/stripe/state-store'
import type { BillingStripeConnection } from '../payments/stripe/public-contract'
import type { BillingStripeRuntimeConfiguration } from '../payments/stripe/configuration'
import { readBaseBillingStripePurchaserState } from '../payments/stripe/purchaser-state'
import type { StripeBillingClient } from '../payments/stripe/stripe-client'
import { publicJoinClaimTokenMatches } from './public-join-auth'
import { hasCurrentImportedStripeDuesSubscription } from './imported-stripe-billing'

export const publicJoinClaimExpiryMs = 24 * 60 * 60 * 1_000
export const publicJoinCodeOfConductVersion = 'wcu-code-of-conduct-topic-186-2026-08-27'

export type PublicJoinServiceContext = Readonly<{
  client: StripeBillingClient
  config: BillingStripeRuntimeConfiguration
  connection: BillingStripeConnection
}>

export type PublicJoinAccount = Readonly<{
  email: string
  emailVerified: boolean
  id: string
}>

export type PublicJoinClaimOutcome = 'active' | 'claimed' | 'conflict' | 'expired' | 'ignored'

export async function createPublicJoinCheckout(
  context: PublicJoinServiceContext,
  offering: MembershipDuesOfferingKey,
  now = new Date(),
  purchaserUserId: string | null = null
): Promise<Readonly<{ url: string }>> {
  if (!isMembershipDuesOfferingKey(offering)) throw forbiddenError('Unsupported membership offering')
  const configured = getBillingOffering(offering)
  if (!configured || configured.cadence !== 'monthly') throw forbiddenError('Unsupported membership offering')
  const stripePriceId = context.config.stripe.prices[offering]
  if (!stripePriceId?.startsWith('price_')) throw upstreamServiceError(503, 'Membership checkout is unavailable')

  const attempt = reservePublicJoinAttempt(context.connection, {
    appUrl: context.config.appUrl,
    cadence: configured.cadence,
    now,
    planKey: configured.plan,
    stripePriceId,
    purchaserUserId,
    prices: context.config.stripe.prices
  })
  let session: Stripe.Checkout.Session
  try {
    session = await context.client.checkout.sessions.create(publicJoinCheckoutParams(attempt), {
      idempotencyKey: attempt.idempotencyKey
    })
  } catch {
    markPublicJoinReconciliationRequired(context.connection, attempt.id, 'checkout_creation_indeterminate', now)
    throw upstreamServiceError(502, 'Stripe Checkout is temporarily unavailable')
  }

  if (!isExpectedPublicJoinCheckoutSession(session, attempt)) {
    markPublicJoinReconciliationRequired(context.connection, attempt.id, 'unexpected_checkout_session', now, session.id)
    throw upstreamServiceError(502, 'Stripe Checkout returned an unusable session')
  }
  const updated = context.connection.sqlite
    .prepare(
      `update public_join_attempts set stripe_session_id = ?, state = 'open', updated_at = ?
       where id = ? and state = 'pending' and stripe_session_id is null`
    )
    .run(session.id, now.toISOString(), attempt.id)
  if (updated.changes !== 1) {
    markPublicJoinReconciliationRequired(context.connection, attempt.id, 'checkout_state_changed', now, session.id)
    throw conflictError('Membership checkout state changed')
  }
  return Object.freeze({ url: session.url! })
}

export function claimPublicJoinAttempt(
  connection: BillingStripeConnection,
  account: PublicJoinAccount,
  input: Readonly<{ attemptId: string; reviewHashKey: string; token: string; now?: Date }>
): PublicJoinClaimOutcome {
  if (!isPublicJoinAttemptId(input.attemptId) || !account.emailVerified) return 'ignored'
  const now = input.now ?? new Date()
  return connection.sqlite
    .transaction(() => {
      const attempt = readPublicJoinAttempt(connection, input.attemptId)
      if (!attempt) return 'ignored' as const
      if (attempt.claimedUserId === account.id && attempt.state === 'active') return 'active' as const
      if (attempt.claimedUserId === account.id && attempt.state === 'claimed') return 'claimed' as const
      if (
        attempt.state !== 'paid' ||
        !attempt.claimExpiresAt ||
        now.getTime() >= Date.parse(attempt.claimExpiresAt) ||
        !publicJoinClaimTokenMatches(attempt, input.reviewHashKey, input.token)
      )
        return attempt.claimExpiresAt && now.getTime() >= Date.parse(attempt.claimExpiresAt)
          ? ('expired' as const)
          : ('ignored' as const)
      return claimPaidPublicJoinInTransaction(connection, account, attempt, input.reviewHashKey, now)
    })
    .immediate()
}

export function claimUniquePublicJoinForAccount(
  connection: BillingStripeConnection,
  account: PublicJoinAccount,
  reviewHashKey: string,
  now = new Date(),
  expectedAttemptId: string | null = null
): PublicJoinClaimOutcome {
  if (!account.emailVerified) return 'ignored'
  const email = normalizedEmail(account.email)
  if (!email) return 'ignored'
  return connection.sqlite
    .transaction(() => {
      const attempts = (
        connection.sqlite
          .prepare(
            `select * from public_join_attempts
           where email = ? and state = 'paid' and claimed_user_id is null
           order by created_at, id limit 2`
          )
          .all(email) as Array<Record<string, unknown>>
      ).map(publicJoinAttemptFromRow)
      if (attempts.length === 0) return 'ignored' as const
      if (attempts.length > 1) {
        recordWebsiteAccountIdentityReviewInTransaction(connection, {
          identifier: email,
          observedAt: now,
          reason: 'ambiguous_verified_email',
          reviewHashKey,
          userId: account.id
        })
        return 'conflict' as const
      }
      if (expectedAttemptId && attempts[0]!.id !== expectedAttemptId) return 'ignored' as const
      return claimPaidPublicJoinInTransaction(connection, account, attempts[0]!, reviewHashKey, now)
    })
    .immediate()
}

export function activatePublicJoinMembership(
  connection: BillingStripeConnection,
  userId: string,
  input: Readonly<{ attemptId: string; connectionKind: MembershipConnectionKind; now?: Date }>
): 'active' | 'ignored' {
  if (!isPublicJoinAttemptId(input.attemptId)) return 'ignored'
  const now = input.now ?? new Date()
  const timestamp = now.toISOString()
  return connection.sqlite
    .transaction(() => {
      const attempt = readPublicJoinAttempt(connection, input.attemptId)
      if (!attempt || attempt.claimedUserId !== userId || !attempt.membershipId) return 'ignored' as const
      if (attempt.state === 'active') return 'active' as const
      const billing = readBaseBillingStripePurchaserState(connection, userId, now)
      if (
        attempt.state !== 'claimed' ||
        attempt.reconciliationReason ||
        billing.subscription.state !== 'active' ||
        billing.subscription.offering !== `${attempt.planKey}.${attempt.cadence}`
      ) {
        return 'ignored' as const
      }
      const membership = connection.sqlite
        .prepare('select status from memberships where id = ?')
        .get(attempt.membershipId) as { status: 'active' | 'ended' | 'pending' } | undefined
      if (!membership || membership.status === 'ended') return 'ignored' as const
      if (membership.status === 'pending') {
        connection.sqlite
          .prepare(
            `insert into membership_attestations
               (id, membership_id, connection_kind, code_of_conduct_version, attested_at, created_at)
             values (?, ?, ?, ?, ?, ?)`
          )
          .run(
            `membership_attestation_${randomUUID()}`,
            attempt.membershipId,
            input.connectionKind,
            publicJoinCodeOfConductVersion,
            timestamp,
            timestamp
          )
        connection.sqlite
          .prepare(
            `update memberships set status = 'active', started_at = ?, attendance_requirement_starts_at = ?,
               updated_at = ? where id = ? and status = 'pending'`
          )
          .run(timestamp, timestamp, timestamp, attempt.membershipId)
        setInitialGoodStanding(connection, attempt.membershipId, timestamp)
      }
      const activated = connection.sqlite
        .prepare(
          `update public_join_attempts set state = 'active', activated_at = ?, updated_at = ?
           where id = ? and claimed_user_id = ? and membership_id = ? and state = 'claimed'`
        )
        .run(timestamp, timestamp, attempt.id, userId, attempt.membershipId)
      if (activated.changes !== 1 && readPublicJoinAttempt(connection, attempt.id)?.state !== 'active') {
        throw new Error('Public join activation state changed')
      }
      return 'active' as const
    })
    .immediate()
}

export function readPublicJoinStatus(
  connection: BillingStripeConnection,
  attemptId: string | null,
  userId: string | null
): PublicJoinStatusResponse {
  const attempt =
    attemptId && isPublicJoinAttemptId(attemptId)
      ? readPublicJoinAttempt(connection, attemptId)
      : userId
        ? latestPublicJoinForUser(connection, userId)
        : null
  if (!attempt) return Object.freeze({ attemptId: null, offering: null, status: 'failed' })
  const offering = `${attempt.planKey}.${attempt.cadence}`
  const membershipOffering = isMembershipDuesOfferingKey(offering) ? offering : null
  const owned = Boolean(userId && attempt.claimedUserId === userId)
  const status =
    attempt.state === 'active'
      ? 'active'
      : attempt.state === 'claimed'
        ? owned
          ? attempt.subscriptionStatus === 'active' && !attempt.reconciliationReason
            ? 'needs_attestation'
            : 'review'
          : 'check_email'
        : attempt.state === 'paid'
          ? 'check_email'
          : attempt.state === 'review' || attempt.state === 'reconciliation_required'
            ? 'review'
            : attempt.state === 'failed' || attempt.state === 'expired'
              ? 'failed'
              : 'processing'
  return Object.freeze({ attemptId: attempt.id, offering: membershipOffering, status })
}

export function publicJoinRequiresAttestation(
  connection: BillingStripeConnection,
  userId: string,
  stripeSubscriptionId: string | null
): boolean {
  if (!stripeSubscriptionId) return false
  return Boolean(
    connection.sqlite
      .prepare(
        `select 1 from public_join_attempts
         where claimed_user_id = ? and stripe_subscription_id = ? and state = 'claimed' limit 1`
      )
      .get(userId, stripeSubscriptionId)
  )
}

export function readPublicJoinAttempt(
  connection: BillingStripeConnection,
  attemptId: string
): PublicJoinAttempt | null {
  const row = connection.sqlite.prepare('select * from public_join_attempts where id = ?').get(attemptId) as
    Record<string, unknown> | undefined
  return row ? publicJoinAttemptFromRow(row) : null
}

function reservePublicJoinAttempt(
  connection: BillingStripeConnection,
  input: Readonly<{
    appUrl: string
    cadence: 'monthly'
    now: Date
    planKey: 'family' | 'personal'
    prices: BillingStripeRuntimeConfiguration['stripe']['prices']
    purchaserUserId: string | null
    stripePriceId: string
  }>
): PublicJoinAttempt {
  const id = `join_checkout_${randomUUID()}`
  const appUrl = input.appUrl.replace(/\/+$/, '')
  const successUrl = `${appUrl}/join/complete?id=${encodeURIComponent(id)}`
  const offering = `${input.planKey}.${input.cadence}`
  const cancelUrl = `${appUrl}/join?offering=${encodeURIComponent(offering)}&checkout=cancelled`
  const timestamp = input.now.toISOString()
  return connection.sqlite
    .transaction(() => {
      if (input.purchaserUserId) {
        assertAuthenticatedPublicJoinAllowed(connection, input.purchaserUserId, input.prices, input.now)
      }
      connection.sqlite
        .prepare(
          `insert into public_join_attempts
             (id, plan_key, cadence, stripe_price_id, idempotency_key, state,
              success_url, cancel_url, created_at, updated_at)
           values (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
        )
        .run(
          id,
          input.planKey,
          input.cadence,
          input.stripePriceId,
          `public_join_checkout_${randomUUID()}`,
          successUrl,
          cancelUrl,
          timestamp,
          timestamp
        )
      const attempt = readPublicJoinAttempt(connection, id)
      if (!attempt) throw new Error('Failed to reserve public join attempt')
      return attempt
    })
    .immediate()
}

function assertAuthenticatedPublicJoinAllowed(
  connection: BillingStripeConnection,
  userId: string,
  prices: BillingStripeRuntimeConfiguration['stripe']['prices'],
  now: Date
): void {
  const billing = readBaseBillingStripePurchaserState(connection, userId, now)
  const hasBillingRows = Boolean(
    connection.sqlite
      .prepare(
        `select 1 from billing_customers where purchaser_user_id = ?
         union all select 1 from billing_subscriptions where purchaser_user_id = ? limit 1`
      )
      .get(userId, userId)
  )
  const hasActiveCanonicalMembership = Boolean(
    connection.sqlite
      .prepare(
        `select 1 from person_accounts account
         join memberships membership on membership.person_id = account.person_id
         where account.user_id = ? and membership.status = 'active' and membership.ended_at is null limit 1`
      )
      .get(userId)
  )
  if (
    hasBillingRows ||
    hasActiveCanonicalMembership ||
    !billing.capabilities.canCheckout ||
    hasOpenWebsiteAccountIdentityReview(connection, userId) ||
    hasCurrentImportedStripeDuesSubscription(connection, userId, {
      'personal.monthly': prices['personal.monthly'],
      'family.monthly': prices['family.monthly']
    })
  ) {
    throw conflictError('The current account already has membership or billing in progress')
  }
}

function publicJoinCheckoutParams(attempt: PublicJoinAttempt): Stripe.Checkout.SessionCreateParams {
  return {
    mode: 'subscription',
    client_reference_id: attempt.id,
    line_items: [{ price: attempt.stripePriceId, quantity: 1 }],
    success_url: attempt.successUrl,
    cancel_url: attempt.cancelUrl,
    expand: ['line_items'],
    metadata: { billing_attempt_id: attempt.id },
    subscription_data: { metadata: { billing_attempt_id: attempt.id } }
  }
}

function isExpectedPublicJoinCheckoutSession(session: Stripe.Checkout.Session, attempt: PublicJoinAttempt): boolean {
  const lineItem = session.line_items?.data[0]
  return Boolean(
    session.object === 'checkout.session' &&
    session.id?.startsWith('cs_') &&
    session.mode === 'subscription' &&
    session.status === 'open' &&
    session.client_reference_id === attempt.id &&
    session.metadata?.billing_attempt_id === attempt.id &&
    session.line_items?.object === 'list' &&
    session.line_items.has_more === false &&
    session.line_items.data.length === 1 &&
    (typeof lineItem?.price === 'string' ? lineItem.price : lineItem?.price?.id) === attempt.stripePriceId &&
    lineItem?.quantity === 1 &&
    session.url &&
    isHttpsUrl(session.url)
  )
}

function claimPaidPublicJoinInTransaction(
  connection: BillingStripeConnection,
  account: PublicJoinAccount,
  attempt: PublicJoinAttempt,
  reviewHashKey: string,
  now: Date
): PublicJoinClaimOutcome {
  const email = normalizedEmail(account.email)
  if (!email || email !== attempt.email || attempt.state !== 'paid' || attempt.claimedUserId) return 'ignored'
  if (!attempt.claimExpiresAt) return 'ignored'
  if (now.getTime() >= Date.parse(attempt.claimExpiresAt)) return 'expired'
  if (hasOpenWebsiteAccountIdentityReview(connection, account.id)) {
    markPublicJoinReview(connection, attempt.id, account.id, now)
    return 'conflict'
  }
  const person = connection.sqlite
    .prepare('select person_id as personId from person_accounts where user_id = ?')
    .get(account.id) as { personId: string } | undefined
  if (!person) return 'ignored'
  if (!attempt.stripeCustomerId || !attempt.stripeSubscriptionId || !attempt.stripeSubscriptionItemId) return 'ignored'

  const customerForUser = connection.sqlite
    .prepare('select stripe_customer_id as stripeCustomerId from billing_customers where purchaser_user_id = ?')
    .get(account.id) as { stripeCustomerId: string } | undefined
  const customerOwner = connection.sqlite
    .prepare('select purchaser_user_id as purchaserUserId from billing_customers where stripe_customer_id = ?')
    .get(attempt.stripeCustomerId) as { purchaserUserId: string } | undefined
  const subscriptionForUser = connection.sqlite
    .prepare(
      'select stripe_subscription_id as stripeSubscriptionId from billing_subscriptions where purchaser_user_id = ?'
    )
    .get(account.id) as { stripeSubscriptionId: string | null } | undefined
  const subscriptionOwner = connection.sqlite
    .prepare('select purchaser_user_id as purchaserUserId from billing_subscriptions where stripe_subscription_id = ?')
    .get(attempt.stripeSubscriptionId) as { purchaserUserId: string } | undefined
  if (
    customerForUser ||
    subscriptionForUser ||
    (customerOwner && customerOwner.purchaserUserId !== account.id) ||
    (subscriptionOwner && subscriptionOwner.purchaserUserId !== account.id)
  ) {
    recordWebsiteAccountIdentityReviewInTransaction(connection, {
      identifier: attempt.stripeCustomerId,
      observedAt: now,
      reason: 'conflicting_verified_identifiers',
      reviewHashKey,
      userId: account.id
    })
    markPublicJoinReview(connection, attempt.id, account.id, now)
    return 'conflict'
  }

  const timestamp = now.toISOString()
  const billingCustomerId = `billing_customer_${randomUUID()}`
  connection.sqlite
    .prepare(
      `insert into billing_customers (id, purchaser_user_id, stripe_customer_id, created_at, updated_at)
       values (?, ?, ?, ?, ?)`
    )
    .run(billingCustomerId, account.id, attempt.stripeCustomerId, timestamp, timestamp)
  const projection = commitBillingProjectionInTransaction(connection, undefined, {
    purchaserUserId: account.id,
    stripeCustomerId: attempt.stripeCustomerId,
    expectedRevision: 0,
    projection: {
      stripeSubscriptionId: attempt.stripeSubscriptionId,
      stripeSubscriptionItemId: attempt.stripeSubscriptionItemId,
      status: attempt.subscriptionStatus ?? 'ambiguous',
      planKey: attempt.planKey,
      cadence: attempt.cadence,
      stripePriceId: attempt.stripePriceId,
      currentPeriodStart: attempt.currentPeriodStart,
      currentPeriodEnd: attempt.currentPeriodEnd,
      cancelAtPeriodEnd: attempt.cancelAtPeriodEnd,
      reconciliationRequired: Boolean(attempt.reconciliationReason),
      reconciliationReason: attempt.reconciliationReason
    },
    cause: 'checkout_reconciliation',
    verifiedAt: now,
    projectionOrderMs: attempt.projectionOrderMs,
    projectionEventId: attempt.projectionEventId
  })
  if (projection.outcome !== 'applied') throw new Error('Failed to adopt public join billing projection')

  const openMembership = connection.sqlite
    .prepare(
      `select id, status from memberships where person_id = ? and ended_at is null
       order by applied_at desc limit 1`
    )
    .get(person.personId) as { id: string; status: 'active' | 'pending' } | undefined
  const membershipId = openMembership?.id ?? `membership_join_${randomUUID()}`
  if (!openMembership) {
    connection.sqlite
      .prepare(
        `insert into memberships (id, person_id, status, applied_at, created_at, updated_at)
         values (?, ?, 'pending', ?, ?, ?)`
      )
      .run(membershipId, person.personId, timestamp, timestamp, timestamp)
    insertInitialPendingStanding(connection, membershipId, timestamp)
  }
  const alreadyActive = openMembership?.status === 'active'
  const updated = connection.sqlite
    .prepare(
      `update public_join_attempts set state = ?, claimed_user_id = ?, membership_id = ?,
         claimed_at = ?, activated_at = ?, updated_at = ?
       where id = ? and state = 'paid' and claimed_user_id is null`
    )
    .run(
      alreadyActive ? 'active' : 'claimed',
      account.id,
      membershipId,
      timestamp,
      alreadyActive ? timestamp : null,
      timestamp,
      attempt.id
    )
  if (updated.changes !== 1) throw new Error('Public join claim state changed')
  return alreadyActive ? 'active' : 'claimed'
}

function insertInitialPendingStanding(
  connection: BillingStripeConnection,
  membershipId: string,
  timestamp: string
): void {
  const policyId = currentMembershipPolicyId(connection, timestamp)
  connection.sqlite
    .prepare(
      `insert into membership_standing_periods
         (id, membership_id, policy_id, status, dues_status, attendance_status,
          eligibility_status, conduct_status, effective_from, created_at)
       values (?, ?, ?, 'pending', 'met', 'pending', 'pending', 'pending', ?, ?)`
    )
    .run(`membership_standing_${randomUUID()}`, membershipId, policyId, timestamp, timestamp)
}

function setInitialGoodStanding(connection: BillingStripeConnection, membershipId: string, timestamp: string): void {
  const policyId = currentMembershipPolicyId(connection, timestamp)
  const current = connection.sqlite
    .prepare(
      `select id, effective_from as effectiveFrom from membership_standing_periods
       where membership_id = ? and effective_to is null`
    )
    .get(membershipId) as { effectiveFrom: string; id: string } | undefined
  if (current?.effectiveFrom === timestamp) {
    connection.sqlite
      .prepare(
        `update membership_standing_periods set policy_id = ?, status = 'good', dues_status = 'met',
           attendance_status = 'not_applicable', eligibility_status = 'met', conduct_status = 'met'
         where id = ?`
      )
      .run(policyId, current.id)
    return
  }
  if (current) {
    connection.sqlite
      .prepare('update membership_standing_periods set effective_to = ? where id = ? and effective_to is null')
      .run(timestamp, current.id)
  }
  connection.sqlite
    .prepare(
      `insert into membership_standing_periods
         (id, membership_id, policy_id, status, dues_status, attendance_status,
          eligibility_status, conduct_status, effective_from, created_at)
       values (?, ?, ?, 'good', 'met', 'not_applicable', 'met', 'met', ?, ?)`
    )
    .run(`membership_standing_${randomUUID()}`, membershipId, policyId, timestamp, timestamp)
}

function currentMembershipPolicyId(connection: BillingStripeConnection, timestamp: string): string {
  const policy = connection.sqlite
    .prepare(
      `select id from membership_policies where julianday(effective_from) <= julianday(?)
       and (effective_to is null or julianday(effective_to) > julianday(?))
       order by julianday(effective_from) desc limit 1`
    )
    .get(timestamp, timestamp) as { id: string } | undefined
  if (!policy) throw new Error('Current membership policy is unavailable')
  return policy.id
}

function markPublicJoinReview(connection: BillingStripeConnection, attemptId: string, userId: string, now: Date): void {
  const timestamp = now.toISOString()
  connection.sqlite
    .prepare(
      `update public_join_attempts set state = 'review', claimed_user_id = ?, claimed_at = ?, updated_at = ?
       where id = ? and state = 'paid' and claimed_user_id is null`
    )
    .run(userId, timestamp, timestamp, attemptId)
}

function markPublicJoinReconciliationRequired(
  connection: BillingStripeConnection,
  attemptId: string,
  reason: string,
  now: Date,
  stripeSessionId: string | null = null
): void {
  connection.sqlite
    .prepare(
      `update public_join_attempts set state = 'reconciliation_required', reconciliation_reason = ?,
         stripe_session_id = coalesce(?, stripe_session_id), updated_at = ? where id = ?`
    )
    .run(reason, stripeSessionId, now.toISOString(), attemptId)
}

function latestPublicJoinForUser(connection: BillingStripeConnection, userId: string): PublicJoinAttempt | null {
  const row = connection.sqlite
    .prepare(
      `select * from public_join_attempts where claimed_user_id = ?
       order by coalesce(activated_at, claimed_at, created_at) desc, id desc limit 1`
    )
    .get(userId) as Record<string, unknown> | undefined
  return row ? publicJoinAttemptFromRow(row) : null
}

function normalizedEmail(value: string): string | null {
  const normalized = value.trim().toLowerCase()
  return normalized.length >= 3 && normalized.length <= 320 && normalized.includes('@') ? normalized : null
}

function publicJoinAttemptFromRow(row: Record<string, unknown>): PublicJoinAttempt {
  const normalized = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      value
    ])
  )
  return {
    ...normalized,
    cancelAtPeriodEnd: normalized.cancelAtPeriodEnd === 1
  } as PublicJoinAttempt
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
