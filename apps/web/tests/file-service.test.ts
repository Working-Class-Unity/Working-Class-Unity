import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseConnection } from '../server/db/connect'
import { createPendingFile } from '../server/db/repositories/files'
import { files } from '../server/db/schema'
import * as schema from '../server/db/schema'
import { deleteAccountAtomically } from '../server/services/account-deletion'
import {
  completeFileUploadForConnection,
  createFileUploadTargetForConnection,
  createPrivateFileDownloadForConnection,
  deleteOwnedFileAndScheduleCleanup,
  fileCleanupSchedulingMarginMs,
  fileUploadTokenTtlMs,
  putVerifiedFileUploadContent
} from '../server/services/storage/file-service'
import { objectKeyForFileId } from '../server/services/storage/file-object-keys'
import {
  assertFileStorageBinding,
  deferFileStorageReconciliation
} from '../server/services/storage/file-storage-binding'
import { verifyFileDownloadToken, verifyFileUploadToken } from '../server/services/storage/file-tokens'
import {
  LocalObjectAlreadyExistsError,
  LocalObjectIntegrityError,
  LocalObjectStorage
} from '../server/services/storage/local-object-storage'
import type { ObjectStorage } from '../server/services/storage/object-storage'
import { resolveLocalObjectStoragePath } from '../server/services/storage/object-storage'
import {
  cleanupOrphanedFileObjectsForConnection,
  ensureFileReconciliationSafetyJob,
  fileCleanupPageSize,
  fileCleanupRetryDelayMs,
  fileReconciliationSafetyIntervalMs
} from '../server/services/storage/orphan-cleanup'
import type { AppRuntimeConfig } from '../server/utils/runtime'
import * as runtime from '../server/utils/runtime'

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
const cursorSecret = 'file-service-test-cursor-secret-with-32-characters'
const r2Endpoint = 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.r2.cloudflarestorage.com'

let fixture: ReturnType<typeof createFixture>

beforeEach(async () => {
  fixture = createFixture(await mkdtemp(join(tmpdir(), 'swl-file-service-')))
  vi.spyOn(runtime, 'getAppRuntimeConfig').mockReturnValue({
    betterAuth: { secret: cursorSecret },
    modules: {
      files: { enabled: true },
      jobs: { enabled: true }
    }
  } as AppRuntimeConfig)
})

afterEach(async () => {
  vi.restoreAllMocks()
  fixture.connection.sqlite.close()
  await rm(fixture.directory, { recursive: true, force: true })
})

describe('private file service', () => {
  it('keeps same-family membership irrelevant and conceals foreign records like missing records', async () => {
    insertUser(fixture.connection, 'family-owner', 'family-owner@example.test')
    insertUser(fixture.connection, 'family-member', 'family-member@example.test')
    const organization = fixture.connection.sqlite
      .prepare("select id from organization where personal_owner_user_id = 'family-owner'")
      .get() as { id: string }
    fixture.connection.sqlite
      .prepare(
        `insert into member (id, organization_id, user_id, role, created_at)
         values (?, ?, 'family-member', 'member', ?)`
      )
      .run(`member_${randomUUID()}`, organization.id, Date.now())

    const content = Buffer.from('owner-only bytes')
    const fileId = newFileId()
    const objectKey = objectKeyForFileId(fileId)
    await insertFile(fixture.connection, {
      id: fileId,
      ownerId: 'family-owner',
      objectKey,
      content,
      status: 'ready'
    })
    await writeLocalObject(fixture.local, objectKey, content)

    const foreign = await createPrivateFileDownloadForConnection(
      fixture.connection,
      fixture.storage,
      'family-member',
      fileId
    ).catch((error: unknown) => error)
    const missing = await createPrivateFileDownloadForConnection(
      fixture.connection,
      fixture.storage,
      'family-member',
      newFileId()
    ).catch((error: unknown) => error)

    expect(foreign).toMatchObject({ statusCode: 404, statusMessage: 'File not found' })
    expect(missing).toMatchObject({ statusCode: 404, statusMessage: 'File not found' })
    expect(await fixture.local.headPersistedObject(objectKey)).toEqual({ key: objectKey, byteSize: content.length })
  })

  it('runs the streamed local upload, finalize, private download capability, deletion, and cleanup lifecycle', async () => {
    insertUser(fixture.connection, 'lifecycle-owner', 'lifecycle-owner@example.test')
    const content = Buffer.from('streamed lifecycle content')
    const contentMd5 = md5(content)
    const startedAt = new Date()
    const lifecycleAt = new Date(startedAt.getTime() + 1_000)
    const target = await createFileUploadTargetForConnection(
      fixture.connection,
      fixture.storage,
      'lifecycle-owner',
      {
        filename: 'private notes.txt',
        contentType: 'text/plain',
        byteSize: content.length,
        contentMd5
      },
      { signingDate: startedAt, now: () => startedAt }
    )
    expect(
      fixture.connection.sqlite
        .prepare('select type, payload, max_attempts as maxAttempts, run_after as runAfter from job_queue')
        .all()
    ).toEqual([
      {
        type: 'files.cleanup-orphans',
        payload: '{}',
        maxAttempts: 2_147_483_647,
        runAfter: new Date(startedAt.getTime() + fileUploadTokenTtlMs + fileCleanupSchedulingMarginMs).toISOString()
      }
    ])
    expect(
      JSON.parse(
        (
          fixture.connection.sqlite
            .prepare("select value from app_settings where key = 'files.storage-binding.v1'")
            .get() as { value: string }
        ).value
      )
    ).toEqual({ version: 1, driver: 'local', bucket: 'local' })
    const uploadToken = new URL(target.upload.url, 'http://localhost').searchParams.get('token')
    expect(uploadToken).toEqual(expect.any(String))
    const uploadCapability = verifyFileUploadToken(uploadToken!)

    await expect(
      putVerifiedFileUploadContent(
        fixture.connection,
        fixture.storage,
        'lifecycle-owner',
        target.file.id,
        uploadCapability,
        Readable.from([content.subarray(0, 8), content.subarray(8)]),
        {
          contentType: 'text/plain',
          contentMd5,
          contentLength: String(content.length)
        }
      )
    ).resolves.toEqual({ file: expect.objectContaining({ id: target.file.id, status: 'pending' }) })

    const ready = await completeFileUploadForConnection(
      fixture.connection,
      fixture.storage,
      'lifecycle-owner',
      target.file.id,
      lifecycleAt
    )
    expect(ready).toMatchObject({
      id: target.file.id,
      filename: 'private notes.txt',
      contentType: 'text/plain',
      byteSize: content.length,
      status: 'ready'
    })

    const download = await createPrivateFileDownloadForConnection(
      fixture.connection,
      fixture.storage,
      'lifecycle-owner',
      target.file.id,
      lifecycleAt
    )
    expect(download.download).toMatchObject({ method: 'GET', headers: {}, expiresAt: expect.any(String) })
    const downloadToken = new URL(download.download.url, 'http://localhost').searchParams.get('token')
    expect(verifyFileDownloadToken(downloadToken!)).toMatchObject({
      action: 'download',
      fileId: target.file.id,
      ownerId: 'lifecycle-owner'
    })

    const persisted = fixture.connection.sqlite
      .prepare('select object_key as objectKey, upload_expires_at as uploadExpiresAt from files where id = ?')
      .get(target.file.id) as { objectKey: string; uploadExpiresAt: string }
    expect(persisted.objectKey).toMatch(/^files\/v1\/file_[0-9a-f-]+$/)
    expect(persisted.objectKey).not.toContain('lifecycle-owner')
    expect(persisted.objectKey).not.toContain('private')
    const body = await fixture.local.createReadStream(persisted.objectKey)
    expect(await collect(body!.body)).toEqual(content)

    expect(
      deleteOwnedFileAndScheduleCleanup(
        fixture.connection,
        fixture.storage,
        'lifecycle-owner',
        target.file.id,
        lifecycleAt
      )
    ).toBe(true)
    await expect(
      createPrivateFileDownloadForConnection(
        fixture.connection,
        fixture.storage,
        'lifecycle-owner',
        target.file.id,
        lifecycleAt
      )
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(fixture.connection.sqlite.prepare('select type, max_attempts from job_queue').get()).toEqual({
      type: 'files.cleanup-orphans',
      max_attempts: 2_147_483_647
    })
    expect(
      fixture.connection.sqlite
        .prepare("select count(*) as count from job_queue where type = 'files.cleanup-orphans'")
        .get()
    ).toEqual({
      count: 2
    })

    const cleanupAt = new Date(Date.parse(persisted.uploadExpiresAt) + fileCleanupSchedulingMarginMs + 1)
    await cleanupOrphanedFileObjectsForConnection(
      fixture.connection,
      { phase: 'deleted-metadata' },
      { storage: fixture.storage, now: cleanupAt, enqueueNext: () => undefined }
    )
    expect(fixture.connection.sqlite.prepare('select id from files where id = ?').get(target.file.id)).toBeUndefined()
    expect(await fixture.local.headPersistedObject(persisted.objectKey)).toBeNull()
  })

  it('turns a provider outage into a retryable response without changing committed metadata', async () => {
    insertUser(fixture.connection, 'provider-owner', 'provider-owner@example.test')
    const content = Buffer.from('provider content')
    const fileId = newFileId()
    const objectKey = objectKeyForFileId(fileId)
    await insertFile(fixture.connection, {
      id: fileId,
      ownerId: 'provider-owner',
      bucket: 'private-files',
      objectKey,
      content,
      status: 'pending'
    })
    const before = fixture.connection.sqlite.prepare('select * from files where id = ?').get(fileId)
    const headPersistedObject = vi
      .fn()
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce({ key: objectKey, byteSize: content.length, contentType: undefined })
      .mockResolvedValueOnce({ key: objectKey, byteSize: content.length, contentType: 'text/plain' })
    const providerStorage = {
      kind: 'r2',
      bucketName: 'private-files',
      endpoint: r2Endpoint,
      r2: { headPersistedObject }
    } as unknown as ObjectStorage

    await expect(
      completeFileUploadForConnection(fixture.connection, providerStorage, 'provider-owner', fileId, new Date())
    ).rejects.toMatchObject({ statusCode: 503, statusMessage: 'File storage is temporarily unavailable' })
    expect(fixture.connection.sqlite.prepare('select * from files where id = ?').get(fileId)).toEqual(before)

    await expect(
      completeFileUploadForConnection(fixture.connection, providerStorage, 'provider-owner', fileId, new Date())
    ).rejects.toMatchObject({ statusCode: 409, statusMessage: 'Uploaded object media type does not match' })
    expect(fixture.connection.sqlite.prepare('select * from files where id = ?').get(fileId)).toEqual(before)

    await expect(
      completeFileUploadForConnection(fixture.connection, providerStorage, 'provider-owner', fileId, new Date())
    ).resolves.toMatchObject({ id: fileId, status: 'ready' })
    expect(headPersistedObject).toHaveBeenCalledTimes(3)
    expect(
      fixture.connection.sqlite
        .prepare(
          'select object_key as objectKey, content_md5 as contentMd5, upload_expires_at as uploadExpiresAt from files where id = ?'
        )
        .get(fileId)
    ).toEqual({
      objectKey,
      contentMd5: md5(content),
      uploadExpiresAt: (before as { upload_expires_at: string }).upload_expires_at
    })
  })

  it('creates R2 capabilities only after durable metadata and cleanup scheduling succeed', async () => {
    insertUser(fixture.connection, 'r2-init-owner', 'r2-init-owner@example.test')
    const content = Buffer.from('r2 initiation')
    const signingDate = new Date()
    const expiresAt = new Date(signingDate.getTime() + fileUploadTokenTtlMs).toISOString()
    const upload = {
      method: 'PUT' as const,
      url: 'https://example.invalid/upload-capability',
      headers: { 'content-length': String(content.length) },
      expiresAt
    }
    const head = {
      method: 'HEAD' as const,
      url: 'https://example.invalid/head-capability',
      headers: {},
      expiresAt: upload.expiresAt
    }
    const createUploadRequests = vi
      .fn()
      .mockResolvedValueOnce({ upload, head })
      .mockRejectedValueOnce(new Error('signing unavailable'))
    const providerStorage = {
      kind: 'r2',
      bucketName: 'private-files',
      endpoint: r2Endpoint,
      r2: { createUploadRequests }
    } as unknown as ObjectStorage

    await expect(
      createFileUploadTargetForConnection(
        fixture.connection,
        providerStorage,
        'r2-init-owner',
        {
          filename: 'provider.txt',
          contentType: 'text/plain',
          byteSize: content.length,
          contentMd5: md5(content)
        },
        { signingDate, now: () => signingDate }
      )
    ).resolves.toMatchObject({
      file: { status: 'pending' },
      upload,
      head
    })

    await expect(
      createFileUploadTargetForConnection(
        fixture.connection,
        providerStorage,
        'r2-init-owner',
        {
          filename: 'not-issued.txt',
          contentType: 'text/plain',
          byteSize: content.length,
          contentMd5: md5(content)
        },
        { signingDate, now: () => signingDate }
      )
    ).rejects.toMatchObject({ statusCode: 503, statusMessage: 'File storage is temporarily unavailable' })
    expect(fixture.connection.sqlite.prepare('select count(*) as count from files').get()).toEqual({ count: 1 })
    expect(fixture.connection.sqlite.prepare('select count(*) as count from job_queue').get()).toEqual({ count: 1 })
    expect(createUploadRequests).toHaveBeenNthCalledWith(1, {
      key: expect.stringMatching(/^files\/v1\/file_/),
      byteSize: content.length,
      contentType: 'text/plain',
      contentMd5: md5(content),
      signingDate
    })
  })

  it('returns no R2 capability when signer expiry disagrees with the row or signing finishes too late', async () => {
    insertUser(fixture.connection, 'r2-expiry-owner', 'r2-expiry-owner@example.test')
    const content = Buffer.from('r2 expiry boundary')
    const signingDate = new Date()
    const expiresAt = new Date(signingDate.getTime() + fileUploadTokenTtlMs).toISOString()
    let currentTime = signingDate
    const request = (capabilityExpiresAt: string) => ({
      upload: {
        method: 'PUT' as const,
        url: 'https://example.invalid/upload-capability',
        headers: {},
        expiresAt: capabilityExpiresAt
      },
      head: {
        method: 'HEAD' as const,
        url: 'https://example.invalid/head-capability',
        headers: {},
        expiresAt: capabilityExpiresAt
      }
    })
    const createUploadRequests = vi
      .fn()
      .mockResolvedValueOnce(request(new Date(Date.parse(expiresAt) + 1_000).toISOString()))
      .mockImplementationOnce(async () => {
        currentTime = new Date(expiresAt)
        return request(expiresAt)
      })
    const providerStorage = {
      kind: 'r2',
      bucketName: 'private-files',
      endpoint: r2Endpoint,
      r2: { createUploadRequests }
    } as unknown as ObjectStorage

    for (const filename of ['mismatched.txt', 'late.txt']) {
      currentTime = signingDate
      await expect(
        createFileUploadTargetForConnection(
          fixture.connection,
          providerStorage,
          'r2-expiry-owner',
          {
            filename,
            contentType: 'text/plain',
            byteSize: content.length,
            contentMd5: md5(content)
          },
          { signingDate, now: () => currentTime }
        )
      ).rejects.toMatchObject({ statusCode: 503, statusMessage: 'File storage is temporarily unavailable' })
    }

    expect(fixture.connection.sqlite.prepare('select id from files').all()).toEqual([])
    expect(fixture.connection.sqlite.prepare('select id from job_queue').all()).toEqual([])
  })

  it('rejects upload capability confusion and maps local writer failures without changing metadata', async () => {
    const ownerId = 'upload-failure-owner'
    insertUser(fixture.connection, ownerId, 'upload-failure-owner@example.test')
    const content = Buffer.from('declared upload')
    const fileId = newFileId()
    const objectKey = objectKeyForFileId(fileId)
    const uploadExpiresAt = new Date(Date.now() + 60_000).toISOString()
    initializeStorageBinding(fixture.connection, 'local')
    await createPendingFile(fixture.connection, {
      id: fileId,
      ownerId,
      bucket: 'local',
      objectKey,
      originalName: 'declared.txt',
      contentType: 'text/plain',
      byteSize: content.length,
      contentMd5: md5(content),
      uploadExpiresAt
    })
    const payload = {
      action: 'upload' as const,
      fileId,
      ownerId,
      expiresAt: uploadExpiresAt,
      byteSize: content.length,
      contentType: 'text/plain',
      contentMd5: md5(content)
    }
    const headers = {
      contentType: 'text/plain',
      contentMd5: md5(content),
      contentLength: String(content.length)
    }

    await expect(
      putVerifiedFileUploadContent(
        fixture.connection,
        { kind: 'r2', bucketName: 'local', endpoint: r2Endpoint, r2: {} } as unknown as ObjectStorage,
        ownerId,
        fileId,
        payload,
        Readable.from([content]),
        headers
      )
    ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'Local upload capability not found' })
    await expect(
      putVerifiedFileUploadContent(
        fixture.connection,
        fixture.storage,
        ownerId,
        fileId,
        { ...payload, ownerId: 'another-owner' },
        Readable.from([content]),
        headers
      )
    ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'File upload not found' })
    await expect(
      putVerifiedFileUploadContent(
        fixture.connection,
        fixture.storage,
        ownerId,
        fileId,
        payload,
        Readable.from([content]),
        { ...headers, contentLength: undefined }
      )
    ).resolves.toMatchObject({ file: { id: fileId, status: 'pending' } })
    await expect(
      putVerifiedFileUploadContent(
        fixture.connection,
        fixture.storage,
        ownerId,
        fileId,
        payload,
        Readable.from([content]),
        { ...headers, contentMd5: md5(Buffer.from('wrong digest')) }
      )
    ).rejects.toMatchObject({ statusCode: 400 })

    const writerFailure = new Error('local writer unavailable')
    const writeVerifiedObject = vi
      .fn()
      .mockRejectedValueOnce(new LocalObjectIntegrityError('DIGEST_MISMATCH'))
      .mockRejectedValueOnce(writerFailure)
      .mockRejectedValueOnce(new LocalObjectAlreadyExistsError())
      .mockRejectedValueOnce(new LocalObjectAlreadyExistsError())
    const headPersistedObject = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ key: objectKey, byteSize: content.length })
    const failingStorage = {
      kind: 'local',
      bucketName: 'local',
      local: { writeVerifiedObject, headPersistedObject }
    } as unknown as ObjectStorage

    await expect(
      putVerifiedFileUploadContent(
        fixture.connection,
        failingStorage,
        ownerId,
        fileId,
        payload,
        Readable.from([content]),
        headers
      )
    ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Uploaded content failed integrity checks' })
    await expect(
      putVerifiedFileUploadContent(
        fixture.connection,
        failingStorage,
        ownerId,
        fileId,
        payload,
        Readable.from([content]),
        headers
      )
    ).rejects.toBe(writerFailure)
    await expect(
      putVerifiedFileUploadContent(
        fixture.connection,
        failingStorage,
        ownerId,
        fileId,
        payload,
        Readable.from([content]),
        headers
      )
    ).rejects.toMatchObject({ statusCode: 409, statusMessage: 'File upload cannot be retried' })
    await expect(
      putVerifiedFileUploadContent(
        fixture.connection,
        failingStorage,
        ownerId,
        fileId,
        payload,
        Readable.from([content]),
        headers
      )
    ).resolves.toMatchObject({ file: { id: fileId, status: 'pending' } })
    expect(fixture.connection.sqlite.prepare('select status from files where id = ?').get(fileId)).toEqual({
      status: 'pending'
    })
  })

  it('keeps completion idempotent and rejects expired, missing, or wrong-sized local objects', async () => {
    const ownerId = 'completion-owner'
    insertUser(fixture.connection, ownerId, 'completion-owner@example.test')
    const now = new Date()
    const content = Buffer.from('completion content')
    const readyId = newFileId()
    await insertFile(fixture.connection, {
      id: readyId,
      ownerId,
      objectKey: objectKeyForFileId(readyId),
      content,
      status: 'ready'
    })
    await expect(
      completeFileUploadForConnection(fixture.connection, fixture.storage, ownerId, readyId, now)
    ).resolves.toMatchObject({ id: readyId, status: 'ready' })

    const expiredId = newFileId()
    await insertFile(fixture.connection, {
      id: expiredId,
      ownerId,
      objectKey: objectKeyForFileId(expiredId),
      content,
      status: 'pending',
      createdAt: new Date(now.getTime() - 120_000),
      uploadExpiresAt: new Date(now.getTime() - 60_000)
    })
    await expect(
      completeFileUploadForConnection(fixture.connection, fixture.storage, ownerId, expiredId, now)
    ).rejects.toMatchObject({ statusCode: 409, statusMessage: 'File upload has expired' })

    const missingId = newFileId()
    await insertFile(fixture.connection, {
      id: missingId,
      ownerId,
      objectKey: objectKeyForFileId(missingId),
      content,
      status: 'pending'
    })
    await expect(
      completeFileUploadForConnection(fixture.connection, fixture.storage, ownerId, missingId, now)
    ).rejects.toMatchObject({ statusCode: 409, statusMessage: 'Uploaded object is missing' })

    const wrongSizeId = newFileId()
    const wrongSizeKey = objectKeyForFileId(wrongSizeId)
    await insertFile(fixture.connection, {
      id: wrongSizeId,
      ownerId,
      objectKey: wrongSizeKey,
      content,
      status: 'pending'
    })
    await writeLocalObject(fixture.local, wrongSizeKey, Buffer.from('wrong'))
    await expect(
      completeFileUploadForConnection(fixture.connection, fixture.storage, ownerId, wrongSizeId, now)
    ).rejects.toMatchObject({ statusCode: 409, statusMessage: 'Uploaded object size does not match' })

    const racedId = newFileId()
    const racedKey = objectKeyForFileId(racedId)
    await insertFile(fixture.connection, {
      id: racedId,
      ownerId,
      objectKey: racedKey,
      content,
      status: 'pending'
    })
    const racedStorage = {
      kind: 'local',
      bucketName: 'local',
      local: {
        headPersistedObject: vi.fn().mockImplementation(() => {
          fixture.connection.sqlite.prepare('delete from files where id = ?').run(racedId)
          return { key: racedKey, byteSize: content.length }
        })
      }
    } as unknown as ObjectStorage
    await expect(
      completeFileUploadForConnection(fixture.connection, racedStorage, ownerId, racedId, now)
    ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'File not found' })

    const ignoredDeletionId = newFileId()
    await insertFile(fixture.connection, {
      id: ignoredDeletionId,
      ownerId,
      objectKey: objectKeyForFileId(ignoredDeletionId),
      content,
      status: 'ready'
    })
    fixture.connection.sqlite.exec(`
      create trigger ignore_one_file_deletion
      before update on files
      when old.id = '${ignoredDeletionId}' and new.status = 'deleted'
      begin
        select raise(ignore);
      end;
    `)
    expect(
      deleteOwnedFileAndScheduleCleanup(fixture.connection, fixture.storage, ownerId, ignoredDeletionId, now)
    ).toBe(false)
    expect(fixture.connection.sqlite.prepare('select status from files where id = ?').get(ignoredDeletionId)).toEqual({
      status: 'ready'
    })
    expect(fixture.connection.sqlite.prepare('select id from job_queue').all()).toEqual([])
    expect(deleteOwnedFileAndScheduleCleanup(fixture.connection, fixture.storage, ownerId, newFileId(), now)).toBe(
      false
    )
  })

  it('issues an R2 download only after persisted owner, bucket, and object checks', async () => {
    const ownerId = 'r2-download-owner'
    insertUser(fixture.connection, ownerId, 'r2-download-owner@example.test')
    const content = Buffer.from('provider download')
    const fileId = newFileId()
    const objectKey = objectKeyForFileId(fileId)
    await insertFile(fixture.connection, {
      id: fileId,
      ownerId,
      bucket: 'private-files',
      objectKey,
      content,
      status: 'ready'
    })
    const download = {
      method: 'GET' as const,
      url: 'https://example.invalid/download-capability',
      headers: {},
      expiresAt: '2026-07-15T12:01:00.000Z'
    }
    const headPersistedObject = vi
      .fn()
      .mockResolvedValueOnce({ key: objectKey, byteSize: content.length })
      .mockResolvedValueOnce({ key: objectKey, byteSize: content.length })
      .mockResolvedValueOnce(null)
    const createDownloadRequest = vi
      .fn()
      .mockResolvedValueOnce(download)
      .mockRejectedValueOnce(new Error('raw signer failure must not escape'))
    const providerStorage = {
      kind: 'r2',
      bucketName: 'private-files',
      endpoint: r2Endpoint,
      r2: { headPersistedObject, createDownloadRequest }
    } as unknown as ObjectStorage

    await expect(
      createPrivateFileDownloadForConnection(fixture.connection, providerStorage, ownerId, fileId)
    ).resolves.toMatchObject({ file: { id: fileId }, download })
    expect(createDownloadRequest).toHaveBeenCalledWith(objectKey)

    await expect(
      createPrivateFileDownloadForConnection(fixture.connection, providerStorage, ownerId, fileId)
    ).rejects.toMatchObject({ statusCode: 503, statusMessage: 'File storage is temporarily unavailable' })

    await expect(
      createPrivateFileDownloadForConnection(fixture.connection, providerStorage, ownerId, fileId)
    ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'Stored file not found' })
    expect(createDownloadRequest).toHaveBeenCalledTimes(2)
  })

  it('returns no upload capability when its durable cleanup wake-up cannot be committed', async () => {
    insertUser(fixture.connection, 'queue-failure-owner', 'queue-failure-owner@example.test')
    fixture.connection.sqlite.exec(`
      create trigger reject_file_cleanup_wakeup
      before insert on job_queue
      when new.type = 'files.cleanup-orphans'
      begin
        select raise(abort, 'cleanup wake-up rejected');
      end;
    `)

    await expect(
      createFileUploadTargetForConnection(fixture.connection, fixture.storage, 'queue-failure-owner', {
        filename: 'not-issued.txt',
        contentType: 'text/plain',
        byteSize: 1,
        contentMd5: md5(Buffer.from('x'))
      })
    ).rejects.toThrow('cleanup wake-up rejected')
    expect(fixture.connection.sqlite.prepare('select id from files').all()).toEqual([])
    expect(fixture.connection.sqlite.prepare('select id from job_queue').all()).toEqual([])
  })

  it('removes bytes from an upload that loses its account/file row before promotion can be committed', async () => {
    const oldOwner = 'late-owner-old'
    insertUser(fixture.connection, oldOwner, 'late-owner@example.test')
    const content = Buffer.from('late upload bytes')
    const fileId = newFileId()
    const objectKey = objectKeyForFileId(fileId)
    const uploadExpiresAt = new Date(Date.now() + 60_000).toISOString()
    initializeStorageBinding(fixture.connection, 'local')
    await createPendingFile(fixture.connection, {
      id: fileId,
      ownerId: oldOwner,
      bucket: 'local',
      objectKey,
      originalName: 'late.txt',
      contentType: 'text/plain',
      byteSize: content.length,
      contentMd5: md5(content),
      uploadExpiresAt
    })

    async function* deletingUpload() {
      yield content
      fixture.connection.sqlite.prepare('delete from organization where personal_owner_user_id = ?').run(oldOwner)
      fixture.connection.sqlite.prepare('delete from user where id = ?').run(oldOwner)
    }

    await expect(
      putVerifiedFileUploadContent(
        fixture.connection,
        fixture.storage,
        oldOwner,
        fileId,
        {
          action: 'upload',
          fileId,
          ownerId: oldOwner,
          expiresAt: uploadExpiresAt,
          byteSize: content.length,
          contentType: 'text/plain',
          contentMd5: md5(content)
        },
        deletingUpload(),
        {
          contentType: 'text/plain',
          contentMd5: md5(content),
          contentLength: String(content.length)
        }
      )
    ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'File upload not found' })
    expect(await fixture.local.headPersistedObject(objectKey)).toBeNull()
    expect(fixture.connection.sqlite.prepare('select id from files where id = ?').get(fileId)).toBeUndefined()

    const newOwner = 'late-owner-new'
    insertUser(fixture.connection, newOwner, 'late-owner@example.test')
    const replacementId = newFileId()
    await insertFile(fixture.connection, {
      id: replacementId,
      ownerId: newOwner,
      objectKey: objectKeyForFileId(replacementId),
      content: Buffer.from('new declaration'),
      status: 'pending'
    })
    expect(fixture.connection.sqlite.prepare('select owner_id from files where id = ?').get(replacementId)).toEqual({
      owner_id: newOwner
    })
    expect(await fixture.local.headPersistedObject(objectKeyForFileId(replacementId))).toBeNull()
  })

  it('does not publish a local upload whose capability expires while its body is streaming', async () => {
    const ownerId = 'expiring-stream-owner'
    insertUser(fixture.connection, ownerId, 'expiring-stream-owner@example.test')
    const content = Buffer.from('expires between stream chunks')
    const fileId = newFileId()
    const objectKey = objectKeyForFileId(fileId)
    const startedAt = new Date()
    const uploadExpiresAt = new Date(startedAt.getTime() + 60_000)
    initializeStorageBinding(fixture.connection, 'local')
    await createPendingFile(fixture.connection, {
      id: fileId,
      ownerId,
      bucket: 'local',
      objectKey,
      originalName: 'expiring.txt',
      contentType: 'text/plain',
      byteSize: content.length,
      contentMd5: md5(content),
      uploadExpiresAt: uploadExpiresAt.toISOString()
    })
    let currentTime = startedAt

    async function* expiringBody() {
      yield content.subarray(0, 8)
      currentTime = new Date(uploadExpiresAt.getTime() + 1)
      yield content.subarray(8)
    }

    await expect(
      putVerifiedFileUploadContent(
        fixture.connection,
        fixture.storage,
        ownerId,
        fileId,
        {
          action: 'upload',
          fileId,
          ownerId,
          expiresAt: uploadExpiresAt.toISOString(),
          byteSize: content.length,
          contentType: 'text/plain',
          contentMd5: md5(content)
        },
        expiringBody(),
        {
          contentType: 'text/plain',
          contentMd5: md5(content),
          contentLength: String(content.length)
        },
        { now: () => currentTime }
      )
    ).rejects.toMatchObject({ statusCode: 409, statusMessage: 'File upload has expired' })

    expect(await fixture.local.headPersistedObject(objectKey)).toBeNull()
    expect(fixture.connection.sqlite.prepare('select status from files where id = ?').get(fileId)).toEqual({
      status: 'pending'
    })
  })

  it('fails closed before provider I/O when the configured driver or bucket differs from persisted state', async () => {
    insertUser(fixture.connection, 'binding-owner', 'binding-owner@example.test')
    const content = Buffer.from('bound local bytes')
    const readyId = newFileId()
    const readyKey = objectKeyForFileId(readyId)
    await insertFile(fixture.connection, {
      id: readyId,
      ownerId: 'binding-owner',
      objectKey: readyKey,
      content,
      status: 'ready'
    })
    await writeLocalObject(fixture.local, readyKey, content)
    assertFileStorageBinding(fixture.connection, fixture.storage, { initialize: true })

    const headPersistedObject = vi.fn()
    const deleteObjects = vi.fn()
    const wrongStorage = {
      kind: 'r2',
      bucketName: 'different-private-bucket',
      endpoint: r2Endpoint,
      r2: { headPersistedObject, deleteObjects }
    } as unknown as ObjectStorage

    await expect(
      createPrivateFileDownloadForConnection(fixture.connection, wrongStorage, 'binding-owner', readyId)
    ).rejects.toMatchObject({ statusCode: 503, statusMessage: 'File storage is temporarily unavailable' })
    expect(() => deleteOwnedFileAndScheduleCleanup(fixture.connection, wrongStorage, 'binding-owner', readyId)).toThrow(
      'File storage is temporarily unavailable'
    )
    expect(fixture.connection.sqlite.prepare('select status from files where id = ?').get(readyId)).toEqual({
      status: 'ready'
    })

    const deletedId = newFileId()
    const deletedKey = objectKeyForFileId(deletedId)
    const now = new Date()
    await insertFile(fixture.connection, {
      id: deletedId,
      ownerId: 'binding-owner',
      objectKey: deletedKey,
      content,
      status: 'deleted',
      createdAt: new Date(now.getTime() - 180_000),
      uploadExpiresAt: new Date(now.getTime() - 120_000),
      deletedAt: new Date(now.getTime() - 90_000)
    })
    await expect(
      cleanupOrphanedFileObjectsForConnection(
        fixture.connection,
        { phase: 'deleted-metadata' },
        { storage: wrongStorage, now, enqueueNext: () => undefined }
      )
    ).rejects.toThrow('Configured file storage does not match the persisted storage binding')
    expect(fixture.connection.sqlite.prepare('select status from files where id = ?').get(deletedId)).toEqual({
      status: 'deleted'
    })
    expect(headPersistedObject).not.toHaveBeenCalled()
    expect(deleteObjects).not.toHaveBeenCalled()
    expect(await fixture.local.headPersistedObject(readyKey)).toEqual({ key: readyKey, byteSize: content.length })
  })

  it('deletes only the removed account objects and retries cleanup without delaying identity deletion', async () => {
    insertUser(fixture.connection, 'removed-owner', 'removed-owner@example.test')
    insertUser(fixture.connection, 'retained-invitee', 'retained-invitee@example.test')
    const family = fixture.connection.sqlite
      .prepare("select id from organization where personal_owner_user_id = 'removed-owner'")
      .get() as { id: string }
    fixture.connection.sqlite
      .prepare(
        `insert into member (id, organization_id, user_id, role, created_at)
         values (?, ?, 'retained-invitee', 'member', ?)`
      )
      .run(`member_${randomUUID()}`, family.id, Date.now())
    const now = new Date()
    const createdAt = new Date(now.getTime() - 20 * 60_000)
    const uploadExpiresAt = new Date(now.getTime() - 5 * 60_000)
    const ownerContent = Buffer.from('removed owner private bytes')
    const inviteeContent = Buffer.from('retained invitee private bytes')
    const ownerId = newFileId()
    const inviteeId = newFileId()
    const ownerKey = objectKeyForFileId(ownerId)
    const inviteeKey = objectKeyForFileId(inviteeId)

    await insertFile(fixture.connection, {
      id: ownerId,
      ownerId: 'removed-owner',
      objectKey: ownerKey,
      content: ownerContent,
      status: 'ready',
      createdAt,
      uploadExpiresAt
    })
    await insertFile(fixture.connection, {
      id: inviteeId,
      ownerId: 'retained-invitee',
      objectKey: inviteeKey,
      content: inviteeContent,
      status: 'ready',
      createdAt,
      uploadExpiresAt
    })
    await writeLocalObject(fixture.local, ownerKey, ownerContent)
    await writeLocalObject(fixture.local, inviteeKey, inviteeContent)
    assertFileStorageBinding(fixture.connection, fixture.storage, { initialize: true })

    expect(
      deleteAccountAtomically(
        fixture.connection,
        { id: 'removed-owner', email: 'removed-owner@example.test' },
        { deletedAt: now.toISOString() }
      )
    ).toMatchObject({ status: 'deleted', deletedFiles: 1 })
    expect(fixture.connection.sqlite.prepare("select id from user where id = 'removed-owner'").get()).toBeUndefined()
    expect(fixture.connection.sqlite.prepare("select id from user where id = 'retained-invitee'").get()).toEqual({
      id: 'retained-invitee'
    })
    expect(await fixture.local.headPersistedObject(ownerKey)).not.toBeNull()
    expect(await fixture.local.headPersistedObject(inviteeKey)).not.toBeNull()

    const deferred: Array<{ payload: unknown; runAfter?: string }> = []
    await cleanupOrphanedFileObjectsForConnection(
      fixture.connection,
      { phase: 'reconcile-v1' },
      {
        storage: fixture.storage,
        now,
        enqueueNext: (payload, options) => deferred.push({ payload, runAfter: options?.runAfter })
      }
    )
    expect(deferred).toEqual([
      {
        payload: { phase: 'reconcile-v1' },
        runAfter: new Date(now.getTime() + fileCleanupSchedulingMarginMs).toISOString()
      }
    ])

    const deleteObjects = vi
      .fn<(keys: readonly string[]) => Promise<void>>()
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockImplementation((keys) => fixture.local.deleteObjects(keys))
    const retryingStorage = {
      kind: 'local',
      bucketName: 'local',
      local: {
        listPage: fixture.local.listPage.bind(fixture.local),
        deleteObjects
      }
    } as unknown as ObjectStorage
    const cleanupAt = new Date(now.getTime() + fileCleanupSchedulingMarginMs + 1)

    await expect(
      cleanupOrphanedFileObjectsForConnection(
        fixture.connection,
        { phase: 'reconcile-v1' },
        { storage: retryingStorage, now: cleanupAt, enqueueNext: () => undefined }
      )
    ).rejects.toThrow('provider unavailable')
    expect(await fixture.local.headPersistedObject(ownerKey)).not.toBeNull()
    expect(await fixture.local.headPersistedObject(inviteeKey)).not.toBeNull()

    await cleanupOrphanedFileObjectsForConnection(
      fixture.connection,
      { phase: 'reconcile-v1' },
      { storage: retryingStorage, now: cleanupAt, enqueueNext: () => undefined }
    )
    expect(await fixture.local.headPersistedObject(ownerKey)).toBeNull()
    expect(await fixture.local.headPersistedObject(inviteeKey)).toEqual({
      key: inviteeKey,
      byteSize: inviteeContent.length
    })
    expect(fixture.connection.sqlite.prepare('select owner_id from files').all()).toEqual([
      { owner_id: 'retained-invitee' }
    ])
  })

  it('rechecks the account-deletion watermark atomically after provider listing', async () => {
    const ownerId = 'listed-deletion-owner'
    insertUser(fixture.connection, ownerId, 'listed-deletion-owner@example.test')
    const now = new Date('2026-07-15T12:00:00.000Z')
    const uploadExpiresAt = new Date(now.getTime() + 5 * 60_000)
    const content = Buffer.from('listed before account deletion')
    const fileId = newFileId()
    const objectKey = objectKeyForFileId(fileId)
    await insertFile(fixture.connection, {
      id: fileId,
      ownerId,
      objectKey,
      content,
      status: 'ready',
      createdAt: now,
      uploadExpiresAt
    })
    await writeLocalObject(fixture.local, objectKey, content)
    assertFileStorageBinding(fixture.connection, fixture.storage, { initialize: true })
    const scheduled: Array<{ payload: unknown; runAfter?: string }> = []

    await expect(
      cleanupOrphanedFileObjectsForConnection(
        fixture.connection,
        { phase: 'reconcile-v1' },
        {
          storage: fixture.storage,
          now,
          checkpoint: (checkpoint) => {
            if (checkpoint !== 'reconcile-v1-listed') return
            expect(
              deleteAccountAtomically(
                fixture.connection,
                { id: ownerId, email: 'listed-deletion-owner@example.test' },
                { deletedAt: now.toISOString() }
              )
            ).toMatchObject({ status: 'deleted', deletedFiles: 1 })
          },
          enqueueNext: (payload, options) => scheduled.push({ payload, runAfter: options?.runAfter })
        }
      )
    ).resolves.toMatchObject({
      phase: 'reconcile-v1',
      deletedObjects: 0,
      nextScheduled: true,
      deferredUntil: new Date(uploadExpiresAt.getTime() + fileCleanupSchedulingMarginMs).toISOString()
    })

    expect(await fixture.local.headPersistedObject(objectKey)).toEqual({ key: objectKey, byteSize: content.length })
    expect(fixture.connection.sqlite.prepare('select id from files where id = ?').get(fileId)).toBeUndefined()
    expect(scheduled).toEqual([
      {
        payload: { phase: 'reconcile-v1' },
        runAfter: new Date(uploadExpiresAt.getTime() + fileCleanupSchedulingMarginMs).toISOString()
      }
    ])
  })
})

describe('file orphan cleanup', () => {
  it('expires pending metadata first and removes its object and tombstone on the next phase', async () => {
    insertUser(fixture.connection, 'expiry-owner', 'expiry-owner@example.test')
    const content = Buffer.from('expired upload')
    const fileId = newFileId()
    const objectKey = objectKeyForFileId(fileId)
    const now = new Date()
    await insertFile(fixture.connection, {
      id: fileId,
      ownerId: 'expiry-owner',
      objectKey,
      content,
      status: 'pending',
      createdAt: new Date(now.getTime() - 120_000),
      uploadExpiresAt: new Date(now.getTime() - 60_000)
    })
    const nearExpiryId = newFileId()
    await insertFile(fixture.connection, {
      id: nearExpiryId,
      ownerId: 'expiry-owner',
      objectKey: objectKeyForFileId(nearExpiryId),
      content,
      status: 'pending',
      createdAt: new Date(now.getTime() - 120_000),
      uploadExpiresAt: new Date(now.getTime() - 30_000)
    })
    await writeLocalObject(fixture.local, objectKey, content)
    const scheduled: unknown[] = []

    await expect(
      cleanupOrphanedFileObjectsForConnection(
        fixture.connection,
        {},
        {
          storage: fixture.storage,
          now,
          enqueueNext: (payload) => scheduled.push(payload)
        }
      )
    ).resolves.toMatchObject({ phase: 'expired-pending', claimedExpiredPendingFiles: 1, deletedObjects: 0 })
    expect(fixture.connection.sqlite.prepare('select status from files where id = ?').get(fileId)).toEqual({
      status: 'deleted'
    })
    expect(fixture.connection.sqlite.prepare('select status from files where id = ?').get(nearExpiryId)).toEqual({
      status: 'pending'
    })
    expect(await fixture.local.headPersistedObject(objectKey)).toEqual({ key: objectKey, byteSize: content.length })
    expect(scheduled).toEqual([{ phase: 'deleted-metadata' }])

    await cleanupOrphanedFileObjectsForConnection(
      fixture.connection,
      scheduled.pop() as { phase: 'deleted-metadata' },
      {
        storage: fixture.storage,
        now,
        enqueueNext: (payload) => scheduled.push(payload)
      }
    )
    expect(await fixture.local.headPersistedObject(objectKey)).toBeNull()
    expect(fixture.connection.sqlite.prepare('select id from files where id = ?').get(fileId)).toBeUndefined()
    expect(scheduled).toEqual([{ phase: 'reconcile-v1' }])
  })

  it('continues full metadata pages when one listed pending row changes before it is claimed', async () => {
    const ownerId = 'full-cleanup-page-owner'
    insertUser(fixture.connection, ownerId, 'full-cleanup-page@example.test')
    const now = new Date('2026-07-15T12:00:00.000Z')
    const uploadExpiresAt = new Date(now.getTime() - 2 * fileCleanupSchedulingMarginMs)
    const fileIds: string[] = []

    for (let index = 0; index < fileCleanupPageSize; index += 1) {
      const fileId = newFileId()
      fileIds.push(fileId)
      await insertFile(fixture.connection, {
        id: fileId,
        ownerId,
        objectKey: objectKeyForFileId(fileId),
        content: Buffer.from(`expired-${index}`),
        status: 'pending',
        createdAt: new Date(uploadExpiresAt.getTime() - 60_000),
        uploadExpiresAt
      })
    }

    const scheduled: unknown[] = []
    await expect(
      cleanupOrphanedFileObjectsForConnection(
        fixture.connection,
        {},
        {
          storage: fixture.storage,
          now,
          checkpoint: (name) => {
            if (name !== 'expired-pending-listed') return
            fixture.connection.sqlite
              .prepare("update files set status = 'deleted', deleted_at = ?, updated_at = ? where id = ?")
              .run(now.toISOString(), now.toISOString(), fileIds[0])
          },
          enqueueNext: (payload) => scheduled.push(payload)
        }
      )
    ).resolves.toMatchObject({
      phase: 'expired-pending',
      claimedExpiredPendingFiles: fileCleanupPageSize - 1,
      nextScheduled: true
    })
    expect(scheduled).toEqual([{ phase: 'expired-pending' }])

    scheduled.length = 0
    await expect(
      cleanupOrphanedFileObjectsForConnection(
        fixture.connection,
        { phase: 'deleted-metadata' },
        { storage: fixture.storage, now, enqueueNext: (payload) => scheduled.push(payload) }
      )
    ).resolves.toMatchObject({
      phase: 'deleted-metadata',
      deletedObjects: fileCleanupPageSize,
      removedDeletedMetadata: fileCleanupPageSize,
      nextScheduled: true
    })
    expect(scheduled).toEqual([{ phase: 'deleted-metadata' }])
    expect(fixture.connection.sqlite.prepare('select id from files').all()).toEqual([])
  })

  it('retains deleted metadata when provider deletion fails and converges on retry', async () => {
    insertUser(fixture.connection, 'cleanup-retry-owner', 'cleanup-retry@example.test')
    const content = Buffer.from('retry cleanup bytes')
    const fileId = newFileId()
    const objectKey = objectKeyForFileId(fileId)
    const now = new Date()
    await insertFile(fixture.connection, {
      id: fileId,
      ownerId: 'cleanup-retry-owner',
      bucket: 'private-files',
      objectKey,
      content,
      status: 'deleted',
      createdAt: new Date(now.getTime() - 120_000),
      uploadExpiresAt: new Date(now.getTime() - 60_000),
      deletedAt: new Date(now.getTime() - 30_000)
    })
    const deleteObjects = vi
      .fn()
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce(undefined)
    const providerStorage = {
      kind: 'r2',
      bucketName: 'private-files',
      endpoint: r2Endpoint,
      r2: { deleteObjects }
    } as unknown as ObjectStorage
    const scheduled: unknown[] = []

    await expect(
      cleanupOrphanedFileObjectsForConnection(
        fixture.connection,
        { phase: 'deleted-metadata' },
        { storage: providerStorage, now, enqueueNext: (payload) => scheduled.push(payload) }
      )
    ).rejects.toThrow('provider unavailable')
    expect(fixture.connection.sqlite.prepare('select status from files where id = ?').get(fileId)).toEqual({
      status: 'deleted'
    })
    expect(scheduled).toEqual([])

    await cleanupOrphanedFileObjectsForConnection(
      fixture.connection,
      { phase: 'deleted-metadata' },
      { storage: providerStorage, now, enqueueNext: (payload) => scheduled.push(payload) }
    )
    expect(deleteObjects).toHaveBeenNthCalledWith(1, [objectKey])
    expect(deleteObjects).toHaveBeenNthCalledWith(2, [objectKey])
    expect(fixture.connection.sqlite.prepare('select id from files where id = ?').get(fileId)).toBeUndefined()
    expect(scheduled).toEqual([{ phase: 'reconcile-v1' }])
  })

  it('passes a bounded provider page and opaque continuation token without deleting tracked objects', async () => {
    insertUser(fixture.connection, 'pagination-owner', 'pagination-owner@example.test')
    const keys: string[] = []
    for (let index = 0; index < fileCleanupPageSize + 1; index += 1) {
      const fileId = newFileId()
      const objectKey = objectKeyForFileId(fileId)
      keys.push(objectKey)
      await insertFile(fixture.connection, {
        id: fileId,
        ownerId: 'pagination-owner',
        bucket: 'private-files',
        objectKey,
        content: Buffer.from(`tracked-${index}`),
        status: 'ready'
      })
    }

    const continuationToken = 'opaque-provider-page-two'
    const listPage = vi
      .fn()
      .mockResolvedValueOnce({ keys: keys.slice(0, fileCleanupPageSize), nextContinuationToken: continuationToken })
      .mockResolvedValueOnce({ keys: keys.slice(fileCleanupPageSize), nextContinuationToken: undefined })
    const deleteObjects = vi.fn().mockResolvedValue(undefined)
    const providerStorage = {
      kind: 'r2',
      bucketName: 'private-files',
      endpoint: r2Endpoint,
      r2: { listPage, deleteObjects }
    } as unknown as ObjectStorage
    const scheduled: Array<{ phase?: string; cursor?: string }> = []

    await cleanupOrphanedFileObjectsForConnection(
      fixture.connection,
      { phase: 'reconcile-v1' },
      { storage: providerStorage, enqueueNext: (payload) => scheduled.push(payload) }
    )
    expect(scheduled.shift()).toEqual({ phase: 'reconcile-v1', cursor: continuationToken })

    await cleanupOrphanedFileObjectsForConnection(
      fixture.connection,
      { phase: 'reconcile-v1', cursor: continuationToken },
      { storage: providerStorage, enqueueNext: (payload) => scheduled.push(payload) }
    )
    expect(listPage.mock.calls).toEqual([
      [{ prefix: 'files/v1/', continuationToken: undefined, limit: fileCleanupPageSize }],
      [{ prefix: 'files/v1/', continuationToken, limit: fileCleanupPageSize }]
    ])
    expect(deleteObjects).not.toHaveBeenCalled()
    expect(scheduled).toEqual([])
    expect(
      fixture.connection.sqlite.prepare("select count(*) as count from files where status = 'ready'").get()
    ).toEqual({ count: fileCleanupPageSize + 1 })
  })

  it('keeps sequential provider cleanup beneath the fixed queue lease', async () => {
    const keys = Array.from({ length: fileCleanupPageSize }, () => objectKeyForFileId(newFileId()))
    const listPage = vi.fn().mockResolvedValue({ keys, nextContinuationToken: undefined })
    const deleteObjects = vi.fn().mockResolvedValue(undefined)
    const providerStorage = {
      kind: 'r2',
      bucketName: 'private-files',
      endpoint: r2Endpoint,
      r2: { listPage, deleteObjects }
    } as unknown as ObjectStorage
    const scheduled: unknown[] = []
    assertFileStorageBinding(fixture.connection, providerStorage, { initialize: true })

    await expect(
      cleanupOrphanedFileObjectsForConnection(
        fixture.connection,
        { phase: 'reconcile-v1' },
        { storage: providerStorage, enqueueNext: (payload) => scheduled.push(payload) }
      )
    ).resolves.toMatchObject({ deletedObjects: fileCleanupPageSize, nextScheduled: true })

    expect(listPage).toHaveBeenCalledWith({
      prefix: 'files/v1/',
      continuationToken: undefined,
      limit: fileCleanupPageSize
    })
    expect(deleteObjects.mock.calls).toEqual(keys.map((key) => [[key]]))
    expect(scheduled).toEqual([{ phase: 'reconcile-v1' }])
  })

  it('restarts from the phase root after a non-root page is partially mutated', async () => {
    const keys = Array.from({ length: 3 }, () => objectKeyForFileId(newFileId()))
    const listPage = vi.fn().mockResolvedValue({ keys, nextContinuationToken: 'opaque-page-three' })
    const order: string[] = []
    const deleteObjects = vi
      .fn()
      .mockImplementationOnce(async () => {
        order.push('delete')
      })
      .mockImplementationOnce(async () => {
        order.push('delete')
        throw new Error('one object is temporarily unavailable')
      })
      .mockImplementationOnce(async () => {
        order.push('delete')
      })
    const providerStorage = {
      kind: 'r2',
      bucketName: 'private-files',
      endpoint: r2Endpoint,
      r2: { listPage, deleteObjects }
    } as unknown as ObjectStorage
    const now = new Date('2026-07-15T12:00:00.000Z')
    const scheduled: Array<{ payload: unknown; runAfter?: string }> = []
    assertFileStorageBinding(fixture.connection, providerStorage, { initialize: true })

    await expect(
      cleanupOrphanedFileObjectsForConnection(
        fixture.connection,
        { phase: 'reconcile-v1', cursor: 'opaque-page-two' },
        {
          storage: providerStorage,
          now,
          enqueueNext: (payload, options) => {
            order.push('enqueue')
            scheduled.push({ payload, runAfter: options?.runAfter })
          }
        }
      )
    ).resolves.toMatchObject({
      phase: 'reconcile-v1',
      deletedObjects: 2,
      nextScheduled: true,
      deletionRetryScheduled: true
    })

    expect(listPage).toHaveBeenCalledWith({
      prefix: 'files/v1/',
      continuationToken: 'opaque-page-two',
      limit: fileCleanupPageSize
    })
    expect(deleteObjects.mock.calls).toEqual(keys.map((key) => [[key]]))
    expect(order).toEqual(['enqueue', 'delete', 'delete', 'delete'])
    expect(scheduled).toEqual([
      {
        payload: { phase: 'reconcile-v1' },
        runAfter: new Date(now.getTime() + fileCleanupRetryDelayMs).toISOString()
      }
    ])
  })

  it('retains a precommitted non-root restart when every provider deletion fails', async () => {
    const key = objectKeyForFileId(newFileId())
    const listPage = vi.fn().mockResolvedValue({ keys: [key], nextContinuationToken: undefined })
    const deleteObjects = vi.fn().mockRejectedValue(new Error('provider unavailable'))
    const providerStorage = {
      kind: 'r2',
      bucketName: 'private-files',
      endpoint: r2Endpoint,
      r2: { listPage, deleteObjects }
    } as unknown as ObjectStorage
    const now = new Date('2026-07-15T12:00:00.000Z')
    const scheduled: Array<{ payload: unknown; runAfter?: string }> = []
    assertFileStorageBinding(fixture.connection, providerStorage, { initialize: true })

    await expect(
      cleanupOrphanedFileObjectsForConnection(
        fixture.connection,
        { phase: 'reconcile-v1', cursor: 'opaque-page-two' },
        {
          storage: providerStorage,
          now,
          enqueueNext: (payload, options) => scheduled.push({ payload, runAfter: options?.runAfter })
        }
      )
    ).resolves.toMatchObject({
      phase: 'reconcile-v1',
      deletedObjects: 0,
      nextScheduled: true,
      deletionRetryScheduled: true
    })
    expect(scheduled).toEqual([
      {
        payload: { phase: 'reconcile-v1' },
        runAfter: new Date(now.getTime() + fileCleanupRetryDelayMs).toISOString()
      }
    ])
  })

  it('schedules a root restart after a root page is partially mutated', async () => {
    const keys = [objectKeyForFileId(newFileId()), objectKeyForFileId(newFileId())]
    const listPage = vi.fn().mockResolvedValue({ keys, nextContinuationToken: undefined })
    const deleteObjects = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('provider unavailable'))
    const providerStorage = {
      kind: 'r2',
      bucketName: 'private-files',
      endpoint: r2Endpoint,
      r2: { listPage, deleteObjects }
    } as unknown as ObjectStorage
    const now = new Date('2026-07-15T12:00:00.000Z')
    const scheduled: Array<{ payload: unknown; runAfter?: string }> = []
    assertFileStorageBinding(fixture.connection, providerStorage, { initialize: true })

    await expect(
      cleanupOrphanedFileObjectsForConnection(
        fixture.connection,
        { phase: 'reconcile-v1' },
        {
          storage: providerStorage,
          now,
          enqueueNext: (payload, options) => scheduled.push({ payload, runAfter: options?.runAfter })
        }
      )
    ).resolves.toMatchObject({
      phase: 'reconcile-v1',
      deletedObjects: 1,
      nextScheduled: true,
      deletionRetryScheduled: true
    })
    expect(scheduled).toEqual([
      {
        payload: { phase: 'reconcile-v1' },
        runAfter: new Date(now.getTime() + fileCleanupRetryDelayMs).toISOString()
      }
    ])
  })

  it('uses only the precommitted root restart after a successful non-root mutation', async () => {
    const key = objectKeyForFileId(newFileId())
    const listPage = vi.fn().mockResolvedValue({ keys: [key], nextContinuationToken: undefined })
    const deleteObjects = vi.fn().mockResolvedValue(undefined)
    const providerStorage = {
      kind: 'r2',
      bucketName: 'private-files',
      endpoint: r2Endpoint,
      r2: { listPage, deleteObjects }
    } as unknown as ObjectStorage
    const now = new Date('2026-07-15T12:00:00.000Z')
    const scheduled: Array<{ payload: unknown; runAfter?: string }> = []
    assertFileStorageBinding(fixture.connection, providerStorage, { initialize: true })

    await expect(
      cleanupOrphanedFileObjectsForConnection(
        fixture.connection,
        { phase: 'reconcile-v1', cursor: 'opaque-page-two' },
        {
          storage: providerStorage,
          now,
          enqueueNext: (payload, options) => scheduled.push({ payload, runAfter: options?.runAfter })
        }
      )
    ).resolves.toEqual({ phase: 'reconcile-v1', deletedObjects: 1, nextScheduled: true })
    expect(scheduled).toEqual([
      {
        payload: { phase: 'reconcile-v1' },
        runAfter: new Date(now.getTime() + fileCleanupRetryDelayMs).toISOString()
      }
    ])
  })

  it('does not mutate a non-root provider page until its phase-root restart is durable', async () => {
    const key = objectKeyForFileId(newFileId())
    const listPage = vi.fn().mockResolvedValue({ keys: [key], nextContinuationToken: undefined })
    const deleteObjects = vi.fn()
    const providerStorage = {
      kind: 'r2',
      bucketName: 'private-files',
      endpoint: r2Endpoint,
      r2: { listPage, deleteObjects }
    } as unknown as ObjectStorage
    assertFileStorageBinding(fixture.connection, providerStorage, { initialize: true })

    await expect(
      cleanupOrphanedFileObjectsForConnection(
        fixture.connection,
        { phase: 'reconcile-v1', cursor: 'opaque-page-two' },
        {
          storage: providerStorage,
          enqueueNext: () => {
            throw new Error('queue unavailable')
          }
        }
      )
    ).rejects.toThrow('queue unavailable')

    expect(deleteObjects).not.toHaveBeenCalled()
  })

  it('rejects malformed cleanup payloads before storage or metadata work', async () => {
    const listPage = vi.fn()
    const deleteObjects = vi.fn()
    const providerStorage = {
      kind: 'r2',
      bucketName: 'private-files',
      endpoint: r2Endpoint,
      r2: { listPage, deleteObjects }
    } as unknown as ObjectStorage

    for (const payload of [
      null,
      [],
      { extra: true },
      { phase: 'unknown' },
      { phase: 'reconcile-v1', cursor: 42 },
      { phase: 'reconcile-v1', cursor: '' },
      { phase: 'deleted-metadata', cursor: 'provider-cursor' }
    ]) {
      await expect(
        cleanupOrphanedFileObjectsForConnection(fixture.connection, payload, {
          storage: providerStorage,
          enqueueNext: () => undefined
        })
      ).rejects.toThrow('File cleanup payload is invalid')
    }

    expect(listPage).not.toHaveBeenCalled()
    expect(deleteObjects).not.toHaveBeenCalled()
  })

  it('uses the durable default scheduler for the cleanup phase chain', async () => {
    await cleanupOrphanedFileObjectsForConnection(fixture.connection, {}, { storage: fixture.storage })
    expect(
      fixture.connection.sqlite
        .prepare("select payload, max_attempts as maxAttempts from job_queue where type = 'files.cleanup-orphans'")
        .all()
    ).toEqual([{ payload: '{"phase":"deleted-metadata"}', maxAttempts: 2_147_483_647 }])
  })

  it('durably defers reconciliation through the default scheduler', async () => {
    const now = new Date('2026-07-15T12:00:00.000Z')
    const runAfter = new Date(now.getTime() + fileCleanupSchedulingMarginMs).toISOString()
    assertFileStorageBinding(fixture.connection, fixture.storage, { initialize: true })
    deferFileStorageReconciliation(fixture.connection, runAfter)

    await expect(
      cleanupOrphanedFileObjectsForConnection(
        fixture.connection,
        { phase: 'reconcile-v1' },
        { storage: fixture.storage, now }
      )
    ).resolves.toMatchObject({ phase: 'reconcile-v1', deferredUntil: runAfter, nextScheduled: true })
    expect(
      fixture.connection.sqlite
        .prepare(
          "select payload, run_after as runAfter from job_queue where type = 'files.cleanup-orphans' order by id"
        )
        .all()
    ).toEqual([{ payload: '{"phase":"reconcile-v1"}', runAfter }])
  })

  it('deduplicates the worker safety sweep and restores it after the prior chain terminates', () => {
    const now = new Date('2026-07-15T12:00:00.000Z')
    const runAfter = new Date(now.getTime() + fileReconciliationSafetyIntervalMs).toISOString()

    expect(ensureFileReconciliationSafetyJob(fixture.connection, now)).toBe('unbound')
    assertFileStorageBinding(fixture.connection, fixture.storage, { initialize: true })
    fixture.connection.sqlite
      .prepare(
        'insert into job_queue (type, payload, max_attempts) values (\'files.cleanup-orphans\', \'{"phase":"reconcile-v1","cursor":"opaque-active-page"}\', ?)'
      )
      .run(2_147_483_647)

    expect(ensureFileReconciliationSafetyJob(fixture.connection, now)).toBe('scheduled')
    expect(ensureFileReconciliationSafetyJob(fixture.connection, now)).toBe('covered-future')
    expect(
      fixture.connection.sqlite
        .prepare(
          "select id, payload, max_attempts as maxAttempts, run_after as runAfter from job_queue where type = 'files.cleanup-orphans' and status = 'queued' and payload = '{}'"
        )
        .all()
    ).toEqual([
      {
        id: expect.any(Number),
        payload: '{}',
        maxAttempts: 2_147_483_647,
        runAfter
      }
    ])

    fixture.connection.sqlite
      .prepare(
        "update job_queue set run_after = null where type = 'files.cleanup-orphans' and status = 'queued' and payload = '{}'"
      )
      .run()
    expect(ensureFileReconciliationSafetyJob(fixture.connection, now)).toBe('covered-active')

    fixture.connection.sqlite
      .prepare("update job_queue set status = 'succeeded' where type = 'files.cleanup-orphans' and payload = '{}'")
      .run()
    const later = new Date(now.getTime() + 1_000)
    expect(ensureFileReconciliationSafetyJob(fixture.connection, later)).toBe('scheduled')
    expect(
      fixture.connection.sqlite
        .prepare(
          "select count(*) as count from job_queue where type = 'files.cleanup-orphans' and status = 'queued' and payload = '{}'"
        )
        .get()
    ).toEqual({ count: 1 })

    fixture.connection.sqlite
      .prepare(
        "update job_queue set attempts = max_attempts where type = 'files.cleanup-orphans' and status = 'queued' and payload = '{}'"
      )
      .run()
    expect(ensureFileReconciliationSafetyJob(fixture.connection, new Date(now.getTime() + 2_000))).toBe('scheduled')
    expect(
      fixture.connection.sqlite
        .prepare(
          "select count(*) as count from job_queue where type = 'files.cleanup-orphans' and status = 'queued' and payload = '{}' and attempts < max_attempts"
        )
        .get()
    ).toEqual({ count: 1 })
  })
})

function createFixture(directory: string) {
  const databasePath = join(directory, 'app.sqlite')
  const sqlite = new Database(databasePath)
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle({ client: sqlite, schema })
  migrate(db, { migrationsFolder })
  const connection: DatabaseConnection = { sqlite, db, databasePath }
  const objectRoot = resolveLocalObjectStoragePath(`file:${databasePath}`)
  expect(dirname(objectRoot)).toBe(dirname(databasePath))
  const local = new LocalObjectStorage(objectRoot, cursorSecret)
  const storage = { kind: 'local', bucketName: 'local', local } as const
  return { directory, connection, local, storage }
}

function insertUser(connection: DatabaseConnection, id: string, email: string) {
  connection.sqlite
    .prepare('insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)')
    .run(id, id, email, Date.now(), Date.now())
}

async function insertFile(
  connection: DatabaseConnection,
  input: {
    id: string
    ownerId: string
    bucket?: string
    objectKey: string
    content: Buffer
    status: 'pending' | 'ready' | 'deleted'
    createdAt?: Date
    uploadExpiresAt?: Date
    deletedAt?: Date
  }
) {
  initializeStorageBinding(connection, input.bucket ?? 'local')
  const createdAt = input.createdAt ?? new Date()
  const uploadExpiresAt = input.uploadExpiresAt ?? new Date(createdAt.getTime() + 15 * 60 * 1000)
  await connection.db.insert(files).values({
    id: input.id,
    ownerId: input.ownerId,
    bucket: input.bucket ?? 'local',
    objectKey: input.objectKey,
    originalName: 'private.txt',
    contentType: 'text/plain',
    byteSize: input.content.length,
    contentMd5: md5(input.content),
    status: input.status,
    uploadExpiresAt: uploadExpiresAt.toISOString(),
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
    deletedAt: input.status === 'deleted' ? (input.deletedAt ?? createdAt).toISOString() : null
  })
}

function initializeStorageBinding(connection: DatabaseConnection, bucket: string) {
  const storage =
    bucket === 'local'
      ? ({ kind: 'local', bucketName: 'local' } as unknown as ObjectStorage)
      : ({ kind: 'r2', bucketName: bucket, endpoint: r2Endpoint, r2: {} } as unknown as ObjectStorage)
  assertFileStorageBinding(connection, storage, { initialize: true })
}

function writeLocalObject(storage: LocalObjectStorage, key: string, content: Buffer) {
  return storage.writeVerifiedObject({
    key,
    body: Readable.from([content]),
    expectedByteSize: content.length,
    expectedContentMd5: md5(content)
  })
}

function newFileId() {
  return `file_${randomUUID()}`
}

function md5(content: Buffer) {
  return createHash('md5').update(content).digest('base64')
}

async function collect(stream: Readable) {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}
