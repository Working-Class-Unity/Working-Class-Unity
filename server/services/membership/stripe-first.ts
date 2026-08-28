import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type Stripe from 'stripe'
import { z } from 'zod'
import type { DatabaseConnection } from '../../db/connect'
import { createMagicLinkEmail, type TransactionalEmailSender } from '../email'
import type { BillingStripeRuntimeConfiguration } from '../payments/stripe/configuration'
import { conflictError, upstreamServiceError, validationError } from '../../utils/errors'

export const stripeSupporterPriceId = 'price_1U9I17GqgHVbR26t3GDDF3Jg'
export const stripeMembershipTierSchema = z.enum(['supporter', 'member', 'solidarity'])
export const stripeMembershipCheckoutSchema = z.object({ tier: stripeMembershipTierSchema }).strict()
export const stripeMembershipCompletionSchema = z.object({ sessionId: z.string().regex(/^cs_[A-Za-z0-9_]+$/) }).strict()
const stripeMembershipClaimSchema = stripeMembershipCompletionSchema.extend({ email: z.string() }).strict()

export type StripeMembershipTier = z.infer<typeof stripeMembershipTierSchema>
type StripeMembershipConnection = Readonly<{ sqlite: DatabaseConnection['sqlite'] }>

export function stripeMembershipConfiguration(config: BillingStripeRuntimeConfiguration) {
  return {
    appName: config.appName,
    appUrl: config.appUrl.replace(/\/$/, ''),
    prices: {
      supporter: stripeSupporterPriceId,
      member: config.stripe.prices['personal.monthly'],
      solidarity: config.stripe.prices['family.monthly']
    }
  }
}

export async function createStripeMembershipCheckout(
  client: Stripe,
  config: ReturnType<typeof stripeMembershipConfiguration>,
  tier: StripeMembershipTier
): Promise<{ url: string }> {
  const session = await stripeRead(() =>
    client.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: config.prices[tier], quantity: 1 }],
      payment_method_collection: 'if_required',
      integration_identifier: `wcu_membership_${randomLetters(8)}`,
      metadata: { wcu_membership_tier: tier },
      subscription_data: { metadata: { wcu_membership_tier: tier } },
      success_url: `${config.appUrl}/join/complete?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.appUrl}/join`
    })
  )
  if (!session.url) throw upstreamServiceError(502, 'Stripe Checkout did not return a redirect')
  return Object.freeze({ url: session.url })
}

export async function validateStripeMembershipCheckout(
  client: Stripe,
  config: ReturnType<typeof stripeMembershipConfiguration>,
  sessionId: string
) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw validationError('Invalid Checkout Session')

  const session = await stripeRead(() => client.checkout.sessions.retrieve(sessionId))
  const tier = stripeMembershipTierSchema.safeParse(session.metadata?.wcu_membership_tier)
  const customerId = providerId(session.customer, 'cus_')
  const subscriptionId = providerId(session.subscription, 'sub_')
  if (
    session.status !== 'complete' ||
    session.mode !== 'subscription' ||
    !tier.success ||
    !customerId ||
    !subscriptionId
  ) {
    throw conflictError('Checkout is not eligible for account creation')
  }

  const [customer, subscription] = await Promise.all([
    stripeRead(() => client.customers.retrieve(customerId)),
    stripeRead(() => client.subscriptions.retrieve(subscriptionId))
  ])
  if (customer.deleted) throw conflictError('Checkout customer is unavailable')

  const expectedPriceId = config.prices[tier.data]
  const item = subscription.items.data.length === 1 ? subscription.items.data[0] : undefined
  const checkoutEmail = normalizeEmail(session.customer_details?.email ?? session.customer_email)
  const customerEmail = normalizeEmail(customer.email)
  if (
    subscription.status !== 'active' ||
    providerId(subscription.customer, 'cus_') !== customerId ||
    subscription.metadata.wcu_membership_tier !== tier.data ||
    item?.price.id !== expectedPriceId ||
    item.quantity !== 1 ||
    !checkoutEmail ||
    checkoutEmail !== customerEmail
  ) {
    throw conflictError('Checkout is not eligible for account creation')
  }

  return Object.freeze({
    customerId,
    email: checkoutEmail,
    priceId: expectedPriceId,
    subscriptionId,
    tier: tier.data
  })
}

export async function issueStripeMembershipMagicLink(input: {
  client: Stripe
  config: ReturnType<typeof stripeMembershipConfiguration>
  connection: StripeMembershipConnection
  sender: TransactionalEmailSender
  sessionId: string
}): Promise<void> {
  const membership = await validateStripeMembershipCheckout(input.client, input.config, input.sessionId)
  const token = randomBytes(32).toString('base64url')
  const now = Math.floor(Date.now() / 1_000)
  input.connection.sqlite
    .prepare(
      `insert into verification (id, identifier, value, expires_at, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?)`
    )
    .run(
      `stripe_membership_${randomUUID()}`,
      verificationIdentifier(token),
      JSON.stringify({ email: membership.email, sessionId: input.sessionId }),
      now + 300,
      now,
      now
    )

  const url = `${input.config.appUrl}/api/auth/stripe-membership/claim?token=${encodeURIComponent(token)}`
  await input.sender.send({
    ...createMagicLinkEmail({ appName: input.config.appName, to: membership.email, url }),
    idempotencyKey: `stripe-membership-${digest(input.sessionId).slice(0, 32)}`
  })
}

export async function claimStripeMembership(input: {
  client: Stripe
  config: ReturnType<typeof stripeMembershipConfiguration>
  connection: StripeMembershipConnection
  generateUserId: () => string
  token: string
}): Promise<{ userId: string }> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.token)) throw validationError('Invalid membership link')
  const identifier = verificationIdentifier(input.token)
  const verification = input.connection.sqlite
    .prepare('select id, value, expires_at as expiresAt from verification where identifier = ?')
    .get(identifier) as { id: string; value: string; expiresAt: number } | undefined
  if (!verification || verification.expiresAt <= Math.floor(Date.now() / 1_000)) {
    throw conflictError('Membership link is unavailable')
  }

  const parsed = stripeMembershipClaimSchema.safeParse(JSON.parse(verification.value))
  if (!parsed.success) throw conflictError('Membership link is unavailable')
  const membership = await validateStripeMembershipCheckout(input.client, input.config, parsed.data.sessionId)
  if (membership.email !== parsed.data.email) throw conflictError('Membership email changed')
  const now = Math.floor(Date.now() / 1_000)

  return input.connection.sqlite.transaction(() => {
    const consumed = input.connection.sqlite
      .prepare('delete from verification where id = ? and identifier = ? and expires_at > ?')
      .run(verification.id, identifier, now)
    if (consumed.changes !== 1) throw conflictError('Membership link is unavailable')

    const matches = input.connection.sqlite
      .prepare('select id from user where lower(trim(email)) = ? limit 2')
      .all(membership.email) as Array<{ id: string }>
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
        .prepare('update user set email_verified = 1, updated_at = ? where id = ?')
        .run(now, userId)
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
  })()
}

export function hasAccountStripeMembership(connection: StripeMembershipConnection, userId: string): boolean {
  return Boolean(connection.sqlite.prepare('select 1 from account_stripe_memberships where user_id = ?').get(userId))
}

function providerId(value: string | { id: string } | null, prefix: string): string | null {
  const id = typeof value === 'string' ? value : value?.id
  return id?.startsWith(prefix) ? id : null
}

function normalizeEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase() ?? ''
  return email.length >= 3 && email.length <= 320 && email.indexOf('@') > 0 ? email : null
}

async function stripeRead<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch {
    throw upstreamServiceError(502, 'Stripe is temporarily unavailable')
  }
}

function verificationIdentifier(token: string): string {
  return `stripe-membership:${digest(token)}`
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function randomLetters(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'
  return [...randomBytes(length)].map((value) => alphabet[value % alphabet.length]).join('')
}
