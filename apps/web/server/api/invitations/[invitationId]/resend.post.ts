import { setHeader } from 'h3'
import { useDatabase } from '../../../db/client'
import { getTransactionalEmailSender } from '../../../services/email'
import { resendWorkspaceInvitation } from '../../../services/workspace-invitations'
import { auth } from '../../../utils/auth'
import { getBetterAuthRequestHeaders, requireSession } from '../../../utils/auth/require-session'
import { getInvitationId } from '../../../utils/invitation-params'
import { requireModuleReady } from '../../../utils/module-state'
import { getAppRuntimeConfig } from '../../../utils/runtime'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')

  const session = await requireSession(event)
  requireModuleReady('billing')
  const invitationId = await getInvitationId(event)
  const config = getAppRuntimeConfig()

  return resendWorkspaceInvitation(
    {
      api: auth.api,
      connection: useDatabase(),
      headers: getBetterAuthRequestHeaders(event)
    },
    {
      ownerUserId: session.user.id,
      invitationId,
      appName: config.public.appName,
      appUrl: config.public.appUrl,
      sender: getTransactionalEmailSender()
    }
  )
})
