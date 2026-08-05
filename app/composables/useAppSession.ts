import type { authClient } from '~/lib/auth-client'

type RawSession = typeof authClient.$Infer.Session

export type AppSessionUser = {
  id: string
  name: string
  email: string
  image: string | null
}

export type AppSession = {
  user: AppSessionUser
}

export function toAppSession(session: RawSession | null): AppSession | null {
  if (!session?.user) return null

  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image ?? null
    }
  }
}

export function useAppSession() {
  const appSession = useFetch<
    RawSession | null,
    Error,
    '/api/auth/get-session',
    'get',
    RawSession | null,
    AppSession | null
  >('/api/auth/get-session', {
    key: 'app-session',
    dedupe: 'defer',
    query: import.meta.server ? { disableRefresh: true } : undefined,
    transform: toAppSession
  })

  return appSession
}
