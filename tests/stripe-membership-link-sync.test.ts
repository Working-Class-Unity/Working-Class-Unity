import type Stripe from 'stripe'
import { afterEach, describe, expect, it } from 'vitest'
import { readWebsiteMembershipAccess } from '../server/services/membership/member-access'
import {
  StripeMembershipLinkSyncReadError,
  synchronizeStripeMembershipLinks
} from '../server/services/membership/stripe-link-sync'
import {
  createBillingStripeRuntimeFixture,
  seedAccountStripeMembership,
  type BillingStripeRuntimeFixture
} from './billing/runtime-fixture'

const legacyPrices = {
  member: ['membership-10-1month'],
  solidarity: ['solidarity-27-1month']
} as const
const accessPrices = {
  'personal.weekly': '',
  'personal.monthly': 'price_current_member',
  'personal.annual': '',
  'family.monthly': 'price_current_solidarity',
  'family.annual': ''
} as const
const fixtures: BillingStripeRuntimeFixture[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.sqlite.close()
})

describe('Stripe account membership link synchronization', () => {
  it('dry-runs, adopts both paid tiers, and repeats idempotently without tier metadata', async () => {
    const fixture = runtimeFixture('adopt')
    verifiedUser(fixture, fixture.purchaserUserId, 'member@example.test')
    verifiedUser(fixture, 'solidarity_user', 'solidarity@example.test')
    const subscriptions = [
      subscription('member', legacyPrices.member[0], 'member@example.test'),
      subscription('solidarity', legacyPrices.solidarity[0], 'solidarity@example.test')
    ]
    const client = stripeClient(subscriptions)

    const dryRun = await synchronize(fixture, client, false)
    expect(dryRun).toMatchObject({ mode: 'dry-run', links: { adopted: 2, refreshed: 0 } })
    expect(linkCount(fixture)).toBe(0)

    const applied = await synchronize(fixture, client)
    expect(applied).toMatchObject({ mode: 'apply', links: { adopted: 2 } })
    expect(linkCount(fixture)).toBe(2)
    expect(access(fixture, fixture.purchaserUserId).granted).toBe(true)
    expect(access(fixture, 'solidarity_user').granted).toBe(true)

    const repeated = await synchronize(fixture, client)
    expect(repeated).toMatchObject({ links: { adopted: 0, alreadyLinked: 2, refreshed: 2 } })
    expect(linkCount(fixture)).toBe(2)
  })

  it('refreshes Supporter as account-only', async () => {
    const fixture = runtimeFixture('refresh')
    seedAccountStripeMembership(fixture, {
      stripeCustomerId: 'cus_supporter',
      stripeSubscriptionId: 'sub_supporter',
      stripePriceId: 'price_1U9I17GqgHVbR26t3GDDF3Jg',
      tier: 'supporter'
    })
    const supporter = subscription('supporter', 'price_1U9I17GqgHVbR26t3GDDF3Jg', 'supporter@example.test', {
      customerId: 'cus_supporter',
      subscriptionId: 'sub_supporter'
    })
    await synchronize(fixture, stripeClient([supporter]))
    expect(linkProjection(fixture).status).toBe('active')
    expect(access(fixture, fixture.purchaserUserId).granted).toBe(false)
  })

  it('skips missing, ambiguous, conflicting-metadata, and multiple-subscription adoption', async () => {
    const fixture = runtimeFixture('fail_closed')
    verifiedUser(fixture, fixture.purchaserUserId, 'duplicate@example.test')
    verifiedUser(fixture, 'duplicate_user', 'DUPLICATE@example.test')
    verifiedUser(fixture, 'multiple_user', 'multiple@example.test')
    const subscriptions = [
      subscription('member', legacyPrices.member[0], 'missing@example.test', { subscriptionId: 'sub_missing' }),
      subscription('member', legacyPrices.member[0], 'duplicate@example.test', { subscriptionId: 'sub_ambiguous' }),
      subscription('member', legacyPrices.member[0], 'multiple@example.test', { subscriptionId: 'sub_multiple_1' }),
      subscription('solidarity', legacyPrices.solidarity[0], 'multiple@example.test', {
        subscriptionId: 'sub_multiple_2'
      }),
      subscription('member', legacyPrices.member[0], 'metadata@example.test', {
        metadataTier: 'solidarity',
        subscriptionId: 'sub_bad_metadata'
      })
    ]

    const report = await synchronize(fixture, stripeClient(subscriptions))
    expect(report).toMatchObject({
      links: { adopted: 0 },
      issues: {
        accountAmbiguous: 1,
        accountMissing: 1,
        invalidSubscription: 1,
        multipleSubscriptions: 2
      }
    })
    expect(linkCount(fixture)).toBe(0)
  })

  it('leaves SQLite unchanged when Stripe fails and preserves a concurrent webhook projection', async () => {
    const fixture = runtimeFixture('provider_failure')
    seedAccountStripeMembership(fixture, {
      stripeCustomerId: 'cus_member',
      stripeSubscriptionId: 'sub_member',
      stripePriceId: legacyPrices.member[0],
      tier: 'member'
    })
    fixture.sqlite
      .prepare("update account_stripe_memberships set stripe_status = 'active', last_verified_at = 'before'")
      .run()
    const failing = {
      subscriptions: { retrieve: async () => Promise.reject(new Error('provider unavailable')) }
    } as Stripe
    await expect(synchronize(fixture, failing)).rejects.toBeInstanceOf(StripeMembershipLinkSyncReadError)
    expect(linkProjection(fixture)).toMatchObject({ lastVerifiedAt: 'before', status: 'active' })

    const current = subscription('member', legacyPrices.member[0], 'member@example.test', {
      customerId: 'cus_member',
      subscriptionId: 'sub_member'
    })
    const concurrentClient = stripeClient([current], () => {
      fixture.sqlite
        .prepare(
          "update account_stripe_memberships set stripe_status = 'past_due', projection_order_ms = 5000, projection_event_id = 'evt_new'"
        )
        .run()
    })
    const report = await synchronize(fixture, concurrentClient)
    expect(report.issues.concurrentChange).toBe(1)
    expect(linkProjection(fixture)).toMatchObject({ projectionEventId: 'evt_new', status: 'past_due' })
  })
})

function runtimeFixture(label: string): BillingStripeRuntimeFixture {
  const fixture = createBillingStripeRuntimeFixture(`stripe_link_sync_${label}`)
  fixtures.push(fixture)
  return fixture
}

function synchronize(fixture: BillingStripeRuntimeFixture, client: Stripe, apply = true) {
  return synchronizeStripeMembershipLinks({ apply, client, connection: fixture.connection, legacyPrices })
}

function verifiedUser(fixture: BillingStripeRuntimeFixture, userId: string, email: string): void {
  fixture.sqlite
    .prepare(
      `insert into user (id, email, email_verified) values (?, ?, 1)
       on conflict(id) do update set email = excluded.email, email_verified = 1`
    )
    .run(userId, email)
}

function subscription(
  tier: 'supporter' | 'member' | 'solidarity',
  priceId: string,
  email: string,
  options: Readonly<{
    customerId?: string
    metadataTier?: string
    quantity?: number
    subscriptionId?: string
  }> = {}
): Stripe.Subscription {
  const subscriptionId = options.subscriptionId ?? `sub_${tier}`
  const customerId = options.customerId ?? `cus_${subscriptionId}`
  return {
    id: subscriptionId,
    object: 'subscription',
    customer: { id: customerId, object: 'customer', email } as Stripe.Customer,
    status: 'active',
    metadata: options.metadataTier ? { wcu_membership_tier: options.metadataTier } : {},
    items: {
      object: 'list',
      data: [
        {
          id: `si_${subscriptionId}`,
          object: 'subscription_item',
          price: { id: priceId, object: 'price' },
          quantity: options.quantity ?? 1
        } as Stripe.SubscriptionItem
      ],
      has_more: false,
      url: `/v1/subscription_items?subscription=${subscriptionId}`
    }
  } as Stripe.Subscription
}

function stripeClient(subscriptions: Stripe.Subscription[], afterRetrieve?: () => void): Stripe {
  const byId = new Map(subscriptions.map((value) => [value.id, value]))
  return {
    subscriptions: {
      retrieve: async (id: string) => {
        const value = byId.get(id)
        if (!value) throw new Error('missing subscription')
        afterRetrieve?.()
        return value
      },
      list: (parameters: Stripe.SubscriptionListParams) =>
        (async function* () {
          for (const value of subscriptions) {
            if (value.status === 'active' && value.items.data.some((item) => item.price.id === parameters.price)) {
              yield value
            }
          }
        })()
    }
  } as unknown as Stripe
}

function access(fixture: BillingStripeRuntimeFixture, userId: string) {
  return readWebsiteMembershipAccess(fixture.connection, userId, accessPrices)
}

function linkCount(fixture: BillingStripeRuntimeFixture): number {
  return (fixture.sqlite.prepare('select count(*) as count from account_stripe_memberships').get() as { count: number })
    .count
}

function linkProjection(fixture: BillingStripeRuntimeFixture) {
  return fixture.sqlite
    .prepare(
      `select stripe_status as status, last_verified_at as lastVerifiedAt,
              projection_event_id as projectionEventId
       from account_stripe_memberships where user_id = ?`
    )
    .get(fixture.purchaserUserId) as {
    lastVerifiedAt: string | null
    projectionEventId: string | null
    status: string | null
  }
}
