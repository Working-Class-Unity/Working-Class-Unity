import { z } from 'zod'
import { billingOfferingKeys } from '../../../shared/billing'

export const createCheckoutSchema = z
  .object({
    offering: z.enum(billingOfferingKeys)
  })
  .strict()

export const changeBillingOfferingSchema = z
  .object({
    offering: z.enum(billingOfferingKeys)
  })
  .strict()

export const emptyBillingCommandSchema = z.object({}).strict()

export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>
export type ChangeBillingOfferingInput = z.infer<typeof changeBillingOfferingSchema>
