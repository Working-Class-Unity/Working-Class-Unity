import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { billingCadences, billingPlans, billingSnapshotStatuses } from '../../../shared/billing'
import { user } from './auth'
import { createdAtColumn, updatedAtColumn } from './core'
import { memberships } from './membership'

export const publicJoinAttemptStates = [
  'pending',
  'open',
  'paid',
  'claimed',
  'active',
  'expired',
  'failed',
  'review',
  'reconciliation_required'
] as const

export const publicJoinAttempts = sqliteTable(
  'public_join_attempts',
  {
    id: text('id').primaryKey(),
    planKey: text('plan_key', { enum: billingPlans }).notNull(),
    cadence: text('cadence', { enum: billingCadences }).notNull(),
    stripePriceId: text('stripe_price_id').notNull(),
    stripeSessionId: text('stripe_session_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    state: text('state', { enum: publicJoinAttemptStates }).notNull().default('pending'),
    successUrl: text('success_url').notNull(),
    cancelUrl: text('cancel_url').notNull(),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripeSubscriptionItemId: text('stripe_subscription_item_id'),
    subscriptionStatus: text('subscription_status', { enum: billingSnapshotStatuses }),
    currentPeriodStart: text('current_period_start'),
    currentPeriodEnd: text('current_period_end'),
    cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' }).notNull().default(false),
    projectionOrderMs: integer('projection_order_ms').notNull().default(0),
    projectionEventId: text('projection_event_id'),
    reconciliationReason: text('reconciliation_reason'),
    email: text('email'),
    claimExpiresAt: text('claim_expires_at'),
    claimEmailSentAt: text('claim_email_sent_at'),
    claimedUserId: text('claimed_user_id').references(() => user.id, { onDelete: 'cascade' }),
    membershipId: text('membership_id').references(() => memberships.id, { onDelete: 'restrict' }),
    claimedAt: text('claimed_at'),
    activatedAt: text('activated_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex('public_join_attempts_stripe_session_id_uidx').on(table.stripeSessionId),
    uniqueIndex('public_join_attempts_idempotency_key_uidx').on(table.idempotencyKey),
    uniqueIndex('public_join_attempts_stripe_customer_id_uidx').on(table.stripeCustomerId),
    uniqueIndex('public_join_attempts_stripe_subscription_id_uidx').on(table.stripeSubscriptionId),
    uniqueIndex('public_join_attempts_stripe_subscription_item_id_uidx').on(table.stripeSubscriptionItemId),
    uniqueIndex('public_join_attempts_membership_id_uidx').on(table.membershipId),
    index('public_join_attempts_state_created_idx').on(table.state, table.createdAt),
    index('public_join_attempts_email_state_idx').on(table.email, table.state),
    index('public_join_attempts_claimed_user_idx').on(table.claimedUserId, table.state),
    check(
      'public_join_attempts_id_check',
      sql`length(${table.id}) = 50 and substr(${table.id}, 1, 14) = 'join_checkout_'`
    ),
    check(
      'public_join_attempts_offering_check',
      sql`(${table.planKey} = 'personal' and ${table.cadence} = 'monthly') or (${table.planKey} = 'family' and ${table.cadence} = 'monthly')`
    ),
    check('public_join_attempts_price_check', sql`${table.stripePriceId} glob 'price_*'`),
    check(
      'public_join_attempts_state_check',
      sql`${table.state} in ('pending', 'open', 'paid', 'claimed', 'active', 'expired', 'failed', 'review', 'reconciliation_required')`
    ),
    check(
      'public_join_attempts_provider_id_check',
      sql`(${table.stripeSessionId} is null or ${table.stripeSessionId} glob 'cs_*') and (${table.stripeCustomerId} is null or ${table.stripeCustomerId} glob 'cus_*') and (${table.stripeSubscriptionId} is null or ${table.stripeSubscriptionId} glob 'sub_*') and (${table.stripeSubscriptionItemId} is null or ${table.stripeSubscriptionItemId} glob 'si_*')`
    ),
    check(
      'public_join_attempts_subscription_check',
      sql`(${table.subscriptionStatus} is null and ${table.stripeSubscriptionId} is null and ${table.stripeSubscriptionItemId} is null and ${table.currentPeriodStart} is null and ${table.currentPeriodEnd} is null) or (${table.subscriptionStatus} is not null and ${table.stripeCustomerId} is not null and ${table.stripeSubscriptionId} is not null and ${table.stripeSubscriptionItemId} is not null and ${table.currentPeriodStart} is not null and ${table.currentPeriodEnd} is not null)`
    ),
    check(
      'public_join_attempts_email_check',
      sql`${table.email} is null or (${table.email} = lower(trim(${table.email})) and length(${table.email}) between 3 and 320 and instr(${table.email}, '@') > 1)`
    ),
    check(
      'public_join_attempts_claim_check',
      sql`(${table.claimedUserId} is null and ${table.membershipId} is null and ${table.claimedAt} is null and ${table.activatedAt} is null) or (${table.claimedUserId} is not null and ${table.claimedAt} is not null and (${table.activatedAt} is null or ${table.membershipId} is not null))`
    ),
    check(
      'public_join_attempts_active_check',
      sql`${table.state} <> 'active' or (${table.claimedUserId} is not null and ${table.membershipId} is not null and ${table.claimedAt} is not null and ${table.activatedAt} is not null)`
    ),
    check(
      'public_join_attempts_reconciliation_check',
      sql`(${table.state} = 'reconciliation_required' and ${table.reconciliationReason} is not null) or (${table.state} <> 'reconciliation_required' and ${table.reconciliationReason} is null)`
    ),
    check(
      'public_join_attempts_time_check',
      sql`(${table.claimExpiresAt} is null or julianday(${table.claimExpiresAt}) > julianday(${table.createdAt})) and (${table.claimEmailSentAt} is null or julianday(${table.claimEmailSentAt}) >= julianday(${table.createdAt})) and (${table.claimedAt} is null or julianday(${table.claimedAt}) >= julianday(${table.createdAt})) and (${table.activatedAt} is null or (${table.claimedAt} is not null and julianday(${table.activatedAt}) >= julianday(${table.claimedAt})))`
    ),
    check('public_join_attempts_projection_order_check', sql`${table.projectionOrderMs} >= 0`)
  ]
)

export type PublicJoinAttempt = typeof publicJoinAttempts.$inferSelect
export type PublicJoinAttemptState = (typeof publicJoinAttemptStates)[number]
