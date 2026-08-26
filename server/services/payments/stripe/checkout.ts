import type Stripe from 'stripe'
import {
  finalizeReconciledCheckoutSession,
  mutableAttemptStates,
  readAuthorizedCheckoutAttempt,
  reconcilableAttemptStates,
  recordObservedCheckoutSession,
  reserveCheckoutAttempt,
  transitionCheckoutAttempt,
  type AttemptOutcome,
  type CheckoutAttemptReservationGuard
} from './checkout-store'
import { createStripeBillingCatalog } from './catalog'
import type { BillingStripeRuntimeConfiguration } from './configuration'
import { conflictError, forbiddenError, upstreamServiceError } from '../../../utils/errors'
import { stripeId } from './projection'
import type { BillingStripeConnection, BillingStripeIntegration } from './public-contract'
import { getBillingCustomerById, getBillingCustomerForPurchaser, isBillingDeletionPending } from './repository'
import type { BillingCheckoutAttempt, BillingCustomer } from '../../../db/schema/billing'
import { getBillingOffering, type BillingOfferingKey } from '../../../../shared/billing'
import type { StripeBillingClient } from './stripe-client'

const checkoutAttemptReuseMs = 23 * 60 * 60 * 1_000
const checkoutAttemptSessionDiscoveryMaxPages = 10

export type StripeCheckoutContext = Readonly<{
  connection: BillingStripeConnection
  client: StripeBillingClient
  config: BillingStripeRuntimeConfiguration
  integration?: BillingStripeIntegration<BillingStripeConnection, unknown>
  assertCheckoutAllowed?: CheckoutAttemptReservationGuard
}>

export type CheckoutAttemptSessionResolution =
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
  purchaserUserId: string,
  customer: BillingCustomer | null,
  offeringKey: BillingOfferingKey,
  now = new Date()
): Promise<Readonly<{ url: string }>> {
  const offering = getBillingOffering(offeringKey)!
  const catalog = createStripeBillingCatalog(context.config.stripe.prices)
  const reservationInput = {
    purchaserUserId,
    billingCustomerId: customer?.id ?? null,
    offering: offeringKey,
    stripePriceId: catalog.priceIdForOffering(offeringKey),
    successUrl: `${trimSlash(context.config.appUrl)}/account?checkout=success`,
    cancelUrl: `${trimSlash(context.config.appUrl)}/account?checkout=cancelled`,
    now,
    reuseUntil: new Date(now.getTime() + checkoutAttemptReuseMs)
  }
  let reservation = reserveCheckoutAttempt(
    context.connection,
    context.integration,
    reservationInput,
    context.assertCheckoutAllowed
  )
  if (reservation.outcome !== 'applied') {
    requireCheckoutReservation(context, purchaserUserId, reservation.outcome)
  }
  let attempt = reservation.attempt

  if (
    attempt.planKey !== offering.plan ||
    attempt.cadence !== offering.cadence ||
    attempt.stripePriceId !== reservationInput.stripePriceId ||
    attempt.billingCustomerId !== (customer?.id ?? null)
  ) {
    throw conflictError('A different Checkout is already pending')
  }
  if (attempt.state === 'reconciliation_required') {
    throw conflictError('Checkout state must be reconciled before retrying')
  }

  if (attempt.stripeSessionId) {
    context.assertCheckoutAllowed?.(context.connection, purchaserUserId)
    const existing = await retrieveCheckoutSession(context.client, attempt.stripeSessionId)
    context.assertCheckoutAllowed?.(context.connection, purchaserUserId)
    const expectedCustomer = attempt.billingCustomerId
      ? getBillingCustomerById(context.connection, attempt.billingCustomerId)
      : null
    if (!isExpectedCheckoutSession(existing, attempt, expectedCustomer?.stripeCustomerId ?? null)) {
      requireAttemptTransition(
        recordObservedCheckoutSession(
          context.connection,
          context.integration,
          purchaserUserId,
          attempt,
          existing,
          mutableAttemptStates,
          'reconciliation_required'
        ),
        'creation'
      )
      throw conflictError('Checkout state must be reconciled before retrying')
    }
    if (existing.status === 'expired') {
      requireAttemptTransition(
        recordObservedCheckoutSession(
          context.connection,
          context.integration,
          purchaserUserId,
          attempt,
          existing,
          mutableAttemptStates,
          'expired'
        ),
        'creation'
      )
      reservation = reserveCheckoutAttempt(
        context.connection,
        context.integration,
        reservationInput,
        context.assertCheckoutAllowed
      )
      if (reservation.outcome !== 'applied') {
        requireCheckoutReservation(context, purchaserUserId, reservation.outcome)
      }
      attempt = reservation.attempt
    } else if (existing.status === 'complete') {
      requireAttemptTransition(
        recordObservedCheckoutSession(
          context.connection,
          context.integration,
          purchaserUserId,
          attempt,
          existing,
          mutableAttemptStates,
          'reconciliation_required'
        ),
        'creation'
      )
      throw conflictError('Checkout completion is awaiting verified billing state')
    } else if (existing.status === 'open' && existing.url && isHttpsUrl(existing.url)) {
      requireAttemptTransition(
        recordObservedCheckoutSession(
          context.connection,
          context.integration,
          purchaserUserId,
          attempt,
          existing,
          mutableAttemptStates,
          'open'
        ),
        'creation'
      )
      return { url: existing.url }
    } else {
      requireAttemptTransition(
        recordObservedCheckoutSession(
          context.connection,
          context.integration,
          purchaserUserId,
          attempt,
          existing,
          mutableAttemptStates,
          'reconciliation_required'
        ),
        'creation'
      )
      throw conflictError('Checkout state must be reconciled before retrying')
    }
  }

  if (new Date(attempt.reuseUntil).getTime() <= now.getTime()) {
    requireAttemptTransition(
      transitionCheckoutAttempt(
        context.connection,
        context.integration,
        purchaserUserId,
        attempt,
        mutableAttemptStates,
        { state: 'reconciliation_required' }
      ),
      'creation'
    )
    throw conflictError('Checkout state must be reconciled before retrying')
  }

  const attemptCustomer = attempt.billingCustomerId
    ? getBillingCustomerById(context.connection, attempt.billingCustomerId)
    : null
  context.assertCheckoutAllowed?.(context.connection, purchaserUserId)
  let session: Stripe.Checkout.Session
  try {
    session = await context.client.checkout.sessions.create(
      checkoutSessionCreateParams(attempt, attemptCustomer?.stripeCustomerId ?? null),
      { idempotencyKey: attempt.idempotencyKey }
    )
  } catch {
    throw upstreamServiceError(502, 'Stripe Checkout is temporarily unavailable')
  }
  context.assertCheckoutAllowed?.(context.connection, purchaserUserId)

  if (
    !isExpectedCheckoutSession(session, attempt, attemptCustomer?.stripeCustomerId ?? null) ||
    !session.url ||
    session.status !== 'open' ||
    !isHttpsUrl(session.url)
  ) {
    const outcome = recordObservedCheckoutSession(
      context.connection,
      context.integration,
      purchaserUserId,
      attempt,
      session,
      mutableAttemptStates,
      'reconciliation_required'
    )
    if (outcome !== 'applied') requireAttemptTransition(outcome, 'creation')
    throw upstreamServiceError(502, 'Stripe Checkout returned an unusable session')
  }

  requireAttemptTransition(
    recordObservedCheckoutSession(
      context.connection,
      context.integration,
      purchaserUserId,
      attempt,
      session,
      mutableAttemptStates,
      'open'
    ),
    'creation'
  )
  return { url: session.url }
}

export async function reconcileBillingCheckoutAttempt(
  context: StripeCheckoutContext,
  purchaserUserId: string,
  attempt: BillingCheckoutAttempt,
  now = new Date()
): Promise<Readonly<{ customer: BillingCustomer | null; blocked: boolean }>> {
  let resolution: CheckoutAttemptSessionResolution
  try {
    resolution = await resolveCheckoutAttemptSession(context.client, attempt)
  } catch {
    throw upstreamServiceError(502, 'Stripe Checkout state is temporarily unavailable')
  }

  if (resolution.outcome === 'ambiguous') {
    const outcome = transitionCheckoutAttempt(
      context.connection,
      context.integration,
      purchaserUserId,
      attempt,
      reconcilableAttemptStates,
      { state: 'reconciliation_required' }
    )
    requireCurrentAuthority(outcome)
    return { customer: null, blocked: true }
  }

  if (resolution.outcome === 'not_found') {
    const live = readAuthorizedCheckoutAttempt(context.connection, context.integration, purchaserUserId, attempt)
    requireCurrentAuthority(live.outcome)
    if (live.outcome !== 'applied' || !live.attempt) return { customer: null, blocked: true }
    attempt = live.attempt
    if (new Date(attempt.reuseUntil).getTime() <= now.getTime()) {
      const outcome = transitionCheckoutAttempt(
        context.connection,
        context.integration,
        purchaserUserId,
        attempt,
        reconcilableAttemptStates,
        { state: 'failed' }
      )
      requireCurrentAuthority(outcome)
      if (outcome !== 'applied') return { customer: null, blocked: true }
    } else if (attempt.state === 'reconciliation_required') {
      return { customer: null, blocked: true }
    }
    return {
      customer: getBillingCustomerForPurchaser(context.connection, purchaserUserId),
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
      context.integration,
      purchaserUserId,
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
      context.integration,
      purchaserUserId,
      attempt,
      observed,
      reconcilableAttemptStates,
      'expired'
    )
    requireCurrentAuthority(outcome)
    return {
      customer: getBillingCustomerForPurchaser(context.connection, purchaserUserId),
      blocked: outcome !== 'applied'
    }
  }

  if (observed.status === 'open') {
    if (!observed.url || !isHttpsUrl(observed.url)) {
      const outcome = recordObservedCheckoutSession(
        context.connection,
        context.integration,
        purchaserUserId,
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
      context.integration,
      purchaserUserId,
      attempt,
      observed,
      reconcilableAttemptStates,
      'open'
    )
    requireCurrentAuthority(outcome)
    return {
      customer: getBillingCustomerForPurchaser(context.connection, purchaserUserId),
      blocked: outcome !== 'applied'
    }
  }

  if (observed.status === 'complete') {
    const customerId = stripeId(observed.customer)
    if (!customerId || !customerId.startsWith('cus_')) {
      const outcome = recordObservedCheckoutSession(
        context.connection,
        context.integration,
        purchaserUserId,
        attempt,
        observed,
        reconcilableAttemptStates,
        'reconciliation_required'
      )
      requireCurrentAuthority(outcome)
      return { customer: null, blocked: true }
    }
    const result = finalizeReconciledCheckoutSession(
      context.connection,
      context.integration,
      purchaserUserId,
      attempt,
      observed,
      customerId
    )
    requireCurrentAuthority(result.outcome)
    return { customer: result.customer, blocked: result.outcome !== 'applied' }
  }

  const outcome = recordObservedCheckoutSession(
    context.connection,
    context.integration,
    purchaserUserId,
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
): boolean {
  const lineItems = session.line_items
  const lineItem = lineItems?.data[0]
  const observedCustomerId = stripeId(session.customer)
  return (
    session.object === 'checkout.session' &&
    typeof session.id === 'string' &&
    session.id.length > 0 &&
    session.mode === 'subscription' &&
    session.client_reference_id === attempt.id &&
    session.metadata?.billing_attempt_id === attempt.id &&
    (!observedCustomerId || observedCustomerId.startsWith('cus_')) &&
    (!expectedCustomerId || observedCustomerId === expectedCustomerId) &&
    lineItems?.object === 'list' &&
    lineItems.has_more === false &&
    lineItems.data.length === 1 &&
    stripeId(lineItem?.price ?? null) === attempt.stripePriceId &&
    lineItem?.quantity === 1
  )
}

async function retrieveCheckoutSession(
  client: StripeBillingClient,
  sessionId: string
): Promise<Stripe.Checkout.Session> {
  try {
    return await client.checkout.sessions.retrieve(sessionId, { expand: ['line_items'] })
  } catch {
    throw upstreamServiceError(502, 'Stripe Checkout state is temporarily unavailable')
  }
}

function requireCheckoutReservation(
  context: StripeCheckoutContext,
  purchaserUserId: string,
  outcome: Exclude<AttemptOutcome, 'applied'>
): never {
  if (outcome === 'authority_lost') throw forbiddenError('Billing authority changed during Checkout creation')
  if (isBillingDeletionPending(context.connection, purchaserUserId)) {
    throw conflictError('Billing is locked while account deletion is pending')
  }
  if (outcome === 'reconciliation_required') {
    throw conflictError('Checkout state must be reconciled before retrying')
  }
  throw conflictError('Billing state changed during Checkout creation')
}

function requireAttemptTransition(outcome: AttemptOutcome, operation: 'creation' | 'reconciliation'): void {
  if (outcome === 'authority_lost') {
    throw forbiddenError(`Billing authority changed during Checkout ${operation}`)
  }
  if (outcome === 'state_changed') {
    throw conflictError(`Billing state changed during Checkout ${operation}`)
  }
  if (outcome === 'reconciliation_required') {
    throw conflictError('Checkout state must be reconciled before retrying')
  }
}

function requireCurrentAuthority(outcome: AttemptOutcome): void {
  if (outcome === 'authority_lost') {
    throw forbiddenError('Billing authority changed during reconciliation')
  }
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
