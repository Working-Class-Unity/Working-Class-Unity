import { getValidatedRouterParams, setHeader } from 'h3'
import { useDatabase } from '../../db/client'
import { deleteProject } from '../../db/repositories/projects'
import { projectParamsSchema } from '../../db/schema'
import { requireSession } from '../../utils/auth/require-session'
import { notFoundError } from '../../utils/errors'
import { validateWithZod } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')

  const session = await requireSession(event)
  const { projectId } = await getValidatedRouterParams(
    event,
    validateWithZod(projectParamsSchema, 'Invalid project route parameters')
  )
  const deleted = await deleteProject(useDatabase(), session.user.id, projectId)

  if (!deleted) {
    throw notFoundError('Project not found')
  }
  return { status: 'deleted' }
})
