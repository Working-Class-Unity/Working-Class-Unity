import type { RecordModel } from 'pocketbase'

import type { ExpenseRecord, FinanceSummary } from '~~/shared/types/finance'

const normalizeNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value)
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) {
      return Math.round(parsed)
    }
  }

  return 0
}

const normalizeString = (value: unknown): string => {
  return typeof value === 'string' ? value : ''
}

const inRange = (value: string, periodStart: Date, periodEnd: Date): boolean => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return false

  return date >= periodStart && date <= periodEnd
}

export function buildYearToDateFinanceSummary(
  incomeRecords: RecordModel[],
  expenseRecords: RecordModel[],
  incomeDateField: string,
  expenseDateField: string,
  incomeAmountField: string,
  expenseAmountField: string,
  now = new Date()
): FinanceSummary {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0))
  const periodEnd = now

  let duesRevenueCents = 0
  let donationRevenueCents = 0
  let expenseTotalCents = 0

  for (const incomeRecord of incomeRecords) {
    const dateValue = normalizeString(incomeRecord[incomeDateField] ?? incomeRecord.paidAt ?? incomeRecord.created)
    if (!inRange(dateValue, periodStart, periodEnd)) continue

    const amount = normalizeNumber(incomeRecord[incomeAmountField] ?? incomeRecord.amountCents ?? incomeRecord.amount)
    const incomeType = normalizeString(incomeRecord.incomeType ?? incomeRecord.type)

    if (incomeType === 'donation') {
      donationRevenueCents += amount
    } else {
      duesRevenueCents += amount
    }
  }

  for (const expenseRecord of expenseRecords) {
    const dateValue = normalizeString(expenseRecord[expenseDateField] ?? expenseRecord.spentAt ?? expenseRecord.created)
    if (!inRange(dateValue, periodStart, periodEnd)) continue

    expenseTotalCents += normalizeNumber(
      expenseRecord[expenseAmountField]
      ?? expenseRecord.amountCents
      ?? expenseRecord.amount
    )
  }

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    duesRevenueCents,
    donationRevenueCents,
    expenseTotalCents,
    netCents: duesRevenueCents + donationRevenueCents - expenseTotalCents,
    currency: 'USD',
  }
}

export function mapExpenseRecord(
  record: RecordModel,
  expenseDateField: string,
  expenseAmountField: string
): ExpenseRecord {
  return {
    id: record.id,
    category: normalizeString(record.category) || 'Uncategorized',
    amountCents: normalizeNumber(record[expenseAmountField] ?? record.amountCents ?? record.amount),
    currency: normalizeString(record.currency) || 'USD',
    spentAt: normalizeString(record[expenseDateField] ?? record.spentAt ?? record.created),
    description: normalizeString(record.description),
    createdByUserId: normalizeString(record.createdByUserId ?? record.createdBy ?? record.userId ?? record.user),
  }
}
