import type Stripe from 'stripe'
import type { BillingOfferingKey } from '../../../../shared/billing'
import type { BillingStripeRuntimeConfiguration } from './configuration'
import { createStripeBillingCatalog, type StripeBillingCatalog } from './catalog'
import {
  projectStripeSubscription,
  reconciliationProjection,
  stripeId,
  type CurrentBillingProjection
} from './projection'
import {
  isTerminalStripeSubscription,
  resolveLiveStripeSubscription,
  retrieveExactStripeSubscription
} from './subscription-discovery'
import type { StripeWebhookEventReference, StripeWebhookEventType } from './webhook-reference'
import type { StripeBillingClient } from './stripe-client'

const webhookRequestOptions = {
  timeout: 5_000,
  maxNetworkRetries: 0
} as const

const terminalSubscriptionStatuses = new Set<Stripe.Subscription.Status>(['canceled', 'incomplete_expired'])
const refundStatuses = new Set(['pending', 'requires_action', 'succeeded', 'failed', 'canceled'])
const disputeStatuses = new Set([
  'warning_needs_response',
  'warning_under_review',
  'warning_closed',
  'needs_response',
  'under_review',
  'won',
  'lost',
  'prevented'
])

export type StripeWebhookProviderState =
  | Readonly<{
      kind: 'checkout'
      session: Stripe.Checkout.Session | null
      subscription: Stripe.Subscription | null
      schedule: Stripe.SubscriptionSchedule | null
      checkoutOffering: BillingOfferingKey | null
    }>
  | Readonly<{
      kind: 'subscription'
      subscription: Stripe.Subscription | null
      schedule: Stripe.SubscriptionSchedule | null
    }>
  | Readonly<{
      kind: 'schedule'
      subscription: Stripe.Subscription | null
      schedule: Stripe.SubscriptionSchedule | null
    }>
  | Readonly<{
      kind: 'invoice'
      invoice: Stripe.Invoice | null
      subscription: Stripe.Subscription | null
      schedule: Stripe.SubscriptionSchedule | null
    }>
  | Readonly<{
      kind: 'financial_risk'
      risk: 'refund' | 'dispute'
      providerObjectId: string
      chargeId: string | null
      paymentIntentId: string | null
      invoice: Stripe.Invoice | null
      subscription: Stripe.Subscription | null
      schedule: Stripe.SubscriptionSchedule | null
    }>

export type StripeWebhookCurrentObservation = Readonly<{
  catalog: StripeBillingCatalog
  attemptId: string | null
  stripeCustomerId: string | null
  stripeSessionId: string | null
  checkoutState: 'completed' | 'expired' | 'failed' | null
  projection: CurrentBillingProjection | null
  reconciliationReason: string | null
  providerState: StripeWebhookProviderState
}>

type StripeWebhookObservedState = Omit<StripeWebhookCurrentObservation, 'catalog'>

type ExactSubscriptionRead = Readonly<{
  projection: CurrentBillingProjection
  subscription: Stripe.Subscription | null
}>

export type ExactStripeSubscriptionState = Readonly<{
  projection: CurrentBillingProjection
  subscription: Stripe.Subscription | null
  schedule: Stripe.SubscriptionSchedule | null
}>

export async function readExactStripeSubscriptionState(
  client: StripeBillingClient,
  catalog: StripeBillingCatalog,
  customerId: string,
  expectedSubscriptionId: string,
  expectedScheduleId: string | null = null
): Promise<ExactStripeSubscriptionState> {
  const current = await readExactSubscription(client, catalog, customerId, expectedSubscriptionId)
  return {
    ...current,
    schedule: expectedScheduleId
      ? await retrieveExactSchedule(client, expectedScheduleId)
      : await retrieveAttachedSchedule(client, current.subscription)
  }
}

export async function observeStripeWebhookCurrentState(
  client: StripeBillingClient,
  config: BillingStripeRuntimeConfiguration,
  reference: StripeWebhookEventReference
): Promise<StripeWebhookCurrentObservation> {
  const catalog = createStripeBillingCatalog(config.stripe.prices)
  if (isCheckoutEvent(reference.eventType)) {
    return withCatalog(catalog, await observeCheckout(client, catalog, reference))
  }
  if (isSubscriptionEvent(reference.eventType)) {
    return withCatalog(catalog, await observeSubscription(client, catalog, reference))
  }
  if (isScheduleEvent(reference.eventType)) {
    return withCatalog(catalog, await observeSchedule(client, catalog, reference))
  }
  if (isInvoiceEvent(reference.eventType)) {
    return withCatalog(catalog, await observeInvoice(client, catalog, reference))
  }
  return withCatalog(catalog, await observeFinancialRisk(client, catalog, reference))
}

async function observeCheckout(
  client: StripeBillingClient,
  catalog: StripeBillingCatalog,
  reference: StripeWebhookEventReference
): Promise<StripeWebhookObservedState> {
  const session = await client.checkout.sessions.retrieve(
    reference.objectId,
    { expand: ['line_items'] },
    webhookRequestOptions
  )
  const sessionId = session?.object === 'checkout.session' && session.id === reference.objectId ? session.id : null
  const attemptId = exactCheckoutAttemptId(session)
  const customerId = stripeId(session.customer)
  const subscriptionId = stripeId(session.subscription)
  const checkoutOffering = checkoutOfferingFromSession(session, catalog)
  const expectedStatus = reference.eventType === 'checkout.session.expired' ? 'expired' : 'complete'
  const requiresPaidInitialInvoice =
    reference.eventType === 'checkout.session.completed' ||
    reference.eventType === 'checkout.session.async_payment_succeeded'
  const expectedPaymentStatus = requiresPaidInitialInvoice
    ? 'paid'
    : reference.eventType === 'checkout.session.async_payment_failed'
      ? 'unpaid'
      : null
  let reconciliationReason =
    sessionId &&
    session.mode === 'subscription' &&
    session.status === expectedStatus &&
    attemptId &&
    checkoutOffering &&
    (!expectedPaymentStatus || session.payment_status === expectedPaymentStatus)
      ? null
      : 'unexpected_checkout_shape'
  let projection: CurrentBillingProjection | null = null
  let subscription: Stripe.Subscription | null = null
  let schedule: Stripe.SubscriptionSchedule | null = null

  if (subscriptionId) {
    if (!customerId) {
      reconciliationReason ??= 'checkout_subscription_reference_mismatch'
    } else {
      const current = await readExactSubscription(client, catalog, customerId, subscriptionId)
      projection = current.projection
      subscription = current.subscription
      schedule = await retrieveAttachedSchedule(client, subscription)
      if (projection.reconciliationRequired) {
        reconciliationReason ??= projection.reconciliationReason
      }
    }
  }

  if (
    requiresPaidInitialInvoice &&
    subscription &&
    customerId &&
    !isExactPaidInitialInvoice(subscription, customerId)
  ) {
    reconciliationReason ??= 'checkout_initial_invoice_unverified'
  }
  if (
    reference.eventType === 'checkout.session.async_payment_failed' &&
    projection &&
    !terminalSubscriptionStatuses.has(projection.status as Stripe.Subscription.Status)
  ) {
    reconciliationReason ??= 'checkout_initial_payment_failed'
  }

  if (
    (reference.eventType === 'checkout.session.completed' ||
      reference.eventType === 'checkout.session.async_payment_succeeded') &&
    (!customerId || !subscriptionId)
  ) {
    reconciliationReason = 'checkout_completed_without_subscription'
    if (customerId && !projection) {
      projection = reconciliationProjection('checkout_completed_without_subscription')
    }
  }
  if (projection && reconciliationReason && !projection.reconciliationRequired) {
    projection = {
      ...projection,
      reconciliationRequired: true,
      reconciliationReason
    }
  }

  return {
    attemptId,
    stripeCustomerId: customerId,
    stripeSessionId: sessionId,
    checkoutState:
      reference.eventType === 'checkout.session.expired'
        ? 'expired'
        : reference.eventType === 'checkout.session.async_payment_failed'
          ? 'failed'
          : 'completed',
    projection,
    reconciliationReason,
    providerState: {
      kind: 'checkout',
      session: sessionId ? session : null,
      subscription,
      schedule,
      checkoutOffering
    }
  }
}

async function observeSubscription(
  client: StripeBillingClient,
  catalog: StripeBillingCatalog,
  reference: StripeWebhookEventReference
): Promise<StripeWebhookObservedState> {
  const retrieved = await client.subscriptions.retrieve(
    reference.objectId,
    { expand: ['latest_invoice', 'schedule'] },
    webhookRequestOptions
  )
  const customerId =
    retrieved?.object === 'subscription' && retrieved.id === reference.objectId ? stripeId(retrieved.customer) : null
  if (!customerId) {
    return ambiguousSubscriptionObservation(
      'subscription_reference_mismatch',
      metadataValue(retrieved?.metadata, 'billing_attempt_id')
    )
  }

  const current = await readExactSubscription(client, catalog, customerId, reference.objectId)
  const schedule = await retrieveAttachedSchedule(client, current.subscription)
  const attemptId = metadataValue(current.subscription?.metadata, 'billing_attempt_id')
  return {
    attemptId,
    stripeCustomerId: customerId,
    stripeSessionId: null,
    checkoutState: null,
    projection: current.projection,
    reconciliationReason: current.projection.reconciliationReason,
    providerState: {
      kind: 'subscription',
      subscription: current.subscription,
      schedule
    }
  }
}

async function observeSchedule(
  client: StripeBillingClient,
  catalog: StripeBillingCatalog,
  reference: StripeWebhookEventReference
): Promise<StripeWebhookObservedState> {
  const schedule = await client.subscriptionSchedules.retrieve(reference.objectId, {}, webhookRequestOptions)
  const validSchedule =
    schedule?.object === 'subscription_schedule' && schedule.id === reference.objectId ? schedule : null
  const customerId = validSchedule ? stripeId(validSchedule.customer) : null
  const subscriptionId = validSchedule
    ? (stripeId(validSchedule.subscription) ?? stripeId(validSchedule.released_subscription))
    : null
  if (!validSchedule || !customerId || !subscriptionId) {
    return {
      attemptId: null,
      stripeCustomerId: customerId,
      stripeSessionId: null,
      checkoutState: null,
      projection: reconciliationProjection('schedule_reference_mismatch'),
      reconciliationReason: 'schedule_reference_mismatch',
      providerState: { kind: 'schedule', subscription: null, schedule: validSchedule }
    }
  }

  const current = await readExactSubscription(client, catalog, customerId, subscriptionId)
  return {
    attemptId: metadataValue(current.subscription?.metadata, 'billing_attempt_id'),
    stripeCustomerId: customerId,
    stripeSessionId: null,
    checkoutState: null,
    projection: current.projection,
    reconciliationReason: current.projection.reconciliationReason,
    providerState: { kind: 'schedule', subscription: current.subscription, schedule: validSchedule }
  }
}

async function observeInvoice(
  client: StripeBillingClient,
  catalog: StripeBillingCatalog,
  reference: StripeWebhookEventReference
): Promise<StripeWebhookObservedState> {
  const invoice = await client.invoices.retrieve(reference.objectId, {}, webhookRequestOptions)
  const validInvoice = invoice?.object === 'invoice' && invoice.id === reference.objectId ? invoice : null
  return observationFromInvoice(client, catalog, validInvoice, {
    kind: 'invoice',
    invoice: validInvoice,
    subscription: null,
    schedule: null
  })
}

async function observeFinancialRisk(
  client: StripeBillingClient,
  catalog: StripeBillingCatalog,
  reference: StripeWebhookEventReference
): Promise<StripeWebhookObservedState> {
  const risk = reference.eventType === 'refund.created' ? 'refund' : 'dispute'
  const providerObject =
    risk === 'refund'
      ? await client.refunds.retrieve(reference.objectId, {}, webhookRequestOptions)
      : await client.disputes.retrieve(reference.objectId, {}, webhookRequestOptions)
  const objectValid =
    providerObject.id === reference.objectId &&
    ((risk === 'refund' &&
      providerObject.object === 'refund' &&
      providerObject.status !== null &&
      refundStatuses.has(providerObject.status)) ||
      (risk === 'dispute' && providerObject.object === 'dispute' && disputeStatuses.has(providerObject.status)))
  const chargeId = objectValid ? stripeId(providerObject.charge) : null
  const eventPaymentIntentId = objectValid ? stripeId(providerObject.payment_intent) : null
  if (!objectValid || !chargeId) {
    return financialRiskMismatch(reference, risk, chargeId, eventPaymentIntentId, 'financial_object_mismatch')
  }

  const charge = await client.charges.retrieve(chargeId, {}, webhookRequestOptions)
  const customerId = charge?.object === 'charge' && charge.id === chargeId ? stripeId(charge.customer) : null
  const paymentIntentId = charge?.object === 'charge' && charge.id === chargeId ? stripeId(charge.payment_intent) : null
  if (!customerId || !paymentIntentId || (eventPaymentIntentId && eventPaymentIntentId !== paymentIntentId)) {
    return financialRiskMismatch(reference, risk, chargeId, paymentIntentId, 'financial_charge_mismatch', customerId)
  }

  const payments = await client.invoicePayments.list(
    {
      payment: { payment_intent: paymentIntentId, type: 'payment_intent' },
      limit: 100
    },
    webhookRequestOptions
  )
  const payment = payments.has_more === false && payments.data.length === 1 ? payments.data[0]! : null
  const invoiceId =
    payment &&
    payment.object === 'invoice_payment' &&
    stripeId(payment.payment.payment_intent ?? null) === paymentIntentId
      ? stripeId(payment.invoice)
      : null
  if (!invoiceId) {
    return financialRiskMismatch(reference, risk, chargeId, paymentIntentId, 'financial_invoice_ambiguous', customerId)
  }

  const invoice = await client.invoices.retrieve(invoiceId, {}, webhookRequestOptions)
  const observation = await observationFromInvoice(
    client,
    catalog,
    invoice?.object === 'invoice' && invoice.id === invoiceId ? invoice : null,
    {
      kind: 'financial_risk',
      risk,
      providerObjectId: reference.objectId,
      chargeId,
      paymentIntentId,
      invoice: null,
      subscription: null,
      schedule: null
    }
  )
  return observation.stripeCustomerId === customerId
    ? observation
    : {
        ...observation,
        reconciliationReason: 'financial_customer_mismatch'
      }
}

async function observationFromInvoice(
  client: StripeBillingClient,
  catalog: StripeBillingCatalog,
  invoice: Stripe.Invoice | null,
  state:
    | Extract<StripeWebhookProviderState, { kind: 'invoice' }>
    | Extract<StripeWebhookProviderState, { kind: 'financial_risk' }>
): Promise<StripeWebhookObservedState> {
  const customerId = invoice ? stripeId(invoice.customer) : null
  const subscriptionId = invoiceSubscriptionId(invoice)
  if (!invoice || !customerId || !subscriptionId) {
    return {
      attemptId: null,
      stripeCustomerId: customerId,
      stripeSessionId: null,
      checkoutState: null,
      projection: null,
      reconciliationReason: invoice ? null : 'invoice_reference_mismatch',
      providerState: { ...state, invoice }
    }
  }

  const current = await readExactSubscription(client, catalog, customerId, subscriptionId)
  const schedule = await retrieveAttachedSchedule(client, current.subscription)
  return {
    attemptId: metadataValue(current.subscription?.metadata, 'billing_attempt_id'),
    stripeCustomerId: customerId,
    stripeSessionId: null,
    checkoutState: null,
    projection: current.projection,
    reconciliationReason: current.projection.reconciliationReason,
    providerState: {
      ...state,
      invoice,
      subscription: current.subscription,
      schedule
    }
  }
}

async function readExactSubscription(
  client: StripeBillingClient,
  catalog: StripeBillingCatalog,
  customerId: string,
  expectedSubscriptionId: string
): Promise<ExactSubscriptionRead> {
  const exact = await retrieveExactStripeSubscription(
    client,
    customerId,
    expectedSubscriptionId,
    ['latest_invoice', 'schedule'],
    webhookRequestOptions
  )
  if (exact.outcome === 'ambiguous') return ambiguousExactRead(exact.reason)

  const live = await resolveLiveStripeSubscription(client, customerId, webhookRequestOptions)
  if (live.outcome === 'ambiguous') return ambiguousExactRead(live.reason)
  if (isTerminalStripeSubscription(exact.subscription)) {
    if (live.outcome === 'found') return ambiguousExactRead('expected_subscription_mismatch')
  } else if (live.outcome !== 'found' || live.subscription.id !== expectedSubscriptionId) {
    return ambiguousExactRead('expected_subscription_mismatch')
  }

  return {
    subscription: exact.subscription,
    projection: projectStripeSubscription(exact.subscription, customerId, catalog)
  }
}

async function retrieveAttachedSchedule(
  client: StripeBillingClient,
  subscription: Stripe.Subscription | null
): Promise<Stripe.SubscriptionSchedule | null> {
  const scheduleId = stripeId(subscription?.schedule ?? null)
  if (!scheduleId) return null
  if (subscription?.schedule && typeof subscription.schedule !== 'string') return subscription.schedule
  const schedule = await client.subscriptionSchedules.retrieve(scheduleId, {}, webhookRequestOptions)
  return schedule?.object === 'subscription_schedule' && schedule.id === scheduleId ? schedule : null
}

async function retrieveExactSchedule(
  client: StripeBillingClient,
  scheduleId: string
): Promise<Stripe.SubscriptionSchedule | null> {
  const schedule = await client.subscriptionSchedules.retrieve(scheduleId, {}, webhookRequestOptions)
  return schedule?.object === 'subscription_schedule' && schedule.id === scheduleId ? schedule : null
}

function checkoutOfferingFromSession(
  session: Stripe.Checkout.Session,
  catalog: StripeBillingCatalog
): BillingOfferingKey | null {
  const items = session.line_items
  if (!items || items.has_more || items.data.length !== 1) return null
  const item = items.data[0]
  const priceId = item ? stripeId(item.price) : null
  if (!priceId || item?.quantity !== 1) return null
  return catalog.offeringForPriceId(priceId)
}

function exactCheckoutAttemptId(session: Stripe.Checkout.Session): string | null {
  const clientReferenceId = stringValue(session.client_reference_id)
  const metadataAttemptId = metadataValue(session.metadata, 'billing_attempt_id')
  return clientReferenceId && clientReferenceId === metadataAttemptId ? clientReferenceId : null
}

function invoiceSubscriptionId(invoice: Stripe.Invoice | null): string | null {
  return invoice?.parent?.type === 'subscription_details'
    ? stripeId(invoice.parent.subscription_details?.subscription ?? null)
    : null
}

function metadataValue(metadata: Stripe.Metadata | null | undefined, key: string): string | null {
  return stringValue(metadata?.[key])
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function ambiguousExactRead(reason: string): ExactSubscriptionRead {
  return {
    subscription: null,
    projection: reconciliationProjection(reason)
  }
}

function ambiguousSubscriptionObservation(reason: string, attemptId: string | null = null): StripeWebhookObservedState {
  return {
    attemptId,
    stripeCustomerId: null,
    stripeSessionId: null,
    checkoutState: null,
    projection: reconciliationProjection(reason),
    reconciliationReason: reason,
    providerState: { kind: 'subscription', subscription: null, schedule: null }
  }
}

function financialRiskMismatch(
  reference: StripeWebhookEventReference,
  risk: 'refund' | 'dispute',
  chargeId: string | null,
  paymentIntentId: string | null,
  reason: string,
  customerId: string | null = null
): StripeWebhookObservedState {
  return {
    attemptId: null,
    stripeCustomerId: customerId,
    stripeSessionId: null,
    checkoutState: null,
    projection: customerId ? reconciliationProjection(reason) : null,
    reconciliationReason: reason,
    providerState: {
      kind: 'financial_risk',
      risk,
      providerObjectId: reference.objectId,
      chargeId,
      paymentIntentId,
      invoice: null,
      subscription: null,
      schedule: null
    }
  }
}

function isCheckoutEvent(type: StripeWebhookEventType): boolean {
  return type.startsWith('checkout.session.')
}

function isSubscriptionEvent(type: StripeWebhookEventType): boolean {
  return type.startsWith('customer.subscription.')
}

function isScheduleEvent(type: StripeWebhookEventType): boolean {
  return type.startsWith('subscription_schedule.')
}

function isInvoiceEvent(type: StripeWebhookEventType): boolean {
  return type.startsWith('invoice.')
}

function withCatalog(
  catalog: StripeBillingCatalog,
  observation: StripeWebhookObservedState
): StripeWebhookCurrentObservation {
  return { catalog, ...observation }
}

export function isExactPaidInitialInvoice(subscription: Stripe.Subscription, expectedCustomerId: string): boolean {
  const invoice = expandedInvoice(subscription.latest_invoice)
  return Boolean(
    invoice &&
    stripeId(invoice.customer) === expectedCustomerId &&
    invoiceSubscriptionId(invoice) === subscription.id &&
    invoice.billing_reason === 'subscription_create' &&
    invoice.collection_method === 'charge_automatically' &&
    invoice.status === 'paid' &&
    invoice.amount_remaining === 0
  )
}

function expandedInvoice(value: Stripe.Subscription['latest_invoice']): Stripe.Invoice | null {
  return value && typeof value !== 'string' && value.object === 'invoice' ? value : null
}
