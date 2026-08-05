import { getValidatedRouterParams, setHeader } from 'h3'
import { completeFileUploadSchema, fileParamsSchema } from '../../../db/schema'
import { completeFileUpload } from '../../../services/storage/file-service'
import { fileUploadCompleteBodyLimitBytes } from '../../../services/storage/file-policy'
import { requireSession } from '../../../utils/auth/require-session'
import { readValidatedBodyWithByteLimit } from '../../../utils/request-body'
import { validateWithZod } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const session = await requireSession(event)
  const params = await getValidatedRouterParams(
    event,
    validateWithZod(fileParamsSchema, 'Invalid file route parameters')
  )
  await readValidatedBodyWithByteLimit(
    event,
    fileUploadCompleteBodyLimitBytes,
    validateWithZod(completeFileUploadSchema, 'Invalid file completion request')
  )

  return {
    file: await completeFileUpload(session, params.id)
  }
})
