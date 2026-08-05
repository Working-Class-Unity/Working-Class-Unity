import { randomUUID } from 'node:crypto'
import type Stripe from 'stripe'
import { evaluateStripeSubscriptionAccess } from './dunning'
import {
  authorizePurchaserBilling,
  type BillingStripeConnection,
  type BillingStripeIntegration
} from './public-contract'
import {
  getBillingCustomerById,
  getBillingCustomerByStripeId,
  getBillingCustomerForPurchaser,
  getBillingSubscriptionForPurchaser,
  getCheckoutAttemptById,
  getOpenBillingTransition,
  getOpenCheckoutAttempt,
  isBillingDeletionPending
} from './repository'
import type { BillingCheckoutAttempt, BillingCustomer, CheckoutAttemptState } from '../../../db/schema/billing'
import { getBillingOffering, isBillingOfferingKey, type BillingOfferingKey } from '../../../../shared/billing'
import { stripeId } from './projection'

export const mutableAttemptStates = ['pending', 'open'] as const
export const reconcilableAttemptStates = ['pending', 'open', 'reconciliation_required'] as const

export type AttemptOutcome = 'applied' | 'authority_lost' | 'state_changed' | 'reconciliation_required'

export type CheckoutAttemptReservationInput = Readonly<{
  purchaserUserId: string
  billingCustomerId: string | null
  offering: BillingOfferingKey
  stripePriceId: string
  successUrl: string
  cancelUrl: string
  now: Date
  reuseUntil: Date
}>

export type CheckoutAttemptReservationResult =
  | Readonly<{ outcome: 'applied'; attempt: BillingCheckoutAttempt }>
  | Readonly<{
      outcome: Exclude<AttemptOutcome, 'applied'>
      attempt: BillingCheckoutAttempt | null
    }>

type CheckoutIntegration = BillingStripeIntegration<BillingStripeConnection, unknown> | undefined

export function reserveCheckoutAttempt(
  connection: BillingStripeConnection,
  integration: CheckoutIntegration,
  input: CheckoutAttemptReservationInput
): CheckoutAttemptReservationResult {
  return connection.sqlite
    .transaction(() => {
      let existing = getOpenCheckoutAttempt(connection, input.purchaserUserId)
      if (
        isBillingDeletionPending(connection, input.purchaserUserId) ||
        getOpenBillingTransition(connection, input.purchaserUserId)
      ) {
        return { outcome: 'state_changed' as const, attempt: existing }
      }
      if (subscriptionBlocksCheckout(connection, input.purchaserUserId, input.now)) {
        return { outcome: 'state_changed' as const, attempt: existing }
      }
      if (!matchesPurchaserCustomer(connection, input.purchaserUserId, input.billingCustomerId)) {
        return { outcome: 'state_changed' as const, attempt: existing }
      }
      if (existing && existing.billingCustomerId !== input.billingCustomerId) {
        return { outcome: 'state_changed' as const, attempt: existing }
      }

      const authorization = authorizePurchaserBilling(connection, integration, {
        kind: 'checkout',
        purchaserUserId: input.purchaserUserId,
        offering: input.offering
      })
      if (authorization !== 'authorized') {
        if (authorization === 'reconciliation_required' && existing) {
          existing = setAttemptReconciliationRequired(connection, existing) ?? existing
        }
        return { outcome: authorization, attempt: existing }
      }

      const afterAuthorization = getOpenCheckoutAttempt(connection, input.purchaserUserId)
      if (
        isBillingDeletionPending(connection, input.purchaserUserId) ||
        getOpenBillingTransition(connection, input.purchaserUserId)
      ) {
        return { outcome: 'state_changed' as const, attempt: afterAuthorization }
      }
      if (subscriptionBlocksCheckout(connection, input.purchaserUserId, input.now)) {
        return { outcome: 'state_changed' as const, attempt: afterAuthorization }
      }
      if (!matchesPurchaserCustomer(connection, input.purchaserUserId, input.billingCustomerId)) {
        return { outcome: 'state_changed' as const, attempt: afterAuthorization }
      }
      if (existing) {
        if (!afterAuthorization || !sameAttemptSnapshot(existing, afterAuthorization)) {
          return { outcome: 'state_changed' as const, attempt: afterAuthorization }
        }
        return { outcome: 'applied' as const, attempt: afterAuthorization }
      }
      if (afterAuthorization) {
        return { outcome: 'state_changed' as const, attempt: afterAuthorization }
      }

      const offering = getBillingOffering(input.offering)!
      const timestamp = input.now.toISOString()
      const attemptId = `billing_attempt_${randomUUID()}`
      connection.sqlite
        .prepare(
          `insert into billing_checkout_attempts (
             id, purchaser_user_id, billing_customer_id, plan_key, cadence, stripe_price_id,
             stripe_session_id, idempotency_key, state, success_url, cancel_url, reuse_until,
             created_at, updated_at
           ) values (?, ?, ?, ?, ?, ?, null, ?, 'pending', ?, ?, ?, ?, ?)`
        )
        .run(
          attemptId,
          input.purchaserUserId,
          input.billingCustomerId,
          offering.plan,
          offering.cadence,
          input.stripePriceId,
          `checkout_${randomUUID()}`,
          input.successUrl,
          input.cancelUrl,
          input.reuseUntil.toISOString(),
          timestamp,
          timestamp
        )
      const attempt = getCheckoutAttemptById(connection, attemptId)
      if (!attempt) throw new Error('Failed to reserve Stripe Checkout attempt')
      return { outcome: 'applied' as const, attempt }
    })
    .immediate()
}

export function transitionCheckoutAttempt(
  connection: BillingStripeConnection,
  integration: CheckoutIntegration,
  purchaserUserId: string,
  expectedAttempt: BillingCheckoutAttempt,
  allowedStates: readonly CheckoutAttemptState[],
  update: Partial<Pick<BillingCheckoutAttempt, 'state' | 'stripeSessionId' | 'billingCustomerId'>>
): AttemptOutcome {
  return connection.sqlite
    .transaction(() => {
      const authorized = readAuthorizedAttemptInTransaction(connection, integration, purchaserUserId, expectedAttempt)
      if (authorized.outcome !== 'applied') return authorized.outcome
      if (!allowedStates.includes(authorized.attempt.state)) return 'state_changed'
      return updateAttemptCas(connection, authorized.attempt, update) ? 'applied' : 'state_changed'
    })
    .immediate()
}

export function recordObservedCheckoutSession(
  connection: BillingStripeConnection,
  integration: CheckoutIntegration,
  purchaserUserId: string,
  expectedAttempt: BillingCheckoutAttempt,
  session: Stripe.Checkout.Session,
  allowedStates: readonly CheckoutAttemptState[],
  state: CheckoutAttemptState
): AttemptOutcome {
  return connection.sqlite
    .transaction(() => {
      const authorized = readAuthorizedAttemptInTransaction(connection, integration, purchaserUserId, expectedAttempt)
      if (authorized.outcome !== 'applied') {
        if (authorized.outcome === 'authority_lost') {
          detachObservedCheckoutSession(connection, expectedAttempt.id, session, 'attempt')
        } else {
          retainUnauthorizedCheckoutSession(connection, expectedAttempt, authorized.attempt, session)
        }
        return authorized.outcome
      }

      const attempt = authorized.attempt
      const sessionId = checkoutSessionId(session)
      if (!allowedStates.includes(attempt.state)) {
        if (sessionId && attempt.stripeSessionId !== sessionId) {
          detachObservedCheckoutSession(connection, expectedAttempt.id, session, 'session')
        }
        return 'state_changed'
      }
      if (attempt.stripeSessionId && attempt.stripeSessionId !== sessionId) {
        updateAttemptCas(connection, attempt, { state: 'reconciliation_required' })
        detachObservedCheckoutSession(connection, expectedAttempt.id, session, sessionId ? 'session' : 'attempt')
        return 'state_changed'
      }
      if (!sessionId) {
        updateAttemptCas(connection, attempt, { state: 'reconciliation_required' })
        detachObservedCheckoutSession(connection, expectedAttempt.id, session, 'attempt')
        return 'state_changed'
      }

      if (state === 'open' && subscriptionBlocksCheckout(connection, purchaserUserId, new Date())) {
        updateAttemptCas(connection, attempt, {
          stripeSessionId: sessionId,
          state: 'reconciliation_required'
        })
        return 'state_changed'
      }

      const expectedCustomer = attempt.billingCustomerId
        ? getBillingCustomerById(connection, attempt.billingCustomerId)
        : null
      const observedCustomerId = stripeId(session.customer)
      const purchaserCustomer = getBillingCustomerForPurchaser(connection, purchaserUserId)
      const providerCustomer = observedCustomerId ? getBillingCustomerByStripeId(connection, observedCustomerId) : null
      if (
        (expectedCustomer && (!observedCustomerId || expectedCustomer.stripeCustomerId !== observedCustomerId)) ||
        (!expectedCustomer && purchaserCustomer) ||
        (providerCustomer && providerCustomer.purchaserUserId !== purchaserUserId)
      ) {
        updateAttemptCas(connection, attempt, {
          stripeSessionId: sessionId,
          state: 'reconciliation_required'
        })
        return 'state_changed'
      }

      return updateAttemptCas(connection, attempt, { stripeSessionId: sessionId, state }) ? 'applied' : 'state_changed'
    })
    .immediate()
}

export function finalizeReconciledCheckoutSession(
  connection: BillingStripeConnection,
  integration: CheckoutIntegration,
  purchaserUserId: string,
  expectedAttempt: BillingCheckoutAttempt,
  session: Stripe.Checkout.Session,
  stripeCustomerId: string
): Readonly<{ outcome: AttemptOutcome; customer: BillingCustomer | null }> {
  return connection.sqlite
    .transaction(() => {
      const authorized = readAuthorizedAttemptInTransaction(connection, integration, purchaserUserId, expectedAttempt)
      if (authorized.outcome !== 'applied') {
        if (authorized.outcome === 'authority_lost') {
          detachObservedCheckoutSession(connection, expectedAttempt.id, session, 'attempt')
        } else {
          retainUnauthorizedCheckoutSession(connection, expectedAttempt, authorized.attempt, session)
        }
        return { outcome: authorized.outcome, customer: null }
      }

      const attempt = authorized.attempt
      const sessionId = checkoutSessionId(session)
      if (
        !sessionId ||
        !reconcilableAttemptStates.includes(attempt.state as (typeof reconcilableAttemptStates)[number]) ||
        (attempt.stripeSessionId && attempt.stripeSessionId !== sessionId)
      ) {
        if (!sessionId || attempt.stripeSessionId !== sessionId) {
          detachObservedCheckoutSession(connection, expectedAttempt.id, session, sessionId ? 'session' : 'attempt')
        }
        return { outcome: 'state_changed' as const, customer: null }
      }

      const purchaserCustomer = getBillingCustomerForPurchaser(connection, purchaserUserId)
      const providerCustomer = getBillingCustomerByStripeId(connection, stripeCustomerId)
      if (
        (purchaserCustomer && purchaserCustomer.stripeCustomerId !== stripeCustomerId) ||
        (providerCustomer && providerCustomer.purchaserUserId !== purchaserUserId) ||
        (attempt.billingCustomerId && attempt.billingCustomerId !== purchaserCustomer?.id)
      ) {
        updateAttemptCas(connection, attempt, {
          stripeSessionId: sessionId,
          state: 'reconciliation_required'
        })
        return { outcome: 'state_changed' as const, customer: null }
      }

      if (subscriptionBlocksCheckout(connection, purchaserUserId, new Date())) {
        updateAttemptCas(connection, attempt, {
          stripeSessionId: sessionId,
          state: 'reconciliation_required'
        })
        return { outcome: 'state_changed' as const, customer: purchaserCustomer }
      }

      if (!purchaserCustomer && !providerCustomer) {
        const timestamp = new Date().toISOString()
        connection.sqlite
          .prepare(
            `insert into billing_customers (
               id, purchaser_user_id, stripe_customer_id, created_at, updated_at
             ) values (?, ?, ?, ?, ?)`
          )
          .run(`billing_customer_${randomUUID()}`, purchaserUserId, stripeCustomerId, timestamp, timestamp)
      }

      const customer = getBillingCustomerForPurchaser(connection, purchaserUserId)
      if (!customer || customer.stripeCustomerId !== stripeCustomerId) {
        throw new Error('Failed to persist the reconciled Stripe Customer')
      }
      if (
        !updateAttemptCas(connection, attempt, {
          billingCustomerId: customer.id,
          stripeSessionId: sessionId,
          state: 'completed'
        })
      ) {
        throw new Error('Failed to finalize the reconciled Stripe Checkout attempt')
      }
      return { outcome: 'applied' as const, customer }
    })
    .immediate()
}

export function readAuthorizedCheckoutAttempt(
  connection: BillingStripeConnection,
  integration: CheckoutIntegration,
  purchaserUserId: string,
  expectedAttempt: BillingCheckoutAttempt
): Readonly<{ outcome: AttemptOutcome; attempt: BillingCheckoutAttempt | null }> {
  return connection.sqlite
    .transaction(() => readAuthorizedAttemptInTransaction(connection, integration, purchaserUserId, expectedAttempt))
    .immediate()
}

function readAuthorizedAttemptInTransaction(
  connection: BillingStripeConnection,
  integration: CheckoutIntegration,
  purchaserUserId: string,
  expectedAttempt: BillingCheckoutAttempt
):
  | Readonly<{ outcome: 'applied'; attempt: BillingCheckoutAttempt }>
  | Readonly<{ outcome: Exclude<AttemptOutcome, 'applied'>; attempt: BillingCheckoutAttempt | null }> {
  const live = getCheckoutAttemptById(connection, expectedAttempt.id)
  if (expectedAttempt.purchaserUserId !== purchaserUserId || !live || live.purchaserUserId !== purchaserUserId) {
    return { outcome: 'authority_lost', attempt: null }
  }
  if (!sameAttemptIdentity(live, expectedAttempt)) {
    return { outcome: 'state_changed', attempt: live }
  }
  if (isBillingDeletionPending(connection, purchaserUserId)) {
    return { outcome: 'state_changed', attempt: live }
  }

  const offering = `${live.planKey}.${live.cadence}`
  if (!isBillingOfferingKey(offering)) {
    const reconciled = setAttemptReconciliationRequired(connection, live)
    return { outcome: 'reconciliation_required', attempt: reconciled ?? live }
  }
  const authorization = authorizePurchaserBilling(connection, integration, {
    kind: 'checkout',
    purchaserUserId,
    offering
  })
  const afterAuthorization = getCheckoutAttemptById(connection, live.id)
  if (!afterAuthorization) return { outcome: 'authority_lost', attempt: null }
  if (!sameAttemptSnapshot(live, afterAuthorization) || isBillingDeletionPending(connection, purchaserUserId)) {
    return { outcome: 'state_changed', attempt: afterAuthorization }
  }
  if (authorization === 'authorized') return { outcome: 'applied', attempt: afterAuthorization }
  if (authorization === 'reconciliation_required') {
    const reconciled = setAttemptReconciliationRequired(connection, afterAuthorization)
    return reconciled
      ? { outcome: 'reconciliation_required', attempt: reconciled }
      : { outcome: 'state_changed', attempt: getCheckoutAttemptById(connection, afterAuthorization.id) }
  }
  return { outcome: authorization, attempt: afterAuthorization }
}

function matchesPurchaserCustomer(
  connection: BillingStripeConnection,
  purchaserUserId: string,
  billingCustomerId: string | null
): boolean {
  return (getBillingCustomerForPurchaser(connection, purchaserUserId)?.id ?? null) === billingCustomerId
}

function subscriptionBlocksCheckout(connection: BillingStripeConnection, purchaserUserId: string, now: Date): boolean {
  const subscription = getBillingSubscriptionForPurchaser(connection, purchaserUserId)
  if (!subscription) return false
  const access = evaluateStripeSubscriptionAccess(subscription, now)
  return access.state !== 'none' && access.state !== 'terminal'
}

function setAttemptReconciliationRequired(
  connection: BillingStripeConnection,
  attempt: BillingCheckoutAttempt
): BillingCheckoutAttempt | null {
  if (!reconcilableAttemptStates.includes(attempt.state as (typeof reconcilableAttemptStates)[number])) {
    return attempt
  }
  return updateAttemptCas(connection, attempt, { state: 'reconciliation_required' })
    ? getCheckoutAttemptById(connection, attempt.id)
    : null
}

function updateAttemptCas(
  connection: BillingStripeConnection,
  expected: BillingCheckoutAttempt,
  update: Partial<Pick<BillingCheckoutAttempt, 'state' | 'stripeSessionId' | 'billingCustomerId'>>
): boolean {
  const result = connection.sqlite
    .prepare(
      `update billing_checkout_attempts
       set billing_customer_id = ?, stripe_session_id = ?, state = ?, updated_at = ?
       where id = ? and purchaser_user_id = ? and state = ?
         and billing_customer_id is ? and stripe_session_id is ? and updated_at = ?`
    )
    .run(
      update.billingCustomerId === undefined ? expected.billingCustomerId : update.billingCustomerId,
      update.stripeSessionId === undefined ? expected.stripeSessionId : update.stripeSessionId,
      update.state ?? expected.state,
      new Date().toISOString(),
      expected.id,
      expected.purchaserUserId,
      expected.state,
      expected.billingCustomerId,
      expected.stripeSessionId,
      expected.updatedAt
    )
  return result.changes === 1
}

function sameAttemptIdentity(left: BillingCheckoutAttempt, right: BillingCheckoutAttempt): boolean {
  return (
    left.id === right.id &&
    left.purchaserUserId === right.purchaserUserId &&
    left.planKey === right.planKey &&
    left.cadence === right.cadence &&
    left.stripePriceId === right.stripePriceId &&
    left.idempotencyKey === right.idempotencyKey &&
    left.successUrl === right.successUrl &&
    left.cancelUrl === right.cancelUrl &&
    left.reuseUntil === right.reuseUntil &&
    left.createdAt === right.createdAt
  )
}

function sameAttemptSnapshot(left: BillingCheckoutAttempt, right: BillingCheckoutAttempt): boolean {
  return (
    sameAttemptIdentity(left, right) &&
    left.billingCustomerId === right.billingCustomerId &&
    left.stripeSessionId === right.stripeSessionId &&
    left.state === right.state &&
    left.updatedAt === right.updatedAt
  )
}

function checkoutSessionId(session: Stripe.Checkout.Session): string | null {
  return typeof session.id === 'string' && session.id.length > 0 ? session.id : null
}

function retainUnauthorizedCheckoutSession(
  connection: BillingStripeConnection,
  expectedAttempt: BillingCheckoutAttempt,
  liveAttempt: BillingCheckoutAttempt | null,
  session: Stripe.Checkout.Session
): void {
  if (
    liveAttempt &&
    liveAttempt.purchaserUserId === expectedAttempt.purchaserUserId &&
    sameAttemptIdentity(liveAttempt, expectedAttempt)
  ) {
    parkObservedCheckoutSession(connection, liveAttempt, session)
    return
  }
  detachObservedCheckoutSession(
    connection,
    expectedAttempt.id,
    session,
    checkoutSessionId(session) ? 'session' : 'attempt'
  )
}

function parkObservedCheckoutSession(
  connection: BillingStripeConnection,
  attempt: BillingCheckoutAttempt,
  session: Stripe.Checkout.Session
): void {
  const sessionId = checkoutSessionId(session)
  if (!sessionId) {
    setAttemptReconciliationRequired(connection, attempt)
    detachObservedCheckoutSession(connection, attempt.id, session, 'attempt')
    return
  }
  if (!reconcilableAttemptStates.includes(attempt.state as (typeof reconcilableAttemptStates)[number])) {
    if (attempt.stripeSessionId !== sessionId) {
      detachObservedCheckoutSession(connection, attempt.id, session, 'session')
    }
    return
  }
  if (attempt.stripeSessionId && attempt.stripeSessionId !== sessionId) {
    setAttemptReconciliationRequired(connection, attempt)
    detachObservedCheckoutSession(connection, attempt.id, session, 'session')
    return
  }
  if (
    !updateAttemptCas(connection, attempt, {
      stripeSessionId: sessionId,
      state: 'reconciliation_required'
    })
  ) {
    detachObservedCheckoutSession(connection, attempt.id, session, 'session')
  }
}

function detachObservedCheckoutSession(
  connection: BillingStripeConnection,
  attemptId: string,
  session: Stripe.Checkout.Session,
  reference: 'attempt' | 'session'
): void {
  const now = new Date().toISOString()
  const sessionId = checkoutSessionId(session)
  const providerReference = reference === 'session' && sessionId ? `checkout:${sessionId}` : `attempt:${attemptId}`
  connection.sqlite
    .prepare(
      `insert into detached_billing_subjects (
         id, provider, provider_reference, provider_customer_reference, provider_status,
         provider_status_expires_at, provider_event_created_at, status_updated_at, deleted_at,
         retention_purpose, retention_policy, purge_after
       ) values (?, 'stripe', ?, ?, ?, ?, null, ?, ?, 'external_billing_reconciliation',
                 'stripe_billing_lifecycle', null)
       on conflict(provider, provider_reference) do update set
         provider_customer_reference = coalesce(excluded.provider_customer_reference, provider_customer_reference),
         provider_status = excluded.provider_status,
         provider_status_expires_at = excluded.provider_status_expires_at,
         status_updated_at = excluded.status_updated_at`
    )
    .run(
      `detached_billing_${randomUUID()}`,
      providerReference,
      stripeId(session.customer),
      `checkout_${session.status ?? 'unknown'}`,
      session.expires_at ? new Date(session.expires_at * 1_000).toISOString() : null,
      now,
      now
    )
}
