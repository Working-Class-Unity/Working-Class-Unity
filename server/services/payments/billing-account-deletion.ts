import { randomUUID } from 'node:crypto'
import { APIError } from 'better-auth/api'
import { createError, type H3Error } from 'h3'
import type Stripe from 'stripe'
import type { DatabaseConnection } from '../../db/connect'
import {
  getBillingCustomerById,
  getBillingCustomerByStripeId,
  getBillingCustomerForOrganization,
  getCheckoutAttemptById
} from '../../db/repositories/billing'
import type { BillingCheckoutAttempt } from '../../db/schema'
import { issueAccountDeletionBillingProof } from './account-deletion-billing-proof'
import type { StripeBillingCatalog } from './billing-catalog'
import {
  checkoutSessionCreateParams,
  isExpectedCheckoutSession,
  resolveCheckoutAttemptSession
} from './billing-checkout'
import { readCurrentStripeProjection } from './billing-projection'
import { isTerminalStripeSubscription, resolveLiveStripeSubscription } from './billing-subscription-discovery'
import type { StripeBillingClient } from './stripe-client'
import {
  adoptBillingAccountDeletionSubscription,
  billingAccountDeletionIdempotencyKey,
  billingAccountDeletionReconciliationReasons,
  beginBillingAccountDeletionFence,
  captureBillingAccountDeletionRequest,
  confirmBillingAccountDeletionCancellation,
  confirmBillingAccountDeletionCustomerHasNoLiveSubscriptions,
  getBillingAccountDeletionRequest,
  markBillingAccountDeletionReconciliation,
  reconcileBillingAccountDeletionAfterCustomerCheck,
  type BillingAccountDeletionRequest
} from './billing-account-deletion-store'

export const accountDeletionBillingPendingCode = 'ACCOUNT_DELETION_BILLING_PENDING' as const
export const accountDeletionBillingPendingMessage =
  'Account deletion is awaiting billing confirmation. Please retry.' as const

export type BillingAccountDeletionStripeClient = Pick<StripeBillingClient, 'subscriptions'>
export type BillingAccountDeletionStripeClientFactory = () => BillingAccountDeletionStripeClient
type BillingAccountDeletionPreflightStripeClient = Pick<StripeBillingClient, 'checkout' | 'subscriptions'>
type BillingAccountDeletionPreflightStripeClientFactory = () => BillingAccountDeletionPreflightStripeClient

type CancellationConvergence = 'confirmed' | 'missing' | 'pending'

export async function prepareBillingAccountDeletionForConnection(
  connection: DatabaseConnection,
  userId: string,
  getClient: BillingAccountDeletionPreflightStripeClientFactory,
  catalog?: StripeBillingCatalog
): Promise<string> {
  const fence = beginBillingAccountDeletionFence(connection, userId)
  if (!fence) throw billingAccountDeletionPendingHttpError()
  if (fence.checkoutAttempt) {
    await neutralizeBillingAccountDeletionCheckout(connection, userId, fence.checkoutAttempt, getClient)
  }

  const captured = captureBillingAccountDeletionRequest(connection, userId)
  if (captured.kind === 'not-required') return issueAccountDeletionBillingProof(userId)

  if (captured.kind === 'cancellation-required') {
    const result = await convergeBillingAccountDeletionCancellation(connection, captured.request.id, getClient, catalog)
    if (result !== 'confirmed') throw billingAccountDeletionPendingHttpError()
  }

  const request = getBillingAccountDeletionRequest(connection, captured.request.id)
  if (!request) throw billingAccountDeletionPendingHttpError()
  if (!(await verifyCustomerHasNoLiveSubscriptions(connection, request, getClient))) {
    throw billingAccountDeletionPendingHttpError()
  }

  const confirmed = confirmBillingAccountDeletionCustomerHasNoLiveSubscriptions(connection, request.id)
  if (confirmed?.state !== 'cancellation_confirmed') throw billingAccountDeletionPendingHttpError()
  return issueAccountDeletionBillingProof(userId)
}

async function neutralizeBillingAccountDeletionCheckout(
  connection: DatabaseConnection,
  userId: string,
  attempt: BillingCheckoutAttempt,
  getClient: BillingAccountDeletionPreflightStripeClientFactory
): Promise<void> {
  let client: BillingAccountDeletionPreflightStripeClient
  try {
    client = getClient()
  } catch {
    throw billingAccountDeletionPendingHttpError()
  }

  const expectedCustomer = attempt.billingCustomerId
    ? getBillingCustomerById(connection, attempt.billingCustomerId)
    : null
  if (attempt.billingCustomerId && !expectedCustomer) throw billingAccountDeletionPendingHttpError()

  let session: Stripe.Checkout.Session
  try {
    if (attempt.stripeSessionId) {
      session = await client.checkout.sessions.retrieve(attempt.stripeSessionId, {
        expand: ['line_items']
      })
    } else {
      const resolution = await resolveCheckoutAttemptSession(client, attempt)
      if (resolution.outcome === 'ambiguous') throw new Error('Checkout discovery was ambiguous')
      if (resolution.outcome === 'found') {
        session = await client.checkout.sessions.retrieve(resolution.session.id, {
          expand: ['line_items']
        })
      } else {
        const reuseUntil = Date.parse(attempt.reuseUntil)
        if (!Number.isFinite(reuseUntil) || reuseUntil <= Date.now()) {
          throw new Error('Checkout replay window elapsed')
        }
        session = await client.checkout.sessions.create(
          checkoutSessionCreateParams(attempt, expectedCustomer?.stripeCustomerId ?? null),
          { idempotencyKey: attempt.idempotencyKey }
        )
      }
    }
  } catch {
    throw billingAccountDeletionPendingHttpError()
  }

  if (!session.id || !isExpectedCheckoutSession(session, attempt, expectedCustomer?.stripeCustomerId ?? null)) {
    throw billingAccountDeletionPendingHttpError()
  }

  if (session.status === 'open') {
    try {
      await client.checkout.sessions.expire(
        session.id,
        {},
        { idempotencyKey: billingCheckoutAccountDeletionIdempotencyKey('expire', attempt.id) }
      )
    } catch {
      // A completion can win the race with expiration, and an expiration
      // response can be lost. The exact read below is authoritative.
    }
    try {
      session = await client.checkout.sessions.retrieve(session.id, {
        expand: ['line_items']
      })
    } catch {
      throw billingAccountDeletionPendingHttpError()
    }
    if (!session.id || !isExpectedCheckoutSession(session, attempt, expectedCustomer?.stripeCustomerId ?? null)) {
      throw billingAccountDeletionPendingHttpError()
    }
  }

  if (session.status === 'expired') {
    if (!recordDeletionCheckoutTerminalState(connection, userId, attempt, session, null, 'expired')) {
      throw billingAccountDeletionPendingHttpError()
    }
    return
  }
  if (session.status !== 'complete') throw billingAccountDeletionPendingHttpError()

  const customerId = stripeCustomerId(session.customer)
  const subscriptionId = stripeSubscriptionId(session.subscription)
  if (!customerId || !subscriptionId) throw billingAccountDeletionPendingHttpError()

  let subscription: Stripe.Subscription
  try {
    subscription = await client.subscriptions.retrieve(subscriptionId)
  } catch {
    throw billingAccountDeletionPendingHttpError()
  }
  if (subscription?.id !== subscriptionId || stripeCustomerId(subscription.customer) !== customerId) {
    throw billingAccountDeletionPendingHttpError()
  }
  if (!isTerminalStripeSubscription(subscription)) {
    try {
      await client.subscriptions.cancel(
        subscriptionId,
        { invoice_now: false, prorate: false },
        { idempotencyKey: billingCheckoutAccountDeletionIdempotencyKey('cancel', attempt.id) }
      )
    } catch {
      // An exact read proves whether an indeterminate cancellation converged.
    }
    try {
      subscription = await client.subscriptions.retrieve(subscriptionId)
    } catch {
      throw billingAccountDeletionPendingHttpError()
    }
    if (
      subscription?.id !== subscriptionId ||
      stripeCustomerId(subscription.customer) !== customerId ||
      !isTerminalStripeSubscription(subscription)
    ) {
      throw billingAccountDeletionPendingHttpError()
    }
  }
  if (!recordDeletionCheckoutTerminalState(connection, userId, attempt, session, customerId, 'completed')) {
    throw billingAccountDeletionPendingHttpError()
  }
}

function recordDeletionCheckoutTerminalState(
  connection: DatabaseConnection,
  userId: string,
  expected: BillingCheckoutAttempt,
  session: Stripe.Checkout.Session,
  stripeCustomerIdValue: string | null,
  state: 'completed' | 'expired'
): boolean {
  return connection.sqlite
    .transaction(() => {
      const owner = connection.sqlite
        .prepare(
          `select id
           from organization
           where personal_owner_user_id = ?
             and billing_deletion_pending = 1`
        )
        .get(userId) as { id: string } | undefined
      const attempt = getCheckoutAttemptById(connection, expected.id)
      if (
        !owner ||
        owner.id !== expected.organizationId ||
        !attempt ||
        attempt.organizationId !== owner.id ||
        (attempt.stripeSessionId && attempt.stripeSessionId !== session.id) ||
        !['pending', 'open', 'reconciliation_required', state].includes(attempt.state)
      ) {
        return false
      }

      let billingCustomerId = attempt.billingCustomerId
      if (state === 'completed') {
        if (!stripeCustomerIdValue) return false
        const organizationCustomer = getBillingCustomerForOrganization(connection, owner.id)
        const providerCustomer = getBillingCustomerByStripeId(connection, stripeCustomerIdValue)
        if (
          (organizationCustomer && organizationCustomer.stripeCustomerId !== stripeCustomerIdValue) ||
          (providerCustomer && providerCustomer.organizationId !== owner.id)
        ) {
          return false
        }
        if (!organizationCustomer && !providerCustomer) {
          const now = new Date().toISOString()
          connection.sqlite
            .prepare(
              `insert into billing_customers (
                 id, organization_id, stripe_customer_id, created_at, updated_at
               ) values (?, ?, ?, ?, ?)`
            )
            .run(`billing_customer_${randomUUID()}`, owner.id, stripeCustomerIdValue, now, now)
        }
        billingCustomerId = getBillingCustomerForOrganization(connection, owner.id)?.id ?? null
        if (!billingCustomerId) return false
      }

      const updated = connection.sqlite
        .prepare(
          `update billing_checkout_attempts
           set billing_customer_id = ?, stripe_session_id = ?, state = ?, updated_at = ?
           where id = ?
             and organization_id = ?
             and state in ('pending', 'open', 'reconciliation_required', ?)
             and (stripe_session_id is null or stripe_session_id = ?)`
        )
        .run(billingCustomerId, session.id, state, new Date().toISOString(), expected.id, owner.id, state, session.id)
      return updated.changes === 1
    })
    .immediate()
}

function billingCheckoutAccountDeletionIdempotencyKey(operation: 'cancel' | 'expire', attemptId: string): string {
  return `billing-checkout-account-deletion:${operation}:${attemptId}`
}

export async function convergeBillingAccountDeletionCancellation(
  connection: DatabaseConnection,
  requestId: string,
  getClient: BillingAccountDeletionStripeClientFactory,
  catalog?: StripeBillingCatalog
): Promise<CancellationConvergence> {
  let request = getBillingAccountDeletionRequest(connection, requestId)
  if (!request) return 'missing'
  if (request.state === 'cancellation_confirmed') return 'confirmed'

  let client: BillingAccountDeletionStripeClient
  try {
    client = getClient()
  } catch {
    return 'pending'
  }

  if (!request.expectedStripeSubscriptionId) {
    if (!catalog) return 'pending'
    let projection
    try {
      projection = await readCurrentStripeProjection(
        client as StripeBillingClient,
        request.expectedStripeCustomerId,
        catalog
      )
    } catch {
      reconcileBillingAccountDeletionAfterCustomerCheck(
        connection,
        request.id,
        billingAccountDeletionReconciliationReasons.customerSubscriptionVerificationUnavailable
      )
      return 'pending'
    }
    if (
      projection.reconciliationRequired ||
      !projection.stripeSubscriptionId ||
      !['active', 'past_due', 'unpaid'].includes(projection.status)
    ) {
      reconcileBillingAccountDeletionAfterCustomerCheck(
        connection,
        request.id,
        billingAccountDeletionReconciliationReasons.customerSubscriptionStateUnknown
      )
      return 'pending'
    }
    request = adoptBillingAccountDeletionSubscription(connection, request, projection)
    if (!request.expectedStripeSubscriptionId) {
      markBillingAccountDeletionReconciliation(
        connection,
        request,
        billingAccountDeletionReconciliationReasons.billingProjectionChanged
      )
      return 'pending'
    }
  }

  let cancellationReturned = false
  try {
    await client.subscriptions.cancel(
      request.expectedStripeSubscriptionId,
      { invoice_now: false, prorate: false },
      { idempotencyKey: billingAccountDeletionIdempotencyKey(request.id) }
    )
    cancellationReturned = true
  } catch {
    // A lost cancellation response is indistinguishable from a failed request.
    // The exact retrieve below is authoritative and keeps retries replay-safe.
  }

  let retrieved: Stripe.Subscription
  try {
    retrieved = await client.subscriptions.retrieve(request.expectedStripeSubscriptionId)
  } catch {
    return 'pending'
  }

  request = getBillingAccountDeletionRequest(connection, request.id) ?? request
  if (request.state === 'cancellation_confirmed') return 'confirmed'
  if (!retrieved || typeof retrieved !== 'object' || retrieved.id !== request.expectedStripeSubscriptionId) {
    markBillingAccountDeletionReconciliation(
      connection,
      request,
      billingAccountDeletionReconciliationReasons.stripeSubscriptionMismatch
    )
    return 'pending'
  }
  if (stripeCustomerId(retrieved.customer) !== request.expectedStripeCustomerId) {
    markBillingAccountDeletionReconciliation(
      connection,
      request,
      billingAccountDeletionReconciliationReasons.stripeCustomerMismatch
    )
    return 'pending'
  }
  if (retrieved.status !== 'canceled') {
    if (cancellationReturned) {
      markBillingAccountDeletionReconciliation(
        connection,
        request,
        billingAccountDeletionReconciliationReasons.stripeCancellationUnconfirmed
      )
    }
    return 'pending'
  }

  const confirmed = confirmBillingAccountDeletionCancellation(connection, request)
  return confirmed?.state === 'cancellation_confirmed' ? 'confirmed' : 'pending'
}

export function billingAccountDeletionPendingError(): APIError {
  return new APIError('SERVICE_UNAVAILABLE', {
    code: accountDeletionBillingPendingCode,
    message: accountDeletionBillingPendingMessage
  })
}

export function billingAccountDeletionPendingHttpError(): H3Error {
  return createError({
    statusCode: 503,
    statusMessage: accountDeletionBillingPendingMessage,
    data: {
      code: accountDeletionBillingPendingCode,
      message: accountDeletionBillingPendingMessage
    }
  })
}

function stripeCustomerId(customer: unknown): string | null {
  if (typeof customer === 'string') return customer
  if (customer && typeof customer === 'object' && 'id' in customer && typeof customer.id === 'string') {
    return customer.id
  }
  return null
}

function stripeSubscriptionId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
    return value.id
  }
  return null
}

async function verifyCustomerHasNoLiveSubscriptions(
  connection: DatabaseConnection,
  request: BillingAccountDeletionRequest,
  getClient: BillingAccountDeletionStripeClientFactory
): Promise<boolean> {
  let live
  try {
    live = await resolveLiveStripeSubscription(getClient(), request.expectedStripeCustomerId)
  } catch {
    reconcileBillingAccountDeletionAfterCustomerCheck(
      connection,
      request.id,
      billingAccountDeletionReconciliationReasons.customerSubscriptionVerificationUnavailable
    )
    return false
  }

  if (live.outcome === 'ambiguous') {
    reconcileBillingAccountDeletionAfterCustomerCheck(
      connection,
      request.id,
      live.reason === 'multiple_live_subscriptions'
        ? billingAccountDeletionReconciliationReasons.customerHasLiveSubscription
        : billingAccountDeletionReconciliationReasons.customerSubscriptionStateUnknown
    )
    return false
  }
  if (live.outcome === 'found') {
    reconcileBillingAccountDeletionAfterCustomerCheck(
      connection,
      request.id,
      billingAccountDeletionReconciliationReasons.customerHasLiveSubscription
    )
    return false
  }
  return true
}
