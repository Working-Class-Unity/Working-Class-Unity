import { readValidatedBody, setHeader, setResponseStatus } from 'h3'
import { createFileUploadRequestSchema } from '../../db/schema'
import { createFileUploadTarget } from '../../services/storage/file-service'
import { requireSession } from '../../utils/auth/require-session'
import { validateWithZod } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const session = await requireSession(event)
  const body = await readValidatedBody(
    event,
    validateWithZod(createFileUploadRequestSchema, 'Invalid file upload request')
  )
  const uploadTarget = await createFileUploadTarget(session, body)
  setResponseStatus(event, 201)

  return uploadTarget
})
