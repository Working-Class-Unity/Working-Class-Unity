import { randomUUID } from 'node:crypto'
import type Stripe from 'stripe'
import { createAuthEndpoint } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { z } from 'zod'
import type { DatabaseConnection } from '../../db/connect'
import { claimStripeAccountAdoption } from '../../services/membership/stripe-account-adoption'
import { claimStripeMembership, type stripeMembershipConfiguration } from '../../services/membership/stripe-first'

export function stripeMembershipAuth(options: {
  client: () => Stripe
  config: ReturnType<typeof stripeMembershipConfiguration>
  connection: DatabaseConnection
}) {
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

          const user = await context.context.internalAdapter.findUserById(userId)
          const session = user ? await context.context.internalAdapter.createSession(user.id) : null
          if (!user || !session) throw context.redirect(`${options.config.appUrl}/login?error=adoption`)
          await setSessionCookie(context, { session, user })
          throw context.redirect(`${options.config.appUrl}/app`)
        }
      )
    }
  }
}
