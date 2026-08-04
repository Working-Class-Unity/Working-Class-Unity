import { readValidatedBody, setHeader } from 'h3'
import { emptyBillingCommandSchema } from '../../../db/schema'
import { createBillingPortal } from '../../../services/payments/billing-service'
import { requireSession } from '../../../utils/auth/require-session'
import { validateWithZod } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const session = await requireSession(event)
  await readValidatedBody(event, validateWithZod(emptyBillingCommandSchema, 'Invalid billing-management request'))
  return createBillingPortal(session)
})
