import { setHeader } from 'h3'
import { useDatabase } from '../../../db/client'
import { rejectWorkspaceInvitation } from '../../../services/workspace-invitations'
import { auth } from '../../../utils/auth'
import { getBetterAuthRequestHeaders, requireSession } from '../../../utils/auth/require-session'
import { getInvitationId } from '../../../utils/invitation-params'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')

  const session = await requireSession(event)
  const invitationId = await getInvitationId(event)

  return rejectWorkspaceInvitation(
    {
      api: auth.api,
      connection: useDatabase(),
      headers: getBetterAuthRequestHeaders(event)
    },
    invitationId,
    session.user.id
  )
})
