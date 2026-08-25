import { TransactionalEmailDeliveryError } from '../../server/services/email'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  billingNotificationDeliveryJobType,
  billingNotificationDeliveryMaxAttempts,
  createBillingStripeNotificationEmail,
  createBillingNotificationDeliveryHandler,
  enqueueBillingStripeNotification,
  ensureBillingNotificationDeliveryJobs
} from '../../server/services/payments/stripe/notification-delivery'
import { createBillingStripeRuntimeFixture, type BillingStripeRuntimeFixture } from './runtime-fixture'

const fixtures: BillingStripeRuntimeFixture[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.sqlite.close()
})

describe('Billing notification delivery boundary', () => {
  it('stores only an opaque purchaser reference and digest, never email or provider identifiers', () => {
    const fixture = runtimeFixture('private')
    const now = new Date('2026-07-28T12:00:00.000Z')

    expect(
      enqueueBillingStripeNotification(
        fixture.connection,
        {
          kind: 'payment_attention',
          purchaserUserId: fixture.purchaserUserId,
          episodeKey: 'cus_private:sub_private:in_private:price_private'
        },
        now
      )
    ).toBe(true)

    const job = notificationJobs(fixture)[0]!
    expect(JSON.parse(job.payload)).toEqual({
      notificationKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      kind: 'payment_attention',
      purchaserUserId: fixture.purchaserUserId,
      authorityReference: null
    })
    expect(job.payload).not.toContain(`${fixture.purchaserUserId}@example.test`)
    expect(job.payload).not.toMatch(/cus_private|sub_private|in_private|price_private/)
  })

  it.each([
    ['failed', 'failed'],
    ['exhausted queued', 'queued']
  ] as const)('regenerates one %s generation and sends through the recovered job', async (label, status) => {
    const fixture = runtimeFixture(label.replace(' ', '_'))
    const now = new Date('2026-07-28T12:00:00.000Z')
    enqueueBillingStripeNotification(
      fixture.connection,
      {
        kind: 'payment_attention',
        purchaserUserId: fixture.purchaserUserId,
        episodeKey: `recovery:${label}:cus_private:sub_private`
      },
      now
    )
    fixture.sqlite
      .prepare('update job_queue set status = ?, attempts = max_attempts where type = ?')
      .run(status, billingNotificationDeliveryJobType)

    expect(ensureBillingNotificationDeliveryJobs(fixture.connection, now)).toBe(1)
    expect(ensureBillingNotificationDeliveryJobs(fixture.connection, now)).toBe(0)
    const jobs = notificationJobs(fixture)
    expect(jobs).toHaveLength(2)
    expect(jobs[0]).toMatchObject({
      attempts: billingNotificationDeliveryMaxAttempts,
      payload: jobs[1]!.payload
    })
    const send = vi.fn(async () => undefined)
    const handler = createBillingNotificationDeliveryHandler({
      appName: 'Billing Test',
      connection: fixture.connection,
      sender: { send }
    })

    await handler(JSON.parse(jobs[1]!.payload))
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: JSON.parse(jobs[1]!.payload).notificationKey,
        subject: 'Your subscription payment needs attention',
        to: `${fixture.purchaserUserId}@example.test`
      })
    )
  })

  it.each(['queued', 'running', 'succeeded'] as const)('does not duplicate a covered %s generation', (status) => {
    const fixture = runtimeFixture(`covered_${status}`)
    const now = new Date('2026-07-28T12:00:00.000Z')
    const input = {
      kind: 'payment_attention' as const,
      purchaserUserId: fixture.purchaserUserId,
      episodeKey: `covered:${status}`
    }
    expect(enqueueBillingStripeNotification(fixture.connection, input, now)).toBe(true)
    fixture.sqlite
      .prepare(
        `update job_queue set status = ?,
           attempts = case when ? = 'queued' then 0 else 1 end
         where type = ?`
      )
      .run(status, status, billingNotificationDeliveryJobType)

    expect(ensureBillingNotificationDeliveryJobs(fixture.connection, now)).toBe(0)
    expect(enqueueBillingStripeNotification(fixture.connection, input, now)).toBe(false)
    expect(notificationJobs(fixture)).toHaveLength(1)
  })

  it('skips a stale deletion notification after its exact authority has closed', async () => {
    const fixture = runtimeFixture('stale_authority')
    expect(
      enqueueBillingStripeNotification(fixture.connection, {
        kind: 'deletion_cancellation_pending',
        purchaserUserId: fixture.purchaserUserId,
        episodeKey: 'request_stale',
        authorityReference: 'request_stale'
      })
    ).toBe(true)
    const send = vi.fn(async () => undefined)
    const handler = createBillingNotificationDeliveryHandler({
      appName: 'Billing Test',
      connection: fixture.connection,
      sender: { send }
    })

    await handler(JSON.parse(notificationJobs(fixture)[0]!.payload))
    expect(send).not.toHaveBeenCalled()
  })

  it('renders every approved package notification without private billing details', () => {
    for (const kind of ['payment_attention', 'deletion_cancellation_pending'] as const) {
      const message = createBillingStripeNotificationEmail({
        to: 'recipient@example.test',
        appName: 'Billing Test',
        kind
      })
      expect(message).toMatchObject({ to: 'recipient@example.test' })
      expect(message.subject).toBeTruthy()
      expect(message.text).toContain('Billing Test')
      expect(message.html).toContain('Billing Test')
      expect(`${message.subject}\n${message.text}\n${message.html}`).not.toMatch(
        /cus_private|sub_private|si_private|price_private|in_private|pm_private|https:\/\/|card ending|amount due/
      )
    }
  })

  it('escapes display text and rejects recipient header injection', () => {
    const message = createBillingStripeNotificationEmail({
      to: 'recipient@example.test',
      appName: 'Billing <Test>',
      kind: 'payment_attention'
    })
    expect(message.text).toContain('Billing <Test>')
    expect(message.html).toContain('Billing &lt;Test&gt;')
    expect(message.html).not.toContain('Billing <Test>')
    expect(() =>
      createBillingStripeNotificationEmail({
        to: 'recipient@example.test\nBcc: hidden@example.test',
        appName: 'Billing Test',
        kind: 'payment_attention'
      })
    ).toThrow(TransactionalEmailDeliveryError)
  })

  it('redacts sender failures as TransactionalEmailDeliveryError', async () => {
    const fixture = runtimeFixture('sender_failure')
    expect(
      enqueueBillingStripeNotification(fixture.connection, {
        kind: 'payment_attention',
        purchaserUserId: fixture.purchaserUserId,
        episodeKey: 'private-provider-episode'
      })
    ).toBe(true)
    const row = fixture.sqlite
      .prepare(`select payload from job_queue where type = 'billing.notification-delivery'`)
      .get() as { payload: string }
    const handler = createBillingNotificationDeliveryHandler({
      appName: 'Billing Test',
      connection: fixture.connection,
      sender: {
        send: vi.fn(async () => {
          throw new Error('private transport credentials')
        })
      }
    })

    const delivery = handler(JSON.parse(row.payload))
    await expect(delivery).rejects.toBeInstanceOf(TransactionalEmailDeliveryError)
    await expect(delivery).rejects.not.toThrow('private transport credentials')
  })
})

function runtimeFixture(suffix: string): BillingStripeRuntimeFixture {
  const fixture = createBillingStripeRuntimeFixture(`purchaser_notification_${suffix}`)
  fixtures.push(fixture)
  return fixture
}

function notificationJobs(fixture: BillingStripeRuntimeFixture) {
  return fixture.sqlite
    .prepare(`select status, attempts, payload from job_queue where type = ? order by id`)
    .all(billingNotificationDeliveryJobType) as Array<{
    attempts: number
    payload: string
    status: string
  }>
}
