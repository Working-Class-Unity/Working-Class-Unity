import composition from './app-composition'
import type { H3Event } from 'h3'
import type {
  BillingStripeComposition,
  BillingStripeConnection,
  BillingStripeIntegration,
  BillingStripeOperation
} from './public-contract'

const billingComposition = composition as BillingStripeComposition<BillingStripeConnection, unknown>

export function requireBillingStripeReady() {
  const config = billingComposition.configuration()
  return Object.freeze({ config, composition: billingComposition })
}

export async function requireBillingStripeUserId(event: H3Event): Promise<string> {
  const ready = requireBillingStripeReady()
  return ready.composition.requireUserId(event)
}

export function billingStripeIntegration(): BillingStripeIntegration<BillingStripeConnection, unknown> | undefined {
  return billingComposition.integration
}

export async function reportBillingStripeFailure(error: unknown, operation: BillingStripeOperation): Promise<void> {
  const normalized = error instanceof Error ? error : new Error('Billing Stripe operation failed')
  try {
    await billingComposition.reportFailure(normalized, operation)
  } catch {
    // Reporting must not replace the route/job failure that triggered it.
  }
}
