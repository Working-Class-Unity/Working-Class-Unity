export type Role = 'member' | 'organizer' | 'treasurer' | 'admin'

export interface SessionUser {
  userId: string
  email: string
  role: Role
  duesPaidThrough: string | null
}

export interface AuthSessionResponse {
  authenticated: boolean
  session: (SessionUser & { duesCurrent: boolean }) | null
}

export interface AuthMagicLinkRequestResponse {
  success: boolean
  message: string
  debugMagicLink?: string
}
