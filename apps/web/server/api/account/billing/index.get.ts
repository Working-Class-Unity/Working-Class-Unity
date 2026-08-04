import { setHeader } from 'h3'
import { getBillingState } from '../../../services/payments/billing-service'
import { requireSession } from '../../../utils/auth/require-session'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const session = await requireSession(event)
  return getBillingState(session)
})
