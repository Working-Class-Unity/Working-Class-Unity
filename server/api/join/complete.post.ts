import { defineEventHandler, setHeader } from 'h3'
import { getTransactionalEmailSender } from '../../services/email'
import {
  issueStripeMembershipMagicLink,
  stripeMembershipCompletionSchema,
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
    validateWithZod(stripeMembershipCompletionSchema, 'Invalid Checkout Session')
  )
  await issueStripeMembershipMagicLink({
    client: getStripeClient(ready.config),
    config: stripeMembershipConfiguration(ready.config),
    connection: ready.composition.connection(),
    sender: getTransactionalEmailSender(),
    sessionId: body.sessionId
  })
  return { status: true }
})
