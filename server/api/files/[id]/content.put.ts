import { getRequestHeader, getValidatedQuery, getValidatedRouterParams, setHeader } from 'h3'
import { fileParamsSchema, uploadTokenQuerySchema } from '../../../db/schema'
import { putFileUploadContent } from '../../../services/storage/file-service'
import { requireSession } from '../../../utils/auth/require-session'
import { validateWithZod } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const session = await requireSession(event)
  const params = await getValidatedRouterParams(
    event,
    validateWithZod(fileParamsSchema, 'Invalid file route parameters')
  )
  const { token } = await getValidatedQuery(
    event,
    validateWithZod(uploadTokenQuerySchema, 'Invalid file upload capability')
  )

  return putFileUploadContent(session, params.id, token, event.node.req, {
    contentType: getRequestHeader(event, 'content-type'),
    contentMd5: getRequestHeader(event, 'content-md5'),
    contentLength: getRequestHeader(event, 'content-length')
  })
})
