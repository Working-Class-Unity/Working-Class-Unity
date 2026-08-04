import { getValidatedRouterParams, setHeader, setResponseStatus } from 'h3'
import { fileParamsSchema } from '../../db/schema'
import { deleteOwnedFile } from '../../services/storage/file-service'
import { requireSession } from '../../utils/auth/require-session'
import { validateWithZod } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const session = await requireSession(event)
  const params = await getValidatedRouterParams(
    event,
    validateWithZod(fileParamsSchema, 'Invalid file route parameters')
  )
  await deleteOwnedFile(session, params.id)
  setResponseStatus(event, 204)
  return null
})
