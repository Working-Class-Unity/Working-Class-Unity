import type Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import {
  billingReconciliationSafetyIntervalMs,
  billingReconciliationSafetyJobType,
  createBillingReconciliationSafetyHandler,
  ensureBillingReconciliationSafetyJob
} from '../server/services/payments/billing-reconciliation-safety'
import type { StripeBillingClient } from '../server/services/payments/stripe-client'
import type { AppRuntimeConfig } from '../server/utils/runtime'
import {
  createWorkspaceInvitationFixture,
  type SignedInFixtureUser,
  type WorkspaceInvitationFixture
} from './helpers/workspace-invitation-fixture'

const now = new Date('2026-07-28T12:00:00.000Z')
const periodStart = '2026-07-01T00:00:00.000Z'
const periodEnd = '2026-08-01T00:00:00.000Z'

describe('periodic Stripe reconciliation safety job', () => {
  it('keeps one future root only while an active/grace/suspended projection exists', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-safety-root@example.test', 'Billing Safety Root')
    try {
      expect(ensureBillingReconciliationSafetyJob(fixture.connection, now)).toBe('idle')
      seedSubscription(fixture, owner, 'active')
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
    } finally {
      fixture.cleanup()
    }
  })

  it('reads one exact bounded subscription, CAS-applies it, and schedules a cursor successor', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-safety-active@example.test', 'Billing Safety Active')
    seedSubscription(fixture, owner, 'active')
    const provider = providerClient(providerSubscription('active'))
    const handler = createBillingReconciliationSafetyHandler({
      connection: fixture.connection,
      client: provider.client,
      config: config(),
      now: () => now
    })

    try {
      await handler({ cursor: null, cycleStartedAt: now.toISOString() })
      expect(provider.retrieve).toHaveBeenCalledWith(
        'sub_safety',
        { expand: ['latest_invoice', 'schedule'] },
        { timeout: 5_000, maxNetworkRetries: 0 }
      )
      expect(provider.list.mock.calls).toEqual(
        ['active', 'incomplete', 'trialing', 'paused', 'past_due', 'unpaid', 'active'].map((status) => [
          {
            customer: 'cus_safety',
            status,
            limit: 2
          },
          {
            timeout: 5_000,
            maxNetworkRetries: 0
          }
        ])
      )
      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'active',
        reconciliation_required: 0,
        revision: 1,
        last_verified_at: expect.any(String)
      })
      expect(safetyJobs(fixture)).toEqual([
        expect.objectContaining({
          payload: JSON.stringify({
            cursor: 'billing_subscription_safety',
            cycleStartedAt: now.toISOString()
          }),
          runAfter: now.toISOString()
        })
      ])

      await handler({
        cursor: 'billing_subscription_safety',
        cycleStartedAt: now.toISOString()
      })
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
    } finally {
      fixture.cleanup()
    }
  })

  it('clears grace only when the same anchored renewal invoice is authoritatively paid', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-safety-grace@example.test', 'Billing Safety Grace')
    seedSubscription(fixture, owner, 'past_due', {
      invoiceId: 'in_safety_grace',
      startedAt: '2026-07-20T12:00:00.000Z',
      endsAt: '2026-08-03T12:00:00.000Z'
    })
    const subscription = providerSubscription('active')
    subscription.latest_invoice = renewalInvoice(subscription, 'in_safety_grace', 'paid')
    const handler = createBillingReconciliationSafetyHandler({
      connection: fixture.connection,
      client: providerClient(subscription).client,
      config: config(),
      now: () => now
    })

    try {
      await handler({ cursor: null, cycleStartedAt: now.toISOString() })
      expect(subscriptionRow(fixture)).toMatchObject({
        status: 'active',
        grace_invoice_id: null,
        grace_started_at: null,
        grace_ends_at: null,
        reconciliation_required: 0
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('rejects non-exact job payloads before provider work', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const provider = providerClient(providerSubscription('active'))
    const handler = createBillingReconciliationSafetyHandler({
      connection: fixture.connection,
      client: provider.client,
      config: config()
    })
    try {
      await expect(handler({ cursor: null, cycleStartedAt: now.toISOString(), injected: true })).rejects.toThrow(
        'Invalid billing reconciliation safety payload'
      )
      expect(provider.list).not.toHaveBeenCalled()
    } finally {
      fixture.cleanup()
    }
  })
})

function seedSubscription(
  fixture: WorkspaceInvitationFixture,
  owner: SignedInFixtureUser,
  status: 'active' | 'past_due' | 'unpaid',
  grace: Readonly<{ invoiceId: string; startedAt: string; endsAt: string }> | null = null
): void {
  fixture.sqlite
    .prepare(
      `insert into billing_customers (
        id, organization_id, stripe_customer_id, created_at, updated_at
      ) values ('billing_customer_safety', ?, 'cus_safety', ?, ?)`
    )
    .run(owner.workspace.id, now.toISOString(), now.toISOString())
  fixture.sqlite
    .prepare(
      `insert into billing_subscriptions (
        id, organization_id, billing_customer_id, stripe_subscription_id,
        stripe_subscription_item_id, status, plan_key, cadence, stripe_price_id,
        current_period_start, current_period_end, cancel_at_period_end,
        grace_invoice_id, grace_started_at, grace_ends_at, last_verified_at,
        projection_order_ms, projection_event_id, reconciliation_required,
        reconciliation_reason, revision, created_at, updated_at
      ) values (
        'billing_subscription_safety', ?, 'billing_customer_safety', 'sub_safety',
        'si_safety', ?, 'family', 'monthly', 'price_family_monthly_safety',
        ?, ?, 0, ?, ?, ?, ?, 1000, 'evt_safety_seed', 0, null, 0, ?, ?
      )`
    )
    .run(
      owner.workspace.id,
      status,
      periodStart,
      periodEnd,
      grace?.invoiceId ?? null,
      grace?.startedAt ?? null,
      grace?.endsAt ?? null,
      now.toISOString(),
      now.toISOString(),
      now.toISOString()
    )
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
  return {
    list,
    retrieve,
    client: { subscriptions: { list, retrieve } } as unknown as StripeBillingClient
  }
}

function config(): AppRuntimeConfig {
  return {
    stripe: {
      personalWeeklyPriceId: 'price_personal_weekly_safety',
      personalMonthlyPriceId: 'price_personal_monthly_safety',
      personalAnnualPriceId: 'price_personal_annual_safety',
      familyMonthlyPriceId: 'price_family_monthly_safety',
      familyAnnualPriceId: 'price_family_annual_safety'
    }
  } as unknown as AppRuntimeConfig
}

function safetyJobs(fixture: WorkspaceInvitationFixture) {
  return fixture.sqlite
    .prepare(
      `select type, status, payload, run_after as runAfter
       from job_queue
       where type = ?
       order by id`
    )
    .all(billingReconciliationSafetyJobType) as Array<Record<string, unknown>>
}

function subscriptionRow(fixture: WorkspaceInvitationFixture): Record<string, unknown> {
  return fixture.sqlite
    .prepare("select * from billing_subscriptions where id = 'billing_subscription_safety'")
    .get() as Record<string, unknown>
}
