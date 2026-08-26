import { getTableColumns } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import {
  billingAccountDeletionRequests,
  billingStripeSchema,
  billingSubscriptions,
  detachedBillingSubjects
} from '../../server/db/schema/billing'
import { billingStripeInvariantSql } from '../../server/db/schema/billing.invariants'
import {
  createBillingStripeRuntimeFixture,
  seedBillingCustomer,
  seedBillingSubscription,
  type BillingStripeRuntimeFixture
} from './runtime-fixture'

const fixtures: BillingStripeRuntimeFixture[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.sqlite.close()
})

describe('Billing Stripe schema contract', () => {
  it('exports exactly eight Billing tables with no Family or organization field', () => {
    expect(Object.keys(billingStripeSchema)).toEqual([
      'billingCustomers',
      'billingCheckoutAttempts',
      'billingEmailVerifications',
      'billingSubscriptions',
      'billingSubscriptionTransitions',
      'billingAccountDeletionRequests',
      'billingEvents',
      'detachedBillingSubjects'
    ])
    for (const table of Object.values(billingStripeSchema)) {
      expect(Object.keys(getTableColumns(table))).not.toContain('organizationId')
      expect(Object.keys(getTableColumns(table))).not.toContain('familyId')
    }
    expect(Object.keys(getTableColumns(billingSubscriptions))).toContain('purchaserUserId')
    expect(Object.keys(getTableColumns(billingAccountDeletionRequests))).toContain('purchaserUserId')
    expect(Object.keys(getTableColumns(detachedBillingSubjects))).not.toContain('purchaserUserId')
  })

  it('ships one migration-ready canonical invariant input containing exactly ten triggers', () => {
    const fixture = createBillingStripeRuntimeFixture('purchaser_schema_trigger_count')
    fixtures.push(fixture)
    expect(billingStripeInvariantSql.match(/^create trigger /gm) ?? []).toHaveLength(10)
    expect(billingStripeInvariantSql.match(/^--> statement-breakpoint$/gm) ?? []).toHaveLength(9)
    expect(
      fixture.sqlite
        .prepare(`select name from sqlite_master where type = 'trigger' and name like 'billing_%' order by name`)
        .all()
    ).toHaveLength(10)
  })

  it('rejects none-state residue and partial grace tuples in real SQLite', () => {
    const fixture = seededFixture('subscription_checks')

    expect(() => fixture.sqlite.prepare(`update billing_subscriptions set status = 'none'`).run()).toThrow(
      /CHECK constraint failed/
    )
    expect(() =>
      fixture.sqlite
        .prepare(
          `update billing_subscriptions
       set grace_invoice_id = 'in_partial', grace_started_at = null, grace_ends_at = null`
        )
        .run()
    ).toThrow(/CHECK constraint failed/)
  })

  it('rejects deletion reference, reason, and confirmation mismatches in real SQLite', () => {
    const fixture = seededFixture('deletion_checks')
    const subscriptionId = `billing_subscription_${fixture.purchaserUserId}`
    const customerId = `billing_customer_${fixture.purchaserUserId}`

    expect(() =>
      fixture.sqlite
        .prepare(
          `insert into billing_account_deletion_requests (
         id, purchaser_user_id, billing_subscription_id, billing_customer_id,
         expected_stripe_subscription_id, expected_stripe_customer_id,
         captured_billing_revision, state, reason, cancellation_confirmed_at, revision
       ) values ('deletion_invalid_customer', ?, ?, ?, 'sub_test', 'not_a_customer',
                 0, 'pending', null, null, 0)`
        )
        .run(fixture.purchaserUserId, subscriptionId, customerId)
    ).toThrow(/CHECK constraint failed|billing deletion reference mismatch/)

    expect(() =>
      fixture.sqlite
        .prepare(
          `insert into billing_account_deletion_requests (
         id, purchaser_user_id, billing_subscription_id, billing_customer_id,
         expected_stripe_subscription_id, expected_stripe_customer_id,
         captured_billing_revision, state, reason, cancellation_confirmed_at, revision
       ) values ('deletion_missing_reason', ?, ?, ?, 'sub_test', 'cus_test',
                 0, 'reconciliation_required', null, null, 0)`
        )
        .run(fixture.purchaserUserId, subscriptionId, customerId)
    ).toThrow(/CHECK constraint failed/)

    expect(() =>
      fixture.sqlite
        .prepare(
          `insert into billing_account_deletion_requests (
         id, purchaser_user_id, billing_subscription_id, billing_customer_id,
         expected_stripe_subscription_id, expected_stripe_customer_id,
         captured_billing_revision, state, reason, cancellation_confirmed_at, revision
       ) values ('deletion_missing_confirmation', ?, ?, ?, 'sub_test', 'cus_test',
                 0, 'cancellation_confirmed', null, null, 0)`
        )
        .run(fixture.purchaserUserId, subscriptionId, customerId)
    ).toThrow(/CHECK constraint failed/)
  })

  it('enforces purchaser/revision transition linkage and retained-policy constraints', () => {
    const fixture = seededFixture('invariants')
    expect(() =>
      fixture.sqlite
        .prepare(
          `insert into billing_subscription_transitions (
         id, purchaser_user_id, billing_subscription_id, kind, source_plan_key, source_cadence,
         target_plan_key, target_cadence, effective_at, idempotency_key,
         captured_billing_revision, state, revision
       ) values ('transition_wrong_revision', ?, ?, 'cadence_change', 'family', 'monthly',
                 'family', 'annual', '2026-08-01T00:00:00.000Z', 'transition_wrong_revision',
                 1, 'pending', 0)`
        )
        .run(fixture.purchaserUserId, `billing_subscription_${fixture.purchaserUserId}`)
    ).toThrow(/billing transition subscription purchaser mismatch/)

    expect(() =>
      fixture.sqlite
        .prepare(
          `insert into detached_billing_subjects (
         id, provider, provider_reference, provider_customer_reference, provider_status,
         status_updated_at, deleted_at, retention_purpose, retention_policy
       ) values ('detached_wrong_policy', 'stripe', 'sub_wrong_policy', 'cus_test', 'active',
                 current_timestamp, current_timestamp,
                 'external_billing_reconciliation', 'forever')`
        )
        .run()
    ).toThrow(/CHECK constraint failed/)
  })

  it('uses restrict foreign keys so the Identity user cannot be removed before Billing cleanup', () => {
    const fixture = seededFixture('foreign_key')
    expect(() => fixture.sqlite.prepare('delete from user where id = ?').run(fixture.purchaserUserId)).toThrow(
      /FOREIGN KEY constraint failed/
    )
    expect(fixture.sqlite.pragma('foreign_key_check')).toEqual([])
  })
})

function seededFixture(suffix: string): BillingStripeRuntimeFixture {
  const fixture = createBillingStripeRuntimeFixture(`purchaser_schema_${suffix}`)
  fixtures.push(fixture)
  seedBillingCustomer(fixture)
  seedBillingSubscription(fixture)
  return fixture
}
