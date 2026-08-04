import { readValidatedBody, setHeader } from 'h3'
import { changeBillingOfferingSchema } from '../../../db/schema'
import { changeBillingOffering } from '../../../services/payments/billing-service'
import { requireSession } from '../../../utils/auth/require-session'
import { validateWithZod } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const session = await requireSession(event)
  const body = await readValidatedBody(
    event,
    validateWithZod(changeBillingOfferingSchema, 'Invalid billing-change request')
  )
  return changeBillingOffering(session, body)
})
