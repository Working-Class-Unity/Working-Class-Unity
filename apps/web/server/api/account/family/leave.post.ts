import { readValidatedBody, setHeader } from 'h3'
import { z } from 'zod'
import { useDatabase } from '../../../db/client'
import { leaveJoinedFamily } from '../../../services/family-membership'
import { requireSession } from '../../../utils/auth/require-session'
import { validateWithZod } from '../../../utils/validation'

const leaveFamilyRequestSchema = z.object({}).strict()

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const session = await requireSession(event)
  await readValidatedBody(event, validateWithZod(leaveFamilyRequestSchema, 'Invalid family-leave request'))

  return leaveJoinedFamily(
    {
      connection: useDatabase()
    },
    session.user.id
  )
})
