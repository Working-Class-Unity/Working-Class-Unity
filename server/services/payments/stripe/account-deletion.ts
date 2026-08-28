import type Stripe from 'stripe'
import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  BillingStripeAccountDeletionPendingError,
  type BillingStripeAccountDeletionProof
} from './account-deletion-contract'
import { createStripeBillingCatalog, type StripeBillingCatalog } from './catalog'
import type { BillingStripeRuntimeConfiguration } from './configuration'
import { checkoutSessionCreateParams, isExpectedCheckoutSession, resolveCheckoutAttemptSession } from './checkout'
import { readCurrentStripeProjection, stripeId } from './projection'
import type { BillingStripeConnection } from './public-contract'
import {
  getAccountStripeMembershipForUser,
  getBillingAccountDeletionRequest,
  getBillingCustomerById,
  getBillingCustomerByStripeId,
  getBillingCustomerForPurchaser,
  getBillingSubscriptionForPurchaser,
  getCheckoutAttemptById,
  isBillingDeletionPending
} from './repository'
import { isTerminalStripeSubscription, resolveLiveStripeSubscription } from './subscription-discovery'
import { createStripeClient, type StripeBillingClient } from './stripe-client'
import {
  captureBillingStripeAccountDeletion,
  confirmBillingStripeAccountDeletion,
  enqueueBillingStripeDeletionPendingNotification,
  markBillingStripeAccountDeletionReconciliation
} from './account-deletion-store'

export const billingAccountDeletionCancellationJobType = 'billing.account-deletion-cancellation' as const
export const accountDeletionBillingProofTtlMs = 30_000

export {
  BillingStripeAccountDeletionPendingError,
  accountDeletionBillingPendingCode,
  type BillingStripeAccountDeletionProof
} from './account-deletion-contract'

type BillingStripeAccountDeletionProofRecord = Readonly<{
  requestId: string
  purchaserUserId: string
  requestRevision: number
  capturedBillingRevision: number
  stripeMembershipUserId: string | null
  stripeMembershipCustomerId: string | null
  stripeMembershipSubscriptionId: string | null
  cancellationConfirmedAt: string
  expiresAt: number
}>

const proofRecords = new WeakMap<object, BillingStripeAccountDeletionProofRecord>()
const activeProof = new AsyncLocalStorage<
  Readonly<{ proof: BillingStripeAccountDeletionProof; purchaserUserId: string }>
>()

export type BillingAccountDeletionStripeClient = Pick<StripeBillingClient, 'checkout' | 'subscriptions'>

export function isBillingStripeDeletionPending(connection: BillingStripeConnection, purchaserUserId: string): boolean {
  return isBillingDeletionPending(connection, purchaserUserId)
}

export async function prepareBillingStripeAccountDeletion(
  connection: BillingStripeConnection,
  purchaserUserId: string,
  configuration: BillingStripeRuntimeConfiguration,
  now = new Date()
): Promise<BillingStripeAccountDeletionProof> {
  return prepareBillingStripeAccountDeletionWithClient(
    connection,
    purchaserUserId,
    () => createStripeClient(configuration.stripe.secretKey),
    createStripeBillingCatalog(configuration.stripe.prices),
    now
  )
}

export async function prepareBillingStripeAccountDeletionWithClient(
  connection: BillingStripeConnection,
  purchaserUserId: string,
  getClient: () => BillingAccountDeletionStripeClient,
  catalog: StripeBillingCatalog,
  now = new Date()
): Promise<BillingStripeAccountDeletionProof> {
  try {
    return await prepareBillingStripeAccountDeletionCore(connection, purchaserUserId, getClient, catalog, now)
  } catch (error) {
    if (error instanceof BillingStripeAccountDeletionPendingError) {
      enqueueBillingStripeDeletionPendingNotification(connection, purchaserUserId, now)
    }
    throw error
  }
}

async function prepareBillingStripeAccountDeletionCore(
  connection: BillingStripeConnection,
  purchaserUserId: string,
  getClient: () => BillingAccountDeletionStripeClient,
  catalog: StripeBillingCatalog,
  now: Date
): Promise<BillingStripeAccountDeletionProof> {
  let capture = captureBillingStripeAccountDeletion(connection, purchaserUserId, now)
  if (capture.hasOpenCheckout) {
    await neutralizeBillingStripeDeletionCheckout(
      connection,
      purchaserUserId,
      getCheckoutAttemptForDeletion(connection, purchaserUserId),
      getClient,
      now
    )
    capture = captureBillingStripeAccountDeletion(connection, purchaserUserId, now)
    if (capture.hasOpenCheckout) throw accountDeletionPending()
  }
  const stripeMembership = getAccountStripeMembershipForUser(connection, purchaserUserId)
  if (capture.request.stripeMembershipUserId) {
    if (!stripeMembership || hasStripeMembershipReferenceConflict(capture.request, stripeMembership)) {
      markBillingStripeAccountDeletionReconciliation(
        connection,
        capture.request,
        'stripe_membership_billing_reference_conflict',
        now
      )
      throw accountDeletionPending()
    }
    if (capture.request.state === 'cancellation_confirmed') return issueProof(connection, capture.request)

    let client: BillingAccountDeletionStripeClient
    try {
      client = getClient()
    } catch {
      throw accountDeletionPending()
    }
    await cancelAndVerifySubscription(
      client,
      capture.request,
      stripeMembership.stripeSubscriptionId,
      stripeMembership.stripeCustomerId,
      connection,
      now
    )
    const confirmed = confirmBillingStripeAccountDeletion(connection, capture.request, now)
    if (!confirmed?.cancellationConfirmedAt) throw accountDeletionPending()
    return issueProof(connection, confirmed)
  }
  if (!capture.request.expectedStripeCustomerId) {
    const confirmed = confirmBillingStripeAccountDeletion(connection, capture.request, now)
    if (!confirmed?.cancellationConfirmedAt) throw accountDeletionPending()
    return issueProof(connection, confirmed)
  }

  let client: BillingAccountDeletionStripeClient
  try {
    client = getClient()
  } catch {
    throw accountDeletionPending()
  }

  if (capture.request.state !== 'cancellation_confirmed' && !capture.request.expectedStripeSubscriptionId) {
    let projection
    try {
      projection = await readCurrentStripeProjection(
        client as StripeBillingClient,
        capture.request.expectedStripeCustomerId,
        catalog
      )
    } catch {
      markBillingStripeAccountDeletionReconciliation(
        connection,
        capture.request,
        'customer_subscription_verification_unavailable',
        now
      )
      throw accountDeletionPending()
    }
    if (projection.reconciliationRequired) {
      markBillingStripeAccountDeletionReconciliation(
        connection,
        capture.request,
        'customer_subscription_state_unknown',
        now
      )
      throw accountDeletionPending()
    }
    if (projection.stripeSubscriptionId) {
      await cancelAndVerifyUnprojectedSubscription(
        client,
        capture.request,
        projection.stripeSubscriptionId,
        connection,
        now
      )
    }
  } else if (capture.request.state !== 'cancellation_confirmed') {
    await cancelAndVerifySubscription(
      client,
      capture.request,
      capture.request.expectedStripeSubscriptionId!,
      capture.request.expectedStripeCustomerId,
      connection,
      now
    )
  }

  let live
  try {
    live = await resolveLiveStripeSubscription(client, capture.request.expectedStripeCustomerId)
  } catch {
    markBillingStripeAccountDeletionReconciliation(
      connection,
      capture.request,
      'customer_subscription_verification_unavailable',
      now
    )
    throw accountDeletionPending()
  }
  if (live.outcome !== 'none') {
    markBillingStripeAccountDeletionReconciliation(
      connection,
      capture.request,
      live.outcome === 'found' ? 'customer_has_live_subscription' : live.reason,
      now
    )
    throw accountDeletionPending()
  }

  // Confirm only the exact authority whose provider state was verified above. Re-capturing
  // here could adopt a replacement local Customer or Subscription that appeared during
  // provider I/O and incorrectly bless it without ever verifying its Stripe state.
  const confirmed = confirmBillingStripeAccountDeletion(connection, capture.request, now)
  if (!confirmed?.cancellationConfirmedAt) throw accountDeletionPending()
  return issueProof(connection, confirmed)
}

export async function withBillingStripeAccountDeletionProof<T>(
  purchaserUserId: string,
  proof: BillingStripeAccountDeletionProof,
  operation: () => Promise<T>
): Promise<T> {
  const record = proofRecords.get(proof)
  if (!record || record.purchaserUserId !== purchaserUserId || record.expiresAt <= Date.now()) {
    throw new Error('Billing account deletion proof is stale or invalid')
  }
  try {
    return await activeProof.run({ proof, purchaserUserId }, operation)
  } finally {
    proofRecords.delete(proof)
  }
}

export function deleteBillingStripeAccountData(
  connection: BillingStripeConnection,
  purchaserUserId: string,
  now = new Date()
): void {
  if (!connection.sqlite.inTransaction) {
    throw new Error('Billing account data deletion must run inside the identity deletion transaction')
  }
  const proofNow = Date.now()
  const scope = activeProof.getStore()
  const proof = scope ? proofRecords.get(scope.proof) : undefined
  const request = getBillingAccountDeletionRequest(connection, purchaserUserId)
  const customer = getBillingCustomerForPurchaser(connection, purchaserUserId)
  const subscription = getBillingSubscriptionForPurchaser(connection, purchaserUserId)
  const stripeMembership = getAccountStripeMembershipForUser(connection, purchaserUserId)
  if (
    !scope ||
    scope.purchaserUserId !== purchaserUserId ||
    !proof ||
    proof.purchaserUserId !== purchaserUserId ||
    proof.expiresAt <= proofNow ||
    !request ||
    request.id !== proof.requestId ||
    request.state !== 'cancellation_confirmed' ||
    request.revision !== proof.requestRevision ||
    request.capturedBillingRevision !== proof.capturedBillingRevision ||
    request.stripeMembershipUserId !== proof.stripeMembershipUserId ||
    request.stripeMembershipUserId !== (stripeMembership?.userId ?? null) ||
    proof.stripeMembershipCustomerId !== (stripeMembership?.stripeCustomerId ?? null) ||
    proof.stripeMembershipSubscriptionId !== (stripeMembership?.stripeSubscriptionId ?? null) ||
    hasStripeMembershipReferenceConflict(request, stripeMembership) ||
    request.cancellationConfirmedAt !== proof.cancellationConfirmedAt ||
    request.billingCustomerId !== (customer?.id ?? null) ||
    request.expectedStripeCustomerId !== (customer?.stripeCustomerId ?? null) ||
    request.billingSubscriptionId !== (subscription?.id ?? null) ||
    request.expectedStripeSubscriptionId !== (subscription?.stripeSubscriptionId ?? null) ||
    request.capturedBillingRevision !== (subscription?.revision ?? 0)
  ) {
    throw new Error('Billing account deletion proof is stale or invalid')
  }
  proofRecords.delete(scope.proof)

  const stripeCustomerId = stripeMembership?.stripeCustomerId ?? request.expectedStripeCustomerId
  const stripeSubscriptionId = stripeMembership?.stripeSubscriptionId ?? request.expectedStripeSubscriptionId
  if (stripeCustomerId) {
    preserveDetachedDeletionReference(connection, {
      providerReference: stripeSubscriptionId ?? `customer:${stripeCustomerId}`,
      providerCustomerReference: stripeCustomerId,
      providerStatus: stripeSubscriptionId ? 'canceled' : 'verified_no_live_subscriptions',
      deletedAt: now.toISOString()
    })
  }

  connection.sqlite
    .prepare(
      `delete from job_queue
       where json_valid(payload) and (
         (type = 'billing.notification-delivery'
           and (json_extract(payload, '$.purchaserUserId') = ?
             or json_extract(payload, '$.authorityReference') = ?))
         or (type = 'billing.account-deletion-cancellation'
           and json_extract(payload, '$.requestId') = ?)
         or (type = 'billing.transition-convergence' and exists (
           select 1 from billing_subscription_transitions transition_row
           where transition_row.purchaser_user_id = ?
             and transition_row.id = json_extract(job_queue.payload, '$.transitionId')
         ))
       )`
    )
    .run(purchaserUserId, request.id, request.id, purchaserUserId)
  connection.sqlite
    .prepare('delete from billing_subscription_transitions where purchaser_user_id = ?')
    .run(purchaserUserId)
  connection.sqlite.prepare('delete from billing_checkout_attempts where purchaser_user_id = ?').run(purchaserUserId)
  connection.sqlite
    .prepare('delete from billing_account_deletion_requests where purchaser_user_id = ?')
    .run(purchaserUserId)
  connection.sqlite.prepare('delete from account_stripe_memberships where user_id = ?').run(purchaserUserId)
  connection.sqlite.prepare('delete from billing_subscriptions where purchaser_user_id = ?').run(purchaserUserId)
  connection.sqlite.prepare('delete from billing_customers where purchaser_user_id = ?').run(purchaserUserId)

  const residue = connection.sqlite
    .prepare(
      `select
         (select count(*) from billing_customers where purchaser_user_id = ?) +
         (select count(*) from billing_checkout_attempts where purchaser_user_id = ?) +
         (select count(*) from billing_subscriptions where purchaser_user_id = ?) +
         (select count(*) from billing_subscription_transitions where purchaser_user_id = ?) +
         (select count(*) from billing_account_deletion_requests where purchaser_user_id = ?) +
         (select count(*) from account_stripe_memberships where user_id = ?) as count`
    )
    .get(purchaserUserId, purchaserUserId, purchaserUserId, purchaserUserId, purchaserUserId, purchaserUserId) as {
    count: number
  }
  if (residue.count !== 0) throw new Error('Billing account deletion left purchaser-owned rows')
}

async function cancelAndVerifySubscription(
  client: BillingAccountDeletionStripeClient,
  request: NonNullable<ReturnType<typeof getBillingAccountDeletionRequest>>,
  subscriptionId: string,
  customerId: string,
  connection: BillingStripeConnection,
  now: Date
): Promise<void> {
  try {
    await client.subscriptions.cancel(
      subscriptionId,
      { invoice_now: false, prorate: false },
      { idempotencyKey: `billing-account-deletion:${request.id}` }
    )
  } catch {
    // An exact read below is authoritative after a lost or failed response.
  }
  let retrieved: Stripe.Subscription
  try {
    retrieved = await client.subscriptions.retrieve(subscriptionId)
  } catch {
    throw accountDeletionPending()
  }
  if (
    retrieved.id !== subscriptionId ||
    retrieved.status !== 'canceled' ||
    stripeId(retrieved.customer) !== customerId
  ) {
    markBillingStripeAccountDeletionReconciliation(connection, request, 'stripe_cancellation_unconfirmed', now)
    throw accountDeletionPending()
  }
}

async function cancelAndVerifyUnprojectedSubscription(
  client: BillingAccountDeletionStripeClient,
  request: NonNullable<ReturnType<typeof getBillingAccountDeletionRequest>>,
  stripeSubscriptionId: string,
  connection: BillingStripeConnection,
  now: Date
): Promise<void> {
  try {
    await client.subscriptions.cancel(
      stripeSubscriptionId,
      { invoice_now: false, prorate: false },
      { idempotencyKey: `billing-account-deletion:${request.id}:unprojected:${stripeSubscriptionId}` }
    )
  } catch {
    // The exact read below converges a lost cancellation response.
  }
  let retrieved: Stripe.Subscription
  try {
    retrieved = await client.subscriptions.retrieve(stripeSubscriptionId)
  } catch {
    markBillingStripeAccountDeletionReconciliation(
      connection,
      request,
      'unprojected_subscription_cancellation_unconfirmed',
      now
    )
    throw accountDeletionPending()
  }
  if (
    retrieved.id !== stripeSubscriptionId ||
    stripeId(retrieved.customer) !== request.expectedStripeCustomerId ||
    !isTerminalStripeSubscription(retrieved)
  ) {
    markBillingStripeAccountDeletionReconciliation(
      connection,
      request,
      'unprojected_subscription_cancellation_unconfirmed',
      now
    )
    throw accountDeletionPending()
  }

  const retained = connection.sqlite
    .transaction(() => {
      const current = getBillingAccountDeletionRequest(connection, request.purchaserUserId)
      if (
        !current ||
        current.id !== request.id ||
        current.revision !== request.revision ||
        current.expectedStripeCustomerId !== request.expectedStripeCustomerId ||
        current.expectedStripeSubscriptionId !== null
      )
        return false
      preserveDetachedDeletionReference(connection, {
        providerReference: stripeSubscriptionId,
        providerCustomerReference: request.expectedStripeCustomerId!,
        providerStatus: retrieved.status,
        deletedAt: now.toISOString()
      })
      return true
    })
    .immediate()
  if (!retained) throw accountDeletionPending()
}

async function neutralizeBillingStripeDeletionCheckout(
  connection: BillingStripeConnection,
  purchaserUserId: string,
  attempt: NonNullable<ReturnType<typeof getCheckoutAttemptById>>,
  getClient: () => BillingAccountDeletionStripeClient,
  now: Date
): Promise<void> {
  let client: BillingAccountDeletionStripeClient
  try {
    client = getClient()
  } catch {
    throw accountDeletionPending()
  }
  const expectedCustomer = attempt.billingCustomerId
    ? getBillingCustomerById(connection, attempt.billingCustomerId)
    : null
  if (attempt.billingCustomerId && (!expectedCustomer || expectedCustomer.purchaserUserId !== purchaserUserId)) {
    throw accountDeletionPending()
  }

  let session: Stripe.Checkout.Session
  try {
    if (attempt.stripeSessionId) {
      session = await client.checkout.sessions.retrieve(attempt.stripeSessionId, { expand: ['line_items'] })
    } else {
      const resolution = await resolveCheckoutAttemptSession(client, attempt)
      if (resolution.outcome === 'ambiguous') throw new Error('Checkout discovery is ambiguous')
      if (resolution.outcome === 'found') {
        session = await client.checkout.sessions.retrieve(resolution.session.id, { expand: ['line_items'] })
      } else {
        const reuseUntil = Date.parse(attempt.reuseUntil)
        if (!Number.isFinite(reuseUntil) || reuseUntil <= now.getTime())
          throw new Error('Checkout replay window elapsed')
        session = await client.checkout.sessions.create(
          checkoutSessionCreateParams(attempt, expectedCustomer?.stripeCustomerId ?? null),
          { idempotencyKey: attempt.idempotencyKey }
        )
      }
    }
  } catch {
    throw accountDeletionPending()
  }
  if (!isExpectedCheckoutSession(session, attempt, expectedCustomer?.stripeCustomerId ?? null)) {
    throw accountDeletionPending()
  }

  if (session.status === 'open') {
    try {
      await client.checkout.sessions.expire(
        session.id,
        {},
        { idempotencyKey: `billing-checkout-account-deletion:expire:${attempt.id}` }
      )
    } catch {
      // Completion can race expiration; the authoritative retrieve below decides.
    }
    try {
      session = await client.checkout.sessions.retrieve(session.id, { expand: ['line_items'] })
    } catch {
      throw accountDeletionPending()
    }
    if (!isExpectedCheckoutSession(session, attempt, expectedCustomer?.stripeCustomerId ?? null)) {
      throw accountDeletionPending()
    }
  }

  if (session.status === 'expired') {
    if (
      !recordDeletionCheckoutTerminalState(
        connection,
        purchaserUserId,
        attempt,
        session,
        null,
        null,
        null,
        'expired',
        now
      )
    ) {
      throw accountDeletionPending()
    }
    return
  }
  if (session.status !== 'complete') throw accountDeletionPending()

  const stripeCustomerId = stripeId(session.customer)
  const stripeSubscriptionId = stripeId(session.subscription)
  if (!stripeCustomerId || !stripeSubscriptionId) throw accountDeletionPending()
  let subscription: Stripe.Subscription
  try {
    subscription = await client.subscriptions.retrieve(stripeSubscriptionId)
  } catch {
    throw accountDeletionPending()
  }
  if (subscription.id !== stripeSubscriptionId || stripeId(subscription.customer) !== stripeCustomerId) {
    throw accountDeletionPending()
  }
  if (!isTerminalStripeSubscription(subscription)) {
    try {
      await client.subscriptions.cancel(
        stripeSubscriptionId,
        { invoice_now: false, prorate: false },
        { idempotencyKey: `billing-checkout-account-deletion:cancel:${attempt.id}` }
      )
    } catch {
      // The exact retrieve below proves whether cancellation converged.
    }
    try {
      subscription = await client.subscriptions.retrieve(stripeSubscriptionId)
    } catch {
      throw accountDeletionPending()
    }
  }
  if (
    subscription.id !== stripeSubscriptionId ||
    stripeId(subscription.customer) !== stripeCustomerId ||
    !isTerminalStripeSubscription(subscription)
  ) {
    throw accountDeletionPending()
  }
  if (
    !recordDeletionCheckoutTerminalState(
      connection,
      purchaserUserId,
      attempt,
      session,
      stripeCustomerId,
      stripeSubscriptionId,
      subscription.status,
      'completed',
      now
    )
  ) {
    throw accountDeletionPending()
  }
}

function recordDeletionCheckoutTerminalState(
  connection: BillingStripeConnection,
  purchaserUserId: string,
  expected: NonNullable<ReturnType<typeof getCheckoutAttemptById>>,
  session: Stripe.Checkout.Session,
  stripeCustomerId: string | null,
  stripeSubscriptionId: string | null,
  providerStatus: 'canceled' | 'incomplete_expired' | null,
  state: 'completed' | 'expired',
  now: Date
): boolean {
  return connection.sqlite
    .transaction(() => {
      if (!getBillingAccountDeletionRequest(connection, purchaserUserId)) return false
      const attempt = getCheckoutAttemptById(connection, expected.id)
      if (
        !attempt ||
        attempt.purchaserUserId !== purchaserUserId ||
        attempt.planKey !== expected.planKey ||
        attempt.cadence !== expected.cadence ||
        attempt.stripePriceId !== expected.stripePriceId ||
        attempt.idempotencyKey !== expected.idempotencyKey ||
        (attempt.stripeSessionId && attempt.stripeSessionId !== session.id) ||
        !['pending', 'open', 'reconciliation_required', state].includes(attempt.state)
      )
        return false

      let billingCustomerId = attempt.billingCustomerId
      if (state === 'completed') {
        if (!stripeCustomerId || !stripeSubscriptionId) return false
        const purchaserCustomer = getBillingCustomerForPurchaser(connection, purchaserUserId)
        const providerCustomer = getBillingCustomerByStripeId(connection, stripeCustomerId)
        if (
          (purchaserCustomer && purchaserCustomer.stripeCustomerId !== stripeCustomerId) ||
          (providerCustomer && providerCustomer.purchaserUserId !== purchaserUserId)
        )
          return false
        if (!purchaserCustomer && !providerCustomer) {
          const timestamp = now.toISOString()
          connection.sqlite
            .prepare(
              `insert into billing_customers (id, purchaser_user_id, stripe_customer_id, created_at, updated_at)
             values (?, ?, ?, ?, ?)`
            )
            .run(`billing_customer_${randomUUID()}`, purchaserUserId, stripeCustomerId, timestamp, timestamp)
        }
        billingCustomerId = getBillingCustomerForPurchaser(connection, purchaserUserId)?.id ?? null
        if (!billingCustomerId) return false
        preserveDetachedDeletionReference(connection, {
          providerReference: stripeSubscriptionId,
          providerCustomerReference: stripeCustomerId,
          providerStatus: providerStatus!,
          deletedAt: now.toISOString()
        })
      }
      const updated = connection.sqlite
        .prepare(
          `update billing_checkout_attempts
         set billing_customer_id = ?, stripe_session_id = ?, state = ?, updated_at = ?
         where id = ? and purchaser_user_id = ? and state in ('pending', 'open', 'reconciliation_required', ?)
           and (stripe_session_id is null or stripe_session_id = ?)`
        )
        .run(billingCustomerId, session.id, state, now.toISOString(), attempt.id, purchaserUserId, state, session.id)
      return updated.changes === 1
    })
    .immediate()
}

function getCheckoutAttemptForDeletion(
  connection: BillingStripeConnection,
  purchaserUserId: string
): NonNullable<ReturnType<typeof getCheckoutAttemptById>> {
  const row = connection.sqlite
    .prepare(
      `select id from billing_checkout_attempts
       where purchaser_user_id = ? and state in ('pending', 'open', 'reconciliation_required')`
    )
    .get(purchaserUserId) as { id: string } | undefined
  const attempt = row ? getCheckoutAttemptById(connection, row.id) : null
  if (!attempt) throw accountDeletionPending()
  return attempt
}

function issueProof(
  connection: BillingStripeConnection,
  request: NonNullable<ReturnType<typeof getBillingAccountDeletionRequest>>
): BillingStripeAccountDeletionProof {
  if (!request.cancellationConfirmedAt) throw new Error('Billing cancellation is not confirmed')
  const stripeMembership = getAccountStripeMembershipForUser(connection, request.purchaserUserId)
  if (
    request.stripeMembershipUserId !== (stripeMembership?.userId ?? null) ||
    hasStripeMembershipReferenceConflict(request, stripeMembership)
  ) {
    throw new Error('Billing cancellation confirmation is stale')
  }
  const proof = Object.freeze({}) as BillingStripeAccountDeletionProof
  const record: BillingStripeAccountDeletionProofRecord = Object.freeze({
    requestId: request.id,
    purchaserUserId: request.purchaserUserId,
    requestRevision: request.revision,
    capturedBillingRevision: request.capturedBillingRevision,
    stripeMembershipUserId: stripeMembership?.userId ?? null,
    stripeMembershipCustomerId: stripeMembership?.stripeCustomerId ?? null,
    stripeMembershipSubscriptionId: stripeMembership?.stripeSubscriptionId ?? null,
    cancellationConfirmedAt: request.cancellationConfirmedAt,
    expiresAt: Date.now() + accountDeletionBillingProofTtlMs
  })
  proofRecords.set(proof, record)
  return proof
}

function hasStripeMembershipReferenceConflict(
  request: NonNullable<ReturnType<typeof getBillingAccountDeletionRequest>>,
  stripeMembership: ReturnType<typeof getAccountStripeMembershipForUser>
): boolean {
  if (!request.stripeMembershipUserId) return stripeMembership !== null
  return (
    !stripeMembership ||
    (request.expectedStripeCustomerId !== null &&
      request.expectedStripeCustomerId !== stripeMembership.stripeCustomerId) ||
    (request.expectedStripeSubscriptionId !== null &&
      request.expectedStripeSubscriptionId !== stripeMembership.stripeSubscriptionId)
  )
}

function preserveDetachedDeletionReference(
  connection: BillingStripeConnection,
  input: Readonly<{
    providerReference: string
    providerCustomerReference: string
    providerStatus: string
    deletedAt: string
  }>
): void {
  connection.sqlite
    .prepare(
      `insert into detached_billing_subjects (
         id, provider, provider_reference, provider_customer_reference, provider_status,
         provider_status_expires_at, provider_event_created_at, status_updated_at, deleted_at,
         retention_purpose, retention_policy, purge_after
       ) values (?, 'stripe', ?, ?, ?, null, null, ?, ?,
                 'external_billing_reconciliation', 'stripe_billing_lifecycle', null)
       on conflict(provider, provider_reference) do update set
         provider_customer_reference = excluded.provider_customer_reference,
         provider_status = excluded.provider_status,
         status_updated_at = excluded.status_updated_at`
    )
    .run(
      `detached_billing_${randomUUID()}`,
      input.providerReference,
      input.providerCustomerReference,
      input.providerStatus,
      input.deletedAt,
      input.deletedAt
    )
}

function accountDeletionPending() {
  return new BillingStripeAccountDeletionPendingError()
}

export async function convergeBillingStripeAccountDeletion(
  connection: BillingStripeConnection,
  requestId: string,
  getClient: () => BillingAccountDeletionStripeClient,
  catalog: StripeBillingCatalog
): Promise<'confirmed' | 'missing' | 'pending'> {
  const row = connection.sqlite
    .prepare('select purchaser_user_id as purchaserUserId from billing_account_deletion_requests where id = ?')
    .get(requestId) as { purchaserUserId: string } | undefined
  if (!row) return 'missing'
  try {
    const proof = await prepareBillingStripeAccountDeletionWithClient(
      connection,
      row.purchaserUserId,
      getClient,
      catalog
    )
    proofRecords.delete(proof)
    return 'confirmed'
  } catch (error) {
    if (error instanceof BillingStripeAccountDeletionPendingError) return 'pending'
    throw error
  }
}
