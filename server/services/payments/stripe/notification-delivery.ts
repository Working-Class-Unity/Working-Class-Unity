import { createHash } from 'node:crypto'
import type { JobHandler, JobPayload } from '../../jobs/job-queue'
import type { TransactionalEmailMessage, TransactionalEmailSender } from '../../email'
import { TransactionalEmailDeliveryError } from '../../email'
import { z } from 'zod'
import type { BillingStripeConnection } from './public-contract'

export const billingNotificationDeliveryJobType = 'billing.notification-delivery' as const
export const billingNotificationDeliveryMaxAttempts = 12
export const billingNotificationDeliverySafetyBatchSize = 25

const billingNotificationKinds = ['payment_attention', 'deletion_cancellation_pending'] as const

export type BillingStripeNotificationKind = (typeof billingNotificationKinds)[number]

const payloadSchema = z
  .object({
    notificationKey: z.string().regex(/^[a-f0-9]{64}$/),
    kind: z.enum(billingNotificationKinds),
    purchaserUserId: z.string().trim().min(1).max(255),
    authorityReference: z.string().trim().min(1).max(128).nullable()
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.kind === 'deletion_cancellation_pending') !== (value.authorityReference !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'Only deletion-pending notifications have an authority reference'
      })
    }
  })

type BillingNotificationPayload = z.infer<typeof payloadSchema>

export function enqueueBillingStripeNotification(
  connection: BillingStripeConnection,
  input: Readonly<{
    kind: BillingStripeNotificationKind
    purchaserUserId: string
    episodeKey: string
    authorityReference?: string | null
  }>,
  now = new Date()
): boolean {
  if (!input.purchaserUserId || !input.episodeKey || !Number.isFinite(now.getTime())) {
    throw new TypeError('Invalid Billing notification delivery')
  }
  const authorityReference = input.authorityReference ?? null
  const notificationKey = createHash('sha256')
    .update(JSON.stringify([input.kind, input.purchaserUserId, input.episodeKey, authorityReference]))
    .digest('hex')
  return enqueuePayload(
    connection,
    payloadSchema.parse({
      notificationKey,
      kind: input.kind,
      purchaserUserId: input.purchaserUserId,
      authorityReference
    }),
    now
  )
}

export function createBillingNotificationDeliveryHandler(
  context: Readonly<{
    appName: string
    connection: BillingStripeConnection
    sender: TransactionalEmailSender
  }>
): JobHandler {
  return async (payload: JobPayload) => {
    const parsed = payloadSchema.safeParse(payload)
    if (!parsed.success) throw new Error('Invalid Billing notification delivery payload')

    if (
      parsed.data.kind === 'deletion_cancellation_pending' &&
      !context.connection.sqlite
        .prepare(
          `select 1 from billing_account_deletion_requests
           where id = ? and purchaser_user_id = ?
             and state in ('pending', 'reconciliation_required')`
        )
        .get(parsed.data.authorityReference, parsed.data.purchaserUserId)
    ) {
      return
    }

    const recipient = context.connection.sqlite
      .prepare('select email from user where id = ?')
      .get(parsed.data.purchaserUserId) as { email: string } | undefined
    if (!recipient) return

    try {
      await context.sender.send({
        ...createBillingStripeNotificationEmail({
          appName: context.appName,
          kind: parsed.data.kind,
          to: recipient.email
        }),
        idempotencyKey: parsed.data.notificationKey
      })
    } catch {
      throw new TransactionalEmailDeliveryError()
    }
  }
}

export function ensureBillingNotificationDeliveryJobs(
  connection: BillingStripeConnection,
  now = new Date(),
  limit = billingNotificationDeliverySafetyBatchSize
): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > billingNotificationDeliverySafetyBatchSize) {
    throw new TypeError('Invalid Billing notification delivery safety limit')
  }
  return connection.sqlite
    .transaction(() => {
      const rows = connection.sqlite
        .prepare(
          `select source.payload
         from job_queue source
         where source.type = ?
           and (source.status = 'failed' or (source.status = 'queued' and source.attempts >= source.max_attempts))
           and json_valid(source.payload)
           and json_type(source.payload, '$.notificationKey') = 'text'
           and json_type(source.payload, '$.kind') = 'text'
           and json_type(source.payload, '$.purchaserUserId') = 'text'
           and json_type(source.payload, '$.authorityReference') in ('null', 'text')
           and json_remove(source.payload, '$.notificationKey', '$.kind', '$.purchaserUserId', '$.authorityReference') = '{}'
           and not exists (
             select 1 from job_queue active
             where active.type = ?
               and active.status in ('queued', 'running', 'succeeded')
               and (active.status <> 'queued' or active.attempts < active.max_attempts)
               and json_valid(active.payload)
               and json_extract(active.payload, '$.notificationKey') = json_extract(source.payload, '$.notificationKey')
               and json_remove(active.payload, '$.notificationKey', '$.kind', '$.purchaserUserId', '$.authorityReference') = '{}'
           )
         group by json_extract(source.payload, '$.notificationKey')
         having count(distinct source.payload) = 1
         order by min(source.id)
         limit ?`
        )
        .all(billingNotificationDeliveryJobType, billingNotificationDeliveryJobType, limit) as Array<{
        payload: string
      }>
      let scheduled = 0
      for (const row of rows) {
        const parsed = payloadSchema.safeParse(safeJson(row.payload))
        if (parsed.success && enqueuePayload(connection, parsed.data, now)) scheduled += 1
      }
      return scheduled
    })
    .immediate()
}

export function createBillingStripeNotificationEmail(
  input: Readonly<{
    appName: string
    kind: BillingStripeNotificationKind
    to: string
  }>
): TransactionalEmailMessage {
  const to = requireHeaderValue(input.to)
  const appName = input.appName.replaceAll(/[\r\n]+/g, ' ').trim()
  if (!appName) throw new TransactionalEmailDeliveryError()
  const escapedAppName = escapeHtml(appName)
  if (input.kind === 'payment_attention') {
    return {
      to,
      subject: 'Your subscription payment needs attention',
      text: [
        'Your Stripe subscription payment needs attention.',
        '',
        `Sign in to ${appName} and use Manage billing to review it.`,
        '',
        'This message contains no payment or invoice details.'
      ].join('\n'),
      html:
        '<p>Your Stripe subscription payment needs attention.</p>' +
        `<p>Sign in to ${escapedAppName} and use <strong>Manage billing</strong> to review it.</p>` +
        '<p>This message contains no payment or invoice details.</p>'
    }
  }
  return {
    to,
    subject: 'Account deletion is waiting for billing cancellation',
    text: [
      'We could not yet confirm that your Stripe subscription is canceled.',
      '',
      `Your ${appName} account and private data were not deleted. Sign in again to check the status.`,
      '',
      'This message contains no payment or invoice details.'
    ].join('\n'),
    html:
      '<p>We could not yet confirm that your Stripe subscription is canceled.</p>' +
      `<p>Your ${escapedAppName} account and private data were not deleted. Sign in again to check the status.</p>` +
      '<p>This message contains no payment or invoice details.</p>'
  }
}

function enqueuePayload(connection: BillingStripeConnection, payload: BillingNotificationPayload, now: Date): boolean {
  const encoded = JSON.stringify(payload)
  const timestamp = now.toISOString()
  const inserted = connection.sqlite
    .prepare(
      `insert into job_queue (type, payload, max_attempts, run_after, created_at, updated_at)
       select ?, ?, ?, ?, ?, ?
       where not exists (
         select 1 from job_queue
         where type = ? and status in ('queued', 'running', 'succeeded')
           and (status <> 'queued' or attempts < max_attempts)
           and json_valid(payload)
           and json_extract(payload, '$.notificationKey') = ?
           and json_remove(payload, '$.notificationKey', '$.kind', '$.purchaserUserId', '$.authorityReference') = '{}'
       )`
    )
    .run(
      billingNotificationDeliveryJobType,
      encoded,
      billingNotificationDeliveryMaxAttempts,
      timestamp,
      timestamp,
      timestamp,
      billingNotificationDeliveryJobType,
      payload.notificationKey
    )
  return inserted.changes === 1
}

function requireHeaderValue(value: string): string {
  if (!value || value !== value.trim() || /[\r\n]/.test(value)) {
    throw new TransactionalEmailDeliveryError()
  }
  return value
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function safeJson(value: string): JobPayload | undefined {
  try {
    return JSON.parse(value) as JobPayload
  } catch {
    return undefined
  }
}
