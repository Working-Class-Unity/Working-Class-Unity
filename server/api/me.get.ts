import { setHeader } from 'h3'
import type { AccountProfile } from '../../shared/profile'
import { useDatabase } from '../db/client'
import { requireSession } from '../utils/auth/require-session'
import { unauthorizedError } from '../utils/errors'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')

  const session = await requireSession(event)
  const profile = useDatabase()
    .sqlite.prepare(
      'select first_name as firstName, last_name as lastName, display_name as displayName from user where id = ?'
    )
    .get(session.user.id) as AccountProfile | undefined

  if (!profile) throw unauthorizedError()

  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      image: session.user.image,
      ...profile
    }
  }
})
