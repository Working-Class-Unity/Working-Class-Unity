import { defineEventHandler, sendWebResponse, type EventHandler, type H3Event } from 'h3'
import { z } from 'zod'
import type { AppSession } from '../utils/auth/require-session'
import { readValidatedBodyWithByteLimit } from '../utils/request-body'
import { validateWithZod } from '../utils/validation'
import type { AccountDeletionBillingProof } from './account-deletion-billing'

export const accountDeletionConfirmation = 'DELETE' as const
export const accountDeletionBodyLimitBytes = 65_536

const accountDeletionRequestSchema = z
  .object({
    confirmation: z.literal(accountDeletionConfirmation)
  })
  .strict()

export type AccountDeletionCommandDependencies = Readonly<{
  requireSession: (event: H3Event) => Promise<AppSession>
  assertFreshSession: (session: AppSession) => void
  prepareDeletion: (userId: string) => Promise<AccountDeletionBillingProof>
  requestHeaders: (event: H3Event) => Headers
  deleteUser: (headers: Headers, billingProof: AccountDeletionBillingProof, userId: string) => Promise<Response>
}>

export function createAccountDeletionHandler(dependencies: AccountDeletionCommandDependencies): EventHandler {
  return defineEventHandler(async (event) => {
    // Keep authentication and freshness checks first so malformed or injected
    // input does not turn this destructive command into an account/session oracle.
    const session = await dependencies.requireSession(event)
    dependencies.assertFreshSession(session)
    await readValidatedBodyWithByteLimit(
      event,
      accountDeletionBodyLimitBytes,
      validateWithZod(accountDeletionRequestSchema, 'Exact account-deletion confirmation is required')
    )
    const billingProof = await dependencies.prepareDeletion(session.user.id)

    const response = await dependencies.deleteUser(dependencies.requestHeaders(event), billingProof, session.user.id)

    const headers = new Headers(response.headers)
    headers.set('cache-control', 'private, no-store')
    return sendWebResponse(
      event,
      new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      })
    )
  })
}
