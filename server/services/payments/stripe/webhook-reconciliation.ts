import type { JobHandler, JobPayload } from '../../jobs/job-queue'
import type { BillingStripeRuntimeConfiguration } from './configuration'
import type { BillingStripeConnection, BillingStripeIntegration } from './public-contract'
import type { StripeBillingClient } from './stripe-client'
import { processStripeWebhookReference } from './webhook'
import { parseStripeWebhookEventReference, type StripeWebhookEventReference } from './webhook-reference'

export type BillingWebhookReconciliationContext = Readonly<{
  connection: BillingStripeConnection
  client: StripeBillingClient
  config: BillingStripeRuntimeConfiguration
  integration?: BillingStripeIntegration<BillingStripeConnection, unknown>
}>

export function createBillingWebhookReconciliationHandler(context: BillingWebhookReconciliationContext): JobHandler {
  return async (payload: JobPayload) => {
    await reconcileStripeWebhookReference(context, parseStripeWebhookEventReference(payload))
  }
}

export async function reconcileStripeWebhookReference(
  context: BillingWebhookReconciliationContext,
  reference: StripeWebhookEventReference
) {
  return processStripeWebhookReference(
    context.connection,
    context.client,
    context.config,
    context.integration,
    reference,
    false
  )
}
