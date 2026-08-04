import type { DatabaseConnection } from '../../db/connect'
import type { ObjectStorage } from './object-storage'

export const fileStorageBindingSettingKey = 'files.storage-binding.v1'
export const fileStorageReconcileNotBeforeSettingKey = 'files.reconcile-not-before.v1'

type FileStorageBinding =
  | Readonly<{ version: 1; driver: 'local'; bucket: 'local' }>
  | Readonly<{ version: 1; driver: 'r2'; bucket: string; endpoint: string }>

export class FileStorageBindingError extends Error {
  constructor() {
    super('Configured file storage does not match the persisted storage binding')
    this.name = 'FileStorageBindingError'
  }
}

export function assertFileStorageBinding(
  connection: DatabaseConnection,
  storage: ObjectStorage,
  options: Readonly<{ initialize?: boolean }> = {}
) {
  return connection.sqlite
    .transaction(() => {
      const expected = bindingForStorage(storage)
      const current = readBinding(connection)

      if (!current) {
        if (!options.initialize) throw new FileStorageBindingError()
        assertNoExistingFiles(connection)
        writeBindingIfAbsent(connection, expected)
      }

      const persisted = readBinding(connection)
      if (!persisted || persisted.bucket !== expected.bucket) throw new FileStorageBindingError()
      if (persisted.driver !== expected.driver) throw new FileStorageBindingError()
      if (persisted.driver === 'r2') {
        if (expected.driver !== 'r2' || persisted.endpoint !== expected.endpoint) {
          throw new FileStorageBindingError()
        }
      }
      return persisted
    })
    .immediate()
}

export function assertFileBucketMatchesStorage(bucket: string, storage: ObjectStorage) {
  if (bucket !== storage.bucketName) throw new FileStorageBindingError()
}

/**
 * Rows protect active or not-yet-expired capabilities during ordinary file
 * cleanup. Account deletion removes those rows synchronously, so it records a
 * database-wide lower bound before doing so. Reconciliation must honor this
 * watermark even when another user's cleanup chain is already running.
 */
export function deferFileStorageReconciliation(connection: DatabaseConnection, notBefore: string) {
  if (!Number.isFinite(Date.parse(notBefore))) throw new FileStorageBindingError()
  const current = readReconcileNotBefore(connection)
  if (current && Date.parse(current) >= Date.parse(notBefore)) return current

  connection.sqlite
    .prepare(
      `insert into app_settings (key, value)
       values (?, ?)
       on conflict(key) do update set value = excluded.value`
    )
    .run(fileStorageReconcileNotBeforeSettingKey, JSON.stringify(notBefore))
  return notBefore
}

export function getFileStorageReconcileNotBefore(connection: DatabaseConnection) {
  return readReconcileNotBefore(connection)
}

function readBinding(connection: DatabaseConnection): FileStorageBinding | null {
  const row = connection.sqlite
    .prepare('select value from app_settings where key = ?')
    .get(fileStorageBindingSettingKey) as { value: string } | undefined
  if (!row) return null

  try {
    const value = JSON.parse(row.value) as Record<string, unknown>
    if (
      value.version !== 1 ||
      (value.driver !== 'local' && value.driver !== 'r2') ||
      typeof value.bucket !== 'string' ||
      !value.bucket
    ) {
      throw new Error('invalid binding')
    }
    if (value.driver === 'r2') {
      if (typeof value.endpoint !== 'string' || !value.endpoint) throw new Error('invalid binding')
      return { version: 1, driver: 'r2', bucket: value.bucket, endpoint: value.endpoint }
    }
    if (value.endpoint !== undefined || value.bucket !== 'local') throw new Error('invalid binding')
    return { version: 1, driver: 'local', bucket: 'local' }
  } catch {
    throw new FileStorageBindingError()
  }
}

function bindingForStorage(storage: ObjectStorage): FileStorageBinding {
  if (storage.kind === 'local') return { version: 1, driver: 'local', bucket: 'local' }
  return { version: 1, driver: 'r2', bucket: storage.bucketName, endpoint: storage.endpoint }
}

function readReconcileNotBefore(connection: DatabaseConnection): string | null {
  const row = connection.sqlite
    .prepare('select value from app_settings where key = ?')
    .get(fileStorageReconcileNotBeforeSettingKey) as { value: string } | undefined
  if (!row) return null

  try {
    const value = JSON.parse(row.value) as unknown
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('invalid watermark')
    return value
  } catch {
    throw new FileStorageBindingError()
  }
}

function assertNoExistingFiles(connection: DatabaseConnection) {
  if (connection.sqlite.prepare('select 1 from files limit 1').get()) throw new FileStorageBindingError()
}

function writeBindingIfAbsent(connection: DatabaseConnection, binding: FileStorageBinding) {
  connection.sqlite
    .prepare('insert into app_settings (key, value) values (?, ?) on conflict(key) do nothing')
    .run(fileStorageBindingSettingKey, JSON.stringify(binding))
}
