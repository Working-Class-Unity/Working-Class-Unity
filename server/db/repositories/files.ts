import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, lt, lte, ne, or } from 'drizzle-orm'
import { objectKeyForFileId } from '../../services/storage/file-object-keys'
import {
  fileUploadInitiationLimit,
  fileUploadInitiationWindowMs,
  fileUploadTokenTtlMs,
  pendingFileUploadLimit
} from '../../services/storage/file-policy'
import type { DatabaseConnection } from '../connect'
import { files, type FileMetadata, type NewFileMetadata } from '../schema'

const defaultPageSize = 50
const maximumPageSize = 100

export type CreatePendingFileInput = Omit<NewFileMetadata, 'createdAt' | 'updatedAt' | 'deletedAt' | 'status'> & {
  status?: 'pending'
}

export type AdmitPendingFileUploadInput = Omit<
  CreatePendingFileInput,
  'id' | 'objectKey' | 'uploadExpiresAt' | 'status'
>

export class PendingFileUploadLimitError extends Error {
  constructor() {
    super('Pending file upload limit reached')
    this.name = 'PendingFileUploadLimitError'
  }
}

export class FileUploadInitiationRateLimitError extends Error {
  constructor() {
    super('File upload initiation rate limit reached')
    this.name = 'FileUploadInitiationRateLimitError'
  }
}

export type FileListCursor = Readonly<{
  createdAt: string
  id: string
}>

export type FileListPage = Readonly<{
  files: FileMetadata[]
  nextCursor: FileListCursor | null
}>

export type CleanupCursor = Readonly<{
  uploadExpiresAt: string
  id: string
}>

export async function createPendingFile(connection: DatabaseConnection, input: CreatePendingFileInput) {
  const now = new Date().toISOString()
  return insertPendingFile(connection, input, now)
}

export function admitPendingFileUpload(
  connection: DatabaseConnection,
  input: AdmitPendingFileUploadInput,
  options: Readonly<{ now?: () => Date }> = {}
) {
  const clock = options.now ?? (() => new Date())
  return connection.sqlite
    .transaction(() => {
      const admittedAt = clock()
      const admittedAtIso = admittedAt.toISOString()
      const pendingCount = Number(
        (
          connection.sqlite
            .prepare(
              `select count(*) as count
               from (
                 select 1
                 from files indexed by files_owner_status_created_id_idx
                 where owner_id = ? and status = 'pending'
                 limit ?
               )`
            )
            .get(input.ownerId, pendingFileUploadLimit) as { count: number | bigint }
        ).count
      )
      if (pendingCount >= pendingFileUploadLimit) throw new PendingFileUploadLimitError()

      const cutoff = new Date(admittedAt.getTime() - fileUploadInitiationWindowMs).toISOString()
      const recentCount = Number(
        (
          connection.sqlite
            .prepare(
              `select count(*) as count
               from (
                 select 1
                 from files indexed by files_owner_status_created_id_idx
                 where owner_id = ?
                   and status in ('pending', 'ready', 'deleted')
                   and created_at > ?
                 limit ?
               )`
            )
            .get(input.ownerId, cutoff, fileUploadInitiationLimit) as { count: number | bigint }
        ).count
      )
      if (recentCount >= fileUploadInitiationLimit) throw new FileUploadInitiationRateLimitError()

      const id = `file_${randomUUID()}`
      return insertPendingFile(
        connection,
        {
          ...input,
          id,
          objectKey: objectKeyForFileId(id),
          uploadExpiresAt: new Date(admittedAt.getTime() + fileUploadTokenTtlMs).toISOString()
        },
        admittedAtIso
      )
    })
    .immediate()
}

function insertPendingFile(connection: DatabaseConnection, input: CreatePendingFileInput, now: string) {
  const [file] = connection.db
    .insert(files)
    .values({
      ...input,
      status: 'pending',
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .all()

  if (!file) {
    throw new Error('Failed to create pending file metadata')
  }

  return file
}

export async function listFilesForOwner(
  connection: DatabaseConnection,
  ownerId: string,
  options: Readonly<{ cursor?: FileListCursor | null; limit?: number }> = {}
): Promise<FileListPage> {
  const limit = boundedLimit(options.limit)
  const cursorPredicate = options.cursor
    ? or(
        lt(files.createdAt, options.cursor.createdAt),
        and(eq(files.createdAt, options.cursor.createdAt), lt(files.id, options.cursor.id))
      )
    : undefined
  const rows = await connection.db
    .select()
    .from(files)
    .where(and(eq(files.ownerId, ownerId), ne(files.status, 'deleted'), cursorPredicate))
    .orderBy(desc(files.createdAt), desc(files.id))
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const last = rows.length > limit ? page.at(-1) : undefined

  return {
    files: page,
    nextCursor: last ? { createdAt: last.createdAt, id: last.id } : null
  }
}

/**
 * Reads a private file through its persisted owner boundary. Callers may
 * narrow the accepted lifecycle states, but cannot bypass ownership.
 */
export async function getFileForOwner(
  connection: DatabaseConnection,
  ownerId: string,
  id: string,
  statuses: readonly FileMetadata['status'][] = ['pending', 'ready']
) {
  if (!statuses.length) return null

  const [file] = await connection.db
    .select()
    .from(files)
    .where(and(eq(files.ownerId, ownerId), eq(files.id, id), inArray(files.status, [...statuses])))
    .limit(1)
  return file ?? null
}

/**
 * Commits a pending upload. Retrying an already committed transition returns
 * the same ready record; missing, foreign, and deleted records return null.
 */
export async function markFileReady(
  connection: DatabaseConnection,
  ownerId: string,
  id: string,
  now = new Date().toISOString()
) {
  const [updated] = await connection.db
    .update(files)
    .set({
      status: 'ready',
      updatedAt: now
    })
    .where(and(eq(files.ownerId, ownerId), eq(files.id, id), eq(files.status, 'pending')))
    .returning()

  if (updated) return updated
  return getFileForOwner(connection, ownerId, id, ['ready'])
}

export async function listExpiredPendingFiles(
  connection: DatabaseConnection,
  options: Readonly<{ now: string; limit?: number }>
) {
  return connection.db
    .select()
    .from(files)
    .where(and(eq(files.status, 'pending'), lte(files.uploadExpiresAt, options.now)))
    .orderBy(asc(files.uploadExpiresAt), asc(files.id))
    .limit(boundedLimit(options.limit))
}

export function getEarliestFileUploadExpiry(connection: DatabaseConnection, status: 'pending' | 'deleted') {
  const row = connection.sqlite
    .prepare(
      `select upload_expires_at as uploadExpiresAt
       from files indexed by files_status_upload_expires_id_idx
       where status = ?
       order by upload_expires_at, id
       limit 1`
    )
    .get(status) as { uploadExpiresAt: string } | undefined
  return row?.uploadExpiresAt ?? null
}

export async function markExpiredPendingFileDeleted(
  connection: DatabaseConnection,
  id: string,
  expiredBefore: string,
  deletedAt = expiredBefore
) {
  const [updated] = await connection.db
    .update(files)
    .set({ status: 'deleted', deletedAt, updatedAt: deletedAt })
    .where(and(eq(files.id, id), eq(files.status, 'pending'), lte(files.uploadExpiresAt, expiredBefore)))
    .returning()
  return updated ?? null
}

export async function listDeletedFilesReadyForCleanup(
  connection: DatabaseConnection,
  options: Readonly<{ now: string; cursor?: CleanupCursor | null; limit?: number }>
) {
  const cursorPredicate = options.cursor
    ? or(
        lt(files.uploadExpiresAt, options.cursor.uploadExpiresAt),
        and(eq(files.uploadExpiresAt, options.cursor.uploadExpiresAt), lt(files.id, options.cursor.id))
      )
    : undefined

  return connection.db
    .select()
    .from(files)
    .where(and(eq(files.status, 'deleted'), lte(files.uploadExpiresAt, options.now), cursorPredicate))
    .orderBy(desc(files.uploadExpiresAt), desc(files.id))
    .limit(boundedLimit(options.limit))
}

/**
 * Resolves at most one provider page against persisted state in the active
 * bucket. Deleted rows remain protective until the metadata cleanup phase has
 * safely removed their provider object and locator.
 */
export function listTrackedObjectKeys(connection: DatabaseConnection, bucket: string, objectKeys: readonly string[]) {
  if (!objectKeys.length) return []
  if (objectKeys.length > maximumPageSize) {
    throw new RangeError(`Object-key reconciliation is limited to ${maximumPageSize} records`)
  }

  const placeholders = objectKeys.map(() => '?').join(', ')
  const rows = connection.sqlite
    .prepare(`select object_key as objectKey from files where bucket = ? and object_key in (${placeholders})`)
    .all(bucket, ...objectKeys) as Array<{ objectKey: string }>
  return rows.map(({ objectKey }) => objectKey)
}

export async function deleteCleanedFileMetadata(
  connection: DatabaseConnection,
  id: string,
  objectKey: string
): Promise<boolean> {
  const [deleted] = await connection.db
    .delete(files)
    .where(and(eq(files.id, id), eq(files.objectKey, objectKey), eq(files.status, 'deleted')))
    .returning({ id: files.id })
  return Boolean(deleted)
}

function boundedLimit(limit = defaultPageSize) {
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumPageSize) {
    throw new RangeError(`File page limit must be between 1 and ${maximumPageSize}`)
  }
  return limit
}
