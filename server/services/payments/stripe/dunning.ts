import type { BillingSnapshotStatus } from '../../../../shared/billing'

export const billingGracePeriodMs = 14 * 24 * 60 * 60 * 1_000

type BillingAccessSnapshot = Readonly<{
  status: BillingSnapshotStatus
  reconciliationRequired: boolean
  cancelAtPeriodEnd?: boolean
  currentPeriodEnd?: string | null
  graceInvoiceId: string | null
  graceStartedAt: string | null
  graceEndsAt: string | null
}>

export type BillingAccessEvaluation = Readonly<{
  state: 'none' | 'active' | 'grace' | 'suspended' | 'terminal' | 'reconciliation_required'
  granted: boolean
  graceDeadline: string | null
  reconciliationReason: string | null
}>

export function graceWindowFromFirstFailure(firstFailure: Date): Readonly<{ startedAt: string; endsAt: string }> {
  const firstFailureMs = firstFailure.getTime()
  if (!Number.isFinite(firstFailureMs)) throw new TypeError('First failure time must be valid')
  return Object.freeze({
    startedAt: firstFailure.toISOString(),
    endsAt: new Date(firstFailureMs + billingGracePeriodMs).toISOString()
  })
}

export function evaluateStripeSubscriptionAccess(
  snapshot: BillingAccessSnapshot,
  now = new Date()
): BillingAccessEvaluation {
  if (snapshot.reconciliationRequired) return reconciliationRequired('provider_projection_ambiguous')
  if (snapshot.status === 'none') return evaluation('none', false)
  if (snapshot.status === 'active') {
    if (snapshot.cancelAtPeriodEnd) {
      const currentPeriodEnd = Date.parse(snapshot.currentPeriodEnd ?? '')
      if (!Number.isFinite(currentPeriodEnd)) return reconciliationRequired('missing_or_invalid_current_period_end')
      if (now.getTime() >= currentPeriodEnd) return reconciliationRequired('nonrenewing_period_ended')
    }
    return evaluation('active', true)
  }
  if (snapshot.status === 'canceled' || snapshot.status === 'incomplete_expired') {
    return evaluation('terminal', false)
  }
  if (snapshot.status === 'past_due' || snapshot.status === 'unpaid') {
    if (!snapshot.graceInvoiceId) return reconciliationRequired('missing_or_invalid_grace_anchor')
    const grace = validatedGraceWindow(snapshot.graceStartedAt, snapshot.graceEndsAt)
    if (!grace) return reconciliationRequired('missing_or_invalid_grace_anchor')
    return now.getTime() < grace.endsAtMs
      ? evaluation('grace', true, grace.endsAt)
      : evaluation('suspended', false, grace.endsAt)
  }
  return reconciliationRequired(`unsupported_subscription_status:${snapshot.status}`)
}

function validatedGraceWindow(startedAt: string | null, endsAt: string | null) {
  if (!startedAt || !endsAt) return null
  const startedAtMs = Date.parse(startedAt)
  const endsAtMs = Date.parse(endsAt)
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endsAtMs) || endsAtMs - startedAtMs !== billingGracePeriodMs) {
    return null
  }
  return { endsAt, endsAtMs }
}

function evaluation(
  state: BillingAccessEvaluation['state'],
  granted: boolean,
  graceDeadline: string | null = null
): BillingAccessEvaluation {
  return Object.freeze({ state, granted, graceDeadline, reconciliationReason: null })
}

function reconciliationRequired(reason: string): BillingAccessEvaluation {
  return Object.freeze({
    state: 'reconciliation_required',
    granted: false,
    graceDeadline: null,
    reconciliationReason: reason
  })
}
