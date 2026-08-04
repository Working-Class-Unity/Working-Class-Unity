import { randomUUID } from 'node:crypto'
import type { DatabaseConnection } from '../connect'
import { assertFamilyJoinRecipientStructure, requireCurrentFamilyManagerForOrganization } from './family-authority'
import {
  getBillingCustomerById,
  getBillingSubscriptionForOrganization,
  isBillingDeletionPendingForOrganization
} from './billing'

export const familyJoinRecoveryJobType = 'billing.family-join-recovery' as const
export const familyJoinRecoveryMaxAttempts = 12
export const familyJoinRecoveryDelayMs = 60_000

export type FamilyJoinAttemptState =
  | 'pending'
  | 'renewal_stop_pending'
  | 'renewal_off_confirmed'
  | 'membership_pending'
  | 'completed'
  | 'reconciliation_required'
  | 'failed'

export type FamilyJoinInvitation = Readonly<{
  id: string
  managerUserId: string
  organizationId: string
}>

export type PersonalFamilyJoinSubscription = Readonly<{
  billingCustomerId: string
  cadence: 'weekly' | 'monthly' | 'annual'
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: string
  id: string
  organizationId: string
  revision: number
  stripeCustomerId: string
  stripePriceId: string
  stripeSubscriptionId: string
  stripeSubscriptionItemId: string
}>

export type FamilyJoinAttempt = Readonly<{
  acceptedMemberId: string | null
  capturedPersonalBillingRevision: number
  id: string
  invitationId: string | null
  personalBillingSubscriptionId: string
  personalOrganizationId: string
  personalPaidThrough: string | null
  recipientUserId: string
  revision: number
  state: FamilyJoinAttemptState
  stateReason: string | null
  stripeCancellationIdempotencyKey: string
  targetOrganizationId: string | null
}>

export class FamilyJoinConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FamilyJoinConflictError'
  }
}

export function getCompletedFamilyJoinMembership(
  connection: DatabaseConnection,
  input: Readonly<{ invitationId: string; recipientUserId: string }>
): Readonly<{ memberId: string; organizationId: string }> | null {
  const row = connection.sqlite
    .prepare(
      `select
         family_join_attempts.accepted_member_id as memberId,
         family_join_attempts.target_organization_id as organizationId
       from family_join_attempts
       inner join member
         on member.id = family_join_attempts.accepted_member_id
        and member.organization_id = family_join_attempts.target_organization_id
        and member.user_id = family_join_attempts.recipient_user_id
        and member.role = 'member'
       where family_join_attempts.invitation_id = ?
         and family_join_attempts.recipient_user_id = ?
         and family_join_attempts.state = 'completed'`
    )
    .get(input.invitationId, input.recipientUserId) as { memberId: string; organizationId: string } | undefined

  return row ?? null
}

export function getPendingFamilyJoinInvitation(
  connection: DatabaseConnection,
  input: Readonly<{ invitationId: string; recipientUserId: string; now?: Date }>
): FamilyJoinInvitation | null {
  const row = connection.sqlite
    .prepare(
      `select
         invitation.id,
         invitation.organization_id as organizationId,
         organization.personal_owner_user_id as managerUserId
       from invitation
       inner join user
         on lower(trim(user.email)) = lower(trim(invitation.email))
       inner join organization
         on organization.id = invitation.organization_id
       where invitation.id = ?
         and invitation.status = 'pending'
         and invitation.role = 'member'
         and invitation.expires_at > ?
         and user.id = ?`
    )
    .get(input.invitationId, (input.now ?? new Date()).getTime(), input.recipientUserId) as
    | {
        id: string
        managerUserId: string | null
        organizationId: string
      }
    | undefined

  if (!row?.managerUserId || row.managerUserId === input.recipientUserId) return null
  return {
    id: row.id,
    managerUserId: row.managerUserId,
    organizationId: row.organizationId
  }
}

export function getPersonalFamilyJoinSubscription(
  connection: DatabaseConnection,
  input: Readonly<{
    organizationId: string
    recipientUserId: string
    targetOrganizationId: string
    now?: Date
  }>
): PersonalFamilyJoinSubscription | null {
  const structure = assertFamilyJoinRecipientStructure(connection, {
    organizationId: input.targetOrganizationId,
    userId: input.recipientUserId,
    now: input.now
  })
  if (structure.personalOrganizationId !== input.organizationId) {
    throw new FamilyJoinConflictError('Personal Family authority changed')
  }

  const openCheckout = connection.sqlite
    .prepare(
      `select 1
       from billing_checkout_attempts
       where organization_id = ?
         and state in ('pending', 'open', 'reconciliation_required')
       limit 1`
    )
    .get(input.organizationId)
  const openTransition = connection.sqlite
    .prepare(
      `select 1
       from billing_subscription_transitions
       where organization_id = ?
         and state in ('pending', 'action_required', 'scheduled', 'reconciliation_required')
       limit 1`
    )
    .get(input.organizationId)
  const deletionRequest = connection.sqlite
    .prepare(
      `select 1
       from billing_account_deletion_requests
       where organization_id = ?
       limit 1`
    )
    .get(input.organizationId)
  const deletionFence = isBillingDeletionPendingForOrganization(connection, input.organizationId)
  if (openCheckout || openTransition || deletionRequest || deletionFence) {
    throw new FamilyJoinConflictError('Personal billing must be reconciled before joining a Family')
  }

  const row = connection.sqlite
    .prepare(
      `select
         billing_subscriptions.id,
         billing_subscriptions.organization_id as organizationId,
         billing_subscriptions.billing_customer_id as billingCustomerId,
         billing_subscriptions.stripe_subscription_id as stripeSubscriptionId,
         billing_subscriptions.stripe_subscription_item_id as stripeSubscriptionItemId,
         billing_subscriptions.status,
         billing_subscriptions.plan_key as planKey,
         billing_subscriptions.cadence,
         billing_subscriptions.stripe_price_id as stripePriceId,
         billing_subscriptions.current_period_end as currentPeriodEnd,
         billing_subscriptions.cancel_at_period_end as cancelAtPeriodEnd,
         billing_subscriptions.last_verified_at as lastVerifiedAt,
         billing_subscriptions.reconciliation_required as reconciliationRequired,
         billing_subscriptions.revision,
         billing_customers.stripe_customer_id as stripeCustomerId
       from billing_subscriptions
       inner join billing_customers
         on billing_customers.id = billing_subscriptions.billing_customer_id
        and billing_customers.organization_id = billing_subscriptions.organization_id
       where billing_subscriptions.organization_id = ?`
    )
    .get(input.organizationId) as
    | {
        billingCustomerId: string
        cancelAtPeriodEnd: number
        cadence: string | null
        currentPeriodEnd: string | null
        id: string
        lastVerifiedAt: string | null
        organizationId: string
        planKey: string | null
        reconciliationRequired: number
        revision: number
        status: string
        stripeCustomerId: string
        stripePriceId: string | null
        stripeSubscriptionId: string | null
        stripeSubscriptionItemId: string | null
      }
    | undefined

  if (!row) return null
  if (['none', 'canceled', 'incomplete_expired'].includes(row.status)) {
    if (row.cancelAtPeriodEnd !== 0 || row.reconciliationRequired !== 0) {
      throw new FamilyJoinConflictError('Personal billing must be reconciled before joining a Family')
    }
    return null
  }
  if (
    row.status !== 'active' ||
    row.planKey !== 'personal' ||
    !isPersonalCadence(row.cadence) ||
    !row.stripeSubscriptionId ||
    !row.stripeSubscriptionItemId ||
    !row.stripePriceId ||
    !row.currentPeriodEnd ||
    Date.parse(row.currentPeriodEnd) <= (input.now ?? new Date()).getTime() ||
    !row.lastVerifiedAt ||
    row.reconciliationRequired !== 0
  ) {
    throw new FamilyJoinConflictError('Personal subscription is not current')
  }

  return {
    billingCustomerId: row.billingCustomerId,
    cadence: row.cadence,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd === 1,
    currentPeriodEnd: row.currentPeriodEnd,
    id: row.id,
    organizationId: row.organizationId,
    revision: row.revision,
    stripeCustomerId: row.stripeCustomerId,
    stripePriceId: row.stripePriceId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    stripeSubscriptionItemId: row.stripeSubscriptionItemId
  }
}

export function getFamilyJoinSettlementSubscription(
  connection: DatabaseConnection,
  attempt: FamilyJoinAttempt
): PersonalFamilyJoinSubscription | null {
  const subscription = getBillingSubscriptionForOrganization(connection, attempt.personalOrganizationId)
  if (
    !subscription ||
    subscription.id !== attempt.personalBillingSubscriptionId ||
    subscription.planKey !== 'personal' ||
    !isPersonalCadence(subscription.cadence) ||
    !subscription.stripeSubscriptionId ||
    !subscription.stripeSubscriptionItemId ||
    !subscription.stripePriceId ||
    !subscription.currentPeriodEnd
  ) {
    return null
  }
  const customer = getBillingCustomerById(connection, subscription.billingCustomerId)
  if (!customer || customer.organizationId !== attempt.personalOrganizationId) return null

  return {
    billingCustomerId: customer.id,
    cadence: subscription.cadence,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    currentPeriodEnd: subscription.currentPeriodEnd,
    id: subscription.id,
    organizationId: subscription.organizationId,
    revision: subscription.revision,
    stripeCustomerId: customer.stripeCustomerId,
    stripePriceId: subscription.stripePriceId,
    stripeSubscriptionId: subscription.stripeSubscriptionId,
    stripeSubscriptionItemId: subscription.stripeSubscriptionItemId
  }
}

export function createOrResumeFamilyJoinAttempt(
  connection: DatabaseConnection,
  input: Readonly<{
    invitationId: string
    recipientUserId: string
    now?: Date
  }>
): Readonly<{ attempt: FamilyJoinAttempt; subscription: PersonalFamilyJoinSubscription }> {
  return connection.sqlite
    .transaction(() => {
      const now = input.now ?? new Date()
      const invitation = getPendingFamilyJoinInvitation(connection, { ...input, now })
      if (!invitation) throw new FamilyJoinConflictError('Family invitation is no longer available')
      requireCurrentFamilyManagerForOrganization(connection, {
        managerUserId: invitation.managerUserId,
        organizationId: invitation.organizationId,
        now
      })
      const structure = assertFamilyJoinRecipientStructure(connection, {
        organizationId: invitation.organizationId,
        userId: input.recipientUserId,
        now
      })
      const subscription = getPersonalFamilyJoinSubscription(connection, {
        organizationId: structure.personalOrganizationId,
        recipientUserId: input.recipientUserId,
        targetOrganizationId: invitation.organizationId,
        now
      })
      if (!subscription) throw new FamilyJoinConflictError('No current Personal subscription exists')

      const invitationAttempt = readAttemptByInvitation(connection, input.invitationId)
      if (invitationAttempt) {
        assertAttemptCorrelation(invitationAttempt, {
          invitation,
          recipientUserId: input.recipientUserId,
          subscription
        })
        enqueueFamilyJoinRecovery(connection, invitationAttempt.id, now)
        return { attempt: invitationAttempt, subscription }
      }

      const recipientAttempt = readOpenAttemptByRecipient(connection, input.recipientUserId)
      if (recipientAttempt) {
        throw new FamilyJoinConflictError('Another Family join requires reconciliation')
      }

      const id = `family_join_${randomUUID().replaceAll('-', '')}`
      const idempotencyKey = `family_join_cancel_${randomUUID().replaceAll('-', '')}`
      const timestamp = now.toISOString()
      connection.sqlite
        .prepare(
          `insert into family_join_attempts (
             id,
             recipient_user_id,
             personal_organization_id,
             personal_billing_subscription_id,
             captured_personal_billing_revision,
             target_organization_id,
             invitation_id,
             stripe_cancellation_idempotency_key,
             state,
             revision,
             created_at,
             updated_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?, 'renewal_stop_pending', 0, ?, ?)`
        )
        .run(
          id,
          input.recipientUserId,
          subscription.organizationId,
          subscription.id,
          subscription.revision,
          invitation.organizationId,
          invitation.id,
          idempotencyKey,
          timestamp,
          timestamp
        )

      const attempt = readAttemptById(connection, id)
      if (!attempt) throw new Error('Persisted Family join attempt is missing')
      enqueueFamilyJoinRecovery(connection, attempt.id, now)
      return { attempt, subscription }
    })
    .immediate()
}

export function confirmFamilyJoinRenewalOff(
  connection: DatabaseConnection,
  input: Readonly<{
    allowRevisionDrift?: boolean
    attemptId: string
    currentPeriodEnd: string
    currentPeriodStart: string
    now?: Date
  }>
): FamilyJoinAttempt {
  return connection.sqlite
    .transaction(() => {
      const attempt = readAttemptById(connection, input.attemptId)
      if (!attempt || attempt.state === 'completed' || attempt.state === 'failed') {
        throw new FamilyJoinConflictError('Family join attempt is not recoverable')
      }
      const subscription = connection.sqlite
        .prepare(
          `select
             billing_subscriptions.id,
             billing_subscriptions.revision,
             billing_subscriptions.status,
             billing_subscriptions.plan_key as planKey,
             billing_subscriptions.cadence,
             billing_subscriptions.current_period_start as currentPeriodStart,
             billing_subscriptions.current_period_end as currentPeriodEnd,
             billing_subscriptions.cancel_at_period_end as cancelAtPeriodEnd,
             billing_subscriptions.stripe_subscription_id as stripeSubscriptionId,
             billing_subscriptions.stripe_subscription_item_id as stripeSubscriptionItemId,
             billing_subscriptions.stripe_price_id as stripePriceId,
             billing_subscriptions.reconciliation_required as reconciliationRequired,
             billing_customers.stripe_customer_id as stripeCustomerId
           from billing_subscriptions
           inner join billing_customers
             on billing_customers.id = billing_subscriptions.billing_customer_id
           where billing_subscriptions.id = ?
             and billing_subscriptions.organization_id = ?`
        )
        .get(attempt.personalBillingSubscriptionId, attempt.personalOrganizationId) as
        | {
            cancelAtPeriodEnd: number
            cadence: string | null
            currentPeriodEnd: string | null
            currentPeriodStart: string | null
            id: string
            planKey: string | null
            reconciliationRequired: number
            revision: number
            status: string
            stripeCustomerId: string
            stripePriceId: string | null
            stripeSubscriptionId: string | null
            stripeSubscriptionItemId: string | null
          }
        | undefined

      const confirmationNow = input.now ?? new Date()
      const currentPeriodStartMs = Date.parse(input.currentPeriodStart)
      const currentPeriodEndMs = Date.parse(input.currentPeriodEnd)
      const alreadyMatchesConfirmedProviderState =
        subscription?.cancelAtPeriodEnd === 1 &&
        subscription.currentPeriodStart === input.currentPeriodStart &&
        subscription.currentPeriodEnd === input.currentPeriodEnd
      if (
        !subscription ||
        subscription.status !== 'active' ||
        subscription.planKey !== 'personal' ||
        !isPersonalCadence(subscription.cadence) ||
        !subscription.stripeSubscriptionId ||
        !subscription.stripeSubscriptionItemId ||
        !subscription.stripePriceId ||
        subscription.reconciliationRequired !== 0 ||
        !Number.isFinite(currentPeriodStartMs) ||
        !Number.isFinite(currentPeriodEndMs) ||
        currentPeriodStartMs <= 0 ||
        currentPeriodEndMs <= currentPeriodStartMs ||
        currentPeriodEndMs <= confirmationNow.getTime() ||
        (subscription.revision !== attempt.capturedPersonalBillingRevision &&
          !alreadyMatchesConfirmedProviderState &&
          !input.allowRevisionDrift)
      ) {
        throw new FamilyJoinConflictError('Personal subscription changed before renewal confirmation')
      }

      const timestamp = confirmationNow.toISOString()
      const updated = connection.sqlite
        .prepare(
          `update billing_subscriptions
           set
             current_period_start = ?,
             current_period_end = ?,
             cancel_at_period_end = 1,
             last_verified_at = ?,
             revision = revision + 1,
             updated_at = ?
           where id = ?
             and revision = ?`
        )
        .run(
          input.currentPeriodStart,
          input.currentPeriodEnd,
          timestamp,
          timestamp,
          subscription.id,
          subscription.revision
        )
      if (updated.changes !== 1) {
        throw new FamilyJoinConflictError('Personal subscription changed before renewal confirmation')
      }

      const attemptUpdated = connection.sqlite
        .prepare(
          `update family_join_attempts
           set
             personal_paid_through = ?,
             state = 'renewal_off_confirmed',
             state_reason = null,
             revision = revision + 1,
             updated_at = ?
           where id = ?
             and revision = ?`
        )
        .run(input.currentPeriodEnd, timestamp, attempt.id, attempt.revision)
      if (attemptUpdated.changes !== 1) {
        throw new FamilyJoinConflictError('Family join attempt changed before renewal confirmation')
      }

      const confirmed = readAttemptById(connection, attempt.id)
      if (!confirmed) throw new Error('Confirmed Family join attempt is missing')
      return confirmed
    })
    .immediate()
}

export function markFamilyJoinAttemptReconciliation(
  connection: DatabaseConnection,
  attemptId: string,
  reason: string,
  now = new Date()
): void {
  connection.sqlite
    .prepare(
      `update family_join_attempts
       set
         state = 'reconciliation_required',
         state_reason = ?,
         revision = revision + 1,
         updated_at = ?
       where id = ?
         and state <> 'completed'`
    )
    .run(reason, now.toISOString(), attemptId)
}

export function failFamilyJoinAttempt(
  connection: DatabaseConnection,
  attemptId: string,
  reason: string,
  now = new Date()
): void {
  const updated = connection.sqlite
    .prepare(
      `update family_join_attempts
       set
         state = 'failed',
         state_reason = ?,
         revision = revision + 1,
         updated_at = ?
       where id = ?
         and state not in ('completed', 'failed')`
    )
    .run(reason, now.toISOString(), attemptId)
  if (updated.changes === 1) return

  const attempt = readAttemptById(connection, attemptId)
  if (attempt?.state !== 'failed') {
    throw new FamilyJoinConflictError('Family join attempt could not be failed')
  }
}

export function markFamilyJoinMembershipPending(
  connection: DatabaseConnection,
  attemptId: string,
  now = new Date()
): FamilyJoinAttempt {
  const attempt = readAttemptById(connection, attemptId)
  if (
    !attempt ||
    !attempt.personalPaidThrough ||
    !['renewal_off_confirmed', 'membership_pending', 'reconciliation_required'].includes(attempt.state)
  ) {
    throw new FamilyJoinConflictError('Personal renewal-off confirmation is missing')
  }

  if (attempt.state !== 'membership_pending') {
    const updated = connection.sqlite
      .prepare(
        `update family_join_attempts
         set
           state = 'membership_pending',
           state_reason = null,
           revision = revision + 1,
           updated_at = ?
         where id = ?
           and revision = ?`
      )
      .run(now.toISOString(), attempt.id, attempt.revision)
    if (updated.changes !== 1) throw new FamilyJoinConflictError('Family join attempt changed')
  }

  const pending = readAttemptById(connection, attempt.id)
  if (!pending) throw new Error('Pending Family join attempt is missing')
  return pending
}

export function completeFamilyJoinAttempt(
  connection: DatabaseConnection,
  input: Readonly<{ attemptId: string; memberId: string; now?: Date }>
): void {
  const timestamp = (input.now ?? new Date()).toISOString()
  const updated = connection.sqlite
    .prepare(
      `update family_join_attempts
       set
         accepted_member_id = ?,
         state = 'completed',
         state_reason = null,
         revision = revision + 1,
         updated_at = ?
       where id = ?
         and state in (
           'renewal_off_confirmed',
           'membership_pending',
           'reconciliation_required',
           'completed'
         )`
    )
    .run(input.memberId, timestamp, input.attemptId)
  if (updated.changes !== 1) throw new FamilyJoinConflictError('Family join attempt could not be completed')
}

export function getFamilyJoinAttempt(connection: DatabaseConnection, attemptId: string): FamilyJoinAttempt | null {
  return readAttemptById(connection, attemptId)
}

export function hasDurableFamilyJoinRenewalOff(connection: DatabaseConnection, attempt: FamilyJoinAttempt): boolean {
  if (
    !attempt.personalPaidThrough ||
    !['renewal_off_confirmed', 'membership_pending', 'reconciliation_required', 'completed'].includes(attempt.state)
  ) {
    return false
  }

  return Boolean(
    connection.sqlite
      .prepare(
        `select 1
         from billing_subscriptions
         where id = ?
           and organization_id = ?
           and plan_key = 'personal'
           and cadence in ('weekly', 'monthly', 'annual')
           and status = 'active'
           and cancel_at_period_end = 1
           and reconciliation_required = 0
           and current_period_end = ?
         limit 1`
      )
      .get(attempt.personalBillingSubscriptionId, attempt.personalOrganizationId, attempt.personalPaidThrough)
  )
}

export function reconcileExistingFamilyJoinMembership(
  connection: DatabaseConnection,
  attemptId: string,
  now = new Date()
): 'already_completed' | 'completed' | 'renewal_confirmation_required' | 'user_retry_required' {
  return connection.sqlite
    .transaction(() => {
      const attempt = readAttemptById(connection, attemptId)
      if (!attempt || attempt.state === 'failed') return 'user_retry_required' as const
      if (attempt.state === 'completed') return 'already_completed' as const
      if (!hasDurableFamilyJoinRenewalOff(connection, attempt)) {
        return 'renewal_confirmation_required' as const
      }
      if (!attempt.invitationId || !attempt.targetOrganizationId) {
        markFamilyJoinAttemptReconciliation(connection, attempt.id, 'family_invitation_unavailable', now)
        return 'user_retry_required' as const
      }

      const persisted = connection.sqlite
        .prepare(
          `select member.id as memberId
           from invitation
           inner join user
             on lower(trim(user.email)) = lower(trim(invitation.email))
            and user.id = ?
           inner join member
             on member.organization_id = invitation.organization_id
            and member.user_id = user.id
            and member.role = 'member'
           where invitation.id = ?
             and invitation.organization_id = ?
             and invitation.status = 'accepted'
           limit 1`
        )
        .get(attempt.recipientUserId, attempt.invitationId, attempt.targetOrganizationId) as
        { memberId: string } | undefined
      if (!persisted) {
        const invitationAvailable = connection.sqlite
          .prepare(
            `select 1
             from invitation
             inner join user
               on lower(trim(user.email)) = lower(trim(invitation.email))
              and user.id = ?
             where invitation.id = ?
               and invitation.organization_id = ?
               and invitation.status = 'pending'
               and invitation.role = 'member'
               and invitation.expires_at > ?
             limit 1`
          )
          .get(attempt.recipientUserId, attempt.invitationId, attempt.targetOrganizationId, now.getTime())
        markFamilyJoinAttemptReconciliation(
          connection,
          attempt.id,
          invitationAvailable ? 'family_acceptance_requires_user_retry' : 'family_invitation_unavailable',
          now
        )
        return 'user_retry_required' as const
      }

      completeFamilyJoinAttempt(connection, {
        attemptId: attempt.id,
        memberId: persisted.memberId,
        now
      })
      return 'completed' as const
    })
    .immediate()
}

export function enqueueFamilyJoinRecovery(
  connection: DatabaseConnection,
  attemptId: string,
  now = new Date()
): boolean {
  return insertFamilyJoinRecoveryJob(connection, attemptId, now, false)
}

function insertFamilyJoinRecoveryJob(
  connection: DatabaseConnection,
  attemptId: string,
  now: Date,
  appendAfterExhaustion: boolean
): boolean {
  if (!attemptId || attemptId !== attemptId.trim() || attemptId.length > 255) {
    throw new TypeError('Invalid Family join recovery reference')
  }
  const payload = JSON.stringify({ attemptId })
  const inserted = connection.sqlite
    .prepare(
      `insert into job_queue (
         type, payload, max_attempts, run_after, created_at, updated_at
       )
       select ?, ?, ?, ?, ?, ?
       where not exists (
         select 1
         from job_queue
         where type = ?
           and json_valid(payload)
           and json_extract(payload, '$.attemptId') = ?
           and json_remove(payload, '$.attemptId') = '{}'
           and (
             (? = 0 and status in ('queued', 'running', 'succeeded'))
             or (
               ? = 1
               and (
                 status = 'running'
                 or (status = 'queued' and attempts < max_attempts)
               )
             )
           )
       )`
    )
    .run(
      familyJoinRecoveryJobType,
      payload,
      familyJoinRecoveryMaxAttempts,
      new Date(now.getTime() + familyJoinRecoveryDelayMs).toISOString(),
      now.toISOString(),
      now.toISOString(),
      familyJoinRecoveryJobType,
      attemptId,
      appendAfterExhaustion ? 1 : 0,
      appendAfterExhaustion ? 1 : 0
    )
  return inserted.changes === 1
}

/**
 * Provider-uncertain renewal-off work cannot silently exhaust: once its active
 * generation is gone, discovery appends a fresh generation and leaves every
 * historical row intact. Post-renewal bookkeeping gets one discovery pass.
 * A valid user-retry state is not background-retried, but later invitation or
 * manager-authority loss appends one recovery generation to release the attempt.
 */
export function ensureFamilyJoinRecoveryJobs(connection: DatabaseConnection, now = new Date(), limit = 25): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError('Invalid Family join recovery safety limit')
  }
  return connection.sqlite
    .transaction(() => {
      const attempts = connection.sqlite
        .prepare(
          `with recovery_candidates as (
             select
               family_join_attempts.*,
               case
                 when family_join_attempts.state = 'reconciliation_required'
                   and family_join_attempts.state_reason in (
                     'family_acceptance_requires_retry',
                     'family_acceptance_requires_user_retry'
                   )
                   and not exists (
                     select 1
                     from invitation
                     inner join user
                       on lower(trim(user.email)) = lower(trim(invitation.email))
                      and user.id = family_join_attempts.recipient_user_id
                     inner join organization
                       on organization.id = invitation.organization_id
                      and organization.id = family_join_attempts.target_organization_id
                     inner join member as manager_member
                       on manager_member.organization_id = organization.id
                      and manager_member.user_id = organization.personal_owner_user_id
                      and manager_member.role = 'owner'
                     inner join billing_subscriptions
                       on billing_subscriptions.organization_id = organization.id
                     inner join billing_customers
                       on billing_customers.id = billing_subscriptions.billing_customer_id
                      and billing_customers.organization_id = billing_subscriptions.organization_id
                     where invitation.id = family_join_attempts.invitation_id
                       and invitation.status = 'pending'
                       and invitation.role = 'member'
                       and invitation.expires_at > ?
                       and organization.personal_owner_user_id is not null
                       and organization.personal_owner_user_id <> family_join_attempts.recipient_user_id
                       and organization.billing_deletion_pending = 0
                       and billing_subscriptions.status = 'active'
                       and billing_subscriptions.plan_key = 'family'
                       and billing_subscriptions.cadence in ('monthly', 'annual')
                       and billing_subscriptions.stripe_subscription_id is not null
                       and billing_subscriptions.stripe_subscription_item_id is not null
                       and billing_subscriptions.stripe_price_id is not null
                       and billing_subscriptions.current_period_start is not null
                       and billing_subscriptions.current_period_end is not null
                       and billing_subscriptions.current_period_end > ?
                       and billing_subscriptions.last_verified_at is not null
                       and billing_subscriptions.cancel_at_period_end = 0
                       and billing_subscriptions.grace_invoice_id is null
                       and billing_subscriptions.grace_started_at is null
                       and billing_subscriptions.grace_ends_at is null
                       and billing_subscriptions.reconciliation_required = 0
                       and not exists (
                         select 1
                         from billing_subscription_transitions
                         where billing_subscription_transitions.organization_id = billing_subscriptions.organization_id
                           and billing_subscription_transitions.state in (
                             'pending',
                             'action_required',
                             'scheduled',
                             'reconciliation_required'
                           )
                       )
                       and not exists (
                         select 1
                         from billing_checkout_attempts
                         where billing_checkout_attempts.organization_id = billing_subscriptions.organization_id
                           and billing_checkout_attempts.state in ('pending', 'open', 'reconciliation_required')
                       )
                       and not exists (
                         select 1
                         from billing_account_deletion_requests
                         where billing_account_deletion_requests.organization_id = billing_subscriptions.organization_id
                           and billing_account_deletion_requests.state in ('pending', 'reconciliation_required')
                       )
                   )
                 then 1
                 else 0
               end as userRetryAuthorityLost
             from family_join_attempts
           )
           select
             recovery_candidates.id,
             case
               when recovery_candidates.state = 'renewal_stop_pending'
                 or (
                   recovery_candidates.state = 'reconciliation_required'
                   and recovery_candidates.state_reason = 'stripe_renewal_stop_unconfirmed'
                 )
                 or recovery_candidates.userRetryAuthorityLost = 1
               then 1
               else 0
             end as appendAfterExhaustion
           from recovery_candidates
           where (
             (
               recovery_candidates.state = 'renewal_stop_pending'
               or (
                 recovery_candidates.state = 'reconciliation_required'
                 and recovery_candidates.state_reason = 'stripe_renewal_stop_unconfirmed'
               )
             )
             and not exists (
               select 1
               from job_queue
               where job_queue.type = ?
                 and json_valid(job_queue.payload)
                 and json_extract(job_queue.payload, '$.attemptId') = recovery_candidates.id
                 and json_remove(job_queue.payload, '$.attemptId') = '{}'
                 and (
                   job_queue.status = 'running'
                   or (job_queue.status = 'queued' and job_queue.attempts < job_queue.max_attempts)
                 )
             )
           )
           or (
             recovery_candidates.state in ('renewal_off_confirmed', 'membership_pending')
             and not exists (
               select 1
               from job_queue
               where job_queue.type = ?
                 and json_valid(job_queue.payload)
                 and json_extract(job_queue.payload, '$.attemptId') = recovery_candidates.id
                 and json_remove(job_queue.payload, '$.attemptId') = '{}'
             )
           )
           or (
             recovery_candidates.userRetryAuthorityLost = 1
             and not exists (
               select 1
               from job_queue
               where job_queue.type = ?
                 and json_valid(job_queue.payload)
                 and json_extract(job_queue.payload, '$.attemptId') = recovery_candidates.id
                 and json_remove(job_queue.payload, '$.attemptId') = '{}'
                 and (
                   job_queue.status = 'running'
                   or (job_queue.status = 'queued' and job_queue.attempts < job_queue.max_attempts)
                 )
             )
           )
           order by appendAfterExhaustion desc, recovery_candidates.id
           limit ?`
        )
        .all(
          now.getTime(),
          now.toISOString(),
          familyJoinRecoveryJobType,
          familyJoinRecoveryJobType,
          familyJoinRecoveryJobType,
          limit
        ) as Array<{
        id: string
        appendAfterExhaustion: 0 | 1
      }>
      let scheduled = 0
      for (const attempt of attempts) {
        if (insertFamilyJoinRecoveryJob(connection, attempt.id, now, attempt.appendAfterExhaustion === 1)) {
          scheduled += 1
        }
      }
      return scheduled
    })
    .immediate()
}

function readAttemptById(connection: DatabaseConnection, attemptId: string): FamilyJoinAttempt | null {
  return readAttempt(connection, 'family_join_attempts.id = ?', attemptId)
}

function readAttemptByInvitation(connection: DatabaseConnection, invitationId: string): FamilyJoinAttempt | null {
  return readAttempt(connection, 'family_join_attempts.invitation_id = ?', invitationId)
}

function readOpenAttemptByRecipient(connection: DatabaseConnection, recipientUserId: string): FamilyJoinAttempt | null {
  return readAttempt(
    connection,
    `family_join_attempts.recipient_user_id = ?
     and family_join_attempts.state in (
       'pending',
       'renewal_stop_pending',
       'renewal_off_confirmed',
       'membership_pending',
       'reconciliation_required'
     )`,
    recipientUserId
  )
}

function readAttempt(connection: DatabaseConnection, predicate: string, value: string): FamilyJoinAttempt | null {
  const row = connection.sqlite
    .prepare(
      `select
         id,
         recipient_user_id as recipientUserId,
         personal_organization_id as personalOrganizationId,
         personal_billing_subscription_id as personalBillingSubscriptionId,
         captured_personal_billing_revision as capturedPersonalBillingRevision,
         target_organization_id as targetOrganizationId,
         invitation_id as invitationId,
         accepted_member_id as acceptedMemberId,
         stripe_cancellation_idempotency_key as stripeCancellationIdempotencyKey,
         personal_paid_through as personalPaidThrough,
         state,
         state_reason as stateReason,
         revision
       from family_join_attempts
       where ${predicate}
       limit 1`
    )
    .get(value) as FamilyJoinAttempt | undefined
  return row ?? null
}

function assertAttemptCorrelation(
  attempt: FamilyJoinAttempt,
  input: Readonly<{
    invitation: FamilyJoinInvitation
    recipientUserId: string
    subscription: PersonalFamilyJoinSubscription
  }>
): void {
  if (
    attempt.recipientUserId !== input.recipientUserId ||
    attempt.personalOrganizationId !== input.subscription.organizationId ||
    attempt.personalBillingSubscriptionId !== input.subscription.id ||
    attempt.targetOrganizationId !== input.invitation.organizationId ||
    attempt.invitationId !== input.invitation.id ||
    attempt.state === 'failed'
  ) {
    throw new FamilyJoinConflictError('Family join attempt correlation changed')
  }
}

function isPersonalCadence(value: string | null): value is 'weekly' | 'monthly' | 'annual' {
  return value === 'weekly' || value === 'monthly' || value === 'annual'
}
