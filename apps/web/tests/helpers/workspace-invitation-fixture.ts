import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { magicLink } from 'better-auth/plugins'
import { convertSetCookieToCookie } from 'better-auth/test'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as schema from '../../server/db/schema'
import type { TransactionalEmailMessage } from '../../server/services/email'
import {
  createAccountDeletionUserOptions,
  disabledAccountDeletionAuthPaths
} from '../../server/utils/auth/account-deletion'
import { createWorkspaceOrganizationPlugin, disabledOrganizationAuthPaths } from '../../server/utils/auth/organization'
import { disabledPasswordAuthPaths } from '../../server/utils/auth/passwordless'
import { createBetterAuthSecurityOptions, createRedactedBetterAuthLogger } from '../../server/utils/auth/security'
import {
  createAuthenticationBeforeHook,
  createSocialDatabaseHooks,
  disabledSocialAuthPaths,
  socialAccountOptions
} from '../../server/utils/auth/social'
import type { AppRuntimeConfig } from '../../server/utils/runtime'

const baseURL = 'http://localhost:3000'
let nextClientIpOctet = 50

export function createWorkspaceInvitationFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'swl-workspace-invitations-'))
  const databasePath = join(directory, 'fixture.sqlite')
  const sqlite = new Database(databasePath)
  sqlite.pragma('foreign_keys = ON')
  const database = drizzle({ client: sqlite, schema })
  migrate(database, {
    migrationsFolder: fileURLToPath(new URL('../../server/db/migrations/', import.meta.url))
  })
  const connection = { sqlite, db: database, databasePath }

  const config = testRuntimeConfig()
  const magicLinks = new Map<string, string>()
  const billingNotifications: TransactionalEmailMessage[] = []
  const authentication = betterAuth({
    ...createBetterAuthSecurityOptions(config),
    logger: createRedactedBetterAuthLogger(() => undefined),
    database: drizzleAdapter(database, {
      provider: 'sqlite',
      schema,
      transaction: false
    }),
    account: socialAccountOptions,
    user: createAccountDeletionUserOptions(connection),
    databaseHooks: createSocialDatabaseHooks(),
    disabledPaths: [
      ...disabledPasswordAuthPaths,
      ...disabledSocialAuthPaths,
      ...disabledOrganizationAuthPaths,
      ...disabledAccountDeletionAuthPaths
    ],
    emailAndPassword: { enabled: false },
    verification: { storeInDatabase: true },
    hooks: { before: createAuthenticationBeforeHook(config) },
    plugins: [
      createWorkspaceOrganizationPlugin(connection),
      magicLink({
        expiresIn: 300,
        storeToken: 'hashed',
        rateLimit: { window: 60, max: 5 },
        sendMagicLink: async ({ email, url }) => {
          magicLinks.set(email, url)
        }
      })
    ]
  })

  async function requestMagicLink(email: string, name = email) {
    magicLinks.delete(email)
    const requestResponse = await authentication.handler(
      authRequest(`${baseURL}/api/auth/sign-in/magic-link`, {
        method: 'POST',
        body: JSON.stringify({
          email,
          name,
          callbackURL: '/app',
          newUserCallbackURL: '/app',
          errorCallbackURL: '/login'
        })
      })
    )
    if (requestResponse.status !== 200) throw new Error(`Magic-link request failed: ${requestResponse.status}`)

    const link = magicLinks.get(email)
    if (!link) throw new Error('Magic-link delivery was not captured')
    return link
  }

  return {
    auth: authentication,
    billingNotifications,
    config,
    connection,
    sqlite,
    requestMagicLink,
    async signIn(email: string, name = email) {
      const link = await requestMagicLink(email, name)
      const redemption = await authentication.handler(authRequest(link))
      if (redemption.status !== 302) throw new Error(`Magic-link redemption failed: ${redemption.status}`)
      const headers = convertSetCookieToCookie(new Headers(redemption.headers))
      const user = database.select().from(schema.user).where(eq(schema.user.email, email)).get()
      if (!user) throw new Error('Signed-in user row is missing')
      const workspace = database
        .select()
        .from(schema.organization)
        .where(eq(schema.organization.personalOwnerUserId, user.id))
        .get()
      if (!workspace) throw new Error('Signed-in personal organization is missing')

      return { headers, user, workspace }
    },
    cleanup() {
      sqlite.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

export function authRequest(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('cf-connecting-ip', `198.51.100.${nextClientIpOctet++}`)
  if (init.body !== undefined) {
    headers.set('content-type', 'application/json')
    headers.set('origin', baseURL)
  }
  return new Request(url, { ...init, headers, redirect: 'manual' })
}

function testRuntimeConfig(): AppRuntimeConfig {
  return {
    betterAuth: {
      secret: 'workspace-invitation-secret-with-32-characters',
      url: baseURL
    },
    modules: {
      ai: { enabled: false },
      billing: { enabled: true },
      files: { enabled: false },
      jobs: { enabled: true },
      observability: { enabled: false },
      turnstile: { enabled: false }
    },
    cloudflare: { turnstile: { secretKey: '' } },
    stripe: {
      secretKey: 'sk_test_workspace_invitation',
      webhookSecret: 'whsec_workspace_invitation',
      portalConfigurationId: 'bpc_workspace_invitation',
      personalWeeklyPriceId: 'price_personal_weekly',
      personalMonthlyPriceId: 'price_personal_monthly',
      personalAnnualPriceId: 'price_personal_annual',
      familyMonthlyPriceId: 'price_family_monthly',
      familyAnnualPriceId: 'price_family_annual'
    },
    socialProviders: {
      google: { enabled: false, clientId: '', clientSecret: '' }
    },
    public: {
      appName: 'Invitation Test App',
      appUrl: baseURL,
      turnstileSiteKey: ''
    }
  } as AppRuntimeConfig
}

export type WorkspaceInvitationFixture = ReturnType<typeof createWorkspaceInvitationFixture>
export type SignedInFixtureUser = Awaited<ReturnType<WorkspaceInvitationFixture['signIn']>>

export function seedVerifiedBilling(
  fixture: WorkspaceInvitationFixture,
  actor: SignedInFixtureUser,
  input: Readonly<{
    plan: 'personal' | 'family'
    cadence?: 'weekly' | 'monthly' | 'annual'
    cancelAtPeriodEnd?: boolean
    currentPeriodEnd?: Date
    reconciliationRequired?: boolean
    status?: 'active' | 'past_due'
  }>
) {
  const now = new Date()
  const cadence = input.cadence ?? 'monthly'
  const customerId = `billing_customer_${actor.user.id}`
  const subscriptionId = `billing_subscription_${actor.user.id}`
  const stripeCustomerId = `cus_${actor.user.id}`
  const stripeSubscriptionId = `sub_${actor.user.id}`
  const stripeSubscriptionItemId = `si_${actor.user.id}`
  const stripePriceId = `price_${input.plan}_${cadence}`
  const requestedPeriodEnd = input.currentPeriodEnd ?? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000)
  // Stripe subscription item period timestamps are integer Unix seconds.
  const currentPeriodEnd = new Date(Math.floor(requestedPeriodEnd.getTime() / 1_000) * 1_000)
  const reconciliationRequired = input.reconciliationRequired ?? false

  fixture.sqlite
    .prepare(
      `insert into billing_customers (
         id, organization_id, stripe_customer_id, created_at, updated_at
       ) values (?, ?, ?, ?, ?)
       on conflict (organization_id) do update set
         stripe_customer_id = excluded.stripe_customer_id,
         updated_at = excluded.updated_at`
    )
    .run(customerId, actor.workspace.id, stripeCustomerId, now.toISOString(), now.toISOString())
  fixture.sqlite
    .prepare(
      `insert into billing_subscriptions (
         id, organization_id, billing_customer_id, stripe_subscription_id,
         stripe_subscription_item_id, status, plan_key, cadence, stripe_price_id,
         current_period_start, current_period_end, cancel_at_period_end,
         last_verified_at, reconciliation_required, reconciliation_reason,
         created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (organization_id) do update set
         billing_customer_id = excluded.billing_customer_id,
         stripe_subscription_id = excluded.stripe_subscription_id,
         stripe_subscription_item_id = excluded.stripe_subscription_item_id,
         status = excluded.status,
         plan_key = excluded.plan_key,
         cadence = excluded.cadence,
         stripe_price_id = excluded.stripe_price_id,
         current_period_start = excluded.current_period_start,
         current_period_end = excluded.current_period_end,
         cancel_at_period_end = excluded.cancel_at_period_end,
         last_verified_at = excluded.last_verified_at,
         reconciliation_required = excluded.reconciliation_required,
         reconciliation_reason = excluded.reconciliation_reason,
         revision = billing_subscriptions.revision + 1,
         updated_at = excluded.updated_at`
    )
    .run(
      subscriptionId,
      actor.workspace.id,
      customerId,
      stripeSubscriptionId,
      stripeSubscriptionItemId,
      input.status ?? 'active',
      input.plan,
      cadence,
      stripePriceId,
      new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString(),
      currentPeriodEnd.toISOString(),
      input.cancelAtPeriodEnd ? 1 : 0,
      now.toISOString(),
      reconciliationRequired ? 1 : 0,
      reconciliationRequired ? 'test_reconciliation' : null,
      now.toISOString(),
      now.toISOString()
    )

  return {
    customerId,
    currentPeriodEnd: currentPeriodEnd.toISOString(),
    stripeCustomerId,
    stripePriceId,
    stripeSubscriptionId,
    stripeSubscriptionItemId,
    subscriptionId
  }
}
