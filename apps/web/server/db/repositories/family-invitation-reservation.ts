/**
 * Shared by invitation reads and the expiration worker. The outer query must
 * expose the app-owned `invitation` table without an alias and bind its current
 * ISO timestamp to this fragment's single placeholder.
 *
 * A verified Family renewal-delinquency episode freezes reservations through
 * both its 14-day grace window and later recoverable suspension. The original
 * invitation expiry is deliberately unchanged and becomes authoritative again
 * as soon as billing recovers to active.
 */
export const frozenFamilyInvitationReservationSql = `exists (
  select 1
  from billing_subscriptions as invitation_billing
  where invitation_billing.organization_id = invitation.organization_id
    and invitation_billing.status in ('past_due', 'unpaid')
    and invitation_billing.plan_key = 'family'
    and invitation_billing.cadence in ('monthly', 'annual')
    and invitation_billing.cancel_at_period_end = 0
    and invitation_billing.reconciliation_required = 0
    and length(trim(invitation_billing.grace_invoice_id)) > 0
    and unixepoch(invitation_billing.grace_started_at) is not null
    and unixepoch(invitation_billing.grace_started_at) <= unixepoch(?)
    and unixepoch(invitation_billing.grace_ends_at) - unixepoch(invitation_billing.grace_started_at)
      = 14 * 24 * 60 * 60
)`
