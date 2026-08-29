import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type Stripe from 'stripe'
import { z } from 'zod'
import type { DatabaseConnection } from '../../db/connect'
import { conflictError, upstreamServiceError, validationError } from '../../utils/errors'
import { createMagicLinkEmail, type TransactionalEmailSender } from '../email'
import type { StripeMembershipAdoptionPrices } from './stripe-link-sync'
import { exactStripeMembershipStatus } from './stripe-projection'

type AdoptionConnection = Readonly<{ sqlite: DatabaseConnection['sqlite'] }>
type AdoptionTier = 'member' | 'solidarity'

const adoptionClaimSchema = z
  .object({
    customerId: z.string().regex(/^cus_[A-Za-z0-9_]+$/),
    email: z.string(),
    priceId: z.string().min(1).max(255),
    subscriptionId: z.string().regex(/^sub_[A-Za-z0-9_]+$/),
    tier: z.enum(['member', 'solidarity'])
  })
  .strict()

export async function issueStripeAccountAdoptionLink(input: {
  appName: string
  appUrl: string
  client: Stripe
  connection: AdoptionConnection
  prices: StripeMembershipAdoptionPrices
  sender: TransactionalEmailSender
  subscriptionId: string
}): Promise<void> {
  const membership = await validateAllowlistedSubscription(input.client, input.prices, input.subscriptionId)
  assertUnclaimed(input.connection, membership)

  const token = randomBytes(32).toString('base64url')
  const verificationId = `stripe_account_adoption_${randomUUID()}`
  const now = Math.floor(Date.now() / 1_000)
  input.connection.sqlite
    .prepare(
      `insert into verification (id, identifier, value, expires_at, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?)`
    )
    .run(verificationId, verificationIdentifier(token), JSON.stringify(membership), now + 300, now, now)

  const appUrl = input.appUrl.replace(/\/$/, '')
  const url = `${appUrl}/api/auth/stripe-membership/adopt?token=${encodeURIComponent(token)}`
  try {
    await input.sender.send({
      ...createMagicLinkEmail({ appName: input.appName, to: membership.email, url }),
      idempotencyKey: `stripe-account-adoption-${digest(verificationId).slice(0, 32)}`
    })
  } catch (error) {
    input.connection.sqlite.prepare('delete from verification where id = ?').run(verificationId)
    throw error
  }
}

export async function claimStripeAccountAdoption(input: {
  client: Stripe
  connection: AdoptionConnection
  generateUserId: () => string
  token: string
}): Promise<{ userId: string }> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.token)) throw validationError('Invalid account adoption link')
  const identifier = verificationIdentifier(input.token)
  const verification = input.connection.sqlite
    .prepare('select id, value, expires_at as expiresAt from verification where identifier = ?')
    .get(identifier) as { id: string; value: string; expiresAt: number } | undefined
  if (!verification || verification.expiresAt <= Math.floor(Date.now() / 1_000)) {
    throw conflictError('Account adoption link is unavailable')
  }

  const expected = parseClaim(verification.value)
  const membership = await validateExpectedSubscription(input.client, expected)
  const now = Math.floor(Date.now() / 1_000)

  return input.connection.sqlite
    .transaction(() => {
      const consumed = input.connection.sqlite
        .prepare('delete from verification where id = ? and identifier = ? and expires_at > ?')
        .run(verification.id, identifier, now)
      if (consumed.changes !== 1) throw conflictError('Account adoption link is unavailable')

      assertUnclaimed(input.connection, membership)
      const matches = accountsForEmail(input.connection, membership.email)
      if (matches.length > 1) throw conflictError('Account email is ambiguous')
      const userId = matches[0]?.id ?? input.generateUserId()
      if (matches.length === 0) {
        input.connection.sqlite
          .prepare(
            `insert into user
               (id, name, email, email_verified, phone_number_verified, role, created_at, updated_at)
             values (?, 'WCU account', ?, 1, 0, 'user', ?, ?)`
          )
          .run(userId, membership.email, now, now)
      } else {
        input.connection.sqlite
          .prepare('update user set email = ?, email_verified = 1, updated_at = ? where id = ?')
          .run(membership.email, now, userId)
      }

      input.connection.sqlite
        .prepare(
          `insert into account_stripe_memberships
             (user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, tier,
              stripe_status, last_verified_at)
           values (?, ?, ?, ?, ?, 'active', ?)`
        )
        .run(
          userId,
          membership.customerId,
          membership.subscriptionId,
          membership.priceId,
          membership.tier,
          new Date(now * 1_000).toISOString()
        )
      return Object.freeze({ userId })
    })
    .immediate()
}

type AdoptionMembership = z.infer<typeof adoptionClaimSchema>

async function validateAllowlistedSubscription(
  client: Stripe,
  prices: StripeMembershipAdoptionPrices,
  subscriptionId: string
): Promise<AdoptionMembership> {
  if (!/^sub_[A-Za-z0-9_]+$/.test(subscriptionId)) throw validationError('Invalid Stripe subscription')
  const subscription = await stripeRead(() => client.subscriptions.retrieve(subscriptionId))
  const item = subscription.items.data.length === 1 ? subscription.items.data[0] : undefined
  const priceId = item?.price.id ?? ''
  const tier = adoptionTier(prices, priceId)
  if (!tier) throw conflictError('Stripe subscription is not eligible for account adoption')
  return validateSubscriptionAndCustomer(client, subscription, {
    priceId,
    subscriptionId,
    tier
  })
}

async function validateExpectedSubscription(client: Stripe, expected: AdoptionMembership): Promise<AdoptionMembership> {
  const subscription = await stripeRead(() => client.subscriptions.retrieve(expected.subscriptionId))
  const membership = await validateSubscriptionAndCustomer(client, subscription, expected)
  if (membership.customerId !== expected.customerId || membership.email !== expected.email) {
    throw conflictError('Stripe account adoption details changed')
  }
  return membership
}

async function validateSubscriptionAndCustomer(
  client: Stripe,
  subscription: Stripe.Subscription,
  expected: Readonly<{ priceId: string; subscriptionId: string; tier: AdoptionTier }>
): Promise<AdoptionMembership> {
  const customerId = stripeId(subscription.customer, 'cus_')
  if (!customerId) throw conflictError('Stripe subscription is not eligible for account adoption')
  if (
    exactStripeMembershipStatus(subscription, {
      stripeCustomerId: customerId,
      stripePriceId: expected.priceId,
      stripeSubscriptionId: expected.subscriptionId,
      tier: expected.tier
    }) !== 'active'
  ) {
    throw conflictError('Stripe subscription is not eligible for account adoption')
  }

  const customer = await stripeRead(() => client.customers.retrieve(customerId))
  const email = customer.deleted ? null : normalizeEmail(customer.email)
  if (!email) throw conflictError('Stripe customer email is unavailable')
  return Object.freeze({
    customerId,
    email,
    priceId: expected.priceId,
    subscriptionId: expected.subscriptionId,
    tier: expected.tier
  })
}

function assertUnclaimed(connection: AdoptionConnection, membership: AdoptionMembership): void {
  if (
    connection.sqlite
      .prepare(
        `select 1 from account_stripe_memberships
         where stripe_customer_id = ? or stripe_subscription_id = ?
         union all select 1 from billing_account_deletion_requests
         where expected_stripe_customer_id = ? or expected_stripe_subscription_id = ? limit 1`
      )
      .get(membership.customerId, membership.subscriptionId, membership.customerId, membership.subscriptionId)
  ) {
    throw conflictError('Account cannot claim this Stripe membership')
  }
  const accounts = accountsForEmail(connection, membership.email)
  if (accounts.length > 1) throw conflictError('Account email is ambiguous')
  const userId = accounts[0]?.id
  if (
    userId &&
    (connection.sqlite.prepare('select 1 from account_stripe_memberships where user_id = ?').get(userId) ||
      connection.sqlite
        .prepare('select 1 from billing_account_deletion_requests where purchaser_user_id = ?')
        .get(userId))
  ) {
    throw conflictError('Account cannot claim this Stripe membership')
  }
}

function accountsForEmail(connection: AdoptionConnection, email: string): readonly { id: string }[] {
  return connection.sqlite.prepare('select id from user where lower(trim(email)) = ? limit 2').all(email) as Array<{
    id: string
  }>
}

function adoptionTier(prices: StripeMembershipAdoptionPrices, priceId: string): AdoptionTier | null {
  const member = prices.member.includes(priceId)
  const solidarity = prices.solidarity.includes(priceId)
  return member === solidarity ? null : member ? 'member' : 'solidarity'
}

function parseClaim(value: string): AdoptionMembership {
  try {
    const parsed = adoptionClaimSchema.safeParse(JSON.parse(value))
    if (parsed.success) return parsed.data
  } catch {
    // Normalize malformed private verification state below.
  }
  throw conflictError('Account adoption link is unavailable')
}

function normalizeEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase() ?? ''
  return email.length >= 3 && email.length <= 320 && email.indexOf('@') > 0 ? email : null
}

function stripeId(value: string | { id: string } | null, prefix: string): string | null {
  const id = typeof value === 'string' ? value : value?.id
  return id?.startsWith(prefix) ? id : null
}

async function stripeRead<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch {
    throw upstreamServiceError(502, 'Stripe is temporarily unavailable')
  }
}

function verificationIdentifier(token: string): string {
  return `stripe-account-adoption:${digest(token)}`
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
