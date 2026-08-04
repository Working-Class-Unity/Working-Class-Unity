import { readValidatedBody, setHeader } from 'h3'
import { createCheckoutSchema } from '../../../db/schema'
import { createBillingCheckout } from '../../../services/payments/billing-service'
import { requireSession } from '../../../utils/auth/require-session'
import { validateWithZod } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const session = await requireSession(event)
  const body = await readValidatedBody(event, validateWithZod(createCheckoutSchema, 'Invalid checkout request'))
  return createBillingCheckout(session, body)
})
