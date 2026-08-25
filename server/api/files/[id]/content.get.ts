import { getValidatedQuery, getValidatedRouterParams, setHeader } from 'h3'
import { fileParamsSchema, uploadTokenQuerySchema } from '../../../db/schema'
import { getLocalFileDownload } from '../../../services/storage/file-service'
import { requireSession } from '../../../utils/auth/require-session'
import { validateWithZod } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  setHeader(event, 'referrer-policy', 'no-referrer')
  const session = await requireSession(event)
  const params = await getValidatedRouterParams(
    event,
    validateWithZod(fileParamsSchema, 'Invalid file route parameters')
  )
  const { token } = await getValidatedQuery(
    event,
    validateWithZod(uploadTokenQuerySchema, 'Invalid file download capability')
  )
  const result = await getLocalFileDownload(session, params.id, token)

  setHeader(event, 'content-type', result.file.contentType)
  setHeader(event, 'content-length', result.byteSize)
  setHeader(event, 'content-disposition', 'attachment')
  return result.body
})
