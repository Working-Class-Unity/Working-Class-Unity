export const accountDeletionBillingPendingCode = 'ACCOUNT_DELETION_BILLING_PENDING' as const

declare const billingAccountDeletionProofBrand: unique symbol

export type BillingStripeAccountDeletionProof = Readonly<{
  [billingAccountDeletionProofBrand]: true
}>

export class BillingStripeAccountDeletionPendingError extends Error {
  readonly code = accountDeletionBillingPendingCode

  constructor() {
    super('Account deletion is awaiting billing confirmation. Please retry.')
    this.name = 'BillingStripeAccountDeletionPendingError'
  }
}
