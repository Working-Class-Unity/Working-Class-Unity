import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { billingCadences, billingPlans } from '../../../shared/billing'
import { billingSnapshotStatuses, familyPlanKey, stripeSubscriptionStatuses } from '../../../shared/family-plan'
import { createdAtColumn, updatedAtColumn } from './core'
import { user } from './auth'
import { invitation, member, organization } from './organizations'

export { billingSnapshotStatuses, stripeSubscriptionStatuses }

export const externalBillingRetentionPurpose = 'external_billing_reconciliation' as const
export const stripeBillingRetentionPolicy = 'stripe_billing_lifecycle' as const

export const checkoutAttemptStates = [
  'pending',
  'open',
  'completed',
  'expired',
  'failed',
  'reconciliation_required'
] as const
export const billingSubscriptionTransitionKinds = [
  'cadence_change',
  'personal_to_family',
  'family_to_personal'
] as const
export const billingSubscriptionTransitionStates = [
  'pending',
  'action_required',
  'scheduled',
  'reconciliation_required',
  'applied',
  'failed',
  'canceled'
] as const
export const familyJoinAttemptStates = [
  'pending',
  'renewal_stop_pending',
  'renewal_off_confirmed',
  'membership_pending',
  'completed',
  'reconciliation_required',
  'failed'
] as const
export const billingAccountDeletionRequestStates = [
  'pending',
  'reconciliation_required',
  'cancellation_confirmed'
] as const

const validOfferingPair = (plan: unknown, cadence: unknown) =>
  sql`((${plan} = 'personal' and ${cadence} in ('weekly', 'monthly', 'annual')) or (${plan} = 'family' and ${cadence} in ('monthly', 'annual')))`

export const billingCustomers = sqliteTable(
  'billing_customers',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    stripeCustomerId: text('stripe_customer_id').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex('billing_customers_organization_id_uidx').on(table.organizationId),
    uniqueIndex('billing_customers_stripe_customer_id_uidx').on(table.stripeCustomerId)
  ]
)

export const billingCheckoutAttempts = sqliteTable(
  'billing_checkout_attempts',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    billingCustomerId: text('billing_customer_id').references(() => billingCustomers.id, { onDelete: 'cascade' }),
    planKey: text('plan_key', { enum: billingPlans }).notNull().default(familyPlanKey),
    cadence: text('cadence', { enum: billingCadences }),
    stripePriceId: text('stripe_price_id').notNull(),
    stripeSessionId: text('stripe_session_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    state: text('state', { enum: checkoutAttemptStates }).notNull().default('pending'),
    successUrl: text('success_url').notNull(),
    cancelUrl: text('cancel_url').notNull(),
    reuseUntil: text('reuse_until').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index('billing_checkout_attempts_organization_id_idx').on(table.organizationId),
    uniqueIndex('billing_checkout_attempts_stripe_session_id_uidx').on(table.stripeSessionId),
    uniqueIndex('billing_checkout_attempts_idempotency_key_uidx').on(table.idempotencyKey),
    uniqueIndex('billing_checkout_attempts_one_open_uidx')
      .on(table.organizationId)
      .where(sql`${table.state} in ('pending', 'open', 'reconciliation_required')`),
    check(
      'billing_checkout_attempts_offering_check',
      sql`(${table.cadence} is not null and ${validOfferingPair(table.planKey, table.cadence)}) or (${table.planKey} = 'family' and ${table.cadence} is null)`
    ),
    check(
      'billing_checkout_attempts_state_check',
      sql`${table.state} in ('pending', 'open', 'completed', 'expired', 'failed', 'reconciliation_required')`
    ),
    check('billing_checkout_attempts_reuse_check', sql`${table.reuseUntil} >= ${table.createdAt}`)
  ]
)

export const billingSubscriptions = sqliteTable(
  'billing_subscriptions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    billingCustomerId: text('billing_customer_id')
      .notNull()
      .references(() => billingCustomers.id, { onDelete: 'cascade' }),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripeSubscriptionItemId: text('stripe_subscription_item_id'),
    status: text('status', { enum: billingSnapshotStatuses }).notNull().default('none'),
    planKey: text('plan_key', { enum: billingPlans }),
    cadence: text('cadence', { enum: billingCadences }),
    stripePriceId: text('stripe_price_id'),
    currentPeriodStart: text('current_period_start'),
    currentPeriodEnd: text('current_period_end'),
    cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' }).notNull().default(false),
    graceInvoiceId: text('grace_invoice_id'),
    graceStartedAt: text('grace_started_at'),
    graceEndsAt: text('grace_ends_at'),
    lastVerifiedAt: text('last_verified_at'),
    projectionOrderMs: integer('projection_order_ms').notNull().default(0),
    projectionEventId: text('projection_event_id'),
    reconciliationRequired: integer('reconciliation_required', { mode: 'boolean' }).notNull().default(false),
    reconciliationReason: text('reconciliation_reason'),
    revision: integer('revision').notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex('billing_subscriptions_organization_id_uidx').on(table.organizationId),
    uniqueIndex('billing_subscriptions_customer_id_uidx').on(table.billingCustomerId),
    uniqueIndex('billing_subscriptions_stripe_subscription_id_uidx').on(table.stripeSubscriptionId),
    uniqueIndex('billing_subscriptions_stripe_subscription_item_id_uidx').on(table.stripeSubscriptionItemId),
    uniqueIndex('billing_subscriptions_grace_invoice_id_uidx').on(table.graceInvoiceId),
    index('billing_subscriptions_status_idx').on(table.status),
    check(
      'billing_subscriptions_status_check',
      sql`${table.status} in ('none', 'active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'paused', 'trialing', 'unpaid', 'ambiguous')`
    ),
    check(
      'billing_subscriptions_offering_check',
      sql`(${table.planKey} is null and ${table.cadence} is null) or (${table.planKey} is not null and ${table.cadence} is not null and ${validOfferingPair(table.planKey, table.cadence)}) or (${table.planKey} = 'family' and ${table.cadence} is null)`
    ),
    check(
      'billing_subscriptions_grace_check',
      sql`(${table.graceInvoiceId} is null and ${table.graceStartedAt} is null and ${table.graceEndsAt} is null) or (${table.graceInvoiceId} is not null and ${table.graceStartedAt} is not null and ${table.graceEndsAt} is not null and ${table.graceEndsAt} > ${table.graceStartedAt})`
    ),
    check(
      'billing_subscriptions_reconciliation_check',
      sql`(${table.reconciliationRequired} = 1 and ${table.reconciliationReason} is not null) or (${table.reconciliationRequired} = 0 and ${table.reconciliationReason} is null)`
    ),
    check(
      'billing_subscriptions_none_check',
      sql`${table.status} <> 'none' or (${table.stripeSubscriptionId} is null and ${table.stripeSubscriptionItemId} is null and ${table.planKey} is null and ${table.cadence} is null and ${table.stripePriceId} is null and ${table.currentPeriodStart} is null and ${table.currentPeriodEnd} is null and ${table.cancelAtPeriodEnd} = 0 and ${table.graceInvoiceId} is null and ${table.graceStartedAt} is null and ${table.graceEndsAt} is null)`
    ),
    check('billing_subscriptions_revision_check', sql`${table.revision} >= 0`)
  ]
)

export const billingSubscriptionTransitions = sqliteTable(
  'billing_subscription_transitions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    billingSubscriptionId: text('billing_subscription_id')
      .notNull()
      .references(() => billingSubscriptions.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: billingSubscriptionTransitionKinds }).notNull(),
    sourcePlanKey: text('source_plan_key', { enum: billingPlans }).notNull(),
    sourceCadence: text('source_cadence', { enum: billingCadences }).notNull(),
    targetPlanKey: text('target_plan_key', { enum: billingPlans }).notNull(),
    targetCadence: text('target_cadence', { enum: billingCadences }).notNull(),
    effectiveAt: text('effective_at'),
    stripeSubscriptionScheduleId: text('stripe_subscription_schedule_id'),
    stripePendingInvoiceId: text('stripe_pending_invoice_id'),
    stripePendingUpdateExpiresAt: text('stripe_pending_update_expires_at'),
    idempotencyKey: text('idempotency_key').notNull(),
    capturedBillingRevision: integer('captured_billing_revision').notNull(),
    state: text('state', { enum: billingSubscriptionTransitionStates }).notNull().default('pending'),
    stateReason: text('state_reason'),
    revision: integer('revision').notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index('billing_subscription_transitions_organization_id_idx').on(table.organizationId),
    index('billing_subscription_transitions_subscription_id_idx').on(table.billingSubscriptionId),
    uniqueIndex('billing_subscription_transitions_idempotency_key_uidx').on(table.idempotencyKey),
    uniqueIndex('billing_subscription_transitions_schedule_id_uidx').on(table.stripeSubscriptionScheduleId),
    uniqueIndex('billing_subscription_transitions_pending_invoice_id_uidx').on(table.stripePendingInvoiceId),
    uniqueIndex('billing_subscription_transitions_one_open_uidx')
      .on(table.organizationId)
      .where(sql`${table.state} in ('pending', 'action_required', 'scheduled', 'reconciliation_required')`),
    check(
      'billing_subscription_transitions_kind_check',
      sql`${table.kind} in ('cadence_change', 'personal_to_family', 'family_to_personal')`
    ),
    check(
      'billing_subscription_transitions_state_check',
      sql`${table.state} in ('pending', 'action_required', 'scheduled', 'reconciliation_required', 'applied', 'failed', 'canceled')`
    ),
    check(
      'billing_subscription_transitions_source_offering_check',
      validOfferingPair(table.sourcePlanKey, table.sourceCadence)
    ),
    check(
      'billing_subscription_transitions_target_offering_check',
      validOfferingPair(table.targetPlanKey, table.targetCadence)
    ),
    check(
      'billing_subscription_transitions_semantics_check',
      sql`(${table.kind} = 'cadence_change' and ${table.sourcePlanKey} = ${table.targetPlanKey} and ${table.sourceCadence} <> ${table.targetCadence}) or (${table.kind} = 'personal_to_family' and ${table.sourcePlanKey} = 'personal' and ${table.targetPlanKey} = 'family') or (${table.kind} = 'family_to_personal' and ${table.sourcePlanKey} = 'family' and ${table.targetPlanKey} = 'personal')`
    ),
    check(
      'billing_subscription_transitions_timing_check',
      sql`${table.kind} = 'personal_to_family' or ${table.effectiveAt} is not null`
    ),
    check(
      'billing_subscription_transitions_provider_reference_check',
      sql`${table.kind} = 'personal_to_family' or ${table.stripePendingUpdateExpiresAt} is null`
    ),
    check(
      'billing_subscription_transitions_reason_check',
      sql`${table.stateReason} is null or length(trim(${table.stateReason})) between 1 and 128`
    ),
    check(
      'billing_subscription_transitions_revision_check',
      sql`${table.capturedBillingRevision} >= 0 and ${table.revision} >= 0`
    )
  ]
)

export const familyJoinAttempts = sqliteTable(
  'family_join_attempts',
  {
    id: text('id').primaryKey(),
    recipientUserId: text('recipient_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    personalOrganizationId: text('personal_organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    personalBillingSubscriptionId: text('personal_billing_subscription_id')
      .notNull()
      .references(() => billingSubscriptions.id, { onDelete: 'cascade' }),
    capturedPersonalBillingRevision: integer('captured_personal_billing_revision').notNull(),
    targetOrganizationId: text('target_organization_id').references(() => organization.id, { onDelete: 'set null' }),
    invitationId: text('invitation_id').references(() => invitation.id, { onDelete: 'set null' }),
    acceptedMemberId: text('accepted_member_id').references(() => member.id, { onDelete: 'set null' }),
    stripeCancellationIdempotencyKey: text('stripe_cancellation_idempotency_key').notNull(),
    personalPaidThrough: text('personal_paid_through'),
    state: text('state', { enum: familyJoinAttemptStates }).notNull().default('pending'),
    stateReason: text('state_reason'),
    revision: integer('revision').notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index('family_join_attempts_recipient_user_id_idx').on(table.recipientUserId),
    index('family_join_attempts_personal_subscription_id_idx').on(table.personalBillingSubscriptionId),
    uniqueIndex('family_join_attempts_invitation_id_uidx').on(table.invitationId),
    uniqueIndex('family_join_attempts_stripe_idempotency_key_uidx').on(table.stripeCancellationIdempotencyKey),
    uniqueIndex('family_join_attempts_one_open_per_recipient_uidx')
      .on(table.recipientUserId)
      .where(
        sql`${table.state} in ('pending', 'renewal_stop_pending', 'renewal_off_confirmed', 'membership_pending', 'reconciliation_required')`
      ),
    check(
      'family_join_attempts_state_check',
      sql`${table.state} in ('pending', 'renewal_stop_pending', 'renewal_off_confirmed', 'membership_pending', 'completed', 'reconciliation_required', 'failed')`
    ),
    check(
      'family_join_attempts_paid_through_check',
      sql`${table.state} not in ('renewal_off_confirmed', 'membership_pending', 'completed') or ${table.personalPaidThrough} is not null`
    ),
    check(
      'family_join_attempts_reason_check',
      sql`${table.stateReason} is null or length(trim(${table.stateReason})) between 1 and 128`
    ),
    check(
      'family_join_attempts_revision_check',
      sql`${table.capturedPersonalBillingRevision} >= 0 and ${table.revision} >= 0`
    )
  ]
)

export const billingAccountDeletionRequests = sqliteTable(
  'billing_account_deletion_requests',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    billingSubscriptionId: text('billing_subscription_id').references(() => billingSubscriptions.id, {
      onDelete: 'set null'
    }),
    billingCustomerId: text('billing_customer_id')
      .notNull()
      .references(() => billingCustomers.id, { onDelete: 'cascade' }),
    expectedStripeSubscriptionId: text('expected_stripe_subscription_id'),
    expectedStripeCustomerId: text('expected_stripe_customer_id').notNull(),
    capturedBillingRevision: integer('captured_billing_revision').notNull(),
    state: text('state', { enum: billingAccountDeletionRequestStates }).notNull().default('pending'),
    reason: text('reason'),
    cancellationConfirmedAt: text('cancellation_confirmed_at'),
    revision: integer('revision').notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex('billing_account_deletion_requests_user_id_uidx').on(table.userId),
    uniqueIndex('billing_account_deletion_requests_organization_id_uidx').on(table.organizationId),
    uniqueIndex('billing_account_deletion_requests_subscription_id_uidx').on(table.billingSubscriptionId),
    check(
      'billing_account_deletion_requests_state_check',
      sql`${table.state} in ('pending', 'reconciliation_required', 'cancellation_confirmed')`
    ),
    check('billing_account_deletion_requests_id_check', sql`length(trim(${table.id})) between 1 and 128`),
    check(
      'billing_account_deletion_requests_reason_check',
      sql`(${table.state} = 'reconciliation_required' and ${table.reason} is not null and length(trim(${table.reason})) between 1 and 128) or (${table.state} <> 'reconciliation_required' and ${table.reason} is null)`
    ),
    check(
      'billing_account_deletion_requests_confirmation_check',
      sql`(${table.state} = 'cancellation_confirmed' and ${table.cancellationConfirmedAt} is not null) or (${table.state} <> 'cancellation_confirmed' and ${table.cancellationConfirmedAt} is null)`
    ),
    check(
      'billing_account_deletion_requests_revision_check',
      sql`${table.capturedBillingRevision} >= 0 and ${table.revision} >= 0`
    ),
    check(
      'billing_account_deletion_requests_reference_check',
      sql`((${table.billingSubscriptionId} is null and ${table.expectedStripeSubscriptionId} is null) or (${table.billingSubscriptionId} is not null and ${table.expectedStripeSubscriptionId} is not null and length(trim(${table.expectedStripeSubscriptionId})) between 1 and 255)) and length(trim(${table.expectedStripeCustomerId})) between 1 and 255`
    )
  ]
)

export const billingEvents = sqliteTable(
  'billing_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    stripeEventId: text('stripe_event_id').notNull(),
    eventType: text('event_type').notNull(),
    providerCreatedAt: integer('provider_created_at'),
    processedAt: text('processed_at').notNull()
  },
  (table) => [
    uniqueIndex('billing_events_stripe_event_id_uidx').on(table.stripeEventId),
    index('billing_events_event_type_idx').on(table.eventType),
    check(
      'billing_events_provider_created_at_check',
      sql`${table.providerCreatedAt} is null or ${table.providerCreatedAt} >= 0`
    )
  ]
)

/**
 * Provider continuity retained after identity deletion. The row deliberately
 * has no user, organization, email, Price, receipt, or content linkage.
 */
export const detachedBillingSubjects = sqliteTable(
  'detached_billing_subjects',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    providerReference: text('provider_reference').notNull(),
    providerCustomerReference: text('provider_customer_reference'),
    providerStatus: text('provider_status').notNull(),
    providerStatusExpiresAt: text('provider_status_expires_at'),
    providerEventCreatedAt: integer('provider_event_created_at'),
    statusUpdatedAt: text('status_updated_at').notNull(),
    deletedAt: text('deleted_at').notNull(),
    retentionPurpose: text('retention_purpose').notNull(),
    retentionPolicy: text('retention_policy').notNull(),
    purgeAfter: text('purge_after')
  },
  (table) => [
    uniqueIndex('detached_billing_subject_provider_reference_uidx').on(table.provider, table.providerReference),
    index('detached_billing_subject_customer_reference_idx').on(table.provider, table.providerCustomerReference),
    check(
      'detached_billing_subject_retention_purpose_check',
      sql`${table.retentionPurpose} = 'external_billing_reconciliation'`
    ),
    check(
      'detached_billing_subject_purge_after_check',
      sql`${table.purgeAfter} is null or ${table.purgeAfter} >= ${table.deletedAt}`
    ),
    check(
      'detached_billing_subject_provider_event_check',
      sql`${table.providerEventCreatedAt} is null or ${table.providerEventCreatedAt} >= 0`
    )
  ]
)

export type BillingCustomer = typeof billingCustomers.$inferSelect
export type BillingCheckoutAttempt = typeof billingCheckoutAttempts.$inferSelect
export type BillingSubscription = typeof billingSubscriptions.$inferSelect
export type BillingSubscriptionTransition = typeof billingSubscriptionTransitions.$inferSelect
export type NewBillingSubscriptionTransition = typeof billingSubscriptionTransitions.$inferInsert
export type FamilyJoinAttempt = typeof familyJoinAttempts.$inferSelect
export type NewFamilyJoinAttempt = typeof familyJoinAttempts.$inferInsert
export type BillingAccountDeletionRequest = typeof billingAccountDeletionRequests.$inferSelect
export type NewBillingAccountDeletionRequest = typeof billingAccountDeletionRequests.$inferInsert
export type BillingEvent = typeof billingEvents.$inferSelect
export type DetachedBillingSubject = typeof detachedBillingSubjects.$inferSelect
export type CheckoutAttemptState = (typeof checkoutAttemptStates)[number]
export type BillingSubscriptionTransitionKind = (typeof billingSubscriptionTransitionKinds)[number]
export type BillingSubscriptionTransitionState = (typeof billingSubscriptionTransitionStates)[number]
export type FamilyJoinAttemptState = (typeof familyJoinAttemptStates)[number]
export type BillingAccountDeletionRequestState = (typeof billingAccountDeletionRequestStates)[number]
