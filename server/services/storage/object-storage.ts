import { dirname, join, resolve } from 'node:path'
import { assertBasicReleaseCapabilityAvailable } from '../../../shared/basic-release-policy'
import { resolveSqlitePath } from '../../db/connect'
import { getAppRuntimeConfig } from '../../utils/runtime'
import type { FileReconciliationPrefix } from './file-object-keys'
import { LocalObjectStorage } from './local-object-storage'
import { R2ObjectStorage } from './r2-object-storage'

export type LocalStorageDriver = Readonly<{
  kind: 'local'
  bucketName: 'local'
  local: LocalObjectStorage
}>

export type R2StorageDriver = Readonly<{
  kind: 'r2'
  bucketName: string
  endpoint: string
  r2: R2ObjectStorage
}>

export type ObjectStorage = LocalStorageDriver | R2StorageDriver

export type StoredObjectMetadata = Readonly<{
  key: string
  byteSize: number | undefined
  contentType: string | undefined
}>

export type StoredObjectPage = Readonly<{
  keys: readonly string[]
  nextCursor: string | undefined
}>

export function useObjectStorage(): ObjectStorage {
  assertBasicReleaseCapabilityAvailable('files')
  const config = getAppRuntimeConfig()

  if (config.files.driver === 'r2') {
    const r2 = new R2ObjectStorage({
      accountId: config.cloudflare.accountId,
      bucket: config.cloudflare.r2.bucket,
      endpoint: config.cloudflare.r2.endpoint,
      accessKeyId: config.cloudflare.r2.accessKeyId,
      secretAccessKey: config.cloudflare.r2.secretAccessKey
    })
    return { kind: 'r2', bucketName: r2.bucketName, endpoint: r2.endpoint, r2 }
  }

  return {
    kind: 'local',
    bucketName: 'local',
    local: new LocalObjectStorage(resolveLocalObjectStoragePath(config.databaseUrl), config.betterAuth.secret)
  }
}

export function resolveLocalObjectStoragePath(databaseUrl: string) {
  const databasePath = resolveSqlitePath(databaseUrl)
  return databasePath === ':memory:' ? resolve(process.cwd(), 'data/objects') : join(dirname(databasePath), 'objects')
}

export async function headStoredObject(storage: ObjectStorage, key: string): Promise<StoredObjectMetadata | null> {
  if (storage.kind === 'local') {
    const object = await storage.local.headPersistedObject(key)
    return object ? { ...object, contentType: undefined } : null
  }

  const object = await storage.r2.headPersistedObject(key)
  return object
    ? {
        key: object.key,
        byteSize: object.byteSize,
        contentType: object.contentType
      }
    : null
}

export async function listStoredObjectPage(
  storage: ObjectStorage,
  input: { prefix: FileReconciliationPrefix; cursor?: string; limit?: number }
): Promise<StoredObjectPage> {
  if (storage.kind === 'local') return storage.local.listPage(input)
  const page = await storage.r2.listPage({
    prefix: input.prefix,
    continuationToken: input.cursor,
    limit: input.limit
  })
  return { keys: page.keys, nextCursor: page.nextContinuationToken }
}

export async function deleteStoredObjects(storage: ObjectStorage, keys: readonly string[]) {
  if (storage.kind === 'local') return storage.local.deleteObjects(keys)
  return storage.r2.deleteObjects(keys)
}

export function destroyObjectStorage(storage: ObjectStorage) {
  if (storage.kind === 'r2') storage.r2.destroy()
}
