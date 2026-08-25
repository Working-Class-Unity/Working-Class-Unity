import type Stripe from 'stripe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BillingStripeRuntimeConfiguration } from '../../server/services/payments/stripe/configuration'
import {
  billingReconciliationSafetyIntervalMs,
  billingReconciliationSafetyJobType,
  createBillingReconciliationSafetyHandler,
  ensureBillingReconciliationSafetyJob
} from '../../server/services/payments/stripe/reconciliation-safety'
import {
  createBillingStripeRuntimeFixture,
  seedBillingCustomer,
  seedBillingSubscription,
  type BillingStripeRuntimeFixture
} from './runtime-fixture'

const fixtures: BillingStripeRuntimeFixture[] = []
const now = new Date('2026-07-28T12:00:00.000Z')
const periodStart = '2026-07-01T00:00:00.000Z'
const periodEnd = '2026-08-01T00:00:00.000Z'
const configuration = {
  enabled: true,
  appName: 'Safety Test',
  appUrl: 'https://app.example.test',
  stripe: {
    secretKey: 'rk_test_safety',
    webhookSecret: 'whsec_safety',
    portalConfigurationId: 'bpc_safety',
    prices: {
      'personal.weekly': 'price_personal_weekly_safety',
      'personal.monthly': 'price_personal_monthly_safety',
      'personal.annual': 'price_personal_annual_safety',
      'family.monthly': 'price_family_monthly_safety',
      'family.annual': 'price_family_annual_safety'
    }
  }
} as const satisfies BillingStripeRuntimeConfiguration

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.sqlite.close()
})

describe('periodic Stripe reconciliation safety job', () => {
  it('keeps one future root only while an active/grace/suspended projection exists', () => {
    const fixture = runtimeFixture('root')
    expect(ensureBillingReconciliationSafetyJob(fixture.connection, now)).toBe('idle')
    seedSafetySubscription(fixture, 'active')

    expect(ensureBillingReconciliationSafetyJob(fixture.connection, now)).toBe('scheduled')
    expect(ensureBillingReconciliationSafetyJob(fixture.connection, now)).toBe('covered-future')
    expect(safetyJobs(fixture)).toEqual([
      expect.objectContaining({
        type: billingReconciliationSafetyJobType,
        status: 'queued',
        runAfter: new Date(now.getTime() + billingReconciliationSafetyIntervalMs).toISOString(),
        payload: JSON.stringify({
          cursor: null,
          cycleStartedAt: new Date(now.getTime() + billingReconciliationSafetyIntervalMs).toISOString()
        })
      })
    ])

    fixture.sqlite
      .prepare("update billing_subscriptions set status = 'canceled' where purchaser_user_id = ?")
      .run(fixture.purchaserUserId)
    expect(ensureBillingReconciliationSafetyJob(fixture.connection, now)).toBe('idle')
  })

  it('reads one exact bounded subscription, CAS-applies it, and schedules a cursor successor', async () => {
    const fixture = runtimeFixture('active')
    const subscriptionId = seedSafetySubscription(fixture, 'active')
    const provider = providerClient(providerSubscription('active'))
    const handler = createBillingReconciliationSafetyHandler({
      connection: fixture.connection,
      client: provider.client,
      config: configuration,
      now: () => now
    })

    await handler({ cursor: null, cycleStartedAt: now.toISOString() })
    expect(provider.retrieve).toHaveBeenCalledWith(
      'sub_safety',
      { expand: ['latest_invoice', 'schedule'] },
      { timeout: 5_000, maxNetworkRetries: 0 }
    )
    expect(provider.list.mock.calls).toEqual(
      ['active', 'incomplete', 'trialing', 'paused', 'past_due', 'unpaid', 'active'].map((status) => [
        { customer: 'cus_safety', status, limit: 2 },
        { timeout: 5_000, maxNetworkRetries: 0 }
      ])
    )
    expect(subscriptionRow(fixture)).toMatchObject({
      status: 'active',
      reconciliation_required: 0,
      revision: 1,
      last_verified_at: now.toISOString()
    })
    expect(safetyJobs(fixture)).toEqual([
      expect.objectContaining({
        payload: JSON.stringify({ cursor: subscriptionId, cycleStartedAt: now.toISOString() }),
        runAfter: now.toISOString()
      })
    ])

    await handler({ cursor: subscriptionId, cycleStartedAt: now.toISOString() })
    expect(safetyJobs(fixture)).toHaveLength(2)
    expect(safetyJobs(fixture)[1]).toEqual(
      expect.objectContaining({
        payload: JSON.stringify({
          cursor: null,
          cycleStartedAt: new Date(now.getTime() + billingReconciliationSafetyIntervalMs).toISOString()
        }),
        runAfter: new Date(now.getTime() + billingReconciliationSafetyIntervalMs).toISOString()
      })
    )
  })

  it('clears grace only when the same anchored renewal invoice is authoritatively paid', async () => {
    const fixture = runtimeFixture('grace')
    seedSafetySubscription(fixture, 'past_due', {
      invoiceId: 'in_safety_grace',
      startedAt: '2026-07-20T12:00:00.000Z',
      endsAt: '2026-08-03T12:00:00.000Z'
    })
    const subscription = providerSubscription('active')
    subscription.latest_invoice = renewalInvoice(subscription, 'in_safety_grace', 'paid')
    const handler = createBillingReconciliationSafetyHandler({
      connection: fixture.connection,
      client: providerClient(subscription).client,
      config: configuration,
      now: () => now
    })

    await handler({ cursor: null, cycleStartedAt: now.toISOString() })
    expect(subscriptionRow(fixture)).toMatchObject({
      status: 'active',
      grace_invoice_id: null,
      grace_started_at: null,
      grace_ends_at: null,
      reconciliation_required: 0
    })
  })

  it('rejects non-exact job payloads before provider work', async () => {
    const fixture = runtimeFixture('payload')
    const provider = providerClient(providerSubscription('active'))
    const handler = createBillingReconciliationSafetyHandler({
      connection: fixture.connection,
      client: provider.client,
      config: configuration
    })

    await expect(
      handler({
        cursor: null,
        cycleStartedAt: now.toISOString(),
        injected: true
      })
    ).rejects.toThrow('Invalid Billing reconciliation safety payload')
    expect(provider.list).not.toHaveBeenCalled()
    expect(provider.retrieve).not.toHaveBeenCalled()
  })

  it('rejects a stale CAS after provider I/O without committing or advancing the cursor', async () => {
    const fixture = runtimeFixture('cas')
    seedSafetySubscription(fixture, 'active')
    const subscription = providerSubscription('active')
    const provider = providerClient(subscription)
    provider.retrieve.mockImplementationOnce(async () => {
      fixture.sqlite
        .prepare('update billing_subscriptions set revision = revision + 1 where purchaser_user_id = ?')
        .run(fixture.purchaserUserId)
      return subscription
    })
    const handler = createBillingReconciliationSafetyHandler({
      connection: fixture.connection,
      client: provider.client,
      config: configuration,
      now: () => now
    })

    await expect(handler({ cursor: null, cycleStartedAt: now.toISOString() })).rejects.toThrow(
      'Billing reconciliation safety authority changed'
    )
    expect(subscriptionRow(fixture)).toMatchObject({ revision: 1, last_verified_at: periodStart })
    expect(safetyJobs(fixture)).toEqual([])
  })
})

function runtimeFixture(suffix: string): BillingStripeRuntimeFixture {
  const fixture = createBillingStripeRuntimeFixture(`purchaser_safety_${suffix}`)
  fixtures.push(fixture)
  return fixture
}

function seedSafetySubscription(
  fixture: BillingStripeRuntimeFixture,
  status: 'active' | 'past_due' | 'unpaid',
  grace: Readonly<{ invoiceId: string; startedAt: string; endsAt: string }> | null = null
): string {
  const customerId = seedBillingCustomer(fixture, 'cus_safety')
  return seedBillingSubscription(fixture, {
    customerId,
    stripeSubscriptionId: 'sub_safety',
    stripeSubscriptionItemId: 'si_safety',
    status,
    planKey: 'family',
    cadence: 'monthly',
    stripePriceId: 'price_family_monthly_safety',
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    graceInvoiceId: grace?.invoiceId,
    graceStartedAt: grace?.startedAt,
    graceEndsAt: grace?.endsAt,
    projectionOrderMs: 1_000,
    projectionEventId: 'evt_safety_seed'
  })
}

function providerSubscription(status: Stripe.Subscription.Status): Stripe.Subscription {
  return {
    id: 'sub_safety',
    object: 'subscription',
    customer: 'cus_safety',
    status,
    collection_method: 'charge_automatically',
    cancel_at: null,
    cancel_at_period_end: false,
    canceled_at: null,
    ended_at: null,
    pause_collection: null,
    trial_end: null,
    discounts: [],
    billing_schedules: [],
    schedule: null,
    pending_update: null,
    latest_invoice: null,
    metadata: {},
    items: {
      object: 'list',
      data: [
        {
          id: 'si_safety',
          object: 'subscription_item',
          current_period_start: Math.floor(Date.parse(periodStart) / 1_000),
          current_period_end: Math.floor(Date.parse(periodEnd) / 1_000),
          quantity: 1,
          price: { id: 'price_family_monthly_safety', object: 'price' },
          discounts: []
        } as Stripe.SubscriptionItem
      ],
      has_more: false,
      url: '/v1/subscription_items?subscription=sub_safety'
    }
  } as Stripe.Subscription
}

function renewalInvoice(subscription: Stripe.Subscription, id: string, status: 'open' | 'paid'): Stripe.Invoice {
  return {
    id,
    object: 'invoice',
    customer: 'cus_safety',
    status,
    billing_reason: 'subscription_cycle',
    collection_method: 'charge_automatically',
    attempted: true,
    attempt_count: 1,
    amount_remaining: status === 'open' ? 1_000 : 0,
    parent: {
      type: 'subscription_details',
      quote_details: null,
      subscription_details: { metadata: null, subscription: subscription.id }
    }
  } as Stripe.Invoice
}

function providerClient(subscription: Stripe.Subscription) {
  const list = vi.fn(
    async (parameters: Stripe.SubscriptionListParams) =>
      ({
        object: 'list',
        data: parameters.status === subscription.status ? [subscription] : [],
        has_more: false,
        url: '/v1/subscriptions'
      }) as Stripe.ApiList<Stripe.Subscription>
  )
  const retrieve = vi.fn(async (id: string) => {
    if (id !== subscription.id) throw new Error('subscription not found')
    return subscription
  })
  return { list, retrieve, client: { subscriptions: { list, retrieve } } as never }
}

function safetyJobs(fixture: BillingStripeRuntimeFixture) {
  return fixture.sqlite
    .prepare(
      `select type, status, payload, run_after as runAfter
     from job_queue where type = ? order by id`
    )
    .all(billingReconciliationSafetyJobType) as Array<Record<string, unknown>>
}

function subscriptionRow(fixture: BillingStripeRuntimeFixture): Record<string, unknown> {
  return fixture.sqlite
    .prepare('select * from billing_subscriptions where purchaser_user_id = ?')
    .get(fixture.purchaserUserId) as Record<string, unknown>
}
