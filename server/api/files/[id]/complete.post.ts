import { getValidatedRouterParams, readValidatedBody, setHeader } from 'h3'
import { completeFileUploadSchema, fileParamsSchema } from '../../../db/schema'
import { completeFileUpload } from '../../../services/storage/file-service'
import { requireSession } from '../../../utils/auth/require-session'
import { validateWithZod } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const session = await requireSession(event)
  const params = await getValidatedRouterParams(
    event,
    validateWithZod(fileParamsSchema, 'Invalid file route parameters')
  )
  await readValidatedBody(event, validateWithZod(completeFileUploadSchema, 'Invalid file completion request'))

  return {
    file: await completeFileUpload(session, params.id)
  }
})
