import { readValidatedBody, setHeader, setResponseStatus } from 'h3'
import { z } from 'zod'
import { useDatabase } from '../../db/client'
import { getTransactionalEmailSender } from '../../services/email'
import { sendWorkspaceInvitation } from '../../services/workspace-invitations'
import { auth } from '../../utils/auth'
import { getBetterAuthRequestHeaders, requireSession } from '../../utils/auth/require-session'
import { requireModuleReady } from '../../utils/module-state'
import { getAppRuntimeConfig } from '../../utils/runtime'
import { validateWithZod } from '../../utils/validation'

const workspaceInvitationRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email())
  })
  .strict()

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')

  const session = await requireSession(event)
  requireModuleReady('billing')
  const body = await readValidatedBody(
    event,
    validateWithZod(workspaceInvitationRequestSchema, 'Invalid invitation request')
  )
  const config = getAppRuntimeConfig()
  const result = await sendWorkspaceInvitation(
    {
      api: auth.api,
      connection: useDatabase(),
      headers: getBetterAuthRequestHeaders(event)
    },
    {
      ownerUserId: session.user.id,
      ...body,
      appName: config.public.appName,
      appUrl: config.public.appUrl,
      sender: getTransactionalEmailSender()
    }
  )

  setResponseStatus(event, 201)
  return result
})
