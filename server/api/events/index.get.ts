import { getValidatedQuery, setHeader } from 'h3'
import { z } from 'zod'
import { useDatabase } from '../../db/client'
import { listVisibleCalendarEvents } from '../../services/events/calendar-read'
import { billingStripeConfiguration } from '../../services/payments/stripe/app-composition'
import { getOptionalSession } from '../../utils/auth/require-session'
import { validateWithZod } from '../../utils/validation'

const calendarQuerySchema = z
  .object({
    from: z.iso.datetime().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    to: z.iso.datetime().optional()
  })
  .strict()

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const session = await getOptionalSession(event)
  const query = await getValidatedQuery(event, validateWithZod(calendarQuerySchema, 'Invalid calendar query'))
  const now = new Date()
  const from = query.from ?? now.toISOString()
  const to = query.to ?? new Date(now.getTime() + 366 * 24 * 60 * 60 * 1_000).toISOString()
  return listVisibleCalendarEvents(useDatabase(), {
    from,
    limit: query.limit ?? 200,
    now,
    prices: billingStripeConfiguration().stripe.prices,
    to,
    userId: session?.user.id ?? null
  })
})
