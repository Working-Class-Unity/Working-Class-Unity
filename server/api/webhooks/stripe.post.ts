import { Buffer } from 'node:buffer'
import { createError, defineEventHandler, getRequestHeader, type H3Event } from 'h3'
import { reportBillingStripeFailure, requireBillingStripeReady } from '../../services/payments/stripe/composition'
import {
  constructStripeWebhookEvent,
  getStripeClient,
  getStripeWebhookSecret
} from '../../services/payments/stripe/stripe-client'
import { processStripeWebhookEvent } from '../../services/payments/stripe/webhook'

export const billingStripeWebhookBodyLimitBytes = 65_536

export default defineEventHandler(async (event) => {
  const ready = requireBillingStripeReady()
  const rawBody = await readBillingStripeWebhookBody(event)
  if (rawBody.byteLength === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Missing Stripe webhook payload' })
  }

  const client = getStripeClient(ready.config)
  const stripeEvent = constructStripeWebhookEvent(
    client,
    rawBody,
    getRequestHeader(event, 'stripe-signature'),
    getStripeWebhookSecret(ready.config)
  )

  try {
    const result = await processStripeWebhookEvent(
      ready.composition.connection(),
      client,
      ready.config,
      ready.composition.integration,
      stripeEvent
    )
    return { received: true, duplicate: result.duplicate }
  } catch (error) {
    await reportBillingStripeFailure(error, 'webhook')
    throw error
  }
})

export async function readBillingStripeWebhookBody(event: H3Event): Promise<Buffer> {
  const declaredLength = getRequestHeader(event, 'content-length')
  if (declaredLengthExceedsLimit(declaredLength)) rejectOversizedBody(event)

  const chunks: Buffer[] = []
  let byteLength = 0
  for await (const chunk of event.node.req.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    byteLength += bytes.byteLength
    if (byteLength > billingStripeWebhookBodyLimitBytes) {
      chunks.length = 0
      rejectOversizedBody(event)
    }
    chunks.push(bytes)
  }
  return Buffer.concat(chunks, byteLength)
}

function declaredLengthExceedsLimit(value: string | undefined): boolean {
  const normalized = value?.trim()
  if (!normalized || !/^\d+$/.test(normalized)) return false
  return BigInt(normalized) > BigInt(billingStripeWebhookBodyLimitBytes)
}

function rejectOversizedBody(event: H3Event): never {
  event.node.req.resume()
  throw createError({ statusCode: 413, statusMessage: 'Payload Too Large' })
}
