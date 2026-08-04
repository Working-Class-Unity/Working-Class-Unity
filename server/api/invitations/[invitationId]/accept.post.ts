import { setHeader } from 'h3'
import { useDatabase } from '../../../db/client'
import { getStripeClient } from '../../../services/payments/stripe-client'
import { acceptWorkspaceInvitation } from '../../../services/workspace-invitations'
import { auth } from '../../../utils/auth'
import { getBetterAuthRequestHeaders, requireSession } from '../../../utils/auth/require-session'
import { getInvitationId } from '../../../utils/invitation-params'
import { requireModuleReady } from '../../../utils/module-state'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')

  const session = await requireSession(event)
  requireModuleReady('billing')
  const invitationId = await getInvitationId(event)

  return acceptWorkspaceInvitation(
    {
      api: auth.api,
      connection: useDatabase(),
      headers: getBetterAuthRequestHeaders(event),
      stripe: getStripeClient()
    },
    invitationId,
    session.user.id
  )
})
