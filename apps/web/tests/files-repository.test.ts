import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { DatabaseConnection } from '../server/db/connect'
import {
  createPendingFile,
  deleteCleanedFileMetadata,
  getFileForOwner,
  listDeletedFilesReadyForCleanup,
  listExpiredPendingFiles,
  listFilesForOwner,
  listTrackedObjectKeys,
  markExpiredPendingFileDeleted,
  markFileReady
} from '../server/db/repositories/files'
import { files } from '../server/db/schema'
import * as schema from '../server/db/schema'

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
const canonicalMd5 = '1B2M2Y8AsgTpgAmY7PhCfg=='

describe('Files repository authority', () => {
  it('lists only the authenticated owner with a stable bounded keyset cursor', async () => {
    await withConnection(async (connection) => {
      insertUser(connection, 'owner-a', 'owner-a@example.test')
      insertUser(connection, 'owner-b', 'owner-b@example.test')
      await insertFile(connection, {
        id: 'file-owner-newest',
        ownerId: 'owner-a',
        status: 'ready',
        createdAt: '2026-07-15T12:02:00.000Z'
      })
      await insertFile(connection, {
        id: 'file-owner-c',
        ownerId: 'owner-a',
        status: 'pending',
        createdAt: '2026-07-15T12:01:00.000Z'
      })
      await insertFile(connection, {
        id: 'file-owner-b',
        ownerId: 'owner-a',
        status: 'ready',
        createdAt: '2026-07-15T12:01:00.000Z'
      })
      await insertFile(connection, {
        id: 'file-owner-oldest',
        ownerId: 'owner-a',
        status: 'pending',
        createdAt: '2026-07-15T12:00:00.000Z'
      })
      await insertFile(connection, {
        id: 'file-foreign',
        ownerId: 'owner-b',
        status: 'ready',
        createdAt: '2026-07-15T12:04:00.000Z'
      })
      await insertFile(connection, {
        id: 'file-owner-deleted',
        ownerId: 'owner-a',
        status: 'deleted',
        createdAt: '2026-07-15T12:03:00.000Z',
        deletedAt: '2026-07-15T12:04:00.000Z'
      })

      const first = await listFilesForOwner(connection, 'owner-a', { limit: 2 })
      expect(first.files.map(({ id }) => id)).toEqual(['file-owner-newest', 'file-owner-c'])
      expect(first.nextCursor).toEqual({ createdAt: '2026-07-15T12:01:00.000Z', id: 'file-owner-c' })

      const second = await listFilesForOwner(connection, 'owner-a', { limit: 2, cursor: first.nextCursor })
      expect(second.files.map(({ id }) => id)).toEqual(['file-owner-b', 'file-owner-oldest'])
      expect(second.nextCursor).toBeNull()
      expect((await listFilesForOwner(connection, 'owner-b')).files.map(({ id }) => id)).toEqual(['file-foreign'])
      await expect(listFilesForOwner(connection, 'owner-a', { limit: 101 })).rejects.toThrow(/between 1 and 100/)
    })
  })

  it('owner-predicates reads and idempotently commits pending uploads', async () => {
    await withConnection(async (connection) => {
      insertUser(connection, 'transition-owner', 'transition-owner@example.test')
      insertUser(connection, 'transition-foreign', 'transition-foreign@example.test')
      const uploadExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
      const pending = await createPendingFile(connection, {
        id: 'file-transition',
        ownerId: 'transition-owner',
        bucket: 'local',
        objectKey: 'files/v1/file-transition',
        originalName: 'private.txt',
        contentType: 'text/plain',
        byteSize: 7,
        contentMd5: canonicalMd5,
        uploadExpiresAt
      })

      expect(pending.status).toBe('pending')
      expect(await getFileForOwner(connection, 'transition-foreign', pending.id)).toBeNull()
      expect(await markFileReady(connection, 'transition-foreign', pending.id)).toBeNull()

      const ready = await markFileReady(connection, 'transition-owner', pending.id)
      expect(ready).toEqual(expect.objectContaining({ id: pending.id, ownerId: 'transition-owner', status: 'ready' }))
      expect(await markFileReady(connection, 'transition-owner', pending.id)).toEqual(ready)
      expect(connection.sqlite.prepare('select owner_id from files where id = ?').get(pending.id)).toEqual({
        owner_id: 'transition-owner'
      })
    })
  })

  it('bounds expiry claims and provider-page reconciliation', async () => {
    await withConnection(async (connection) => {
      insertUser(connection, 'cleanup-owner', 'cleanup-owner@example.test')
      await insertFile(connection, {
        id: 'file-expired',
        ownerId: 'cleanup-owner',
        status: 'pending',
        uploadExpiresAt: '2026-07-15T12:15:00.000Z'
      })
      await insertFile(connection, {
        id: 'file-future',
        ownerId: 'cleanup-owner',
        status: 'pending',
        uploadExpiresAt: '2026-07-15T13:00:00.000Z'
      })
      await insertFile(connection, {
        id: 'file-ready',
        ownerId: 'cleanup-owner',
        status: 'ready',
        uploadExpiresAt: '2026-07-15T12:15:00.000Z'
      })
      await insertFile(connection, {
        id: 'file-deleted',
        ownerId: 'cleanup-owner',
        status: 'deleted',
        uploadExpiresAt: '2026-07-15T12:10:00.000Z',
        deletedAt: '2026-07-15T12:20:00.000Z'
      })
      await insertFile(connection, {
        id: 'file-deleted-future',
        ownerId: 'cleanup-owner',
        status: 'deleted',
        uploadExpiresAt: '2026-07-15T13:00:00.000Z',
        deletedAt: '2026-07-15T12:20:00.000Z'
      })

      const now = '2026-07-15T12:30:00.000Z'
      expect((await listExpiredPendingFiles(connection, { now, limit: 1 })).map(({ id }) => id)).toEqual([
        'file-expired'
      ])
      expect(await markExpiredPendingFileDeleted(connection, 'file-future', now)).toBeNull()
      expect(await markExpiredPendingFileDeleted(connection, 'file-expired', now)).toEqual(
        expect.objectContaining({ id: 'file-expired', status: 'deleted' })
      )
      expect(await markExpiredPendingFileDeleted(connection, 'file-expired', now)).toBeNull()

      expect((await listDeletedFilesReadyForCleanup(connection, { now, limit: 10 })).map(({ id }) => id)).toEqual([
        'file-expired',
        'file-deleted'
      ])
      expect(
        await listTrackedObjectKeys(connection, 'local', [
          'files/v1/file-expired',
          'files/v1/file-future',
          'files/v1/file-ready',
          'files/v1/file-deleted'
        ])
      ).toEqual(
        expect.arrayContaining([
          'files/v1/file-expired',
          'files/v1/file-future',
          'files/v1/file-ready',
          'files/v1/file-deleted'
        ])
      )
      expect(
        await listTrackedObjectKeys(connection, 'local', [
          'files/v1/file-expired',
          'files/v1/file-future',
          'files/v1/file-ready',
          'files/v1/file-deleted'
        ])
      ).toHaveLength(4)
      expect(() =>
        listTrackedObjectKeys(
          connection,
          'local',
          Array.from({ length: 101 }, (_, index) => `files/v1/${index}`)
        )
      ).toThrow(/limited to 100/)

      expect(await deleteCleanedFileMetadata(connection, 'file-deleted', 'files/v1/wrong')).toBe(false)
      expect(await deleteCleanedFileMetadata(connection, 'file-deleted', 'files/v1/file-deleted')).toBe(true)
      expect(connection.sqlite.prepare("select id from files where id = 'file-deleted'").get()).toBeUndefined()
    })
  })
})

async function withConnection(run: (connection: DatabaseConnection) => Promise<void>) {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  migrate(drizzle({ client: sqlite, schema }), { migrationsFolder })
  const connection: DatabaseConnection = {
    sqlite,
    db: drizzle({ client: sqlite, schema }),
    databasePath: ':memory:'
  }
  try {
    await run(connection)
  } finally {
    sqlite.close()
  }
}

function insertUser(connection: DatabaseConnection, id: string, email: string) {
  connection.sqlite
    .prepare('insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, 1, 1)')
    .run(id, id, email)
}

async function insertFile(
  connection: DatabaseConnection,
  input: {
    id: string
    ownerId: string
    status: 'pending' | 'ready' | 'deleted'
    createdAt?: string
    uploadExpiresAt?: string
    deletedAt?: string | null
  }
) {
  const createdAt = input.createdAt ?? '2026-07-15T12:00:00.000Z'
  await connection.db.insert(files).values({
    id: input.id,
    ownerId: input.ownerId,
    bucket: 'local',
    objectKey: `files/v1/${input.id}`,
    originalName: `${input.id}.txt`,
    contentType: 'text/plain',
    byteSize: 7,
    contentMd5: canonicalMd5,
    status: input.status,
    uploadExpiresAt: input.uploadExpiresAt ?? '2026-07-15T12:15:00.000Z',
    createdAt,
    updatedAt: createdAt,
    deletedAt: input.status === 'deleted' ? (input.deletedAt ?? createdAt) : null
  })
}
