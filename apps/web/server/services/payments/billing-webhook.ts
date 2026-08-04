import type Stripe from 'stripe'
import type { DatabaseConnection } from '../../db/connect'
import { useDatabase } from '../../db/client'
import { getBillingEventByStripeId } from '../../db/repositories/billing'
import { upstreamServiceError, validationError } from '../../utils/errors'
import { requireModuleReady } from '../../utils/module-state'
import { getAppRuntimeConfig, type AppRuntimeConfig } from '../../utils/runtime'
import { applyStripeEventObservation, type StripeEventObservation } from './billing-event-store'
import { getStripeClient, type StripeBillingClient } from './stripe-client'
import {
  enqueueBillingWebhookReconciliation,
  isStripeWebhookEventType,
  type StripeWebhookEventReference
} from './billing-webhook-reference'
import { observeStripeWebhookCurrentState } from './billing-webhook-state'

export async function processStripeWebhookEvent(event: Stripe.Event) {
  const config = getAppRuntimeConfig()
  requireModuleReady('billing', config)
  return processStripeWebhookEventForConnection(useDatabase(), getStripeClient(config), config, event)
}

export async function processStripeWebhookEventForConnection(
  connection: DatabaseConnection,
  client: StripeBillingClient,
  config: AppRuntimeConfig,
  event: Stripe.Event
) {
  requireModuleReady('billing', config)
  if (!event.id || !event.type || !Number.isSafeInteger(event.created) || event.created < 0) {
    throw validationError('Invalid Stripe webhook event')
  }

  if (!isStripeWebhookEventType(event.type)) {
    return { duplicate: false, target: 'ignored' as const }
  }

  const objectId = eventObjectId(event.data?.object)
  if (!objectId) throw validationError('Invalid Stripe webhook event')

  return processStripeWebhookReferenceForConnection(connection, client, config, {
    eventId: event.id,
    eventType: event.type,
    eventCreatedAt: event.created,
    objectId
  })
}

export async function processStripeWebhookReferenceForConnection(
  connection: DatabaseConnection,
  client: StripeBillingClient,
  config: AppRuntimeConfig,
  reference: StripeWebhookEventReference,
  scheduleRetry = true
) {
  requireModuleReady('billing', config)
  if (getBillingEventByStripeId(connection, reference.eventId)) {
    return { duplicate: true, target: 'ignored' as const }
  }

  let current: Awaited<ReturnType<typeof observeStripeWebhookCurrentState>>
  try {
    current = await observeStripeWebhookCurrentState(client, config, reference)
  } catch {
    if (scheduleRetry) enqueueBillingWebhookReconciliation(connection, reference)
    throw upstreamServiceError(502, 'Stripe billing state is temporarily unavailable')
  }

  const observation: StripeEventObservation = {
    ...reference,
    ...current
  }
  return applyStripeEventObservation(connection, observation)
}

function eventObjectId(object: unknown): string | null {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return null
  const id = (object as Record<string, unknown>).id
  return typeof id === 'string' && id ? id : null
}
