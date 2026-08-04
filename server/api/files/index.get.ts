import { getValidatedQuery, setHeader } from 'h3'
import { z } from 'zod'
import { listOwnedFiles } from '../../services/storage/file-service'
import { requireSession } from '../../utils/auth/require-session'
import { validateWithZod } from '../../utils/validation'

const fileListQuerySchema = z
  .object({
    cursor: z.string().trim().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional()
  })
  .strict()

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const session = await requireSession(event)
  const query = await getValidatedQuery(event, validateWithZod(fileListQuerySchema, 'Invalid file list query'))
  return listOwnedFiles(session, query)
})
