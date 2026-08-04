import { setHeader } from 'h3'
import { useDatabase } from '../../db/client'
import { listWorkspaceInvitationSummaries } from '../../services/workspace-invitations'
import { requireSession } from '../../utils/auth/require-session'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')

  const session = await requireSession(event)

  return {
    invitations: listWorkspaceInvitationSummaries({ connection: useDatabase() }, session.user.id)
  }
})
