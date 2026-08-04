import { z } from 'zod'
import type { DatabaseConnection } from '../../db/connect'
import {
  confirmFamilyJoinRenewalOff,
  failFamilyJoinAttempt,
  familyJoinRecoveryJobType,
  getFamilyJoinAttempt,
  getFamilyJoinSettlementSubscription,
  getPendingFamilyJoinInvitation,
  getPersonalFamilyJoinSubscription,
  hasDurableFamilyJoinRenewalOff,
  markFamilyJoinAttemptReconciliation,
  reconcileExistingFamilyJoinMembership,
  type FamilyJoinAttempt,
  type PersonalFamilyJoinSubscription
} from '../../db/repositories/family-join'
import { requireCurrentFamilyManagerForOrganization } from '../../db/repositories/family-authority'
import type { JsonValue } from '../../db/schema'
import {
  requireExactFamilyJoinRenewalOffSubscription,
  requireExactFamilyJoinSubscription,
  type FamilyJoinStripeClient
} from '../family-join'
import type { JobHandler } from './job-queue'

const familyJoinRecoveryPayloadSchema = z
  .object({
    attemptId: z
      .string()
      .min(1)
      .max(255)
      .refine((value) => value === value.trim())
  })
  .strict()

export type FamilyJoinRecoveryStripeClientFactory = () => FamilyJoinStripeClient

export type FamilyJoinRecoveryContext = Readonly<{
  connection: DatabaseConnection
  getStripeClient: FamilyJoinRecoveryStripeClientFactory
  now?: () => Date
}>

export type FamilyJoinRecoveryResult = 'already_completed' | 'completed' | 'not_recoverable' | 'user_retry_required'

export function createFamilyJoinRecoveryJobHandler(context: FamilyJoinRecoveryContext): JobHandler {
  return async (payload: JsonValue) => {
    const parsed = familyJoinRecoveryPayloadSchema.safeParse(payload)
    if (!parsed.success) throw new Error('Invalid Family join recovery job payload')
    await recoverFamilyJoinAttempt(context, parsed.data.attemptId)
  }
}

export function createFamilyJoinRecoveryJobHandlers(
  context: FamilyJoinRecoveryContext
): Record<typeof familyJoinRecoveryJobType, JobHandler> {
  return {
    [familyJoinRecoveryJobType]: createFamilyJoinRecoveryJobHandler(context)
  }
}

/**
 * Recovery may confirm the already-authorized Stripe renewal-off mutation, but
 * it never creates a member or calls Better Auth with an impersonated session.
 * Completion only reconciles bookkeeping after Better Auth's exact accepted
 * invitation and member rows are both durable.
 */
export async function recoverFamilyJoinAttempt(
  context: FamilyJoinRecoveryContext,
  attemptId: string
): Promise<FamilyJoinRecoveryResult> {
  const now = context.now?.() ?? new Date()
  let attempt = getFamilyJoinAttempt(context.connection, attemptId)
  if (!attempt || attempt.state === 'failed') return 'not_recoverable'
  if (attempt.state === 'completed') return 'already_completed'

  if (hasDurableFamilyJoinRenewalOff(context.connection, attempt)) {
    const reconciled = reconcileExistingFamilyJoinMembership(context.connection, attempt.id, now)
    if (reconciled === 'completed' || reconciled === 'already_completed') return reconciled

    const authorityLossReason = getFamilyJoinAuthorityLossReason(context.connection, attempt, now)
    if (authorityLossReason) {
      failFamilyJoinAttempt(context.connection, attempt.id, authorityLossReason, now)
      return 'not_recoverable'
    }
    if (reconciled === 'renewal_confirmation_required') {
      markFamilyJoinAttemptReconciliation(context.connection, attempt.id, 'stripe_renewal_stop_unconfirmed', now)
      throw new Error('Family join renewal-off confirmation is not durable')
    }
    return 'user_retry_required'
  }

  const authorityLossReason = getFamilyJoinAuthorityLossReason(context.connection, attempt, now)
  if (authorityLossReason) {
    const subscription = getFamilyJoinSettlementSubscription(context.connection, attempt)
    if (!subscription) {
      markFamilyJoinAttemptReconciliation(context.connection, attempt.id, 'stripe_renewal_stop_unconfirmed', now)
      throw new Error('Family join renewal-off confirmation failed')
    }
    await settleAuthorityLostFamilyJoin(context, attempt, subscription, authorityLossReason, now)
    return 'not_recoverable'
  }

  const preparation = prepareFamilyJoinRenewalRecovery(context.connection, attempt, now)
  if (!preparation) return 'user_retry_required'
  attempt = await confirmPersonalRenewalOff(context, preparation.attempt, preparation.subscription, now)

  const reconciled = reconcileExistingFamilyJoinMembership(context.connection, attempt.id, now)
  if (reconciled === 'completed' || reconciled === 'already_completed') return reconciled
  if (reconciled === 'renewal_confirmation_required') {
    markFamilyJoinAttemptReconciliation(context.connection, attempt.id, 'stripe_renewal_stop_unconfirmed', now)
    throw new Error('Family join renewal-off confirmation is not durable')
  }
  return 'user_retry_required'
}

function getFamilyJoinAuthorityLossReason(
  connection: DatabaseConnection,
  attempt: FamilyJoinAttempt,
  now: Date
): 'family_authority_changed' | 'family_invitation_unavailable' | null {
  if (!attempt.invitationId || !attempt.targetOrganizationId) {
    return 'family_invitation_unavailable'
  }
  const invitation = getPendingFamilyJoinInvitation(connection, {
    invitationId: attempt.invitationId,
    recipientUserId: attempt.recipientUserId,
    now
  })
  if (!invitation || invitation.organizationId !== attempt.targetOrganizationId) {
    return 'family_invitation_unavailable'
  }

  try {
    requireCurrentFamilyManagerForOrganization(connection, {
      managerUserId: invitation.managerUserId,
      organizationId: invitation.organizationId,
      now
    })
    return null
  } catch {
    return 'family_authority_changed'
  }
}

function prepareFamilyJoinRenewalRecovery(
  connection: DatabaseConnection,
  attempt: FamilyJoinAttempt,
  now: Date
): Readonly<{
  attempt: FamilyJoinAttempt
  subscription: PersonalFamilyJoinSubscription
}> | null {
  if (!attempt.invitationId || !attempt.targetOrganizationId) {
    markFamilyJoinAttemptReconciliation(connection, attempt.id, 'family_invitation_unavailable', now)
    return null
  }
  const invitation = getPendingFamilyJoinInvitation(connection, {
    invitationId: attempt.invitationId,
    recipientUserId: attempt.recipientUserId,
    now
  })
  if (!invitation || invitation.organizationId !== attempt.targetOrganizationId) {
    markFamilyJoinAttemptReconciliation(connection, attempt.id, 'family_invitation_unavailable', now)
    return null
  }

  try {
    requireCurrentFamilyManagerForOrganization(connection, {
      managerUserId: invitation.managerUserId,
      organizationId: invitation.organizationId,
      now
    })
  } catch {
    markFamilyJoinAttemptReconciliation(connection, attempt.id, 'family_authority_changed', now)
    return null
  }

  const subscription = getCapturedFamilyJoinSubscription(connection, attempt, now)
  if (!subscription) return null
  return { attempt, subscription }
}

function getCapturedFamilyJoinSubscription(
  connection: DatabaseConnection,
  attempt: FamilyJoinAttempt,
  now: Date
): PersonalFamilyJoinSubscription | null {
  if (!attempt.targetOrganizationId) {
    markFamilyJoinAttemptReconciliation(connection, attempt.id, 'family_invitation_unavailable', now)
    return null
  }

  let subscription: PersonalFamilyJoinSubscription | null
  try {
    subscription = getPersonalFamilyJoinSubscription(connection, {
      organizationId: attempt.personalOrganizationId,
      recipientUserId: attempt.recipientUserId,
      targetOrganizationId: attempt.targetOrganizationId,
      now
    })
  } catch {
    markFamilyJoinAttemptReconciliation(connection, attempt.id, 'personal_subscription_changed', now)
    return null
  }
  const capturedOrAlreadyOff =
    subscription?.revision === attempt.capturedPersonalBillingRevision || subscription?.cancelAtPeriodEnd === true
  if (
    !subscription ||
    !capturedOrAlreadyOff ||
    subscription.id !== attempt.personalBillingSubscriptionId ||
    subscription.organizationId !== attempt.personalOrganizationId
  ) {
    markFamilyJoinAttemptReconciliation(connection, attempt.id, 'personal_subscription_changed', now)
    return null
  }
  return subscription
}

async function settleAuthorityLostFamilyJoin(
  context: FamilyJoinRecoveryContext,
  attempt: FamilyJoinAttempt,
  subscription: PersonalFamilyJoinSubscription,
  reason: 'family_authority_changed' | 'family_invitation_unavailable',
  now: Date
): Promise<void> {
  try {
    const stripe = context.getStripeClient()
    const retrieved = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId)
    const exact = requireExactFamilyJoinSubscription(retrieved, subscription)
    if (exact.status === 'active' && exact.cancelAtPeriodEnd && Date.parse(exact.currentPeriodEnd) > now.getTime()) {
      confirmFamilyJoinRenewalOff(context.connection, {
        allowRevisionDrift: true,
        attemptId: attempt.id,
        currentPeriodEnd: exact.currentPeriodEnd,
        currentPeriodStart: exact.currentPeriodStart,
        now
      })
    }
    failFamilyJoinAttempt(context.connection, attempt.id, reason, now)
  } catch {
    markFamilyJoinAttemptReconciliation(context.connection, attempt.id, 'stripe_renewal_stop_unconfirmed', now)
    throw new Error('Family join renewal-off confirmation failed')
  }
}

async function confirmPersonalRenewalOff(
  context: FamilyJoinRecoveryContext,
  attempt: FamilyJoinAttempt,
  subscription: PersonalFamilyJoinSubscription,
  now: Date
): Promise<FamilyJoinAttempt> {
  try {
    const stripe = context.getStripeClient()
    await stripe.subscriptions.update(
      subscription.stripeSubscriptionId,
      { cancel_at_period_end: true },
      { idempotencyKey: attempt.stripeCancellationIdempotencyKey }
    )
    const retrieved = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId)
    const confirmed = requireExactFamilyJoinRenewalOffSubscription(retrieved, subscription, now)
    return confirmFamilyJoinRenewalOff(context.connection, {
      attemptId: attempt.id,
      currentPeriodEnd: confirmed.currentPeriodEnd,
      currentPeriodStart: confirmed.currentPeriodStart,
      now
    })
  } catch {
    markFamilyJoinAttemptReconciliation(context.connection, attempt.id, 'stripe_renewal_stop_unconfirmed', now)
    throw new Error('Family join renewal-off confirmation failed')
  }
}
