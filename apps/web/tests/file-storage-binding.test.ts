import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseConnection } from '../server/db/connect'
import * as schema from '../server/db/schema'
import {
  assertFileStorageBinding,
  deferFileStorageReconciliation,
  fileStorageBindingSettingKey,
  fileStorageReconcileNotBeforeSettingKey,
  getFileStorageReconcileNotBefore
} from '../server/services/storage/file-storage-binding'
import type { ObjectStorage } from '../server/services/storage/object-storage'

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
const r2Endpoint = 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.r2.cloudflarestorage.com'
const foreignR2Endpoint = 'https://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.r2.cloudflarestorage.com'
const euR2Endpoint = 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.eu.r2.cloudflarestorage.com'

let connection: DatabaseConnection

beforeEach(() => {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle({ client: sqlite, schema })
  migrate(db, { migrationsFolder })
  connection = { sqlite, db, databasePath: ':memory:' }
})

afterEach(() => {
  connection.sqlite.close()
})

describe('persisted file storage binding', () => {
  it('requires explicit initialization and then rejects every driver or bucket mismatch', () => {
    const local = storage('local', 'local')

    expect(() => assertFileStorageBinding(connection, local)).toThrow(
      'Configured file storage does not match the persisted storage binding'
    )
    expect(readSetting(fileStorageBindingSettingKey)).toBeNull()

    expect(assertFileStorageBinding(connection, local, { initialize: true })).toEqual({
      version: 1,
      driver: 'local',
      bucket: 'local'
    })
    expect(readJsonSetting(fileStorageBindingSettingKey)).toEqual({ version: 1, driver: 'local', bucket: 'local' })

    expect(() => assertFileStorageBinding(connection, storage('r2', 'local'))).toThrow(
      'Configured file storage does not match the persisted storage binding'
    )
    expect(() => assertFileStorageBinding(connection, storage('r2', 'private-files'))).toThrow(
      'Configured file storage does not match the persisted storage binding'
    )
    expect(readJsonSetting(fileStorageBindingSettingKey)).toEqual({ version: 1, driver: 'local', bucket: 'local' })
  })

  it('persists the normalized R2 endpoint and rejects same-name buckets in another account or jurisdiction', () => {
    expect(assertFileStorageBinding(connection, storage('r2', 'private-files'), { initialize: true })).toEqual({
      version: 1,
      driver: 'r2',
      bucket: 'private-files',
      endpoint: r2Endpoint
    })
    expect(readJsonSetting(fileStorageBindingSettingKey)).toEqual({
      version: 1,
      driver: 'r2',
      bucket: 'private-files',
      endpoint: r2Endpoint
    })

    for (const endpoint of [foreignR2Endpoint, euR2Endpoint]) {
      expect(() => assertFileStorageBinding(connection, storage('r2', 'private-files', endpoint))).toThrow(
        'Configured file storage does not match the persisted storage binding'
      )
    }
    expect(readJsonSetting(fileStorageBindingSettingKey)).toEqual({
      version: 1,
      driver: 'r2',
      bucket: 'private-files',
      endpoint: r2Endpoint
    })
  })

  it('refuses to initialize a binding around pre-existing unbound file metadata', () => {
    insertFile('file_123e4567-e89b-42d3-a456-426614174000', 'local')
    expect(() => assertFileStorageBinding(connection, storage('local', 'local'), { initialize: true })).toThrow(
      'Configured file storage does not match the persisted storage binding'
    )
    expect(readSetting(fileStorageBindingSettingKey)).toBeNull()
  })

  it('keeps the latest valid reconciliation watermark and fails closed on malformed persisted state', () => {
    const first = '2026-07-15T12:16:00.000Z'
    const later = '2026-07-15T12:17:00.000Z'
    expect(deferFileStorageReconciliation(connection, first)).toBe(first)
    expect(deferFileStorageReconciliation(connection, '2026-07-15T12:15:00.000Z')).toBe(first)
    expect(deferFileStorageReconciliation(connection, later)).toBe(later)
    expect(getFileStorageReconcileNotBefore(connection)).toBe(later)

    expect(() => deferFileStorageReconciliation(connection, 'not-a-timestamp')).toThrow(
      'Configured file storage does not match the persisted storage binding'
    )

    writeSetting(fileStorageReconcileNotBeforeSettingKey, JSON.stringify('not-a-timestamp'))
    expect(() => getFileStorageReconcileNotBefore(connection)).toThrow(
      'Configured file storage does not match the persisted storage binding'
    )

    writeSetting(fileStorageBindingSettingKey, JSON.stringify({ version: 1, driver: 'local', bucket: '' }))
    expect(() => assertFileStorageBinding(connection, storage('local', 'local'))).toThrow(
      'Configured file storage does not match the persisted storage binding'
    )

    for (const malformedBinding of [
      { version: 1, driver: 'r2', bucket: 'private-files' },
      { version: 1, driver: 'local', bucket: 'local', endpoint: r2Endpoint },
      { version: 1, driver: 'local', bucket: 'not-local' }
    ]) {
      writeSetting(fileStorageBindingSettingKey, JSON.stringify(malformedBinding))
      expect(() => assertFileStorageBinding(connection, storage('local', 'local'))).toThrow(
        'Configured file storage does not match the persisted storage binding'
      )
    }
  })
})

function storage(kind: 'local' | 'r2', bucketName: string, endpoint = r2Endpoint) {
  if (kind === 'local') return { kind, bucketName } as ObjectStorage
  return { kind, bucketName, endpoint, r2: {} } as unknown as ObjectStorage
}

function insertFile(id: string, bucket: string) {
  const ownerId = `owner-${id}`
  const now = '2026-07-15T12:00:00.000Z'
  connection.sqlite
    .prepare('insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)')
    .run(ownerId, ownerId, `${ownerId}@example.test`, Date.parse(now), Date.parse(now))
  connection.sqlite
    .prepare(
      `insert into files (
        id, owner_id, bucket, object_key, original_name, content_type, byte_size,
        content_md5, status, upload_expires_at, created_at, updated_at, deleted_at
      ) values (?, ?, ?, ?, 'private.txt', 'text/plain', 1, ?, 'ready', ?, ?, ?, null)`
    )
    .run(id, ownerId, bucket, `files/v1/${id}`, '1B2M2Y8AsgTpgAmY7PhCfg==', now, now, now)
}

function readSetting(key: string) {
  const row = connection.sqlite.prepare('select value from app_settings where key = ?').get(key) as
    { value: string } | undefined
  return row?.value ?? null
}

function readJsonSetting(key: string) {
  const value = readSetting(key)
  return value === null ? null : JSON.parse(value)
}

function writeSetting(key: string, value: string) {
  connection.sqlite
    .prepare(
      `insert into app_settings (key, value)
       values (?, ?)
       on conflict(key) do update set value = excluded.value`
    )
    .run(key, value)
}
