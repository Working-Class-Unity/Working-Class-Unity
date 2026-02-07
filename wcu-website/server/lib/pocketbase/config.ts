interface PocketBaseCollectionConfig {
  authCollection: string
  magicLinkCollection: string
  memberProfileCollection: string
  duesRecordCollection: string
  memberProfileUserField: string
  duesRecordUserField: string
  buildingsCollection: string
  outreachCollection: string
  outreachDateField: string
  outreachBuildingField: string
  financeIncomeCollection: string
  financeExpenseCollection: string
  financeIncomeAmountField: string
  financeExpenseAmountField: string
  financeIncomeDateField: string
  financeExpenseDateField: string
}

const DEFAULT_AUTH_COLLECTION = 'users'
const DEFAULT_MAGIC_LINK_COLLECTION = 'auth_magic_links'
const DEFAULT_MEMBER_PROFILE_COLLECTION = 'member_profiles'
const DEFAULT_DUES_RECORD_COLLECTION = 'dues_records'
const DEFAULT_MEMBER_PROFILE_USER_FIELD = 'userId'
const DEFAULT_DUES_RECORD_USER_FIELD = 'userId'
const DEFAULT_BUILDINGS_COLLECTION = 'buildings'
const DEFAULT_OUTREACH_COLLECTION = 'outreach_interactions'
const DEFAULT_OUTREACH_DATE_FIELD = 'occurredAt'
const DEFAULT_OUTREACH_BUILDING_FIELD = 'buildingId'
const DEFAULT_FINANCE_INCOME_COLLECTION = 'dues_records'
const DEFAULT_FINANCE_EXPENSE_COLLECTION = 'expense_records'
const DEFAULT_FINANCE_INCOME_AMOUNT_FIELD = 'amountCents'
const DEFAULT_FINANCE_EXPENSE_AMOUNT_FIELD = 'amountCents'
const DEFAULT_FINANCE_INCOME_DATE_FIELD = 'paidAt'
const DEFAULT_FINANCE_EXPENSE_DATE_FIELD = 'spentAt'

export function getPocketBaseCollectionConfig(): PocketBaseCollectionConfig {
  const config = useRuntimeConfig()

  return {
    authCollection: config.pocketbaseAuthCollection || DEFAULT_AUTH_COLLECTION,
    magicLinkCollection: config.pocketbaseMagicLinkCollection || DEFAULT_MAGIC_LINK_COLLECTION,
    memberProfileCollection: config.pocketbaseMemberProfileCollection || DEFAULT_MEMBER_PROFILE_COLLECTION,
    duesRecordCollection: config.pocketbaseDuesRecordCollection || DEFAULT_DUES_RECORD_COLLECTION,
    memberProfileUserField: config.pocketbaseMemberProfileUserField || DEFAULT_MEMBER_PROFILE_USER_FIELD,
    duesRecordUserField: config.pocketbaseDuesRecordUserField || DEFAULT_DUES_RECORD_USER_FIELD,
    buildingsCollection: config.pocketbaseBuildingsCollection || DEFAULT_BUILDINGS_COLLECTION,
    outreachCollection: config.pocketbaseOutreachCollection || DEFAULT_OUTREACH_COLLECTION,
    outreachDateField: config.pocketbaseOutreachDateField || DEFAULT_OUTREACH_DATE_FIELD,
    outreachBuildingField: config.pocketbaseOutreachBuildingField || DEFAULT_OUTREACH_BUILDING_FIELD,
    financeIncomeCollection: config.pocketbaseFinanceIncomeCollection || DEFAULT_FINANCE_INCOME_COLLECTION,
    financeExpenseCollection: config.pocketbaseFinanceExpenseCollection || DEFAULT_FINANCE_EXPENSE_COLLECTION,
    financeIncomeAmountField: config.pocketbaseFinanceIncomeAmountField || DEFAULT_FINANCE_INCOME_AMOUNT_FIELD,
    financeExpenseAmountField: config.pocketbaseFinanceExpenseAmountField || DEFAULT_FINANCE_EXPENSE_AMOUNT_FIELD,
    financeIncomeDateField: config.pocketbaseFinanceIncomeDateField || DEFAULT_FINANCE_INCOME_DATE_FIELD,
    financeExpenseDateField: config.pocketbaseFinanceExpenseDateField || DEFAULT_FINANCE_EXPENSE_DATE_FIELD,
  }
}
