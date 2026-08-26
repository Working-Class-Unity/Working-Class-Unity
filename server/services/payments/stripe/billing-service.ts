import type Stripe from 'stripe'
import { createStripeBillingCatalog } from './catalog'
import { ensureBillingCheckout, reconcileBillingCheckoutAttempt } from './checkout'
import type { BillingStripeRuntimeConfiguration } from './configuration'
import { conflictError, forbiddenError, upstreamServiceError } from '../../../utils/errors'
import { readCurrentStripeProjection } from './projection'
import {
  authorizePurchaserBilling,
  type BillingStripeConnection,
  type BillingStripeIntegration
} from './public-contract'
import { readBaseBillingStripePurchaserState, readBillingStripePurchaserState } from './purchaser-state'
import {
  billingProjectionRevision,
  getBillingCustomerForPurchaser,
  getBillingSubscriptionForPurchaser,
  getOpenBillingTransition,
  getOpenCheckoutAttempt,
  isBillingDeletionPending,
  updateCheckoutAttempt
} from './repository'
import type { BillingCheckoutAttempt } from '../../../db/schema/billing'
import { commitBillingProjectionInTransaction } from './state-store'
import { isBillingOfferingKey, type BillingOfferingKey } from '../../../../shared/billing'
import type { StripeBillingClient } from './stripe-client'
import { executeBillingTransition } from './transition'
import { hasCurrentImportedStripeDuesSubscription } from '../../membership/imported-stripe-billing'
import { hasOpenWebsiteAccountIdentityReview } from '../../membership/account-identity'

export type BillingStripeServiceContext = Readonly<{
  connection: BillingStripeConnection
  client: StripeBillingClient
  config: BillingStripeRuntimeConfiguration
  integration?: BillingStripeIntegration<BillingStripeConnection, unknown>
}>

export function getBillingStripeState(
  connection: BillingStripeConnection,
  purchaserUserId: string,
  integration?: BillingStripeIntegration<BillingStripeConnection, unknown>,
  now = new Date()
) {
  return readBillingStripePurchaserState(connection, purchaserUserId, integration, now)
}

export async function createBillingStripeCheckout(
  context: BillingStripeServiceContext,
  purchaserUserId: string,
  offering: BillingOfferingKey,
  now = new Date()
) {
  if (!isBillingOfferingKey(offering)) throw forbiddenError('Unsupported billing offering')
  const assertCheckoutAllowed = (connection: BillingStripeConnection, userId: string) =>
    assertMembershipCheckoutAllowed(connection, userId, context.config)
  assertCheckoutAllowed(context.connection, purchaserUserId)
  const state = readBaseBillingStripePurchaserState(context.connection, purchaserUserId, now)
  const open = getOpenCheckoutAttempt(context.connection, purchaserUserId)
  const retry =
    open && `${open.planKey}.${open.cadence}` === offering && (open.state === 'pending' || open.state === 'open')
  if (!state.capabilities.canCheckout && !retry) {
    throw conflictError('The current billing account must be managed or reconciled')
  }
  return ensureBillingCheckout(
    { ...context, assertCheckoutAllowed },
    purchaserUserId,
    getBillingCustomerForPurchaser(context.connection, purchaserUserId),
    offering,
    now
  )
}

function assertMembershipCheckoutAllowed(
  connection: BillingStripeConnection,
  purchaserUserId: string,
  config: BillingStripeRuntimeConfiguration
): void {
  if (hasOpenWebsiteAccountIdentityReview(connection, purchaserUserId)) {
    throw conflictError('Account identity must be reviewed before starting another subscription')
  }
  if (
    hasCurrentImportedStripeDuesSubscription(connection, purchaserUserId, {
      'personal.monthly': config.stripe.prices['personal.monthly'],
      'family.monthly': config.stripe.prices['family.monthly']
    })
  ) {
    throw conflictError('An existing Stripe membership must be reconciled before starting another subscription')
  }
}

export async function changeBillingStripeOffering(
  context: BillingStripeServiceContext,
  purchaserUserId: string,
  offering: BillingOfferingKey,
  now = new Date()
) {
  if (!isBillingOfferingKey(offering)) throw forbiddenError('Unsupported billing offering')
  await executeBillingTransition(context, purchaserUserId, offering, now)
  return readBillingStripePurchaserState(context.connection, purchaserUserId, context.integration, now)
}

export async function createBillingStripePortal(
  context: BillingStripeServiceContext,
  purchaserUserId: string
): Promise<Readonly<{ url: string }>> {
  const captured = context.connection.sqlite
    .transaction(() => {
      if (isBillingDeletionPending(context.connection, purchaserUserId)) {
        throw conflictError('Billing is locked while account deletion is pending')
      }
      const customer = getBillingCustomerForPurchaser(context.connection, purchaserUserId)
      const subscription = getBillingSubscriptionForPurchaser(context.connection, purchaserUserId)
      if (!customer || !subscription) throw conflictError('No manageable billing account exists')
      requireAuthorization(
        authorizePurchaserBilling(context.connection, context.integration, {
          kind: 'portal',
          purchaserUserId
        }),
        'portal'
      )
      return customer
    })
    .immediate()

  let portal: Stripe.BillingPortal.Session
  try {
    portal = await context.client.billingPortal.sessions.create({
      customer: captured.stripeCustomerId,
      configuration: context.config.stripe.portalConfigurationId,
      return_url: `${trimSlash(context.config.appUrl)}/account`
    })
  } catch {
    throw upstreamServiceError(502, 'Stripe billing management is temporarily unavailable')
  }
  if (!isHttpsUrl(portal.url)) throw upstreamServiceError(502, 'Stripe returned an unusable billing portal')

  context.connection.sqlite
    .transaction(() => {
      const live = getBillingCustomerForPurchaser(context.connection, purchaserUserId)
      if (
        isBillingDeletionPending(context.connection, purchaserUserId) ||
        !live ||
        live.id !== captured.id ||
        live.stripeCustomerId !== captured.stripeCustomerId
      )
        throw forbiddenError('Billing authority changed during Portal creation')
      requireAuthorization(
        authorizePurchaserBilling(context.connection, context.integration, {
          kind: 'portal',
          purchaserUserId
        }),
        'portal'
      )
    })
    .immediate()
  return Object.freeze({ url: portal.url })
}

export async function reconcileBillingStripe(
  context: BillingStripeServiceContext,
  purchaserUserId: string,
  now = new Date()
) {
  let captured = captureReconciliation(context, purchaserUserId)
  if (captured.attempt) {
    const result = await reconcileBillingCheckoutAttempt(context, purchaserUserId, captured.attempt, now)
    if (result.blocked) throw conflictError('Checkout state still requires reconciliation')
    captured = captureReconciliation(context, purchaserUserId)
  }
  if (!captured.customer) {
    return readBillingStripePurchaserState(context.connection, purchaserUserId, context.integration, now)
  }
  let projection
  try {
    projection = await readCurrentStripeProjection(
      context.client,
      captured.customer.stripeCustomerId,
      createStripeBillingCatalog(context.config.stripe.prices),
      undefined,
      captured.expectedStripeSubscriptionId
    )
  } catch {
    throw upstreamServiceError(502, 'Stripe billing state is temporarily unavailable')
  }
  const applied = context.connection.sqlite
    .transaction(() => {
      const liveCustomer = getBillingCustomerForPurchaser(context.connection, purchaserUserId)
      const liveAttempt = getOpenCheckoutAttempt(context.connection, purchaserUserId)
      const overlappingCheckout = Boolean(
        liveAttempt &&
        captured.attempt &&
        projection.status !== 'none' &&
        sameCheckoutAttemptSnapshot(liveAttempt, captured.attempt)
      )
      if (
        !liveCustomer ||
        liveCustomer.id !== captured.customer?.id ||
        liveCustomer.stripeCustomerId !== captured.customer.stripeCustomerId ||
        billingProjectionRevision(context.connection, purchaserUserId) !== captured.expectedRevision ||
        isBillingDeletionPending(context.connection, purchaserUserId) ||
        (liveAttempt && !overlappingCheckout) ||
        getOpenBillingTransition(context.connection, purchaserUserId)
      )
        return false
      requireAuthorization(
        authorizePurchaserBilling(context.connection, context.integration, {
          kind: 'reconcile',
          purchaserUserId
        }),
        'reconcile'
      )
      if (
        overlappingCheckout &&
        (!liveAttempt ||
          !updateCheckoutAttempt(context.connection, liveAttempt.id, {
            state: 'reconciliation_required',
            updatedAt: now.toISOString()
          }))
      )
        return false
      return (
        commitBillingProjectionInTransaction(context.connection, context.integration, {
          purchaserUserId,
          stripeCustomerId: liveCustomer.stripeCustomerId,
          expectedRevision: captured.expectedRevision,
          projection:
            overlappingCheckout && !projection.reconciliationRequired
              ? {
                  ...projection,
                  reconciliationRequired: true,
                  reconciliationReason: 'overlapping_checkout_attempt'
                }
              : projection,
          cause: 'manual_reconciliation',
          verifiedAt: now
        }).outcome === 'applied'
      )
    })
    .immediate()
  if (!applied) throw conflictError('Billing state changed; retry reconciliation')
  return readBillingStripePurchaserState(context.connection, purchaserUserId, context.integration, now)
}

function captureReconciliation(context: BillingStripeServiceContext, purchaserUserId: string) {
  return context.connection.sqlite
    .transaction(() => {
      if (isBillingDeletionPending(context.connection, purchaserUserId)) {
        throw conflictError('Billing is locked while account deletion is pending')
      }
      if (getOpenBillingTransition(context.connection, purchaserUserId)) {
        throw conflictError('Billing transition state must be resolved before reconciliation')
      }
      requireAuthorization(
        authorizePurchaserBilling(context.connection, context.integration, {
          kind: 'reconcile',
          purchaserUserId
        }),
        'reconcile'
      )
      const subscription = context.connection.sqlite
        .prepare(
          'select stripe_subscription_id as stripeSubscriptionId from billing_subscriptions where purchaser_user_id = ?'
        )
        .get(purchaserUserId) as { stripeSubscriptionId: string | null } | undefined
      return Object.freeze({
        customer: getBillingCustomerForPurchaser(context.connection, purchaserUserId),
        attempt: getOpenCheckoutAttempt(context.connection, purchaserUserId),
        expectedRevision: billingProjectionRevision(context.connection, purchaserUserId),
        expectedStripeSubscriptionId: subscription?.stripeSubscriptionId ?? null
      })
    })
    .immediate()
}

function requireAuthorization(
  result: ReturnType<typeof authorizePurchaserBilling>,
  operation: 'portal' | 'reconcile'
): void {
  if (result === 'authorized') return
  if (result === 'authority_lost') throw forbiddenError(`Billing authority changed during ${operation}`)
  throw conflictError(`Billing state must be reconciled before ${operation}`)
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function sameCheckoutAttemptSnapshot(left: BillingCheckoutAttempt, right: BillingCheckoutAttempt): boolean {
  return (
    left.id === right.id &&
    left.purchaserUserId === right.purchaserUserId &&
    left.billingCustomerId === right.billingCustomerId &&
    left.planKey === right.planKey &&
    left.cadence === right.cadence &&
    left.stripePriceId === right.stripePriceId &&
    left.stripeSessionId === right.stripeSessionId &&
    left.idempotencyKey === right.idempotencyKey &&
    left.state === right.state &&
    left.successUrl === right.successUrl &&
    left.cancelUrl === right.cancelUrl &&
    left.reuseUntil === right.reuseUntil &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt
  )
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
