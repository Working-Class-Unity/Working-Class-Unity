import { getValidatedRouterParams, type H3Event } from 'h3'
import { z } from 'zod'
import { isInvitationId } from '../../shared/invitation-path'
import { validateWithZod } from './validation'

const invitationRouteParamsSchema = z.object({
  invitationId: z.string().refine(isInvitationId)
})

export async function getInvitationId(event: H3Event): Promise<string> {
  const params = await getValidatedRouterParams(
    event,
    validateWithZod(invitationRouteParamsSchema, 'Invalid invitation route parameters')
  )

  return params.invitationId
}
