import type { DatabaseConnection } from '../../db/connect'
import type { JsonValue } from '../../db/schema'
import type { AppRuntimeConfig } from '../../utils/runtime'
import { processStripeWebhookReferenceForConnection } from './billing-webhook'
import { parseStripeWebhookEventReference, type StripeWebhookEventReference } from './billing-webhook-reference'
import type { StripeBillingClient } from './stripe-client'

export type BillingWebhookReconciliationContext = Readonly<{
  connection: DatabaseConnection
  client: StripeBillingClient
  config: AppRuntimeConfig
}>

export function createBillingWebhookReconciliationHandler(context: BillingWebhookReconciliationContext) {
  return async (payload: JsonValue): Promise<void> => {
    const reference = parseStripeWebhookEventReference(payload)
    await processStripeWebhookReferenceForConnection(
      context.connection,
      context.client,
      context.config,
      reference,
      false
    )
  }
}

export async function reconcileStripeWebhookReferenceForConnection(
  context: BillingWebhookReconciliationContext,
  reference: StripeWebhookEventReference
) {
  return processStripeWebhookReferenceForConnection(
    context.connection,
    context.client,
    context.config,
    reference,
    false
  )
}
