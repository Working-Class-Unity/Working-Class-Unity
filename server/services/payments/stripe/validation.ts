import { z } from 'zod'
import { membershipDuesOfferingKeys } from '../../../../shared/billing'
import { validationError } from '../../../utils/errors'

export const billingOfferingCommandSchema = z.object({ offering: z.enum(membershipDuesOfferingKeys) }).strict()
export const emptyBillingCommandSchema = z.object({}).strict()

export function validateWithZod<T>(schema: z.ZodType<T>, message: string) {
  return (value: unknown) => {
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw validationError(message)
    return parsed.data
  }
}
