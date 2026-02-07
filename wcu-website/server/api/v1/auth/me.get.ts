import type { AuthSessionResponse } from '~~/shared/types/auth'

import { isDuesCurrent } from '~~/server/lib/auth/rbac'
import { getSessionFromEvent } from '~~/server/lib/auth/session'

export default defineEventHandler((event): AuthSessionResponse => {
  const session = getSessionFromEvent(event)

  if (!session) {
    return {
      authenticated: false,
      session: null,
    }
  }

  return {
    authenticated: true,
    session: {
      ...session,
      duesCurrent: isDuesCurrent(session),
    },
  }
})
