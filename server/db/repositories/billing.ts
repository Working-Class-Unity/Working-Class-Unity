import { and, asc, eq, inArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { BillingCadence, BillingPlan } from '../../../shared/billing'
import type { DatabaseConnection } from '../connect'
import {
  billingCheckoutAttempts,
  billingCustomers,
  billingEvents,
  billingSubscriptions,
  billingSubscriptionTransitions,
  detachedBillingSubjects,
  familyJoinAttempts,
  member,
  organization,
  user,
  type BillingCheckoutAttempt,
  type BillingCustomer,
  type BillingEvent,
  type BillingSubscription,
  type BillingSubscriptionTransition,
  type DetachedBillingSubject
} from '../schema'
import { hasExternalFamilyMembership } from './family-authority'
import { frozenFamilyInvitationReservationSql } from './family-invitation-reservation'

const openAttemptStates = ['pending', 'open', 'reconciliation_required'] as const

export type OwnedBillingOrganization = Readonly<{
  id: string
  role: 'owner'
  billingDeletionPending: boolean
}>

export type MembershipBillingSnapshot = Readonly<{
  subscriptionId: string | null
  organizationId: string
  isPersonal: boolean
  role: 'owner' | 'member'
  status: BillingSubscription['status'] | null
  planKey: BillingPlan | null
  cadence: BillingCadence | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  graceInvoiceId: string | null
  graceStartedAt: string | null
  graceEndsAt: string | null
  reconciliationRequired: boolean
  checkoutPending: boolean
  checkoutReconciliationRequired: boolean
}>

export type BillingMemberSummary = Readonly<{
  reference: string
  name: string
  email: string
}>

export function getOwnedBillingOrganization(
  connection: DatabaseConnection,
  userId: string
): OwnedBillingOrganization | null {
  const result = connection.db
    .select({
      id: organization.id,
      role: member.role,
      billingDeletionPending: organization.billingDeletionPending
    })
    .from(organization)
    .innerJoin(
      member,
      and(eq(member.organizationId, organization.id), eq(member.userId, userId), eq(member.role, 'owner'))
    )
    .where(eq(organization.personalOwnerUserId, userId))
    .get()

  return result?.role === 'owner'
    ? {
        id: result.id,
        role: result.role,
        billingDeletionPending: result.billingDeletionPending
      }
    : null
}

export function isBillingDeletionPendingForOrganization(
  connection: DatabaseConnection,
  organizationId: string
): boolean {
  return (
    connection.db
      .select({ pending: organization.billingDeletionPending })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .get()?.pending === true
  )
}

export function getBillingCustomerForOrganization(
  connection: DatabaseConnection,
  organizationId: string
): BillingCustomer | null {
  return (
    connection.db.select().from(billingCustomers).where(eq(billingCustomers.organizationId, organizationId)).get() ??
    null
  )
}

export function getBillingCustomerByStripeId(
  connection: DatabaseConnection,
  stripeCustomerId: string
): BillingCustomer | null {
  return (
    connection.db
      .select()
      .from(billingCustomers)
      .where(eq(billingCustomers.stripeCustomerId, stripeCustomerId))
      .get() ?? null
  )
}

export function getBillingCustomerById(
  connection: DatabaseConnection,
  billingCustomerId: string
): BillingCustomer | null {
  return connection.db.select().from(billingCustomers).where(eq(billingCustomers.id, billingCustomerId)).get() ?? null
}

export function getBillingSubscriptionForOrganization(
  connection: DatabaseConnection,
  organizationId: string
): BillingSubscription | null {
  return (
    connection.db
      .select()
      .from(billingSubscriptions)
      .where(eq(billingSubscriptions.organizationId, organizationId))
      .get() ?? null
  )
}

export function listMembershipBillingSnapshots(
  connection: DatabaseConnection,
  userId: string
): MembershipBillingSnapshot[] {
  return connection.db
    .select({
      subscriptionId: billingSubscriptions.id,
      organizationId: organization.id,
      personalOwnerUserId: organization.personalOwnerUserId,
      role: member.role,
      status: billingSubscriptions.status,
      planKey: billingSubscriptions.planKey,
      cadence: billingSubscriptions.cadence,
      currentPeriodEnd: billingSubscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: billingSubscriptions.cancelAtPeriodEnd,
      graceInvoiceId: billingSubscriptions.graceInvoiceId,
      graceStartedAt: billingSubscriptions.graceStartedAt,
      graceEndsAt: billingSubscriptions.graceEndsAt,
      reconciliationRequired: billingSubscriptions.reconciliationRequired,
      checkoutState: billingCheckoutAttempts.state
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .leftJoin(billingSubscriptions, eq(billingSubscriptions.organizationId, organization.id))
    .leftJoin(
      billingCheckoutAttempts,
      and(
        eq(billingCheckoutAttempts.organizationId, organization.id),
        inArray(billingCheckoutAttempts.state, [...openAttemptStates])
      )
    )
    .where(eq(member.userId, userId))
    .orderBy(asc(organization.id))
    .all()
    .map(({ personalOwnerUserId, checkoutState, cancelAtPeriodEnd, reconciliationRequired, ...snapshot }) => ({
      ...snapshot,
      cancelAtPeriodEnd: Boolean(cancelAtPeriodEnd),
      reconciliationRequired: Boolean(reconciliationRequired),
      checkoutPending: checkoutState === 'pending' || checkoutState === 'open',
      checkoutReconciliationRequired: checkoutState === 'reconciliation_required',
      isPersonal: personalOwnerUserId === userId
    }))
}

export function hasVerifiedPersonalFamilyJoinCoverage(
  connection: DatabaseConnection,
  input: Readonly<{
    recipientUserId: string
    personalOrganizationId: string
    personalBillingSubscriptionId: string
    targetOrganizationId: string
    personalPaidThrough: string
  }>
): boolean {
  return Boolean(
    connection.db
      .select({ id: familyJoinAttempts.id })
      .from(familyJoinAttempts)
      .where(
        and(
          eq(familyJoinAttempts.recipientUserId, input.recipientUserId),
          eq(familyJoinAttempts.personalOrganizationId, input.personalOrganizationId),
          eq(familyJoinAttempts.personalBillingSubscriptionId, input.personalBillingSubscriptionId),
          eq(familyJoinAttempts.targetOrganizationId, input.targetOrganizationId),
          eq(familyJoinAttempts.personalPaidThrough, input.personalPaidThrough),
          inArray(familyJoinAttempts.state, ['renewal_off_confirmed', 'membership_pending', 'completed'])
        )
      )
      .get()
  )
}

export function countAcceptedOrganizationMembers(connection: DatabaseConnection, organizationId: string): number {
  const row = connection.sqlite
    .prepare('select count(*) as count from member where organization_id = ?')
    .get(organizationId) as { count: number }
  return row.count
}

export function countReservedOrganizationInvitations(
  connection: DatabaseConnection,
  organizationId: string,
  now = Date.now()
): number {
  const row = connection.sqlite
    .prepare(
      `select count(*) as count
       from invitation
       where organization_id = ?
         and status = 'pending'
         and (expires_at > ? or ${frozenFamilyInvitationReservationSql})`
    )
    .get(organizationId, now, new Date(now).toISOString()) as { count: number }
  return row.count
}

export function listAcceptedOrganizationMembers(
  connection: DatabaseConnection,
  organizationId: string
): BillingMemberSummary[] {
  return connection.db
    .select({
      reference: member.id,
      name: user.name,
      email: user.email
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, organizationId), eq(member.role, 'member')))
    .orderBy(asc(member.id))
    .all()
}

export function getOpenBillingTransition(
  connection: DatabaseConnection,
  organizationId: string
): BillingSubscriptionTransition | null {
  return (
    connection.db
      .select()
      .from(billingSubscriptionTransitions)
      .where(
        and(
          eq(billingSubscriptionTransitions.organizationId, organizationId),
          inArray(billingSubscriptionTransitions.state, [
            'pending',
            'action_required',
            'scheduled',
            'reconciliation_required'
          ])
        )
      )
      .get() ?? null
  )
}

export function getBillingTransitionById(
  connection: DatabaseConnection,
  transitionId: string
): BillingSubscriptionTransition | null {
  return (
    connection.db
      .select()
      .from(billingSubscriptionTransitions)
      .where(eq(billingSubscriptionTransitions.id, transitionId))
      .get() ?? null
  )
}

export function getOpenCheckoutAttempt(
  connection: DatabaseConnection,
  organizationId: string
): BillingCheckoutAttempt | null {
  return (
    connection.db
      .select()
      .from(billingCheckoutAttempts)
      .where(
        and(
          eq(billingCheckoutAttempts.organizationId, organizationId),
          inArray(billingCheckoutAttempts.state, [...openAttemptStates])
        )
      )
      .get() ?? null
  )
}

export function getCheckoutAttemptById(
  connection: DatabaseConnection,
  attemptId: string
): BillingCheckoutAttempt | null {
  return (
    connection.db.select().from(billingCheckoutAttempts).where(eq(billingCheckoutAttempts.id, attemptId)).get() ?? null
  )
}

export function createOrReuseCheckoutAttempt(
  connection: DatabaseConnection,
  input: Readonly<{
    userId: string
    organizationId: string
    billingCustomerId: string | null
    planKey: BillingPlan
    cadence: BillingCadence
    stripePriceId: string
    successUrl: string
    cancelUrl: string
    now: Date
    reuseUntil: Date
  }>
): BillingCheckoutAttempt | null {
  return connection.sqlite
    .transaction(() => {
      if (hasExternalFamilyMembership(connection, input.userId)) return null
      if (isBillingDeletionPendingForOrganization(connection, input.organizationId)) return null
      const existing = getOpenCheckoutAttempt(connection, input.organizationId)
      if (existing) return existing

      const now = input.now.toISOString()
      const [attempt] = connection.db
        .insert(billingCheckoutAttempts)
        .values({
          id: `billing_attempt_${randomUUID()}`,
          organizationId: input.organizationId,
          billingCustomerId: input.billingCustomerId,
          planKey: input.planKey,
          cadence: input.cadence,
          stripePriceId: input.stripePriceId,
          idempotencyKey: `checkout_${randomUUID()}`,
          state: 'pending',
          successUrl: input.successUrl,
          cancelUrl: input.cancelUrl,
          reuseUntil: input.reuseUntil.toISOString(),
          createdAt: now,
          updatedAt: now
        })
        .returning()
        .all()

      if (!attempt) throw new Error('Failed to create billing Checkout attempt')
      return attempt
    })
    .immediate()
}

export function updateCheckoutAttempt(
  connection: DatabaseConnection,
  attemptId: string,
  input: Partial<Pick<BillingCheckoutAttempt, 'billingCustomerId' | 'stripeSessionId' | 'state'>> & {
    updatedAt?: string
  }
): BillingCheckoutAttempt | null {
  const [updated] = connection.db
    .update(billingCheckoutAttempts)
    .set({ ...input, updatedAt: input.updatedAt ?? new Date().toISOString() })
    .where(eq(billingCheckoutAttempts.id, attemptId))
    .returning()
    .all()
  return updated ?? null
}

export function getBillingEventByStripeId(connection: DatabaseConnection, stripeEventId: string): BillingEvent | null {
  return connection.db.select().from(billingEvents).where(eq(billingEvents.stripeEventId, stripeEventId)).get() ?? null
}

export function getDetachedStripeBillingSubject(
  connection: DatabaseConnection,
  input: Readonly<{
    providerReference?: string | null
    stripeCustomerId?: string | null
  }>
): DetachedBillingSubject | null {
  if (input.providerReference) {
    return (
      connection.db
        .select()
        .from(detachedBillingSubjects)
        .where(
          and(
            eq(detachedBillingSubjects.provider, 'stripe'),
            eq(detachedBillingSubjects.providerReference, input.providerReference)
          )
        )
        .get() ?? null
    )
  }

  if (!input.stripeCustomerId) return null
  const matches = connection.db
    .select()
    .from(detachedBillingSubjects)
    .where(
      and(
        eq(detachedBillingSubjects.provider, 'stripe'),
        eq(detachedBillingSubjects.providerCustomerReference, input.stripeCustomerId)
      )
    )
    .limit(2)
    .all()

  return matches.length === 1 ? matches[0]! : null
}

export function listDetachedStripeBillingSubjectsForCustomer(
  connection: DatabaseConnection,
  stripeCustomerId: string
): DetachedBillingSubject[] {
  return connection.db
    .select()
    .from(detachedBillingSubjects)
    .where(
      and(
        eq(detachedBillingSubjects.provider, 'stripe'),
        eq(detachedBillingSubjects.providerCustomerReference, stripeCustomerId)
      )
    )
    .all()
}
