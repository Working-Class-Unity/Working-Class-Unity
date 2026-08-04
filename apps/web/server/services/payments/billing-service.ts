import type Stripe from 'stripe'
import {
  billingOfferingDefinitions,
  getBillingOffering,
  isBillingOfferingKey,
  type BillingAccountState,
  type BillingSubscriptionState,
  type BillingTransitionState
} from '../../../shared/billing'
import { familyPlanCapacity } from '../../../shared/family-plan'
import { useDatabase } from '../../db/client'
import type { DatabaseConnection } from '../../db/connect'
import {
  countAcceptedOrganizationMembers,
  countReservedOrganizationInvitations,
  getBillingCustomerById,
  getBillingCustomerForOrganization,
  getBillingSubscriptionForOrganization,
  getOpenBillingTransition,
  getOpenCheckoutAttempt,
  getOwnedBillingOrganization,
  hasVerifiedPersonalFamilyJoinCoverage,
  isBillingDeletionPendingForOrganization,
  listAcceptedOrganizationMembers,
  listMembershipBillingSnapshots
} from '../../db/repositories/billing'
import {
  FamilyAuthorityInvariantError,
  getExternalFamilyMembership,
  hasExternalFamilyMembership
} from '../../db/repositories/family-authority'
import type { ChangeBillingOfferingInput, CreateCheckoutInput } from '../../db/schema/billing.validation'
import type { AppSession } from '../../utils/auth/require-session'
import { conflictError, configurationError, forbiddenError, upstreamServiceError } from '../../utils/errors'
import { requireModuleReady } from '../../utils/module-state'
import { getAppRuntimeConfig, type AppRuntimeConfig } from '../../utils/runtime'
import { ensureBillingCheckout, reconcileBillingCheckoutAttempt } from './billing-checkout'
import { createStripeBillingCatalog } from './billing-catalog'
import { evaluateStripeSubscriptionAccess, type BillingAccessEvaluation } from './billing-dunning'
import { applyManualStripeProjection, billingReconciliationRevision } from './billing-event-store'
import { readCurrentStripeProjection } from './billing-projection'
import { getStripeClient, type StripeBillingClient } from './stripe-client'
import { executeBillingTransition } from './billing-transition'

export type BillingServiceContext = Readonly<{
  connection: DatabaseConnection
  client: StripeBillingClient
  config: AppRuntimeConfig
}>

function createBillingServiceContext(): BillingServiceContext {
  const config = getAppRuntimeConfig()
  requireModuleReady('billing', config)
  return { connection: useDatabase(), client: getStripeClient(config), config }
}

export function getBillingState(session: AppSession): BillingAccountState {
  const config = getAppRuntimeConfig()
  requireModuleReady('billing', config)
  return getBillingStateForConnection(useDatabase(), session.user.id)
}

export function getBillingStateForConnection(
  connection: DatabaseConnection,
  userId: string,
  now = new Date()
): BillingAccountState {
  const owned = getOwnedBillingOrganization(connection, userId)
  if (!owned) throw configurationError('Billing is temporarily unavailable')
  const billingDeletionPending = owned.billingDeletionPending

  const personalCustomer = getBillingCustomerForOrganization(connection, owned.id)
  const personalAttempt = getOpenCheckoutAttempt(connection, owned.id)
  const membershipSnapshots = listMembershipBillingSnapshots(connection, userId)
  const personalMembership = membershipSnapshots.find((snapshot) => snapshot.isPersonal && snapshot.role === 'owner')
  const externalMemberships = membershipSnapshots.filter(
    (snapshot) => !snapshot.isPersonal && snapshot.role === 'member'
  )

  let externalAuthority: ReturnType<typeof getExternalFamilyMembership>
  try {
    externalAuthority = getExternalFamilyMembership(connection, userId)
  } catch (error) {
    if (error instanceof FamilyAuthorityInvariantError) {
      throw configurationError('Billing is temporarily unavailable')
    }
    throw error
  }

  if (
    !personalMembership ||
    externalMemberships.length !== (externalAuthority ? 1 : 0) ||
    (externalAuthority && externalMemberships[0]?.organizationId !== externalAuthority.organizationId)
  ) {
    throw configurationError('Billing is temporarily unavailable')
  }

  const externalMembership = externalMemberships[0] ?? null
  const verifiedPersonalFamilyJoinCoverage = Boolean(
    externalMembership &&
    personalMembership.subscriptionId &&
    personalMembership.planKey === 'personal' &&
    personalMembership.cadence &&
    personalMembership.status === 'active' &&
    personalMembership.cancelAtPeriodEnd &&
    !personalMembership.reconciliationRequired &&
    personalMembership.currentPeriodEnd &&
    hasVerifiedPersonalFamilyJoinCoverage(connection, {
      recipientUserId: userId,
      personalOrganizationId: personalMembership.organizationId,
      personalBillingSubscriptionId: personalMembership.subscriptionId,
      targetOrganizationId: externalMembership.organizationId,
      personalPaidThrough: personalMembership.currentPeriodEnd
    })
  )
  const personalConflict = Boolean(
    externalMembership &&
    (personalAttempt !== null ||
      (snapshotReservesSubscriptionAuthority(personalMembership) && !verifiedPersonalFamilyJoinCoverage))
  )
  const effectiveMembership = externalMembership ?? personalMembership
  const effectiveOrganizationId = effectiveMembership.organizationId
  const effectiveCustomer = externalMembership
    ? getBillingCustomerForOrganization(connection, effectiveOrganizationId)
    : personalCustomer
  const effectiveSnapshot = getBillingSubscriptionForOrganization(connection, effectiveOrganizationId)
  const effectiveAttempt = getOpenCheckoutAttempt(connection, effectiveOrganizationId)
  const offering = offeringForSnapshot(effectiveSnapshot)
  const invalidExternalOffering = Boolean(externalMembership && offering && offering.plan !== 'family')
  const openTransition = getOpenBillingTransition(connection, effectiveOrganizationId)
  const transition = normalizeTransition(openTransition)
  const invalidTransition = Boolean(openTransition && !transition)
  const needsReconciliation =
    personalConflict ||
    invalidExternalOffering ||
    invalidTransition ||
    openTransition?.state === 'reconciliation_required' ||
    effectiveAttempt?.state === 'reconciliation_required' ||
    effectiveSnapshot?.reconciliationRequired === true ||
    Boolean(externalMembership && (!effectiveCustomer || !effectiveSnapshot)) ||
    Boolean(effectiveCustomer && !effectiveSnapshot) ||
    Boolean(
      effectiveSnapshot &&
      effectiveSnapshot.status !== 'none' &&
      (!offering || !effectiveSnapshot.stripeSubscriptionItemId)
    )

  const providerAccess = effectiveSnapshot
    ? evaluateStripeSubscriptionAccess(effectiveSnapshot, now)
    : emptyBillingAccess()
  const access = needsReconciliation ? reconciliationRequiredAccess() : providerAccess
  const acceptedPeople = countAcceptedOrganizationMembers(connection, owned.id)
  const reservedPeople = countReservedOrganizationInvitations(connection, owned.id, now.getTime())
  const isManager =
    !externalMembership &&
    (acceptedPeople > 1 ||
      reservedPeople > 0 ||
      personalAttempt?.planKey === 'family' ||
      effectiveSnapshot?.planKey === 'family')
  const relationship = externalMembership ? 'member' : isManager ? 'manager' : 'independent'
  const isOwner = !externalMembership
  const hasOpenTransition = openTransition !== null
  const checkoutPending = isOwner && (personalAttempt?.state === 'pending' || personalAttempt?.state === 'open')
  const canCheckout =
    isOwner &&
    !billingDeletionPending &&
    !access.granted &&
    isCheckoutEligibleState(access.state) &&
    !effectiveSnapshot?.cancelAtPeriodEnd &&
    !personalAttempt &&
    !hasOpenTransition
  const activeFamilyManager =
    relationship === 'manager' && offering?.plan === 'family' && access.state === 'active' && access.granted
  const familyManagerWithRemovalAuthority =
    relationship === 'manager' &&
    offering?.plan === 'family' &&
    (access.state === 'active' || access.state === 'grace') &&
    access.granted
  const familyInvitationAuthority = activeFamilyManager && !hasOpenTransition
  const familyRemovalAuthority =
    familyManagerWithRemovalAuthority && (!hasOpenTransition || openTransition?.state !== 'reconciliation_required')
  const familyInvitationsEnabled = familyInvitationAuthority && !effectiveSnapshot?.cancelAtPeriodEnd
  const hasSeatCapacity = acceptedPeople + reservedPeople < familyPlanCapacity

  return {
    catalog: billingOfferingDefinitions,
    relationship: { kind: relationship },
    entitlement: {
      granted: Boolean(access.granted && offering),
      source:
        access.granted && offering
          ? externalMembership
            ? 'family'
            : offering.plan === 'family'
              ? 'manager'
              : 'personal'
          : null,
      state: access.state,
      plan: offering?.plan ?? null,
      cadence: offering?.cadence ?? null
    },
    subscription: {
      provider: 'Stripe',
      state: access.state,
      plan: offering?.plan ?? null,
      cadence: offering?.cadence ?? null,
      currentPeriodEnd: effectiveSnapshot?.currentPeriodEnd ?? null,
      renewalEnabled: Boolean(
        effectiveSnapshot &&
        (access.state === 'active' || access.state === 'grace') &&
        !effectiveSnapshot.cancelAtPeriodEnd
      ),
      graceDeadline: access.graceDeadline,
      checkoutPending
    },
    transition,
    seats:
      relationship === 'manager'
        ? {
            accepted: acceptedPeople,
            reserved: reservedPeople,
            capacity: familyPlanCapacity
          }
        : null,
    members: relationship === 'manager' ? listAcceptedOrganizationMembers(connection, owned.id) : null,
    capabilities: {
      canCheckout,
      canChange:
        isOwner &&
        !billingDeletionPending &&
        access.state === 'active' &&
        access.granted &&
        offering !== null &&
        !effectiveSnapshot?.cancelAtPeriodEnd &&
        !personalAttempt &&
        !hasOpenTransition,
      canManage:
        isOwner && !billingDeletionPending && personalCustomer !== null && access.state !== 'reconciliation_required',
      canReconcile: isOwner && (personalCustomer !== null || personalAttempt !== null),
      canLeaveFamily: relationship === 'member',
      canCreateFamilyInvitation: familyInvitationsEnabled && hasSeatCapacity,
      canResendFamilyInvitation: familyInvitationsEnabled && reservedPeople > 0,
      canAcceptFamilyInvitation: false,
      canAddFamilyMember: familyInvitationsEnabled && hasSeatCapacity,
      canRemoveFamilyMember: familyRemovalAuthority && acceptedPeople > 1
    }
  }
}

export async function createBillingCheckout(session: AppSession, input: CreateCheckoutInput) {
  return createBillingCheckoutForConnection(createBillingServiceContext(), session.user.id, input)
}

export async function createBillingCheckoutForConnection(
  context: BillingServiceContext,
  userId: string,
  input: CreateCheckoutInput,
  now = new Date()
) {
  requireModuleReady('billing', context.config)
  if (!isBillingOfferingKey(input.offering)) throw forbiddenError('Unsupported billing offering')

  if (hasExternalFamilyMembership(context.connection, userId)) {
    throw forbiddenError('Family members cannot create personal billing authority')
  }
  const owned = requirePersistedOwner(context.connection, userId)
  if (owned.billingDeletionPending) {
    throw conflictError('Billing is locked while account deletion is pending')
  }
  const offering = getBillingOffering(input.offering)!
  const openAttempt = getOpenCheckoutAttempt(context.connection, owned.id)
  const state = getBillingStateForConnection(context.connection, userId, now)
  const isAuthorizedRetry =
    (openAttempt?.state === 'pending' || openAttempt?.state === 'open') &&
    openAttempt.planKey === offering.plan &&
    openAttempt.cadence === offering.cadence
  if (!state.capabilities.canCheckout && !isAuthorizedRetry) {
    throw conflictError('The current billing account must be managed or reconciled')
  }

  if (offering.plan === 'personal' && state.seats && (state.seats.accepted > 1 || state.seats.reserved > 0)) {
    throw conflictError('Family seats must be cleared before choosing a Personal offering')
  }

  const customer = getBillingCustomerForOrganization(context.connection, owned.id)
  return ensureBillingCheckout(context, userId, owned.id, customer, input.offering, now)
}

export async function changeBillingOffering(session: AppSession, input: ChangeBillingOfferingInput) {
  return changeBillingOfferingForConnection(createBillingServiceContext(), session.user.id, input)
}

export async function changeBillingOfferingForConnection(
  context: BillingServiceContext,
  userId: string,
  input: ChangeBillingOfferingInput,
  now = new Date()
): Promise<BillingAccountState> {
  requireModuleReady('billing', context.config)
  if (!isBillingOfferingKey(input.offering)) throw forbiddenError('Unsupported billing offering')
  await executeBillingTransition(context, userId, input.offering, now)
  return getBillingStateForConnection(context.connection, userId, now)
}

export async function createBillingPortal(session: AppSession) {
  return createBillingPortalForConnection(createBillingServiceContext(), session.user.id)
}

export async function createBillingPortalForConnection(context: BillingServiceContext, userId: string) {
  requireModuleReady('billing', context.config)
  if (hasExternalFamilyMembership(context.connection, userId)) {
    throw forbiddenError('Only the billing owner can manage billing')
  }
  const owned = requirePersistedOwner(context.connection, userId)
  if (owned.billingDeletionPending) {
    throw conflictError('Billing is locked while account deletion is pending')
  }
  const customer = getBillingCustomerForOrganization(context.connection, owned.id)
  if (!customer) throw conflictError('No manageable billing account exists')

  let portal: Stripe.BillingPortal.Session
  try {
    portal = await context.client.billingPortal.sessions.create({
      customer: customer.stripeCustomerId,
      configuration: context.config.stripe.portalConfigurationId,
      return_url: `${trimSlash(context.config.public.appUrl)}/account/billing`
    })
  } catch {
    throw upstreamServiceError(502, 'Stripe billing management is temporarily unavailable')
  }

  if (!isHttpsUrl(portal.url) || !stillOwnsCustomer(context.connection, userId, owned.id, customer.id)) {
    throw forbiddenError('Billing authority changed during Portal creation')
  }
  return { url: portal.url }
}

export async function reconcileBilling(session: AppSession) {
  return reconcileBillingForConnection(createBillingServiceContext(), session.user.id)
}

export async function reconcileBillingForConnection(
  context: BillingServiceContext,
  userId: string,
  now = new Date()
): Promise<BillingAccountState> {
  requireModuleReady('billing', context.config)
  if (hasExternalFamilyMembership(context.connection, userId)) {
    throw forbiddenError('Only the billing owner can reconcile billing')
  }
  const owned = requirePersistedOwner(context.connection, userId)
  let customer = getBillingCustomerForOrganization(context.connection, owned.id)
  const attempt = getOpenCheckoutAttempt(context.connection, owned.id)
  if (getOpenBillingTransition(context.connection, owned.id)) {
    throw conflictError('Billing transition state must be resolved before reconciliation')
  }

  if (attempt) {
    const attemptResult = await reconcileBillingCheckoutAttempt(context, userId, attempt, now)
    if (attemptResult.blocked) {
      throw conflictError('Checkout state still requires reconciliation')
    }
    customer = attemptResult.customer ?? getBillingCustomerForOrganization(context.connection, owned.id)
  }

  if (!customer) return getBillingStateForConnection(context.connection, userId, now)

  const expectedSubscriptionId =
    getBillingSubscriptionForOrganization(context.connection, owned.id)?.stripeSubscriptionId ?? null
  const expectedRevision = billingReconciliationRevision(context.connection, userId)
  let projection
  try {
    projection = await readCurrentStripeProjection(
      context.client,
      customer.stripeCustomerId,
      createStripeBillingCatalog(context.config.stripe),
      undefined,
      expectedSubscriptionId
    )
  } catch {
    throw upstreamServiceError(502, 'Stripe billing state is temporarily unavailable')
  }

  const applied = applyManualStripeProjection(context.connection, {
    userId,
    stripeCustomerId: customer.stripeCustomerId,
    expectedRevision,
    projection
  })
  if (!applied) throw conflictError('Billing state changed; retry reconciliation')
  return getBillingStateForConnection(context.connection, userId, now)
}

function requirePersistedOwner(connection: DatabaseConnection, userId: string) {
  const owner = getOwnedBillingOrganization(connection, userId)
  if (!owner) throw forbiddenError('Billing management requires the current owner')
  return owner
}

function stillOwnsCustomer(
  connection: DatabaseConnection,
  userId: string,
  organizationId: string,
  billingCustomerId: string
) {
  return connection.sqlite
    .transaction(() => {
      const owner = getOwnedBillingOrganization(connection, userId)
      const customer = getBillingCustomerById(connection, billingCustomerId)
      return (
        !hasExternalFamilyMembership(connection, userId) &&
        owner?.id === organizationId &&
        !isBillingDeletionPendingForOrganization(connection, organizationId) &&
        customer?.organizationId === organizationId
      )
    })
    .immediate()
}

function offeringForSnapshot(snapshot: ReturnType<typeof getBillingSubscriptionForOrganization>) {
  if (!snapshot?.planKey || !snapshot.cadence) return null
  return getBillingOffering(`${snapshot.planKey}.${snapshot.cadence}`)
}

function normalizeTransition(
  transition: ReturnType<typeof getOpenBillingTransition>
): BillingAccountState['transition'] {
  if (!transition) return null
  const targetOffering = `${transition.targetPlanKey}.${transition.targetCadence}`
  if (!isBillingOfferingKey(targetOffering) || !isOpenTransitionState(transition.state)) return null
  return {
    kind: transition.kind,
    targetOffering,
    effectiveAt: transition.effectiveAt,
    state: transition.state
  }
}

function isOpenTransitionState(value: string): value is BillingTransitionState {
  return ['pending', 'action_required', 'scheduled', 'reconciliation_required'].includes(value)
}

function snapshotReservesSubscriptionAuthority(
  snapshot: ReturnType<typeof listMembershipBillingSnapshots>[number]
): boolean {
  return (
    snapshot.reconciliationRequired ||
    snapshot.cancelAtPeriodEnd ||
    (snapshot.status !== null && !['none', 'canceled', 'incomplete_expired'].includes(snapshot.status))
  )
}

function isCheckoutEligibleState(state: BillingSubscriptionState): boolean {
  return state === 'none' || state === 'terminal'
}

function emptyBillingAccess(): BillingAccessEvaluation {
  return {
    state: 'none',
    granted: false,
    graceDeadline: null,
    reconciliationReason: null
  }
}

function reconciliationRequiredAccess(): BillingAccessEvaluation {
  return {
    state: 'reconciliation_required',
    granted: false,
    graceDeadline: null,
    reconciliationReason: 'local_billing_authority_ambiguous'
  }
}

function trimSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
