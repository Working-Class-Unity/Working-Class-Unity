import { defineEventHandler, readValidatedBody, sendWebResponse, type EventHandler, type H3Event } from 'h3'
import { z } from 'zod'
import type { AppSession } from '../utils/auth/require-session'
import { validateWithZod } from '../utils/validation'

export const accountDeletionConfirmation = 'DELETE' as const

const accountDeletionRequestSchema = z
  .object({
    confirmation: z.literal(accountDeletionConfirmation)
  })
  .strict()

export type AccountDeletionCommandDependencies = Readonly<{
  requireSession: (event: H3Event) => Promise<AppSession>
  assertFreshSession: (session: AppSession) => void
  prepareDeletion: (userId: string) => Promise<string>
  requestHeaders: (event: H3Event) => Headers
  deleteUser: (headers: Headers, billingProof: string, userId: string) => Promise<Response>
}>

export function createAccountDeletionHandler(dependencies: AccountDeletionCommandDependencies): EventHandler {
  return defineEventHandler(async (event) => {
    // Keep authentication first so malformed or injected input does not turn
    // this destructive command into an account/session oracle.
    const session = await dependencies.requireSession(event)
    await readValidatedBody(
      event,
      validateWithZod(accountDeletionRequestSchema, 'Exact account-deletion confirmation is required')
    )
    dependencies.assertFreshSession(session)
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
