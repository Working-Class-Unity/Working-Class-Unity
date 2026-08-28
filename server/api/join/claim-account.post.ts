import { defineEventHandler, setHeader } from 'h3'
import { z } from 'zod'
import { useDatabase } from '../../db/client'
import { claimUniquePublicJoinForAccount } from '../../services/membership/public-join'
import { readBillingStripeJsonCommandBody } from '../../services/payments/stripe/request-body'
import { requireSession } from '../../utils/auth/require-session'
import { getAppRuntimeConfig } from '../../utils/runtime'
import { unauthorizedError, validationError } from '../../utils/errors'
import { publicJoinAttemptIdPattern } from '../../../shared/join'

const accountClaimSchema = z.object({ attemptId: z.string().regex(publicJoinAttemptIdPattern) }).strict()

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const session = await requireSession(event)
  const body = await readBillingStripeJsonCommandBody(event, (value) => {
    const parsed = accountClaimSchema.safeParse(value)
    if (!parsed.success) throw validationError('Invalid membership claim')
    return parsed.data
  })
  const connection = useDatabase()
  const user = connection.sqlite
    .prepare('select id, email, email_verified as emailVerified from user where id = ?')
    .get(session.user.id) as { email: string; emailVerified: number; id: string } | undefined
  if (!user) throw unauthorizedError()
  const outcome = claimUniquePublicJoinForAccount(
    connection,
    { id: user.id, email: user.email, emailVerified: user.emailVerified === 1 },
    getAppRuntimeConfig().betterAuth.secret,
    new Date(),
    body.attemptId
  )
  return { outcome }
})
