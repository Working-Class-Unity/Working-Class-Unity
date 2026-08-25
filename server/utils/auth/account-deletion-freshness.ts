import { createError } from 'h3'
import type { AppSession } from './require-session'
import { accountDeletionFreshAgeSeconds } from './security'

export function assertFreshAccountDeletionSession(session: AppSession, now = Date.now()): void {
  const createdAt = new Date(session.session.createdAt).getTime()
  if (!Number.isFinite(createdAt) || now - createdAt >= accountDeletionFreshAgeSeconds * 1_000) {
    const message = 'Session expired. Re-authenticate to perform this action.'
    throw createError({
      statusCode: 400,
      statusMessage: message,
      data: {
        code: 'SESSION_EXPIRED',
        message
      }
    })
  }
}
