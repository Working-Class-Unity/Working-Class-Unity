import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
const predecessorTags = ['0000_pre_release_baseline', '0001_runtime_invariants'] as const
type Sqlite = InstanceType<typeof Database>

describe('Stripe billing forward migration', () => {
  it('creates the durable Stripe workflow schema and restores every runtime trigger', () => {
    withMigratedDatabase('fresh-contract', (sqlite) => {
      expect(
        sqlite
          .prepare(
            `select type, "notnull" as "notNull", dflt_value as "defaultValue"
             from pragma_table_info('organization')
             where name = 'billing_deletion_pending'`
          )
          .get()
      ).toEqual({ type: 'INTEGER', notNull: 1, defaultValue: 'false' })
      expect(tableColumns(sqlite, 'billing_checkout_attempts')).toContain('cadence')
      expect(tableColumns(sqlite, 'billing_subscriptions')).toEqual(
        expect.arrayContaining([
          'cadence',
          'stripe_subscription_item_id',
          'grace_invoice_id',
          'grace_started_at',
          'grace_ends_at',
          'last_verified_at',
          'revision'
        ])
      )
      expect(tableColumns(sqlite, 'billing_subscription_transitions')).toEqual(
        expect.arrayContaining([
          'target_cadence',
          'stripe_subscription_schedule_id',
          'stripe_pending_invoice_id',
          'captured_billing_revision'
        ])
      )
      expect(tableColumns(sqlite, 'family_join_attempts')).toEqual(
        expect.arrayContaining(['personal_paid_through', 'captured_personal_billing_revision'])
      )

      const deletionColumns = tableColumns(sqlite, 'billing_account_deletion_requests')
      expect(deletionColumns).toEqual(
        expect.arrayContaining([
          'expected_stripe_subscription_id',
          'expected_stripe_customer_id',
          'captured_billing_revision'
        ])
      )
      expect(deletionColumns).not.toEqual(
        expect.arrayContaining(['local_deletion_authorized', 'local_deletion_requested_at'])
      )
      expect(migrationCount(sqlite)).toBe(4)
      expect(triggerCount(sqlite)).toBe(30)
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
      expect(sqlite.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }])
    })
  })

  it('upgrades and preserves predecessor Stripe rows without inventing cadence', () => {
    withPredecessorDatabase('upgrade-preservation', (sqlite) => {
      for (const userId of ['legacy-live', 'legacy-terminal']) insertUser(sqlite, userId)
      const liveOrganizationId = personalOrganizationId(sqlite, 'legacy-live')
      const terminalOrganizationId = personalOrganizationId(sqlite, 'legacy-terminal')

      insertLegacyCustomer(sqlite, 'live', liveOrganizationId)
      insertLegacyCustomer(sqlite, 'terminal', terminalOrganizationId)
      insertLegacyCheckout(sqlite, 'live', liveOrganizationId, 'open')
      insertLegacyCheckout(sqlite, 'terminal', terminalOrganizationId, 'expired')
      insertLegacySubscription(sqlite, 'live', liveOrganizationId, {
        status: 'active',
        stripeSubscriptionId: 'sub_legacy_live',
        stripePriceId: 'price_legacy_family_monthly'
      })
      insertLegacySubscription(sqlite, 'terminal', terminalOrganizationId, {
        status: 'canceled',
        stripeSubscriptionId: 'sub_legacy_terminal',
        stripePriceId: 'price_legacy_family_annual'
      })
      sqlite
        .prepare(
          `insert into billing_events
            (stripe_event_id, event_type, provider_created_at, processed_at)
           values ('evt_legacy', 'customer.subscription.updated', 1234, '2026-07-28T00:00:00.000Z')`
        )
        .run()
      sqlite
        .prepare(
          `insert into detached_billing_subjects (
            id, provider, provider_reference, provider_customer_reference, provider_status,
            provider_status_expires_at, provider_event_created_at, status_updated_at, deleted_at,
            retention_purpose, retention_policy, purge_after
          ) values (
            'detached-legacy', 'stripe', 'sub_detached', 'cus_detached', 'active',
            null, 1200, '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z',
            'external_billing_reconciliation', 'stripe_billing_lifecycle', null
          )`
        )
        .run()

      migrateCurrent(sqlite)

      expect(
        sqlite
          .prepare(
            `select stripe_subscription_id as stripeSubscriptionId, stripe_price_id as stripePriceId,
                    cadence, reconciliation_required as reconciliationRequired,
                    reconciliation_reason as reconciliationReason, revision
             from billing_subscriptions where id = 'subscription-live'`
          )
          .get()
      ).toEqual({
        stripeSubscriptionId: 'sub_legacy_live',
        stripePriceId: 'price_legacy_family_monthly',
        cadence: null,
        reconciliationRequired: 1,
        reconciliationReason: 'legacy_family_cadence_unknown',
        revision: 1
      })
      expect(
        sqlite
          .prepare(
            `select stripe_subscription_id as stripeSubscriptionId, cadence,
                    reconciliation_required as reconciliationRequired,
                    reconciliation_reason as reconciliationReason, revision
             from billing_subscriptions where id = 'subscription-terminal'`
          )
          .get()
      ).toEqual({
        stripeSubscriptionId: 'sub_legacy_terminal',
        cadence: null,
        reconciliationRequired: 0,
        reconciliationReason: null,
        revision: 0
      })
      expect(sqlite.prepare('select id, cadence, state from billing_checkout_attempts order by id').all()).toEqual([
        { id: 'checkout-live', cadence: null, state: 'reconciliation_required' },
        { id: 'checkout-terminal', cadence: null, state: 'expired' }
      ])
      expect(sqlite.prepare('select stripe_customer_id from billing_customers order by id').all()).toEqual([
        { stripe_customer_id: 'cus_live' },
        { stripe_customer_id: 'cus_terminal' }
      ])
      expect(sqlite.prepare('select stripe_event_id from billing_events').all()).toEqual([
        { stripe_event_id: 'evt_legacy' }
      ])
      expect(
        sqlite.prepare('select provider_reference, provider_customer_reference from detached_billing_subjects').all()
      ).toEqual([{ provider_reference: 'sub_detached', provider_customer_reference: 'cus_detached' }])
      expect(migrationCount(sqlite)).toBe(4)
      expect(triggerCount(sqlite)).toBe(30)

      const ledgerBeforeRepeat = migrationLedger(sqlite)
      migrateCurrent(sqlite)
      expect(migrationLedger(sqlite)).toEqual(ledgerBeforeRepeat)
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
      expect(sqlite.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }])
    })
  })

  it('rolls an invalid upgrade back and succeeds after the predecessor row is corrected', () => {
    withPredecessorDatabase('rollback-retry', (sqlite) => {
      insertUser(sqlite, 'invalid-legacy')
      const organizationId = personalOrganizationId(sqlite, 'invalid-legacy')
      insertLegacyCustomer(sqlite, 'invalid', organizationId)

      sqlite.pragma('ignore_check_constraints = ON')
      insertLegacySubscription(sqlite, 'invalid', organizationId, {
        status: 'active',
        stripeSubscriptionId: 'sub_invalid',
        stripePriceId: 'price_invalid',
        planKey: 'enterprise'
      })
      sqlite.pragma('ignore_check_constraints = OFF')

      expect(() => migrateCurrent(sqlite)).toThrow(/Failed to run the query/)
      expect(migrationCount(sqlite)).toBe(2)
      expect(tableColumns(sqlite, 'billing_subscriptions')).not.toContain('cadence')
      expect(triggerCount(sqlite)).toBe(16)
      expect(
        sqlite.prepare("select plan_key from billing_subscriptions where id = 'subscription-invalid'").get()
      ).toEqual({ plan_key: 'enterprise' })

      sqlite.prepare("update billing_subscriptions set plan_key = 'family' where id = 'subscription-invalid'").run()
      migrateCurrent(sqlite)

      expect(migrationCount(sqlite)).toBe(4)
      expect(triggerCount(sqlite)).toBe(30)
      expect(
        sqlite
          .prepare(
            `select plan_key, cadence, reconciliation_required, reconciliation_reason
             from billing_subscriptions where id = 'subscription-invalid'`
          )
          .get()
      ).toEqual({
        plan_key: 'family',
        cadence: null,
        reconciliation_required: 1,
        reconciliation_reason: 'legacy_family_cadence_unknown'
      })
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
    })
  })

  it('enforces offering, transition, join, and cancellation-request invariants', () => {
    withMigratedDatabase('workflow-invariants', (sqlite) => {
      for (const userId of ['subscriber', 'manager', 'recipient', 'missing-offering', 'ambiguous-offering']) {
        insertUser(sqlite, userId)
      }
      const subscriberOrganizationId = personalOrganizationId(sqlite, 'subscriber')
      const managerOrganizationId = personalOrganizationId(sqlite, 'manager')
      const recipientOrganizationId = personalOrganizationId(sqlite, 'recipient')
      const missingOfferingOrganizationId = personalOrganizationId(sqlite, 'missing-offering')
      const ambiguousOfferingOrganizationId = personalOrganizationId(sqlite, 'ambiguous-offering')

      insertCustomer(sqlite, 'manager', managerOrganizationId)
      insertSubscription(sqlite, 'manager', managerOrganizationId, {
        planKey: 'family',
        cadence: 'monthly',
        stripeSubscriptionId: 'sub_manager',
        stripeSubscriptionItemId: 'si_manager',
        stripePriceId: 'price_family_monthly'
      })
      insertCustomer(sqlite, 'subscriber', subscriberOrganizationId)
      insertSubscription(sqlite, 'subscriber', subscriberOrganizationId, {
        planKey: 'personal',
        cadence: 'monthly',
        stripeSubscriptionId: 'sub_subscriber',
        stripeSubscriptionItemId: 'si_subscriber',
        stripePriceId: 'price_personal_monthly'
      })
      insertCustomer(sqlite, 'missing-offering', missingOfferingOrganizationId)
      expect(() =>
        sqlite
          .prepare(
            `insert into billing_subscriptions (
              id, organization_id, billing_customer_id, stripe_subscription_id, status
            ) values (
              'subscription-missing-offering', ?, 'customer-missing-offering',
              'sub_missing_offering', 'active'
            )`
          )
          .run(missingOfferingOrganizationId)
      ).toThrow(/live billing requires a recognized offering or reconciliation/)
      sqlite
        .prepare(
          `insert into billing_subscriptions (
            id, organization_id, billing_customer_id, stripe_subscription_id, status,
            reconciliation_required, reconciliation_reason
          ) values (
            'subscription-missing-offering', ?, 'customer-missing-offering',
            'sub_missing_offering', 'active', 1, 'missing_recognized_offering'
          )`
        )
        .run(missingOfferingOrganizationId)

      insertCustomer(sqlite, 'ambiguous-offering', ambiguousOfferingOrganizationId)
      expect(() =>
        sqlite
          .prepare(
            `insert into billing_subscriptions (
              id, organization_id, billing_customer_id, stripe_subscription_id,
              stripe_subscription_item_id, status, plan_key, cadence, stripe_price_id
            ) values (
              'subscription-ambiguous-offering', ?, 'customer-ambiguous-offering',
              'sub_ambiguous_offering', 'si_ambiguous_offering', 'ambiguous',
              'personal', 'monthly', 'price_personal_monthly'
            )`
          )
          .run(ambiguousOfferingOrganizationId)
      ).toThrow(/live billing requires a recognized offering or reconciliation/)

      expect(() =>
        sqlite
          .prepare(
            `update billing_subscriptions
             set cadence = null, reconciliation_required = 1, reconciliation_reason = 'missing_cadence'
             where id = 'subscription-subscriber'`
          )
          .run()
      ).toThrow(/CHECK constraint failed/)
      expect(() =>
        sqlite
          .prepare(
            `update billing_subscriptions
             set grace_invoice_id = 'in_partial_grace'
             where id = 'subscription-subscriber'`
          )
          .run()
      ).toThrow(/CHECK constraint failed/)

      expect(() => insertCheckout(sqlite, 'invalid-family-weekly', managerOrganizationId, 'family', 'weekly')).toThrow(
        /CHECK constraint failed/
      )
      expect(() => insertCheckout(sqlite, 'missing-cadence', managerOrganizationId, 'family', null)).toThrow(
        /open billing checkout requires a recognized cadence/
      )
      expect(() =>
        sqlite
          .prepare(
            `insert into billing_checkout_attempts (
              id, organization_id, plan_key, cadence, stripe_price_id, idempotency_key, state,
              success_url, cancel_url, reuse_until, created_at, updated_at
            ) values (
              'checkout-invalid-terminal-offering', ?, 'enterprise', null, 'price_invalid',
              'checkout-idempotency-invalid-terminal-offering', 'expired',
              'https://app.example.test/success', 'https://app.example.test/cancel',
              '2026-07-29T00:00:00.000Z', '2026-07-28T00:00:00.000Z',
              '2026-07-28T00:00:00.000Z'
            )`
          )
          .run(managerOrganizationId)
      ).toThrow(/CHECK constraint failed/)
      insertCheckout(sqlite, 'valid-personal-weekly', managerOrganizationId, 'personal', 'weekly')
      sqlite
        .prepare("update billing_checkout_attempts set state = 'expired' where id = 'checkout-valid-personal-weekly'")
        .run()

      insertTransition(sqlite, 'first-transition', subscriberOrganizationId, {
        kind: 'cadence_change',
        sourcePlan: 'personal',
        sourceCadence: 'monthly',
        targetPlan: 'personal',
        targetCadence: 'annual',
        effectiveAt: '2026-08-28T00:00:00.000Z'
      })
      expect(() =>
        insertTransition(sqlite, 'second-open-transition', subscriberOrganizationId, {
          kind: 'personal_to_family',
          sourcePlan: 'personal',
          sourceCadence: 'monthly',
          targetPlan: 'family',
          targetCadence: 'monthly',
          effectiveAt: null
        })
      ).toThrow(/UNIQUE constraint failed/)
      sqlite
        .prepare("update billing_subscription_transitions set state = 'applied' where id = 'first-transition'")
        .run()
      expect(() =>
        insertTransition(sqlite, 'invalid-family-weekly', subscriberOrganizationId, {
          kind: 'personal_to_family',
          sourcePlan: 'personal',
          sourceCadence: 'monthly',
          targetPlan: 'family',
          targetCadence: 'weekly',
          effectiveAt: null
        })
      ).toThrow(/CHECK constraint failed/)
      expect(() =>
        insertTransition(sqlite, 'stale-captured-revision', subscriberOrganizationId, {
          kind: 'personal_to_family',
          sourcePlan: 'personal',
          sourceCadence: 'monthly',
          targetPlan: 'family',
          targetCadence: 'annual',
          effectiveAt: null,
          capturedRevision: 99
        })
      ).toThrow(/billing transition must match the captured subscription revision/)

      insertCustomer(sqlite, 'recipient', recipientOrganizationId)
      insertSubscription(sqlite, 'recipient', recipientOrganizationId, {
        planKey: 'personal',
        cadence: 'annual',
        stripeSubscriptionId: 'sub_recipient',
        stripeSubscriptionItemId: 'si_recipient',
        stripePriceId: 'price_personal_annual',
        cancelAtPeriodEnd: 1,
        currentPeriodEnd: '2027-07-28T00:00:00.000Z'
      })
      insertInvitation(sqlite, 'join-recipient', managerOrganizationId, 'recipient@example.test', 'manager')
      expect(() =>
        insertJoinAttempt(sqlite, 'join-missing-paid-through', {
          recipientUserId: 'recipient',
          personalOrganizationId: recipientOrganizationId,
          targetOrganizationId: managerOrganizationId,
          invitationId: 'invitation-join-recipient',
          state: 'renewal_off_confirmed',
          paidThrough: null
        })
      ).toThrow(/CHECK constraint failed/)
      insertJoinAttempt(sqlite, 'join-recipient', {
        recipientUserId: 'recipient',
        personalOrganizationId: recipientOrganizationId,
        targetOrganizationId: managerOrganizationId,
        invitationId: 'invitation-join-recipient',
        state: 'membership_pending',
        paidThrough: '2027-07-28T00:00:00.000Z'
      })
      for (const [column, value] of [
        ['billing_customer_id', 'customer-subscriber'],
        ['stripe_subscription_id', 'sub_recipient_replaced'],
        ['stripe_subscription_item_id', 'si_recipient_replaced'],
        ['stripe_price_id', 'price_personal_annual_replaced']
      ] as const) {
        expect(() =>
          sqlite
            .prepare(`update billing_subscriptions set ${column} = ? where id = 'subscription-recipient'`)
            .run(value)
        ).toThrow(/open family join attempt requires immutable Stripe subscription correlation/)
      }
      expect(() =>
        sqlite
          .prepare(
            `update billing_customers
             set stripe_customer_id = 'cus_recipient_replaced'
             where id = 'customer-recipient'`
          )
          .run()
      ).toThrow(/open family join attempt requires immutable Stripe customer correlation/)
      insertExternalMember(sqlite, 'recipient', managerOrganizationId)
      sqlite
        .prepare(
          `update family_join_attempts
           set state = 'completed', accepted_member_id = ?
           where id = 'join-recipient'`
        )
        .run(`member-${managerOrganizationId}-recipient`)
      sqlite
        .prepare("delete from member where organization_id = ? and user_id = 'recipient'")
        .run(managerOrganizationId)
      expect(
        sqlite
          .prepare(
            `select accepted_member_id, personal_paid_through
             from family_join_attempts where id = 'join-recipient'`
          )
          .get()
      ).toEqual({ accepted_member_id: null, personal_paid_through: '2027-07-28T00:00:00.000Z' })

      expect(() =>
        sqlite
          .prepare(
            `insert into billing_account_deletion_requests (
              id, user_id, organization_id, billing_subscription_id, billing_customer_id,
              expected_stripe_subscription_id, expected_stripe_customer_id, captured_billing_revision
            ) values (
              'deletion-missing-subscription-reference', 'subscriber', ?, 'subscription-subscriber',
              'customer-subscriber', null, 'cus_subscriber', 0
            )`
          )
          .run(subscriberOrganizationId)
      ).toThrow(/billing deletion request must match the captured owner and Stripe projection|CHECK constraint failed/)
      expect(() =>
        sqlite
          .prepare(
            `insert into billing_account_deletion_requests (
              id, user_id, organization_id, billing_subscription_id, billing_customer_id,
              expected_stripe_subscription_id, expected_stripe_customer_id, captured_billing_revision,
              state
            ) values (
              'deletion-missing-reconciliation-reason', 'subscriber', ?, 'subscription-subscriber',
              'customer-subscriber', 'sub_subscriber', 'cus_subscriber', 0,
              'reconciliation_required'
            )`
          )
          .run(subscriberOrganizationId)
      ).toThrow(/CHECK constraint failed/)
      insertDeletionRequest(sqlite, 'deletion-subscriber', 'subscriber', subscriberOrganizationId)
      expect(() =>
        insertDeletionRequest(sqlite, 'deletion-subscriber-duplicate', 'subscriber', subscriberOrganizationId)
      ).toThrow(/UNIQUE constraint failed/)
      expect(() =>
        sqlite
          .prepare(
            `update billing_account_deletion_requests
             set state = 'reconciliation_required', reason = ?
             where id = 'deletion-subscriber'`
          )
          .run('x'.repeat(129))
      ).toThrow(/CHECK constraint failed/)

      sqlite.prepare("delete from billing_subscriptions where id = 'subscription-subscriber'").run()
      expect(
        sqlite
          .prepare(
            `select billing_subscription_id, expected_stripe_subscription_id, state, reason
             from billing_account_deletion_requests where id = 'deletion-subscriber'`
          )
          .get()
      ).toEqual({
        billing_subscription_id: null,
        expected_stripe_subscription_id: null,
        state: 'reconciliation_required',
        reason: 'subscription_projection_removed'
      })
      sqlite.prepare('delete from organization where id = ?').run(subscriberOrganizationId)
      expect(
        sqlite
          .prepare('select count(*) as count from billing_account_deletion_requests where id = ?')
          .get('deletion-subscriber')
      ).toEqual({ count: 0 })
    })
  })

  it('enforces accepted plus pending capacity through the shared database', () => {
    withMigratedDatabase('cross-process-capacity', (sqlite, databasePath) => {
      for (const userId of [
        'capacity-manager',
        'accepted-1',
        'accepted-2',
        'accepted-3',
        'accepted-4',
        'reserved',
        'second-manager',
        'second-accepted-1',
        'second-accepted-2',
        'second-accepted-3',
        'second-accepted-4',
        'second-reserved'
      ]) {
        insertUser(sqlite, userId)
      }
      const organizationId = personalOrganizationId(sqlite, 'capacity-manager')
      insertCustomer(sqlite, 'capacity-manager', organizationId)
      insertSubscription(sqlite, 'capacity-manager', organizationId, {
        planKey: 'family',
        cadence: 'monthly',
        stripeSubscriptionId: 'sub_capacity_manager',
        stripeSubscriptionItemId: 'si_capacity_manager',
        stripePriceId: 'price_family_monthly'
      })
      for (const userId of ['accepted-1', 'accepted-2', 'accepted-3', 'accepted-4']) {
        insertExternalMember(sqlite, userId, organizationId)
      }
      insertInvitation(sqlite, 'reserved', organizationId, 'reserved@example.test', 'capacity-manager')

      const secondProcess = new Database(databasePath)
      secondProcess.pragma('foreign_keys = ON')
      try {
        expect(() =>
          insertInvitation(secondProcess, 'blocked', organizationId, 'blocked@example.test', 'capacity-manager')
        ).toThrow(/family plan accepts at most six members/)
      } finally {
        secondProcess.close()
      }

      insertExternalMember(sqlite, 'reserved', organizationId)
      sqlite.prepare("update invitation set status = 'accepted' where id = 'invitation-reserved'").run()
      expect(
        sqlite.prepare('select count(*) as count from member where organization_id = ?').get(organizationId)
      ).toEqual({ count: 6 })
      expect(
        sqlite
          .prepare(
            `select count(*) as count from invitation
             where organization_id = ? and status = 'pending' and expires_at > ?`
          )
          .get(organizationId, Date.now())
      ).toEqual({ count: 0 })

      insertInvitation(
        sqlite,
        'expired-at-capacity',
        organizationId,
        'expired-at-capacity@example.test',
        'capacity-manager',
        Date.now() - 1
      )

      const secondOrganizationId = personalOrganizationId(sqlite, 'second-manager')
      insertCustomer(sqlite, 'second-manager', secondOrganizationId)
      insertSubscription(sqlite, 'second-manager', secondOrganizationId, {
        planKey: 'family',
        cadence: 'annual',
        stripeSubscriptionId: 'sub_second_manager',
        stripeSubscriptionItemId: 'si_second_manager',
        stripePriceId: 'price_family_annual'
      })
      for (const userId of ['second-accepted-1', 'second-accepted-2', 'second-accepted-3', 'second-accepted-4']) {
        insertExternalMember(sqlite, userId, secondOrganizationId)
      }
      insertInvitation(
        sqlite,
        'second-expired',
        secondOrganizationId,
        'second-expired@example.test',
        'second-manager',
        Date.now() - 1
      )
      insertInvitation(
        sqlite,
        'second-reserved',
        secondOrganizationId,
        'second-reserved@example.test',
        'second-manager'
      )
      sqlite.prepare("update invitation set status = 'accepted' where id = 'invitation-second-reserved'").run()
      insertExternalMember(sqlite, 'second-reserved', secondOrganizationId)
      expect(
        sqlite.prepare('select count(*) as count from member where organization_id = ?').get(secondOrganizationId)
      ).toEqual({ count: 6 })
    })
  })
})

function withMigratedDatabase(name: string, run: (sqlite: Sqlite, databasePath: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), `swl-billing-migration-${name}-`))
  const databasePath = join(directory, 'app.db')
  const sqlite = openDatabase(databasePath)

  try {
    migrateCurrent(sqlite)
    run(sqlite, databasePath)
  } finally {
    sqlite.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

function withPredecessorDatabase(name: string, run: (sqlite: Sqlite) => void) {
  const directory = mkdtempSync(join(tmpdir(), `swl-billing-upgrade-${name}-`))
  const databasePath = join(directory, 'app.db')
  const predecessorFolder = createPredecessorMigrationFolder(directory)
  const sqlite = openDatabase(databasePath)

  try {
    migrate(drizzle({ client: sqlite }), { migrationsFolder: predecessorFolder })
    expect(migrationCount(sqlite)).toBe(2)
    run(sqlite)
  } finally {
    sqlite.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

function createPredecessorMigrationFolder(parent: string): string {
  const folder = join(parent, 'predecessor-migrations')
  const metaFolder = join(folder, 'meta')
  mkdirSync(metaFolder, { recursive: true })

  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as {
    version: string
    dialect: string
    entries: Array<{ tag: string }>
  }
  writeFileSync(
    join(metaFolder, '_journal.json'),
    `${JSON.stringify({ ...journal, entries: journal.entries.slice(0, predecessorTags.length) }, null, 2)}\n`
  )
  for (const tag of predecessorTags) {
    copyFileSync(join(migrationsFolder, `${tag}.sql`), join(folder, `${tag}.sql`))
  }
  return folder
}

function openDatabase(path: string): Sqlite {
  const sqlite = new Database(path)
  sqlite.pragma('foreign_keys = ON')
  return sqlite
}

function migrateCurrent(sqlite: Sqlite) {
  migrate(drizzle({ client: sqlite }), { migrationsFolder })
}

function tableColumns(sqlite: Sqlite, table: string): string[] {
  return (sqlite.prepare(`pragma table_info('${table}')`).all() as Array<{ name: string }>).map(({ name }) => name)
}

function migrationCount(sqlite: Sqlite): number {
  return (sqlite.prepare('select count(*) as count from __drizzle_migrations').get() as { count: number }).count
}

function migrationLedger(sqlite: Sqlite) {
  return sqlite.prepare('select hash, created_at from __drizzle_migrations order by created_at, id').all()
}

function triggerCount(sqlite: Sqlite): number {
  return (
    sqlite.prepare("select count(*) as count from sqlite_master where type = 'trigger'").get() as { count: number }
  ).count
}

function insertUser(sqlite: Sqlite, userId: string) {
  sqlite
    .prepare('insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, 1, 1)')
    .run(userId, userId, `${userId}@example.test`)
}

function personalOrganizationId(sqlite: Sqlite, userId: string): string {
  return (sqlite.prepare('select id from organization where personal_owner_user_id = ?').get(userId) as { id: string })
    .id
}

function insertLegacyCustomer(sqlite: Sqlite, suffix: string, organizationId: string) {
  sqlite
    .prepare('insert into billing_customers (id, organization_id, stripe_customer_id) values (?, ?, ?)')
    .run(`customer-${suffix}`, organizationId, `cus_${suffix}`)
}

function insertLegacyCheckout(sqlite: Sqlite, suffix: string, organizationId: string, state: string) {
  sqlite
    .prepare(
      `insert into billing_checkout_attempts (
        id, organization_id, billing_customer_id, plan_key, stripe_price_id, stripe_session_id,
        idempotency_key, state, success_url, cancel_url, reuse_until, created_at, updated_at
      ) values (?, ?, ?, 'family', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      `checkout-${suffix}`,
      organizationId,
      `customer-${suffix}`,
      `price_${suffix}`,
      `cs_${suffix}`,
      `checkout-idempotency-${suffix}`,
      state,
      'https://app.example.test/success',
      'https://app.example.test/cancel',
      '2026-07-29T00:00:00.000Z',
      '2026-07-28T00:00:00.000Z',
      '2026-07-28T00:00:00.000Z'
    )
}

function insertLegacySubscription(
  sqlite: Sqlite,
  suffix: string,
  organizationId: string,
  input: {
    status: string
    stripeSubscriptionId: string
    stripePriceId: string
    planKey?: string
  }
) {
  sqlite
    .prepare(
      `insert into billing_subscriptions (
        id, organization_id, billing_customer_id, stripe_subscription_id, status, plan_key,
        stripe_price_id, current_period_start, current_period_end, cancel_at_period_end,
        projection_order_ms, projection_event_id, reconciliation_required, reconciliation_reason,
        created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1000, ?, 0, null, ?, ?)`
    )
    .run(
      `subscription-${suffix}`,
      organizationId,
      `customer-${suffix}`,
      input.stripeSubscriptionId,
      input.status,
      input.planKey ?? 'family',
      input.stripePriceId,
      '2026-07-01T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z',
      `evt_${suffix}`,
      '2026-07-28T00:00:00.000Z',
      '2026-07-28T00:00:00.000Z'
    )
}

function insertCustomer(sqlite: Sqlite, suffix: string, organizationId: string) {
  insertLegacyCustomer(sqlite, suffix, organizationId)
}

function insertSubscription(
  sqlite: Sqlite,
  suffix: string,
  organizationId: string,
  input: {
    planKey: 'personal' | 'family'
    cadence: 'weekly' | 'monthly' | 'annual'
    stripeSubscriptionId: string
    stripeSubscriptionItemId: string
    stripePriceId: string
    cancelAtPeriodEnd?: number
    currentPeriodEnd?: string
  }
) {
  sqlite
    .prepare(
      `insert into billing_subscriptions (
        id, organization_id, billing_customer_id, stripe_subscription_id,
        stripe_subscription_item_id, status, plan_key, cadence, stripe_price_id,
        current_period_start, current_period_end, cancel_at_period_end, last_verified_at
      ) values (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      `subscription-${suffix}`,
      organizationId,
      `customer-${suffix}`,
      input.stripeSubscriptionId,
      input.stripeSubscriptionItemId,
      input.planKey,
      input.cadence,
      input.stripePriceId,
      '2026-07-28T00:00:00.000Z',
      input.currentPeriodEnd ?? '2026-08-28T00:00:00.000Z',
      input.cancelAtPeriodEnd ?? 0,
      '2026-07-28T00:00:00.000Z'
    )
}

function insertCheckout(sqlite: Sqlite, suffix: string, organizationId: string, plan: string, cadence: string | null) {
  sqlite
    .prepare(
      `insert into billing_checkout_attempts (
        id, organization_id, plan_key, cadence, stripe_price_id, idempotency_key, state,
        success_url, cancel_url, reuse_until, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
    )
    .run(
      `checkout-${suffix}`,
      organizationId,
      plan,
      cadence,
      `price-${suffix}`,
      `checkout-idempotency-${suffix}`,
      'https://app.example.test/success',
      'https://app.example.test/cancel',
      '2026-07-29T00:00:00.000Z',
      '2026-07-28T00:00:00.000Z',
      '2026-07-28T00:00:00.000Z'
    )
}

function insertTransition(
  sqlite: Sqlite,
  suffix: string,
  organizationId: string,
  input: {
    kind: string
    sourcePlan: string
    sourceCadence: string
    targetPlan: string
    targetCadence: string
    effectiveAt: string | null
    capturedRevision?: number
  }
) {
  sqlite
    .prepare(
      `insert into billing_subscription_transitions (
        id, organization_id, billing_subscription_id, kind, source_plan_key, source_cadence,
        target_plan_key, target_cadence, effective_at, idempotency_key, captured_billing_revision
      ) values (?, ?, 'subscription-subscriber', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      `transition-${suffix}`,
      organizationId,
      input.kind,
      input.sourcePlan,
      input.sourceCadence,
      input.targetPlan,
      input.targetCadence,
      input.effectiveAt,
      `transition-idempotency-${suffix}`,
      input.capturedRevision ?? 0
    )
}

function insertInvitation(
  sqlite: Sqlite,
  suffix: string,
  organizationId: string,
  email: string,
  inviterId: string,
  expiresAt = Date.now() + 86_400_000
) {
  sqlite
    .prepare(
      `insert into invitation (
        id, organization_id, email, role, status, expires_at, created_at, inviter_id
      ) values (?, ?, ?, 'member', 'pending', ?, ?, ?)`
    )
    .run(`invitation-${suffix}`, organizationId, email, expiresAt, Date.now(), inviterId)
}

function insertJoinAttempt(
  sqlite: Sqlite,
  suffix: string,
  input: {
    recipientUserId: string
    personalOrganizationId: string
    targetOrganizationId: string
    invitationId: string
    state: string
    paidThrough: string | null
  }
) {
  sqlite
    .prepare(
      `insert into family_join_attempts (
        id, recipient_user_id, personal_organization_id, personal_billing_subscription_id,
        captured_personal_billing_revision, target_organization_id, invitation_id,
        stripe_cancellation_idempotency_key, personal_paid_through, state
      ) values (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
    )
    .run(
      suffix,
      input.recipientUserId,
      input.personalOrganizationId,
      `subscription-${input.recipientUserId}`,
      input.targetOrganizationId,
      input.invitationId,
      `join-idempotency-${suffix}`,
      input.paidThrough,
      input.state
    )
}

function insertExternalMember(sqlite: Sqlite, userId: string, organizationId: string) {
  sqlite
    .prepare("insert into member (id, organization_id, user_id, role, created_at) values (?, ?, ?, 'member', ?)")
    .run(`member-${organizationId}-${userId}`, organizationId, userId, Date.now())
}

function insertDeletionRequest(sqlite: Sqlite, id: string, userId: string, organizationId: string) {
  sqlite
    .prepare(
      `insert into billing_account_deletion_requests (
        id, user_id, organization_id, billing_subscription_id, billing_customer_id,
        expected_stripe_subscription_id, expected_stripe_customer_id, captured_billing_revision
      ) values (?, ?, ?, ?, ?, ?, ?, 0)`
    )
    .run(id, userId, organizationId, `subscription-${userId}`, `customer-${userId}`, `sub_${userId}`, `cus_${userId}`)
}
