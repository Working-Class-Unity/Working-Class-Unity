import { createError, defineEventHandler, setHeader } from 'h3'
import { reconcileBillingStripe } from '../../../services/payments/stripe/billing-service'
import { reportBillingStripeFailure, requireBillingStripeReady } from '../../../services/payments/stripe/composition'
import { consumeBillingReconciliationRateLimit } from '../../../services/payments/stripe/reconciliation-rate-limit'
import { readBillingStripeJsonCommandBody } from '../../../services/payments/stripe/request-body'
import { getStripeClient } from '../../../services/payments/stripe/stripe-client'
import { emptyBillingCommandSchema, validateWithZod } from '../../../services/payments/stripe/validation'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const ready = requireBillingStripeReady()
  const purchaserUserId = await ready.composition.requireUserId(event)
  await readBillingStripeJsonCommandBody(
    event,
    validateWithZod(emptyBillingCommandSchema, 'Invalid billing-reconciliation request')
  )
  const rateLimit = consumeBillingReconciliationRateLimit(purchaserUserId)
  if (!rateLimit.allowed) {
    setHeader(event, 'retry-after', rateLimit.retryAfterSeconds)
    throw createError({ statusCode: 429, statusMessage: 'Billing reconciliation is temporarily rate limited' })
  }
  try {
    return await reconcileBillingStripe(
      {
        connection: ready.composition.connection(),
        client: getStripeClient(ready.config),
        config: ready.config,
        integration: ready.composition.integration
      },
      purchaserUserId
    )
  } catch (error) {
    await reportBillingStripeFailure(error, 'reconcile')
    throw error
  }
})
