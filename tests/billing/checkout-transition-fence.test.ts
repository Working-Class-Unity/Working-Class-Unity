import { afterEach, describe, expect, it } from 'vitest'
import { reserveCheckoutAttempt } from '../../server/services/payments/stripe/checkout-store'
import type { BillingStripeIntegration } from '../../server/services/payments/stripe/public-contract'
import {
  createBillingStripeRuntimeFixture,
  seedBillingCustomer,
  seedBillingSubscription,
  type BillingStripeRuntimeFixture
} from './runtime-fixture'

const fixtures: BillingStripeRuntimeFixture[] = []
const now = new Date('2026-07-15T12:00:00.000Z')

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.sqlite.close()
})

describe('Checkout and transition mutual exclusion', () => {
  it('rejects Checkout while an open Billing transition exists', () => {
    const fixture = terminalFixture('existing')
    insertOpenTransition(fixture)

    expect(reserveCheckoutAttempt(fixture.connection, integration(), reservation(fixture))).toEqual({
      outcome: 'state_changed',
      attempt: null
    })
    expect(attemptCount(fixture)).toBe(0)
  })

  it('rechecks the transition fence after application authorization', () => {
    const fixture = terminalFixture('race')
    const appIntegration = integration(() => insertOpenTransition(fixture))

    expect(reserveCheckoutAttempt(fixture.connection, appIntegration, reservation(fixture))).toEqual({
      outcome: 'state_changed',
      attempt: null
    })
    expect(attemptCount(fixture)).toBe(0)
  })
})

function terminalFixture(suffix: string): BillingStripeRuntimeFixture {
  const fixture = createBillingStripeRuntimeFixture(`purchaser_checkout_fence_${suffix}`)
  fixtures.push(fixture)
  const customerId = seedBillingCustomer(fixture)
  seedBillingSubscription(fixture, {
    customerId,
    status: 'canceled',
    planKey: 'family',
    cadence: 'monthly',
    stripePriceId: 'price_family_monthly',
    currentPeriodStart: '2026-06-01T00:00:00.000Z',
    currentPeriodEnd: '2026-07-01T00:00:00.000Z'
  })
  return fixture
}

function insertOpenTransition(fixture: BillingStripeRuntimeFixture): void {
  fixture.sqlite
    .prepare(
      `insert into billing_subscription_transitions (
       id, purchaser_user_id, billing_subscription_id, kind, source_plan_key, source_cadence,
       target_plan_key, target_cadence, effective_at, idempotency_key,
       captured_billing_revision, state, revision
     ) values (?, ?, ?, 'cadence_change', 'family', 'monthly', 'family', 'annual', ?, ?, 0, 'pending', 0)`
    )
    .run(
      `transition_${fixture.purchaserUserId}`,
      fixture.purchaserUserId,
      `billing_subscription_${fixture.purchaserUserId}`,
      '2026-07-01T00:00:00.000Z',
      `idempotency_${fixture.purchaserUserId}`
    )
}

function integration(onAuthorize?: () => void): BillingStripeIntegration {
  return {
    authorizePurchaserBilling() {
      onAuthorize?.()
      return 'authorized'
    },
    synchronizePurchaserBilling() {
      return undefined
    }
  }
}

function reservation(fixture: BillingStripeRuntimeFixture) {
  return {
    purchaserUserId: fixture.purchaserUserId,
    billingCustomerId: `billing_customer_${fixture.purchaserUserId}`,
    offering: 'personal.monthly' as const,
    stripePriceId: 'price_personal_monthly',
    successUrl: 'https://app.example.test/account?checkout=success',
    cancelUrl: 'https://app.example.test/account?checkout=cancelled',
    now,
    reuseUntil: new Date('2026-07-15T12:30:00.000Z')
  }
}

function attemptCount(fixture: BillingStripeRuntimeFixture): number {
  return (
    fixture.sqlite.prepare('select count(*) as count from billing_checkout_attempts').get() as {
      count: number
    }
  ).count
}
