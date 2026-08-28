import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { magicLink, phoneNumber } from 'better-auth/plugins'
import type { DatabaseConnection } from '../../db/connect'
import * as schema from '../../db/schema'
import { createAccountEmailVerificationEmail, type TransactionalEmailSender } from '../../services/email'
import { ensureWebsiteAccountIdentity, type WebsiteAccountIdentity } from '../../services/membership/account-identity'
import { claimUniquePublicJoinForAccount } from '../../services/membership/public-join'
import { captureException } from '../../services/observability/capture'
import { checkTwilioVerification, sendTwilioVerification } from '../../services/security/twilio-verify'
import type { AppRuntimeConfig } from '../runtime'
import { disabledAccountDeletionAuthPaths } from './account-deletion'
import {
  createAuthenticationBeforeHook,
  createMagicLinkDelivery,
  disabledNonMagicLinkAuthPaths,
  disabledPhonePasswordAuthPaths
} from './passwordless'
import { normalizeUsPhoneNumber, temporaryPhoneEmail } from './phone'
import { createBetterAuthSecurityOptions } from './security'
import { createAuthenticationUserOptions } from './user-options'

export function createAuthentication(
  config: AppRuntimeConfig,
  database: DatabaseConnection,
  getEmailSender: () => TransactionalEmailSender
) {
  const deliverMagicLink = createMagicLinkDelivery(config.public.appName, getEmailSender)
  const synchronizeIdentity = (user: WebsiteAccountIdentity) => {
    ensureWebsiteAccountIdentity(database, user, {
      reviewHashKey: config.betterAuth.secret,
      stripePrices: {
        'personal.monthly': config.stripe.membershipDues10PriceId,
        'family.monthly': config.stripe.solidarityDues27PriceId
      }
    })
  }

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
    disabledPaths: [
      ...disabledNonMagicLinkAuthPaths,
      ...disabledPhonePasswordAuthPaths,
      ...disabledAccountDeletionAuthPaths
    ],
    emailAndPassword: {
      enabled: false
    },
    verification: {
      storeInDatabase: true
    },
    emailVerification: {
      expiresIn: 300,
      sendVerificationEmail: async ({ user, url }) => {
        try {
          await getEmailSender().send(
            createAccountEmailVerificationEmail({ appName: config.public.appName, to: user.email, url })
          )
        } catch {
          throw new APIError('SERVICE_UNAVAILABLE', {
            code: 'EMAIL_DELIVERY_UNAVAILABLE',
            message: 'Email delivery is temporarily unavailable.'
          })
        }
      }
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => synchronizeIdentity(user)
        },
        update: {
          after: async (user) => synchronizeIdentity(user)
        }
      },
      session: {
        create: {
          after: async (session) => {
            const user = database.sqlite
              .prepare(
                `select id, email, email_verified as emailVerified,
                        phone_number as phoneNumber, phone_number_verified as phoneNumberVerified
                 from user where id = ?`
              )
              .get(session.userId) as
              | (Omit<WebsiteAccountIdentity, 'emailVerified' | 'phoneNumberVerified'> & {
                  emailVerified: number
                  phoneNumberVerified: number
                })
              | undefined
            if (user) {
              synchronizeIdentity({
                ...user,
                emailVerified: user.emailVerified === 1,
                phoneNumberVerified: user.phoneNumberVerified === 1
              })
              try {
                claimUniquePublicJoinForAccount(
                  database,
                  { id: user.id, email: user.email, emailVerified: user.emailVerified === 1 },
                  config.betterAuth.secret
                )
              } catch (error) {
                await captureException(
                  error instanceof Error ? error : new Error('Public join auto-claim failed'),
                  'billing-operation-failed'
                )
              }
            }
          }
        }
      }
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
        sendMagicLink: deliverMagicLink
      }),
      phoneNumber({
        requireVerification: true,
        phoneNumberValidator: (value) => normalizeUsPhoneNumber(value) === value,
        sendOTP: async ({ phoneNumber: value }) => {
          try {
            await sendTwilioVerification(config.twilioVerify, value)
          } catch {
            throw new APIError('SERVICE_UNAVAILABLE', {
              code: 'SMS_DELIVERY_UNAVAILABLE',
              message: 'Text-message delivery is temporarily unavailable.'
            })
          }
        },
        verifyOTP: async ({ phoneNumber: value, code }) => {
          try {
            return await checkTwilioVerification(config.twilioVerify, value, code)
          } catch {
            throw new APIError('SERVICE_UNAVAILABLE', {
              code: 'SMS_VERIFICATION_UNAVAILABLE',
              message: 'Phone verification is temporarily unavailable.'
            })
          }
        },
        signUpOnVerification: {
          getTempEmail: (value) => temporaryPhoneEmail(config.betterAuth.secret, value),
          getTempName: () => 'WCU account'
        }
      })
    ]
  })
}
