import { getValidatedRouterParams, setHeader } from 'h3'
import { getOwnedAiConversation } from '../../../services/ai/ai-conversation-service'
import { aiConversationParamsSchema } from '../../../services/ai/ai-validation'
import { requireSession } from '../../../utils/auth/require-session'
import { validateWithZod } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const session = await requireSession(event)
  const { conversationId } = await getValidatedRouterParams(
    event,
    validateWithZod(aiConversationParamsSchema, 'Invalid AI conversation route parameters')
  )
  return { conversation: await getOwnedAiConversation(session, conversationId) }
})
