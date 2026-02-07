import type { H3Event } from 'h3'
import { z, type ZodTypeAny } from 'zod'

export const emailSchema = z.string().trim().email().transform((value) => value.toLowerCase())

export const idSchema = z.string().trim().min(1)

export async function parseBodyWithSchema<T extends ZodTypeAny>(event: H3Event, schema: T): Promise<z.output<T>> {
  const body = await readBody(event)
  return schema.parse(body)
}

export function parseQueryWithSchema<T extends ZodTypeAny>(event: H3Event, schema: T): z.output<T> {
  const query = getQuery(event)
  return schema.parse(query)
}
