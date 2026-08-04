import { createError, getRequestHeader, type H3Event } from 'h3'
import { processStripeWebhookEvent } from '../../services/payments/billing-webhook'
import {
  constructStripeWebhookEvent,
  getStripeClient,
  getStripeWebhookSecret
} from '../../services/payments/stripe-client'
import { captureException } from '../../services/observability/capture'
import { validationError } from '../../utils/errors'
import { getAppRuntimeConfig } from '../../utils/runtime'

const stripeWebhookBodyLimitBytes = 65_536

export default defineEventHandler(async (event) => {
  const rawBody = await readStripeWebhookBody(event)
  if (rawBody.byteLength === 0) throw validationError('Missing Stripe webhook payload')

  const config = getAppRuntimeConfig()
  const stripeEvent = constructStripeWebhookEvent(
    getStripeClient(config),
    rawBody,
    getRequestHeader(event, 'stripe-signature'),
    getStripeWebhookSecret(config)
  )

  try {
    const result = await processStripeWebhookEvent(stripeEvent)
    return { received: true, duplicate: result.duplicate }
  } catch (error) {
    await captureException(new Error('Stripe webhook processing failed'), 'stripe-webhook-processing-failed')
    throw error
  }
})

async function readStripeWebhookBody(event: H3Event): Promise<Buffer> {
  const declaredLength = getRequestHeader(event, 'content-length')
  if (declaredLengthExceedsLimit(declaredLength)) rejectOversizedBody(event)

  const chunks: Buffer[] = []
  let byteLength = 0

  for await (const chunk of event.node.req.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    byteLength += bytes.byteLength

    if (byteLength > stripeWebhookBodyLimitBytes) {
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
  return BigInt(normalized) > BigInt(stripeWebhookBodyLimitBytes)
}

function rejectOversizedBody(event: H3Event): never {
  // Continue consuming without retaining attacker-controlled bytes so Node can
  // send the generic error response without destroying the request socket.
  event.node.req.resume()
  throw createError({ statusCode: 413, statusMessage: 'Payload Too Large' })
}
