export const FILE_MANAGED_OBJECT_PREFIX = 'files/v1/'

const fileIdPattern = /^file_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export type FileReconciliationPrefix = typeof FILE_MANAGED_OBJECT_PREFIX

export function objectKeyForFileId(fileId: string) {
  if (!fileIdPattern.test(fileId)) throw new Error('File ID must be a server-generated UUIDv4 identifier')
  return `${FILE_MANAGED_OBJECT_PREFIX}${fileId}`
}

export function isFileObjectKey(key: string): boolean {
  return key.startsWith(FILE_MANAGED_OBJECT_PREFIX) && fileIdPattern.test(key.slice(FILE_MANAGED_OBJECT_PREFIX.length))
}

export function assertFileObjectKey(key: string) {
  if (!isFileObjectKey(key)) throw new Error('Object key must be a server-generated Files v1 object key')
  return key
}

export function assertFileReconciliationPrefix(prefix: string): FileReconciliationPrefix {
  if (prefix !== FILE_MANAGED_OBJECT_PREFIX) {
    throw new Error('Reconciliation prefix is not managed by Files')
  }
  return prefix
}
