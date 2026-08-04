import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
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
  cancelAtPeriodEnd?: number
  reconciliationRequired?: number
  reconciliationReason?: string | null
}

describe('database behavior contracts', () => {
  it('rejects rows that violate durable data-integrity constraints', () => {
    withMigratedDatabase('row-constraints', (sqlite) => {
      insertUser(sqlite, 'constraint-owner')
      const organizationId = personalOrganizationId(sqlite, 'constraint-owner')
      insertBillingCustomer(sqlite, 'constraint-owner', organizationId)

      const invalidRows: Array<[string, () => unknown]> = [
        [
          'detached billing subject whose purge date precedes deletion',
          () =>
            sqlite
              .prepare(
                `insert into detached_billing_subjects
                  (id, provider, provider_reference, provider_status, status_updated_at, deleted_at,
                   retention_purpose, retention_policy, purge_after) values (
                  'detached-invalid-purge', 'stripe', 'sub_invalid_purge', 'active', '2026-07-02',
                  '2026-07-02', 'external_billing_reconciliation', 'stripe_subscription_lifecycle',
                  '2026-07-01')`
              )
              .run()
        ],
        [
          'checkout attempt with an unsupported plan',
          () =>
            insertCheckoutAttempt(sqlite, 'attempt-invalid-plan', organizationId, 'expired', { planKey: 'enterprise' })
        ],
        [
          'checkout attempt whose reuse window precedes creation',
          () =>
            insertCheckoutAttempt(sqlite, 'attempt-invalid-window', organizationId, 'expired', {
              createdAt: '2026-07-14T01:00:00.000Z',
              reuseUntil: '2026-07-14T00:00:00.000Z'
            })
        ],
        [
          'subscription requiring reconciliation without a reason',
          () =>
            insertBillingSubscription(sqlite, 'constraint-owner', organizationId, {
              status: 'active',
              reconciliationRequired: 1,
              reconciliationReason: null
            })
        ],
        [
          'none subscription retaining provider identity',
          () =>
            insertBillingSubscription(sqlite, 'constraint-owner', organizationId, {
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

  it('enforces reciprocal family boundaries after accepted membership', () => {
    withMigratedDatabase('member-first', (sqlite) => {
      for (const userId of ['manager-a', 'manager-b', 'covered', 'late-guest', 'movable-guest']) {
        insertUser(sqlite, userId)
      }

      const managerAOrganizationId = personalOrganizationId(sqlite, 'manager-a')
      const managerBOrganizationId = personalOrganizationId(sqlite, 'manager-b')
      const coveredOrganizationId = personalOrganizationId(sqlite, 'covered')
      const now = Date.now()
      insertExternalMember(sqlite, 'covered', managerAOrganizationId)

      expect(() => insertExternalMember(sqlite, 'late-guest', coveredOrganizationId), 'member insert trigger').toThrow(
        /external family membership conflicts with personal family authority/
      )
      insertExternalMember(sqlite, 'movable-guest', managerBOrganizationId)
      expect(
        () =>
          sqlite
            .prepare('update member set organization_id = ? where user_id = ? and role = ?')
            .run(coveredOrganizationId, 'movable-guest', 'member'),
        'member update trigger'
      ).toThrow(/external family membership conflicts with personal family authority/)

      expect(
        () => insertInvitation(sqlite, 'covered', coveredOrganizationId, 'future', now + 86_400_000),
        'invitation insert trigger'
      ).toThrow(/covered family member cannot create outgoing invitations/)
      insertInvitation(sqlite, 'covered', coveredOrganizationId, 'expired', now - 86_400_000)
      expect(
        () =>
          sqlite
            .prepare('update invitation set expires_at = ? where id = ?')
            .run(now + 86_400_000, 'invitation-expired'),
        'invitation update trigger'
      ).toThrow(/covered family member cannot create outgoing invitations/)

      expect(
        () => insertCheckoutAttempt(sqlite, 'attempt-covered-pending', coveredOrganizationId, 'pending'),
        'checkout insert trigger'
      ).toThrow(/covered family member cannot reserve personal billing checkout/)
      insertCheckoutAttempt(sqlite, 'attempt-covered-expired', coveredOrganizationId, 'expired')
      expect(
        () =>
          sqlite
            .prepare("update billing_checkout_attempts set state = 'pending' where id = ?")
            .run('attempt-covered-expired'),
        'checkout update trigger'
      ).toThrow(/covered family member cannot reserve personal billing checkout/)
      sqlite
        .prepare("update billing_checkout_attempts set state = 'reconciliation_required' where id = ?")
        .run('attempt-covered-expired')

      insertBillingCustomer(sqlite, 'covered', coveredOrganizationId)
      expect(
        () =>
          insertBillingSubscription(sqlite, 'covered', coveredOrganizationId, {
            stripeSubscriptionId: 'sub_covered',
            status: 'active'
          }),
        'subscription insert trigger'
      ).toThrow(/covered family member personal billing requires conflict reconciliation/)
      insertBillingSubscription(sqlite, 'covered', coveredOrganizationId, {
        stripeSubscriptionId: 'sub_covered',
        status: 'active',
        reconciliationRequired: 1,
        reconciliationReason: 'family_authority_conflict'
      })
      sqlite
        .prepare(
          `update billing_subscriptions
           set status = 'canceled', reconciliation_required = 0, reconciliation_reason = null
           where id = 'subscription-covered'`
        )
        .run()
      expect(
        () =>
          sqlite.prepare("update billing_subscriptions set status = 'active' where id = 'subscription-covered'").run(),
        'subscription update trigger'
      ).toThrow(/covered family member personal billing requires conflict reconciliation/)

      for (let index = 1; index <= 5; index += 1) {
        const userId = `capacity-member-${index}`
        insertUser(sqlite, userId)
        const addMember = () => insertExternalMember(sqlite, userId, managerAOrganizationId)
        if (index <= 4) addMember()
        else expect(addMember, 'member capacity trigger').toThrow(/family plan accepts at most six members/)
      }
    })
  })

  it('rejects family admission after personal authority is reserved', () => {
    withMigratedDatabase('authority-first', (sqlite) => {
      for (const userId of [
        'manager',
        'active',
        'canceling',
        'reconciling',
        'checkout',
        'inviter',
        'family-owner',
        'guest',
        'terminal'
      ]) {
        insertUser(sqlite, userId)
      }
      const managerOrganizationId = personalOrganizationId(sqlite, 'manager')

      seedSubscription(sqlite, 'active', { status: 'active' })
      seedSubscription(sqlite, 'canceling', { status: 'canceled', cancelAtPeriodEnd: 1 })
      seedSubscription(sqlite, 'reconciling', {
        status: 'canceled',
        reconciliationRequired: 1,
        reconciliationReason: 'manual_review'
      })
      insertCheckoutAttempt(sqlite, 'attempt-checkout', personalOrganizationId(sqlite, 'checkout'), 'pending')
      insertInvitation(sqlite, 'inviter', personalOrganizationId(sqlite, 'inviter'), 'future')
      insertExternalMember(sqlite, 'guest', personalOrganizationId(sqlite, 'family-owner'))
      seedSubscription(sqlite, 'terminal', { status: 'canceled' })
      insertCheckoutAttempt(sqlite, 'attempt-terminal', personalOrganizationId(sqlite, 'terminal'), 'expired')

      for (const userId of ['active', 'canceling', 'reconciling', 'checkout', 'inviter', 'family-owner']) {
        expect(() => insertExternalMember(sqlite, userId, managerOrganizationId), userId).toThrow(
          /external family membership conflicts with personal family authority/
        )
      }

      insertExternalMember(sqlite, 'terminal', managerOrganizationId)
      expect(
        sqlite.prepare("select count(*) as count from member where user_id = 'terminal' and role = 'member'").get()
      ).toEqual({ count: 1 })
    })
  })
})

function withMigratedDatabase(name: string, run: (sqlite: Sqlite) => void) {
  const directory = mkdtempSync(join(tmpdir(), `swl-database-behavior-${name}-`))
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

function insertUser(sqlite: Sqlite, userId: string) {
  sqlite
    .prepare('insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, 1, 1)')
    .run(userId, userId, `${userId}@example.test`)
}

function personalOrganizationId(sqlite: Sqlite, userId: string) {
  return (sqlite.prepare('select id from organization where personal_owner_user_id = ?').get(userId) as { id: string })
    .id
}

function insertBillingCustomer(sqlite: Sqlite, userId: string, organizationId: string) {
  sqlite
    .prepare('insert into billing_customers (id, organization_id, stripe_customer_id) values (?, ?, ?)')
    .run(`customer-${userId}`, organizationId, `cus_${userId}`)
}

function insertCheckoutAttempt(
  sqlite: Sqlite,
  id: string,
  organizationId: string,
  state: 'pending' | 'expired',
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
        id, organization_id, plan_key, cadence, stripe_price_id, idempotency_key, state,
        success_url, cancel_url, reuse_until, created_at, updated_at
      ) values (?, ?, ?, 'monthly', 'price_family', ?, ?, 'https://app.test/success',
        'https://app.test/cancel', ?, ?, ?)`
    )
    .run(
      id,
      organizationId,
      input.planKey ?? 'family',
      `idempotency-${id}`,
      state,
      input.reuseUntil ?? '2026-07-14T23:00:00.000Z',
      createdAt,
      createdAt
    )
}

function insertBillingSubscription(sqlite: Sqlite, userId: string, organizationId: string, input: SubscriptionInput) {
  sqlite
    .prepare(
      `insert into billing_subscriptions (
        id, organization_id, billing_customer_id, stripe_subscription_id, status,
        plan_key, cadence, cancel_at_period_end, reconciliation_required, reconciliation_reason
      ) values (?, ?, ?, ?, ?, 'family', 'monthly', ?, ?, ?)`
    )
    .run(
      `subscription-${userId}`,
      organizationId,
      `customer-${userId}`,
      input.stripeSubscriptionId ?? null,
      input.status,
      input.cancelAtPeriodEnd ?? 0,
      input.reconciliationRequired ?? 0,
      input.reconciliationReason ?? null
    )
}

function seedSubscription(sqlite: Sqlite, userId: string, input: SubscriptionInput) {
  const organizationId = personalOrganizationId(sqlite, userId)
  insertBillingCustomer(sqlite, userId, organizationId)
  insertBillingSubscription(sqlite, userId, organizationId, {
    stripeSubscriptionId: input.status === 'canceled' ? null : `sub_${userId}`,
    ...input
  })
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

function insertExternalMember(sqlite: Sqlite, userId: string, organizationId: string) {
  sqlite
    .prepare("insert into member (id, organization_id, user_id, role, created_at) values (?, ?, ?, 'member', 1)")
    .run(`member-${organizationId}-${userId}`, organizationId, userId)
}

function insertInvitation(
  sqlite: Sqlite,
  inviterId: string,
  organizationId: string,
  suffix: string,
  expiresAt = Date.now() + 86_400_000
) {
  sqlite
    .prepare(
      `insert into invitation (id, organization_id, email, role, status, expires_at, created_at, inviter_id)
       values (?, ?, ?, 'member', 'pending', ?, ?, ?)`
    )
    .run(`invitation-${suffix}`, organizationId, `${suffix}@example.test`, expiresAt, Date.now(), inviterId)
}
