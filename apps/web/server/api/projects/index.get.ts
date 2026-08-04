import { setHeader } from 'h3'
import { useDatabase } from '../../db/client'
import { listProjects } from '../../db/repositories/projects'
import { requireSession } from '../../utils/auth/require-session'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')

  const session = await requireSession(event)

  return {
    projects: await listProjects(useDatabase(), session.user.id)
  }
})
