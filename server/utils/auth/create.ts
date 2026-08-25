import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { magicLink } from 'better-auth/plugins'
import type { DatabaseConnection } from '../../db/connect'
import * as schema from '../../db/schema'
import type { TransactionalEmailSender } from '../../services/email'
import type { AppRuntimeConfig } from '../runtime'
import { disabledAccountDeletionAuthPaths } from './account-deletion'
import { createAuthenticationBeforeHook, createMagicLinkDelivery, disabledNonMagicLinkAuthPaths } from './passwordless'
import { createBetterAuthSecurityOptions } from './security'
import { createAuthenticationUserOptions } from './user-options'

export function createAuthentication(
  config: AppRuntimeConfig,
  database: DatabaseConnection,
  getEmailSender: () => TransactionalEmailSender
) {
  return betterAuth({
    ...createBetterAuthSecurityOptions(config),
    database: drizzleAdapter(database.db, {
      provider: 'sqlite',
      schema,
      // Better Auth supplies an async adapter callback, while better-sqlite3's
      // documented transaction functions are synchronous and reject promises.
      transaction: false
    }),
    user: createAuthenticationUserOptions(database),
    disabledPaths: [...disabledNonMagicLinkAuthPaths, ...disabledAccountDeletionAuthPaths],
    emailAndPassword: {
      enabled: false
    },
    verification: {
      storeInDatabase: true
    },
    hooks: {
      before: createAuthenticationBeforeHook(config)
    },
    plugins: [
      magicLink({
        expiresIn: 300,
        storeToken: 'hashed',
        rateLimit: {
          window: 60,
          max: 5
        },
        sendMagicLink: createMagicLinkDelivery(config.public.appName, getEmailSender)
      })
    ]
  })
}
