import { setHeader } from 'h3'
import { requireSession } from '../utils/auth/require-session'
import { getPublicModuleStates } from '../utils/module-state'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')

  const session = await requireSession(event)

  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image
    },
    modules: getPublicModuleStates()
  }
})
