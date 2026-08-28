import { randomUUID } from 'node:crypto'
import { isBillingOfferingKey, isMembershipDuesOfferingKey } from '../../../../shared/billing'
import { reserveBillingEmailVerificationInTransaction } from './billing-email-verification'
import { enqueueBillingDetachedSubscriptionCancellation } from './detached-subscription-cancellation'
import { currentProjectionFingerprint } from './projection'
import type {
  BillingStripeConnection,
  BillingStripeIntegration,
  BillingStripeStateCommitCause
} from './public-contract'
import {
  getBillingCustomerByStripeId,
  getBillingCustomerForPurchaser,
  getBillingSubscriptionForPurchaser,
  getBillingTransitionById,
  getCheckoutAttemptById,
  getOpenBillingTransition,
  getOpenCheckoutAttempt,
  isBillingDeletionPending,
  updateCheckoutAttempt
} from './repository'
import { commitBillingProjectionInTransaction, type BillingProjectionCommit } from './state-store'
import { normalizedTransitionSnapshot } from './transition-store'
import type { StripeEventObservation } from './webhook'
import {
  missingAuthenticatedFailureInvoiceReason,
  isExactManagedSubscription,
  resolveBillingStripeWebhookLifecycle,
  type BillingStripeGraceMutation,
  type BillingStripeTransitionMutation,
  type BillingStripeWebhookLifecycle
} from './webhook-lifecycle'
import { isExactPaidInitialInvoice } from './webhook-state'
import { applyPublicJoinObservationInTransaction } from '../../membership/public-join-observation'

export type StripeEventApplyResult = Readonly<{
  duplicate: boolean
  target: 'live' | 'detached' | 'ignored'
}>

const authorityLostObservation = Symbol('billing-stripe-webhook-authority-lost')

export function applyStripeEventObservation(
  connection: BillingStripeConnection,
  integration: BillingStripeIntegration<BillingStripeConnection, unknown> | undefined,
  observation: StripeEventObservation,
  now = new Date()
): StripeEventApplyResult {
  try {
    return connection.sqlite
      .transaction(() => {
        if (hasReceipt(connection, observation.eventId)) {
          return { duplicate: true, target: 'ignored' as const }
        }
        const target = applyObservationInTransaction(connection, integration, observation, now)
        insertReceipt(connection, observation, now)
        return { duplicate: false, target }
      })
      .immediate()
  } catch (error) {
    if (error !== authorityLostObservation) throw error
    return connection.sqlite
      .transaction(() => {
        if (hasReceipt(connection, observation.eventId)) {
          return { duplicate: true, target: 'ignored' as const }
        }
        const detached = detachObservation(connection, observation, 'integration_authority_lost', now)
        insertReceipt(connection, observation, now)
        return { duplicate: false, target: detached ? ('detached' as const) : ('ignored' as const) }
      })
      .immediate()
  }
}

export function applyBillingStripeTransitionConvergence(
  connection: BillingStripeConnection,
  integration: BillingStripeIntegration<BillingStripeConnection, unknown> | undefined,
  input: Readonly<{
    purchaserUserId: string
    transitionId: string
    expectedTransitionRevision: number
    expectedBillingRevision: number
    observation: StripeEventObservation
    now: Date
  }>
): boolean {
  try {
    return connection.sqlite
      .transaction(() => {
        const customer = getBillingCustomerForPurchaser(connection, input.purchaserUserId)
        const live = getBillingSubscriptionForPurchaser(connection, input.purchaserUserId)
        const transition = getBillingTransitionById(connection, input.transitionId)
        if (
          isBillingDeletionPending(connection, input.purchaserUserId) ||
          getOpenCheckoutAttempt(connection, input.purchaserUserId) ||
          !customer ||
          customer.stripeCustomerId !== input.observation.stripeCustomerId ||
          !live ||
          live.revision !== input.expectedBillingRevision ||
          !transition ||
          transition.purchaserUserId !== input.purchaserUserId ||
          transition.revision !== input.expectedTransitionRevision ||
          !['pending', 'action_required', 'scheduled', 'reconciliation_required'].includes(transition.state) ||
          !input.observation.projection
        )
          return false

        const lifecycle = resolveBillingStripeWebhookLifecycle(connection, input.purchaserUserId, input.observation)
        const committedTransition =
          applyTransitionMutation(connection, lifecycle.transition, input.now) ??
          normalizedTransitionForId(connection, input.transitionId)
        commitProjectionOrThrow(connection, integration, {
          purchaserUserId: input.purchaserUserId,
          stripeCustomerId: customer.stripeCustomerId,
          live,
          projection: projectionWithGrace(lifecycle.projection, live, lifecycle.grace),
          now: input.now,
          orderMs: live.projectionOrderMs,
          eventId: live.projectionEventId,
          transition: committedTransition,
          effects: lifecycle.effects,
          cause: 'transition_convergence'
        })
        return true
      })
      .immediate()
  } catch (error) {
    if (error === authorityLostObservation) return false
    throw error
  }
}

function applyObservationInTransaction(
  connection: BillingStripeConnection,
  integration: BillingStripeIntegration<BillingStripeConnection, unknown> | undefined,
  observation: StripeEventObservation,
  now: Date
): StripeEventApplyResult['target'] {
  if (applyPublicJoinObservationInTransaction(connection, observation, now)) return 'live'

  const attempt = observation.attemptId ? getCheckoutAttemptById(connection, observation.attemptId) : null
  const customerByProvider = observation.stripeCustomerId
    ? getBillingCustomerByStripeId(connection, observation.stripeCustomerId)
    : null
  const purchaserIds = new Set<string>()
  if (attempt) purchaserIds.add(attempt.purchaserUserId)
  if (customerByProvider) purchaserIds.add(customerByProvider.purchaserUserId)

  if (purchaserIds.size > 1) {
    if (attempt) updateCheckoutAttempt(connection, attempt.id, { state: 'reconciliation_required' })
    return detachObservation(connection, observation, 'reference_conflict', now)
      ? 'detached'
      : attempt
        ? 'live'
        : 'ignored'
  }
  let purchaserUserId = purchaserIds.values().next().value as string | undefined

  if (attempt) {
    const checkoutOutcome = applyCheckoutObservation(connection, attempt, observation, now)
    if (checkoutOutcome === 'conflict') {
      return detachObservation(connection, observation, 'checkout_conflict', now) ? 'detached' : 'live'
    }
    purchaserUserId = attempt.purchaserUserId
  }

  if (!purchaserUserId && observation.projection?.stripeSubscriptionId) {
    const row = connection.sqlite
      .prepare(
        `select purchaser_user_id as purchaserUserId from billing_subscriptions
         where stripe_subscription_id = ?`
      )
      .get(observation.projection.stripeSubscriptionId) as { purchaserUserId: string } | undefined
    purchaserUserId = row?.purchaserUserId
  }

  if (!purchaserUserId) {
    return detachObservation(connection, observation, observation.reconciliationReason ?? 'unattributed_event', now)
      ? 'detached'
      : 'ignored'
  }

  const customer = getBillingCustomerForPurchaser(connection, purchaserUserId)
  if (!observation.projection) {
    const live = getBillingSubscriptionForPurchaser(connection, purchaserUserId)
    if (observation.reconciliationReason && customer && live) {
      const openTransition = getOpenBillingTransition(connection, purchaserUserId)
      const transition = openTransition
        ? applyTransitionMutation(
            connection,
            {
              transition: openTransition,
              state: 'reconciliation_required',
              reason: observation.reconciliationReason
            },
            now
          )
        : null
      commitProjectionOrThrow(connection, integration, {
        purchaserUserId,
        stripeCustomerId: customer.stripeCustomerId,
        live,
        projection: {
          ...persistedProjection(live),
          reconciliationRequired: true,
          reconciliationReason: observation.reconciliationReason
        },
        now,
        orderMs: live.projectionOrderMs,
        eventId: live.projectionEventId,
        transition,
        effects: []
      })
    }
    return 'live'
  }
  if (!customer || !observation.stripeCustomerId || customer.stripeCustomerId !== observation.stripeCustomerId) {
    return detachObservation(connection, observation, 'customer_mismatch', now) ? 'detached' : 'ignored'
  }

  const live = getBillingSubscriptionForPurchaser(connection, purchaserUserId)
  const eventOrderMs = observation.eventCreatedAt * 1_000
  let lifecycle = resolveBillingStripeWebhookLifecycle(connection, purchaserUserId, observation)
  const competingAttempt = getOpenCheckoutAttempt(connection, purchaserUserId)
  if (lifecycle.projection.status !== 'none' && competingAttempt && competingAttempt.id !== attempt?.id) {
    updateCheckoutAttempt(connection, competingAttempt.id, {
      state: 'reconciliation_required',
      updatedAt: now.toISOString()
    })
    lifecycle = {
      projection: {
        ...lifecycle.projection,
        reconciliationRequired: true,
        reconciliationReason: 'overlapping_checkout_attempt'
      },
      grace: { kind: 'preserve' },
      transition: lifecycle.transition
        ? {
            transition: lifecycle.transition.transition,
            state: 'reconciliation_required',
            reason: 'overlapping_checkout_attempt'
          }
        : null,
      effects: []
    }
  }
  let orderMs = eventOrderMs
  let projectionEventId: string | null = observation.eventId

  if (live && eventOrderMs < live.projectionOrderMs) {
    const observedMatches = currentProjectionFingerprint(lifecycle.projection) === persistedFingerprint(live)
    const resolvesAuthenticatedFailure =
      lifecycle.grace.kind === 'set' &&
      live.reconciliationRequired &&
      live.reconciliationReason === missingAuthenticatedFailureInvoiceReason &&
      currentProjectionFingerprint({
        ...lifecycle.projection,
        reconciliationRequired: true,
        reconciliationReason: missingAuthenticatedFailureInvoiceReason
      }) === persistedFingerprint(live)
    if (!observedMatches && !resolvesAuthenticatedFailure) {
      lifecycle = orderConflictLifecycle(live, lifecycle.transition, 'older_event_current_state_conflict')
    }
    orderMs = live.projectionOrderMs
    projectionEventId = live.projectionEventId
  } else if (live && eventOrderMs === live.projectionOrderMs) {
    if (currentProjectionFingerprint(lifecycle.projection) !== persistedFingerprint(live)) {
      lifecycle = orderConflictLifecycle(live, lifecycle.transition, 'equal_event_order_conflict')
    }
    // Equal-time observations corroborate the first committed authority. Preserve its
    // event identity so webhook delivery order cannot rewrite the canonical tie-breaker.
    orderMs = live.projectionOrderMs
    projectionEventId = live.projectionEventId
  }

  const governingTransition = lifecycle.transition?.transition ?? getOpenBillingTransition(connection, purchaserUserId)
  const transition =
    applyTransitionMutation(connection, lifecycle.transition, now) ??
    (governingTransition ? normalizedTransitionForId(connection, governingTransition.id) : null)
  const projection = projectionWithGrace(lifecycle.projection, live, lifecycle.grace)
  commitProjectionOrThrow(connection, integration, {
    purchaserUserId,
    stripeCustomerId: customer.stripeCustomerId,
    live,
    projection,
    now,
    orderMs,
    eventId: projectionEventId,
    transition,
    effects: lifecycle.effects
  })

  if (attempt) {
    if (projection.reconciliationRequired) {
      if (!competingAttempt || competingAttempt.id === attempt.id) {
        updateCheckoutAttempt(connection, attempt.id, {
          state: 'reconciliation_required',
          updatedAt: now.toISOString()
        })
      }
    } else if (
      projection.status !== 'none' &&
      (attempt.planKey !== projection.planKey ||
        attempt.cadence !== projection.cadence ||
        attempt.stripePriceId !== projection.stripePriceId)
    ) {
      updateCheckoutAttempt(connection, attempt.id, { state: 'reconciliation_required', updatedAt: now.toISOString() })
    } else if (projection.status !== 'none' && observation.checkoutState !== 'failed') {
      updateCheckoutAttempt(connection, attempt.id, { state: 'completed', updatedAt: now.toISOString() })
    }
    reserveAcceptedCheckoutBillingEmail(connection, attempt, observation, projection, now)
  }
  return 'live'
}

function reserveAcceptedCheckoutBillingEmail(
  connection: BillingStripeConnection,
  attempt: NonNullable<ReturnType<typeof getCheckoutAttemptById>>,
  observation: StripeEventObservation,
  projection: BillingProjectionCommit,
  now: Date
): void {
  if (
    observation.providerState.kind !== 'checkout' ||
    !['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(observation.eventType) ||
    observation.checkoutState !== 'completed' ||
    observation.reconciliationReason ||
    projection.status !== 'active' ||
    projection.reconciliationRequired
  )
    return

  const offering = `${attempt.planKey}.${attempt.cadence}`
  const session = observation.providerState.session
  const subscription = observation.providerState.subscription
  const email = session?.customer_details?.email
  if (
    !session ||
    session.id !== observation.stripeSessionId ||
    !subscription ||
    !observation.stripeCustomerId ||
    !isMembershipDuesOfferingKey(offering) ||
    observation.providerState.checkoutOffering !== offering ||
    !isExactPaidInitialInvoice(subscription, observation.stripeCustomerId) ||
    typeof email !== 'string'
  )
    return

  reserveBillingEmailVerificationInTransaction(
    connection,
    {
      billingCheckoutAttemptId: attempt.id,
      email,
      purchaserUserId: attempt.purchaserUserId,
      stripeSessionId: session.id
    },
    now
  )
}

function applyCheckoutObservation(
  connection: BillingStripeConnection,
  attempt: NonNullable<ReturnType<typeof getCheckoutAttemptById>>,
  observation: StripeEventObservation,
  now: Date
): 'applied' | 'conflict' {
  const offering = `${attempt.planKey}.${attempt.cadence}`
  if (observation.providerState.kind !== 'checkout') {
    const subscription = 'subscription' in observation.providerState ? observation.providerState.subscription : null
    const stripeCustomerId = observation.stripeCustomerId
    if (
      !subscription ||
      !stripeCustomerId ||
      observation.attemptId !== attempt.id ||
      subscription.metadata?.billing_attempt_id !== attempt.id ||
      observation.projection?.stripeSubscriptionId !== subscription.id ||
      stripeCustomerId !== stripeReference(subscription.customer)
    ) {
      updateCheckoutAttempt(connection, attempt.id, { state: 'reconciliation_required' })
      return 'conflict'
    }
    const billingCustomerId = associateObservedCustomer(
      connection,
      attempt.purchaserUserId,
      attempt.billingCustomerId,
      stripeCustomerId,
      now
    )
    if (!billingCustomerId) {
      updateCheckoutAttempt(connection, attempt.id, { state: 'reconciliation_required' })
      return 'conflict'
    }
    updateCheckoutAttempt(connection, attempt.id, { billingCustomerId, updatedAt: now.toISOString() })
    return 'applied'
  }
  const session = observation.providerState.session
  if (
    !session ||
    observation.attemptId !== attempt.id ||
    !observation.stripeSessionId ||
    !isBillingOfferingKey(offering) ||
    observation.providerState.checkoutOffering !== offering ||
    (attempt.stripeSessionId && attempt.stripeSessionId !== observation.stripeSessionId)
  ) {
    updateCheckoutAttempt(connection, attempt.id, { state: 'reconciliation_required' })
    return 'conflict'
  }

  let billingCustomerId = attempt.billingCustomerId
  if (observation.stripeCustomerId) {
    billingCustomerId = associateObservedCustomer(
      connection,
      attempt.purchaserUserId,
      attempt.billingCustomerId,
      observation.stripeCustomerId,
      now
    )
    if (!billingCustomerId) {
      updateCheckoutAttempt(connection, attempt.id, {
        state: 'reconciliation_required',
        updatedAt: now.toISOString()
      })
      return 'conflict'
    }
  }
  updateCheckoutAttempt(connection, attempt.id, {
    billingCustomerId,
    stripeSessionId: observation.stripeSessionId,
    state: observation.reconciliationReason
      ? 'reconciliation_required'
      : observation.checkoutState === 'completed'
        ? 'completed'
        : observation.checkoutState === 'expired'
          ? 'expired'
          : 'failed'
  })
  return 'applied'
}

function associateObservedCustomer(
  connection: BillingStripeConnection,
  purchaserUserId: string,
  expectedBillingCustomerId: string | null,
  stripeCustomerId: string,
  now: Date
): string | null {
  const purchaserCustomer = getBillingCustomerForPurchaser(connection, purchaserUserId)
  const providerCustomer = getBillingCustomerByStripeId(connection, stripeCustomerId)
  if (
    (purchaserCustomer && purchaserCustomer.stripeCustomerId !== stripeCustomerId) ||
    (providerCustomer && providerCustomer.purchaserUserId !== purchaserUserId) ||
    (expectedBillingCustomerId && expectedBillingCustomerId !== (purchaserCustomer ?? providerCustomer)?.id)
  )
    return null
  if (!purchaserCustomer && !providerCustomer) {
    const timestamp = now.toISOString()
    connection.sqlite
      .prepare(
        `insert into billing_customers (id, purchaser_user_id, stripe_customer_id, created_at, updated_at)
         values (?, ?, ?, ?, ?)`
      )
      .run(`billing_customer_${randomUUID()}`, purchaserUserId, stripeCustomerId, timestamp, timestamp)
  }
  return getBillingCustomerForPurchaser(connection, purchaserUserId)?.id ?? null
}

function applyTransitionMutation(
  connection: BillingStripeConnection,
  mutation: BillingStripeTransitionMutation | null,
  now: Date
): ReturnType<typeof normalizedTransitionSnapshot> | null {
  if (!mutation) return null
  const updated = connection.sqlite
    .prepare(
      `update billing_subscription_transitions set
         state = ?, state_reason = ?,
         stripe_pending_invoice_id = coalesce(?, stripe_pending_invoice_id),
         stripe_pending_update_expires_at = coalesce(?, stripe_pending_update_expires_at),
         stripe_subscription_schedule_id = coalesce(?, stripe_subscription_schedule_id),
         revision = revision + 1, updated_at = ?
       where id = ? and revision = ?`
    )
    .run(
      mutation.state,
      mutation.reason,
      mutation.stripePendingInvoiceId ?? null,
      mutation.stripePendingUpdateExpiresAt ?? null,
      mutation.stripeSubscriptionScheduleId ?? null,
      now.toISOString(),
      mutation.transition.id,
      mutation.transition.revision
    )
  if (updated.changes !== 1) throw new Error('Billing transition changed during webhook application')
  const current = getBillingTransitionById(connection, mutation.transition.id)
  if (!current) throw new Error('Billing transition disappeared during webhook application')
  return normalizedTransitionSnapshot(current)
}

function normalizedTransitionForId(
  connection: BillingStripeConnection,
  transitionId: string
): ReturnType<typeof normalizedTransitionSnapshot> | null {
  const transition = getBillingTransitionById(connection, transitionId)
  return transition ? normalizedTransitionSnapshot(transition) : null
}

function commitProjectionOrThrow(
  connection: BillingStripeConnection,
  integration: BillingStripeIntegration<BillingStripeConnection, unknown> | undefined,
  input: Readonly<{
    purchaserUserId: string
    stripeCustomerId: string
    live: ReturnType<typeof getBillingSubscriptionForPurchaser>
    projection: BillingProjectionCommit
    now: Date
    orderMs: number
    eventId: string | null
    transition: ReturnType<typeof normalizedTransitionSnapshot> | null
    effects: BillingStripeWebhookLifecycle['effects']
    cause?: BillingStripeStateCommitCause
  }>
): void {
  const result = commitBillingProjectionInTransaction(connection, integration, {
    purchaserUserId: input.purchaserUserId,
    stripeCustomerId: input.stripeCustomerId,
    expectedRevision: input.live?.revision ?? 0,
    projection: input.projection,
    cause: input.cause ?? 'webhook',
    verifiedAt: input.now,
    projectionOrderMs: input.orderMs,
    projectionEventId: input.eventId,
    transition: input.transition,
    effects: input.effects
  })
  if (result.outcome === 'authority_lost') throw authorityLostObservation
  if (result.outcome === 'state_changed') {
    throw new Error('Billing projection changed inside an immediate transaction')
  }
}

function projectionWithGrace(
  projection: BillingProjectionCommit,
  live: ReturnType<typeof getBillingSubscriptionForPurchaser>,
  mutation: BillingStripeGraceMutation
): BillingProjectionCommit {
  if (mutation.kind === 'set') {
    return {
      ...projection,
      graceInvoiceId: mutation.invoiceId,
      graceStartedAt: mutation.startedAt,
      graceEndsAt: mutation.endsAt
    }
  }
  if (mutation.kind === 'clear') {
    return { ...projection, graceInvoiceId: null, graceStartedAt: null, graceEndsAt: null }
  }
  return {
    ...projection,
    graceInvoiceId: live?.graceInvoiceId ?? null,
    graceStartedAt: live?.graceStartedAt ?? null,
    graceEndsAt: live?.graceEndsAt ?? null
  }
}

function orderConflictLifecycle(
  live: NonNullable<ReturnType<typeof getBillingSubscriptionForPurchaser>>,
  transition: BillingStripeTransitionMutation | null,
  reason: string
): BillingStripeWebhookLifecycle {
  return {
    projection: { ...persistedProjection(live), reconciliationRequired: true, reconciliationReason: reason },
    grace: { kind: 'preserve' },
    transition: transition ? { transition: transition.transition, state: 'reconciliation_required', reason } : null,
    effects: []
  }
}

function persistedProjection(
  live: NonNullable<ReturnType<typeof getBillingSubscriptionForPurchaser>>
): BillingProjectionCommit {
  return {
    stripeSubscriptionId: live.stripeSubscriptionId,
    stripeSubscriptionItemId: live.stripeSubscriptionItemId,
    status: live.status,
    planKey: live.planKey,
    cadence: live.cadence,
    stripePriceId: live.stripePriceId,
    currentPeriodStart: live.currentPeriodStart,
    currentPeriodEnd: live.currentPeriodEnd,
    cancelAtPeriodEnd: live.cancelAtPeriodEnd,
    reconciliationRequired: live.reconciliationRequired,
    reconciliationReason: live.reconciliationReason,
    graceInvoiceId: live.graceInvoiceId,
    graceStartedAt: live.graceStartedAt,
    graceEndsAt: live.graceEndsAt
  }
}

function detachObservation(
  connection: BillingStripeConnection,
  observation: StripeEventObservation,
  status: string,
  now: Date
): boolean {
  const providerReference = observation.projection?.stripeSubscriptionId ?? observation.objectId
  const subjects = new Map<string, DetachedSubjectRow>()
  const direct = readDetachedSubject(connection, providerReference)
  if (direct) subjects.set(direct.id, direct)
  let attemptSubject: DetachedSubjectRow | null = null
  const customerAnchors: DetachedSubjectRow[] = []
  if (observation.attemptId) {
    attemptSubject = readDetachedSubject(connection, `attempt:${observation.attemptId}`)
    if (attemptSubject) subjects.set(attemptSubject.id, attemptSubject)
  }
  if (observation.stripeCustomerId) {
    const anchors = connection.sqlite
      .prepare(
        `${detachedSubjectSelect} where provider = 'stripe' and provider_customer_reference = ?
           and provider_reference glob 'customer:*'`
      )
      .all(observation.stripeCustomerId) as DetachedSubjectRow[]
    for (const subject of anchors) {
      customerAnchors.push(subject)
      subjects.set(subject.id, subject)
    }
  }

  if (subjects.size === 0) return false
  let cancellationSafe = true
  for (const subject of subjects.values()) {
    if (subject.providerEventCreatedAt !== null && observation.eventCreatedAt < subject.providerEventCreatedAt) {
      continue
    }
    const customerConflict = Boolean(
      observation.stripeCustomerId &&
      subject.providerCustomerReference &&
      observation.stripeCustomerId !== subject.providerCustomerReference
    )
    if (customerConflict) cancellationSafe = false
    const nextCustomer = observation.stripeCustomerId ?? subject.providerCustomerReference
    const nextStatus = observation.projection?.status ?? observation.checkoutState ?? status
    const nextExpiry = observation.projection?.currentPeriodEnd ?? subject.providerStatusExpiresAt
    const equalConflict =
      subject.providerEventCreatedAt === observation.eventCreatedAt &&
      (subject.providerCustomerReference !== nextCustomer ||
        subject.providerStatus !== nextStatus ||
        subject.providerStatusExpiresAt !== nextExpiry)
    connection.sqlite
      .prepare(
        `update detached_billing_subjects set
             provider_customer_reference = coalesce(?, provider_customer_reference),
             provider_status = ?, provider_status_expires_at = ?, provider_event_created_at = ?,
             status_updated_at = ? where id = ?`
      )
      .run(
        customerConflict ? subject.providerCustomerReference : nextCustomer,
        equalConflict || customerConflict ? 'reconciliation_required' : nextStatus,
        equalConflict || customerConflict ? null : nextExpiry,
        observation.eventCreatedAt,
        now.toISOString(),
        subject.id
      )
  }

  if (cancellationSafe && attemptSubject) {
    retainLateDetachedCheckoutSubscription(connection, attemptSubject, observation, now)
  }
  if (cancellationSafe) {
    for (const anchor of customerAnchors) {
      retainLateDetachedCustomerSubscription(connection, anchor, observation, now)
    }
  }
  const subscriptionSubject = readDetachedSubject(connection, providerReference)
  if (
    cancellationSafe &&
    subscriptionSubject?.providerReference.startsWith('sub_') &&
    subscriptionSubject.providerCustomerReference &&
    !['canceled', 'incomplete_expired'].includes(subscriptionSubject.providerStatus)
  )
    enqueueBillingDetachedSubscriptionCancellation(connection, subscriptionSubject.id, now)
  return true
}

type DetachedSubjectRow = Readonly<{
  id: string
  providerReference: string
  providerCustomerReference: string | null
  providerStatus: string
  providerStatusExpiresAt: string | null
  providerEventCreatedAt: number | null
  deletedAt: string
}>

const detachedSubjectSelect = `select id, provider_reference as providerReference,
  provider_customer_reference as providerCustomerReference, provider_status as providerStatus,
  provider_status_expires_at as providerStatusExpiresAt,
  provider_event_created_at as providerEventCreatedAt, deleted_at as deletedAt
  from detached_billing_subjects`

function readDetachedSubject(
  connection: BillingStripeConnection,
  providerReference: string
): DetachedSubjectRow | null {
  return (
    (connection.sqlite
      .prepare(`${detachedSubjectSelect} where provider = 'stripe' and provider_reference = ?`)
      .get(providerReference) as DetachedSubjectRow | undefined) ?? null
  )
}

function retainLateDetachedCheckoutSubscription(
  connection: BillingStripeConnection,
  attemptSubject: DetachedSubjectRow,
  observation: StripeEventObservation,
  now: Date
): void {
  const attemptId = observation.attemptId
  const subscription = 'subscription' in observation.providerState ? observation.providerState.subscription : null
  const customerId = subscription ? stripeReference(subscription.customer) : null
  if (
    !attemptId ||
    !subscription ||
    !customerId ||
    observation.stripeCustomerId !== customerId ||
    (observation.projection?.stripeSubscriptionId && observation.projection.stripeSubscriptionId !== subscription.id)
  )
    return
  const session = observation.providerState.kind === 'checkout' ? observation.providerState.session : null
  const checkoutCorrelated = Boolean(
    session &&
    session.id === observation.stripeSessionId &&
    session.client_reference_id === attemptId &&
    session.metadata?.billing_attempt_id === attemptId &&
    stripeReference(session.customer) === customerId &&
    stripeReference(session.subscription) === subscription.id
  )
  const subscriptionCorrelated = subscription.metadata?.billing_attempt_id === attemptId
  if (!checkoutCorrelated && !subscriptionCorrelated) return

  connection.sqlite
    .prepare(
      `insert into detached_billing_subjects (
         id, provider, provider_reference, provider_customer_reference, provider_status,
         provider_status_expires_at, provider_event_created_at, status_updated_at, deleted_at,
         retention_purpose, retention_policy, purge_after
       ) values (?, 'stripe', ?, ?, ?, ?, ?, ?, ?,
                 'external_billing_reconciliation', 'stripe_billing_lifecycle', null)
       on conflict(provider, provider_reference) do nothing`
    )
    .run(
      `detached_billing_${randomUUID()}`,
      subscription.id,
      customerId,
      subscription.status,
      observation.projection?.currentPeriodEnd ?? null,
      observation.eventCreatedAt,
      now.toISOString(),
      attemptSubject.deletedAt
    )
}

function retainLateDetachedCustomerSubscription(
  connection: BillingStripeConnection,
  customerSubject: DetachedSubjectRow,
  observation: StripeEventObservation,
  now: Date
): void {
  const projection = observation.projection
  const subscription = 'subscription' in observation.providerState ? observation.providerState.subscription : null
  const customerId = subscription ? stripeReference(subscription.customer) : null
  if (
    !projection ||
    projection.reconciliationRequired ||
    !subscription ||
    !projection.stripeSubscriptionId ||
    projection.stripeSubscriptionId !== subscription.id ||
    !customerId ||
    customerId !== observation.stripeCustomerId ||
    customerSubject.providerCustomerReference !== customerId ||
    !isExactManagedSubscription(subscription, customerId, projection, observation.catalog)
  )
    return

  connection.sqlite
    .prepare(
      `insert into detached_billing_subjects (
         id, provider, provider_reference, provider_customer_reference, provider_status,
         provider_status_expires_at, provider_event_created_at, status_updated_at, deleted_at,
         retention_purpose, retention_policy, purge_after
       ) values (?, 'stripe', ?, ?, ?, ?, ?, ?, ?,
                 'external_billing_reconciliation', 'stripe_billing_lifecycle', null)
       on conflict(provider, provider_reference) do nothing`
    )
    .run(
      `detached_billing_${randomUUID()}`,
      subscription.id,
      customerId,
      projection.status,
      projection.currentPeriodEnd,
      observation.eventCreatedAt,
      now.toISOString(),
      customerSubject.deletedAt
    )
}

function stripeReference(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') return value.id
  return null
}

function persistedFingerprint(live: NonNullable<ReturnType<typeof getBillingSubscriptionForPurchaser>>): string {
  return JSON.stringify([
    live.stripeSubscriptionId,
    live.stripeSubscriptionItemId,
    live.status,
    live.planKey,
    live.cadence,
    live.stripePriceId,
    live.currentPeriodStart,
    live.currentPeriodEnd,
    live.cancelAtPeriodEnd,
    live.reconciliationRequired,
    live.reconciliationReason
  ])
}

function insertReceipt(connection: BillingStripeConnection, observation: StripeEventObservation, now: Date): void {
  // This remains the last write in every application transaction.
  connection.sqlite
    .prepare(
      `insert into billing_events (stripe_event_id, event_type, provider_created_at, processed_at)
       values (?, ?, ?, ?)`
    )
    .run(observation.eventId, observation.eventType, observation.eventCreatedAt, now.toISOString())
}

function hasReceipt(connection: BillingStripeConnection, eventId: string): boolean {
  return Boolean(connection.sqlite.prepare('select 1 from billing_events where stripe_event_id = ?').get(eventId))
}
