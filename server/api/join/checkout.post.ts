import { defineEventHandler, setHeader } from 'h3'
import {
  createStripeMembershipCheckout,
  stripeMembershipCheckoutSchema,
  stripeMembershipConfiguration
} from '../../services/membership/stripe-first'
import { requireBillingStripeReady } from '../../services/payments/stripe/composition'
import { readBillingStripeJsonCommandBody } from '../../services/payments/stripe/request-body'
import { getStripeClient } from '../../services/payments/stripe/stripe-client'
import { validateWithZod } from '../../services/payments/stripe/validation'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const ready = requireBillingStripeReady()
  const body = await readBillingStripeJsonCommandBody(
    event,
    validateWithZod(stripeMembershipCheckoutSchema, 'Invalid membership tier')
  )
  return createStripeMembershipCheckout(
    getStripeClient(ready.config),
    stripeMembershipConfiguration(ready.config),
    body.tier
  )
})
