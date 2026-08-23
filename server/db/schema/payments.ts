import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { createdAtColumn, updatedAtColumn } from './core'
import { memberships } from './membership'
import { people } from './people'
import { externalRecordSnapshots } from './provenance'

export const stripeSubscriptionStatuses = [
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused'
] as const
export const stripeInvoiceStatuses = ['draft', 'open', 'paid', 'void', 'uncollectible'] as const
export const stripeChargeStatuses = ['pending', 'succeeded', 'failed'] as const
export const stripeRefundStatuses = ['pending', 'requires_action', 'succeeded', 'failed', 'canceled'] as const
export const revenueCategories = ['dues', 'donation', 'other', 'unclassified'] as const

const validCurrency = (currency: unknown) => sql`length(${currency}) = 3 and ${currency} = upper(${currency})`

export const stripeCustomers = sqliteTable(
  'stripe_customers',
  {
    id: text('id').primaryKey(),
    personId: text('person_id').references(() => people.id, { onDelete: 'restrict' }),
    email: text('email'),
    phone: text('phone'),
    defaultCurrency: text('default_currency'),
    providerCreatedAt: text('provider_created_at'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index('stripe_customers_person_idx').on(table.personId),
    check('stripe_customers_id_check', sql`${table.id} glob 'cus_*'`),
    check(
      'stripe_customers_currency_check',
      sql`${table.defaultCurrency} is null or ${validCurrency(table.defaultCurrency)}`
    ),
    check(
      'stripe_customers_provider_created_check',
      sql`${table.providerCreatedAt} is null or julianday(${table.providerCreatedAt}) is not null`
    )
  ]
)

export const stripeProducts = sqliteTable(
  'stripe_products',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    active: integer('active', { mode: 'boolean' }).notNull(),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index('stripe_products_active_idx').on(table.active, table.name),
    check('stripe_products_id_check', sql`${table.id} glob 'prod_*'`),
    check('stripe_products_name_check', sql`length(trim(${table.name})) between 1 and 255`)
  ]
)

export const stripePrices = sqliteTable(
  'stripe_prices',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => stripeProducts.id, { onDelete: 'restrict' }),
    lookupKey: text('lookup_key'),
    active: integer('active', { mode: 'boolean' }).notNull(),
    currency: text('currency').notNull(),
    unitAmount: integer('unit_amount'),
    recurringInterval: text('recurring_interval'),
    recurringIntervalCount: integer('recurring_interval_count'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex('stripe_prices_lookup_key_uidx')
      .on(table.lookupKey)
      .where(sql`${table.lookupKey} is not null`),
    index('stripe_prices_product_idx').on(table.productId, table.active),
    check('stripe_prices_id_check', sql`length(trim(${table.id})) between 1 and 255`),
    check('stripe_prices_currency_check', validCurrency(table.currency)),
    check('stripe_prices_amount_check', sql`${table.unitAmount} is null or ${table.unitAmount} >= 0`),
    check(
      'stripe_prices_recurring_check',
      sql`(${table.recurringInterval} is null and ${table.recurringIntervalCount} is null) or (${table.recurringInterval} in ('day', 'week', 'month', 'year') and ${table.recurringIntervalCount} >= 1)`
    )
  ]
)

export const membershipDuesPrices = sqliteTable(
  'membership_dues_prices',
  {
    priceId: text('price_id')
      .primaryKey()
      .references(() => stripePrices.id, { onDelete: 'restrict' }),
    membershipClass: text('membership_class').notNull().default('standard'),
    effectiveFrom: text('effective_from'),
    effectiveTo: text('effective_to'),
    createdAt: createdAtColumn()
  },
  (table) => [
    check('membership_dues_prices_class_check', sql`${table.membershipClass} = 'standard'`),
    check(
      'membership_dues_prices_interval_check',
      sql`(${table.effectiveFrom} is null or julianday(${table.effectiveFrom}) is not null) and (${table.effectiveTo} is null or (${table.effectiveFrom} is not null and julianday(${table.effectiveTo}) > julianday(${table.effectiveFrom})))`
    )
  ]
)

export const stripeSubscriptions = sqliteTable(
  'stripe_subscriptions',
  {
    id: text('id').primaryKey(),
    customerId: text('customer_id')
      .notNull()
      .references(() => stripeCustomers.id, { onDelete: 'restrict' }),
    status: text('status', { enum: stripeSubscriptionStatuses }).notNull(),
    currentPeriodStart: text('current_period_start'),
    currentPeriodEnd: text('current_period_end'),
    cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' }).notNull().default(false),
    cancelAt: text('cancel_at'),
    canceledAt: text('canceled_at'),
    endedAt: text('ended_at'),
    providerCreatedAt: text('provider_created_at'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index('stripe_subscriptions_customer_status_idx').on(table.customerId, table.status),
    check('stripe_subscriptions_id_check', sql`${table.id} glob 'sub_*'`),
    check(
      'stripe_subscriptions_status_check',
      sql`${table.status} in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')`
    ),
    check(
      'stripe_subscriptions_period_check',
      sql`(${table.currentPeriodStart} is null and ${table.currentPeriodEnd} is null) or (${table.currentPeriodStart} is not null and ${table.currentPeriodEnd} is not null and julianday(${table.currentPeriodEnd}) > julianday(${table.currentPeriodStart}))`
    ),
    check(
      'stripe_subscriptions_dates_check',
      sql`(${table.cancelAt} is null or julianday(${table.cancelAt}) is not null) and (${table.canceledAt} is null or julianday(${table.canceledAt}) is not null) and (${table.endedAt} is null or julianday(${table.endedAt}) is not null) and (${table.providerCreatedAt} is null or julianday(${table.providerCreatedAt}) is not null)`
    )
  ]
)

export const membershipDuesSubscriptions = sqliteTable(
  'membership_dues_subscriptions',
  {
    id: text('id').primaryKey(),
    membershipId: text('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'restrict' }),
    subscriptionId: text('subscription_id')
      .notNull()
      .references(() => stripeSubscriptions.id, { onDelete: 'restrict' }),
    effectiveFrom: text('effective_from').notNull(),
    effectiveTo: text('effective_to'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn()
  },
  (table) => [
    uniqueIndex('membership_dues_subscriptions_subscription_from_uidx').on(table.subscriptionId, table.effectiveFrom),
    uniqueIndex('membership_dues_subscriptions_one_current_uidx')
      .on(table.subscriptionId)
      .where(sql`${table.effectiveTo} is null`),
    index('membership_dues_subscriptions_membership_idx').on(table.membershipId, table.effectiveFrom),
    check(
      'membership_dues_subscriptions_interval_check',
      sql`julianday(${table.effectiveFrom}) is not null and (${table.effectiveTo} is null or julianday(${table.effectiveTo}) > julianday(${table.effectiveFrom}))`
    )
  ]
)

export const stripeSubscriptionItems = sqliteTable(
  'stripe_subscription_items',
  {
    id: text('id').primaryKey(),
    subscriptionId: text('subscription_id')
      .notNull()
      .references(() => stripeSubscriptions.id, { onDelete: 'restrict' }),
    priceId: text('price_id')
      .notNull()
      .references(() => stripePrices.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull().default(1),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex('stripe_subscription_items_subscription_price_uidx').on(table.subscriptionId, table.priceId),
    index('stripe_subscription_items_price_idx').on(table.priceId, table.subscriptionId),
    check('stripe_subscription_items_id_check', sql`${table.id} glob 'si_*'`),
    check('stripe_subscription_items_quantity_check', sql`${table.quantity} >= 1`)
  ]
)

export const stripeInvoices = sqliteTable(
  'stripe_invoices',
  {
    id: text('id').primaryKey(),
    customerId: text('customer_id')
      .notNull()
      .references(() => stripeCustomers.id, { onDelete: 'restrict' }),
    subscriptionId: text('subscription_id').references(() => stripeSubscriptions.id, { onDelete: 'restrict' }),
    status: text('status', { enum: stripeInvoiceStatuses }).notNull(),
    currency: text('currency').notNull(),
    subtotal: integer('subtotal').notNull(),
    total: integer('total').notNull(),
    amountDue: integer('amount_due').notNull(),
    amountPaid: integer('amount_paid').notNull(),
    amountRemaining: integer('amount_remaining').notNull(),
    periodStart: text('period_start'),
    periodEnd: text('period_end'),
    paidAt: text('paid_at'),
    paymentIntentId: text('payment_intent_id'),
    providerCreatedAt: text('provider_created_at'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index('stripe_invoices_customer_status_idx').on(table.customerId, table.status, table.providerCreatedAt),
    index('stripe_invoices_subscription_idx').on(table.subscriptionId, table.periodStart),
    check('stripe_invoices_id_check', sql`${table.id} glob 'in_*'`),
    check('stripe_invoices_status_check', sql`${table.status} in ('draft', 'open', 'paid', 'void', 'uncollectible')`),
    check('stripe_invoices_currency_check', validCurrency(table.currency)),
    check(
      'stripe_invoices_amount_check',
      sql`${table.amountDue} >= 0 and ${table.amountPaid} >= 0 and ${table.amountRemaining} >= 0`
    ),
    check(
      'stripe_invoices_period_check',
      sql`(${table.periodStart} is null and ${table.periodEnd} is null) or (${table.periodStart} is not null and ${table.periodEnd} is not null and julianday(${table.periodEnd}) >= julianday(${table.periodStart}))`
    ),
    check(
      'stripe_invoices_dates_check',
      sql`(${table.paidAt} is null or julianday(${table.paidAt}) is not null) and (${table.providerCreatedAt} is null or julianday(${table.providerCreatedAt}) is not null)`
    )
  ]
)

export const stripeInvoiceLines = sqliteTable(
  'stripe_invoice_lines',
  {
    id: text('id').primaryKey(),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => stripeInvoices.id, { onDelete: 'restrict' }),
    subscriptionItemId: text('subscription_item_id').references(() => stripeSubscriptionItems.id, {
      onDelete: 'restrict'
    }),
    priceId: text('price_id').references(() => stripePrices.id, { onDelete: 'restrict' }),
    productId: text('product_id').references(() => stripeProducts.id, { onDelete: 'restrict' }),
    description: text('description'),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    periodStart: text('period_start'),
    periodEnd: text('period_end'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn()
  },
  (table) => [
    index('stripe_invoice_lines_invoice_idx').on(table.invoiceId, table.priceId),
    check('stripe_invoice_lines_id_check', sql`length(trim(${table.id})) between 1 and 255`),
    check('stripe_invoice_lines_currency_check', validCurrency(table.currency)),
    check(
      'stripe_invoice_lines_period_check',
      sql`(${table.periodStart} is null and ${table.periodEnd} is null) or (${table.periodStart} is not null and ${table.periodEnd} is not null and julianday(${table.periodEnd}) >= julianday(${table.periodStart}))`
    )
  ]
)

export const stripeDiscountApplications = sqliteTable(
  'stripe_discount_applications',
  {
    id: text('id').primaryKey(),
    customerId: text('customer_id')
      .notNull()
      .references(() => stripeCustomers.id, { onDelete: 'restrict' }),
    subscriptionId: text('subscription_id').references(() => stripeSubscriptions.id, { onDelete: 'restrict' }),
    invoiceId: text('invoice_id').references(() => stripeInvoices.id, { onDelete: 'restrict' }),
    couponId: text('coupon_id').notNull(),
    promotionCodeId: text('promotion_code_id'),
    amountOff: integer('amount_off'),
    percentOffBasisPoints: integer('percent_off_basis_points'),
    currency: text('currency'),
    duration: text('duration').notNull(),
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn()
  },
  (table) => [
    index('stripe_discount_applications_subscription_idx').on(table.subscriptionId, table.startsAt),
    index('stripe_discount_applications_invoice_idx').on(table.invoiceId),
    check(
      'stripe_discount_applications_target_check',
      sql`${table.subscriptionId} is not null or ${table.invoiceId} is not null`
    ),
    check(
      'stripe_discount_applications_value_check',
      sql`(${table.amountOff} is not null and ${table.amountOff} >= 0 and ${table.percentOffBasisPoints} is null and ${table.currency} is not null and ${validCurrency(table.currency)}) or (${table.amountOff} is null and ${table.percentOffBasisPoints} between 1 and 10000 and ${table.currency} is null)`
    ),
    check('stripe_discount_applications_duration_check', sql`${table.duration} in ('once', 'repeating', 'forever')`),
    check(
      'stripe_discount_applications_interval_check',
      sql`julianday(${table.startsAt}) is not null and (${table.endsAt} is null or julianday(${table.endsAt}) > julianday(${table.startsAt}))`
    )
  ]
)

export const stripePayouts = sqliteTable(
  'stripe_payouts',
  {
    id: text('id').primaryKey(),
    status: text('status').notNull(),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    arrivalAt: text('arrival_at'),
    providerCreatedAt: text('provider_created_at'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index('stripe_payouts_status_arrival_idx').on(table.status, table.arrivalAt),
    check('stripe_payouts_id_check', sql`${table.id} glob 'po_*'`),
    check('stripe_payouts_amount_check', sql`${table.amount} >= 0`),
    check('stripe_payouts_currency_check', validCurrency(table.currency)),
    check(
      'stripe_payouts_dates_check',
      sql`(${table.arrivalAt} is null or julianday(${table.arrivalAt}) is not null) and (${table.providerCreatedAt} is null or julianday(${table.providerCreatedAt}) is not null)`
    )
  ]
)

export const stripeBalanceTransactions = sqliteTable(
  'stripe_balance_transactions',
  {
    id: text('id').primaryKey(),
    payoutId: text('payout_id').references(() => stripePayouts.id, { onDelete: 'restrict' }),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    reportingCategory: text('reporting_category').notNull(),
    amount: integer('amount').notNull(),
    fee: integer('fee').notNull(),
    net: integer('net').notNull(),
    currency: text('currency').notNull(),
    availableAt: text('available_at'),
    providerCreatedAt: text('provider_created_at'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn()
  },
  (table) => [
    index('stripe_balance_transactions_payout_idx').on(table.payoutId, table.availableAt),
    index('stripe_balance_transactions_source_idx').on(table.sourceType, table.sourceId),
    check('stripe_balance_transactions_id_check', sql`${table.id} glob 'txn_*'`),
    check('stripe_balance_transactions_net_check', sql`${table.net} = ${table.amount} - ${table.fee}`),
    check('stripe_balance_transactions_currency_check', validCurrency(table.currency)),
    check(
      'stripe_balance_transactions_dates_check',
      sql`(${table.availableAt} is null or julianday(${table.availableAt}) is not null) and (${table.providerCreatedAt} is null or julianday(${table.providerCreatedAt}) is not null)`
    )
  ]
)

export const stripeCharges = sqliteTable(
  'stripe_charges',
  {
    id: text('id').primaryKey(),
    customerId: text('customer_id').references(() => stripeCustomers.id, { onDelete: 'restrict' }),
    invoiceId: text('invoice_id').references(() => stripeInvoices.id, { onDelete: 'restrict' }),
    paymentIntentId: text('payment_intent_id'),
    balanceTransactionId: text('balance_transaction_id').references(() => stripeBalanceTransactions.id, {
      onDelete: 'restrict'
    }),
    status: text('status', { enum: stripeChargeStatuses }).notNull(),
    revenueCategory: text('revenue_category', { enum: revenueCategories }).notNull().default('unclassified'),
    amount: integer('amount').notNull(),
    amountCaptured: integer('amount_captured').notNull(),
    amountRefunded: integer('amount_refunded').notNull(),
    currency: text('currency').notNull(),
    paid: integer('paid', { mode: 'boolean' }).notNull(),
    disputed: integer('disputed', { mode: 'boolean' }).notNull(),
    providerCreatedAt: text('provider_created_at'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index('stripe_charges_customer_created_idx').on(table.customerId, table.providerCreatedAt),
    index('stripe_charges_invoice_idx').on(table.invoiceId),
    index('stripe_charges_revenue_idx').on(table.revenueCategory, table.status, table.providerCreatedAt),
    check('stripe_charges_id_check', sql`${table.id} glob 'ch_*' or ${table.id} glob 'py_*'`),
    check('stripe_charges_status_check', sql`${table.status} in ('pending', 'succeeded', 'failed')`),
    check(
      'stripe_charges_revenue_check',
      sql`${table.revenueCategory} in ('dues', 'donation', 'other', 'unclassified')`
    ),
    check(
      'stripe_charges_amount_check',
      sql`${table.amount} >= 0 and ${table.amountCaptured} >= 0 and ${table.amountCaptured} <= ${table.amount} and ${table.amountRefunded} >= 0 and ${table.amountRefunded} <= ${table.amountCaptured}`
    ),
    check('stripe_charges_currency_check', validCurrency(table.currency)),
    check(
      'stripe_charges_provider_created_check',
      sql`${table.providerCreatedAt} is null or julianday(${table.providerCreatedAt}) is not null`
    )
  ]
)

export const stripeRefunds = sqliteTable(
  'stripe_refunds',
  {
    id: text('id').primaryKey(),
    chargeId: text('charge_id')
      .notNull()
      .references(() => stripeCharges.id, { onDelete: 'restrict' }),
    balanceTransactionId: text('balance_transaction_id').references(() => stripeBalanceTransactions.id, {
      onDelete: 'restrict'
    }),
    status: text('status', { enum: stripeRefundStatuses }).notNull(),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    reason: text('reason'),
    providerCreatedAt: text('provider_created_at'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index('stripe_refunds_charge_idx').on(table.chargeId, table.status),
    check('stripe_refunds_id_check', sql`${table.id} glob 're_*'`),
    check(
      'stripe_refunds_status_check',
      sql`${table.status} in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled')`
    ),
    check('stripe_refunds_amount_check', sql`${table.amount} >= 0`),
    check('stripe_refunds_currency_check', validCurrency(table.currency)),
    check(
      'stripe_refunds_provider_created_check',
      sql`${table.providerCreatedAt} is null or julianday(${table.providerCreatedAt}) is not null`
    )
  ]
)

export const stripeDisputes = sqliteTable(
  'stripe_disputes',
  {
    id: text('id').primaryKey(),
    chargeId: text('charge_id')
      .notNull()
      .references(() => stripeCharges.id, { onDelete: 'restrict' }),
    balanceTransactionId: text('balance_transaction_id').references(() => stripeBalanceTransactions.id, {
      onDelete: 'restrict'
    }),
    status: text('status').notNull(),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    reason: text('reason'),
    providerCreatedAt: text('provider_created_at'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index('stripe_disputes_charge_idx').on(table.chargeId, table.status),
    check('stripe_disputes_id_check', sql`${table.id} glob 'dp_*'`),
    check('stripe_disputes_amount_check', sql`${table.amount} >= 0`),
    check('stripe_disputes_currency_check', validCurrency(table.currency)),
    check(
      'stripe_disputes_provider_created_check',
      sql`${table.providerCreatedAt} is null or julianday(${table.providerCreatedAt}) is not null`
    )
  ]
)

export type StripeSubscriptionStatus = (typeof stripeSubscriptionStatuses)[number]
export type StripeInvoiceStatus = (typeof stripeInvoiceStatuses)[number]
export type StripeChargeStatus = (typeof stripeChargeStatuses)[number]
export type StripeRefundStatus = (typeof stripeRefundStatuses)[number]
export type RevenueCategory = (typeof revenueCategories)[number]
export type StripeCustomer = typeof stripeCustomers.$inferSelect
export type StripeSubscription = typeof stripeSubscriptions.$inferSelect
export type MembershipDuesSubscription = typeof membershipDuesSubscriptions.$inferSelect
export type StripeInvoice = typeof stripeInvoices.$inferSelect
export type StripeCharge = typeof stripeCharges.$inferSelect
