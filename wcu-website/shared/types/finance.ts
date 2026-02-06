export interface FinanceSummary {
  periodStart: string
  periodEnd: string
  duesRevenueCents: number
  donationRevenueCents: number
  expenseTotalCents: number
  netCents: number
  currency: string
}

export interface ExpenseRecord {
  id: string
  category: string
  amountCents: number
  currency: string
  spentAt: string
  description: string
  createdByUserId: string
}

export interface FinanceSummaryResponse {
  summary: FinanceSummary
  recentExpenses: ExpenseRecord[]
}
