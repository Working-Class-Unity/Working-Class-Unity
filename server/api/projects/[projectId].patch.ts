import { getValidatedRouterParams, readValidatedBody, setHeader } from 'h3'
import { useDatabase } from '../../db/client'
import { updateProject } from '../../db/repositories/projects'
import { projectParamsSchema, updateProjectSchema } from '../../db/schema'
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
  const body = await readValidatedBody(event, validateWithZod(updateProjectSchema, 'Invalid project update request'))

  const project = await updateProject(useDatabase(), session.user.id, projectId, body)
  if (!project) {
    throw notFoundError('Project not found')
  }

  return { project }
})
