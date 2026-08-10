import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
const canonicalMd5 = '1B2M2Y8AsgTpgAmY7PhCfg=='
type Sqlite = InstanceType<typeof Database>
type SubscriptionInput = {
  status: string
  stripeSubscriptionId?: string | null
  reconciliationRequired?: number
  reconciliationReason?: string | null
}

describe('database behavior contracts', () => {
  it('rejects rows that violate durable data-integrity constraints', () => {
    withMigratedDatabase('row-constraints', (sqlite) => {
      insertUser(sqlite, 'constraint-owner')
      insertBillingCustomer(sqlite, 'constraint-owner')

      const invalidRows: Array<[string, () => unknown]> = [
        [
          'user with an unsupported operator role',
          () => sqlite.prepare("update user set role = 'owner' where id = 'constraint-owner'").run()
        ],
        [
          'user with a blank Better Auth compatibility name',
          () => sqlite.prepare("update user set name = '   ' where id = 'constraint-owner'").run()
        ],
        [
          'user with an oversized Better Auth compatibility name',
          () => sqlite.prepare("update user set name = ? where id = 'constraint-owner'").run('x'.repeat(101))
        ],
        [
          'user with a whitespace-only first name',
          () => sqlite.prepare("update user set first_name = ' ' where id = 'constraint-owner'").run()
        ],
        [
          'user with a padded last name',
          () => sqlite.prepare("update user set last_name = ' Padded' where id = 'constraint-owner'").run()
        ],
        [
          'user with an oversized optional display name',
          () => sqlite.prepare("update user set display_name = ? where id = 'constraint-owner'").run('x'.repeat(101))
        ],
        [
          'detached billing subject whose purge date precedes deletion',
          () =>
            sqlite
              .prepare(
                `insert into detached_billing_subjects
                  (id, provider, provider_reference, provider_status, status_updated_at, deleted_at,
                   retention_purpose, retention_policy, purge_after) values (
                  'detached-invalid-purge', 'stripe', 'sub_invalid_purge', 'active', '2026-07-02',
                  '2026-07-02', 'external_billing_reconciliation', 'stripe_billing_lifecycle',
                  '2026-07-01')`
              )
              .run()
        ],
        [
          'checkout attempt with an unsupported plan',
          () => insertCheckoutAttempt(sqlite, 'attempt-invalid-plan', 'constraint-owner', { planKey: 'enterprise' })
        ],
        [
          'checkout attempt whose reuse window precedes creation',
          () =>
            insertCheckoutAttempt(sqlite, 'attempt-invalid-window', 'constraint-owner', {
              createdAt: '2026-07-14T01:00:00.000Z',
              reuseUntil: '2026-07-14T00:00:00.000Z'
            })
        ],
        [
          'subscription requiring reconciliation without a reason',
          () =>
            insertBillingSubscription(sqlite, 'constraint-owner', {
              status: 'active',
              reconciliationRequired: 1,
              reconciliationReason: null
            })
        ],
        [
          'none subscription retaining provider identity',
          () =>
            insertBillingSubscription(sqlite, 'constraint-owner', {
              stripeSubscriptionId: 'sub_should_be_null',
              status: 'none'
            })
        ],
        [
          'billing event with negative provider ordering',
          () =>
            sqlite
              .prepare(
                `insert into billing_events (stripe_event_id, event_type, provider_created_at, processed_at)
                 values ('evt_negative', 'customer.subscription.updated', -1, '2026-07-14')`
              )
              .run()
        ],
        [
          'file with a noncanonical MD5 digest',
          () =>
            insertFile(sqlite, 'file-invalid-md5', 'constraint-owner', {
              contentMd5: 'AAAAAAAAAAAAAAAAAAAAAB=='
            })
        ],
        [
          'file larger than the upload limit',
          () =>
            insertFile(sqlite, 'file-oversized', 'constraint-owner', {
              byteSize: 25 * 1024 * 1024 + 1
            })
        ],
        [
          'deleted file without a deletion timestamp',
          () => insertFile(sqlite, 'file-invalid-deletion-state', 'constraint-owner', { status: 'deleted' })
        ],
        [
          'AI usage bucket with an impossible calendar date',
          () =>
            sqlite
              .prepare(
                `insert into ai_usage_buckets (owner_user_id, bucket_date, request_count, created_at, updated_at)
                 values ('constraint-owner', '2026-02-31', 0, '2026-07-16', '2026-07-16')`
              )
              .run()
        ]
      ]

      for (const [name, insert] of invalidRows) {
        expect(insert, name).toThrow(/CHECK constraint failed/)
      }
    })
  })

  it('preserves existing identities while adding nullable account profile fields', () => {
    const directory = mkdtempSync(join(tmpdir(), 'wcu-database-behavior-profile-upgrade-'))
    const sqlite = new Database(join(directory, 'app.db'))
    sqlite.pragma('foreign_keys = ON')

    try {
      applyMigrationSql(sqlite, '0000_wcu_initial.sql')
      insertUser(sqlite, 'pre-profile-user')
      sqlite
        .prepare(
          `insert into session (id, expires_at, token, created_at, updated_at, user_id)
           values ('pre-profile-session', 2, 'pre-profile-token', 1, 1, 'pre-profile-user')`
        )
        .run()

      applyMigrationSql(sqlite, '0001_wcu_account_profile.sql')

      expect(
        sqlite
          .prepare(
            `select id, name, email, first_name as firstName, last_name as lastName,
                    display_name as displayName from user where id = 'pre-profile-user'`
          )
          .get()
      ).toEqual({
        id: 'pre-profile-user',
        name: 'WCU account',
        email: 'pre-profile-user@example.test',
        firstName: null,
        lastName: null,
        displayName: 'pre-profile-user'
      })
      expect(sqlite.prepare("select user_id as userId from session where id = 'pre-profile-session'").get()).toEqual({
        userId: 'pre-profile-user'
      })
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
    } finally {
      sqlite.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

function withMigratedDatabase(name: string, run: (sqlite: Sqlite) => void) {
  const directory = mkdtempSync(join(tmpdir(), `wcu-database-behavior-${name}-`))
  const sqlite = new Database(join(directory, 'app.db'))
  sqlite.pragma('foreign_keys = ON')
  try {
    migrate(drizzle({ client: sqlite }), { migrationsFolder })
    run(sqlite)
  } finally {
    sqlite.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

function applyMigrationSql(sqlite: Sqlite, filename: string) {
  const migration = readFileSync(join(migrationsFolder, filename), 'utf8')
  for (const statement of migration
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .filter(Boolean)) {
    sqlite.exec(statement)
  }
}

function insertUser(sqlite: Sqlite, userId: string) {
  sqlite
    .prepare('insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, 1, 1)')
    .run(userId, userId, `${userId}@example.test`)
}

function insertBillingCustomer(sqlite: Sqlite, userId: string) {
  sqlite
    .prepare('insert into billing_customers (id, purchaser_user_id, stripe_customer_id) values (?, ?, ?)')
    .run(`customer-${userId}`, userId, `cus_${userId}`)
}

function insertCheckoutAttempt(
  sqlite: Sqlite,
  id: string,
  purchaserUserId: string,
  input: {
    planKey?: string
    createdAt?: string
    reuseUntil?: string
  } = {}
) {
  const createdAt = input.createdAt ?? '2026-07-14T00:00:00.000Z'
  sqlite
    .prepare(
      `insert into billing_checkout_attempts (
        id, purchaser_user_id, plan_key, cadence, stripe_price_id, idempotency_key, state,
        success_url, cancel_url, reuse_until, created_at, updated_at
      ) values (?, ?, ?, 'monthly', 'price_family', ?, 'expired', 'https://app.test/success',
        'https://app.test/cancel', ?, ?, ?)`
    )
    .run(
      id,
      purchaserUserId,
      input.planKey ?? 'family',
      `idempotency-${id}`,
      input.reuseUntil ?? '2026-07-14T23:00:00.000Z',
      createdAt,
      createdAt
    )
}

function insertBillingSubscription(sqlite: Sqlite, userId: string, input: SubscriptionInput) {
  sqlite
    .prepare(
      `insert into billing_subscriptions (
        id, purchaser_user_id, billing_customer_id, stripe_subscription_id, status,
        plan_key, cadence, stripe_price_id, reconciliation_required, reconciliation_reason
      ) values (?, ?, ?, ?, ?, 'family', 'monthly', 'price_family', ?, ?)`
    )
    .run(
      `subscription-${userId}`,
      userId,
      `customer-${userId}`,
      input.stripeSubscriptionId ?? null,
      input.status,
      input.reconciliationRequired ?? 0,
      input.reconciliationReason ?? null
    )
}

function insertFile(
  sqlite: Sqlite,
  id: string,
  ownerId: string,
  input: {
    contentMd5?: string
    byteSize?: number
    status?: 'pending' | 'deleted'
  }
) {
  sqlite
    .prepare(
      `insert into files (
        id, owner_id, bucket, object_key, original_name, content_type, byte_size,
        content_md5, status, upload_expires_at, created_at, updated_at, deleted_at
      ) values (?, ?, 'local', ?, 'upload.txt', 'text/plain', ?, ?, ?, ?, ?, ?, null)`
    )
    .run(
      id,
      ownerId,
      `files/v1/${id}`,
      input.byteSize ?? 6,
      input.contentMd5 ?? canonicalMd5,
      input.status ?? 'pending',
      '2026-07-15T12:15:00.000Z',
      '2026-07-15T12:00:00.000Z',
      '2026-07-15T12:00:00.000Z'
    )
}
