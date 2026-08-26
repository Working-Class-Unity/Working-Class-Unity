import type { authClient } from '~/lib/auth-client'
import { isTemporaryPhoneEmail } from '#shared/account-identity'

type RawSession = typeof authClient.$Infer.Session

export type AppSessionUser = {
  id: string
  email: string | null
  emailVerified: boolean
  phoneNumber: string | null
  phoneNumberVerified: boolean
  image: string | null
  displayName: string | null
}

export type AppSession = {
  user: AppSessionUser
}

export function toAppSession(session: RawSession | null): AppSession | null {
  if (!session?.user) return null
  const email = isTemporaryPhoneEmail(session.user.email) ? null : session.user.email

  return {
    user: {
      id: session.user.id,
      email,
      emailVerified: email !== null && session.user.emailVerified,
      phoneNumber: session.user.phoneNumber ?? null,
      phoneNumberVerified: session.user.phoneNumberVerified ?? false,
      image: session.user.image ?? null,
      displayName: session.user.displayName ?? null
    }
  }
}

export function appUserIdentity(user: Pick<AppSessionUser, 'displayName' | 'email' | 'phoneNumber'>): string {
  return user.displayName ?? user.email ?? user.phoneNumber ?? 'WCU account'
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
