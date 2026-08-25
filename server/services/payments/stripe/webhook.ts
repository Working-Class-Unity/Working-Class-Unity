import type Stripe from 'stripe'
import { upstreamServiceError, validationError } from '../../../utils/errors'
import { applyStripeEventObservation } from './event-store'
import type { BillingStripeRuntimeConfiguration } from './configuration'
import type { BillingStripeConnection, BillingStripeIntegration } from './public-contract'
import type { StripeBillingClient } from './stripe-client'
import {
  enqueueBillingWebhookReconciliation,
  isStripeWebhookEventType,
  type StripeWebhookEventReference
} from './webhook-reference'
import { observeStripeWebhookCurrentState, type StripeWebhookCurrentObservation } from './webhook-state'

export type StripeEventObservation = StripeWebhookEventReference & StripeWebhookCurrentObservation

export async function processStripeWebhookEvent(
  connection: BillingStripeConnection,
  client: StripeBillingClient,
  config: BillingStripeRuntimeConfiguration,
  integration: BillingStripeIntegration<BillingStripeConnection, unknown> | undefined,
  event: Stripe.Event
) {
  if (!event.id || !event.type || !Number.isSafeInteger(event.created) || event.created < 0) {
    throw validationError('Invalid Stripe webhook event')
  }
  if (!isStripeWebhookEventType(event.type)) {
    return { duplicate: false, target: 'ignored' as const }
  }
  const objectId = eventObjectId(event.data?.object)
  if (!objectId) throw validationError('Invalid Stripe webhook event')
  return processStripeWebhookReference(connection, client, config, integration, {
    eventId: event.id,
    eventType: event.type,
    eventCreatedAt: event.created,
    objectId
  })
}

export async function processStripeWebhookReference(
  connection: BillingStripeConnection,
  client: StripeBillingClient,
  config: BillingStripeRuntimeConfiguration,
  integration: BillingStripeIntegration<BillingStripeConnection, unknown> | undefined,
  reference: StripeWebhookEventReference,
  scheduleRetry = true
) {
  if (hasReceipt(connection, reference.eventId)) return { duplicate: true, target: 'ignored' as const }
  let current: StripeWebhookCurrentObservation
  try {
    current = await observeStripeWebhookCurrentState(client, config, reference)
  } catch {
    if (scheduleRetry) enqueueBillingWebhookReconciliation(connection, reference)
    throw upstreamServiceError(502, 'Stripe billing state is temporarily unavailable')
  }
  return applyStripeEventObservation(connection, integration, { ...reference, ...current })
}

function eventObjectId(object: unknown): string | null {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return null
  const id = (object as Record<string, unknown>).id
  return typeof id === 'string' && id ? id : null
}

function hasReceipt(connection: BillingStripeConnection, eventId: string): boolean {
  return Boolean(connection.sqlite.prepare('select 1 from billing_events where stripe_event_id = ?').get(eventId))
}
