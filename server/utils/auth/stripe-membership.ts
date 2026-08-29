import { createHash, randomUUID } from 'node:crypto'
import type Stripe from 'stripe'
import { APIError, createAuthEndpoint } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { z } from 'zod'
import type { DatabaseConnection } from '../../db/connect'
import type { TransactionalEmailSender } from '../../services/email'
import {
  claimStripeAccountAdoption,
  requestStripeAccountActivation
} from '../../services/membership/stripe-account-adoption'
import { claimStripeMembership, type stripeMembershipConfiguration } from '../../services/membership/stripe-first'
import type { StripeMembershipAdoptionPrices } from '../../services/membership/stripe-link-sync'

const activationRequestSchema = z.object({ email: z.string().trim().pipe(z.email().max(320)) }).strict()

export function stripeMembershipAuth(options: {
  client: () => Stripe
  config: ReturnType<typeof stripeMembershipConfiguration>
  connection: DatabaseConnection
  getEmailSender: () => TransactionalEmailSender
  legacyPrices: StripeMembershipAdoptionPrices
}) {
  const activationAttempts = new Map<string, { count: number; expiresAt: number }>()

  return {
    id: 'stripe-membership',
    endpoints: {
      claimStripeMembership: createAuthEndpoint(
        '/stripe-membership/claim',
        {
          method: 'GET',
          query: z.object({ token: z.string() }),
          requireHeaders: true
        },
        async (context) => {
          let userId: string
          try {
            const claimed = await claimStripeMembership({
              client: options.client(),
              config: options.config,
              connection: options.connection,
              generateUserId: () => context.context.generateId({ model: 'user' }) || randomUUID(),
              token: context.query.token
            })
            userId = claimed.userId
          } catch {
            throw context.redirect(`${options.config.appUrl}/join?error=claim`)
          }

          const user = await context.context.internalAdapter.findUserById(userId)
          const session = user ? await context.context.internalAdapter.createSession(user.id) : null
          if (!user || !session) throw context.redirect(`${options.config.appUrl}/login?error=join`)
          await setSessionCookie(context, { session, user })
          throw context.redirect(`${options.config.appUrl}/app`)
        }
      ),
      requestStripeMembershipActivation: createAuthEndpoint(
        '/stripe-membership/activate',
        {
          method: 'POST',
          body: activationRequestSchema,
          requireHeaders: true
        },
        async (context) => {
          consumeActivationAttempt(activationAttempts, context.body.email)
          try {
            await requestStripeAccountActivation({
              appName: options.config.appName,
              appUrl: options.config.appUrl,
              client: options.client(),
              connection: options.connection,
              email: context.body.email,
              prices: options.legacyPrices,
              sender: options.getEmailSender()
            })
          } catch {
            throw new APIError('SERVICE_UNAVAILABLE', {
              code: 'ACCOUNT_ACTIVATION_UNAVAILABLE',
              message: 'Account activation is temporarily unavailable. Please try again.'
            })
          }
          return context.json({ status: true })
        }
      ),
      adoptStripeMembership: createAuthEndpoint(
        '/stripe-membership/adopt',
        {
          method: 'GET',
          query: z.object({ token: z.string() }),
          requireHeaders: true
        },
        async (context) => {
          let userId: string
          try {
            const claimed = await claimStripeAccountAdoption({
              client: options.client(),
              connection: options.connection,
              generateUserId: () => context.context.generateId({ model: 'user' }) || randomUUID(),
              token: context.query.token
            })
            userId = claimed.userId
          } catch {
            throw context.redirect(`${options.config.appUrl}/login?error=adoption`)
          }

          try {
            const user = await context.context.internalAdapter.findUserById(userId)
            const session = user ? await context.context.internalAdapter.createSession(user.id) : null
            if (!user || !session) throw new Error('Activation session unavailable')
            await setSessionCookie(context, { session, user })
          } catch {
            throw context.redirect(`${options.config.appUrl}/login?status=activation-complete`)
          }
          throw context.redirect(`${options.config.appUrl}/app`)
        }
      )
    },
    rateLimit: [
      {
        pathMatcher: (path: string) => path.startsWith('/stripe-membership/activate'),
        window: 60,
        max: 5
      }
    ]
  }
}

function consumeActivationAttempt(attempts: Map<string, { count: number; expiresAt: number }>, email: string): void {
  const now = Date.now()
  if (attempts.size > 1_000) {
    for (const [key, attempt] of attempts) if (attempt.expiresAt <= now) attempts.delete(key)
  }
  const key = createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
  const attempt = attempts.get(key)
  if (!attempt || attempt.expiresAt <= now) {
    attempts.set(key, { count: 1, expiresAt: now + 60_000 })
    return
  }
  if (attempt.count >= 5) {
    throw new APIError('TOO_MANY_REQUESTS', {
      code: 'ACCOUNT_ACTIVATION_RATE_LIMITED',
      message: 'Too many activation requests. Please try again later.'
    })
  }
  attempt.count += 1
}
