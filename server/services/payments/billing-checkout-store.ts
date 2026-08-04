import type Stripe from 'stripe'
import { randomUUID } from 'node:crypto'
import type { BillingCadence } from '../../../shared/billing'
import type { DatabaseConnection } from '../../db/connect'
import {
  getBillingCustomerById,
  getBillingCustomerByStripeId,
  getBillingCustomerForOrganization,
  getCheckoutAttemptById,
  getOwnedBillingOrganization,
  isBillingDeletionPendingForOrganization,
  listMembershipBillingSnapshots,
  updateCheckoutAttempt
} from '../../db/repositories/billing'
import { hasExternalFamilyMembership } from '../../db/repositories/family-authority'
import { externalBillingRetentionPurpose, stripeBillingRetentionPolicy } from '../../db/schema'
import type { BillingCheckoutAttempt, BillingCustomer, CheckoutAttemptState } from '../../db/schema'
import { evaluateStripeSubscriptionAccess } from './billing-dunning'
import { stripeId } from './billing-projection'

export const mutableAttemptStates = ['pending', 'open'] as const
export const reconcilableAttemptStates = ['pending', 'open', 'reconciliation_required'] as const

export type AttemptOutcome = 'applied' | 'authority_lost' | 'state_changed'

export function transitionCheckoutAttempt(
  connection: DatabaseConnection,
  userId: string,
  expectedAttempt: BillingCheckoutAttempt,
  allowedStates: readonly CheckoutAttemptState[],
  update: Partial<Pick<BillingCheckoutAttempt, 'state' | 'stripeSessionId' | 'billingCustomerId'>>
): AttemptOutcome {
  return connection.sqlite
    .transaction(() => {
      const live = readAuthorizedAttemptInTransaction(connection, userId, expectedAttempt)
      if (live.outcome !== 'applied' || !live.attempt) return live.outcome
      if (!allowedStates.includes(live.attempt.state)) return 'state_changed'
      updateCheckoutAttempt(connection, live.attempt.id, update)
      return 'applied'
    })
    .immediate()
}

export function recordObservedCheckoutSession(
  connection: DatabaseConnection,
  userId: string,
  expectedAttempt: BillingCheckoutAttempt,
  session: Stripe.Checkout.Session,
  allowedStates: readonly CheckoutAttemptState[],
  state: CheckoutAttemptState
): AttemptOutcome {
  return connection.sqlite
    .transaction(() => {
      const live = readAuthorizedAttemptInTransaction(connection, userId, expectedAttempt)
      if (live.outcome !== 'applied' || !live.attempt) {
        if (live.outcome === 'authority_lost') {
          detachObservedCheckoutSession(connection, expectedAttempt.id, session, 'attempt')
        }
        return live.outcome
      }
      if (!allowedStates.includes(live.attempt.state)) {
        if (live.attempt.stripeSessionId !== session.id) {
          detachObservedCheckoutSession(connection, expectedAttempt.id, session, 'session')
        }
        return 'state_changed'
      }
      if (live.attempt.stripeSessionId && live.attempt.stripeSessionId !== session.id) {
        updateCheckoutAttempt(connection, live.attempt.id, { state: 'reconciliation_required' })
        detachObservedCheckoutSession(connection, expectedAttempt.id, session, 'session')
        return 'state_changed'
      }

      if (state === 'open' && listMembershipBillingSnapshots(connection, userId).some(snapshotGrantsBillingAccess)) {
        updateCheckoutAttempt(connection, live.attempt.id, {
          stripeSessionId: session.id,
          state: 'reconciliation_required'
        })
        return 'state_changed'
      }

      const expectedCustomer = live.attempt.billingCustomerId
        ? getBillingCustomerById(connection, live.attempt.billingCustomerId)
        : null
      const observedCustomerId = stripeId(session.customer)
      if (expectedCustomer && observedCustomerId && expectedCustomer.stripeCustomerId !== observedCustomerId) {
        updateCheckoutAttempt(connection, live.attempt.id, {
          stripeSessionId: session.id,
          state: 'reconciliation_required'
        })
        return 'state_changed'
      }

      updateCheckoutAttempt(connection, live.attempt.id, {
        stripeSessionId: session.id,
        state
      })
      return 'applied'
    })
    .immediate()
}

export function finalizeReconciledCheckoutSession(
  connection: DatabaseConnection,
  userId: string,
  expectedAttempt: BillingCheckoutAttempt,
  session: Stripe.Checkout.Session,
  stripeCustomerId: string
): { outcome: AttemptOutcome; customer: BillingCustomer | null } {
  return connection.sqlite
    .transaction(() => {
      const live = readAuthorizedAttemptInTransaction(connection, userId, expectedAttempt)
      if (live.outcome !== 'applied' || !live.attempt) {
        if (live.outcome === 'authority_lost') {
          detachObservedCheckoutSession(connection, expectedAttempt.id, session, 'attempt')
        }
        return { outcome: live.outcome, customer: null }
      }
      if (
        !reconcilableAttemptStates.some((state) => state === live.attempt!.state) ||
        (live.attempt.stripeSessionId && live.attempt.stripeSessionId !== session.id)
      ) {
        if (live.attempt.stripeSessionId !== session.id) {
          detachObservedCheckoutSession(connection, expectedAttempt.id, session, 'session')
        }
        return { outcome: 'state_changed' as const, customer: null }
      }

      const organizationCustomer = getBillingCustomerForOrganization(connection, expectedAttempt.organizationId)
      const providerCustomer = getBillingCustomerByStripeId(connection, stripeCustomerId)
      if (
        (organizationCustomer && organizationCustomer.stripeCustomerId !== stripeCustomerId) ||
        (providerCustomer && providerCustomer.organizationId !== expectedAttempt.organizationId)
      ) {
        updateCheckoutAttempt(connection, live.attempt.id, {
          stripeSessionId: session.id,
          state: 'reconciliation_required'
        })
        return { outcome: 'state_changed' as const, customer: null }
      }

      if (!organizationCustomer && !providerCustomer) {
        const timestamp = new Date().toISOString()
        connection.sqlite
          .prepare(
            `insert into billing_customers (id, organization_id, stripe_customer_id, created_at, updated_at)
             values (?, ?, ?, ?, ?)`
          )
          .run(
            `billing_customer_${randomUUID()}`,
            expectedAttempt.organizationId,
            stripeCustomerId,
            timestamp,
            timestamp
          )
      }

      const customer = getBillingCustomerForOrganization(connection, expectedAttempt.organizationId)!
      if (listMembershipBillingSnapshots(connection, userId).some(snapshotGrantsBillingAccess)) {
        updateCheckoutAttempt(connection, live.attempt.id, {
          billingCustomerId: customer.id,
          stripeSessionId: session.id,
          state: 'reconciliation_required'
        })
        return { outcome: 'state_changed' as const, customer }
      }
      updateCheckoutAttempt(connection, live.attempt.id, {
        billingCustomerId: customer.id,
        stripeSessionId: session.id,
        state: 'completed'
      })
      return { outcome: 'applied' as const, customer }
    })
    .immediate()
}

export function readAuthorizedCheckoutAttempt(
  connection: DatabaseConnection,
  userId: string,
  expectedAttempt: BillingCheckoutAttempt
) {
  return connection.sqlite
    .transaction(() => readAuthorizedAttemptInTransaction(connection, userId, expectedAttempt))
    .immediate()
}

export function recoverCheckoutAttemptCadence(
  connection: DatabaseConnection,
  userId: string,
  expectedAttempt: BillingCheckoutAttempt,
  cadence: BillingCadence
): { outcome: AttemptOutcome; attempt: BillingCheckoutAttempt | null } {
  return connection.sqlite
    .transaction(() => {
      const live = readAuthorizedAttemptInTransaction(connection, userId, expectedAttempt)
      if (live.outcome !== 'applied' || !live.attempt) return live
      if (live.attempt.cadence !== null) {
        return {
          outcome: live.attempt.cadence === cadence ? ('applied' as const) : ('state_changed' as const),
          attempt: live.attempt
        }
      }
      if (live.attempt.state !== 'reconciliation_required') {
        return { outcome: 'state_changed' as const, attempt: live.attempt }
      }

      const now = new Date().toISOString()
      const updated = connection.sqlite
        .prepare(
          `update billing_checkout_attempts
           set cadence = ?, updated_at = ?
           where id = ? and cadence is null and state = 'reconciliation_required'`
        )
        .run(cadence, now, live.attempt.id)
      if (updated.changes !== 1) {
        return { outcome: 'state_changed' as const, attempt: getCheckoutAttemptById(connection, live.attempt.id) }
      }
      return {
        outcome: 'applied' as const,
        attempt: getCheckoutAttemptById(connection, live.attempt.id)
      }
    })
    .immediate()
}

function readAuthorizedAttemptInTransaction(
  connection: DatabaseConnection,
  userId: string,
  expectedAttempt: BillingCheckoutAttempt
): { outcome: AttemptOutcome; attempt: BillingCheckoutAttempt | null } {
  const owner = getOwnedBillingOrganization(connection, userId)
  const attempt = getCheckoutAttemptById(connection, expectedAttempt.id)
  if (
    !owner ||
    owner.id !== expectedAttempt.organizationId ||
    !attempt ||
    hasExternalFamilyMembership(connection, userId)
  ) {
    return { outcome: 'authority_lost', attempt: null }
  }
  if (isBillingDeletionPendingForOrganization(connection, owner.id)) {
    return { outcome: 'state_changed', attempt }
  }
  return { outcome: 'applied', attempt }
}

function snapshotGrantsBillingAccess(snapshot: ReturnType<typeof listMembershipBillingSnapshots>[number]): boolean {
  const status = snapshot.status
  if (!status) return false
  return evaluateStripeSubscriptionAccess({ ...snapshot, status }).granted
}

function detachObservedCheckoutSession(
  connection: DatabaseConnection,
  attemptId: string,
  session: Stripe.Checkout.Session,
  reference: 'attempt' | 'session'
) {
  const now = new Date().toISOString()
  connection.sqlite
    .prepare(
      `insert into detached_billing_subjects (
        id, provider, provider_reference, provider_customer_reference, provider_status,
        provider_status_expires_at, provider_event_created_at, status_updated_at, deleted_at,
        retention_purpose, retention_policy, purge_after
      ) values (?, 'stripe', ?, ?, ?, ?, null, ?, ?, ?, ?, null)
      on conflict(provider, provider_reference) do update set
        provider_customer_reference = coalesce(excluded.provider_customer_reference, provider_customer_reference),
        provider_status = excluded.provider_status,
        provider_status_expires_at = excluded.provider_status_expires_at,
        status_updated_at = excluded.status_updated_at`
    )
    .run(
      `detached_billing_${randomUUID()}`,
      reference === 'attempt' ? `attempt:${attemptId}` : `checkout:${session.id}`,
      stripeId(session.customer),
      `checkout_${session.status ?? 'unknown'}`,
      session.expires_at ? new Date(session.expires_at * 1_000).toISOString() : null,
      now,
      now,
      externalBillingRetentionPurpose,
      stripeBillingRetentionPolicy
    )
}
