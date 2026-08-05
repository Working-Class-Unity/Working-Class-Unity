import { getValidatedRouterParams, setHeader, setResponseStatus } from 'h3'
import { createOwnedAiMessage } from '../../../../../services/ai/ai-conversation-service'
import {
  aiConversationParamsSchema,
  aiMessageCreateBodyLimitBytes,
  createAiMessageSchema
} from '../../../../../services/ai/ai-validation'
import { requireSession } from '../../../../../utils/auth/require-session'
import { readValidatedBodyWithByteLimit } from '../../../../../utils/request-body'
import { validateWithZod } from '../../../../../utils/validation'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const controller = new AbortController()
  const abortOnDisconnect = () => {
    if (!event.node.res.writableEnded) controller.abort()
  }
  event.node.res.once('close', abortOnDisconnect)
  event.node.req.socket.once('close', abortOnDisconnect)
  if (event.node.req.aborted || event.node.req.socket.destroyed || event.node.res.destroyed) controller.abort()

  try {
    const session = await requireSession(event)
    const { conversationId } = await getValidatedRouterParams(
      event,
      validateWithZod(aiConversationParamsSchema, 'Invalid AI conversation route parameters')
    )
    const body = await readValidatedBodyWithByteLimit(
      event,
      aiMessageCreateBodyLimitBytes,
      validateWithZod(createAiMessageSchema, 'Invalid AI message create request')
    )
    if (controller.signal.aborted) return

    const result = await createOwnedAiMessage(session, conversationId, body, controller.signal)
    if (!result.replayed) setResponseStatus(event, 201)
    return result.response
  } finally {
    event.node.res.off('close', abortOnDisconnect)
    event.node.req.socket.off('close', abortOnDisconnect)
  }
})
