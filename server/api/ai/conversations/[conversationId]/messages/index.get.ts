import { getValidatedQuery, getValidatedRouterParams, setHeader } from 'h3'
import { listOwnedAiMessages } from '../../../../../services/ai/ai-conversation-service'
import { aiConversationParamsSchema, aiListQuerySchema } from '../../../../../services/ai/ai-validation'
import { requireSession } from '../../../../../utils/auth/require-session'
import { validateWithZod } from '../../../../../utils/validation'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const session = await requireSession(event)
  const { conversationId } = await getValidatedRouterParams(
    event,
    validateWithZod(aiConversationParamsSchema, 'Invalid AI conversation route parameters')
  )
  const query = await getValidatedQuery(event, validateWithZod(aiListQuerySchema, 'Invalid AI message list query'))
  return listOwnedAiMessages(session, conversationId, query)
})
