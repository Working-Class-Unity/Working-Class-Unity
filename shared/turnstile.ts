import { z } from 'zod'

export const turnstileTokenSchema = z.string().min(1).max(2_048)

export const turnstileActions = {
  magicLink: 'auth_magic_link'
} as const

export const turnstileHeaderName = 'x-turnstile-token'

export type TurnstileAction = (typeof turnstileActions)[keyof typeof turnstileActions]
