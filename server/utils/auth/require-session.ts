import { getRequestHeaders, type H3Event } from 'h3'
import { unauthorizedError } from '../errors'
import { auth, type BetterAuthSession } from './index'

export type AppSession = BetterAuthSession

export async function getOptionalSession(event: H3Event): Promise<AppSession | null> {
  return auth.api.getSession({
    headers: getBetterAuthRequestHeaders(event)
  })
}

export async function requireSession(event: H3Event): Promise<AppSession> {
  const session = await getOptionalSession(event)

  if (!session) {
    throw unauthorizedError()
  }

  return session
}

export function getBetterAuthRequestHeaders(event: H3Event): Headers {
  const rawHeaders = getRequestHeaders(event)
  const headers = new Headers()

  for (const [name, value] of Object.entries(rawHeaders)) {
    if (value) {
      headers.set(name, value)
    }
  }

  return headers
}
