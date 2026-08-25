import { z } from 'zod'

export const aiConversationCreateBodyLimitBytes = 1_024
export const aiMessageCreateBodyLimitBytes = 200_000

const conversationIdPattern =
  /^ai_conversation_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const aiConversationParamsSchema = z
  .object({
    conversationId: z.string().regex(conversationIdPattern)
  })
  .strict()

export const createAiConversationSchema = z.object({}).strict().default({})

export const createAiMessageSchema = z
  .object({
    clientRequestId: z.string().uuid(),
    content: z
      .string()
      .min(1)
      .max(32_000)
      .refine((value) => value.trim().length > 0, 'Message content must not be blank')
  })
  .strict()

export const aiListQuerySchema = z
  .object({
    cursor: z.string().trim().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional()
  })
  .strict()
