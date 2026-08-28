import { defineEventHandler, setHeader } from 'h3'
import { z } from 'zod'
import { useDatabase } from '../../db/client'
import { claimPublicJoinAttempt } from '../../services/membership/public-join'
import { readBillingStripeJsonCommandBody } from '../../services/payments/stripe/request-body'
import { getAppRuntimeConfig } from '../../utils/runtime'
import { requireSession } from '../../utils/auth/require-session'
import { conflictError, unauthorizedError, validationError } from '../../utils/errors'
import { publicJoinAttemptIdPattern, publicJoinClaimTokenPattern } from '../../../shared/join'

const claimSchema = z
  .object({
    attemptId: z.string().regex(publicJoinAttemptIdPattern),
    token: z.string().regex(publicJoinClaimTokenPattern)
  })
  .strict()

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const session = await requireSession(event)
  const body = await readBillingStripeJsonCommandBody(event, (value) => {
    const parsed = claimSchema.safeParse(value)
    if (!parsed.success) throw validationError('Invalid membership claim')
    return parsed.data
  })
  const connection = useDatabase()
  const user = connection.sqlite
    .prepare('select id, email, email_verified as emailVerified from user where id = ?')
    .get(session.user.id) as { email: string; emailVerified: number; id: string } | undefined
  if (!user) throw unauthorizedError()
  const outcome = claimPublicJoinAttempt(
    connection,
    { id: user.id, email: user.email, emailVerified: user.emailVerified === 1 },
    {
      attemptId: body.attemptId,
      token: body.token,
      reviewHashKey: getAppRuntimeConfig().betterAuth.secret
    }
  )
  if (outcome === 'ignored' || outcome === 'expired') throw conflictError('Membership claim is unavailable')
  return { outcome }
})
