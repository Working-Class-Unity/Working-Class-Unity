import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationsFolder = fileURLToPath(new URL('../../server/db/migrations/', import.meta.url))

describe('committed Billing migration trigger behavior', () => {
  it('enforces all five purchaser and reconciliation invariants on inserts and updates', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')

    try {
      migrate(drizzle({ client: sqlite }), { migrationsFolder })
      seedAuthorities(sqlite)

      expectBillingAbort(
        () => insertCheckout(sqlite, 'checkout-insert-mismatch', 'purchaser-b', 'customer-a'),
        'billing checkout customer purchaser mismatch'
      )
      insertCheckout(sqlite, 'checkout-valid', 'purchaser-a', 'customer-a')
      expectBillingAbort(
        () =>
          sqlite
            .prepare(
              "update billing_checkout_attempts set purchaser_user_id = 'purchaser-b' where id = 'checkout-valid'"
            )
            .run(),
        'billing checkout customer purchaser mismatch'
      )

      expectBillingAbort(
        () => insertSubscription(sqlite, 'subscription-insert-mismatch', 'purchaser-b', 'customer-a'),
        'billing subscription customer purchaser mismatch'
      )
      insertSubscription(sqlite, 'subscription-a', 'purchaser-a', 'customer-a')
      expectBillingAbort(
        () =>
          sqlite
            .prepare("update billing_subscriptions set purchaser_user_id = 'purchaser-b' where id = 'subscription-a'")
            .run(),
        'billing subscription customer purchaser mismatch'
      )

      expectBillingAbort(
        () => insertSubscription(sqlite, 'subscription-offering-insert', 'purchaser-b', 'customer-b', false),
        'billing subscription offering requires reconciliation'
      )
      insertSubscription(sqlite, 'subscription-b', 'purchaser-b', 'customer-b')
      expectBillingAbort(
        () =>
          sqlite
            .prepare("update billing_subscriptions set plan_key = null, cadence = null where id = 'subscription-b'")
            .run(),
        'billing subscription offering requires reconciliation'
      )

      expectBillingAbort(
        () => insertTransition(sqlite, 'transition-insert-mismatch', 'purchaser-b'),
        'billing transition subscription purchaser mismatch'
      )
      insertTransition(sqlite, 'transition-valid', 'purchaser-a')
      expectBillingAbort(
        () =>
          sqlite
            .prepare(
              "update billing_subscription_transitions set captured_billing_revision = 8 where id = 'transition-valid'"
            )
            .run(),
        'billing transition subscription purchaser mismatch'
      )

      expectBillingAbort(
        () => insertDeletionRequest(sqlite, 'deletion-insert-mismatch', 'purchaser-b'),
        'billing deletion reference mismatch'
      )
      insertDeletionRequest(sqlite, 'deletion-valid', 'purchaser-a')
      expectBillingAbort(
        () =>
          sqlite
            .prepare(
              "update billing_account_deletion_requests set expected_stripe_customer_id = 'cus_wrong' where id = 'deletion-valid'"
            )
            .run(),
        'billing deletion reference mismatch'
      )

      expect(sqlite.pragma('foreign_key_check')).toEqual([])
    } finally {
      sqlite.close()
    }
  })
})

function seedAuthorities(sqlite: InstanceType<typeof Database>) {
  const now = Math.floor(Date.now() / 1_000)
  const insertUser = sqlite.prepare(
    'insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)'
  )
  insertUser.run('purchaser-a', 'Purchaser A', 'purchaser-a@example.test', now, now)
  insertUser.run('purchaser-b', 'Purchaser B', 'purchaser-b@example.test', now, now)

  sqlite
    .prepare('insert into billing_customers (id, purchaser_user_id, stripe_customer_id) values (?, ?, ?)')
    .run('customer-a', 'purchaser-a', 'cus_a')
  sqlite
    .prepare('insert into billing_customers (id, purchaser_user_id, stripe_customer_id) values (?, ?, ?)')
    .run('customer-b', 'purchaser-b', 'cus_b')
}

function insertCheckout(
  sqlite: InstanceType<typeof Database>,
  id: string,
  purchaserUserId: string,
  billingCustomerId: string
) {
  sqlite
    .prepare(
      `insert into billing_checkout_attempts (
         id, purchaser_user_id, billing_customer_id, plan_key, cadence, stripe_price_id,
         idempotency_key, state, success_url, cancel_url, reuse_until
       ) values (?, ?, ?, 'personal', 'monthly', 'price_monthly', ?, 'completed', ?, ?, ?)`
    )
    .run(
      id,
      purchaserUserId,
      billingCustomerId,
      `idempotency-${id}`,
      'https://wcu.example.test/success',
      'https://wcu.example.test/cancel',
      '2099-01-01T00:00:00.000Z'
    )
}

function insertSubscription(
  sqlite: InstanceType<typeof Database>,
  id: string,
  purchaserUserId: string,
  billingCustomerId: string,
  withOffering = true
) {
  sqlite
    .prepare(
      `insert into billing_subscriptions (
         id, purchaser_user_id, billing_customer_id, stripe_subscription_id,
         status, plan_key, cadence, stripe_price_id, revision
       ) values (?, ?, ?, ?, 'active', ?, ?, ?, 7)`
    )
    .run(
      id,
      purchaserUserId,
      billingCustomerId,
      `sub_${id}`,
      withOffering ? 'personal' : null,
      withOffering ? 'monthly' : null,
      withOffering ? 'price_monthly' : null
    )
}

function insertTransition(sqlite: InstanceType<typeof Database>, id: string, purchaserUserId: string) {
  sqlite
    .prepare(
      `insert into billing_subscription_transitions (
         id, purchaser_user_id, billing_subscription_id, kind, source_plan_key, source_cadence,
         target_plan_key, target_cadence, effective_at, idempotency_key,
         captured_billing_revision, state
       ) values (?, ?, 'subscription-a', 'cadence_change', 'personal', 'monthly',
         'personal', 'annual', '2026-09-01T00:00:00.000Z', ?, 7, 'applied')`
    )
    .run(id, purchaserUserId, `idempotency-${id}`)
}

function insertDeletionRequest(sqlite: InstanceType<typeof Database>, id: string, purchaserUserId: string) {
  sqlite
    .prepare(
      `insert into billing_account_deletion_requests (
         id, purchaser_user_id, billing_subscription_id, billing_customer_id,
         expected_stripe_subscription_id, expected_stripe_customer_id, captured_billing_revision
       ) values (?, ?, 'subscription-a', 'customer-a', 'sub_subscription-a', 'cus_a', 7)`
    )
    .run(id, purchaserUserId)
}

function expectBillingAbort(operation: () => unknown, message: string) {
  expect(operation).toThrow(message)
}
