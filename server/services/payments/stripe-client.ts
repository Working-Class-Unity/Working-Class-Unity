import Stripe from 'stripe'
import { configurationError, validationError } from '../../utils/errors'
import { requireModuleReady } from '../../utils/module-state'
import { getAppRuntimeConfig, type AppRuntimeConfig } from '../../utils/runtime'

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
      name: 'SmallWiseLabs Base App'
    }
  })
}

export function getStripeClient(config: AppRuntimeConfig = getAppRuntimeConfig()): Stripe {
  requireModuleReady('billing', config)
  productionClient ??= createStripeClient(config.stripe.secretKey)
  return productionClient
}

export function getStripeWebhookSecret(config: AppRuntimeConfig = getAppRuntimeConfig()): string {
  requireModuleReady('billing', config)
  if (!config.stripe.webhookSecret) throw configurationError('Stripe webhook secret is not configured')
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
