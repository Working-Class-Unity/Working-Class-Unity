import { getValidatedRouterParams, setHeader } from 'h3'
import { fileParamsSchema } from '../../../db/schema'
import { createPrivateFileDownload } from '../../../services/storage/file-service'
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
  return createPrivateFileDownload(session, params.id)
})
