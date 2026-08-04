import { z } from 'zod'
import type { DatabaseConnection } from '../../db/connect'
import type { JsonValue } from '../../db/schema'
import type { JobHandler } from '../jobs/job-queue'
import {
  billingFamilyLifecycleSignalJobType,
  hashBillingFamilyLifecycleEpisodeKey,
  type BillingFamilyLifecycleSignalAction
} from './billing-family-lifecycle-signal'
import { enqueueBillingNotificationDelivery } from './billing-notification-delivery'

const opaqueReference = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => value === value.trim(), 'Opaque references must not contain surrounding whitespace')

const billingFamilyLifecycleSignalPayloadSchema = z
  .object({
    action: z.enum(['payment_attention', 'payment_grace_started', 'renewal_ending', 'coverage_ended']),
    billingSubscriptionId: opaqueReference,
    billingTransitionId: opaqueReference.nullable(),
    episodeKey: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action === 'payment_grace_started' && value.billingTransitionId !== null) {
      context.addIssue({
        code: 'custom',
        message: 'Payment-grace signals cannot reference a billing transition'
      })
    }
    if (
      value.billingTransitionId &&
      value.episodeKey !== hashBillingFamilyLifecycleEpisodeKey(value.billingTransitionId)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Transition lifecycle signals must use the transition as their episode'
      })
    }
  })

export type BillingFamilyLifecycleSignalPayload = Readonly<{
  action: BillingFamilyLifecycleSignalAction
  billingSubscriptionId: string
  billingTransitionId: string | null
  episodeKey: string
}>

export type BillingFamilyLifecycleContext = Readonly<{
  connection: DatabaseConnection
  now?: () => Date
}>

type BillingFamilyLifecycleDelivery = Readonly<{
  effectiveAt?: string
  kind: 'payment_attention' | 'family_access_at_risk' | 'family_access_ending' | 'family_dissolved'
  recipientUserId: string
}>

type BillingSubscriptionLifecycleRow = Readonly<{
  cancelAtPeriodEnd: number
  currentPeriodEnd: string | null
  graceEndsAt: string | null
  graceInvoiceId: string | null
  graceStartedAt: string | null
  managerUserId: string
  organizationId: string
  planKey: string | null
  projectionEventId: string | null
  reconciliationRequired: number
  status: string
}>

export function createBillingFamilyLifecycleSignalJobHandler(context: BillingFamilyLifecycleContext): JobHandler {
  return async (payload: JsonValue) => {
    const parsed = billingFamilyLifecycleSignalPayloadSchema.safeParse(payload)
    if (!parsed.success) throw new Error('Invalid billing Family lifecycle signal payload')

    prepareBillingFamilyLifecycleEffect(context.connection, parsed.data, context.now?.() ?? new Date())
  }
}

export function createBillingFamilyLifecycleJobHandlers(
  context: BillingFamilyLifecycleContext
): Record<typeof billingFamilyLifecycleSignalJobType, JobHandler> {
  return {
    [billingFamilyLifecycleSignalJobType]: createBillingFamilyLifecycleSignalJobHandler(context)
  }
}

/**
 * Performs any Family graph mutation and durably enqueues opaque per-recipient
 * notification work in the same IMMEDIATE SQLite transaction.
 */
export function prepareBillingFamilyLifecycleEffect(
  connection: DatabaseConnection,
  payload: BillingFamilyLifecycleSignalPayload,
  now = new Date()
): number {
  return connection.sqlite
    .transaction(() => {
      const subscription = readLifecycleSubscription(connection, payload.billingSubscriptionId)
      if (!subscription) return 0

      let deliveries: readonly BillingFamilyLifecycleDelivery[]
      switch (payload.action) {
        case 'payment_attention': {
          deliveries = preparePaymentAttentionNotification(connection, subscription, payload)
          break
        }
        case 'payment_grace_started': {
          deliveries = preparePaymentGraceNotifications(connection, subscription, payload, now)
          break
        }
        case 'renewal_ending': {
          deliveries = prepareRenewalEndingNotifications(connection, subscription, payload, now)
          break
        }
        case 'coverage_ended': {
          deliveries = prepareCoverageEndedNotifications(connection, subscription, payload, now)
          break
        }
      }

      const episodeKey = JSON.stringify([
        payload.action,
        payload.billingSubscriptionId,
        payload.billingTransitionId,
        payload.episodeKey
      ])
      let scheduled = 0
      for (const delivery of deliveries) {
        if (
          enqueueBillingNotificationDelivery(
            connection,
            {
              effectiveAt: delivery.effectiveAt ?? null,
              episodeKey,
              kind: delivery.kind,
              recipientUserId: delivery.recipientUserId
            },
            now
          )
        ) {
          scheduled += 1
        }
      }
      return scheduled
    })
    .immediate()
}

function preparePaymentAttentionNotification(
  connection: DatabaseConnection,
  subscription: BillingSubscriptionLifecycleRow,
  payload: BillingFamilyLifecycleSignalPayload
): readonly BillingFamilyLifecycleDelivery[] {
  if (
    !['personal', 'family'].includes(subscription.planKey ?? '') ||
    subscription.reconciliationRequired !== 0 ||
    (payload.billingTransitionId
      ? !isActionRequiredTransition(
          connection,
          payload.billingTransitionId,
          payload.billingSubscriptionId,
          subscription.organizationId
        )
      : !['past_due', 'unpaid'].includes(subscription.status) ||
        (subscription.graceInvoiceId !== null &&
          hashBillingFamilyLifecycleEpisodeKey(subscription.graceInvoiceId) !== payload.episodeKey))
  ) {
    return []
  }

  return [{ kind: 'payment_attention', recipientUserId: subscription.managerUserId }]
}

function isActionRequiredTransition(
  connection: DatabaseConnection,
  transitionId: string,
  subscriptionId: string,
  organizationId: string
): boolean {
  return Boolean(
    connection.sqlite
      .prepare(
        `select 1
         from billing_subscription_transitions
         where id = ?
           and billing_subscription_id = ?
           and organization_id = ?
           and kind = 'personal_to_family'
           and state = 'action_required'
           and stripe_pending_invoice_id is not null`
      )
      .get(transitionId, subscriptionId, organizationId)
  )
}

function preparePaymentGraceNotifications(
  connection: DatabaseConnection,
  subscription: BillingSubscriptionLifecycleRow,
  payload: BillingFamilyLifecycleSignalPayload,
  now: Date
): readonly BillingFamilyLifecycleDelivery[] {
  const graceStartedAt = Date.parse(subscription.graceStartedAt ?? '')
  const graceEndsAt = Date.parse(subscription.graceEndsAt ?? '')
  if (
    payload.billingTransitionId !== null ||
    !['past_due', 'unpaid'].includes(subscription.status) ||
    !['personal', 'family'].includes(subscription.planKey ?? '') ||
    subscription.reconciliationRequired !== 0 ||
    !subscription.graceInvoiceId ||
    hashBillingFamilyLifecycleEpisodeKey(subscription.graceInvoiceId) !== payload.episodeKey ||
    !Number.isFinite(graceStartedAt) ||
    !Number.isFinite(graceEndsAt) ||
    graceEndsAt - graceStartedAt !== 14 * 24 * 60 * 60 * 1_000 ||
    graceStartedAt > now.getTime() ||
    graceEndsAt <= now.getTime()
  ) {
    return []
  }

  return [
    {
      kind: 'payment_attention',
      recipientUserId: subscription.managerUserId
    },
    ...(subscription.planKey === 'family'
      ? listExternalFamilyMemberUserIds(connection, subscription.organizationId, subscription.managerUserId).map(
          (recipientUserId) => ({
            kind: 'family_access_at_risk' as const,
            recipientUserId
          })
        )
      : [])
  ]
}

function prepareRenewalEndingNotifications(
  connection: DatabaseConnection,
  subscription: BillingSubscriptionLifecycleRow,
  payload: BillingFamilyLifecycleSignalPayload,
  now: Date
): readonly BillingFamilyLifecycleDelivery[] {
  const periodEnd = Date.parse(subscription.currentPeriodEnd ?? '')
  if (
    subscription.status !== 'active' ||
    subscription.planKey !== 'family' ||
    subscription.reconciliationRequired !== 0 ||
    !Number.isFinite(periodEnd) ||
    periodEnd <= now.getTime()
  ) {
    return []
  }

  if (payload.billingTransitionId) {
    if (
      !isScheduledFamilyToPersonalTransition(
        connection,
        payload.billingTransitionId,
        payload.billingSubscriptionId,
        subscription.organizationId,
        subscription.currentPeriodEnd!
      )
    ) {
      return []
    }
  } else if (
    subscription.cancelAtPeriodEnd !== 1 ||
    !subscription.projectionEventId ||
    hashBillingFamilyLifecycleEpisodeKey(subscription.projectionEventId) !== payload.episodeKey
  ) {
    return []
  }

  cancelPendingFamilyInvitations(connection, subscription.organizationId)
  return listExternalFamilyMemberUserIds(connection, subscription.organizationId, subscription.managerUserId).map(
    (recipientUserId) => ({
      effectiveAt: subscription.currentPeriodEnd!,
      kind: 'family_access_ending' as const,
      recipientUserId
    })
  )
}

function prepareCoverageEndedNotifications(
  connection: DatabaseConnection,
  subscription: BillingSubscriptionLifecycleRow,
  payload: BillingFamilyLifecycleSignalPayload,
  now: Date
): readonly BillingFamilyLifecycleDelivery[] {
  let transitionShouldBeApplied = false
  if (payload.billingTransitionId) {
    const transition = readEffectiveFamilyToPersonalTransition(
      connection,
      payload.billingTransitionId,
      payload.billingSubscriptionId,
      subscription.organizationId
    )
    const effectiveAt = Date.parse(transition?.effectiveAt ?? '')
    if (
      !transition ||
      !['scheduled', 'applied'].includes(transition.state) ||
      subscription.status !== 'active' ||
      subscription.planKey !== 'personal' ||
      subscription.reconciliationRequired !== 0 ||
      !Number.isFinite(effectiveAt) ||
      effectiveAt > now.getTime()
    ) {
      return []
    }
    transitionShouldBeApplied = transition.state === 'scheduled'
  } else if (
    !['canceled', 'incomplete_expired'].includes(subscription.status) ||
    subscription.planKey !== 'family' ||
    subscription.reconciliationRequired !== 0 ||
    !subscription.projectionEventId ||
    hashBillingFamilyLifecycleEpisodeKey(subscription.projectionEventId) !== payload.episodeKey
  ) {
    return []
  }

  cancelPendingFamilyInvitations(connection, subscription.organizationId)
  const memberUserIds = listExternalFamilyMemberUserIds(
    connection,
    subscription.organizationId,
    subscription.managerUserId
  )
  clearExternalFamilySessionPointers(connection, subscription.organizationId, subscription.managerUserId, now)
  deleteExternalFamilyMemberships(connection, subscription.organizationId, subscription.managerUserId)

  if (transitionShouldBeApplied) {
    const updated = connection.sqlite
      .prepare(
        `update billing_subscription_transitions
         set state = 'applied', state_reason = null, revision = revision + 1, updated_at = ?
         where id = ?
           and billing_subscription_id = ?
           and organization_id = ?
           and state = 'scheduled'`
      )
      .run(now.toISOString(), payload.billingTransitionId, payload.billingSubscriptionId, subscription.organizationId)
    if (updated.changes !== 1) throw new Error('Family downgrade transition changed during dissolution')
  }

  return memberUserIds.map((recipientUserId) => ({
    kind: 'family_dissolved' as const,
    recipientUserId
  }))
}

function readLifecycleSubscription(
  connection: DatabaseConnection,
  billingSubscriptionId: string
): BillingSubscriptionLifecycleRow | null {
  const row = connection.sqlite
    .prepare(
      `select
         billing_subscriptions.organization_id as organizationId,
         billing_subscriptions.status,
         billing_subscriptions.plan_key as planKey,
         billing_subscriptions.current_period_end as currentPeriodEnd,
         billing_subscriptions.cancel_at_period_end as cancelAtPeriodEnd,
         billing_subscriptions.grace_invoice_id as graceInvoiceId,
         billing_subscriptions.grace_started_at as graceStartedAt,
         billing_subscriptions.grace_ends_at as graceEndsAt,
         billing_subscriptions.projection_event_id as projectionEventId,
         billing_subscriptions.reconciliation_required as reconciliationRequired,
         organization.personal_owner_user_id as managerUserId
       from billing_subscriptions
       inner join organization
         on organization.id = billing_subscriptions.organization_id
       inner join member
         on member.organization_id = organization.id
        and member.user_id = organization.personal_owner_user_id
        and member.role = 'owner'
       where billing_subscriptions.id = ?`
    )
    .get(billingSubscriptionId) as BillingSubscriptionLifecycleRow | undefined
  return row ?? null
}

function isScheduledFamilyToPersonalTransition(
  connection: DatabaseConnection,
  transitionId: string,
  subscriptionId: string,
  organizationId: string,
  expectedEffectiveAt: string
): boolean {
  return Boolean(
    connection.sqlite
      .prepare(
        `select 1
         from billing_subscription_transitions
         where id = ?
           and billing_subscription_id = ?
           and organization_id = ?
           and kind = 'family_to_personal'
           and source_plan_key = 'family'
           and target_plan_key = 'personal'
           and state = 'scheduled'
           and effective_at = ?`
      )
      .get(transitionId, subscriptionId, organizationId, expectedEffectiveAt)
  )
}

function readEffectiveFamilyToPersonalTransition(
  connection: DatabaseConnection,
  transitionId: string,
  subscriptionId: string,
  organizationId: string
): Readonly<{ effectiveAt: string; state: string }> | null {
  const row = connection.sqlite
    .prepare(
      `select effective_at as effectiveAt, state
       from billing_subscription_transitions
       where id = ?
         and billing_subscription_id = ?
         and organization_id = ?
         and kind = 'family_to_personal'
         and source_plan_key = 'family'
         and target_plan_key = 'personal'
         and effective_at is not null`
    )
    .get(transitionId, subscriptionId, organizationId) as
    | {
        effectiveAt: string
        state: string
      }
    | undefined
  return row ?? null
}

function cancelPendingFamilyInvitations(connection: DatabaseConnection, organizationId: string): void {
  connection.sqlite
    .prepare(
      `update invitation
       set status = 'canceled'
       where organization_id = ?
         and status = 'pending'`
    )
    .run(organizationId)
}

function listExternalFamilyMemberUserIds(
  connection: DatabaseConnection,
  organizationId: string,
  managerUserId: string
): string[] {
  return (
    connection.sqlite
      .prepare(
        `select member.user_id as userId
         from member
         where member.organization_id = ?
           and member.role = 'member'
           and member.user_id <> ?
         order by member.id`
      )
      .all(organizationId, managerUserId) as Array<{ userId: string }>
  ).map((row) => row.userId)
}

function clearExternalFamilySessionPointers(
  connection: DatabaseConnection,
  organizationId: string,
  managerUserId: string,
  now: Date
): void {
  connection.sqlite
    .prepare(
      `update session
       set active_organization_id = null, updated_at = ?
       where active_organization_id = ?
         and user_id in (
           select user_id
           from member
           where organization_id = ?
             and role = 'member'
             and user_id <> ?
         )`
    )
    .run(now.getTime(), organizationId, organizationId, managerUserId)
}

function deleteExternalFamilyMemberships(
  connection: DatabaseConnection,
  organizationId: string,
  managerUserId: string
): void {
  connection.sqlite
    .prepare(
      `delete from member
       where organization_id = ?
         and role = 'member'
         and user_id <> ?`
    )
    .run(organizationId, managerUserId)
}
