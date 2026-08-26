import { defineEventHandler, setHeader } from 'h3'
import { requireBillingStripeReady } from '../../services/payments/stripe/composition'
import { readAccountMembershipState } from '../../services/membership/member-access'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const ready = requireBillingStripeReady()
  const userId = await ready.composition.requireUserId(event)
  return readAccountMembershipState(ready.composition.connection(), userId, ready.config.stripe.prices)
})
