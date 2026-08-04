import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { DatabaseConnection } from '../../db/connect'
import type { JsonValue } from '../../db/schema'
import { createBillingNotificationEmail, type TransactionalEmailSender } from '../email'
import type { JobHandler } from '../jobs/job-queue'
import type { CaptureDiagnosticCode } from '../observability/capture'
import { captureException } from '../observability/capture'

export const billingNotificationDeliveryJobType = 'billing.notification-delivery' as const
export const billingNotificationDeliveryMaxAttempts = 12
export const billingNotificationDeliverySafetyBatchSize = 25

const billingNotificationKinds = [
  'payment_attention',
  'family_access_at_risk',
  'family_access_ending',
  'member_removed',
  'family_dissolved',
  'deletion_cancellation_pending'
] as const

type BillingNotificationKind = (typeof billingNotificationKinds)[number]

const payloadSchema = z
  .object({
    notificationKey: z.string().regex(/^[a-f0-9]{64}$/),
    kind: z.enum(billingNotificationKinds),
    recipientUserId: z.string().trim().min(1).max(255),
    effectiveAt: z.string().datetime({ offset: true }).nullable(),
    authorityReference: z.string().trim().min(1).max(255).nullable()
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.kind === 'family_access_ending') !== (value.effectiveAt !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'Only Family access-ending notifications have an effective date'
      })
    }
    if ((value.kind === 'deletion_cancellation_pending') !== (value.authorityReference !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'Only deletion-pending notifications have an authority reference'
      })
    }
  })

type BillingNotificationPayload = z.infer<typeof payloadSchema>

export function enqueueBillingNotificationDelivery(
  connection: DatabaseConnection,
  input: Readonly<{
    kind: BillingNotificationKind
    recipientUserId: string
    episodeKey: string
    effectiveAt?: string | null
    authorityReference?: string | null
  }>,
  now = new Date()
): boolean {
  if (!input.recipientUserId || !input.episodeKey) {
    throw new TypeError('Invalid billing notification delivery')
  }
  const effectiveAt = input.effectiveAt ?? null
  const authorityReference = input.authorityReference ?? null
  const notificationKey = createHash('sha256')
    .update(JSON.stringify([input.kind, input.recipientUserId, input.episodeKey, effectiveAt, authorityReference]))
    .digest('hex')
  return enqueuePayload(
    connection,
    payloadSchema.parse({
      notificationKey,
      kind: input.kind,
      recipientUserId: input.recipientUserId,
      effectiveAt,
      authorityReference
    }),
    now
  )
}

export function createBillingNotificationDeliveryHandler(context: {
  appName: string
  capture?: (error: unknown, code: CaptureDiagnosticCode) => Promise<void>
  connection: DatabaseConnection
  sender: TransactionalEmailSender
}): JobHandler {
  return async (payload: JsonValue) => {
    const parsed = payloadSchema.safeParse(payload)
    if (!parsed.success) throw new Error('Invalid billing notification delivery payload')

    if (
      parsed.data.kind === 'deletion_cancellation_pending' &&
      !context.connection.sqlite
        .prepare(
          `select 1
           from billing_account_deletion_requests
           where id = ?
             and user_id = ?
             and state in ('pending', 'reconciliation_required')`
        )
        .get(parsed.data.authorityReference, parsed.data.recipientUserId)
    ) {
      return
    }

    const recipient = context.connection.sqlite
      .prepare('select email from user where id = ?')
      .get(parsed.data.recipientUserId) as { email: string } | undefined
    if (!recipient) return

    const message =
      parsed.data.kind === 'family_access_ending'
        ? createBillingNotificationEmail({
            appName: context.appName,
            effectiveAt: parsed.data.effectiveAt!,
            kind: parsed.data.kind,
            to: recipient.email
          })
        : createBillingNotificationEmail({
            appName: context.appName,
            kind: parsed.data.kind,
            to: recipient.email
          })
    try {
      await context.sender.send(message)
    } catch {
      try {
        await (context.capture ?? captureException)(
          new Error('Billing notification delivery failed'),
          'family-lifecycle-notification-failed'
        )
      } catch {
        // Delivery remains retryable even when observability is unavailable.
      }
      throw new Error('Billing notification delivery failed')
    }
  }
}

export function ensureBillingNotificationDeliveryJobs(
  connection: DatabaseConnection,
  now = new Date(),
  limit = billingNotificationDeliverySafetyBatchSize
): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > billingNotificationDeliverySafetyBatchSize) {
    throw new TypeError('Invalid billing notification delivery safety limit')
  }

  return connection.sqlite
    .transaction(() => {
      const rows = connection.sqlite
        .prepare(
          `select source.payload
           from job_queue source
           where source.type = ?
             and (
               source.status = 'failed'
               or (source.status = 'queued' and source.attempts >= source.max_attempts)
             )
             and json_valid(source.payload)
             and json_type(source.payload, '$.notificationKey') = 'text'
             and json_type(source.payload, '$.kind') = 'text'
             and json_type(source.payload, '$.recipientUserId') = 'text'
             and json_type(source.payload, '$.effectiveAt') in ('null', 'text')
             and json_type(source.payload, '$.authorityReference') in ('null', 'text')
             and json_remove(
               source.payload,
               '$.notificationKey',
               '$.kind',
               '$.recipientUserId',
               '$.effectiveAt',
               '$.authorityReference'
             ) = '{}'
             and not exists (
               select 1
               from job_queue active
               where active.type = ?
                 and active.status in ('queued', 'running', 'succeeded')
                 and (
                   active.status <> 'queued'
                   or active.attempts < active.max_attempts
                 )
                 and json_valid(active.payload)
                 and json_extract(active.payload, '$.notificationKey') =
                   json_extract(source.payload, '$.notificationKey')
                 and json_remove(
                   active.payload,
                   '$.notificationKey',
                   '$.kind',
                   '$.recipientUserId',
                   '$.effectiveAt',
                   '$.authorityReference'
                 ) = '{}'
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
        if (!parsed.success) continue
        if (enqueuePayload(connection, parsed.data, now)) scheduled += 1
      }
      return scheduled
    })
    .immediate()
}

function enqueuePayload(connection: DatabaseConnection, payload: BillingNotificationPayload, now: Date): boolean {
  const encoded = JSON.stringify(payload)
  const inserted = connection.sqlite
    .prepare(
      `insert into job_queue (type, payload, max_attempts, run_after, created_at, updated_at)
       select ?, ?, ?, ?, ?, ?
       where not exists (
         select 1
         from job_queue
         where type = ?
           and status in ('queued', 'running', 'succeeded')
           and (
             status <> 'queued'
             or attempts < max_attempts
           )
           and json_valid(payload)
           and json_extract(payload, '$.notificationKey') = ?
           and json_remove(
             payload,
             '$.notificationKey',
             '$.kind',
             '$.recipientUserId',
             '$.effectiveAt',
             '$.authorityReference'
           ) = '{}'
       )`
    )
    .run(
      billingNotificationDeliveryJobType,
      encoded,
      billingNotificationDeliveryMaxAttempts,
      now.toISOString(),
      now.toISOString(),
      now.toISOString(),
      billingNotificationDeliveryJobType,
      payload.notificationKey
    )
  return inserted.changes === 1
}

function safeJson(value: string): JsonValue | undefined {
  try {
    return JSON.parse(value) as JsonValue
  } catch {
    return undefined
  }
}
