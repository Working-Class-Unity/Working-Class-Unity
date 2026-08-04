import { readValidatedBody, setHeader, setResponseStatus } from 'h3'
import { createOwnedAiConversation } from '../../../services/ai/ai-conversation-service'
import { createAiConversationSchema } from '../../../services/ai/ai-validation'
import { requireSession } from '../../../utils/auth/require-session'
import { validateWithZod } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const session = await requireSession(event)
  await readValidatedBody(event, validateWithZod(createAiConversationSchema, 'Invalid AI conversation create request'))
  const conversation = await createOwnedAiConversation(session)
  setResponseStatus(event, 201)
  return { conversation }
})
