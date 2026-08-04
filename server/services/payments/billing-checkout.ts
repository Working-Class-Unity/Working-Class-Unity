import type Stripe from 'stripe'
import { getBillingOffering, type BillingOfferingKey } from '../../../shared/billing'
import type { DatabaseConnection } from '../../db/connect'
import {
  createOrReuseCheckoutAttempt,
  getBillingCustomerById,
  getBillingCustomerForOrganization,
  getBillingSubscriptionForOrganization,
  isBillingDeletionPendingForOrganization
} from '../../db/repositories/billing'
import type { BillingCheckoutAttempt, BillingCustomer } from '../../db/schema'
import { conflictError, forbiddenError, upstreamServiceError } from '../../utils/errors'
import type { AppRuntimeConfig } from '../../utils/runtime'
import {
  finalizeReconciledCheckoutSession,
  mutableAttemptStates,
  readAuthorizedCheckoutAttempt,
  recoverCheckoutAttemptCadence,
  reconcilableAttemptStates,
  recordObservedCheckoutSession,
  transitionCheckoutAttempt,
  type AttemptOutcome
} from './billing-checkout-store'
import { createStripeBillingCatalog } from './billing-catalog'
import { stripeId } from './billing-projection'
import type { StripeBillingClient } from './stripe-client'

const checkoutAttemptReuseMs = 23 * 60 * 60 * 1_000
const checkoutAttemptSessionDiscoveryMaxPages = 10

export type StripeCheckoutContext = Readonly<{
  connection: DatabaseConnection
  client: StripeBillingClient
  config: AppRuntimeConfig
}>

type CheckoutAttemptSessionResolution =
  | Readonly<{ outcome: 'not_found' }>
  | Readonly<{ outcome: 'found'; session: Stripe.Checkout.Session }>
  | Readonly<{
      outcome: 'ambiguous'
      reason:
        | 'checkout_discovery_page_invalid'
        | 'checkout_discovery_truncated'
        | 'checkout_pagination_cursor_stalled'
        | 'multiple_correlated_checkout_sessions'
    }>

export async function ensureBillingCheckout(
  context: StripeCheckoutContext,
  userId: string,
  organizationId: string,
  customer: BillingCustomer | null,
  offeringKey: BillingOfferingKey,
  now: Date
) {
  const offering = getBillingOffering(offeringKey)!
  const catalog = createStripeBillingCatalog(context.config.stripe)
  const checkoutAttemptInput = {
    userId,
    organizationId,
    billingCustomerId: customer?.id ?? null,
    planKey: offering.plan,
    cadence: offering.cadence,
    stripePriceId: catalog.priceIdForOffering(offeringKey),
    successUrl: `${trimSlash(context.config.public.appUrl)}/account/billing?checkout=success`,
    cancelUrl: `${trimSlash(context.config.public.appUrl)}/account/billing?checkout=cancelled`,
    now,
    reuseUntil: new Date(now.getTime() + checkoutAttemptReuseMs)
  }
  let attempt = createOrReuseCheckoutAttempt(context.connection, checkoutAttemptInput)
  if (!attempt) {
    if (isBillingDeletionPendingForOrganization(context.connection, organizationId)) {
      throw conflictError('Billing is locked while account deletion is pending')
    }
    throw forbiddenError('Family members cannot create billing authority')
  }

  if (
    attempt.planKey !== offering.plan ||
    attempt.cadence !== offering.cadence ||
    attempt.stripePriceId !== checkoutAttemptInput.stripePriceId
  ) {
    throw conflictError('A different Checkout is already pending')
  }

  if (attempt.state === 'reconciliation_required') {
    throw conflictError('Checkout state must be reconciled before retrying')
  }

  if (attempt.stripeSessionId) {
    const existing = await retrieveCheckoutSession(context.client, attempt.stripeSessionId)
    if (!isExpectedCheckoutSession(existing, attempt, customer?.stripeCustomerId ?? null)) {
      requireAttemptTransition(
        transitionCheckoutAttempt(context.connection, userId, attempt, mutableAttemptStates, {
          state: 'reconciliation_required'
        })
      )
      throw conflictError('Checkout state must be reconciled before retrying')
    }
    if (existing.status === 'expired') {
      requireAttemptTransition(
        transitionCheckoutAttempt(context.connection, userId, attempt, mutableAttemptStates, {
          state: 'expired'
        })
      )
      attempt = createOrReuseCheckoutAttempt(context.connection, checkoutAttemptInput)
      if (!attempt) {
        if (isBillingDeletionPendingForOrganization(context.connection, organizationId)) {
          throw conflictError('Billing is locked while account deletion is pending')
        }
        throw forbiddenError('Family members cannot create billing authority')
      }
    } else if (existing.status === 'complete') {
      requireAttemptTransition(
        recordObservedCheckoutSession(
          context.connection,
          userId,
          attempt,
          existing,
          mutableAttemptStates,
          'reconciliation_required'
        )
      )
      throw conflictError('Checkout completion is awaiting verified billing state')
    } else if (existing.status === 'open' && existing.url && isHttpsUrl(existing.url)) {
      requireAttemptTransition(
        recordObservedCheckoutSession(context.connection, userId, attempt, existing, mutableAttemptStates, 'open')
      )
      return { url: existing.url }
    } else {
      requireAttemptTransition(
        recordObservedCheckoutSession(
          context.connection,
          userId,
          attempt,
          existing,
          mutableAttemptStates,
          'reconciliation_required'
        )
      )
      throw conflictError('Checkout state must be reconciled before retrying')
    }
  }

  if (new Date(attempt.reuseUntil).getTime() <= now.getTime()) {
    requireAttemptTransition(
      transitionCheckoutAttempt(context.connection, userId, attempt, mutableAttemptStates, {
        state: 'reconciliation_required'
      })
    )
    throw conflictError('Checkout state must be reconciled before retrying')
  }

  const attemptCustomer = attempt.billingCustomerId
    ? getBillingCustomerById(context.connection, attempt.billingCustomerId)
    : null

  let session: Stripe.Checkout.Session
  try {
    session = await context.client.checkout.sessions.create(
      checkoutSessionCreateParams(attempt, attemptCustomer?.stripeCustomerId ?? null),
      { idempotencyKey: attempt.idempotencyKey }
    )
  } catch {
    throw upstreamServiceError(502, 'Stripe Checkout is temporarily unavailable')
  }

  if (
    !isExpectedCheckoutSession(session, attempt, attemptCustomer?.stripeCustomerId ?? null) ||
    !session.url ||
    session.status !== 'open' ||
    !isHttpsUrl(session.url)
  ) {
    const outcome = recordObservedCheckoutSession(
      context.connection,
      userId,
      attempt,
      session,
      mutableAttemptStates,
      'reconciliation_required'
    )
    if (outcome === 'authority_lost') {
      throw forbiddenError('Billing authority changed during Checkout creation')
    }
    if (outcome === 'state_changed') {
      throw conflictError('Billing state changed during Checkout creation')
    }
    throw upstreamServiceError(502, 'Stripe Checkout returned an unusable session')
  }

  requireAttemptTransition(
    recordObservedCheckoutSession(context.connection, userId, attempt, session, mutableAttemptStates, 'open')
  )
  return { url: session.url }
}

export async function reconcileBillingCheckoutAttempt(
  context: StripeCheckoutContext,
  userId: string,
  attempt: BillingCheckoutAttempt,
  now: Date
): Promise<{ customer: BillingCustomer | null; blocked: boolean }> {
  let resolution: CheckoutAttemptSessionResolution
  try {
    resolution = await resolveCheckoutAttemptSession(context.client, attempt)
  } catch {
    throw upstreamServiceError(502, 'Stripe Checkout state is temporarily unavailable')
  }

  if (resolution.outcome === 'ambiguous') {
    const outcome = transitionCheckoutAttempt(context.connection, userId, attempt, reconcilableAttemptStates, {
      state: 'reconciliation_required'
    })
    requireCurrentAuthority(outcome)
    return { customer: null, blocked: true }
  }

  if (resolution.outcome === 'not_found') {
    const live = readAuthorizedCheckoutAttempt(context.connection, userId, attempt)
    requireCurrentAuthority(live.outcome)
    if (new Date(attempt.reuseUntil).getTime() <= now.getTime()) {
      const outcome = transitionCheckoutAttempt(context.connection, userId, attempt, reconcilableAttemptStates, {
        state: 'failed'
      })
      requireCurrentAuthority(outcome)
      if (outcome === 'state_changed') return { customer: null, blocked: true }
    }
    return {
      customer: getBillingCustomerForOrganization(context.connection, attempt.organizationId),
      blocked: false
    }
  }

  const observed = await retrieveCheckoutSession(context.client, resolution.session.id)
  const expectedCustomer = attempt.billingCustomerId
    ? getBillingCustomerById(context.connection, attempt.billingCustomerId)
    : null
  if (!isExpectedCheckoutSession(observed, attempt, expectedCustomer?.stripeCustomerId ?? null)) {
    const outcome = recordObservedCheckoutSession(
      context.connection,
      userId,
      attempt,
      observed,
      reconcilableAttemptStates,
      'reconciliation_required'
    )
    requireCurrentAuthority(outcome)
    return { customer: null, blocked: true }
  }

  if (observed.status === 'expired') {
    const outcome = recordObservedCheckoutSession(
      context.connection,
      userId,
      attempt,
      observed,
      reconcilableAttemptStates,
      'expired'
    )
    requireCurrentAuthority(outcome)
    return {
      customer: getBillingCustomerForOrganization(context.connection, attempt.organizationId),
      blocked: outcome !== 'applied'
    }
  }

  if (observed.status === 'open') {
    const recoveredAttempt = recoverLegacyCheckoutCadence(context, userId, attempt)
    if (!recoveredAttempt) return { customer: null, blocked: true }
    attempt = recoveredAttempt

    const currentProjection = getBillingSubscriptionForOrganization(context.connection, attempt.organizationId)
    if (currentProjection && currentProjection.status !== 'none') {
      const outcome = recordObservedCheckoutSession(
        context.connection,
        userId,
        attempt,
        observed,
        reconcilableAttemptStates,
        'reconciliation_required'
      )
      requireCurrentAuthority(outcome)
      return { customer: null, blocked: true }
    }
    if (!observed.url || !isHttpsUrl(observed.url)) {
      const outcome = recordObservedCheckoutSession(
        context.connection,
        userId,
        attempt,
        observed,
        reconcilableAttemptStates,
        'reconciliation_required'
      )
      requireCurrentAuthority(outcome)
      return { customer: null, blocked: true }
    }
    const outcome = recordObservedCheckoutSession(
      context.connection,
      userId,
      attempt,
      observed,
      reconcilableAttemptStates,
      'open'
    )
    requireCurrentAuthority(outcome)
    return {
      customer: getBillingCustomerForOrganization(context.connection, attempt.organizationId),
      blocked: outcome !== 'applied'
    }
  }

  if (observed.status === 'complete') {
    const recoveredAttempt = recoverLegacyCheckoutCadence(context, userId, attempt)
    if (!recoveredAttempt) return { customer: null, blocked: true }
    attempt = recoveredAttempt

    const customerId = stripeId(observed.customer)
    if (!customerId) {
      const outcome = recordObservedCheckoutSession(
        context.connection,
        userId,
        attempt,
        observed,
        reconcilableAttemptStates,
        'reconciliation_required'
      )
      requireCurrentAuthority(outcome)
      return { customer: null, blocked: true }
    }
    const result = finalizeReconciledCheckoutSession(context.connection, userId, attempt, observed, customerId)
    requireCurrentAuthority(result.outcome)
    return { customer: result.customer, blocked: result.outcome !== 'applied' }
  }

  const outcome = recordObservedCheckoutSession(
    context.connection,
    userId,
    attempt,
    observed,
    reconcilableAttemptStates,
    'reconciliation_required'
  )
  requireCurrentAuthority(outcome)
  return { customer: null, blocked: true }
}

export async function resolveCheckoutAttemptSession(
  client: Pick<StripeBillingClient, 'checkout'>,
  attempt: Readonly<Pick<BillingCheckoutAttempt, 'id' | 'createdAt' | 'reuseUntil'>>
): Promise<CheckoutAttemptSessionResolution> {
  const created = {
    gte: Math.max(0, Math.floor(new Date(attempt.createdAt).getTime() / 1_000) - 60),
    lte: Math.floor(new Date(attempt.reuseUntil).getTime() / 1_000)
  }
  const seenCursors = new Set<string>()
  let startingAfter: string | undefined
  let correlated: Stripe.Checkout.Session | null = null
  let pageCount = 0

  while (true) {
    const page = await client.checkout.sessions.list({
      created,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {})
    })
    if (
      !page ||
      typeof page !== 'object' ||
      page.object !== 'list' ||
      !Array.isArray(page.data) ||
      typeof page.has_more !== 'boolean'
    ) {
      return { outcome: 'ambiguous', reason: 'checkout_discovery_page_invalid' }
    }

    for (const session of page.data) {
      if (
        !session ||
        session.object !== 'checkout.session' ||
        typeof session.id !== 'string' ||
        session.id.length === 0
      ) {
        return { outcome: 'ambiguous', reason: 'checkout_discovery_page_invalid' }
      }
      if (session.client_reference_id === attempt.id) {
        if (correlated) {
          return { outcome: 'ambiguous', reason: 'multiple_correlated_checkout_sessions' }
        }
        correlated = session
      }
    }

    pageCount += 1
    if (!page.has_more) {
      return correlated ? { outcome: 'found', session: correlated } : { outcome: 'not_found' }
    }
    if (pageCount >= checkoutAttemptSessionDiscoveryMaxPages) {
      return { outcome: 'ambiguous', reason: 'checkout_discovery_truncated' }
    }

    const cursor = page.data.at(-1)?.id
    if (!cursor || seenCursors.has(cursor)) {
      return { outcome: 'ambiguous', reason: 'checkout_pagination_cursor_stalled' }
    }
    seenCursors.add(cursor)
    startingAfter = cursor
  }
}

async function retrieveCheckoutSession(client: StripeBillingClient, sessionId: string) {
  try {
    return await client.checkout.sessions.retrieve(sessionId, { expand: ['line_items'] })
  } catch {
    throw upstreamServiceError(502, 'Stripe Checkout state is temporarily unavailable')
  }
}

function requireAttemptTransition(outcome: AttemptOutcome) {
  if (outcome === 'authority_lost') {
    throw forbiddenError('Billing authority changed during Checkout creation')
  }
  if (outcome === 'state_changed') {
    throw conflictError('Billing state changed during Checkout creation')
  }
}

function requireCurrentAuthority(outcome: AttemptOutcome) {
  if (outcome === 'authority_lost') {
    throw forbiddenError('Billing authority changed during reconciliation')
  }
}

function recoverLegacyCheckoutCadence(
  context: StripeCheckoutContext,
  userId: string,
  attempt: BillingCheckoutAttempt
): BillingCheckoutAttempt | null {
  if (attempt.cadence) return attempt

  const catalog = createStripeBillingCatalog(context.config.stripe)
  const offeringKey = catalog.offeringForPriceId(attempt.stripePriceId)
  const offering = offeringKey ? getBillingOffering(offeringKey) : null
  if (!offering || offering.plan !== attempt.planKey) return null

  const recovered = recoverCheckoutAttemptCadence(context.connection, userId, attempt, offering.cadence)
  requireCurrentAuthority(recovered.outcome)
  return recovered.outcome === 'applied' ? recovered.attempt : null
}

function trimSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export function checkoutSessionCreateParams(
  attempt: BillingCheckoutAttempt,
  stripeCustomerId: string | null
): Stripe.Checkout.SessionCreateParams {
  return {
    mode: 'subscription',
    client_reference_id: attempt.id,
    ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
    line_items: [{ price: attempt.stripePriceId, quantity: 1 }],
    success_url: attempt.successUrl,
    cancel_url: attempt.cancelUrl,
    expand: ['line_items'],
    metadata: { billing_attempt_id: attempt.id },
    subscription_data: { metadata: { billing_attempt_id: attempt.id } }
  }
}

export function isExpectedCheckoutSession(
  session: Stripe.Checkout.Session,
  attempt: BillingCheckoutAttempt,
  expectedCustomerId: string | null
) {
  const lineItems = session.line_items
  const lineItem = lineItems?.data[0]
  const observedCustomerId = stripeId(session.customer)
  return (
    session.mode === 'subscription' &&
    session.client_reference_id === attempt.id &&
    session.metadata?.billing_attempt_id === attempt.id &&
    (!expectedCustomerId || observedCustomerId === expectedCustomerId) &&
    Boolean(lineItems) &&
    lineItems?.has_more === false &&
    lineItems.data.length === 1 &&
    stripeId(lineItem?.price ?? null) === attempt.stripePriceId &&
    lineItem?.quantity === 1
  )
}
