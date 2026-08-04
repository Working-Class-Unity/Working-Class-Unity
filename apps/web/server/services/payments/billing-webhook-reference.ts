import type Stripe from 'stripe'
import type { DatabaseConnection } from '../../db/connect'
import type { JsonValue } from '../../db/schema'

export const stripeWebhookEventTypes = Object.freeze([
  'checkout.session.completed',
  'checkout.session.expired',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.pending_update_applied',
  'customer.subscription.pending_update_expired',
  'subscription_schedule.created',
  'subscription_schedule.updated',
  'subscription_schedule.completed',
  'subscription_schedule.canceled',
  'subscription_schedule.released',
  'subscription_schedule.aborted',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_action_required',
  'refund.created',
  'charge.dispute.created',
  'charge.dispute.closed'
] as const satisfies readonly Stripe.Event.Type[])

export type StripeWebhookEventType = (typeof stripeWebhookEventTypes)[number]

export type StripeWebhookEventReference = Readonly<{
  eventId: string
  eventType: StripeWebhookEventType
  eventCreatedAt: number
  objectId: string
}>

export const billingWebhookReconciliationJobType = 'billing.webhook-reconciliation' as const
export const billingWebhookReconciliationMaxAttempts = 12
export const billingWebhookReconciliationDelayMs = 60_000
export const billingWebhookReconciliationSafetyBatchSize = 25

const supportedEventTypes = new Set<string>(stripeWebhookEventTypes)

export function isStripeWebhookEventType(value: string): value is StripeWebhookEventType {
  return supportedEventTypes.has(value)
}

export function enqueueBillingWebhookReconciliation(
  connection: DatabaseConnection,
  reference: StripeWebhookEventReference,
  now = new Date()
): void {
  const payload = JSON.stringify(reference)
  connection.sqlite
    .prepare(
      `
      insert into job_queue (type, payload, max_attempts, run_after, created_at, updated_at)
      select ?, ?, ?, ?, ?, ?
      where not exists (
        select 1
        from job_queue
        where type = ?
          and (
            status = 'running'
            or (status = 'queued' and attempts < max_attempts)
          )
          and json_valid(payload)
          and json_extract(payload, '$.eventId') = ?
          and json_remove(
            payload,
            '$.eventId',
            '$.eventType',
            '$.eventCreatedAt',
            '$.objectId'
          ) = '{}'
      )
    `
    )
    .run(
      billingWebhookReconciliationJobType,
      payload,
      billingWebhookReconciliationMaxAttempts,
      new Date(now.getTime() + billingWebhookReconciliationDelayMs).toISOString(),
      now.toISOString(),
      now.toISOString(),
      billingWebhookReconciliationJobType,
      reference.eventId
    )
}

/**
 * Creates a fresh bounded retry generation for valid webhook references whose
 * prior job exhausted without committing a minimized receipt.
 */
export function ensureBillingWebhookReconciliationJobs(
  connection: DatabaseConnection,
  now = new Date(),
  limit = billingWebhookReconciliationSafetyBatchSize
): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > billingWebhookReconciliationSafetyBatchSize) {
    throw new TypeError('Invalid billing webhook reconciliation safety limit')
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
             and json_type(source.payload, '$.eventId') = 'text'
             and json_type(source.payload, '$.eventType') = 'text'
             and json_type(source.payload, '$.eventCreatedAt') = 'integer'
             and json_type(source.payload, '$.objectId') = 'text'
             and json_remove(
               source.payload,
               '$.eventId',
               '$.eventType',
               '$.eventCreatedAt',
               '$.objectId'
             ) = '{}'
             and not exists (
               select 1
               from billing_events receipt
               where receipt.stripe_event_id = json_extract(source.payload, '$.eventId')
             )
             and not exists (
               select 1
               from job_queue active
               where active.type = ?
                 and (
                   active.status = 'running'
                   or (active.status = 'queued' and active.attempts < active.max_attempts)
                 )
                 and json_valid(active.payload)
                 and json_extract(active.payload, '$.eventId') = json_extract(source.payload, '$.eventId')
                 and json_remove(
                   active.payload,
                   '$.eventId',
                   '$.eventType',
                   '$.eventCreatedAt',
                   '$.objectId'
                 ) = '{}'
             )
           group by json_extract(source.payload, '$.eventId')
           having count(distinct source.payload) = 1
           order by min(source.id)
           limit ?`
        )
        .all(billingWebhookReconciliationJobType, billingWebhookReconciliationJobType, limit) as Array<{
        payload: string
      }>

      let scheduled = 0
      for (const row of rows) {
        let reference: StripeWebhookEventReference
        try {
          reference = parseStripeWebhookEventReference(JSON.parse(row.payload) as JsonValue)
        } catch {
          continue
        }
        enqueueBillingWebhookReconciliation(connection, reference, now)
        scheduled += 1
      }
      return scheduled
    })
    .immediate()
}

export function parseStripeWebhookEventReference(payload: JsonValue): StripeWebhookEventReference {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('Invalid billing webhook reconciliation payload')
  }
  const value = payload as Record<string, JsonValue>
  if (
    Object.keys(value).sort().join(',') !== 'eventCreatedAt,eventId,eventType,objectId' ||
    typeof value.eventId !== 'string' ||
    !value.eventId ||
    typeof value.eventType !== 'string' ||
    !isStripeWebhookEventType(value.eventType) ||
    typeof value.eventCreatedAt !== 'number' ||
    !Number.isSafeInteger(value.eventCreatedAt) ||
    value.eventCreatedAt < 0 ||
    typeof value.objectId !== 'string' ||
    !value.objectId
  ) {
    throw new TypeError('Invalid billing webhook reconciliation payload')
  }
  return {
    eventId: value.eventId,
    eventType: value.eventType,
    eventCreatedAt: value.eventCreatedAt,
    objectId: value.objectId
  }
}
