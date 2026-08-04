import type { DatabaseConnection } from '../../db/connect'
import {
  enqueueBillingFamilyLifecycleSignal,
  hashBillingFamilyLifecycleEpisodeKey,
  type BillingFamilyLifecycleSignalAction
} from './billing-family-lifecycle-signal'

export const billingFamilyLifecycleSafetyLimit = 25

type BillingFamilyLifecycleSafetyCandidate = Readonly<{
  action: BillingFamilyLifecycleSignalAction
  billingSubscriptionId: string
  billingTransitionId: string | null
  episodeKey: string
}>

export function ensureBillingFamilyLifecycleJobs(
  connection: DatabaseConnection,
  now = new Date(),
  limit = billingFamilyLifecycleSafetyLimit
): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > billingFamilyLifecycleSafetyLimit) {
    throw new TypeError('Invalid billing Family lifecycle safety limit')
  }

  return connection.sqlite
    .transaction(() => {
      const rows = connection.sqlite
        .prepare(
          `with lifecycle_candidates as (
             select
               'payment_attention' as action,
               billing_subscriptions.id as billingSubscriptionId,
               null as billingTransitionId,
               billing_subscriptions.projection_event_id as episodeKey,
               billing_subscriptions.updated_at as sortAt
             from billing_subscriptions
             where billing_subscriptions.status in ('past_due', 'unpaid')
               and billing_subscriptions.plan_key in ('personal', 'family')
               and billing_subscriptions.reconciliation_required = 0
               and billing_subscriptions.grace_invoice_id is null
               and billing_subscriptions.projection_event_id is not null

             union all

             select
               'payment_attention',
               billing_subscriptions.id,
               billing_subscription_transitions.id,
               billing_subscription_transitions.id,
               billing_subscription_transitions.updated_at
             from billing_subscription_transitions
             inner join billing_subscriptions
               on billing_subscriptions.id = billing_subscription_transitions.billing_subscription_id
             where billing_subscription_transitions.kind = 'personal_to_family'
               and billing_subscription_transitions.state = 'action_required'
               and billing_subscription_transitions.stripe_pending_invoice_id is not null
               and billing_subscription_transitions.stripe_pending_update_expires_at > ?
               and billing_subscriptions.plan_key in ('personal', 'family')
               and billing_subscriptions.reconciliation_required = 0

             union all

             select
               'payment_grace_started',
               billing_subscriptions.id,
               null,
               billing_subscriptions.grace_invoice_id,
               billing_subscriptions.grace_started_at
             from billing_subscriptions
             where billing_subscriptions.status in ('past_due', 'unpaid')
               and billing_subscriptions.plan_key in ('personal', 'family')
               and billing_subscriptions.reconciliation_required = 0
               and billing_subscriptions.grace_invoice_id is not null
               and billing_subscriptions.grace_started_at is not null
               and billing_subscriptions.grace_ends_at is not null
               and billing_subscriptions.grace_started_at <= ?
               and billing_subscriptions.grace_ends_at > ?
               and unixepoch(billing_subscriptions.grace_ends_at)
                 - unixepoch(billing_subscriptions.grace_started_at) = 1209600

             union all

             select
               'renewal_ending' as action,
               billing_subscriptions.id as billingSubscriptionId,
               billing_subscription_transitions.id as billingTransitionId,
               billing_subscription_transitions.id as episodeKey,
               billing_subscription_transitions.effective_at as sortAt
             from billing_subscription_transitions
             inner join billing_subscriptions
               on billing_subscriptions.id = billing_subscription_transitions.billing_subscription_id
             inner join organization
               on organization.id = billing_subscriptions.organization_id
             where billing_subscription_transitions.kind = 'family_to_personal'
               and billing_subscription_transitions.state = 'scheduled'
               and billing_subscription_transitions.effective_at = billing_subscriptions.current_period_end
               and billing_subscription_transitions.effective_at > ?
               and billing_subscriptions.status = 'active'
               and billing_subscriptions.plan_key = 'family'
               and billing_subscriptions.reconciliation_required = 0
               and (
                 exists (
                   select 1 from member
                   where member.organization_id = billing_subscriptions.organization_id
                     and member.role = 'member'
                     and member.user_id <> organization.personal_owner_user_id
                 )
                 or exists (
                   select 1 from invitation
                   where invitation.organization_id = billing_subscriptions.organization_id
                     and invitation.status = 'pending'
                 )
               )

             union all

             select
               'renewal_ending',
               billing_subscriptions.id,
               null,
               billing_subscriptions.projection_event_id,
               billing_subscriptions.current_period_end
             from billing_subscriptions
             inner join organization
               on organization.id = billing_subscriptions.organization_id
             where billing_subscriptions.status = 'active'
               and billing_subscriptions.plan_key = 'family'
               and billing_subscriptions.cancel_at_period_end = 1
               and billing_subscriptions.reconciliation_required = 0
               and billing_subscriptions.projection_event_id is not null
               and billing_subscriptions.current_period_end > ?
               and (
                 exists (
                   select 1 from member
                   where member.organization_id = billing_subscriptions.organization_id
                     and member.role = 'member'
                     and member.user_id <> organization.personal_owner_user_id
                 )
                 or exists (
                   select 1 from invitation
                   where invitation.organization_id = billing_subscriptions.organization_id
                     and invitation.status = 'pending'
                 )
               )

             union all

             select
               'coverage_ended',
               billing_subscriptions.id,
               billing_subscription_transitions.id,
               billing_subscription_transitions.id,
               billing_subscription_transitions.effective_at
             from billing_subscription_transitions
             inner join billing_subscriptions
               on billing_subscriptions.id = billing_subscription_transitions.billing_subscription_id
             inner join organization
               on organization.id = billing_subscriptions.organization_id
             where billing_subscription_transitions.kind = 'family_to_personal'
               and billing_subscription_transitions.state = 'applied'
               and billing_subscription_transitions.effective_at <= ?
               and billing_subscriptions.status = 'active'
               and billing_subscriptions.plan_key = 'personal'
               and billing_subscriptions.reconciliation_required = 0
               and (
                 exists (
                   select 1 from member
                   where member.organization_id = billing_subscriptions.organization_id
                     and member.role = 'member'
                     and member.user_id <> organization.personal_owner_user_id
                 )
                 or exists (
                   select 1 from invitation
                   where invitation.organization_id = billing_subscriptions.organization_id
                     and invitation.status = 'pending'
                 )
               )

             union all

             select
               'coverage_ended',
               billing_subscriptions.id,
               null,
               billing_subscriptions.projection_event_id,
               billing_subscriptions.current_period_end
             from billing_subscriptions
             inner join organization
               on organization.id = billing_subscriptions.organization_id
             where billing_subscriptions.status in ('canceled', 'incomplete_expired')
               and billing_subscriptions.plan_key = 'family'
               and billing_subscriptions.reconciliation_required = 0
               and billing_subscriptions.projection_event_id is not null
               and (
                 exists (
                   select 1 from member
                   where member.organization_id = billing_subscriptions.organization_id
                     and member.role = 'member'
                     and member.user_id <> organization.personal_owner_user_id
                 )
                 or exists (
                   select 1 from invitation
                   where invitation.organization_id = billing_subscriptions.organization_id
                     and invitation.status = 'pending'
                 )
               )
           )
           select action, billingSubscriptionId, billingTransitionId, episodeKey
           from lifecycle_candidates
           order by sortAt, billingSubscriptionId, action
           limit ?`
        )
        .all(
          now.toISOString(),
          now.toISOString(),
          now.toISOString(),
          now.toISOString(),
          now.toISOString(),
          now.toISOString(),
          limit
        ) as BillingFamilyLifecycleSafetyCandidate[]

      let scheduled = 0
      for (const row of rows) {
        if (hasCoveredLifecycleJob(connection, row)) continue
        enqueueBillingFamilyLifecycleSignal(connection, row, now)
        scheduled += 1
      }
      return scheduled
    })
    .immediate()
}

function hasCoveredLifecycleJob(connection: DatabaseConnection, input: BillingFamilyLifecycleSafetyCandidate): boolean {
  return Boolean(
    connection.sqlite
      .prepare(
        `select 1
         from job_queue
         where type = 'billing.family-lifecycle-signal'
           and status in ('queued', 'running', 'succeeded')
           and json_valid(payload)
           and json_extract(payload, '$.action') = ?
           and json_extract(payload, '$.billingSubscriptionId') = ?
           and json_extract(payload, '$.billingTransitionId') is ?
           and json_extract(payload, '$.episodeKey') = ?
           and json_remove(
             payload,
             '$.action',
             '$.billingSubscriptionId',
             '$.billingTransitionId',
             '$.episodeKey'
           ) = '{}'`
      )
      .get(
        input.action,
        input.billingSubscriptionId,
        input.billingTransitionId,
        hashBillingFamilyLifecycleEpisodeKey(input.episodeKey)
      )
  )
}
