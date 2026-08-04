import { readValidatedBody, setHeader, setResponseStatus } from 'h3'
import { useDatabase } from '../../db/client'
import { createProject } from '../../db/repositories/projects'
import { createProjectSchema } from '../../db/schema'
import { requireSession } from '../../utils/auth/require-session'
import { validateWithZod } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')

  const session = await requireSession(event)
  const body = await readValidatedBody(event, validateWithZod(createProjectSchema, 'Invalid project create request'))

  const project = await createProject(useDatabase(), session.user.id, body)
  setResponseStatus(event, 201)

  return { project }
})
