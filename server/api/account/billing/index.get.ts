import { defineEventHandler, setHeader } from 'h3'
import { getBillingStripeState } from '../../../services/payments/stripe/billing-service'
import { requireBillingStripeReady } from '../../../services/payments/stripe/composition'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const ready = requireBillingStripeReady()
  const purchaserUserId = await ready.composition.requireUserId(event)
  return getBillingStripeState(ready.composition.connection(), purchaserUserId, ready.composition.integration)
})
