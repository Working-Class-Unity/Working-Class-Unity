import { z } from 'zod'
import type { DatabaseConnection } from '../../db/connect'
import type { JsonValue } from '../../db/schema'
import type { JobHandler } from '../jobs/job-queue'
import type { StripeBillingCatalog } from './billing-catalog'
import {
  convergeBillingAccountDeletionCancellation,
  type BillingAccountDeletionStripeClientFactory
} from './billing-account-deletion'
import {
  billingAccountDeletionCancellationJobType,
  ensureBillingAccountDeletionCancellationJobs
} from './billing-account-deletion-store'

export { billingAccountDeletionCancellationJobType, ensureBillingAccountDeletionCancellationJobs }

const billingAccountDeletionCancellationPayloadSchema = z
  .object({
    requestId: z.string().trim().min(1).max(128)
  })
  .strict()

export function createBillingAccountDeletionCancellationJobHandler(
  connection: DatabaseConnection,
  getClient: BillingAccountDeletionStripeClientFactory,
  catalog?: StripeBillingCatalog
): JobHandler {
  return async (payload: JsonValue) => {
    const parsed = billingAccountDeletionCancellationPayloadSchema.safeParse(payload)
    if (!parsed.success) throw new Error('Invalid billing account deletion cancellation job payload')

    const result = await convergeBillingAccountDeletionCancellation(
      connection,
      parsed.data.requestId,
      getClient,
      catalog
    )
    if (result === 'pending') {
      throw new Error('Billing account deletion cancellation is not confirmed')
    }
  }
}
