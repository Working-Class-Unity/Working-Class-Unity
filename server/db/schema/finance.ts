import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { createdAtColumn, updatedAtColumn } from './core'
import { motions } from './governance'
import { externalRecordSnapshots } from './provenance'

export const budgetStatuses = ['draft', 'approved', 'superseded'] as const
export const budgetLineKinds = ['income', 'expense'] as const
export const recurringExpenseStatuses = ['active', 'ended', 'canceled'] as const
export const recurringExpenseCadences = ['weekly', 'monthly', 'quarterly', 'annual', 'other'] as const
export const cashLedgerKinds = [
  'dues',
  'donation',
  'other_income',
  'expense',
  'fee',
  'refund',
  'dispute',
  'transfer',
  'adjustment'
] as const
export const cashLedgerStatuses = ['pending', 'posted', 'void'] as const
export const financialVisibilities = ['public', 'members'] as const

const validCurrency = (currency: unknown) => sql`length(${currency}) = 3 and ${currency} = upper(${currency})`

export const budgets = sqliteTable(
  'budgets',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    periodStart: text('period_start').notNull(),
    periodEnd: text('period_end').notNull(),
    currency: text('currency').notNull().default('USD'),
    status: text('status', { enum: budgetStatuses }).notNull().default('draft'),
    approvingMotionId: text('approving_motion_id').references(() => motions.id, { onDelete: 'restrict' }),
    sourceUrl: text('source_url'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index('budgets_status_period_idx').on(table.status, table.periodStart, table.periodEnd),
    check('budgets_name_check', sql`length(trim(${table.name})) between 1 and 255`),
    check('budgets_status_check', sql`${table.status} in ('draft', 'approved', 'superseded')`),
    check('budgets_currency_check', validCurrency(table.currency)),
    check(
      'budgets_period_check',
      sql`julianday(${table.periodStart}) is not null and julianday(${table.periodEnd}) >= julianday(${table.periodStart})`
    ),
    check(
      'budgets_source_url_check',
      sql`${table.sourceUrl} is null or length(trim(${table.sourceUrl})) between 1 and 2000`
    )
  ]
)

export const budgetLines = sqliteTable(
  'budget_lines',
  {
    id: text('id').primaryKey(),
    budgetId: text('budget_id')
      .notNull()
      .references(() => budgets.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
    kind: text('kind', { enum: budgetLineKinds }).notNull(),
    category: text('category').notNull(),
    description: text('description').notNull(),
    amount: integer('amount').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex('budget_lines_budget_position_uidx').on(table.budgetId, table.position),
    index('budget_lines_budget_kind_idx').on(table.budgetId, table.kind),
    check('budget_lines_position_amount_check', sql`${table.position} >= 1 and ${table.amount} >= 0`),
    check('budget_lines_kind_check', sql`${table.kind} in ('income', 'expense')`),
    check('budget_lines_category_check', sql`length(trim(${table.category})) between 1 and 100`),
    check('budget_lines_description_check', sql`length(trim(${table.description})) between 1 and 1000`)
  ]
)

export const recurringExpenses = sqliteTable(
  'recurring_expenses',
  {
    id: text('id').primaryKey(),
    payee: text('payee').notNull(),
    purpose: text('purpose').notNull(),
    category: text('category').notNull(),
    cadence: text('cadence', { enum: recurringExpenseCadences }).notNull(),
    cadenceInterval: integer('cadence_interval').notNull().default(1),
    expectedAmount: integer('expected_amount').notNull(),
    currency: text('currency').notNull().default('USD'),
    status: text('status', { enum: recurringExpenseStatuses }).notNull().default('active'),
    effectiveFrom: text('effective_from').notNull(),
    effectiveTo: text('effective_to'),
    budgetLineId: text('budget_line_id').references(() => budgetLines.id, { onDelete: 'restrict' }),
    approvingMotionId: text('approving_motion_id').references(() => motions.id, { onDelete: 'restrict' }),
    approvalSourceUrl: text('approval_source_url'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index('recurring_expenses_status_idx').on(table.status, table.effectiveFrom),
    check('recurring_expenses_payee_check', sql`length(trim(${table.payee})) between 1 and 255`),
    check('recurring_expenses_purpose_check', sql`length(trim(${table.purpose})) between 1 and 1000`),
    check('recurring_expenses_category_check', sql`length(trim(${table.category})) between 1 and 100`),
    check(
      'recurring_expenses_cadence_check',
      sql`${table.cadence} in ('weekly', 'monthly', 'quarterly', 'annual', 'other') and ${table.cadenceInterval} >= 1`
    ),
    check('recurring_expenses_amount_check', sql`${table.expectedAmount} >= 0`),
    check('recurring_expenses_currency_check', validCurrency(table.currency)),
    check('recurring_expenses_status_check', sql`${table.status} in ('active', 'ended', 'canceled')`),
    check(
      'recurring_expenses_interval_check',
      sql`julianday(${table.effectiveFrom}) is not null and (${table.effectiveTo} is null or julianday(${table.effectiveTo}) > julianday(${table.effectiveFrom}))`
    ),
    check(
      'recurring_expenses_lifecycle_check',
      sql`(${table.status} = 'active' and ${table.effectiveTo} is null) or (${table.status} in ('ended', 'canceled') and ${table.effectiveTo} is not null)`
    ),
    check(
      'recurring_expenses_source_url_check',
      sql`${table.approvalSourceUrl} is null or length(trim(${table.approvalSourceUrl})) between 1 and 2000`
    )
  ]
)

export const cashLedgerEntries = sqliteTable(
  'cash_ledger_entries',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: cashLedgerKinds }).notNull(),
    status: text('status', { enum: cashLedgerStatuses }).notNull().default('posted'),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull().default('USD'),
    occurredAt: text('occurred_at').notNull(),
    category: text('category').notNull(),
    description: text('description').notNull(),
    counterparty: text('counterparty'),
    visibility: text('visibility', { enum: financialVisibilities }).notNull(),
    budgetLineId: text('budget_line_id').references(() => budgetLines.id, { onDelete: 'restrict' }),
    recurringExpenseId: text('recurring_expense_id').references(() => recurringExpenses.id, {
      onDelete: 'restrict'
    }),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id'),
    sourceComponent: text('source_component').notNull().default('primary'),
    sourceSnapshotId: text('source_snapshot_id').references(() => externalRecordSnapshots.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex('cash_ledger_source_uidx')
      .on(table.sourceType, table.sourceId, table.sourceComponent)
      .where(sql`${table.sourceId} is not null`),
    index('cash_ledger_occurred_idx').on(table.occurredAt, table.kind),
    index('cash_ledger_budget_line_idx').on(table.budgetLineId, table.occurredAt),
    index('cash_ledger_recurring_expense_idx').on(table.recurringExpenseId, table.occurredAt),
    check(
      'cash_ledger_kind_check',
      sql`${table.kind} in ('dues', 'donation', 'other_income', 'expense', 'fee', 'refund', 'dispute', 'transfer', 'adjustment')`
    ),
    check('cash_ledger_status_check', sql`${table.status} in ('pending', 'posted', 'void')`),
    check(
      'cash_ledger_amount_check',
      sql`(${table.kind} in ('dues', 'donation', 'other_income') and ${table.amount} > 0) or (${table.kind} in ('expense', 'fee', 'refund', 'dispute') and ${table.amount} < 0) or (${table.kind} in ('transfer', 'adjustment') and ${table.amount} <> 0)`
    ),
    check('cash_ledger_currency_check', validCurrency(table.currency)),
    check('cash_ledger_occurred_at_check', sql`julianday(${table.occurredAt}) is not null`),
    check('cash_ledger_category_check', sql`length(trim(${table.category})) between 1 and 100`),
    check('cash_ledger_description_check', sql`length(trim(${table.description})) between 1 and 1000`),
    check(
      'cash_ledger_counterparty_check',
      sql`${table.counterparty} is null or length(trim(${table.counterparty})) between 1 and 255`
    ),
    check('cash_ledger_visibility_check', sql`${table.visibility} in ('public', 'members')`),
    check(
      'cash_ledger_privacy_check',
      sql`(${table.kind} = 'expense' and ${table.visibility} = 'public') or (${table.kind} in ('dues', 'donation') and ${table.visibility} = 'members') or ${table.kind} in ('other_income', 'fee', 'refund', 'dispute', 'transfer', 'adjustment')`
    ),
    check('cash_ledger_source_type_check', sql`length(trim(${table.sourceType})) between 1 and 100`),
    check(
      'cash_ledger_source_identity_check',
      sql`(${table.sourceId} is null and ${table.sourceComponent} = 'primary') or (${table.sourceId} is not null and length(trim(${table.sourceId})) between 1 and 255 and length(trim(${table.sourceComponent})) between 1 and 100)`
    )
  ]
)

export type BudgetStatus = (typeof budgetStatuses)[number]
export type BudgetLineKind = (typeof budgetLineKinds)[number]
export type CashLedgerKind = (typeof cashLedgerKinds)[number]
export type CashLedgerStatus = (typeof cashLedgerStatuses)[number]
export type Budget = typeof budgets.$inferSelect
export type BudgetLine = typeof budgetLines.$inferSelect
export type RecurringExpense = typeof recurringExpenses.$inferSelect
export type CashLedgerEntry = typeof cashLedgerEntries.$inferSelect
