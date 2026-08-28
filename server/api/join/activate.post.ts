import { defineEventHandler, setHeader } from 'h3'
import { z } from 'zod'
import { membershipConnectionKinds } from '../../db/schema/membership'
import { useDatabase } from '../../db/client'
import { activatePublicJoinMembership } from '../../services/membership/public-join'
import { readBillingStripeJsonCommandBody } from '../../services/payments/stripe/request-body'
import { requireSession } from '../../utils/auth/require-session'
import { conflictError, validationError } from '../../utils/errors'
import { publicJoinAttemptIdPattern } from '../../../shared/join'

const activationSchema = z
  .object({
    attemptId: z.string().regex(publicJoinAttemptIdPattern),
    connectionKind: z.enum(membershipConnectionKinds),
    codeOfConductAccepted: z.literal(true)
  })
  .strict()

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const session = await requireSession(event)
  const body = await readBillingStripeJsonCommandBody(event, (value) => {
    const parsed = activationSchema.safeParse(value)
    if (!parsed.success) throw validationError('Invalid membership confirmation')
    return parsed.data
  })
  const outcome = activatePublicJoinMembership(useDatabase(), session.user.id, body)
  if (outcome !== 'active') throw conflictError('Membership confirmation is unavailable')
  return { outcome }
})
