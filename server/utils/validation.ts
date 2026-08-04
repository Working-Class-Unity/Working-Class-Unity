import type { z } from 'zod'
import { validationError } from './errors'

export function validateWithZod<TSchema extends z.ZodType>(schema: TSchema, statusMessage = 'Invalid request input') {
  return (input: unknown): z.infer<TSchema> => {
    const parsed = schema.safeParse(input)

    if (!parsed.success) {
      throw validationError(statusMessage, parsed.error.flatten())
    }

    return parsed.data
  }
}
