import { evaluateStripeSubscriptionAccess } from './dunning'
import type { BillingStripeConnection, BillingStripeIntegration } from './public-contract'
import {
  getBillingAccountDeletionRequest,
  getBillingCustomerForPurchaser,
  getBillingSubscriptionForPurchaser,
  getOpenBillingTransition,
  getOpenCheckoutAttempt
} from './repository'
import {
  billingOfferingDefinitions,
  getBillingOffering,
  isBillingOfferingKey,
  type BillingStripePurchaserState,
  type BillingTransitionState
} from '../../../../shared/billing'

export function readBaseBillingStripePurchaserState(
  connection: BillingStripeConnection,
  purchaserUserId: string,
  now = new Date()
): BillingStripePurchaserState {
  return connection.sqlite.transaction(() =>
    readBaseBillingStripePurchaserStateInTransaction(connection, purchaserUserId, now)
  )()
}

function readBaseBillingStripePurchaserStateInTransaction(
  connection: BillingStripeConnection,
  purchaserUserId: string,
  now: Date
): BillingStripePurchaserState {
  const customer = getBillingCustomerForPurchaser(connection, purchaserUserId)
  const subscription = getBillingSubscriptionForPurchaser(connection, purchaserUserId)
  const attempt = getOpenCheckoutAttempt(connection, purchaserUserId)
  const openTransition = getOpenBillingTransition(connection, purchaserUserId)
  const deletionPending = getBillingAccountDeletionRequest(connection, purchaserUserId) !== null
  const offeringKey =
    subscription?.planKey && subscription.cadence ? `${subscription.planKey}.${subscription.cadence}` : null
  const offering = offeringKey && isBillingOfferingKey(offeringKey) ? getBillingOffering(offeringKey) : null
  const periodStart = Date.parse(subscription?.currentPeriodStart ?? '')
  const periodEnd = Date.parse(subscription?.currentPeriodEnd ?? '')
  const malformed = Boolean(
    (subscription &&
      subscription.status !== 'none' &&
      (!customer ||
        customer.id !== subscription.billingCustomerId ||
        !offering ||
        !subscription.stripeSubscriptionId ||
        !subscription.stripeSubscriptionItemId ||
        !subscription.stripePriceId ||
        !Number.isFinite(periodStart) ||
        !Number.isFinite(periodEnd) ||
        periodEnd <= periodStart)) ||
    (openTransition && !isBillingOfferingKey(`${openTransition.targetPlanKey}.${openTransition.targetCadence}`))
  )
  const customerOnly = Boolean(customer && !subscription)
  const providerAccess = subscription
    ? evaluateStripeSubscriptionAccess(subscription, now)
    : { state: 'none' as const, granted: false, graceDeadline: null, reconciliationReason: null }
  const access =
    malformed ||
    customerOnly ||
    attempt?.state === 'reconciliation_required' ||
    openTransition?.state === 'reconciliation_required'
      ? { state: 'reconciliation_required' as const, granted: false, graceDeadline: null }
      : providerAccess
  const checkoutPending = attempt?.state === 'pending' || attempt?.state === 'open'
  const transitionTarget = openTransition ? `${openTransition.targetPlanKey}.${openTransition.targetCadence}` : null
  const transitionState = openTransition && isBillingTransitionState(openTransition.state) ? openTransition.state : null

  return Object.freeze({
    catalog: billingOfferingDefinitions,
    deletionPending,
    subscription: Object.freeze({
      provider: 'Stripe' as const,
      state: access.state,
      offering: offering?.key ?? null,
      plan: offering?.plan ?? null,
      cadence: offering?.cadence ?? null,
      currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      renewalEnabled: Boolean(subscription && access.granted && !subscription.cancelAtPeriodEnd),
      graceDeadline: access.graceDeadline,
      checkoutPending
    }),
    transition:
      openTransition && transitionTarget && transitionState && isBillingOfferingKey(transitionTarget)
        ? Object.freeze({
            kind: openTransition.kind,
            targetOffering: transitionTarget,
            effectiveAt: openTransition.effectiveAt,
            state: transitionState
          })
        : null,
    capabilities: Object.freeze({
      canCheckout:
        !deletionPending && !attempt && !openTransition && (access.state === 'none' || access.state === 'terminal'),
      canChange:
        !deletionPending &&
        !attempt &&
        !openTransition &&
        access.state === 'active' &&
        Boolean(offering) &&
        !subscription?.cancelAtPeriodEnd,
      canManage: !deletionPending && Boolean(customer) && access.state !== 'reconciliation_required',
      canReconcile: !deletionPending && Boolean(customer || attempt)
    })
  })
}

function isBillingTransitionState(value: string): value is BillingTransitionState {
  return ['pending', 'action_required', 'scheduled', 'reconciliation_required'].includes(value)
}

export function readBillingStripePurchaserState<TProjectedState = BillingStripePurchaserState>(
  connection: BillingStripeConnection,
  purchaserUserId: string,
  integration?: BillingStripeIntegration<BillingStripeConnection, TProjectedState>,
  now = new Date()
): TProjectedState | BillingStripePurchaserState {
  return connection.sqlite.transaction(() => {
    const base = readBaseBillingStripePurchaserStateInTransaction(connection, purchaserUserId, now)
    if (!integration?.projectPurchaserState) return base
    const projected = integration.projectPurchaserState(connection, purchaserUserId, base)
    if (
      projected !== null &&
      (typeof projected === 'object' || typeof projected === 'function') &&
      'then' in projected &&
      typeof projected.then === 'function'
    ) {
      throw new TypeError('Billing Stripe purchaser-state projection must complete synchronously')
    }
    return projected
  })()
}
