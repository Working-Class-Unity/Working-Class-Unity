import type { DatabaseConnection } from '../connect'

export type ExternalFamilyMembership = Readonly<{
  id: string
  organizationId: string
  managerUserId: string
  role: 'member'
}>

export type FamilyAuthorityConflictReason =
  'accepted_personal_member' | 'current_personal_billing' | 'external_membership' | 'unresolved_personal_invitation'

export class FamilyAuthorityConflictError extends Error {
  readonly reason: FamilyAuthorityConflictReason

  constructor(reason: FamilyAuthorityConflictReason) {
    super(`Family authority conflict: ${reason}`)
    this.name = 'FamilyAuthorityConflictError'
    this.reason = reason
  }
}

export class FamilyAuthorityInvariantError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FamilyAuthorityInvariantError'
  }
}

export class FamilyManagerBillingConflictError extends Error {
  constructor() {
    super('Family manager billing is not current')
    this.name = 'FamilyManagerBillingConflictError'
  }
}

export type CurrentFamilyManagerAuthority = Readonly<{
  billingRevision: number
  billingSubscriptionId: string
  managerUserId: string
  organizationId: string
}>

/**
 * Resolves the single family membership whose personal owner is another user.
 * The personal organization deliberately remains present and is not returned.
 */
export function getExternalFamilyMembership(
  connection: DatabaseConnection,
  userId: string
): ExternalFamilyMembership | null {
  const rows = connection.sqlite
    .prepare(
      `select
         member.id,
         member.organization_id as organizationId,
         member.role,
         organization.personal_owner_user_id as managerUserId
       from member
       inner join organization on organization.id = member.organization_id
       where member.user_id = ?
         and member.role = 'member'
         and (
           organization.personal_owner_user_id is null
           or organization.personal_owner_user_id <> ?
         )
       order by organization.id
       limit 2`
    )
    .all(userId, userId) as Array<{
    id: string
    organizationId: string
    managerUserId: string | null
    role: string
  }>

  if (rows.length === 0) return null
  if (rows.length > 1) throw new FamilyAuthorityInvariantError('User belongs to more than one external family')

  const membership = rows[0]!
  if (!membership.managerUserId) {
    throw new FamilyAuthorityInvariantError('External family membership is malformed')
  }

  return {
    id: membership.id,
    organizationId: membership.organizationId,
    managerUserId: membership.managerUserId,
    role: 'member'
  }
}

export function hasExternalFamilyMembership(connection: DatabaseConnection, userId: string): boolean {
  return getExternalFamilyMembership(connection, userId) !== null
}

export function assertCanOperatePersonalFamily(connection: DatabaseConnection, userId: string): void {
  if (hasExternalFamilyMembership(connection, userId)) {
    throw new FamilyAuthorityConflictError('external_membership')
  }
}

/**
 * Resolves app-owned Family authority from persisted owner, Stripe projection,
 * and transition state. Public capability DTOs are deliberately not admission
 * authority: every mutation calls this predicate again at its final boundary.
 */
export function requireCurrentFamilyManagerAuthority(
  connection: DatabaseConnection,
  managerUserId: string,
  now = new Date()
): CurrentFamilyManagerAuthority {
  const owned = connection.sqlite
    .prepare(
      `select organization.id as organizationId
       from organization
       inner join member
         on member.organization_id = organization.id
        and member.user_id = ?
        and member.role = 'owner'
       where organization.personal_owner_user_id = ?
       limit 2`
    )
    .all(managerUserId, managerUserId) as Array<{ organizationId: string }>

  if (owned.length !== 1) {
    throw new FamilyAuthorityInvariantError('Personal Family manager authority is malformed')
  }

  const organizationId = owned[0]!.organizationId
  const current = connection.sqlite
    .prepare(
      `select
         billing_subscriptions.id as billingSubscriptionId,
         billing_subscriptions.revision as billingRevision
       from billing_subscriptions
       inner join billing_customers
         on billing_customers.id = billing_subscriptions.billing_customer_id
        and billing_customers.organization_id = billing_subscriptions.organization_id
       inner join organization on organization.id = billing_subscriptions.organization_id
       where billing_subscriptions.organization_id = ?
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
         )`
    )
    .get(organizationId, now.toISOString()) as
    | {
        billingRevision: number
        billingSubscriptionId: string
      }
    | undefined

  if (!current) throw new FamilyManagerBillingConflictError()

  return {
    billingRevision: current.billingRevision,
    billingSubscriptionId: current.billingSubscriptionId,
    managerUserId,
    organizationId
  }
}

/**
 * Removal keeps the Family graph reducible while verified coverage still
 * exists. Unlike invitation admission, it remains available during grace,
 * period-end cancellation, and a scheduled downgrade. Suspended, terminal, or
 * reconciliation state is not authoritative enough for a membership mutation.
 */
export function requireFamilyManagerRemovalAuthority(
  connection: DatabaseConnection,
  managerUserId: string,
  now = new Date()
): CurrentFamilyManagerAuthority {
  const owned = connection.sqlite
    .prepare(
      `select organization.id as organizationId
       from organization
       inner join member
         on member.organization_id = organization.id
        and member.user_id = ?
        and member.role = 'owner'
       where organization.personal_owner_user_id = ?
       limit 2`
    )
    .all(managerUserId, managerUserId) as Array<{ organizationId: string }>
  if (owned.length !== 1) {
    throw new FamilyAuthorityInvariantError('Personal Family manager authority is malformed')
  }

  const organizationId = owned[0]!.organizationId
  const current = connection.sqlite
    .prepare(
      `select
         billing_subscriptions.id as billingSubscriptionId,
         billing_subscriptions.revision as billingRevision
       from billing_subscriptions
       inner join billing_customers
         on billing_customers.id = billing_subscriptions.billing_customer_id
        and billing_customers.organization_id = billing_subscriptions.organization_id
       where billing_subscriptions.organization_id = ?
         and billing_subscriptions.plan_key = 'family'
         and billing_subscriptions.cadence in ('monthly', 'annual')
         and billing_subscriptions.stripe_subscription_id is not null
         and billing_subscriptions.stripe_subscription_item_id is not null
         and billing_subscriptions.stripe_price_id is not null
         and billing_subscriptions.current_period_start is not null
         and billing_subscriptions.current_period_end is not null
         and billing_subscriptions.current_period_end > ?
         and billing_subscriptions.last_verified_at is not null
         and billing_subscriptions.reconciliation_required = 0
         and (
           (
             billing_subscriptions.status = 'active'
             and billing_subscriptions.grace_invoice_id is null
             and billing_subscriptions.grace_started_at is null
             and billing_subscriptions.grace_ends_at is null
           )
           or (
             billing_subscriptions.status in ('past_due', 'unpaid')
             and billing_subscriptions.grace_invoice_id is not null
             and billing_subscriptions.grace_started_at is not null
             and billing_subscriptions.grace_ends_at is not null
             and billing_subscriptions.grace_ends_at > ?
             and unixepoch(billing_subscriptions.grace_ends_at)
               - unixepoch(billing_subscriptions.grace_started_at) = 1209600
           )
         )
         and not exists (
           select 1
           from billing_subscription_transitions
           where billing_subscription_transitions.organization_id = billing_subscriptions.organization_id
             and billing_subscription_transitions.state = 'reconciliation_required'
         )
         and not exists (
           select 1
           from billing_checkout_attempts
           where billing_checkout_attempts.organization_id = billing_subscriptions.organization_id
             and billing_checkout_attempts.state = 'reconciliation_required'
         )
         and not exists (
           select 1
           from billing_account_deletion_requests
           where billing_account_deletion_requests.organization_id = billing_subscriptions.organization_id
             and billing_account_deletion_requests.state in ('pending', 'reconciliation_required')
         )`
    )
    .get(organizationId, now.toISOString(), now.toISOString()) as
    | {
        billingRevision: number
        billingSubscriptionId: string
      }
    | undefined

  if (!current) throw new FamilyManagerBillingConflictError()
  return {
    billingRevision: current.billingRevision,
    billingSubscriptionId: current.billingSubscriptionId,
    managerUserId,
    organizationId
  }
}

export function requireFamilyManagerRemovalAuthorityForOrganization(
  connection: DatabaseConnection,
  input: Readonly<{
    managerUserId: string
    organizationId: string
    now?: Date
  }>
): CurrentFamilyManagerAuthority {
  const authority = requireFamilyManagerRemovalAuthority(connection, input.managerUserId, input.now)
  if (authority.organizationId !== input.organizationId) {
    throw new FamilyManagerBillingConflictError()
  }
  return authority
}

export function requireCurrentFamilyManagerForOrganization(
  connection: DatabaseConnection,
  input: Readonly<{
    managerUserId: string
    organizationId: string
    now?: Date
  }>
): CurrentFamilyManagerAuthority {
  const authority = requireCurrentFamilyManagerAuthority(connection, input.managerUserId, input.now)
  if (authority.organizationId !== input.organizationId) {
    throw new FamilyManagerBillingConflictError()
  }
  return authority
}

export function assertCanAcceptFamilyInvitation(
  connection: DatabaseConnection,
  input: Readonly<{
    invitationId?: string
    organizationId: string
    userId: string
    now?: Date
  }>
): void {
  const structure = assertFamilyJoinRecipientStructure(connection, input)

  requireCurrentFamilyManagerForOrganization(connection, {
    managerUserId: structure.managerUserId,
    organizationId: input.organizationId,
    now: input.now
  })

  if (
    hasCurrentPersonalBillingAuthority(connection, {
      invitationId: input.invitationId,
      organizationId: structure.personalOrganizationId,
      recipientUserId: input.userId,
      targetOrganizationId: input.organizationId
    })
  ) {
    throw new FamilyAuthorityConflictError('current_personal_billing')
  }
}

export function assertFamilyJoinRecipientStructure(
  connection: DatabaseConnection,
  input: Readonly<{
    organizationId: string
    userId: string
    now?: Date
  }>
): Readonly<{ managerUserId: string; personalOrganizationId: string }> {
  const target = connection.sqlite
    .prepare('select personal_owner_user_id as managerUserId from organization where id = ?')
    .get(input.organizationId) as { managerUserId: string | null } | undefined

  if (!target?.managerUserId || target.managerUserId === input.userId) {
    throw new FamilyAuthorityInvariantError('Invitation does not target another personal family')
  }

  if (hasExternalFamilyMembership(connection, input.userId)) {
    throw new FamilyAuthorityConflictError('external_membership')
  }

  const personalOrganization = connection.sqlite
    .prepare(
      `select organization.id
       from organization
       inner join member
         on member.organization_id = organization.id
        and member.user_id = ?
        and member.role = 'owner'
       where organization.personal_owner_user_id = ?`
    )
    .get(input.userId, input.userId) as { id: string } | undefined

  if (!personalOrganization) {
    throw new FamilyAuthorityInvariantError('Personal family organization is missing')
  }

  const acceptedMember = connection.sqlite
    .prepare('select 1 from member where organization_id = ? and user_id <> ? limit 1')
    .get(personalOrganization.id, input.userId)
  if (acceptedMember) {
    throw new FamilyAuthorityConflictError('accepted_personal_member')
  }

  const unresolvedInvitation = connection.sqlite
    .prepare(
      `select 1
       from invitation
       where organization_id = ?
         and status = 'pending'
         and expires_at > ?
       limit 1`
    )
    .get(personalOrganization.id, (input.now ?? new Date()).getTime())
  if (unresolvedInvitation) {
    throw new FamilyAuthorityConflictError('unresolved_personal_invitation')
  }

  return {
    managerUserId: target.managerUserId,
    personalOrganizationId: personalOrganization.id
  }
}

function hasCurrentPersonalBillingAuthority(
  connection: DatabaseConnection,
  input: Readonly<{
    invitationId?: string
    organizationId: string
    recipientUserId: string
    targetOrganizationId: string
  }>
): boolean {
  const openAttempt = connection.sqlite
    .prepare(
      `select 1
       from billing_checkout_attempts
       where organization_id = ?
         and state in ('pending', 'open', 'reconciliation_required')
       limit 1`
    )
    .get(input.organizationId)
  if (openAttempt) return true

  const openTransition = connection.sqlite
    .prepare(
      `select 1
       from billing_subscription_transitions
       where organization_id = ?
         and state in ('pending', 'action_required', 'scheduled', 'reconciliation_required')
       limit 1`
    )
    .get(input.organizationId)
  if (openTransition) return true

  const deletionRequest = connection.sqlite
    .prepare(
      `select 1
       from billing_account_deletion_requests
       where organization_id = ?
       limit 1`
    )
    .get(input.organizationId)
  if (deletionRequest) return true

  const subscription = connection.sqlite
    .prepare(
      `select
         billing_subscriptions.id,
         billing_subscriptions.plan_key as planKey,
         billing_subscriptions.cadence,
         billing_subscriptions.status,
         billing_subscriptions.current_period_end as currentPeriodEnd,
         billing_subscriptions.cancel_at_period_end as cancelAtPeriodEnd,
         billing_subscriptions.reconciliation_required as reconciliationRequired
       from billing_customers
       left join billing_subscriptions
         on billing_subscriptions.organization_id = billing_customers.organization_id
       where billing_customers.organization_id = ?`
    )
    .get(input.organizationId) as
    | {
        cadence: string | null
        cancelAtPeriodEnd: number | null
        currentPeriodEnd: string | null
        id: string | null
        planKey: string | null
        reconciliationRequired: number | null
        status: string | null
      }
    | undefined

  if (!subscription?.status) return false
  if (['none', 'canceled', 'incomplete_expired'].includes(subscription.status)) {
    return subscription.cancelAtPeriodEnd !== 0 || subscription.reconciliationRequired !== 0
  }

  if (
    input.invitationId &&
    subscription.id &&
    subscription.planKey === 'personal' &&
    subscription.cadence &&
    subscription.status === 'active' &&
    subscription.cancelAtPeriodEnd === 1 &&
    subscription.reconciliationRequired === 0 &&
    subscription.currentPeriodEnd &&
    connection.sqlite
      .prepare(
        `select 1
         from family_join_attempts
         where recipient_user_id = ?
           and personal_organization_id = ?
           and personal_billing_subscription_id = ?
           and target_organization_id = ?
           and invitation_id = ?
           and personal_paid_through = ?
           and state in ('renewal_off_confirmed', 'membership_pending', 'completed')
         limit 1`
      )
      .get(
        input.recipientUserId,
        input.organizationId,
        subscription.id,
        input.targetOrganizationId,
        input.invitationId,
        subscription.currentPeriodEnd
      )
  ) {
    return false
  }

  return true
}
