import type {
  AccountStripeMembership,
  BillingAccountDeletionRequest,
  BillingCheckoutAttempt,
  BillingCustomer,
  BillingSubscription,
  BillingSubscriptionTransition,
  DetachedBillingSubject
} from '../../../db/schema/billing'
import type { BillingStripeConnection } from './public-contract'

const openCheckoutStates = "'pending', 'open', 'reconciliation_required'"
const openTransitionStates = "'pending', 'action_required', 'scheduled', 'reconciliation_required'"

export function getAccountStripeMembershipForUser(
  connection: BillingStripeConnection,
  userId: string
): AccountStripeMembership | null {
  const row = connection.sqlite
    .prepare(
      `select user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, tier,
              stripe_status, last_verified_at, projection_order_ms, projection_event_id,
              created_at, updated_at
       from account_stripe_memberships where user_id = ?`
    )
    .get(userId)
  return row ? (mapRow(row) as AccountStripeMembership) : null
}

export function getBillingCustomerForPurchaser(
  connection: BillingStripeConnection,
  purchaserUserId: string
): BillingCustomer | null {
  return customerRow(
    connection.sqlite
      .prepare(
        `select id, purchaser_user_id, stripe_customer_id, created_at, updated_at
         from billing_customers where purchaser_user_id = ?`
      )
      .get(purchaserUserId)
  )
}

export function getBillingCustomerById(
  connection: BillingStripeConnection,
  billingCustomerId: string
): BillingCustomer | null {
  return customerRow(
    connection.sqlite
      .prepare(
        `select id, purchaser_user_id, stripe_customer_id, created_at, updated_at
         from billing_customers where id = ?`
      )
      .get(billingCustomerId)
  )
}

export function getBillingCustomerByStripeId(
  connection: BillingStripeConnection,
  stripeCustomerId: string
): BillingCustomer | null {
  return customerRow(
    connection.sqlite
      .prepare(
        `select id, purchaser_user_id, stripe_customer_id, created_at, updated_at
         from billing_customers where stripe_customer_id = ?`
      )
      .get(stripeCustomerId)
  )
}

export function getBillingSubscriptionForPurchaser(
  connection: BillingStripeConnection,
  purchaserUserId: string
): BillingSubscription | null {
  return subscriptionRow(
    connection.sqlite.prepare(`${subscriptionSelect} where purchaser_user_id = ?`).get(purchaserUserId)
  )
}

export function getBillingSubscriptionById(
  connection: BillingStripeConnection,
  billingSubscriptionId: string
): BillingSubscription | null {
  return subscriptionRow(connection.sqlite.prepare(`${subscriptionSelect} where id = ?`).get(billingSubscriptionId))
}

export function getBillingSubscriptionByStripeId(
  connection: BillingStripeConnection,
  stripeSubscriptionId: string
): BillingSubscription | null {
  return subscriptionRow(
    connection.sqlite.prepare(`${subscriptionSelect} where stripe_subscription_id = ?`).get(stripeSubscriptionId)
  )
}

export function getCheckoutAttemptById(
  connection: BillingStripeConnection,
  attemptId: string
): BillingCheckoutAttempt | null {
  return checkoutRow(connection.sqlite.prepare(`${checkoutSelect} where id = ?`).get(attemptId))
}

export function getOpenCheckoutAttempt(
  connection: BillingStripeConnection,
  purchaserUserId: string
): BillingCheckoutAttempt | null {
  return checkoutRow(
    connection.sqlite
      .prepare(`${checkoutSelect} where purchaser_user_id = ? and state in (${openCheckoutStates})`)
      .get(purchaserUserId)
  )
}

export function getBillingTransitionById(
  connection: BillingStripeConnection,
  transitionId: string
): BillingSubscriptionTransition | null {
  return transitionRow(connection.sqlite.prepare(`${transitionSelect} where id = ?`).get(transitionId))
}

export function getOpenBillingTransition(
  connection: BillingStripeConnection,
  purchaserUserId: string
): BillingSubscriptionTransition | null {
  return transitionRow(
    connection.sqlite
      .prepare(`${transitionSelect} where purchaser_user_id = ? and state in (${openTransitionStates})`)
      .get(purchaserUserId)
  )
}

export function getBillingAccountDeletionRequest(
  connection: BillingStripeConnection,
  purchaserUserId: string
): BillingAccountDeletionRequest | null {
  return deletionRow(
    connection.sqlite
      .prepare(
        `select id, purchaser_user_id, billing_subscription_id, billing_customer_id,
                stripe_membership_user_id,
                expected_stripe_subscription_id, expected_stripe_customer_id,
                captured_billing_revision, state, reason, cancellation_confirmed_at,
                revision, created_at, updated_at
         from billing_account_deletion_requests where purchaser_user_id = ?`
      )
      .get(purchaserUserId)
  )
}

export function isBillingDeletionPending(connection: BillingStripeConnection, purchaserUserId: string): boolean {
  return getBillingAccountDeletionRequest(connection, purchaserUserId)?.state !== undefined
}

export function getDetachedBillingSubject(
  connection: BillingStripeConnection,
  providerReference: string
): DetachedBillingSubject | null {
  const row = connection.sqlite
    .prepare(
      `select id, provider, provider_reference, provider_customer_reference, provider_status,
              provider_status_expires_at, provider_event_created_at, status_updated_at,
              deleted_at, retention_purpose, retention_policy, purge_after
       from detached_billing_subjects where provider = 'stripe' and provider_reference = ?`
    )
    .get(providerReference)
  return row ? (mapRow(row) as DetachedBillingSubject) : null
}

export function updateCheckoutAttempt(
  connection: BillingStripeConnection,
  attemptId: string,
  input: Readonly<{
    billingCustomerId?: string | null
    stripeSessionId?: string | null
    state?: BillingCheckoutAttempt['state']
    updatedAt?: string
  }>
): BillingCheckoutAttempt | null {
  const live = getCheckoutAttemptById(connection, attemptId)
  if (!live) return null
  connection.sqlite
    .prepare(
      `update billing_checkout_attempts
       set billing_customer_id = ?, stripe_session_id = ?, state = ?, updated_at = ?
       where id = ?`
    )
    .run(
      input.billingCustomerId === undefined ? live.billingCustomerId : input.billingCustomerId,
      input.stripeSessionId === undefined ? live.stripeSessionId : input.stripeSessionId,
      input.state ?? live.state,
      input.updatedAt ?? new Date().toISOString(),
      attemptId
    )
  return getCheckoutAttemptById(connection, attemptId)
}

export function billingProjectionRevision(connection: BillingStripeConnection, purchaserUserId: string): number {
  return getBillingSubscriptionForPurchaser(connection, purchaserUserId)?.revision ?? 0
}

const subscriptionSelect = `select id, purchaser_user_id, billing_customer_id, stripe_subscription_id,
  stripe_subscription_item_id, status, plan_key, cadence, stripe_price_id, current_period_start,
  current_period_end, cancel_at_period_end, grace_invoice_id, grace_started_at, grace_ends_at,
  last_verified_at, projection_order_ms, projection_event_id, reconciliation_required,
  reconciliation_reason, revision, created_at, updated_at from billing_subscriptions`

const checkoutSelect = `select id, purchaser_user_id, billing_customer_id, plan_key, cadence, stripe_price_id,
  stripe_session_id, idempotency_key, state, success_url, cancel_url, reuse_until, created_at, updated_at
  from billing_checkout_attempts`

const transitionSelect = `select id, purchaser_user_id, billing_subscription_id, kind, source_plan_key,
  source_cadence, target_plan_key, target_cadence, effective_at, stripe_subscription_schedule_id,
  stripe_pending_invoice_id, stripe_pending_update_expires_at, idempotency_key,
  captured_billing_revision, state, state_reason, revision, created_at, updated_at
  from billing_subscription_transitions`

function customerRow(row: unknown): BillingCustomer | null {
  return row ? (mapRow(row) as BillingCustomer) : null
}

function subscriptionRow(row: unknown): BillingSubscription | null {
  if (!row) return null
  const mapped = mapRow(row) as BillingSubscription
  return {
    ...mapped,
    cancelAtPeriodEnd: Boolean(mapped.cancelAtPeriodEnd),
    reconciliationRequired: Boolean(mapped.reconciliationRequired)
  }
}

function checkoutRow(row: unknown): BillingCheckoutAttempt | null {
  return row ? (mapRow(row) as BillingCheckoutAttempt) : null
}

function transitionRow(row: unknown): BillingSubscriptionTransition | null {
  return row ? (mapRow(row) as BillingSubscriptionTransition) : null
}

function deletionRow(row: unknown): BillingAccountDeletionRequest | null {
  return row ? (mapRow(row) as BillingAccountDeletionRequest) : null
}

function mapRow(row: unknown): Record<string, unknown> {
  const source = row as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      value
    ])
  )
}
