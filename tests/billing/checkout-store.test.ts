import Database from 'better-sqlite3'
import type Stripe from 'stripe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureBillingCheckout } from '../../server/services/payments/stripe/checkout'
import {
  finalizeReconciledCheckoutSession,
  mutableAttemptStates,
  recordObservedCheckoutSession,
  reserveCheckoutAttempt,
  transitionCheckoutAttempt
} from '../../server/services/payments/stripe/checkout-store'
import type {
  BillingStripeConnection,
  BillingStripeIntegration
} from '../../server/services/payments/stripe/public-contract'
import type { StripeBillingClient } from '../../server/services/payments/stripe/stripe-client'

const openDatabases: Database.Database[] = []

afterEach(() => {
  for (const sqlite of openDatabases.splice(0)) sqlite.close()
})

describe('purchaser Checkout store', () => {
  it('authorizes and reserves one durable attempt inside an IMMEDIATE transaction', () => {
    const fixture = checkoutStoreFixture()
    const authorize = vi.fn(() => {
      expect(fixture.sqlite.inTransaction).toBe(true)
      return 'authorized' as const
    })
    const integration = billingIntegration(authorize)

    const first = reserveCheckoutAttempt(fixture.connection, integration, reservationInput())
    const retry = reserveCheckoutAttempt(fixture.connection, integration, reservationInput())

    expect(first).toMatchObject({ outcome: 'applied' })
    expect(retry).toMatchObject({ outcome: 'applied' })
    if (first.outcome !== 'applied' || retry.outcome !== 'applied') throw new Error('Reservation failed')
    expect(retry.attempt.id).toBe(first.attempt.id)
    expect(retry.attempt.idempotencyKey).toBe(first.attempt.idempotencyKey)
    expect(fixture.sqlite.prepare('select count(*) as count from billing_checkout_attempts').get()).toEqual({
      count: 1
    })
    expect(authorize).toHaveBeenCalledTimes(2)
    expect(authorize).toHaveBeenCalledWith(fixture.connection, {
      kind: 'checkout',
      purchaserUserId: 'purchaser_one',
      offering: 'family.monthly'
    })
  })

  it('keeps Stripe I/O outside transactions and commits the exact idempotent Session afterward', async () => {
    const fixture = checkoutStoreFixture()
    const authorize = vi.fn(() => {
      expect(fixture.sqlite.inTransaction).toBe(true)
      return 'authorized' as const
    })
    const create = vi.fn(async (input: Stripe.Checkout.SessionCreateParams, _options?: Stripe.RequestOptions) => {
      expect(fixture.sqlite.inTransaction).toBe(false)
      return completeCheckoutSession(input.client_reference_id!, input.line_items![0]!.price as string)
    })

    await expect(
      ensureBillingCheckout(
        {
          connection: fixture.connection,
          integration: billingIntegration(authorize),
          client: { checkout: { sessions: { create } } } as unknown as StripeBillingClient,
          config: runtimeConfiguration()
        },
        'purchaser_one',
        null,
        'family.monthly',
        new Date('2026-07-31T12:00:00.000Z')
      )
    ).resolves.toEqual({ url: 'https://checkout.stripe.test/session/cs_checkout_store' })

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        line_items: [{ price: 'price_family_monthly', quantity: 1 }],
        success_url: 'https://app.example.test/account?checkout=success',
        cancel_url: 'https://app.example.test/account?checkout=cancelled'
      }),
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^checkout_/) })
    )
    expect(authorize).toHaveBeenCalledTimes(2)
    expect(fixture.sqlite.prepare('select state, stripe_session_id from billing_checkout_attempts').get()).toEqual({
      state: 'open',
      stripe_session_id: 'cs_checkout_store'
    })
  })

  it('detaches a conflicting retrieved Session instead of attaching it to the current purchaser', async () => {
    const fixture = checkoutStoreFixture()
    const integration = billingIntegration(() => 'authorized')
    const reservation = reserveCheckoutAttempt(fixture.connection, integration, reservationInput())
    if (reservation.outcome !== 'applied') throw new Error('Reservation failed')
    fixture.sqlite
      .prepare(
        `update billing_checkout_attempts set stripe_session_id = 'cs_checkout_original', state = 'open'
       where id = ?`
      )
      .run(reservation.attempt.id)
    const conflicting = completeCheckoutSession(reservation.attempt.id, reservation.attempt.stripePriceId)
    const retrieve = vi.fn(async () => conflicting)

    await expect(
      ensureBillingCheckout(
        {
          connection: fixture.connection,
          integration,
          client: { checkout: { sessions: { retrieve } } } as unknown as StripeBillingClient,
          config: runtimeConfiguration()
        },
        'purchaser_one',
        null,
        'family.monthly',
        new Date('2026-07-31T12:00:00.000Z')
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'Billing state changed during Checkout creation'
    })

    expect(
      fixture.sqlite.prepare('select stripe_session_id as stripeSessionId, state from billing_checkout_attempts').get()
    ).toEqual({ stripeSessionId: 'cs_checkout_original', state: 'reconciliation_required' })
    expect(
      fixture.sqlite
        .prepare(
          `select provider_reference as providerReference, provider_status as providerStatus
       from detached_billing_subjects`
        )
        .all()
    ).toEqual([
      {
        providerReference: 'checkout:cs_checkout_store',
        providerStatus: 'checkout_open'
      }
    ])
  })

  it('honors the account-deletion fence before authorization or provider work', () => {
    const fixture = checkoutStoreFixture()
    fixture.sqlite
      .prepare(
        `insert into billing_account_deletion_requests (
           id, purchaser_user_id, billing_subscription_id, billing_customer_id,
           expected_stripe_subscription_id, expected_stripe_customer_id,
           captured_billing_revision, state, reason, cancellation_confirmed_at,
           revision, created_at, updated_at
         ) values ('deletion_one', 'purchaser_one', null, null, null, null, 0, 'pending', null, null, 0, ?, ?)`
      )
      .run(new Date().toISOString(), new Date().toISOString())
    const authorize = vi.fn(() => 'authorized' as const)

    expect(reserveCheckoutAttempt(fixture.connection, billingIntegration(authorize), reservationInput())).toEqual({
      outcome: 'state_changed',
      attempt: null
    })
    expect(authorize).not.toHaveBeenCalled()
    expect(fixture.sqlite.prepare('select count(*) as count from billing_checkout_attempts').get()).toEqual({
      count: 0
    })
  })

  it('reauthorizes after provider I/O and retains an unattached Session as detached continuity', () => {
    const fixture = checkoutStoreFixture()
    const authorize = vi
      .fn()
      .mockImplementationOnce(() => 'authorized' as const)
      .mockImplementationOnce(() => {
        expect(fixture.sqlite.inTransaction).toBe(true)
        return 'authority_lost' as const
      })
    const integration = billingIntegration(authorize)
    const reservation = reserveCheckoutAttempt(fixture.connection, integration, reservationInput())
    if (reservation.outcome !== 'applied') throw new Error('Reservation failed')

    expect(
      recordObservedCheckoutSession(
        fixture.connection,
        integration,
        'purchaser_one',
        reservation.attempt,
        checkoutSession(reservation.attempt.id),
        mutableAttemptStates,
        'open'
      )
    ).toBe('authority_lost')
    expect(
      fixture.sqlite
        .prepare(
          `select provider_reference, provider_customer_reference, provider_status, retention_policy
           from detached_billing_subjects`
        )
        .all()
    ).toEqual([
      {
        provider_reference: `attempt:${reservation.attempt.id}`,
        provider_customer_reference: null,
        provider_status: 'checkout_open',
        retention_policy: 'stripe_billing_lifecycle'
      }
    ])
    expect(fixture.sqlite.prepare('select state, stripe_session_id from billing_checkout_attempts').get()).toEqual({
      state: 'pending',
      stripe_session_id: null
    })
  })

  it('atomically binds a verified completed Session to one purchaser Customer', () => {
    const fixture = checkoutStoreFixture()
    const integration = billingIntegration(() => 'authorized')
    const reservation = reserveCheckoutAttempt(fixture.connection, integration, reservationInput())
    if (reservation.outcome !== 'applied') throw new Error('Reservation failed')
    const completed = {
      ...completeCheckoutSession(reservation.attempt.id, reservation.attempt.stripePriceId),
      customer: 'cus_checkout_store',
      status: 'complete',
      url: null
    } as Stripe.Checkout.Session

    expect(
      finalizeReconciledCheckoutSession(
        fixture.connection,
        integration,
        'purchaser_one',
        reservation.attempt,
        completed,
        'cus_checkout_store'
      )
    ).toMatchObject({
      outcome: 'applied',
      customer: {
        purchaserUserId: 'purchaser_one',
        stripeCustomerId: 'cus_checkout_store'
      }
    })
    expect(fixture.sqlite.prepare('select purchaser_user_id, stripe_customer_id from billing_customers').get()).toEqual(
      {
        purchaser_user_id: 'purchaser_one',
        stripe_customer_id: 'cus_checkout_store'
      }
    )
    expect(
      fixture.sqlite
        .prepare('select billing_customer_id, stripe_session_id, state from billing_checkout_attempts')
        .get()
    ).toMatchObject({
      billing_customer_id: expect.stringMatching(/^billing_customer_/),
      stripe_session_id: 'cs_checkout_store',
      state: 'completed'
    })
  })

  it('does not overwrite a terminal attempt observed through a stale reservation', () => {
    const fixture = checkoutStoreFixture()
    const integration = billingIntegration(() => 'authorized')
    const reservation = reserveCheckoutAttempt(fixture.connection, integration, reservationInput())
    if (reservation.outcome !== 'applied') throw new Error('Reservation failed')
    fixture.sqlite
      .prepare("update billing_checkout_attempts set state = 'completed' where id = ?")
      .run(reservation.attempt.id)

    expect(
      transitionCheckoutAttempt(
        fixture.connection,
        integration,
        'purchaser_one',
        reservation.attempt,
        mutableAttemptStates,
        { state: 'failed' }
      )
    ).toBe('state_changed')
    expect(fixture.sqlite.prepare('select state from billing_checkout_attempts').get()).toEqual({
      state: 'completed'
    })
  })
})

function billingIntegration(
  authorizePurchaserBilling: BillingStripeIntegration['authorizePurchaserBilling']
): BillingStripeIntegration {
  return {
    authorizePurchaserBilling,
    synchronizePurchaserBilling: () => undefined
  }
}

function reservationInput() {
  const now = new Date('2026-07-31T12:00:00.000Z')
  return {
    purchaserUserId: 'purchaser_one',
    billingCustomerId: null,
    offering: 'family.monthly' as const,
    stripePriceId: 'price_family_monthly',
    successUrl: 'https://app.example.test/account?checkout=success',
    cancelUrl: 'https://app.example.test/account?checkout=cancelled',
    now,
    reuseUntil: new Date(now.getTime() + 23 * 60 * 60 * 1_000)
  }
}

function checkoutSession(attemptId: string): Stripe.Checkout.Session {
  return {
    id: 'cs_checkout_store',
    object: 'checkout.session',
    client_reference_id: attemptId,
    customer: null,
    expires_at: 1_785_600_000,
    metadata: { billing_attempt_id: attemptId },
    mode: 'subscription',
    status: 'open'
  } as unknown as Stripe.Checkout.Session
}

function completeCheckoutSession(attemptId: string, priceId: string): Stripe.Checkout.Session {
  return {
    ...checkoutSession(attemptId),
    line_items: {
      object: 'list',
      data: [
        {
          id: 'li_checkout_store',
          object: 'item',
          price: { id: priceId },
          quantity: 1
        } as unknown as Stripe.LineItem
      ],
      has_more: false,
      url: '/v1/checkout/sessions/cs_checkout_store/line_items'
    },
    url: 'https://checkout.stripe.test/session/cs_checkout_store'
  } as Stripe.Checkout.Session
}

function runtimeConfiguration() {
  return {
    enabled: true,
    appName: 'Billing Test',
    appUrl: 'https://app.example.test',
    stripe: {
      secretKey: 'rk_test_checkout',
      webhookSecret: 'whsec_checkout',
      portalConfigurationId: 'bpc_checkout',
      prices: {
        'personal.weekly': 'price_personal_weekly',
        'personal.monthly': 'price_personal_monthly',
        'personal.annual': 'price_personal_annual',
        'family.monthly': 'price_family_monthly',
        'family.annual': 'price_family_annual'
      }
    }
  } as const
}

function checkoutStoreFixture(): Readonly<{ sqlite: Database.Database; connection: BillingStripeConnection }> {
  const sqlite = new Database(':memory:')
  openDatabases.push(sqlite)
  sqlite.exec(`
    create table billing_customers (
      id text primary key,
      purchaser_user_id text not null unique,
      stripe_customer_id text not null unique,
      created_at text not null,
      updated_at text not null
    );
    create table billing_checkout_attempts (
      id text primary key,
      purchaser_user_id text not null,
      billing_customer_id text,
      plan_key text not null,
      cadence text not null,
      stripe_price_id text not null,
      stripe_session_id text unique,
      idempotency_key text not null unique,
      state text not null,
      success_url text not null,
      cancel_url text not null,
      reuse_until text not null,
      created_at text not null,
      updated_at text not null
    );
    create unique index billing_checkout_attempts_one_open_uidx
      on billing_checkout_attempts(purchaser_user_id)
      where state in ('pending', 'open', 'reconciliation_required');
    create table billing_subscriptions (
      id text primary key,
      purchaser_user_id text not null unique,
      billing_customer_id text not null unique,
      stripe_subscription_id text,
      stripe_subscription_item_id text,
      status text not null,
      plan_key text,
      cadence text,
      stripe_price_id text,
      current_period_start text,
      current_period_end text,
      cancel_at_period_end integer not null,
      grace_invoice_id text,
      grace_started_at text,
      grace_ends_at text,
      last_verified_at text,
      projection_order_ms integer not null,
      projection_event_id text,
      reconciliation_required integer not null,
      reconciliation_reason text,
      revision integer not null,
      created_at text not null,
      updated_at text not null
    );
    create table billing_subscription_transitions (
      id text primary key,
      purchaser_user_id text not null,
      billing_subscription_id text not null,
      kind text not null,
      source_plan_key text not null,
      source_cadence text not null,
      target_plan_key text not null,
      target_cadence text not null,
      effective_at text,
      stripe_subscription_schedule_id text,
      stripe_pending_invoice_id text,
      stripe_pending_update_expires_at text,
      idempotency_key text not null,
      captured_billing_revision integer not null,
      state text not null,
      state_reason text,
      revision integer not null,
      created_at text not null,
      updated_at text not null
    );
    create table billing_account_deletion_requests (
      id text primary key,
      purchaser_user_id text not null unique,
      billing_subscription_id text,
      billing_customer_id text,
      expected_stripe_subscription_id text,
      expected_stripe_customer_id text,
      captured_billing_revision integer not null,
      state text not null,
      reason text,
      cancellation_confirmed_at text,
      revision integer not null,
      created_at text not null,
      updated_at text not null
    );
    create table detached_billing_subjects (
      id text primary key,
      provider text not null,
      provider_reference text not null,
      provider_customer_reference text,
      provider_status text not null,
      provider_status_expires_at text,
      provider_event_created_at integer,
      status_updated_at text not null,
      deleted_at text not null,
      retention_purpose text not null,
      retention_policy text not null,
      purge_after text,
      unique(provider, provider_reference)
    );
  `)
  return { sqlite, connection: { sqlite } }
}
