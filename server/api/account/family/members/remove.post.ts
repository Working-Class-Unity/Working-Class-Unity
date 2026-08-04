import { readValidatedBody, setHeader } from 'h3'
import { z } from 'zod'
import { useDatabase } from '../../../../db/client'
import { removeFamilyMember } from '../../../../services/family-member-removal'
import { requireSession } from '../../../../utils/auth/require-session'
import { requireModuleReady } from '../../../../utils/module-state'
import { validateWithZod } from '../../../../utils/validation'

const familyMemberRemovalRequestSchema = z
  .object({
    memberReference: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[A-Za-z0-9_-]+$/)
  })
  .strict()

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')

  const session = await requireSession(event)
  requireModuleReady('billing')
  const body = await readValidatedBody(
    event,
    validateWithZod(familyMemberRemovalRequestSchema, 'Invalid Family member-removal request')
  )
  return removeFamilyMember(
    {
      connection: useDatabase()
    },
    session.user.id,
    body.memberReference
  )
})
