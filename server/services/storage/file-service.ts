import type { Readable } from 'node:stream'
import { createError } from 'h3'
import type { DatabaseConnection } from '../../db/connect'
import type { CreateFileUploadRequest, FileMetadata } from '../../db/schema'
import { contentTypeSchema } from '../../db/schema'
import {
  admitPendingFileUpload,
  FileUploadInitiationRateLimitError,
  getFileForOwner,
  listFilesForOwner,
  markFileReady,
  PendingFileUploadLimitError,
  type FileListCursor
} from '../../db/repositories/files'
import { useDatabase } from '../../db/client'
import type { AppSession } from '../../utils/auth/require-session'
import { conflictError, notFoundError, upstreamServiceError, validationError } from '../../utils/errors'
import {
  createFileDownloadToken,
  createFileUploadToken,
  verifyFileDownloadToken,
  verifyFileUploadToken,
  type FileUploadTokenPayload
} from './file-tokens'
import { fileCleanupSchedulingMarginMs, fileDownloadTokenTtlMs } from './file-policy'
import {
  assertFileBucketMatchesStorage,
  assertFileStorageBinding,
  FileStorageBindingError
} from './file-storage-binding'
import { LocalObjectAlreadyExistsError, LocalObjectIntegrityError } from './local-object-storage'
import { destroyObjectStorage, headStoredObject, useObjectStorage, type ObjectStorage } from './object-storage'
import { scheduleFilesCleanupRoot } from './orphan-cleanup'

export {
  fileCleanupMaxAttempts,
  fileCleanupSchedulingMarginMs,
  fileDownloadTokenTtlMs,
  fileUploadTokenTtlMs
} from './file-policy'

export type PublicFile = Readonly<{
  id: string
  filename: string | null
  contentType: string
  byteSize: number
  status: 'pending' | 'ready'
  createdAt: string
  updatedAt: string
}>

export async function listOwnedFiles(session: AppSession, options: Readonly<{ cursor?: string; limit?: number }> = {}) {
  const connection = useDatabase()
  const page = await listFilesForOwner(connection, session.user.id, {
    cursor: options.cursor ? decodeFileListCursor(options.cursor) : undefined,
    limit: options.limit
  })
  if (page.files.length) {
    const storage = useObjectStorage()
    try {
      for (const file of page.files) assertFileStorageIdentity(connection, storage, file.bucket)
    } finally {
      destroyObjectStorage(storage)
    }
  }
  return {
    files: page.files.map(publicFile),
    nextCursor: page.nextCursor ? encodeFileListCursor(page.nextCursor) : null
  }
}

export async function getOwnedFileMetadata(session: AppSession, fileId: string) {
  const connection = useDatabase()
  const file = await requireOwnedFile(connection, session.user.id, fileId)
  const storage = useObjectStorage()
  try {
    assertFileStorageIdentity(connection, storage, file.bucket)
    return publicFile(file)
  } finally {
    destroyObjectStorage(storage)
  }
}

export async function createFileUploadTarget(session: AppSession, input: CreateFileUploadRequest) {
  const storage = useObjectStorage()
  try {
    return await createFileUploadTargetForConnection(useDatabase(), storage, session.user.id, input)
  } finally {
    destroyObjectStorage(storage)
  }
}

export async function createFileUploadTargetForConnection(
  connection: DatabaseConnection,
  storage: ObjectStorage,
  ownerId: string,
  input: CreateFileUploadRequest,
  options: Readonly<{ signingDate?: Date; now?: () => Date }> = {}
) {
  const clock = options.now ?? (() => new Date())
  assertFileStorageIdentity(connection, storage, storage.bucketName)
  let file: ReturnType<typeof admitPendingFileUpload>
  try {
    file = admitPendingFileUpload(
      connection,
      {
        ownerId,
        bucket: storage.bucketName,
        originalName: input.filename,
        contentType: input.contentType,
        byteSize: input.byteSize,
        contentMd5: input.contentMd5
      },
      { now: () => options.signingDate ?? clock() }
    )
  } catch (error) {
    if (error instanceof PendingFileUploadLimitError) throw conflictError('File upload limit reached')
    if (error instanceof FileUploadInitiationRateLimitError) {
      throw createError({ statusCode: 429, statusMessage: 'File upload initiation rate limit reached' })
    }
    throw error
  }
  const signingDate = new Date(file.createdAt)

  try {
    if (storage.kind === 'r2') {
      const requests = await storage.r2.createUploadRequests({
        key: file.objectKey,
        byteSize: file.byteSize,
        contentType: file.contentType,
        contentMd5: file.contentMd5!,
        signingDate
      })
      if (
        requests.upload.expiresAt !== file.uploadExpiresAt ||
        requests.head.expiresAt !== file.uploadExpiresAt ||
        clock().getTime() >= Date.parse(file.uploadExpiresAt)
      ) {
        throw new Error('R2 upload capability expiry does not match persisted state')
      }
      const response = { file: publicFile(file), upload: requests.upload, head: requests.head }
      scheduleFilesCleanupRoot(
        connection,
        new Date(Date.parse(file.uploadExpiresAt) + fileCleanupSchedulingMarginMs).toISOString()
      )
      return response
    }

    const token = createFileUploadToken({
      fileId: file.id,
      ownerId: file.ownerId,
      expiresAt: file.uploadExpiresAt,
      byteSize: file.byteSize,
      contentType: file.contentType,
      contentMd5: file.contentMd5!
    })
    const response = {
      file: publicFile(file),
      upload: {
        method: 'PUT' as const,
        url: `/api/files/${file.id}/content?token=${encodeURIComponent(token)}`,
        expiresAt: file.uploadExpiresAt,
        headers: {
          'content-type': file.contentType,
          'content-md5': file.contentMd5!
        }
      }
    }
    scheduleFilesCleanupRoot(
      connection,
      new Date(Date.parse(file.uploadExpiresAt) + fileCleanupSchedulingMarginMs).toISOString()
    )
    return response
  } catch (error) {
    connection.sqlite
      .prepare("delete from files where id = ? and owner_id = ? and status = 'pending'")
      .run(file.id, ownerId)
    throw storage.kind === 'r2' ? storageUnavailableError() : error
  }
}

export async function putFileUploadContent(
  session: AppSession,
  fileId: string,
  token: string,
  body: AsyncIterable<Uint8Array>,
  headers: Readonly<{ contentType?: string; contentMd5?: string; contentLength?: string }>
) {
  const storage = useObjectStorage()
  try {
    return await putVerifiedFileUploadContent(
      useDatabase(),
      storage,
      session.user.id,
      fileId,
      verifyFileUploadToken(token),
      body,
      headers
    )
  } finally {
    destroyObjectStorage(storage)
  }
}

export async function putVerifiedFileUploadContent(
  connection: DatabaseConnection,
  storage: ObjectStorage,
  ownerId: string,
  fileId: string,
  payload: FileUploadTokenPayload,
  body: AsyncIterable<Uint8Array>,
  headers: Readonly<{ contentType?: string; contentMd5?: string; contentLength?: string }>,
  options: Readonly<{ now?: () => Date }> = {}
) {
  if (storage.kind !== 'local') throw notFoundError('Local upload capability not found')
  if (payload.fileId !== fileId || payload.ownerId !== ownerId) throw notFoundError('File upload not found')

  const file = await requireOwnedFile(connection, ownerId, fileId, ['pending'])
  assertFileStorageIdentity(connection, storage, file.bucket)
  assertUploadCapabilityMatches(file, payload, headers)
  const now = options.now ?? (() => new Date())
  const validatePublication = async (phase: 'before-link' | 'after-link') => {
    const current = await getFileForOwner(
      connection,
      ownerId,
      file.id,
      phase === 'before-link' ? ['pending'] : ['pending', 'ready']
    )
    if (
      !current ||
      current.bucket !== file.bucket ||
      current.objectKey !== file.objectKey ||
      current.byteSize !== file.byteSize ||
      current.contentMd5 !== file.contentMd5 ||
      current.uploadExpiresAt !== file.uploadExpiresAt
    ) {
      throw notFoundError('File upload not found')
    }
    assertUploadCapabilityMatches(current, payload, headers)
    if (current.status === 'pending' && Date.parse(current.uploadExpiresAt) <= now().getTime()) {
      throw conflictError('File upload has expired')
    }
    return current
  }

  await validatePublication('before-link')

  try {
    await storage.local.writeVerifiedObject({
      key: file.objectKey,
      body,
      expectedByteSize: file.byteSize,
      expectedContentMd5: file.contentMd5!,
      validatePublication
    })
  } catch (error) {
    if (!(error instanceof LocalObjectAlreadyExistsError)) {
      if (error instanceof LocalObjectIntegrityError) throw validationError('Uploaded content failed integrity checks')
      throw error
    }

    const existing = await storage.local.headPersistedObject(file.objectKey)
    if (!existing || existing.byteSize !== file.byteSize) throw conflictError('File upload cannot be retried')
  }

  let current
  try {
    current = await validatePublication('after-link')
  } catch (error) {
    await storage.local.deleteObjects([file.objectKey])
    throw error
  }

  return { file: publicFile(current) }
}

export async function completeFileUpload(session: AppSession, fileId: string) {
  const storage = useObjectStorage()
  try {
    return await completeFileUploadForConnection(useDatabase(), storage, session.user.id, fileId)
  } finally {
    destroyObjectStorage(storage)
  }
}

export async function completeFileUploadForConnection(
  connection: DatabaseConnection,
  storage: ObjectStorage,
  ownerId: string,
  fileId: string,
  now = new Date()
) {
  const file = await requireOwnedFile(connection, ownerId, fileId, ['pending', 'ready'])
  assertFileStorageIdentity(connection, storage, file.bucket)
  if (file.status === 'ready') return publicFile(file)
  if (Date.parse(file.uploadExpiresAt) <= now.getTime()) throw conflictError('File upload has expired')

  const object = await safeHead(storage, file.objectKey)
  if (!object) throw conflictError('Uploaded object is missing')
  if (object.byteSize !== file.byteSize) throw conflictError('Uploaded object size does not match')
  if (storage.kind === 'r2' && object.contentType?.toLowerCase() !== file.contentType) {
    throw conflictError('Uploaded object media type does not match')
  }

  const ready = await markFileReady(connection, ownerId, file.id, now.toISOString())
  if (!ready) throw notFoundError('File not found')
  return publicFile(ready)
}

export async function createPrivateFileDownload(session: AppSession, fileId: string) {
  const storage = useObjectStorage()
  try {
    return await createPrivateFileDownloadForConnection(useDatabase(), storage, session.user.id, fileId)
  } finally {
    destroyObjectStorage(storage)
  }
}

export async function createPrivateFileDownloadForConnection(
  connection: DatabaseConnection,
  storage: ObjectStorage,
  ownerId: string,
  fileId: string,
  now = new Date()
) {
  const file = await requireOwnedFile(connection, ownerId, fileId, ['ready'])
  assertFileStorageIdentity(connection, storage, file.bucket)
  const object = await safeHead(storage, file.objectKey)
  if (!object || object.byteSize !== file.byteSize) throw notFoundError('Stored file not found')

  if (storage.kind === 'r2') {
    let download
    try {
      download = await storage.r2.createDownloadRequest(file.objectKey)
    } catch {
      throw storageUnavailableError()
    }
    return {
      file: publicFile(file),
      download
    }
  }

  const expiresAt = new Date(now.getTime() + fileDownloadTokenTtlMs).toISOString()
  const token = createFileDownloadToken({ fileId: file.id, ownerId, expiresAt })
  return {
    file: publicFile(file),
    download: {
      method: 'GET' as const,
      url: `/api/files/${file.id}/content?token=${encodeURIComponent(token)}`,
      headers: {},
      expiresAt
    }
  }
}

export async function getLocalFileDownload(
  session: AppSession,
  fileId: string,
  token: string
): Promise<{ file: PublicFile; body: Readable; byteSize: number }> {
  const payload = verifyFileDownloadToken(token)
  if (payload.fileId !== fileId || payload.ownerId !== session.user.id) throw notFoundError('File download not found')
  const storage = useObjectStorage()
  try {
    if (storage.kind !== 'local') throw notFoundError('Local download capability not found')
    const connection = useDatabase()
    const file = await requireOwnedFile(connection, session.user.id, fileId, ['ready'])
    assertFileStorageIdentity(connection, storage, file.bucket)
    const object = await storage.local.createReadStream(file.objectKey)
    if (!object || object.byteSize !== file.byteSize) {
      object?.body.destroy()
      throw notFoundError('Stored file not found')
    }
    return { file: publicFile(file), body: object.body, byteSize: object.byteSize }
  } finally {
    destroyObjectStorage(storage)
  }
}

export async function deleteOwnedFile(session: AppSession, fileId: string) {
  const storage = useObjectStorage()
  try {
    const deleted = deleteOwnedFileAndScheduleCleanup(useDatabase(), storage, session.user.id, fileId)
    if (!deleted) throw notFoundError('File not found')
  } finally {
    destroyObjectStorage(storage)
  }
}

export function deleteOwnedFileAndScheduleCleanup(
  connection: DatabaseConnection,
  storage: ObjectStorage,
  ownerId: string,
  fileId: string,
  now = new Date()
) {
  return connection.sqlite
    .transaction(() => {
      const file = connection.sqlite
        .prepare(
          "select id, bucket, upload_expires_at as uploadExpiresAt from files where id = ? and owner_id = ? and status in ('pending', 'ready')"
        )
        .get(fileId, ownerId) as { id: string; bucket: string; uploadExpiresAt: string } | undefined
      if (!file) return false
      assertFileStorageIdentity(connection, storage, file.bucket)

      const nowIso = now.toISOString()
      const updated = connection.sqlite
        .prepare(
          "update files set status = 'deleted', deleted_at = ?, updated_at = ? where id = ? and owner_id = ? and status in ('pending', 'ready')"
        )
        .run(nowIso, nowIso, fileId, ownerId)
      if (updated.changes !== 1) return false

      const runAfter = new Date(
        Math.max(now.getTime(), Date.parse(file.uploadExpiresAt) + fileCleanupSchedulingMarginMs)
      ).toISOString()
      scheduleFilesCleanupRoot(connection, runAfter)
      return true
    })
    .immediate()
}

function publicFile(file: FileMetadata): PublicFile {
  if (file.status === 'deleted') throw new Error('Deleted file metadata cannot cross the public boundary')
  return {
    id: file.id,
    filename: file.originalName,
    contentType: file.contentType,
    byteSize: file.byteSize,
    status: file.status,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt
  }
}

async function requireOwnedFile(
  connection: DatabaseConnection,
  ownerId: string,
  fileId: string,
  statuses: readonly FileMetadata['status'][] = ['pending', 'ready']
) {
  const file = await getFileForOwner(connection, ownerId, fileId, statuses)
  if (!file) throw notFoundError('File not found')
  return file
}

function assertUploadCapabilityMatches(
  file: FileMetadata,
  payload: FileUploadTokenPayload,
  headers: Readonly<{ contentType?: string; contentMd5?: string; contentLength?: string }>
) {
  const contentType = contentTypeSchema.safeParse(headers.contentType)
  const contentLength = headers.contentLength === undefined ? undefined : Number(headers.contentLength)
  if (
    payload.expiresAt !== file.uploadExpiresAt ||
    payload.byteSize !== file.byteSize ||
    payload.contentType !== file.contentType ||
    payload.contentMd5 !== file.contentMd5 ||
    !contentType.success ||
    contentType.data !== file.contentType ||
    headers.contentMd5 !== file.contentMd5 ||
    (contentLength !== undefined && contentLength !== file.byteSize)
  ) {
    throw validationError('Upload request does not match the declared file metadata')
  }
}

async function safeHead(storage: ObjectStorage, key: string) {
  try {
    return await headStoredObject(storage, key)
  } catch {
    throw storageUnavailableError()
  }
}

function assertFileStorageIdentity(connection: DatabaseConnection, storage: ObjectStorage, bucket: string) {
  try {
    assertFileBucketMatchesStorage(bucket, storage)
    assertFileStorageBinding(connection, storage, { initialize: true })
  } catch (error) {
    if (error instanceof FileStorageBindingError) throw storageUnavailableError()
    throw error
  }
}

function storageUnavailableError() {
  return upstreamServiceError(503, 'File storage is temporarily unavailable')
}

function encodeFileListCursor(cursor: FileListCursor) {
  return Buffer.from(JSON.stringify({ version: 1, ...cursor })).toString('base64url')
}

function decodeFileListCursor(value: string): FileListCursor {
  try {
    if (value.length > 512) throw new Error('cursor too long')
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      version?: unknown
      createdAt?: unknown
      id?: unknown
    }
    if (
      parsed.version !== 1 ||
      typeof parsed.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== 'string' ||
      !parsed.id
    ) {
      throw new Error('invalid cursor')
    }
    return { createdAt: parsed.createdAt, id: parsed.id }
  } catch {
    throw validationError('Invalid file list cursor')
  }
}
