import { defineEventHandler, setHeader } from 'h3'
import { changeBillingStripeOffering } from '../../../services/payments/stripe/billing-service'
import { reportBillingStripeFailure, requireBillingStripeReady } from '../../../services/payments/stripe/composition'
import { readBillingStripeJsonCommandBody } from '../../../services/payments/stripe/request-body'
import { getStripeClient } from '../../../services/payments/stripe/stripe-client'
import { billingOfferingCommandSchema, validateWithZod } from '../../../services/payments/stripe/validation'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const ready = requireBillingStripeReady()
  const purchaserUserId = await ready.composition.requireUserId(event)
  const body = await readBillingStripeJsonCommandBody(
    event,
    validateWithZod(billingOfferingCommandSchema, 'Invalid billing-change request')
  )
  try {
    return await changeBillingStripeOffering(
      {
        connection: ready.composition.connection(),
        client: getStripeClient(ready.config),
        config: ready.config,
        integration: ready.composition.integration
      },
      purchaserUserId,
      body.offering
    )
  } catch (error) {
    await reportBillingStripeFailure(error, 'change')
    throw error
  }
})
