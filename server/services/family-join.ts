import type Stripe from 'stripe'
import type { DatabaseConnection } from '../db/connect'
import {
  completeFamilyJoinAttempt,
  confirmFamilyJoinRenewalOff,
  createOrResumeFamilyJoinAttempt,
  FamilyJoinConflictError,
  getCompletedFamilyJoinMembership,
  getPendingFamilyJoinInvitation,
  getPersonalFamilyJoinSubscription,
  hasDurableFamilyJoinRenewalOff,
  markFamilyJoinAttemptReconciliation,
  markFamilyJoinMembershipPending,
  type FamilyJoinAttempt,
  type FamilyJoinInvitation,
  type PersonalFamilyJoinSubscription
} from '../db/repositories/family-join'
import {
  assertCanAcceptFamilyInvitation,
  assertFamilyJoinRecipientStructure,
  FamilyAuthorityConflictError,
  FamilyAuthorityInvariantError,
  FamilyManagerBillingConflictError,
  requireCurrentFamilyManagerForOrganization
} from '../db/repositories/family-authority'
import { conflictError, notFoundError, upstreamServiceError } from '../utils/errors'
import type { auth as configuredAuth } from '../utils/auth'

export type FamilyJoinStripeClient = Readonly<{
  subscriptions: Pick<Stripe['subscriptions'], 'retrieve' | 'update'>
}>

type FamilyJoinAuthApi = Pick<typeof configuredAuth.api, 'acceptInvitation'>

export type FamilyJoinServiceContext = Readonly<{
  api: FamilyJoinAuthApi
  connection: DatabaseConnection
  headers: Headers
  stripe: FamilyJoinStripeClient
}>

type PreparedFamilyJoin =
  | Readonly<{ invitation: FamilyJoinInvitation; kind: 'free' }>
  | Readonly<{
      attempt: FamilyJoinAttempt
      invitation: FamilyJoinInvitation
      kind: 'personal'
      subscription: PersonalFamilyJoinSubscription
    }>

export async function joinFamilyFromInvitation(
  context: FamilyJoinServiceContext,
  invitationId: string,
  recipientUserId: string
): Promise<Readonly<{ location: '/app'; status: 'accepted' }>> {
  if (getCompletedFamilyJoinMembership(context.connection, { invitationId, recipientUserId })) {
    return acceptedResult()
  }

  const prepared = prepareFamilyJoin(context.connection, invitationId, recipientUserId)
  if (prepared.kind === 'free') {
    await persistFamilyMembership(context, prepared.invitation, recipientUserId)
    return acceptedResult()
  }

  let attempt = prepared.attempt
  if (!hasDurableFamilyJoinRenewalOff(context.connection, attempt)) {
    attempt = await stopPersonalRenewal(context, attempt, prepared.subscription)
  }

  try {
    await persistFamilyMembership(context, prepared.invitation, recipientUserId, attempt)
  } catch {
    markFamilyJoinAttemptReconciliation(context.connection, attempt.id, 'family_acceptance_requires_user_retry')
    throw conflictError('Personal renewal is off; Family acceptance requires retry')
  }

  return acceptedResult()
}

function prepareFamilyJoin(
  connection: DatabaseConnection,
  invitationId: string,
  recipientUserId: string,
  now = new Date()
): PreparedFamilyJoin {
  const invitation = getPendingFamilyJoinInvitation(connection, { invitationId, recipientUserId, now })
  if (!invitation) throw notFoundError('Invitation not found')

  try {
    requireCurrentFamilyManagerForOrganization(connection, {
      managerUserId: invitation.managerUserId,
      organizationId: invitation.organizationId,
      now
    })
    const structure = assertFamilyJoinRecipientStructure(connection, {
      organizationId: invitation.organizationId,
      userId: recipientUserId,
      now
    })
    const subscription = getPersonalFamilyJoinSubscription(connection, {
      organizationId: structure.personalOrganizationId,
      recipientUserId,
      targetOrganizationId: invitation.organizationId,
      now
    })
    if (!subscription) return { invitation, kind: 'free' }

    const reserved = createOrResumeFamilyJoinAttempt(connection, {
      invitationId,
      recipientUserId,
      now
    })
    return {
      attempt: reserved.attempt,
      invitation,
      kind: 'personal',
      subscription: reserved.subscription
    }
  } catch (error) {
    if (isFamilyAdmissionConflict(error)) {
      throw conflictError('Family invitation cannot be accepted right now')
    }
    throw error
  }
}

async function stopPersonalRenewal(
  context: Pick<FamilyJoinServiceContext, 'connection' | 'stripe'>,
  attempt: FamilyJoinAttempt,
  subscription: PersonalFamilyJoinSubscription
): Promise<FamilyJoinAttempt> {
  try {
    await context.stripe.subscriptions.update(
      subscription.stripeSubscriptionId,
      { cancel_at_period_end: true },
      { idempotencyKey: attempt.stripeCancellationIdempotencyKey }
    )
    const retrieved = await context.stripe.subscriptions.retrieve(subscription.stripeSubscriptionId)
    const confirmed = requireExactFamilyJoinRenewalOffSubscription(retrieved, subscription)
    return confirmFamilyJoinRenewalOff(context.connection, {
      attemptId: attempt.id,
      currentPeriodEnd: confirmed.currentPeriodEnd,
      currentPeriodStart: confirmed.currentPeriodStart
    })
  } catch {
    markFamilyJoinAttemptReconciliation(context.connection, attempt.id, 'stripe_renewal_stop_unconfirmed')
    throw upstreamServiceError(503, 'Personal renewal could not be confirmed')
  }
}

async function persistFamilyMembership(
  context: Pick<FamilyJoinServiceContext, 'api' | 'connection' | 'headers'>,
  invitation: FamilyJoinInvitation,
  recipientUserId: string,
  attempt?: FamilyJoinAttempt
): Promise<void> {
  let pendingAttempt = attempt
  const { sqlite } = context.connection

  // Better Auth shares this synchronous connection, so no transaction may
  // remain open while its async acceptance work runs.
  try {
    pendingAttempt = sqlite
      .transaction(() => {
        const currentInvitation = getPendingFamilyJoinInvitation(context.connection, {
          invitationId: invitation.id,
          recipientUserId
        })
        if (
          !currentInvitation ||
          currentInvitation.organizationId !== invitation.organizationId ||
          currentInvitation.managerUserId !== invitation.managerUserId
        ) {
          throw new FamilyJoinConflictError('Family invitation changed before acceptance')
        }

        requireCurrentFamilyManagerForOrganization(context.connection, {
          managerUserId: invitation.managerUserId,
          organizationId: invitation.organizationId
        })
        if (pendingAttempt) {
          pendingAttempt = markFamilyJoinMembershipPending(context.connection, pendingAttempt.id)
        }
        assertCanAcceptFamilyInvitation(context.connection, {
          invitationId: invitation.id,
          organizationId: invitation.organizationId,
          userId: recipientUserId
        })
        return pendingAttempt
      })
      .immediate()
  } catch (error) {
    if (pendingAttempt) throw error
    throw notFoundError('Invitation not found')
  }

  let providerError: unknown
  try {
    await context.api.acceptInvitation({
      headers: context.headers,
      body: { invitationId: invitation.id }
    })
  } catch (error) {
    providerError = error
  }

  try {
    sqlite
      .transaction(() => {
        const persisted = sqlite
          .prepare(
            `select id
           from member
           where organization_id = ?
             and user_id = ?
             and role = 'member'
           limit 1`
          )
          .get(invitation.organizationId, recipientUserId) as { id: string } | undefined
        if (!persisted) {
          throw providerError ?? new FamilyJoinConflictError('Accepted Family membership is missing')
        }

        const repairedInvitation = sqlite
          .prepare(
            `update invitation
           set status = 'accepted'
           where id = ?
             and organization_id = ?
             and status in ('pending', 'accepted')`
          )
          .run(invitation.id, invitation.organizationId)
        if (repairedInvitation.changes !== 1) {
          throw new FamilyJoinConflictError('Accepted Family invitation could not be reconciled')
        }

        if (pendingAttempt) {
          completeFamilyJoinAttempt(context.connection, {
            attemptId: pendingAttempt.id,
            memberId: persisted.id
          })
        }
      })
      .immediate()
  } catch (error) {
    if (pendingAttempt) throw error
    throw notFoundError('Invitation not found')
  }
}

export function requireExactFamilyJoinRenewalOffSubscription(
  value: Stripe.Subscription,
  expected: PersonalFamilyJoinSubscription,
  now = new Date()
): Readonly<{ currentPeriodEnd: string; currentPeriodStart: string }> {
  const exact = requireExactFamilyJoinSubscription(value, expected)
  if (
    exact.status !== 'active' ||
    exact.cancelAtPeriodEnd !== true ||
    Date.parse(exact.currentPeriodEnd) <= now.getTime()
  ) {
    throw new FamilyJoinConflictError('Stripe Personal renewal-off confirmation did not match')
  }
  return {
    currentPeriodEnd: exact.currentPeriodEnd,
    currentPeriodStart: exact.currentPeriodStart
  }
}

export function requireExactFamilyJoinSubscription(
  value: Stripe.Subscription,
  expected: PersonalFamilyJoinSubscription
): Readonly<{
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: string
  currentPeriodStart: string
  status: Stripe.Subscription.Status
}> {
  const customerId = typeof value.customer === 'string' ? value.customer : value.customer.id
  const item = value.items.data[0]
  if (
    value.id !== expected.stripeSubscriptionId ||
    customerId !== expected.stripeCustomerId ||
    value.items.has_more ||
    value.items.data.length !== 1 ||
    !item ||
    item.id !== expected.stripeSubscriptionItemId ||
    item.price.id !== expected.stripePriceId ||
    item.quantity !== 1 ||
    !Number.isInteger(item.current_period_start) ||
    !Number.isInteger(item.current_period_end) ||
    item.current_period_start <= 0 ||
    item.current_period_end <= item.current_period_start
  ) {
    throw new FamilyJoinConflictError('Stripe Personal subscription confirmation did not match')
  }

  return {
    cancelAtPeriodEnd: value.cancel_at_period_end,
    currentPeriodEnd: new Date(item.current_period_end * 1_000).toISOString(),
    currentPeriodStart: new Date(item.current_period_start * 1_000).toISOString(),
    status: value.status
  }
}

function isFamilyAdmissionConflict(error: unknown): boolean {
  return (
    error instanceof FamilyAuthorityConflictError ||
    error instanceof FamilyAuthorityInvariantError ||
    error instanceof FamilyJoinConflictError ||
    error instanceof FamilyManagerBillingConflictError
  )
}

function acceptedResult() {
  return Object.freeze({
    location: '/app' as const,
    status: 'accepted' as const
  })
}
