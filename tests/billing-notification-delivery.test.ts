import { afterEach, describe, expect, it } from 'vitest'
import type { TransactionalEmailMessage } from '../server/services/email'
import {
  billingNotificationDeliveryJobType,
  billingNotificationDeliveryMaxAttempts,
  createBillingNotificationDeliveryHandler,
  enqueueBillingNotificationDelivery,
  ensureBillingNotificationDeliveryJobs
} from '../server/services/payments/billing-notification-delivery'
import {
  createWorkspaceInvitationFixture,
  type WorkspaceInvitationFixture
} from './helpers/workspace-invitation-fixture'

let fixture: WorkspaceInvitationFixture | undefined

afterEach(() => {
  fixture?.cleanup()
  fixture = undefined
})

describe('durable billing notification delivery', () => {
  it('stores only an opaque recipient reference and digest, never email or provider identifiers', async () => {
    fixture = createWorkspaceInvitationFixture()
    const recipient = await fixture.signIn('notification-private@example.test', 'Notification Private')
    const now = new Date('2026-07-28T12:00:00.000Z')

    expect(
      enqueueBillingNotificationDelivery(
        fixture.connection,
        {
          episodeKey: 'cus_private:sub_private:in_private:price_private',
          kind: 'family_dissolved',
          recipientUserId: recipient.user.id
        },
        now
      )
    ).toBe(true)

    const job = notificationJobs(fixture)[0]!
    const payload = JSON.parse(job.payload) as Record<string, unknown>
    expect(payload).toEqual({
      notificationKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      kind: 'family_dissolved',
      recipientUserId: recipient.user.id,
      effectiveAt: null,
      authorityReference: null
    })
    expect(job.payload).not.toContain(recipient.user.email)
    expect(job.payload).not.toMatch(/cus_private|sub_private|in_private|price_private/)
  })

  it.each([
    ['failed', 'failed'],
    ['exhausted queued', 'queued']
  ] as const)('regenerates one %s generation and sends through the recovered job', async (_label, status) => {
    fixture = createWorkspaceInvitationFixture()
    const recipient = await fixture.signIn(
      `notification-${_label.replace(' ', '-')}@example.test`,
      'Notification Recovery'
    )
    const now = new Date('2026-07-28T12:00:00.000Z')
    enqueueBillingNotificationDelivery(
      fixture.connection,
      {
        episodeKey: `recovery:${_label}:cus_private:sub_private`,
        kind: 'payment_attention',
        recipientUserId: recipient.user.id
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
    expect(jobs[1]).toMatchObject({ attempts: 0, status: 'queued' })

    const messages: TransactionalEmailMessage[] = []
    const handler = createBillingNotificationDeliveryHandler({
      appName: fixture.config.public.appName,
      connection: fixture.connection,
      sender: {
        async send(message) {
          messages.push(message)
        }
      }
    })
    await handler(JSON.parse(jobs[1]!.payload))

    expect(messages).toEqual([
      expect.objectContaining({
        subject: 'Your subscription payment needs attention',
        to: recipient.user.email
      })
    ])
  })

  it.each(['queued', 'running', 'succeeded'] as const)('does not duplicate a covered %s generation', async (status) => {
    fixture = createWorkspaceInvitationFixture()
    const recipient = await fixture.signIn(`notification-${status}@example.test`, `Notification ${status}`)
    const now = new Date('2026-07-28T12:00:00.000Z')
    enqueueBillingNotificationDelivery(
      fixture.connection,
      {
        episodeKey: `covered:${status}`,
        kind: 'member_removed',
        recipientUserId: recipient.user.id
      },
      now
    )
    fixture.sqlite
      .prepare(
        `update job_queue
           set status = ?, attempts = case when ? = 'queued' then 0 else 1 end,
               locked_at = case when ? = 'running' then ? else null end,
               locked_by = case when ? = 'running' then 'notification-test-worker' else null end
           where type = ?`
      )
      .run(status, status, status, now.toISOString(), status, billingNotificationDeliveryJobType)

    expect(ensureBillingNotificationDeliveryJobs(fixture.connection, now)).toBe(0)
    expect(
      enqueueBillingNotificationDelivery(
        fixture.connection,
        {
          episodeKey: `covered:${status}`,
          kind: 'member_removed',
          recipientUserId: recipient.user.id
        },
        now
      )
    ).toBe(false)
    expect(notificationJobs(fixture)).toHaveLength(1)
  })
})

function notificationJobs(activeFixture: WorkspaceInvitationFixture) {
  return activeFixture.sqlite
    .prepare(
      `select status, attempts, payload
       from job_queue
       where type = ?
       order by id`
    )
    .all(billingNotificationDeliveryJobType) as Array<{
    attempts: number
    payload: string
    status: string
  }>
}
