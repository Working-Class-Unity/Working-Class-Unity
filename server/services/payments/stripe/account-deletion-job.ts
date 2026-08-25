import type { JobHandler, JobPayload } from '../../jobs/job-queue'
import { z } from 'zod'
import { convergeBillingStripeAccountDeletion, type BillingAccountDeletionStripeClient } from './account-deletion'
import { createStripeBillingCatalog } from './catalog'
import type { BillingStripeRuntimeConfiguration } from './configuration'
import type { BillingStripeConnection } from './public-contract'
import { createStripeClient } from './stripe-client'

const payloadSchema = z.object({ requestId: z.string().trim().min(1).max(128) }).strict()

export function createBillingAccountDeletionCancellationJobHandler(
  connection: BillingStripeConnection,
  configuration: BillingStripeRuntimeConfiguration
): JobHandler {
  return createBillingAccountDeletionCancellationJobHandlerWithClient(
    connection,
    () => createStripeClient(configuration.stripe.secretKey),
    configuration
  )
}

export function createBillingAccountDeletionCancellationJobHandlerWithClient(
  connection: BillingStripeConnection,
  getClient: () => BillingAccountDeletionStripeClient,
  configuration: BillingStripeRuntimeConfiguration
): JobHandler {
  const catalog = createStripeBillingCatalog(configuration.stripe.prices)
  return async (payload: JobPayload) => {
    const parsed = payloadSchema.safeParse(payload)
    if (!parsed.success) throw new Error('Invalid Billing account deletion cancellation payload')
    const result = await convergeBillingStripeAccountDeletion(connection, parsed.data.requestId, getClient, catalog)
    if (result === 'pending') {
      throw new Error('Billing account deletion cancellation is not confirmed')
    }
  }
}
