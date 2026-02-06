import { describe, expect, it } from 'vitest'
import type { RecordModel } from 'pocketbase'

import { buildYearToDateFinanceSummary, mapExpenseRecord } from '../../server/lib/finance/summary'

describe('Finance summary helpers', () => {
  it('builds a year-to-date summary from income and expenses', () => {
    const incomeRecords: RecordModel[] = [
      { id: 'in_1', paidAt: '2026-01-10T00:00:00.000Z', amountCents: 2700, incomeType: 'dues' },
      { id: 'in_2', paidAt: '2026-02-10T00:00:00.000Z', amountCents: 1000, incomeType: 'donation' },
    ] as RecordModel[]
    const expenseRecords: RecordModel[] = [
      { id: 'ex_1', spentAt: '2026-02-01T00:00:00.000Z', amountCents: 500 },
    ] as RecordModel[]

    const summary = buildYearToDateFinanceSummary(
      incomeRecords,
      expenseRecords,
      'paidAt',
      'spentAt',
      'amountCents',
      'amountCents',
      new Date('2026-03-01T00:00:00.000Z')
    )

    expect(summary.duesRevenueCents).toBe(2700)
    expect(summary.donationRevenueCents).toBe(1000)
    expect(summary.expenseTotalCents).toBe(500)
    expect(summary.netCents).toBe(3200)
  })

  it('maps expenses with safe defaults', () => {
    const expenseRecord = {
      id: 'ex_1',
      category: 'Printing',
      amountCents: '1200',
      spentAt: '2026-02-01T00:00:00.000Z',
      description: 'Leaflet batch',
      createdByUserId: 'u_1',
    } as RecordModel

    const expense = mapExpenseRecord(
      expenseRecord,
      'spentAt',
      'amountCents'
    )

    expect(expense.amountCents).toBe(1200)
    expect(expense.category).toBe('Printing')
    expect(expense.createdByUserId).toBe('u_1')
  })
})
