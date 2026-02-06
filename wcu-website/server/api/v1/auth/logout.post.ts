import { clearSessionForEvent } from '~~/server/lib/auth/session'

export default defineEventHandler((event) => {
  clearSessionForEvent(event)

  return {
    success: true,
  }
})
