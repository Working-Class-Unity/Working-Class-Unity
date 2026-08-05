import type Stripe from 'stripe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BillingStripeRuntimeConfiguration } from '../../server/services/payments/stripe/configuration'
import { createBillingWebhookReconciliationHandler } from '../../server/services/payments/stripe/webhook-reconciliation'
import {
  billingWebhookReconciliationJobType,
  billingWebhookReconciliationMaxAttempts,
  ensureBillingWebhookReconciliationJobs
} from '../../server/services/payments/stripe/webhook-reference'
import { processStripeWebhookEvent, processStripeWebhookReference } from '../../server/services/payments/stripe/webhook'
import { createBillingStripeRuntimeFixture, type BillingStripeRuntimeFixture } from './runtime-fixture'

const fixtures: BillingStripeRuntimeFixture[] = []
const reference = {
  eventId: 'evt_webhook_retry',
  eventType: 'customer.subscription.updated' as const,
  eventCreatedAt: 1_785_000_000,
  objectId: 'sub_webhook_retry'
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.sqlite.close()
})

describe('Stripe webhook durable retry protocol', () => {
  it('returns 502 and deduplicates an opaque durable retry when the required current read fails', async () => {
    const fixture = runtimeFixture('read_failure')
    const retrieve = vi.fn(async () => {
      throw new Error('private provider read detail')
    })
    const client = { subscriptions: { retrieve } } as never

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        processStripeWebhookReference(fixture.connection, client, configuration, undefined, reference)
      ).rejects.toMatchObject({
        statusCode: 502,
        statusMessage: 'Stripe billing state is temporarily unavailable'
      })
    }

    expect(retrieve).toHaveBeenCalledTimes(2)
    const jobs = webhookJobs(fixture)
    expect(jobs).toEqual([
      expect.objectContaining({
        type: billingWebhookReconciliationJobType,
        payload: JSON.stringify(reference),
        maxAttempts: billingWebhookReconciliationMaxAttempts
      })
    ])
    expect(jobs[0]!.payload).not.toMatch(/private|rk_test|whsec/)
    expect(fixture.sqlite.prepare('select count(*) as count from billing_events').get()).toEqual({ count: 0 })
  })

  it('repairs one exhausted generation only while its minimized receipt is unresolved', () => {
    const fixture = runtimeFixture('generation')
    fixture.sqlite
      .prepare(
        `insert into job_queue (type, payload, status, attempts, max_attempts)
       values (?, ?, 'queued', ?, ?)`
      )
      .run(
        billingWebhookReconciliationJobType,
        JSON.stringify(reference),
        billingWebhookReconciliationMaxAttempts,
        billingWebhookReconciliationMaxAttempts
      )

    expect(ensureBillingWebhookReconciliationJobs(fixture.connection)).toBe(1)
    expect(ensureBillingWebhookReconciliationJobs(fixture.connection)).toBe(0)
    expect(webhookJobs(fixture)).toHaveLength(2)

    fixture.sqlite
      .prepare(
        `update job_queue set attempts = max_attempts
       where type = ? and attempts = 0`
      )
      .run(billingWebhookReconciliationJobType)
    fixture.sqlite
      .prepare(
        `insert into billing_events (stripe_event_id, event_type, provider_created_at, processed_at)
       values (?, ?, ?, ?)`
      )
      .run(reference.eventId, reference.eventType, reference.eventCreatedAt, new Date().toISOString())
    expect(ensureBillingWebhookReconciliationJobs(fixture.connection)).toBe(0)
    expect(webhookJobs(fixture)).toHaveLength(2)
  })

  it('acknowledges an unsupported event repeatedly without provider work or a durable receipt', async () => {
    const fixture = runtimeFixture('unsupported')
    const retrieve = vi.fn()
    const event = {
      id: 'evt_unsupported',
      type: 'customer.created',
      created: 1_785_000_000,
      data: { object: { id: 'cus_unsupported' } }
    } as Stripe.Event

    await expect(
      processStripeWebhookEvent(
        fixture.connection,
        { subscriptions: { retrieve } } as never,
        configuration,
        undefined,
        event
      )
    ).resolves.toEqual({ duplicate: false, target: 'ignored' })
    await expect(
      processStripeWebhookEvent(
        fixture.connection,
        { subscriptions: { retrieve } } as never,
        configuration,
        undefined,
        event
      )
    ).resolves.toEqual({ duplicate: false, target: 'ignored' })
    expect(retrieve).not.toHaveBeenCalled()
    expect(webhookJobs(fixture)).toEqual([])
    expect(fixture.sqlite.prepare('select count(*) as count from billing_events').get()).toEqual({ count: 0 })
  })

  it('short-circuits a receipt before provider work and rejects non-exact worker payloads', async () => {
    const fixture = runtimeFixture('receipt')
    fixture.sqlite
      .prepare(
        `insert into billing_events (stripe_event_id, event_type, provider_created_at, processed_at)
       values (?, ?, ?, ?)`
      )
      .run(reference.eventId, reference.eventType, reference.eventCreatedAt, new Date().toISOString())
    const retrieve = vi.fn()
    const client = { subscriptions: { retrieve } } as never

    await expect(
      processStripeWebhookReference(fixture.connection, client, configuration, undefined, reference)
    ).resolves.toEqual({ duplicate: true, target: 'ignored' })
    const handler = createBillingWebhookReconciliationHandler({
      connection: fixture.connection,
      client,
      config: configuration
    })
    await expect(handler({ ...reference, extra: true })).rejects.toThrow(
      'Invalid billing webhook reconciliation payload'
    )
    expect(retrieve).not.toHaveBeenCalled()
  })
})

function runtimeFixture(suffix: string): BillingStripeRuntimeFixture {
  const fixture = createBillingStripeRuntimeFixture(`purchaser_webhook_retry_${suffix}`)
  fixtures.push(fixture)
  return fixture
}

function webhookJobs(fixture: BillingStripeRuntimeFixture) {
  return fixture.sqlite
    .prepare(
      `select type, payload, status, attempts, max_attempts as maxAttempts
     from job_queue where type = ? order by id`
    )
    .all(billingWebhookReconciliationJobType) as Array<{
    type: string
    payload: string
    status: string
    attempts: number
    maxAttempts: number
  }>
}

const configuration = {
  enabled: true,
  appName: 'Webhook Retry',
  appUrl: 'https://app.example.test',
  stripe: {
    secretKey: 'rk_test_webhook_retry',
    webhookSecret: 'whsec_webhook_retry',
    portalConfigurationId: 'bpc_webhook_retry',
    prices: {
      'personal.weekly': 'price_personal_weekly_webhook_retry',
      'personal.monthly': 'price_personal_monthly_webhook_retry',
      'personal.annual': 'price_personal_annual_webhook_retry',
      'family.monthly': 'price_family_monthly_webhook_retry',
      'family.annual': 'price_family_annual_webhook_retry'
    }
  }
} as const satisfies BillingStripeRuntimeConfiguration
