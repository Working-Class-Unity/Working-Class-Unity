import Stripe from 'stripe'
import type { BillingStripeRuntimeConfiguration } from './configuration'
import { configurationError, validationError } from '../../../utils/errors'

const stripeApiVersion = '2026-06-24.dahlia' as const

let productionClient: Stripe | undefined

export function createStripeClient(secretKey: string, httpClient?: Stripe.HttpClient): Stripe {
  if (!secretKey) throw configurationError('Stripe secret key is not configured')

  return new Stripe(secretKey, {
    apiVersion: stripeApiVersion,
    typescript: true,
    telemetry: false,
    emitEventBodies: false,
    httpClient,
    timeout: 10_000,
    maxNetworkRetries: 1,
    appInfo: {
      name: 'Working Class Unity',
      version: '0.1.0'
    }
  })
}

export function getStripeClient(config: BillingStripeRuntimeConfiguration): Stripe {
  productionClient ??= createStripeClient(config.stripe.secretKey)
  return productionClient
}

export function getStripeWebhookSecret(config: BillingStripeRuntimeConfiguration): string {
  if (!config.stripe.webhookSecret) {
    throw configurationError('Stripe webhook secret is not configured')
  }
  return config.stripe.webhookSecret
}

export function constructStripeWebhookEvent(
  client: Stripe,
  payload: string | Uint8Array,
  signatureHeader: string | undefined,
  webhookSecret: string
): Stripe.Event {
  if (!signatureHeader) throw validationError('Missing Stripe signature')

  try {
    return client.webhooks.constructEvent(payload, signatureHeader, webhookSecret)
  } catch {
    throw validationError('Stripe signature verification failed')
  }
}

export function resetStripeClientForTests(): void {
  if (process.env.NODE_ENV !== 'test') return
  productionClient = undefined
}

export type StripeBillingClient = Stripe
