import type { JsonValue } from '../../db/schema'
import type { DatabaseConnection } from '../../db/connect'
import {
  deleteCleanedFileMetadata,
  listDeletedFilesReadyForCleanup,
  listExpiredPendingFiles,
  listTrackedObjectKeys,
  markExpiredPendingFileDeleted
} from '../../db/repositories/files'
import { requireModuleReady } from '../../utils/module-state'
import { fileCleanupMaxAttempts, fileCleanupSchedulingMarginMs } from './file-service'
import { FILE_MANAGED_OBJECT_PREFIX } from './file-object-keys'
import {
  assertFileBucketMatchesStorage,
  assertFileStorageBinding,
  fileStorageBindingSettingKey,
  getFileStorageReconcileNotBefore
} from './file-storage-binding'
import {
  deleteStoredObjects,
  destroyObjectStorage,
  listStoredObjectPage,
  useObjectStorage,
  type ObjectStorage
} from './object-storage'

// R2 operations have a 30-second whole-request deadline and queue leases are
// not renewed. One list plus five sequential single-object deletions therefore
// has a three-minute provider ceiling, leaving two minutes of the five-minute
// lease for database work, scheduling, and shutdown.
export const fileCleanupPageSize = 5
export const fileCleanupRetryDelayMs = 60_000
export const fileReconciliationSafetyIntervalMs = 24 * 60 * 60 * 1000

export type FileReconciliationSafetyJobState = 'unbound' | 'covered-active' | 'covered-future' | 'scheduled'

type CleanupPhase = 'expired-pending' | 'deleted-metadata' | 'reconcile-v1'

export type FileCleanupPayload = Readonly<{
  phase?: CleanupPhase
  cursor?: string
}>

export async function cleanupOrphanedFileObjects(connection: DatabaseConnection, payload: JsonValue = {}) {
  requireModuleReady('files')
  requireModuleReady('jobs')
  const storage = useObjectStorage()
  try {
    return await cleanupOrphanedFileObjectsForConnection(connection, payload, { storage })
  } finally {
    destroyObjectStorage(storage)
  }
}

export async function cleanupOrphanedFileObjectsForConnection(
  connection: DatabaseConnection,
  rawPayload: JsonValue = {},
  options: Readonly<{
    storage: ObjectStorage
    now?: Date
    enqueueNext?: (payload: FileCleanupPayload, options?: Readonly<{ runAfter?: string }>) => void | Promise<void>
    checkpoint?: (checkpoint: string) => void | Promise<void>
  }>
) {
  const payload = parseCleanupPayload(rawPayload)
  const phase = payload.phase ?? 'expired-pending'
  const now = options.now ?? new Date()
  const safeCapabilityCutoff = new Date(now.getTime() - fileCleanupSchedulingMarginMs).toISOString()
  const enqueueNext =
    options.enqueueNext ?? ((next, schedule) => enqueueCleanupForConnection(connection, next, schedule?.runAfter))

  if (phase === 'expired-pending') {
    const expired = await listExpiredPendingFiles(connection, {
      now: safeCapabilityCutoff,
      limit: fileCleanupPageSize
    })
    await options.checkpoint?.('expired-pending-listed')
    assertFilesUseStorage(connection, options.storage, expired)
    let claimed = 0
    for (const file of expired) {
      if (await markExpiredPendingFileDeleted(connection, file.id, safeCapabilityCutoff, now.toISOString()))
        claimed += 1
    }
    await enqueueNext({ phase: expired.length === fileCleanupPageSize ? phase : 'deleted-metadata' })
    return { phase, claimedExpiredPendingFiles: claimed, deletedObjects: 0, nextScheduled: true }
  }

  if (phase === 'deleted-metadata') {
    const deleted = await listDeletedFilesReadyForCleanup(connection, {
      now: safeCapabilityCutoff,
      limit: fileCleanupPageSize
    })
    await options.checkpoint?.('deleted-metadata-listed')
    assertFilesUseStorage(connection, options.storage, deleted)
    let removedMetadata = 0
    let deletedObjects = 0
    let firstDeletionError: unknown
    for (const file of deleted) {
      try {
        await deleteStoredObjects(options.storage, [file.objectKey])
        deletedObjects += 1
        if (await deleteCleanedFileMetadata(connection, file.id, file.objectKey)) removedMetadata += 1
      } catch (error) {
        firstDeletionError ??= error
      }
    }
    if (firstDeletionError) throw firstDeletionError
    await enqueueNext({ phase: deleted.length === fileCleanupPageSize ? phase : 'reconcile-v1' })
    return {
      phase,
      deletedObjects,
      removedDeletedMetadata: removedMetadata,
      nextScheduled: true
    }
  }

  assertFileStorageBinding(connection, options.storage)
  const reconcileNotBefore = getFileStorageReconcileNotBefore(connection)
  if (reconcileNotBefore && Date.parse(reconcileNotBefore) > now.getTime()) {
    await enqueueNext({ phase }, { runAfter: reconcileNotBefore })
    return { phase, deletedObjects: 0, nextScheduled: true, deferredUntil: reconcileNotBefore }
  }

  const page = await listStoredObjectPage(options.storage, {
    prefix: FILE_MANAGED_OBJECT_PREFIX,
    cursor: payload.cursor,
    limit: fileCleanupPageSize
  })
  await options.checkpoint?.(`${phase}-listed`)
  const resolution = connection.sqlite
    .transaction(() => {
      const currentNotBefore = getFileStorageReconcileNotBefore(connection)
      if (currentNotBefore && Date.parse(currentNotBefore) > now.getTime()) {
        return { deferredUntil: currentNotBefore, tracked: [] as string[] }
      }
      return {
        deferredUntil: null,
        tracked: listTrackedObjectKeys(connection, options.storage.bucketName, page.keys)
      }
    })
    .immediate()
  if (resolution.deferredUntil) {
    await enqueueNext({ phase }, { runAfter: resolution.deferredUntil })
    return { phase, deletedObjects: 0, nextScheduled: true, deferredUntil: resolution.deferredUntil }
  }
  const tracked = new Set(resolution.tracked)
  const orphaned = page.keys.filter((key) => !tracked.has(key))
  let cursorRestartScheduled = false
  if (payload.cursor && orphaned.length) {
    // A successful delete can invalidate this opaque provider cursor. Commit
    // the phase-root successor before the first mutation so a worker crash or
    // scheduling failure can never strand cleanup on stale continuation state.
    await enqueueNext({ phase }, { runAfter: new Date(now.getTime() + fileCleanupRetryDelayMs).toISOString() })
    cursorRestartScheduled = true
  }
  let deletedObjects = 0
  let firstDeletionError: unknown
  for (const key of orphaned) {
    try {
      await deleteStoredObjects(options.storage, [key])
      deletedObjects += 1
    } catch (error) {
      firstDeletionError ??= error
    }
  }
  if (firstDeletionError) {
    if (deletedObjects === 0) {
      if (!cursorRestartScheduled) throw firstDeletionError
      return {
        phase,
        deletedObjects: 0,
        nextScheduled: true,
        deletionRetryScheduled: true
      }
    }

    // At least one successful deletion mutated the provider collection, so an
    // opaque continuation token from this pass is no longer safe to reuse.
    // Complete this invocation and durably restart from the phase root after
    // the queue's ordinary retry delay; the retained siblings remain visible
    // to that verification pass.
    if (!cursorRestartScheduled) {
      await enqueueNext({ phase }, { runAfter: new Date(now.getTime() + fileCleanupRetryDelayMs).toISOString() })
    }
    return {
      phase,
      deletedObjects,
      nextScheduled: true,
      deletionRetryScheduled: true
    }
  }

  let next: FileCleanupPayload | undefined
  if (cursorRestartScheduled) {
    return {
      phase,
      deletedObjects,
      nextScheduled: true
    }
  } else if (orphaned.length) {
    // Restart after mutation rather than assuming a provider/local cursor
    // remains stable while the listed collection changes.
    next = { phase }
  } else if (page.nextCursor) {
    next = { phase, cursor: page.nextCursor }
  }
  if (next) await enqueueNext(next)

  return {
    phase,
    deletedObjects,
    nextScheduled: Boolean(next)
  }
}

export function enqueueCleanupForConnection(
  connection: DatabaseConnection,
  payload: FileCleanupPayload,
  runAfter?: string
) {
  if (runAfter) {
    connection.sqlite
      .prepare(
        "insert into job_queue (type, payload, max_attempts, run_after) values ('files.cleanup-orphans', ?, ?, ?)"
      )
      .run(JSON.stringify(payload), fileCleanupMaxAttempts, runAfter)
    return
  }
  connection.sqlite
    .prepare("insert into job_queue (type, payload, max_attempts) values ('files.cleanup-orphans', ?, ?)")
    .run(JSON.stringify(payload), fileCleanupMaxAttempts)
}

/**
 * A presigned R2 PUT may begin before capability expiry and finish after the
 * ordinary expiry-plus-margin sweep. While the Files worker is operational,
 * its claim loop uses this serialized check to retain one future full sweep
 * without assuming a provider upload-completion bound.
 */
export function ensureFileReconciliationSafetyJob(
  connection: DatabaseConnection,
  now = new Date()
): FileReconciliationSafetyJobState {
  const runAfter = new Date(now.getTime() + fileReconciliationSafetyIntervalMs).toISOString()
  return connection.sqlite
    .transaction(() => {
      const binding = connection.sqlite
        .prepare('select 1 from app_settings where key = ?')
        .get(fileStorageBindingSettingKey)
      if (!binding) return 'unbound' as const

      const existing = connection.sqlite
        .prepare(
          `select status, run_after as runAfter from job_queue
           where type = 'files.cleanup-orphans'
             and payload = '{}'
             and (
               status = 'running'
               or (
                 status = 'queued'
                 and attempts < max_attempts
                 and (run_after is null or run_after <= ?)
               )
             )
           limit 1`
        )
        .get(runAfter) as { status: 'queued' | 'running'; runAfter: string | null } | undefined
      if (existing) {
        return existing.status === 'queued' &&
          existing.runAfter &&
          Date.parse(existing.runAfter) > now.getTime() + 1_000
          ? ('covered-future' as const)
          : ('covered-active' as const)
      }

      connection.sqlite
        .prepare(
          "insert into job_queue (type, payload, max_attempts, run_after) values ('files.cleanup-orphans', '{}', ?, ?)"
        )
        .run(fileCleanupMaxAttempts, runAfter)
      return 'scheduled' as const
    })
    .immediate()
}

function assertFilesUseStorage(
  connection: DatabaseConnection,
  storage: ObjectStorage,
  files: ReadonlyArray<Readonly<{ bucket: string }>>
) {
  if (!files.length) return
  assertFileStorageBinding(connection, storage)
  for (const file of files) assertFileBucketMatchesStorage(file.bucket, storage)
}

function parseCleanupPayload(value: JsonValue): FileCleanupPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('File cleanup payload is invalid')
  const entries = Object.entries(value)
  if (entries.some(([key]) => key !== 'phase' && key !== 'cursor')) throw new Error('File cleanup payload is invalid')
  const phase = value.phase
  const cursor = value.cursor
  if (phase !== undefined && phase !== 'expired-pending' && phase !== 'deleted-metadata' && phase !== 'reconcile-v1') {
    throw new Error('File cleanup payload is invalid')
  }
  if (cursor !== undefined && (typeof cursor !== 'string' || !cursor || cursor.length > 4096)) {
    throw new Error('File cleanup payload is invalid')
  }
  if (cursor !== undefined && phase !== 'reconcile-v1') {
    throw new Error('File cleanup payload is invalid')
  }
  return { phase, cursor }
}
