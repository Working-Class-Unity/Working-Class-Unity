import type Stripe from 'stripe'
import type { DatabaseConnection } from '../../db/connect'
import type { AccountStripeMembershipStatus } from '../../db/schema/billing'
import { stripeSupporterPriceId, type StripeMembershipTier } from './stripe-first'
import { exactStripeMembershipStatus } from './stripe-projection'

type LinkConnection = Readonly<{ sqlite: DatabaseConnection['sqlite'] }>
type StripeMembershipLink = Readonly<{
  projectionEventId: string | null
  projectionOrderMs: number
  stripeCustomerId: string
  stripePriceId: string
  stripeStatus: AccountStripeMembershipStatus | null
  stripeSubscriptionId: string
  tier: StripeMembershipTier
  userId: string
}>

export type StripeMembershipAdoptionPrices = Readonly<{
  member: readonly string[]
  solidarity: readonly string[]
}>

export class StripeMembershipLinkSyncReadError extends Error {}

type ExistingObservation = Readonly<{ expected: StripeMembershipLink; subscription: Stripe.Subscription }>
type AdoptionCandidate = Readonly<{
  priceId: string
  subscription: Stripe.Subscription
  tier: 'member' | 'solidarity'
}>
type Refresh = Readonly<{ link: StripeMembershipLink; status: AccountStripeMembershipStatus | null }>
type Adoption = Readonly<{
  customerId: string
  priceId: string
  subscriptionId: string
  tier: 'member' | 'solidarity'
  userId: string
}>

const linkSelect = `select user_id as userId, stripe_customer_id as stripeCustomerId,
  stripe_subscription_id as stripeSubscriptionId, stripe_price_id as stripePriceId,
  tier, stripe_status as stripeStatus, projection_order_ms as projectionOrderMs,
  projection_event_id as projectionEventId from account_stripe_memberships`

export function assertStripeMembershipAdoptionPrices(prices: StripeMembershipAdoptionPrices): void {
  adoptionPriceTiers(prices)
}

export function readStripeMembershipAdoptionPrices(
  environment: Readonly<Record<string, string | undefined>>
): StripeMembershipAdoptionPrices {
  const prices = {
    member: priceList(environment.WCU_STRIPE_LEGACY_DUES10_PRICE_IDS),
    solidarity: priceList(environment.WCU_STRIPE_LEGACY_DUES27_PRICE_IDS)
  }
  assertStripeMembershipAdoptionPrices(prices)
  return Object.freeze(prices)
}

export async function synchronizeStripeMembershipLinks(input: {
  apply: boolean
  client: Stripe
  connection: LinkConnection
  legacyPrices: StripeMembershipAdoptionPrices
}) {
  const priceTiers = adoptionPriceTiers(input.legacyPrices)
  const existing = input.connection.sqlite.prepare(`${linkSelect} order by user_id`).all() as StripeMembershipLink[]
  const existingObservations: ExistingObservation[] = []
  const candidates = new Map<string, AdoptionCandidate>()
  try {
    for (const link of existing) {
      existingObservations.push({
        expected: link,
        subscription: await input.client.subscriptions.retrieve(link.stripeSubscriptionId)
      })
    }
    for (const [priceId, tier] of priceTiers) {
      for await (const subscription of input.client.subscriptions.list({
        expand: ['data.customer'],
        limit: 100,
        price: priceId,
        status: 'active'
      })) {
        candidates.set(subscription.id, { priceId, subscription, tier })
      }
    }
  } catch (error) {
    throw new StripeMembershipLinkSyncReadError('Stripe membership link synchronization could not read Stripe', {
      cause: error
    })
  }

  const observedAt = new Date()
  const build = () => buildPlan(input.connection, existingObservations, [...candidates.values()])
  if (!input.apply) return reportFor(build(), false, existingObservations.length, candidates.size)

  return input.connection.sqlite
    .transaction(() => {
      const plan = build()
      applyPlan(input.connection, plan, observedAt)
      return reportFor(plan, true, existingObservations.length, candidates.size)
    })
    .immediate()
}

type SyncPlan = ReturnType<typeof emptyPlan>

function buildPlan(
  connection: LinkConnection,
  existing: readonly ExistingObservation[],
  candidates: readonly AdoptionCandidate[]
): SyncPlan {
  const plan = emptyPlan()
  for (const observation of existing) {
    const current = readLink(connection, 'user_id', observation.expected.userId)
    if (!current || linkFingerprint(current) !== linkFingerprint(observation.expected)) {
      plan.issues.concurrentChange += 1
      continue
    }
    const status = exactStripeMembershipStatus(observation.subscription, current)
    plan.refreshes.push({ link: current, status })
    if (status === null) plan.issues.invalidSubscription += 1
  }

  const eligible = new Map<string, Adoption[]>()
  for (const candidate of candidates) {
    if (readLink(connection, 'stripe_subscription_id', candidate.subscription.id)) {
      plan.alreadyLinked += 1
      continue
    }
    const validated = validAdoption(candidate)
    if (!validated) {
      plan.issues.invalidSubscription += 1
      continue
    }
    const accounts = verifiedAccountsForEmail(connection, validated.email)
    if (accounts.length === 0) {
      plan.issues.accountMissing += 1
      continue
    }
    if (accounts.length > 1) {
      plan.issues.accountAmbiguous += 1
      continue
    }
    const userId = accounts[0]!.id
    if (
      readLink(connection, 'user_id', userId) ||
      readLink(connection, 'stripe_customer_id', validated.customerId) ||
      deletionPending(connection, userId)
    ) {
      plan.issues.conflict += 1
      continue
    }
    const adoption = {
      customerId: validated.customerId,
      priceId: candidate.priceId,
      subscriptionId: candidate.subscription.id,
      tier: candidate.tier,
      userId
    } as const
    const forUser = eligible.get(userId) ?? []
    forUser.push(adoption)
    eligible.set(userId, forUser)
  }

  for (const values of eligible.values()) {
    if (values.length !== 1) {
      plan.issues.multipleSubscriptions += values.length
      continue
    }
    plan.adoptions.push(values[0]!)
  }
  return plan
}

function applyPlan(connection: LinkConnection, plan: SyncPlan, observedAt: Date): void {
  const timestamp = observedAt.toISOString()
  const orderMs = observedAt.getTime()
  const update = connection.sqlite.prepare(
    `update account_stripe_memberships
     set stripe_status = ?, last_verified_at = ?, projection_order_ms = ?,
         projection_event_id = null, updated_at = ?
     where user_id = ? and stripe_customer_id = ? and stripe_subscription_id = ? and stripe_price_id = ?`
  )
  for (const refresh of plan.refreshes) {
    const changed = update.run(
      refresh.status,
      timestamp,
      Math.max(orderMs, refresh.link.projectionOrderMs),
      timestamp,
      refresh.link.userId,
      refresh.link.stripeCustomerId,
      refresh.link.stripeSubscriptionId,
      refresh.link.stripePriceId
    )
    if (changed.changes !== 1) throw new Error('Stripe membership link changed during synchronization')
  }

  const insert = connection.sqlite.prepare(
    `insert into account_stripe_memberships
       (user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, tier,
        stripe_status, last_verified_at, projection_order_ms)
     values (?, ?, ?, ?, ?, 'active', ?, ?)`
  )
  for (const adoption of plan.adoptions) {
    insert.run(
      adoption.userId,
      adoption.customerId,
      adoption.subscriptionId,
      adoption.priceId,
      adoption.tier,
      timestamp,
      orderMs
    )
  }
}

function validAdoption(candidate: AdoptionCandidate) {
  const customer = expandedCustomer(candidate.subscription.customer)
  if (!customer || candidate.subscription.status !== 'active') return null
  const expected = {
    stripeCustomerId: customer.id,
    stripePriceId: candidate.priceId,
    stripeSubscriptionId: candidate.subscription.id,
    tier: candidate.tier
  }
  if (exactStripeMembershipStatus(candidate.subscription, expected) !== 'active') return null
  const email = normalizedEmail(customer.email)
  return email ? { customerId: customer.id, email } : null
}

function adoptionPriceTiers(prices: StripeMembershipAdoptionPrices): ReadonlyMap<string, 'member' | 'solidarity'> {
  const values = new Map<string, 'member' | 'solidarity'>()
  for (const tier of ['member', 'solidarity'] as const) {
    if (prices[tier].length === 0) throw new TypeError(`Stripe ${tier} adoption Prices are required`)
    for (const priceId of prices[tier]) {
      if (!/^[A-Za-z0-9_-]{1,255}$/.test(priceId) || priceId === stripeSupporterPriceId || values.has(priceId)) {
        throw new TypeError('Stripe adoption Prices must be valid, distinct paid Price IDs')
      }
      values.set(priceId, tier)
    }
  }
  return values
}

function priceList(value: string | undefined): readonly string[] {
  if (!value || value !== value.trim()) throw new TypeError('Stripe adoption Price lists are required')
  const prices = value.split(',')
  if (prices.some((price) => !price || price !== price.trim())) {
    throw new TypeError('Stripe adoption Price lists must contain trimmed values')
  }
  return Object.freeze(prices)
}

function readLink(
  connection: LinkConnection,
  column: 'stripe_customer_id' | 'stripe_subscription_id' | 'user_id',
  value: string
): StripeMembershipLink | null {
  return (connection.sqlite.prepare(`${linkSelect} where ${column} = ?`).get(value) as StripeMembershipLink) ?? null
}

function verifiedAccountsForEmail(connection: LinkConnection, email: string): readonly { id: string }[] {
  return connection.sqlite
    .prepare('select id from user where email_verified = 1 and lower(trim(email)) = ? limit 2')
    .all(email) as Array<{ id: string }>
}

function deletionPending(connection: LinkConnection, userId: string): boolean {
  return Boolean(
    connection.sqlite.prepare('select 1 from billing_account_deletion_requests where purchaser_user_id = ?').get(userId)
  )
}

function expandedCustomer(value: Stripe.Subscription['customer']): Stripe.Customer | null {
  if (typeof value === 'string' || ('deleted' in value && value.deleted)) return null
  return value as Stripe.Customer
}

function normalizedEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase() ?? ''
  return email.length >= 3 && email.length <= 320 && email.indexOf('@') > 0 ? email : null
}

function linkFingerprint(link: StripeMembershipLink): string {
  return Object.values(link).join('\n')
}

function emptyPlan() {
  return {
    adoptions: [] as Adoption[],
    alreadyLinked: 0,
    refreshes: [] as Refresh[],
    issues: {
      accountAmbiguous: 0,
      accountMissing: 0,
      concurrentChange: 0,
      conflict: 0,
      invalidSubscription: 0,
      multipleSubscriptions: 0
    }
  }
}

function reportFor(plan: SyncPlan, apply: boolean, linkedSubscriptions: number, adoptionSubscriptions: number) {
  return {
    mode: apply ? 'apply' : 'dry-run',
    fetched: { adoptionSubscriptions, linkedSubscriptions },
    links: {
      adopted: plan.adoptions.length,
      alreadyLinked: plan.alreadyLinked,
      refreshed: plan.refreshes.filter((refresh) => refresh.status !== null).length
    },
    issues: { ...plan.issues }
  } as const
}
