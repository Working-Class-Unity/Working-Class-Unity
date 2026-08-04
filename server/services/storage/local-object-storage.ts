import { constants } from 'node:fs'
import { lstat, mkdir, open, opendir, realpath, rm, unlink, link } from 'node:fs/promises'
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { dirname, relative, resolve, sep } from 'node:path'
import { assertFileObjectKey, assertFileReconciliationPrefix, type FileReconciliationPrefix } from './file-object-keys'

export const LOCAL_MAX_PAGE_SIZE = 100
export const LOCAL_MAX_UPLOAD_BYTES = 25 * 1024 * 1024
export const LOCAL_MAX_FILESYSTEM_ENTRIES_PER_PAGE = 10_000
export const LOCAL_TEMP_ARTIFACT_STALE_MS = 16 * 60 * 1000

const cursorVersion = 2
const localTemporaryArtifactCleanupLimit = LOCAL_MAX_PAGE_SIZE
const temporaryArtifactPattern = /^swl-upload-v1\.([A-Za-z0-9_-]{24})\.([A-Za-z0-9_-]{43})\.tmp$/
const opaqueOrderPattern = /^[A-Za-z0-9_-]{43}$/

export type LocalObjectMetadata = Readonly<{
  key: string
  byteSize: number
}>

export type LocalObjectPage = Readonly<{
  keys: readonly string[]
  nextCursor: string | undefined
}>

export class LocalObjectIntegrityError extends Error {
  readonly code: 'DIGEST_MISMATCH' | 'SIZE_MISMATCH' | 'UPLOAD_TOO_LARGE'

  constructor(code: LocalObjectIntegrityError['code']) {
    super('Local object content did not match the declared upload metadata')
    this.name = 'LocalObjectIntegrityError'
    this.code = code
  }
}

export class LocalObjectAlreadyExistsError extends Error {
  constructor() {
    super('Local object already exists')
    this.name = 'LocalObjectAlreadyExistsError'
  }
}

export class LocalObjectStorage {
  readonly bucketName = 'local'
  private readonly basePath: string
  private readonly cursorKey: Buffer
  private readonly listingOrderKey: Buffer
  private readonly temporaryArtifactKey: Buffer

  constructor(basePath: string, cursorSecret: string) {
    this.basePath = resolve(basePath)
    if (!cursorSecret) throw new Error('Local object cursor secret is required')
    this.cursorKey = deriveStorageKey(cursorSecret, 'swl:file-storage-cursor:v2')
    this.listingOrderKey = deriveStorageKey(cursorSecret, 'swl:file-storage-list-order:v1')
    this.temporaryArtifactKey = deriveStorageKey(cursorSecret, 'swl:file-storage-temp-artifact:v1')
  }

  async writeVerifiedObject(input: {
    key: string
    body: AsyncIterable<Uint8Array>
    expectedByteSize: number
    expectedContentMd5: string
    validatePublication?: (phase: 'before-link' | 'after-link') => unknown | Promise<unknown>
  }) {
    const key = assertFileObjectKey(input.key)
    assertExpectedUpload(input.expectedByteSize, input.expectedContentMd5)
    const target = await this.prepareNewObjectTarget(key)
    const temporaryDirectory = await this.ensureDirectory(resolve(this.basePath, '.tmp'))
    const temporaryPath = resolve(temporaryDirectory, this.createTemporaryArtifactName())
    const handle = await open(temporaryPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    const digest = createHash('md5')
    let byteSize = 0
    let closed = false
    let published = false
    let removeTemporary = true

    try {
      for await (const value of input.body) {
        const chunk = Buffer.from(value)
        byteSize += chunk.byteLength
        if (byteSize > input.expectedByteSize || byteSize > LOCAL_MAX_UPLOAD_BYTES) {
          throw new LocalObjectIntegrityError(byteSize > LOCAL_MAX_UPLOAD_BYTES ? 'UPLOAD_TOO_LARGE' : 'SIZE_MISMATCH')
        }
        digest.update(chunk)
        await writeAll(handle, chunk)
      }

      if (byteSize !== input.expectedByteSize) throw new LocalObjectIntegrityError('SIZE_MISMATCH')
      const contentMd5 = digest.digest('base64')
      if (contentMd5 !== input.expectedContentMd5) throw new LocalObjectIntegrityError('DIGEST_MISMATCH')

      await handle.sync()
      await handle.close()
      closed = true
      await input.validatePublication?.('before-link')
      try {
        await link(temporaryPath, target)
      } catch (error) {
        if (isNodeError(error, 'EEXIST')) throw new LocalObjectAlreadyExistsError()
        throw error
      }
      published = true
      // Recheck while the authenticated two-link artifact is still present.
      // A crash before this boundary leaves a marker that reconciliation can
      // recognize immediately; a rejected check removes the new target.
      await input.validatePublication?.('after-link')
      return { key, byteSize, contentMd5 }
    } catch (error) {
      if (published) {
        try {
          await unlink(target)
        } catch (cleanupError) {
          if (!isNodeError(cleanupError, 'ENOENT')) {
            removeTemporary = false
            throw cleanupError
          }
        }
      }
      throw error
    } finally {
      if (!closed) await handle.close().catch(() => undefined)
      if (removeTemporary) await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }

  async headPersistedObject(key: string): Promise<LocalObjectMetadata | null> {
    const objectKey = assertFileObjectKey(key)
    const handle = await this.openPersistedObject(objectKey)
    if (!handle) return null
    try {
      const metadata = await handle.stat()
      if (!metadata.isFile()) throw unsafeStorageError()
      return { key: objectKey, byteSize: metadata.size }
    } finally {
      await handle.close()
    }
  }

  async createReadStream(key: string) {
    const objectKey = assertFileObjectKey(key)
    const handle = await this.openPersistedObject(objectKey)
    if (!handle) return null
    const metadata = await handle.stat()
    if (!metadata.isFile()) {
      await handle.close()
      throw unsafeStorageError()
    }
    return {
      key: objectKey,
      byteSize: metadata.size,
      body: handle.createReadStream({ autoClose: true })
    }
  }

  async deleteObjects(keys: readonly string[]) {
    if (keys.length > LOCAL_MAX_PAGE_SIZE) {
      throw new RangeError(`Local deletion is limited to ${LOCAL_MAX_PAGE_SIZE} managed objects per request`)
    }

    for (const value of keys) {
      const key = assertFileObjectKey(value)
      const path = this.pathForKey(key)
      await this.assertSafeParent(path)
      try {
        const metadata = await lstat(path)
        if (metadata.isSymbolicLink() || !metadata.isFile()) throw unsafeStorageError()
        await unlink(path)
      } catch (error) {
        if (!isNodeError(error, 'ENOENT')) throw error
      }
    }
  }

  async listPage(input: {
    prefix: FileReconciliationPrefix
    cursor?: string
    limit?: number
  }): Promise<LocalObjectPage> {
    const prefix = assertFileReconciliationPrefix(input.prefix)
    const limit = normalizePageSize(input.limit)
    const afterOrder = input.cursor ? this.decodeCursor(input.cursor, prefix) : undefined
    const candidates: Array<{ key: string; order: string }> = []
    const orders = new Map<string, string>()
    const root = this.pathForPrefix(prefix)
    const scanBudget = { remaining: LOCAL_MAX_FILESYSTEM_ENTRIES_PER_PAGE }

    if (await this.cleanupTemporaryArtifacts(scanBudget)) {
      return { keys: [], nextCursor: this.encodeCursor(prefix, afterOrder) }
    }

    for await (const key of this.walkManagedFiles(root, scanBudget)) {
      const order = this.orderForKey(key)
      const existing = orders.get(order)
      if (existing && existing !== key) throw new Error('Local object listing order collision')
      orders.set(order, key)
      if (afterOrder && order <= afterOrder) continue
      insertCandidate(candidates, { key, order }, limit + 1)
    }

    const page = candidates.slice(0, limit)
    return {
      keys: page.map(({ key }) => key),
      nextCursor: candidates.length > limit && page.length ? this.encodeCursor(prefix, page.at(-1)!.order) : undefined
    }
  }

  private async prepareNewObjectTarget(key: string) {
    await this.ensureStorageRoot()
    const target = this.pathForKey(key)
    await this.ensureDirectory(dirname(target))
    await this.assertSafeParent(target)
    return target
  }

  private async openPersistedObject(key: string) {
    await this.ensureStorageRoot()
    const path = this.pathForKey(key)
    await this.assertSafeParent(path)
    try {
      return await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return null
      if (isNodeError(error, 'ELOOP')) throw unsafeStorageError()
      throw error
    }
  }

  private async ensureStorageRoot() {
    try {
      const metadata = await lstat(this.basePath)
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw unsafeStorageError()
    } catch (error) {
      if (!isNodeError(error, 'ENOENT')) throw error
      await mkdir(this.basePath, { recursive: true, mode: 0o700 })
    }
    return realpath(this.basePath)
  }

  private async ensureDirectory(path: string) {
    await this.ensureStorageRoot()
    const relativePath = relative(this.basePath, path)
    if (!relativePath || relativePath.startsWith('..') || relativePath.split(sep).includes('..')) {
      if (path === this.basePath) return this.basePath
      throw unsafeStorageError()
    }

    let current = this.basePath
    for (const segment of relativePath.split(sep)) {
      current = resolve(current, segment)
      try {
        const metadata = await lstat(current)
        if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw unsafeStorageError()
      } catch (error) {
        if (!isNodeError(error, 'ENOENT')) throw error
        await mkdir(current, { mode: 0o700 })
      }
    }
    await this.assertContainedRealPath(current)
    return current
  }

  private async assertSafeParent(path: string) {
    const parent = dirname(path)
    try {
      await this.assertContainedRealPath(parent)
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return
      throw error
    }
  }

  private async assertContainedRealPath(path: string) {
    const [base, target] = await Promise.all([realpath(this.basePath), realpath(path)])
    if (target !== base && !target.startsWith(`${base}${sep}`)) throw unsafeStorageError()

    let current = target
    while (current !== base) {
      const metadata = await lstat(current)
      if (metadata.isSymbolicLink()) throw unsafeStorageError()
      current = dirname(current)
    }
  }

  private pathForKey(key: string) {
    const target = resolve(this.basePath, key)
    if (!target.startsWith(`${this.basePath}${sep}`)) throw unsafeStorageError()
    return target
  }

  private pathForPrefix(prefix: FileReconciliationPrefix) {
    const target = resolve(this.basePath, prefix)
    if (!target.startsWith(`${this.basePath}${sep}`)) throw unsafeStorageError()
    return target
  }

  private async *walkManagedFiles(root: string, budget: { remaining: number }): AsyncGenerator<string> {
    const directory = await this.openContainedDirectory(root)
    if (!directory) return

    try {
      for await (const entry of directory) {
        consumeFilesystemEntry(budget)
        const path = resolve(root, entry.name)
        let metadata
        try {
          metadata = await lstat(path)
        } catch (error) {
          if (isNodeError(error, 'ENOENT')) continue
          throw error
        }
        if (entry.isSymbolicLink() || metadata.isSymbolicLink()) {
          throw unsafeStorageError()
        }
        if (entry.isDirectory() && metadata.isDirectory()) {
          throw unsafeStorageError()
        } else if (entry.isFile() && metadata.isFile()) {
          const key = relative(this.basePath, path).split(sep).join('/')
          yield assertFileObjectKey(key)
        } else {
          throw unsafeStorageError()
        }
      }
    } finally {
      await directory.close().catch(() => undefined)
    }
  }

  private async openContainedDirectory(path: string) {
    await this.ensureStorageRoot()
    let directory
    try {
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw unsafeStorageError()
      await this.assertContainedRealPath(path)
      directory = await opendir(path)

      const openedMetadata = await lstat(path)
      if (openedMetadata.isSymbolicLink() || !openedMetadata.isDirectory()) throw unsafeStorageError()
      await this.assertContainedRealPath(path)
      return directory
    } catch (error) {
      await directory?.close().catch(() => undefined)
      if (isNodeError(error, 'ENOENT')) return null
      throw error
    }
  }

  private async cleanupTemporaryArtifacts(budget: { remaining: number }) {
    const root = resolve(this.basePath, '.tmp')
    const directory = await this.openContainedDirectory(root)
    if (!directory) return false
    const now = Date.now()
    let deleted = 0

    try {
      for await (const entry of directory) {
        consumeFilesystemEntry(budget, 'Local object temporary cleanup exceeded its bounded scan')
        if (!this.isTemporaryArtifactName(entry.name)) continue

        const path = resolve(root, entry.name)
        let metadata
        try {
          metadata = await lstat(path)
        } catch (error) {
          if (isNodeError(error, 'ENOENT')) continue
          throw error
        }
        if (entry.isSymbolicLink() || metadata.isSymbolicLink() || !entry.isFile() || !metadata.isFile()) continue

        const stale = metadata.nlink > 1 || now - metadata.mtimeMs >= LOCAL_TEMP_ARTIFACT_STALE_MS
        if (!stale) continue
        try {
          await unlink(path)
        } catch (error) {
          if (!isNodeError(error, 'ENOENT')) throw error
        }
        deleted += 1
        if (deleted >= localTemporaryArtifactCleanupLimit) return true
      }
    } finally {
      await directory.close().catch(() => undefined)
    }
    return false
  }

  private createTemporaryArtifactName() {
    const nonce = randomBytes(18).toString('base64url')
    return `swl-upload-v1.${nonce}.${this.signTemporaryArtifactNonce(nonce)}.tmp`
  }

  private isTemporaryArtifactName(value: string) {
    const match = temporaryArtifactPattern.exec(value)
    if (!match) return false
    const nonce = match[1]!
    return safeEqual(match[2]!, this.signTemporaryArtifactNonce(nonce))
  }

  private signTemporaryArtifactNonce(nonce: string) {
    return createHmac('sha256', this.temporaryArtifactKey).update(nonce).digest('base64url')
  }

  private orderForKey(key: string) {
    return createHmac('sha256', this.listingOrderKey).update(key).digest('base64url')
  }

  private encodeCursor(prefix: FileReconciliationPrefix, afterOrder: string | undefined) {
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.cursorKey, nonce)
    const plaintext = Buffer.from(JSON.stringify({ version: cursorVersion, prefix, afterOrder: afterOrder ?? null }))
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64url')
  }

  private decodeCursor(cursor: string, expectedPrefix: FileReconciliationPrefix) {
    try {
      if (cursor.length > 4096) throw new Error('long cursor')
      const encoded = Buffer.from(cursor, 'base64url')
      if (encoded.byteLength < 29) throw new Error('short cursor')
      const decipher = createDecipheriv('aes-256-gcm', this.cursorKey, encoded.subarray(0, 12))
      decipher.setAuthTag(encoded.subarray(12, 28))
      const payload = JSON.parse(
        Buffer.concat([decipher.update(encoded.subarray(28)), decipher.final()]).toString('utf8')
      ) as { version?: unknown; prefix?: unknown; afterOrder?: unknown }
      if (
        payload.version !== cursorVersion ||
        payload.prefix !== expectedPrefix ||
        (payload.afterOrder !== null &&
          (typeof payload.afterOrder !== 'string' || !opaqueOrderPattern.test(payload.afterOrder)))
      ) {
        throw new Error('invalid cursor payload')
      }
      return payload.afterOrder ?? undefined
    } catch {
      throw new Error('Local object cursor is invalid')
    }
  }
}

function assertExpectedUpload(byteSize: number, contentMd5: string) {
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > LOCAL_MAX_UPLOAD_BYTES) {
    throw new LocalObjectIntegrityError('UPLOAD_TOO_LARGE')
  }
  if (!/^[A-Za-z0-9+/]{21}[AQgw]==$/.test(contentMd5) || Buffer.from(contentMd5, 'base64').byteLength !== 16) {
    throw new LocalObjectIntegrityError('DIGEST_MISMATCH')
  }
}

async function writeAll(handle: Awaited<ReturnType<typeof open>>, chunk: Buffer) {
  let offset = 0
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset)
    if (bytesWritten < 1) throw new Error('Local object write did not make progress')
    offset += bytesWritten
  }
}

function insertCandidate(
  candidates: Array<{ key: string; order: string }>,
  value: { key: string; order: string },
  maximum: number
) {
  let low = 0
  let high = candidates.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (candidates[middle]!.order < value.order) low = middle + 1
    else high = middle
  }
  candidates.splice(low, 0, value)
  if (candidates.length > maximum) candidates.pop()
}

function normalizePageSize(limit = LOCAL_MAX_PAGE_SIZE) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > LOCAL_MAX_PAGE_SIZE) {
    throw new RangeError(`Local object pages must contain between 1 and ${LOCAL_MAX_PAGE_SIZE} objects`)
  }
  return limit
}

function consumeFilesystemEntry(
  budget: { remaining: number },
  message = 'Local object listing exceeded its bounded filesystem scan'
) {
  if (budget.remaining <= 0) throw new Error(message)
  budget.remaining -= 1
}

function deriveStorageKey(secret: string, context: string) {
  return createHash('sha256').update(context).update('\0').update(secret).digest()
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function unsafeStorageError() {
  return new Error('Local object storage contains an unsafe filesystem entry')
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === code
  )
}
