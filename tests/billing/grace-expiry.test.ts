import type Stripe from 'stripe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  billingGraceExpiryJobType,
  billingGraceExpiryMaxAttempts,
  createBillingGraceExpiryHandler,
  ensureBillingGraceExpiryJobs
} from '../../server/services/payments/stripe/grace-expiry'
import { readAccountMembershipState } from '../../server/services/membership/member-access'
import {
  createBillingStripeRuntimeFixture,
  seedBillingCustomer,
  seedBillingSubscription,
  type BillingStripeRuntimeFixture
} from './runtime-fixture'

const fixtures: BillingStripeRuntimeFixture[] = []
const graceStartedAt = '2026-07-15T12:00:00.000Z'
const graceEndsAt = '2026-09-13T12:00:00.000Z'
const beforeDeadline = new Date('2026-09-13T11:59:59.999Z')
const deadline = new Date(graceEndsAt)
const prices = {
  'personal.weekly': '',
  'personal.monthly': 'price_personal_monthly',
  'personal.annual': '',
  'family.monthly': 'price_family_monthly',
  'family.annual': ''
} as const

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.sqlite.close()
})

describe('Billing Stripe grace expiry', () => {
  it('schedules one exact job at the persisted 60-day deadline', () => {
    const fixture = graceFixture('schedule')

    expect(ensureBillingGraceExpiryJobs(fixture.connection, beforeDeadline)).toBe(1)
    expect(ensureBillingGraceExpiryJobs(fixture.connection, beforeDeadline)).toBe(0)
    expect(
      fixture.sqlite
        .prepare(
          `select type, payload, max_attempts as maxAttempts, run_after as runAfter
           from job_queue where type = ?`
        )
        .get(billingGraceExpiryJobType)
    ).toEqual({
      type: billingGraceExpiryJobType,
      payload: JSON.stringify({
        billingSubscriptionId: `billing_subscription_${fixture.purchaserUserId}`,
        stripeSubscriptionId: 'sub_grace',
        graceInvoiceId: 'in_grace',
        graceStartedAt,
        graceEndsAt
      }),
      maxAttempts: billingGraceExpiryMaxAttempts,
      runAfter: graceEndsAt
    })
    fixture.sqlite.prepare('update job_queue set attempts = max_attempts where type = ?').run(billingGraceExpiryJobType)
    expect(ensureBillingGraceExpiryJobs(fixture.connection, beforeDeadline)).toBe(1)
  })

  it('cancels the same still-unpaid subscription, commits terminal state, and permits immediate rejoin', async () => {
    const fixture = graceFixture('cancel')
    const retrieve = vi
      .fn()
      .mockResolvedValueOnce(providerSubscription('past_due'))
      .mockResolvedValueOnce(providerSubscription('canceled'))
    const cancel = vi.fn(async () => {
      throw new Error('lost Stripe cancellation response')
    })
    const handler = handlerFor(fixture, { retrieve, cancel }, () => deadline)

    await handler(payloadFor(fixture))
    await handler(payloadFor(fixture))

    expect(cancel).toHaveBeenCalledExactlyOnceWith(
      'sub_grace',
      { invoice_now: false, prorate: false },
      { idempotencyKey: expect.stringMatching(/^billing-grace-expiry:[a-f0-9]{64}$/) }
    )
    expect(retrieve).toHaveBeenCalledTimes(2)
    expect(
      fixture.sqlite
        .prepare(
          `select status, grace_invoice_id as graceInvoiceId,
                  grace_started_at as graceStartedAt, grace_ends_at as graceEndsAt
           from billing_subscriptions where purchaser_user_id = ?`
        )
        .get(fixture.purchaserUserId)
    ).toEqual({ status: 'canceled', graceInvoiceId: null, graceStartedAt: null, graceEndsAt: null })
    expect(readAccountMembershipState(fixture.connection, fixture.purchaserUserId, prices, deadline)).toMatchObject({
      level: 'supporter',
      access: { granted: false, state: 'terminal' },
      billing: { capabilities: { canCheckout: true } }
    })
  })

  it('converges a recovered subscription without canceling it', async () => {
    const fixture = graceFixture('recovered')
    const cancel = vi.fn()
    const handler = handlerFor(
      fixture,
      { retrieve: vi.fn(async () => providerSubscription('active')), cancel },
      () => deadline
    )

    await handler(payloadFor(fixture))

    expect(cancel).not.toHaveBeenCalled()
    expect(readAccountMembershipState(fixture.connection, fixture.purchaserUserId, prices, deadline)).toMatchObject({
      level: 'member',
      access: { granted: true, state: 'active' }
    })
    expect(
      fixture.sqlite
        .prepare('select grace_invoice_id as graceInvoiceId from billing_subscriptions where purchaser_user_id = ?')
        .get(fixture.purchaserUserId)
    ).toEqual({ graceInvoiceId: null })
  })

  it('does no provider work before the deadline or after the grace generation changes', async () => {
    const fixture = graceFixture('stale')
    const retrieve = vi.fn(async () => providerSubscription('past_due'))
    const cancel = vi.fn()

    await handlerFor(fixture, { retrieve, cancel }, () => beforeDeadline)(payloadFor(fixture))
    fixture.sqlite
      .prepare(
        `update billing_subscriptions
         set grace_invoice_id = 'in_new', grace_started_at = '2026-08-01T12:00:00.000Z',
             grace_ends_at = '2026-09-30T12:00:00.000Z', revision = revision + 1
         where purchaser_user_id = ?`
      )
      .run(fixture.purchaserUserId)
    await handlerFor(fixture, { retrieve, cancel }, () => deadline)(payloadFor(fixture))

    expect(retrieve).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
  })

  it('fails closed when Stripe returns a different customer or subscription shape', async () => {
    const fixture = graceFixture('mismatch')
    const cancel = vi.fn()
    const handler = handlerFor(
      fixture,
      {
        retrieve: vi.fn(async () => ({ ...providerSubscription('past_due'), customer: 'cus_other' })),
        cancel
      },
      () => deadline
    )

    await expect(handler(payloadFor(fixture))).rejects.toThrow('Billing grace expiry is not confirmed')
    expect(cancel).not.toHaveBeenCalled()
    expect(
      fixture.sqlite
        .prepare('select status from billing_subscriptions where purchaser_user_id = ?')
        .get(fixture.purchaserUserId)
    ).toEqual({ status: 'past_due' })
  })
})

function graceFixture(suffix: string): BillingStripeRuntimeFixture {
  const fixture = createBillingStripeRuntimeFixture(`purchaser_grace_${suffix}`)
  fixtures.push(fixture)
  const personId = `person_${fixture.purchaserUserId}`
  fixture.sqlite.prepare('insert into people (id) values (?)').run(personId)
  fixture.sqlite
    .prepare('insert into person_accounts (person_id, user_id) values (?, ?)')
    .run(personId, fixture.purchaserUserId)
  seedBillingCustomer(fixture)
  seedBillingSubscription(fixture, {
    stripeSubscriptionId: 'sub_grace',
    stripeSubscriptionItemId: 'si_grace',
    status: 'past_due',
    planKey: 'family',
    cadence: 'monthly',
    stripePriceId: prices['family.monthly'],
    graceInvoiceId: 'in_grace',
    graceStartedAt,
    graceEndsAt
  })
  return fixture
}

function payloadFor(fixture: BillingStripeRuntimeFixture) {
  return {
    billingSubscriptionId: `billing_subscription_${fixture.purchaserUserId}`,
    stripeSubscriptionId: 'sub_grace',
    graceInvoiceId: 'in_grace',
    graceStartedAt,
    graceEndsAt
  }
}

function handlerFor(
  fixture: BillingStripeRuntimeFixture,
  subscriptions: Readonly<{ retrieve: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }>,
  now: () => Date
) {
  return createBillingGraceExpiryHandler({
    connection: fixture.connection,
    client: { subscriptions } as never,
    prices,
    now
  })
}

function providerSubscription(status: 'active' | 'past_due' | 'canceled'): Stripe.Subscription {
  return {
    id: 'sub_grace',
    object: 'subscription',
    customer: 'cus_test',
    status,
    cancel_at_period_end: false,
    pending_update: null,
    schedule: null,
    items: {
      object: 'list',
      data: [
        {
          id: 'si_grace',
          object: 'subscription_item',
          price: { id: prices['family.monthly'] },
          quantity: 1,
          current_period_start: Date.parse('2026-07-01T00:00:00.000Z') / 1_000,
          current_period_end: Date.parse('2026-08-01T00:00:00.000Z') / 1_000
        }
      ],
      has_more: false,
      url: '/v1/subscription_items'
    }
  } as Stripe.Subscription
}
