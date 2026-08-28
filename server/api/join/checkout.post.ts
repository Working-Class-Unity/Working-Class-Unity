import { defineEventHandler, setHeader } from 'h3'
import { createPublicJoinCheckout } from '../../services/membership/public-join'
import { reportBillingStripeFailure, requireBillingStripeReady } from '../../services/payments/stripe/composition'
import { readBillingStripeJsonCommandBody } from '../../services/payments/stripe/request-body'
import { getStripeClient } from '../../services/payments/stripe/stripe-client'
import { billingOfferingCommandSchema, validateWithZod } from '../../services/payments/stripe/validation'
import { getOptionalSession } from '../../utils/auth/require-session'
import { isMembershipDuesOfferingKey } from '../../../shared/billing'
import { forbiddenError } from '../../utils/errors'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const body = await readBillingStripeJsonCommandBody(
    event,
    validateWithZod(billingOfferingCommandSchema, 'Invalid checkout request')
  )
  if (!isMembershipDuesOfferingKey(body.offering)) throw forbiddenError('Unsupported membership offering')
  const ready = requireBillingStripeReady()
  const context = {
    connection: ready.composition.connection(),
    client: getStripeClient(ready.config),
    config: ready.config
  }
  try {
    const session = await getOptionalSession(event)
    return await createPublicJoinCheckout(context, body.offering, new Date(), session?.user.id ?? null)
  } catch (error) {
    await reportBillingStripeFailure(error, 'checkout')
    throw error
  }
})
