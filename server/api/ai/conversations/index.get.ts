import { getValidatedQuery, setHeader } from 'h3'
import { listOwnedAiConversations } from '../../../services/ai/ai-conversation-service'
import { aiListQuerySchema } from '../../../services/ai/ai-validation'
import { requireSession } from '../../../utils/auth/require-session'
import { validateWithZod } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const session = await requireSession(event)
  const query = await getValidatedQuery(event, validateWithZod(aiListQuerySchema, 'Invalid AI conversation list query'))
  return listOwnedAiConversations(session, query)
})
