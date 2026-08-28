import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DatabaseConnection } from '../server/db/connect'
import * as schema from '../server/db/schema/index'
import type { StripeMembershipImportReport } from '../server/services/membership/stripe-import'
import {
  acquireStripeMembershipSyncLock,
  assertStripeMembershipSyncBinding,
  assertStripeMembershipSyncKey,
  configureStripeMembershipSyncDatabase,
  recordStripeMembershipSyncCompleted,
  recordStripeMembershipSyncFailed,
  recordStripeMembershipSyncStarted,
  redactedStripeMembershipSyncReceipt,
  stripeMembershipSyncBindingSettingKey,
  stripeMembershipSyncBusyTimeoutMs,
  stripeMembershipSyncIssuesSettingKey,
  stripeMembershipSyncStatusSettingKey,
  type StripeMembershipSyncError
} from '../server/services/membership/stripe-sync-state'

const migrationsFolder = resolve('server/db/migrations')
const cutoff = '2026-08-01T00:00:00.000Z'
const startedAt = '2026-08-22T10:00:00.000Z'
const completedAt = '2026-08-22T10:05:00.000Z'
const validLinkSyncEnvironment = {
  WCU_STRIPE_LEGACY_DUES10_PRICE_IDS: 'membership-10-1month',
  WCU_STRIPE_LEGACY_DUES27_PRICE_IDS: 'solidarity-27-1month',
  WCU_STRIPE_MEMBERSHIP_SYNC_KEY: 'rk_test_private_cli_value',
  WCU_STRIPE_MEMBERSHIP_SYNC_MODE: 'test'
} as const

describe('Stripe membership synchronization state', () => {
  it('keeps the historical importer and account-link synchronizer as separate commands', () => {
    const scripts = (JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { scripts: Record<string, string> })
      .scripts
    expect(scripts['db:import:stripe']).toContain('scripts/import-stripe-membership.ts')
    expect(scripts['db:sync:stripe-membership-links']).toContain('scripts/sync-stripe-membership-links.ts')

    const legacyHelp = runCliHelp('scripts/import-stripe-membership.ts')
    expect(legacyHelp.status).toBe(0)
    expect(legacyHelp.stdout).toContain('--grandfathered-before <ISO>')
    const linkHelp = runCliHelp('scripts/sync-stripe-membership-links.ts')
    expect(linkHelp.status).toBe(0)
    expect(linkHelp.stdout).toContain('exact account membership links')
  })

  it('rejects a restricted key from the wrong Stripe mode', () => {
    expect(() => assertStripeMembershipSyncKey('test', 'rk_test_restricted')).not.toThrow()
    expect(() => assertStripeMembershipSyncKey('live', 'rk_test_restricted')).toThrowError(
      expect.objectContaining<Partial<StripeMembershipSyncError>>({ code: 'configuration_invalid' })
    )
  })

  it('persists only a redacted completion summary and binds the first apply cutoff', () => {
    withMigratedDatabase('completed', (connection) => {
      configureStripeMembershipSyncDatabase(connection)
      expect(connection.sqlite.pragma('busy_timeout', { simple: true })).toBe(stripeMembershipSyncBusyTimeoutMs)

      recordStripeMembershipSyncStarted(connection, { grandfatheredBefore: cutoff, mode: 'test', startedAt })
      recordStripeMembershipSyncCompleted(connection, {
        completedAt,
        grandfatheredBefore: cutoff,
        mode: 'test',
        report: completedReport,
        startedAt
      })

      expect(readSetting(connection, stripeMembershipSyncBindingSettingKey)).toEqual({
        grandfatheredBefore: cutoff,
        mode: 'test',
        version: 1
      })
      const status = readSetting(connection, stripeMembershipSyncStatusSettingKey)
      expect(status).toEqual({
        completedAt,
        grandfatheredBefore: cutoff,
        importBatchId: 'import_stripe_test',
        issueCodes: { ambiguous_verified_email: 1 },
        issueCount: 1,
        lastCompletedAt: completedAt,
        mode: 'test',
        startedAt,
        status: 'completed',
        version: 1
      })
      expect(JSON.stringify(status)).not.toContain('cus_private')
      expect(JSON.stringify(redactedStripeMembershipSyncReceipt(completedReport))).not.toContain('cus_private')
      expect(readSetting(connection, stripeMembershipSyncIssuesSettingKey)).toEqual({
        importBatchId: 'import_stripe_test',
        issues: [{ code: 'ambiguous_verified_email', externalId: 'cus_private', objectType: 'stripe.customer' }],
        recordedAt: completedAt,
        version: 1
      })
    })
  })

  it('records a bounded failure code and freezes the first apply binding before provider work', () => {
    withMigratedDatabase('failed', (connection) => {
      recordStripeMembershipSyncStarted(connection, { grandfatheredBefore: cutoff, mode: 'test', startedAt })
      recordStripeMembershipSyncFailed(connection, {
        completedAt,
        failureCode: 'stripe_fetch_failed',
        grandfatheredBefore: cutoff,
        mode: 'test',
        startedAt
      })

      expect(readSetting(connection, stripeMembershipSyncStatusSettingKey)).toEqual({
        completedAt,
        failureCode: 'stripe_fetch_failed',
        grandfatheredBefore: cutoff,
        lastCompletedAt: null,
        mode: 'test',
        startedAt,
        status: 'failed',
        version: 1
      })
      expect(readSetting(connection, stripeMembershipSyncBindingSettingKey)).toEqual({
        grandfatheredBefore: cutoff,
        mode: 'test',
        version: 1
      })
      expect(() =>
        assertStripeMembershipSyncBinding(connection, {
          grandfatheredBefore: '2026-08-02T00:00:00.000Z',
          mode: 'test'
        })
      ).toThrowError(expect.objectContaining<Partial<StripeMembershipSyncError>>({ code: 'binding_changed' }))
    })
  })

  it('preserves the last successful completion while a later run fails', () => {
    withMigratedDatabase('last-success', (connection) => {
      recordStripeMembershipSyncStarted(connection, { grandfatheredBefore: cutoff, mode: 'test', startedAt })
      recordStripeMembershipSyncCompleted(connection, {
        completedAt,
        grandfatheredBefore: cutoff,
        mode: 'test',
        report: completedReport,
        startedAt
      })
      const nextStartedAt = '2026-08-23T10:00:00.000Z'
      recordStripeMembershipSyncStarted(connection, {
        grandfatheredBefore: cutoff,
        mode: 'test',
        startedAt: nextStartedAt
      })
      recordStripeMembershipSyncFailed(connection, {
        completedAt: '2026-08-23T10:01:00.000Z',
        failureCode: 'database_busy',
        grandfatheredBefore: cutoff,
        mode: 'test',
        startedAt: nextStartedAt
      })

      expect(readSetting(connection, stripeMembershipSyncStatusSettingKey)).toMatchObject({
        failureCode: 'database_busy',
        lastCompletedAt: completedAt,
        status: 'failed'
      })
    })
  })

  it('rejects a changed cutoff after the first successful apply', () => {
    withMigratedDatabase('cutoff', (connection) => {
      recordStripeMembershipSyncStarted(connection, { grandfatheredBefore: cutoff, mode: 'test', startedAt })
      recordStripeMembershipSyncCompleted(connection, {
        completedAt,
        grandfatheredBefore: cutoff,
        mode: 'test',
        report: completedReport,
        startedAt
      })

      expect(() =>
        assertStripeMembershipSyncBinding(connection, {
          grandfatheredBefore: '2026-08-02T00:00:00.000Z',
          mode: 'test'
        })
      ).toThrowError(expect.objectContaining<Partial<StripeMembershipSyncError>>({ code: 'binding_changed' }))
      expect(() =>
        assertStripeMembershipSyncBinding(connection, {
          grandfatheredBefore: cutoff,
          mode: 'live'
        })
      ).toThrowError(expect.objectContaining<Partial<StripeMembershipSyncError>>({ code: 'binding_changed' }))
    })
  })

  it('uses one fail-closed shared-volume lock and releases it after the run', () => {
    const directory = mkdtempSync(join(tmpdir(), 'wcu-stripe-sync-lock-'))
    const databasePath = join(directory, 'app.db')
    const sqlite = new Database(databasePath)
    sqlite.close()
    try {
      const release = acquireStripeMembershipSyncLock(databasePath)
      expect(existsSync(join(directory, '.stripe-membership-sync.lock'))).toBe(true)
      expect(() => acquireStripeMembershipSyncLock(databasePath)).toThrowError(
        expect.objectContaining<Partial<StripeMembershipSyncError>>({ code: 'overlap_detected' })
      )
      release()
      expect(existsSync(join(directory, '.stripe-membership-sync.lock'))).toBe(false)

      const releaseNext = acquireStripeMembershipSyncLock(databasePath)
      releaseNext()
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('rejects an ambiguous legacy Price map before provider work or database writes and redacts CLI output', () => {
    withMigratedDatabase('cli-price-map', (connection) => {
      const settingsBefore = readAllSettings(connection)
      const secretKey = 'rk_test_private_cli_value'

      const result = runSyncCli(connection.databasePath, ['--apply'], {
        ...validLinkSyncEnvironment,
        WCU_STRIPE_LEGACY_DUES27_PRICE_IDS: validLinkSyncEnvironment.WCU_STRIPE_LEGACY_DUES10_PRICE_IDS
      })

      expect(result.status).toBe(1)
      expect(result.signal).toBeNull()
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('Stripe membership synchronization failed: configuration_invalid.\n')
      expect(`${result.stdout}${result.stderr}`).not.toContain(secretKey)
      expect(readAllSettings(connection)).toEqual(settingsBefore)
      expect(existsSync(join(dirname(connection.databasePath), '.stripe-membership-sync.lock'))).toBe(false)

      const validated = runSyncCli(connection.databasePath, ['--validate-config'], validLinkSyncEnvironment)
      expect(validated.status).toBe(0)
      expect(validated.stdout).toBe('Stripe account membership synchronization configuration passed.\n')
    })
  })
})

const completedReport: StripeMembershipImportReport = Object.freeze({
  batchId: 'import_stripe_test',
  fetched: Object.freeze({ customers: 1 }),
  identities: Object.freeze({ ambiguous: 1, created: 0, existing: 0 }),
  issues: Object.freeze([
    Object.freeze({ code: 'ambiguous_verified_email', externalId: 'cus_private', objectType: 'stripe.customer' })
  ]),
  memberships: Object.freeze({ blocked: 1, createdActive: 0, createdPending: 0, existing: 0 }),
  mode: 'apply',
  revenue: Object.freeze({ duesCaptured: 0, duesRefunded: 0, netDuesCollected: 0 }),
  snapshots: Object.freeze({ changed: 1, unchanged: 0 })
})

function withMigratedDatabase(label: string, run: (connection: DatabaseConnection) => void): void {
  const directory = mkdtempSync(join(tmpdir(), `wcu-stripe-sync-${label}-`))
  const databasePath = join(directory, 'app.db')
  const sqlite = new Database(databasePath)
  try {
    sqlite.pragma('foreign_keys = ON')
    migrate(drizzle({ client: sqlite }), { migrationsFolder })
    run({ databasePath, db: drizzle({ client: sqlite, schema }), sqlite })
  } finally {
    sqlite.close()
    rmSync(directory, { force: true, recursive: true })
  }
}

function readSetting(connection: DatabaseConnection, key: string): unknown | null {
  const row = connection.sqlite.prepare('select value from app_settings where key = ?').get(key) as
    { value: string } | undefined
  return row ? (JSON.parse(row.value) as unknown) : null
}

function readAllSettings(connection: DatabaseConnection): readonly unknown[] {
  return connection.sqlite.prepare('select key, value from app_settings order by key').all()
}

function runSyncCli(
  databasePath: string,
  arguments_: readonly string[],
  environment: Readonly<Record<string, string>>
) {
  return spawnSync(
    process.execPath,
    [resolve('node_modules/tsx/dist/cli.mjs'), resolve('scripts/sync-stripe-membership-links.ts'), ...arguments_],
    {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        NUXT_DATABASE_URL: `file:${databasePath}`,
        ...environment
      },
      timeout: 5_000
    }
  )
}

function runCliHelp(script: string) {
  return spawnSync(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve(script), '--help'], {
    cwd: resolve('.'),
    encoding: 'utf8',
    timeout: 5_000
  })
}
