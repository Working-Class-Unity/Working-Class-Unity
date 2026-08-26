import { randomUUID } from 'node:crypto'
import type { MembershipDuesOfferingKey } from '../../../shared/billing'
import type { BillingStripeConnection } from '../payments/stripe/public-contract'

export type ImportedStripeBillingPrices = Readonly<Record<MembershipDuesOfferingKey, string>>

type ImportedSubscriptionRow = Readonly<{
  cancelAtPeriodEnd: number
  currentPeriodEnd: string | null
  currentPeriodStart: string | null
  customerId: string
  itemId: string | null
  priceId: string | null
  status: string
  subscriptionId: string
}>

export function hasCurrentImportedStripeDuesSubscription(
  connection: BillingStripeConnection,
  userId: string,
  prices: ImportedStripeBillingPrices
): boolean {
  const configuredPrices = new Set(Object.values(prices).filter(Boolean))
  return importedSubscriptionRows(connection, userId).some(
    (row) => row.priceId !== null && configuredPrices.has(row.priceId)
  )
}

export function adoptImportedStripeBilling(
  connection: BillingStripeConnection,
  userId: string,
  prices: ImportedStripeBillingPrices,
  observedAt: Date
): Readonly<{ outcome: 'adopted' | 'conflict' | 'none'; identifier: string | null }> {
  const rows = importedSubscriptionRows(connection, userId)
  if (rows.length === 0) return outcome('none')

  const subscriptionIds = new Set(rows.map(({ subscriptionId }) => subscriptionId))
  const row = rows[0]!
  if (subscriptionIds.size !== 1 || rows.length !== 1) return outcome('conflict', row.customerId)
  if (row.status !== 'active' || !row.itemId || !row.priceId) return outcome('none')

  const offering = Object.entries(prices).find(([, priceId]) => priceId === row.priceId)?.[0] as
    MembershipDuesOfferingKey | undefined
  const periodStart = Date.parse(row.currentPeriodStart ?? '')
  const periodEnd = Date.parse(row.currentPeriodEnd ?? '')
  if (!offering || !Number.isFinite(periodStart) || !Number.isFinite(periodEnd) || periodEnd <= periodStart) {
    return outcome('none')
  }

  const existingCustomerForUser = connection.sqlite
    .prepare('select id, stripe_customer_id as stripeCustomerId from billing_customers where purchaser_user_id = ?')
    .get(userId) as { id: string; stripeCustomerId: string } | undefined
  const existingCustomerForStripe = connection.sqlite
    .prepare('select id, purchaser_user_id as purchaserUserId from billing_customers where stripe_customer_id = ?')
    .get(row.customerId) as { id: string; purchaserUserId: string } | undefined
  if (
    (existingCustomerForUser && existingCustomerForUser.stripeCustomerId !== row.customerId) ||
    (existingCustomerForStripe && existingCustomerForStripe.purchaserUserId !== userId)
  ) {
    return outcome('conflict', row.customerId)
  }

  const billingCustomerId =
    existingCustomerForUser?.id ?? existingCustomerForStripe?.id ?? `billing_customer_${randomUUID()}`
  const existingSubscriptionForUser = connection.sqlite
    .prepare(
      `select stripe_subscription_id as stripeSubscriptionId
       from billing_subscriptions where purchaser_user_id = ?`
    )
    .get(userId) as { stripeSubscriptionId: string | null } | undefined
  const existingSubscriptionForStripe = connection.sqlite
    .prepare(
      `select purchaser_user_id as purchaserUserId
       from billing_subscriptions where stripe_subscription_id = ?`
    )
    .get(row.subscriptionId) as { purchaserUserId: string } | undefined
  if (
    (existingSubscriptionForUser && existingSubscriptionForUser.stripeSubscriptionId !== row.subscriptionId) ||
    (existingSubscriptionForStripe && existingSubscriptionForStripe.purchaserUserId !== userId)
  ) {
    return outcome('conflict', row.customerId)
  }
  if (!existingCustomerForUser && !existingCustomerForStripe) {
    connection.sqlite
      .prepare(
        `insert into billing_customers
           (id, purchaser_user_id, stripe_customer_id, created_at, updated_at)
         values (?, ?, ?, ?, ?)`
      )
      .run(billingCustomerId, userId, row.customerId, observedAt.toISOString(), observedAt.toISOString())
  }
  if (existingSubscriptionForUser || existingSubscriptionForStripe) return outcome('adopted', row.customerId)

  const [plan, cadence] = offering.split('.') as ['family' | 'personal', 'monthly']
  connection.sqlite
    .prepare(
      `insert into billing_subscriptions (
         id, purchaser_user_id, billing_customer_id, stripe_subscription_id,
         stripe_subscription_item_id, status, plan_key, cadence, stripe_price_id,
         current_period_start, current_period_end, cancel_at_period_end,
         last_verified_at, projection_order_ms, created_at, updated_at
       ) values (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      `billing_subscription_${randomUUID()}`,
      userId,
      billingCustomerId,
      row.subscriptionId,
      row.itemId,
      plan,
      cadence,
      row.priceId,
      row.currentPeriodStart,
      row.currentPeriodEnd,
      row.cancelAtPeriodEnd === 1 ? 1 : 0,
      observedAt.toISOString(),
      observedAt.getTime(),
      observedAt.toISOString(),
      observedAt.toISOString()
    )
  return outcome('adopted', row.customerId)
}

function importedSubscriptionRows(connection: BillingStripeConnection, userId: string): ImportedSubscriptionRow[] {
  return connection.sqlite
    .prepare(
      `select sc.id as customerId, ss.id as subscriptionId, ss.status,
              ss.current_period_start as currentPeriodStart, ss.current_period_end as currentPeriodEnd,
              ss.cancel_at_period_end as cancelAtPeriodEnd,
              ssi.id as itemId, ssi.price_id as priceId
       from person_accounts pa
       join stripe_customers sc on sc.person_id = pa.person_id
       join stripe_subscriptions ss on ss.customer_id = sc.id
       left join stripe_subscription_items ssi on ssi.subscription_id = ss.id
       where pa.user_id = ? and ss.status in ('active', 'past_due', 'unpaid')
       order by ss.id, ssi.id`
    )
    .all(userId) as ImportedSubscriptionRow[]
}

function outcome(value: 'adopted' | 'conflict' | 'none', identifier: string | null = null) {
  return Object.freeze({ outcome: value, identifier })
}
