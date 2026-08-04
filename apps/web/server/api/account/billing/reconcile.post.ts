import { createError, readValidatedBody, setHeader } from 'h3'
import { emptyBillingCommandSchema } from '../../../db/schema'
import { consumeBillingReconciliationRateLimit } from '../../../services/payments/billing-reconciliation-rate-limit'
import { reconcileBilling } from '../../../services/payments/billing-service'
import { requireSession } from '../../../utils/auth/require-session'
import { validateWithZod } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const session = await requireSession(event)
  await readValidatedBody(event, validateWithZod(emptyBillingCommandSchema, 'Invalid billing-reconciliation request'))
  const rateLimit = consumeBillingReconciliationRateLimit(session.user.id)
  if (!rateLimit.allowed) {
    setHeader(event, 'retry-after', rateLimit.retryAfterSeconds)
    throw createError({ statusCode: 429, statusMessage: 'Billing reconciliation is temporarily rate limited' })
  }
  return reconcileBilling(session)
})
