import { ClientResponseError, type RecordModel } from 'pocketbase'

import type { FinanceSummaryResponse } from '~~/shared/types/finance'

import { assertDuesCurrent } from '~~/server/lib/auth/rbac'
import { buildYearToDateFinanceSummary, mapExpenseRecord } from '~~/server/lib/finance/summary'
import { getPocketBaseCollectionConfig } from '~~/server/lib/pocketbase/config'
import { getPocketBaseServiceClient } from '~~/server/lib/pocketbase/client'

const isNotFoundError = (error: unknown): boolean => {
  return error instanceof ClientResponseError && error.status === 404
}

async function safeGetFullList(collectionName: string, options: Record<string, unknown>): Promise<RecordModel[]> {
  const serviceClient = await getPocketBaseServiceClient()

  try {
    return await serviceClient.collection(collectionName).getFullList<RecordModel>(options)
  } catch (error) {
    if (isNotFoundError(error)) {
      return []
    }

    throw createError({
      statusCode: 500,
      statusMessage: `Unable to query ${collectionName}`,
    })
  }
}

export default defineEventHandler(async (event): Promise<FinanceSummaryResponse> => {
  assertDuesCurrent(event)

  const {
    financeIncomeCollection,
    financeExpenseCollection,
    financeIncomeAmountField,
    financeExpenseAmountField,
    financeIncomeDateField,
    financeExpenseDateField,
  } = getPocketBaseCollectionConfig()

  const periodStart = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1, 0, 0, 0, 0)).toISOString()
  const serviceClient = await getPocketBaseServiceClient()

  const [incomeRecords, expenseRecords] = await Promise.all([
    safeGetFullList(financeIncomeCollection, {
      filter: serviceClient.filter(`${financeIncomeDateField} >= {:periodStart}`, { periodStart }),
      sort: `-${financeIncomeDateField}`,
    }),
    safeGetFullList(financeExpenseCollection, {
      filter: serviceClient.filter(`${financeExpenseDateField} >= {:periodStart}`, { periodStart }),
      sort: `-${financeExpenseDateField}`,
    }),
  ])

  const summary = buildYearToDateFinanceSummary(
    incomeRecords,
    expenseRecords,
    financeIncomeDateField,
    financeExpenseDateField,
    financeIncomeAmountField,
    financeExpenseAmountField
  )

  return {
    summary,
    recentExpenses: expenseRecords.slice(0, 12).map((record) => {
      return mapExpenseRecord(record, financeExpenseDateField, financeExpenseAmountField)
    }),
  }
})
