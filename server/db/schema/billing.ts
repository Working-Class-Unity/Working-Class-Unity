import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { user } from './auth'
import { billingCadences, billingPlans, billingSnapshotStatuses } from '../../../shared/billing'

export { billingStripeInvariantSql } from './billing.invariants'

const createdAtColumn = () =>
  text('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
const updatedAtColumn = () =>
  text('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)

export const checkoutAttemptStates = Object.freeze([
  'pending',
  'open',
  'completed',
  'expired',
  'failed',
  'reconciliation_required'
] as const)
export const billingSubscriptionTransitionKinds = Object.freeze([
  'cadence_change',
  'personal_to_family',
  'family_to_personal'
] as const)
export const billingSubscriptionTransitionStates = Object.freeze([
  'pending',
  'action_required',
  'scheduled',
  'reconciliation_required',
  'applied',
  'failed',
  'canceled'
] as const)
export const billingAccountDeletionRequestStates = Object.freeze([
  'pending',
  'reconciliation_required',
  'cancellation_confirmed'
] as const)
export const billingEmailVerificationStatuses = Object.freeze([
  'pending',
  'sent',
  'consumed',
  'conflict',
  'expired'
] as const)
export const accountStripeMembershipTiers = Object.freeze(['supporter', 'member', 'solidarity'] as const)
export const accountStripeMembershipStatuses = Object.freeze([
  'active',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'past_due',
  'paused',
  'trialing',
  'unpaid'
] as const)

const validOfferingPair = (plan: unknown, cadence: unknown) =>
  sql`((${plan} = 'personal' and ${cadence} in ('weekly', 'monthly', 'annual')) or (${plan} = 'family' and ${cadence} in ('monthly', 'annual')))`

export const accountStripeMemberships = sqliteTable(
  'account_stripe_memberships',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    stripeCustomerId: text('stripe_customer_id').notNull(),
    stripeSubscriptionId: text('stripe_subscription_id').notNull(),
    stripePriceId: text('stripe_price_id').notNull(),
    tier: text('tier', { enum: accountStripeMembershipTiers }).notNull(),
    stripeStatus: text('stripe_status', { enum: accountStripeMembershipStatuses }),
    lastVerifiedAt: text('last_verified_at'),
    projectionOrderMs: integer('projection_order_ms').notNull().default(0),
    projectionEventId: text('projection_event_id'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex('account_stripe_memberships_customer_uidx').on(table.stripeCustomerId),
    uniqueIndex('account_stripe_memberships_subscription_uidx').on(table.stripeSubscriptionId),
    check('account_stripe_memberships_customer_check', sql`${table.stripeCustomerId} glob 'cus_*'`),
    check('account_stripe_memberships_subscription_check', sql`${table.stripeSubscriptionId} glob 'sub_*'`),
    check('account_stripe_memberships_price_check', sql`${table.stripePriceId} glob 'price_*'`),
    check('account_stripe_memberships_tier_check', sql`${table.tier} in ('supporter', 'member', 'solidarity')`)
  ]
)

export const billingCustomers = sqliteTable(
  'billing_customers',
  {
    id: text('id').primaryKey(),
    purchaserUserId: text('purchaser_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    stripeCustomerId: text('stripe_customer_id').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex('billing_customers_purchaser_user_id_uidx').on(table.purchaserUserId),
    uniqueIndex('billing_customers_stripe_customer_id_uidx').on(table.stripeCustomerId),
    check('billing_customers_id_check', sql`length(trim(${table.id})) between 1 and 128`),
    check('billing_customers_stripe_id_check', sql`${table.stripeCustomerId} glob 'cus_*'`)
  ]
)

export const billingCheckoutAttempts = sqliteTable(
  'billing_checkout_attempts',
  {
    id: text('id').primaryKey(),
    purchaserUserId: text('purchaser_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    billingCustomerId: text('billing_customer_id').references(() => billingCustomers.id, { onDelete: 'cascade' }),
    planKey: text('plan_key', { enum: billingPlans }).notNull(),
    cadence: text('cadence', { enum: billingCadences }).notNull(),
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
    index('billing_checkout_attempts_purchaser_user_id_idx').on(table.purchaserUserId),
    uniqueIndex('billing_checkout_attempts_stripe_session_id_uidx').on(table.stripeSessionId),
    uniqueIndex('billing_checkout_attempts_idempotency_key_uidx').on(table.idempotencyKey),
    uniqueIndex('billing_checkout_attempts_one_open_uidx')
      .on(table.purchaserUserId)
      .where(sql`${table.state} in ('pending', 'open', 'reconciliation_required')`),
    check('billing_checkout_attempts_offering_check', validOfferingPair(table.planKey, table.cadence)),
    check(
      'billing_checkout_attempts_state_check',
      sql`${table.state} in ('pending', 'open', 'completed', 'expired', 'failed', 'reconciliation_required')`
    ),
    check('billing_checkout_attempts_price_check', sql`${table.stripePriceId} glob 'price_*'`),
    check('billing_checkout_attempts_reuse_check', sql`${table.reuseUntil} >= ${table.createdAt}`)
  ]
)

export const billingEmailVerifications = sqliteTable(
  'billing_email_verifications',
  {
    id: text('id').primaryKey(),
    purchaserUserId: text('purchaser_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    billingCheckoutAttemptId: text('billing_checkout_attempt_id')
      .notNull()
      .references(() => billingCheckoutAttempts.id, { onDelete: 'cascade' }),
    stripeSessionId: text('stripe_session_id').notNull(),
    email: text('email').notNull(),
    status: text('status', { enum: billingEmailVerificationStatuses }).notNull().default('pending'),
    expiresAt: text('expires_at').notNull(),
    sentAt: text('sent_at'),
    consumedAt: text('consumed_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex('billing_email_verifications_attempt_id_uidx').on(table.billingCheckoutAttemptId),
    uniqueIndex('billing_email_verifications_stripe_session_id_uidx').on(table.stripeSessionId),
    index('billing_email_verifications_status_expiry_idx').on(table.status, table.expiresAt),
    check(
      'billing_email_verifications_id_check',
      sql`length(${table.id}) = 63 and substr(${table.id}, 1, 27) = 'billing_email_verification_'`
    ),
    check('billing_email_verifications_session_check', sql`${table.stripeSessionId} glob 'cs_*'`),
    check(
      'billing_email_verifications_email_check',
      sql`${table.email} = lower(trim(${table.email})) and length(${table.email}) between 3 and 320 and instr(${table.email}, '@') > 1`
    ),
    check(
      'billing_email_verifications_status_check',
      sql`${table.status} in ('pending', 'sent', 'consumed', 'conflict', 'expired')`
    ),
    check(
      'billing_email_verifications_lifecycle_check',
      sql`(${table.status} = 'pending' and ${table.sentAt} is null and ${table.consumedAt} is null) or (${table.status} = 'sent' and ${table.sentAt} is not null and ${table.consumedAt} is null) or (${table.status} in ('consumed', 'conflict') and ${table.sentAt} is not null and ${table.consumedAt} is not null) or (${table.status} = 'expired' and ${table.consumedAt} is not null)`
    ),
    check(
      'billing_email_verifications_timestamps_check',
      sql`julianday(${table.expiresAt}) is not null and julianday(${table.createdAt}) is not null and julianday(${table.updatedAt}) is not null and julianday(${table.expiresAt}) > julianday(${table.createdAt}) and julianday(${table.updatedAt}) >= julianday(${table.createdAt}) and (${table.sentAt} is null or julianday(${table.sentAt}) >= julianday(${table.createdAt})) and (${table.consumedAt} is null or julianday(${table.consumedAt}) >= julianday(${table.createdAt}))`
    )
  ]
)

export const billingSubscriptions = sqliteTable(
  'billing_subscriptions',
  {
    id: text('id').primaryKey(),
    purchaserUserId: text('purchaser_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
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
    uniqueIndex('billing_subscriptions_purchaser_user_id_uidx').on(table.purchaserUserId),
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
      sql`(${table.planKey} is null and ${table.cadence} is null) or (${table.planKey} is not null and ${table.cadence} is not null and ${validOfferingPair(table.planKey, table.cadence)})`
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
    purchaserUserId: text('purchaser_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
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
    index('billing_subscription_transitions_purchaser_user_id_idx').on(table.purchaserUserId),
    index('billing_subscription_transitions_subscription_id_idx').on(table.billingSubscriptionId),
    uniqueIndex('billing_subscription_transitions_idempotency_key_uidx').on(table.idempotencyKey),
    uniqueIndex('billing_subscription_transitions_schedule_id_uidx').on(table.stripeSubscriptionScheduleId),
    uniqueIndex('billing_subscription_transitions_pending_invoice_id_uidx').on(table.stripePendingInvoiceId),
    uniqueIndex('billing_subscription_transitions_one_open_uidx')
      .on(table.purchaserUserId)
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

export const billingAccountDeletionRequests = sqliteTable(
  'billing_account_deletion_requests',
  {
    id: text('id').primaryKey(),
    purchaserUserId: text('purchaser_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    billingSubscriptionId: text('billing_subscription_id').references(() => billingSubscriptions.id, {
      onDelete: 'restrict'
    }),
    billingCustomerId: text('billing_customer_id').references(() => billingCustomers.id, { onDelete: 'restrict' }),
    stripeMembershipUserId: text('stripe_membership_user_id').references(() => accountStripeMemberships.userId, {
      onDelete: 'restrict'
    }),
    expectedStripeSubscriptionId: text('expected_stripe_subscription_id'),
    expectedStripeCustomerId: text('expected_stripe_customer_id'),
    capturedBillingRevision: integer('captured_billing_revision').notNull().default(0),
    state: text('state', { enum: billingAccountDeletionRequestStates }).notNull().default('pending'),
    reason: text('reason'),
    cancellationConfirmedAt: text('cancellation_confirmed_at'),
    revision: integer('revision').notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex('billing_account_deletion_requests_purchaser_user_id_uidx').on(table.purchaserUserId),
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
      'billing_account_deletion_requests_reference_check',
      sql`(((${table.billingCustomerId} is null and ${table.expectedStripeCustomerId} is null) or (${table.billingCustomerId} is not null and ${table.expectedStripeCustomerId} is not null and length(trim(${table.expectedStripeCustomerId})) between 1 and 255 and ${table.expectedStripeCustomerId} glob 'cus_*')) and ((${table.billingSubscriptionId} is null and ${table.expectedStripeSubscriptionId} is null) or (${table.billingSubscriptionId} is not null and ${table.expectedStripeSubscriptionId} is not null and length(trim(${table.expectedStripeSubscriptionId})) between 1 and 255 and ${table.expectedStripeSubscriptionId} glob 'sub_*')))`
    ),
    check(
      'billing_account_deletion_requests_revision_check',
      sql`${table.capturedBillingRevision} >= 0 and ${table.revision} >= 0`
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
    check('detached_billing_subject_provider_check', sql`${table.provider} = 'stripe'`),
    check(
      'detached_billing_subject_retention_purpose_check',
      sql`${table.retentionPurpose} = 'external_billing_reconciliation'`
    ),
    check(
      'detached_billing_subject_retention_policy_check',
      sql`${table.retentionPolicy} = 'stripe_billing_lifecycle'`
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

export const billingStripeSchema = Object.freeze({
  billingCustomers,
  billingCheckoutAttempts,
  billingEmailVerifications,
  billingSubscriptions,
  billingSubscriptionTransitions,
  billingAccountDeletionRequests,
  billingEvents,
  detachedBillingSubjects
})

export type BillingCustomer = typeof billingCustomers.$inferSelect
export type AccountStripeMembership = typeof accountStripeMemberships.$inferSelect
export type BillingCheckoutAttempt = typeof billingCheckoutAttempts.$inferSelect
export type BillingSubscription = typeof billingSubscriptions.$inferSelect
export type BillingEmailVerification = typeof billingEmailVerifications.$inferSelect
export type BillingSubscriptionTransition = typeof billingSubscriptionTransitions.$inferSelect
export type BillingAccountDeletionRequest = typeof billingAccountDeletionRequests.$inferSelect
export type BillingEvent = typeof billingEvents.$inferSelect
export type DetachedBillingSubject = typeof detachedBillingSubjects.$inferSelect
export type CheckoutAttemptState = (typeof checkoutAttemptStates)[number]
export type BillingSubscriptionTransitionKind = (typeof billingSubscriptionTransitionKinds)[number]
export type BillingSubscriptionTransitionState = (typeof billingSubscriptionTransitionStates)[number]
export type BillingEmailVerificationStatus = (typeof billingEmailVerificationStatuses)[number]
export type BillingAccountDeletionRequestState = (typeof billingAccountDeletionRequestStates)[number]
export type AccountStripeMembershipStatus = (typeof accountStripeMembershipStatuses)[number]

export type NewBillingCustomer = typeof billingCustomers.$inferInsert
export type NewBillingCheckoutAttempt = typeof billingCheckoutAttempts.$inferInsert
export type NewBillingSubscription = typeof billingSubscriptions.$inferInsert
export type NewBillingSubscriptionTransition = typeof billingSubscriptionTransitions.$inferInsert
export type NewBillingAccountDeletionRequest = typeof billingAccountDeletionRequests.$inferInsert
