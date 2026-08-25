import type { DatabaseConnection } from '../db/connect'
import { conflictError } from '../utils/errors'
import {
  BillingStripeAccountDeletionPendingError,
  prepareBillingStripeAccountDeletion,
  withBillingStripeAccountDeletionProof,
  type BillingStripeAccountDeletionProof
} from './payments/stripe/account-deletion'
import type { BillingStripeRuntimeConfiguration } from './payments/stripe/configuration'

export type AccountDeletionBillingProof = BillingStripeAccountDeletionProof

export async function prepareAccountDeletionBilling(
  connection: DatabaseConnection,
  purchaserUserId: string,
  configuration: BillingStripeRuntimeConfiguration
): Promise<AccountDeletionBillingProof> {
  try {
    return await prepareBillingStripeAccountDeletion(connection, purchaserUserId, configuration)
  } catch (error) {
    if (error instanceof BillingStripeAccountDeletionPendingError) {
      throw conflictError('Account deletion is awaiting billing confirmation. Please retry.')
    }
    throw error
  }
}

export function withAccountDeletionBillingProof<T>(
  purchaserUserId: string,
  proof: AccountDeletionBillingProof,
  operation: () => Promise<T>
): Promise<T> {
  return withBillingStripeAccountDeletionProof(purchaserUserId, proof, operation)
}
