import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { magicLink } from 'better-auth/plugins'
import type { DatabaseConnection } from '../../db/connect'
import * as schema from '../../db/schema'
import type { TransactionalEmailSender } from '../../services/email'
import type { AppRuntimeConfig } from '../runtime'
import { createAccountDeletionUserOptions, disabledAccountDeletionAuthPaths } from './account-deletion'
import { createWorkspaceOrganizationPlugin, disabledOrganizationAuthPaths } from './organization'
import { createMagicLinkDelivery, disabledPasswordAuthPaths } from './passwordless'
import { createBetterAuthSecurityOptions } from './security'
import {
  createAuthenticationBeforeHook,
  createSocialDatabaseHooks,
  createSocialProviders,
  disabledSocialAuthPaths,
  socialAccountOptions
} from './social'

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
      // The migration therefore owns personal-organization atomicity in the user
      // INSERT statement instead of enabling an incompatible adapter wrapper.
      transaction: false
    }),
    account: socialAccountOptions,
    user: createAccountDeletionUserOptions(database),
    databaseHooks: createSocialDatabaseHooks(),
    disabledPaths: [
      ...disabledPasswordAuthPaths,
      ...disabledSocialAuthPaths,
      ...disabledOrganizationAuthPaths,
      ...disabledAccountDeletionAuthPaths
    ],
    emailAndPassword: {
      enabled: false
    },
    socialProviders: createSocialProviders(config),
    verification: {
      storeInDatabase: true
    },
    hooks: {
      before: createAuthenticationBeforeHook(config)
    },
    plugins: [
      createWorkspaceOrganizationPlugin(database),
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
