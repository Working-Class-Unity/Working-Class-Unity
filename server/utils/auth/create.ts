import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { magicLink, phoneNumber } from 'better-auth/plugins'
import type { DatabaseConnection } from '../../db/connect'
import * as schema from '../../db/schema'
import { createAccountEmailVerificationEmail, type TransactionalEmailSender } from '../../services/email'
import { ensureWebsiteAccountIdentity, type WebsiteAccountIdentity } from '../../services/membership/account-identity'
import { hasAccountStripeMembership, stripeMembershipConfiguration } from '../../services/membership/stripe-first'
import { readStripeMembershipAdoptionPrices } from '../../services/membership/stripe-link-sync'
import { billingStripeConfiguration } from '../../services/payments/stripe/app-composition'
import { getStripeClient } from '../../services/payments/stripe/stripe-client'
import { checkTwilioVerification, sendTwilioVerification } from '../../services/security/twilio-verify'
import type { AppRuntimeConfig } from '../runtime'
import { disabledAccountDeletionAuthPaths } from './account-deletion'
import {
  createAuthenticationBeforeHook,
  createMagicLinkDelivery,
  disabledNonMagicLinkAuthPaths,
  disabledPhonePasswordAuthPaths
} from './passwordless'
import { normalizeUsPhoneNumber } from './phone'
import { createBetterAuthSecurityOptions } from './security'
import { stripeMembershipAuth } from './stripe-membership'
import { createAuthenticationUserOptions } from './user-options'

export function createAuthentication(
  config: AppRuntimeConfig,
  database: DatabaseConnection,
  getEmailSender: () => TransactionalEmailSender
) {
  const deliverMagicLink = createMagicLinkDelivery(config.public.appName, getEmailSender)
  const billingConfig = billingStripeConfiguration(config)
  const membershipConfig = stripeMembershipConfiguration(billingConfig)
  const legacyPrices = readStripeMembershipAdoptionPrices({
    WCU_STRIPE_LEGACY_DUES10_PRICE_IDS: config.stripe.legacyDues10PriceIds,
    WCU_STRIPE_LEGACY_DUES27_PRICE_IDS: config.stripe.legacyDues27PriceIds
  })
  const synchronizeIdentity = (user: WebsiteAccountIdentity) => {
    if (hasAccountStripeMembership(database, user.id)) return
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
              (Omit<WebsiteAccountIdentity, 'phoneNumberVerified'> & { phoneNumberVerified: number }) | undefined
            if (user) {
              synchronizeIdentity({
                ...user,
                phoneNumberVerified: user.phoneNumberVerified === 1
              })
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
        disableSignUp: true,
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
        }
      }),
      stripeMembershipAuth({
        client: () => getStripeClient(billingConfig),
        config: membershipConfig,
        connection: database,
        getEmailSender,
        legacyPrices
      })
    ]
  })
}
