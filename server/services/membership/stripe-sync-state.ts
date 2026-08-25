import { mkdirSync, rmdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DatabaseConnection } from '../../db/connect'
import type { StripeMembershipImportReport } from './stripe-import'

export const stripeMembershipSyncBusyTimeoutMs = 5_000
export const stripeMembershipSyncBindingSettingKey = 'membership.stripe-sync-binding.v1'
export const stripeMembershipSyncIssuesSettingKey = 'membership.stripe-sync-issues.v1'
export const stripeMembershipSyncStatusSettingKey = 'membership.stripe-sync-status.v1'
export type StripeMembershipSyncMode = 'live' | 'test'

export type StripeMembershipSyncFailureCode =
  | 'configuration_invalid'
  | 'binding_changed'
  | 'database_busy'
  | 'import_failed'
  | 'lock_cleanup_failed'
  | 'overlap_detected'
  | 'stripe_fetch_failed'

export class StripeMembershipSyncError extends Error {
  readonly code: StripeMembershipSyncFailureCode

  constructor(code: StripeMembershipSyncFailureCode, options: ErrorOptions = {}) {
    super(`Stripe membership synchronization failed: ${code}`, options)
    this.name = 'StripeMembershipSyncError'
    this.code = code
  }
}

export function configureStripeMembershipSyncDatabase(connection: DatabaseConnection): void {
  connection.sqlite.pragma(`busy_timeout = ${stripeMembershipSyncBusyTimeoutMs}`)
}

export function assertStripeMembershipSyncKey(mode: StripeMembershipSyncMode, secretKey: string): void {
  if (!new RegExp(`^rk_${mode}_[A-Za-z0-9_]+$`).test(secretKey)) {
    throw new StripeMembershipSyncError('configuration_invalid')
  }
}

export function assertStripeMembershipSyncBinding(
  connection: DatabaseConnection,
  input: Readonly<{ grandfatheredBefore: string; mode: StripeMembershipSyncMode }>
): void {
  const persisted = readJsonSetting(connection, stripeMembershipSyncBindingSettingKey)
  if (persisted === null) return
  if (!isSyncBinding(persisted)) throw new StripeMembershipSyncError('configuration_invalid')
  if (persisted.grandfatheredBefore !== input.grandfatheredBefore || persisted.mode !== input.mode) {
    throw new StripeMembershipSyncError('binding_changed')
  }
}

export function recordStripeMembershipSyncStarted(
  connection: DatabaseConnection,
  input: Readonly<{ grandfatheredBefore: string; mode: StripeMembershipSyncMode; startedAt: string }>
): void {
  connection.sqlite
    .transaction(() => {
      assertStripeMembershipSyncBinding(connection, input)
      const lastCompletedAt = readLastCompletedAt(connection)
      writeJsonSettingIfAbsent(connection, stripeMembershipSyncBindingSettingKey, {
        grandfatheredBefore: input.grandfatheredBefore,
        mode: input.mode,
        version: 1
      })
      writeJsonSetting(connection, stripeMembershipSyncStatusSettingKey, {
        grandfatheredBefore: input.grandfatheredBefore,
        lastCompletedAt,
        mode: input.mode,
        startedAt: input.startedAt,
        status: 'running',
        version: 1
      })
    })
    .immediate()
}

export function recordStripeMembershipSyncCompleted(
  connection: DatabaseConnection,
  input: Readonly<{
    completedAt: string
    grandfatheredBefore: string
    mode: StripeMembershipSyncMode
    report: StripeMembershipImportReport
    startedAt: string
  }>
): void {
  const issueCodes = countIssueCodes(input.report)
  connection.sqlite
    .transaction(() => {
      assertStripeMembershipSyncBinding(connection, input)
      writeJsonSetting(connection, stripeMembershipSyncStatusSettingKey, {
        completedAt: input.completedAt,
        grandfatheredBefore: input.grandfatheredBefore,
        importBatchId: input.report.batchId,
        issueCodes,
        issueCount: input.report.issues.length,
        lastCompletedAt: input.completedAt,
        mode: input.mode,
        startedAt: input.startedAt,
        status: 'completed',
        version: 1
      })
      writeJsonSetting(connection, stripeMembershipSyncIssuesSettingKey, {
        importBatchId: input.report.batchId,
        issues: input.report.issues,
        recordedAt: input.completedAt,
        version: 1
      })
    })
    .immediate()
}

export function recordStripeMembershipSyncFailed(
  connection: DatabaseConnection,
  input: Readonly<{
    completedAt: string
    failureCode: StripeMembershipSyncFailureCode
    grandfatheredBefore: string
    mode: StripeMembershipSyncMode
    startedAt: string
  }>
): void {
  connection.sqlite
    .transaction(() => {
      const lastCompletedAt = readLastCompletedAt(connection)
      writeJsonSetting(connection, stripeMembershipSyncStatusSettingKey, {
        completedAt: input.completedAt,
        failureCode: input.failureCode,
        grandfatheredBefore: input.grandfatheredBefore,
        lastCompletedAt,
        mode: input.mode,
        startedAt: input.startedAt,
        status: 'failed',
        version: 1
      })
    })
    .immediate()
}

export function acquireStripeMembershipSyncLock(databasePath: string): () => void {
  if (databasePath === ':memory:') throw new StripeMembershipSyncError('configuration_invalid')
  const lockPath = join(dirname(databasePath), '.stripe-membership-sync.lock')
  try {
    mkdirSync(lockPath, { mode: 0o700 })
  } catch (error) {
    if (hasErrorCode(error, 'EEXIST')) throw new StripeMembershipSyncError('overlap_detected', { cause: error })
    throw error
  }

  return () => {
    try {
      rmdirSync(lockPath)
    } catch (error) {
      throw new StripeMembershipSyncError('lock_cleanup_failed', { cause: error })
    }
  }
}

export function stripeMembershipSyncFailureCode(error: unknown): StripeMembershipSyncFailureCode {
  if (error instanceof StripeMembershipSyncError) return error.code
  if (hasErrorCode(error, 'SQLITE_BUSY') || hasErrorCode(error, 'SQLITE_LOCKED')) return 'database_busy'
  return 'import_failed'
}

export function redactedStripeMembershipSyncReceipt(report: StripeMembershipImportReport) {
  return Object.freeze({
    fetched: report.fetched,
    identities: report.identities,
    importBatchId: report.batchId,
    issueCodes: countIssueCodes(report),
    issueCount: report.issues.length,
    memberships: report.memberships,
    operation: report.mode,
    revenue: report.revenue,
    snapshots: report.snapshots,
    status: 'completed'
  })
}

function countIssueCodes(report: StripeMembershipImportReport): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const value of report.issues) counts[value.code] = (counts[value.code] ?? 0) + 1
  return Object.freeze(Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))))
}

function readJsonSetting(connection: DatabaseConnection, key: string): unknown | null {
  const row = connection.sqlite.prepare('select value from app_settings where key = ?').get(key) as
    { value: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.value) as unknown
  } catch (error) {
    throw new StripeMembershipSyncError('configuration_invalid', { cause: error })
  }
}

function readLastCompletedAt(connection: DatabaseConnection): string | null {
  const status = readJsonSetting(connection, stripeMembershipSyncStatusSettingKey)
  if (!status || typeof status !== 'object') return null
  const candidate = status as Record<string, unknown>
  if (typeof candidate.lastCompletedAt === 'string') return candidate.lastCompletedAt
  if (candidate.status === 'completed' && typeof candidate.completedAt === 'string') return candidate.completedAt
  return null
}

function writeJsonSetting(connection: DatabaseConnection, key: string, value: unknown): void {
  connection.sqlite
    .prepare(
      `insert into app_settings (key, value) values (?, ?)
       on conflict(key) do update set value = excluded.value`
    )
    .run(key, JSON.stringify(value))
}

function writeJsonSettingIfAbsent(connection: DatabaseConnection, key: string, value: unknown): void {
  connection.sqlite
    .prepare('insert into app_settings (key, value) values (?, ?) on conflict(key) do nothing')
    .run(key, JSON.stringify(value))
}

function hasErrorCode(error: unknown, code: string): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === code
}

function isSyncBinding(value: unknown): value is Readonly<{
  grandfatheredBefore: string
  mode: StripeMembershipSyncMode
  version: 1
}> {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.version === 1 &&
    (candidate.mode === 'live' || candidate.mode === 'test') &&
    typeof candidate.grandfatheredBefore === 'string'
  )
}
