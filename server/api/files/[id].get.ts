import { getValidatedRouterParams, setHeader } from 'h3'
import { fileParamsSchema } from '../../db/schema'
import { getOwnedFileMetadata } from '../../services/storage/file-service'
import { requireSession } from '../../utils/auth/require-session'
import { validateWithZod } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const session = await requireSession(event)
  const params = await getValidatedRouterParams(
    event,
    validateWithZod(fileParamsSchema, 'Invalid file route parameters')
  )
  return { file: await getOwnedFileMetadata(session, params.id) }
})
