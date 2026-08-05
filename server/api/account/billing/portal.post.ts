import { defineEventHandler, setHeader } from 'h3'
import { createBillingStripePortal } from '../../../services/payments/stripe/billing-service'
import { reportBillingStripeFailure, requireBillingStripeReady } from '../../../services/payments/stripe/composition'
import { readBillingStripeJsonCommandBody } from '../../../services/payments/stripe/request-body'
import { getStripeClient } from '../../../services/payments/stripe/stripe-client'
import { emptyBillingCommandSchema, validateWithZod } from '../../../services/payments/stripe/validation'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const ready = requireBillingStripeReady()
  const purchaserUserId = await ready.composition.requireUserId(event)
  await readBillingStripeJsonCommandBody(
    event,
    validateWithZod(emptyBillingCommandSchema, 'Invalid billing-management request')
  )
  try {
    return await createBillingStripePortal(
      {
        connection: ready.composition.connection(),
        client: getStripeClient(ready.config),
        config: ready.config,
        integration: ready.composition.integration
      },
      purchaserUserId
    )
  } catch (error) {
    await reportBillingStripeFailure(error, 'portal')
    throw error
  }
})
