import { createDecipheriv, createHash, createHmac, randomUUID } from 'node:crypto'
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { FILE_MANAGED_OBJECT_PREFIX } from '../server/services/storage/file-object-keys'
import {
  LocalObjectAlreadyExistsError,
  LocalObjectStorage,
  LOCAL_MAX_FILESYSTEM_ENTRIES_PER_PAGE,
  LOCAL_MAX_PAGE_SIZE,
  LOCAL_MAX_UPLOAD_BYTES,
  LOCAL_TEMP_ARTIFACT_STALE_MS
} from '../server/services/storage/local-object-storage'

const temporaryDirectories: string[] = []
const storageSecret = 'stable-test-secret'

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('persistent local object storage', () => {
  it('streams, verifies, atomically promotes, persists, and reads without exposing partial files', async () => {
    const root = await storageRoot()
    const key = newKey()
    const content = Buffer.from('streamed private content')
    const storage = new LocalObjectStorage(root, storageSecret)

    await expect(
      storage.writeVerifiedObject({
        key,
        body: Readable.from([content.subarray(0, 7), content.subarray(7)]),
        expectedByteSize: content.byteLength,
        expectedContentMd5: md5(content)
      })
    ).resolves.toEqual({ key, byteSize: content.byteLength, contentMd5: md5(content) })

    expect(await storage.headPersistedObject(key)).toEqual({ key, byteSize: content.byteLength })
    const reopened = new LocalObjectStorage(root, storageSecret)
    const downloaded = await reopened.createReadStream(key)
    expect(downloaded).toMatchObject({ key, byteSize: content.byteLength })
    expect(await collect(downloaded!.body)).toEqual(content)
    expect(await readdir(join(root, '.tmp'))).toEqual([])
  })

  it('removes failed temporary writes and never overwrites or removes an existing object', async () => {
    const root = await storageRoot()
    const key = newKey()
    const original = Buffer.from('original')
    const storage = new LocalObjectStorage(root, storageSecret)
    await write(storage, key, original)

    await expect(
      storage.writeVerifiedObject({
        key,
        body: Readable.from(['replacement']),
        expectedByteSize: Buffer.byteLength('replacement'),
        expectedContentMd5: md5(Buffer.from('replacement'))
      })
    ).rejects.toBeInstanceOf(LocalObjectAlreadyExistsError)

    const existing = await storage.createReadStream(key)
    expect(await collect(existing!.body)).toEqual(original)

    const failedKey = newKey()
    await expect(
      storage.writeVerifiedObject({
        key: failedKey,
        body: Readable.from(['short']),
        expectedByteSize: 20,
        expectedContentMd5: md5(Buffer.from('different'))
      })
    ).rejects.toMatchObject({ name: 'LocalObjectIntegrityError', code: 'SIZE_MISMATCH' })
    expect(await storage.headPersistedObject(failedKey)).toBeNull()
    expect(await readdir(join(root, '.tmp'))).toEqual([])
  })

  it('keeps the authenticated publication marker until the authoritative post-link check succeeds', async () => {
    const root = await storageRoot()
    const key = newKey()
    const content = Buffer.from('publication race')
    const storage = new LocalObjectStorage(root, storageSecret)
    const phases: string[] = []

    await expect(
      storage.writeVerifiedObject({
        key,
        body: Readable.from([content]),
        expectedByteSize: content.byteLength,
        expectedContentMd5: md5(content),
        validatePublication: async (phase) => {
          phases.push(phase)
          if (phase !== 'after-link') return
          expect(await storage.headPersistedObject(key)).toEqual({ key, byteSize: content.byteLength })
          expect(await readdir(join(root, '.tmp'))).toHaveLength(1)
          throw new Error('authoritative row disappeared')
        }
      })
    ).rejects.toThrow('authoritative row disappeared')

    expect(phases).toEqual(['before-link', 'after-link'])
    expect(await storage.headPersistedObject(key)).toBeNull()
    expect(await readdir(join(root, '.tmp'))).toEqual([])
  })

  it('fails closed on malformed declarations, bounds, absent objects, and cursors', async () => {
    const root = await storageRoot()
    expect(() => new LocalObjectStorage(root, '')).toThrow('Local object cursor secret is required')
    const storage = new LocalObjectStorage(root, storageSecret)
    const key = newKey()

    for (const expectedByteSize of [0, LOCAL_MAX_UPLOAD_BYTES + 1, Number.NaN]) {
      await expect(
        storage.writeVerifiedObject({
          key,
          body: Readable.from(['x']),
          expectedByteSize,
          expectedContentMd5: md5(Buffer.from('x'))
        })
      ).rejects.toMatchObject({ name: 'LocalObjectIntegrityError', code: 'UPLOAD_TOO_LARGE' })
    }
    await expect(
      storage.writeVerifiedObject({
        key,
        body: Readable.from(['x']),
        expectedByteSize: 1,
        expectedContentMd5: 'not-a-canonical-digest'
      })
    ).rejects.toMatchObject({ name: 'LocalObjectIntegrityError', code: 'DIGEST_MISMATCH' })
    await expect(
      storage.writeVerifiedObject({
        key,
        body: Readable.from(['x']),
        expectedByteSize: 1,
        expectedContentMd5: md5(Buffer.from('y'))
      })
    ).rejects.toMatchObject({ name: 'LocalObjectIntegrityError', code: 'DIGEST_MISMATCH' })

    await expect(
      storage.writeVerifiedObject({
        key,
        body: Readable.from(['xy']),
        expectedByteSize: 1,
        expectedContentMd5: md5(Buffer.from('x'))
      })
    ).rejects.toMatchObject({ name: 'LocalObjectIntegrityError', code: 'SIZE_MISMATCH' })

    const maximumDeclaration = Buffer.alloc(LOCAL_MAX_UPLOAD_BYTES)
    await expect(
      storage.writeVerifiedObject({
        key,
        body: Readable.from([Buffer.alloc(LOCAL_MAX_UPLOAD_BYTES + 1)]),
        expectedByteSize: LOCAL_MAX_UPLOAD_BYTES,
        expectedContentMd5: md5(maximumDeclaration)
      })
    ).rejects.toMatchObject({ name: 'LocalObjectIntegrityError', code: 'UPLOAD_TOO_LARGE' })

    expect(await storage.headPersistedObject(key)).toBeNull()
    expect(await storage.createReadStream(key)).toBeNull()
    await expect(storage.deleteObjects(Array.from({ length: LOCAL_MAX_PAGE_SIZE + 1 }, () => key))).rejects.toThrow(
      `Local deletion is limited to ${LOCAL_MAX_PAGE_SIZE} managed objects per request`
    )
    for (const limit of [0, LOCAL_MAX_PAGE_SIZE + 1, Number.NaN]) {
      await expect(storage.listPage({ prefix: FILE_MANAGED_OBJECT_PREFIX, limit })).rejects.toThrow(
        `Local object pages must contain between 1 and ${LOCAL_MAX_PAGE_SIZE} objects`
      )
    }
    for (const cursor of ['x', 'x'.repeat(4097)]) {
      await expect(storage.listPage({ prefix: FILE_MANAGED_OBJECT_PREFIX, cursor })).rejects.toThrow(
        'Local object cursor is invalid'
      )
    }

    const keys = [newKey(), newKey()]
    for (const objectKey of keys) await write(storage, objectKey, Buffer.from(objectKey))
    const page = await storage.listPage({ prefix: FILE_MANAGED_OBJECT_PREFIX, limit: 1 })
    const encoded = Buffer.from(page.nextCursor!, 'base64url')
    encoded[encoded.length - 1] ^= 1
    await expect(
      storage.listPage({ prefix: FILE_MANAGED_OBJECT_PREFIX, cursor: encoded.toString('base64url') })
    ).rejects.toThrow('Local object cursor is invalid')
  })

  it('rejects symlinked targets and parents without writing outside its root', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'swl-local-storage-symlink-'))
    temporaryDirectories.push(directory)
    const root = join(directory, 'objects')
    const outside = join(directory, 'outside')
    await mkdir(outside, { recursive: true })
    await mkdir(root, { recursive: true })
    await symlink(outside, join(root, 'files'))
    const storage = new LocalObjectStorage(root, storageSecret)

    await expect(write(storage, newKey(), Buffer.from('blocked'))).rejects.toThrow(
      'Local object storage contains an unsafe filesystem entry'
    )
    expect(await readdir(outside)).toEqual([])
  })

  it('rejects a symlinked listing prefix before reading entries outside its root', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'swl-local-storage-list-symlink-'))
    temporaryDirectories.push(directory)
    const root = join(directory, 'objects')
    const outside = join(directory, 'outside')
    const outsideKey = newKey()
    await mkdir(join(root, 'files'), { recursive: true })
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, outsideKey.slice(FILE_MANAGED_OBJECT_PREFIX.length)), 'outside')
    await symlink(outside, join(root, 'files', 'v1'))
    const storage = new LocalObjectStorage(root, storageSecret)

    await expect(storage.listPage({ prefix: FILE_MANAGED_OBJECT_PREFIX })).rejects.toThrow(
      'Local object storage contains an unsafe filesystem entry'
    )
    expect(await readFile(join(outside, outsideKey.slice(FILE_MANAGED_OBJECT_PREFIX.length)), 'utf8')).toBe('outside')
  })

  it('uses confidential prefix-bound digest cursors and bounded pages while deletion remains idempotent', async () => {
    const root = await storageRoot()
    const storage = new LocalObjectStorage(root, storageSecret)
    const keys = [newKey(), newKey(), newKey()].sort()
    for (const key of keys) await write(storage, key, Buffer.from(key))

    const first = await storage.listPage({ prefix: FILE_MANAGED_OBJECT_PREFIX, limit: 2 })
    expect(first.keys).toHaveLength(2)
    expect(first.nextCursor).toEqual(expect.any(String))
    expect(Buffer.from(first.nextCursor!, 'base64url').toString('utf8')).not.toContain('file_')
    const cursorPayload = decryptCursor(first.nextCursor!, storageSecret)
    expect(cursorPayload).toEqual({
      version: 2,
      prefix: FILE_MANAGED_OBJECT_PREFIX,
      afterOrder: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)
    })
    for (const key of keys) expect(JSON.stringify(cursorPayload)).not.toContain(key)

    const second = await storage.listPage({
      prefix: FILE_MANAGED_OBJECT_PREFIX,
      cursor: first.nextCursor,
      limit: 2
    })
    expect(second.nextCursor).toBeUndefined()
    expect([...first.keys, ...second.keys].sort()).toEqual(keys)
    await storage.deleteObjects(keys)
    await storage.deleteObjects(keys)
    expect(await storage.listPage({ prefix: FILE_MANAGED_OBJECT_PREFIX })).toEqual({
      keys: [],
      nextCursor: undefined
    })
  })

  it('removes only authenticated crash artifacts while preserving live uploads and published objects', async () => {
    const root = await storageRoot()
    const storage = new LocalObjectStorage(root, storageSecret)
    const interruptedKey = newKey()
    const interruptedContent = Buffer.from('interrupted private content')
    let releaseBody!: () => void
    let markPaused!: () => void
    const released = new Promise<void>((resolve) => {
      releaseBody = resolve
    })
    const paused = new Promise<void>((resolve) => {
      markPaused = resolve
    })

    async function* interruptedBody() {
      yield interruptedContent
      markPaused()
      await released
      throw new Error('simulated interrupted request')
    }

    const interruptedUpload = storage.writeVerifiedObject({
      key: interruptedKey,
      body: interruptedBody(),
      expectedByteSize: interruptedContent.byteLength,
      expectedContentMd5: md5(interruptedContent)
    })
    await paused
    const temporaryRoot = join(root, '.tmp')
    const [artifactName] = await readdir(temporaryRoot)
    expect(artifactName).toMatch(/^swl-upload-v1\./)
    releaseBody()
    await expect(interruptedUpload).rejects.toThrow('simulated interrupted request')
    expect(await readdir(temporaryRoot)).toEqual([])

    const publishedKey = newKey()
    const publishedContent = Buffer.from('published private content')
    await write(storage, publishedKey, publishedContent)
    const artifactPath = join(temporaryRoot, artifactName!)
    const publishedPath = join(root, publishedKey)
    await link(publishedPath, artifactPath)
    await writeFile(join(temporaryRoot, 'unmanaged.tmp'), 'operator-owned')
    await writeFile(join(temporaryRoot, `swl-upload-v1.${'a'.repeat(24)}.${'b'.repeat(43)}.tmp`), 'forged')

    await storage.listPage({ prefix: FILE_MANAGED_OBJECT_PREFIX })
    expect((await readdir(temporaryRoot)).sort()).toEqual(
      [`swl-upload-v1.${'a'.repeat(24)}.${'b'.repeat(43)}.tmp`, 'unmanaged.tmp'].sort()
    )
    expect(await readFile(publishedPath)).toEqual(publishedContent)

    await writeFile(artifactPath, 'fresh crash bytes')
    await storage.listPage({ prefix: FILE_MANAGED_OBJECT_PREFIX })
    expect(await readdir(temporaryRoot)).toContain(artifactName)

    const staleTime = new Date(Date.now() - LOCAL_TEMP_ARTIFACT_STALE_MS - 1_000)
    await utimes(artifactPath, staleTime, staleTime)
    await storage.listPage({ prefix: FILE_MANAGED_OBJECT_PREFIX })
    expect(await readdir(temporaryRoot)).not.toContain(artifactName)
    expect(await readFile(publishedPath)).toEqual(publishedContent)
  })

  it('continues bounded temporary cleanup durably before listing managed objects', async () => {
    const root = await storageRoot()
    const temporaryRoot = join(root, '.tmp')
    await mkdir(temporaryRoot, { recursive: true })
    const staleTime = new Date(Date.now() - LOCAL_TEMP_ARTIFACT_STALE_MS - 1_000)
    const artifactNames = Array.from({ length: 101 }, (_, index) => authenticatedTemporaryArtifactName(index))
    await Promise.all(
      artifactNames.map(async (name) => {
        const path = join(temporaryRoot, name)
        await writeFile(path, 'crash bytes')
        await utimes(path, staleTime, staleTime)
      })
    )
    const storage = new LocalObjectStorage(root, storageSecret)

    const first = await storage.listPage({ prefix: FILE_MANAGED_OBJECT_PREFIX })
    expect(first).toEqual({ keys: [], nextCursor: expect.any(String) })
    expect(decryptCursor(first.nextCursor!, storageSecret)).toEqual({
      version: 2,
      prefix: FILE_MANAGED_OBJECT_PREFIX,
      afterOrder: null
    })
    expect(await readdir(temporaryRoot)).toHaveLength(1)

    await expect(storage.listPage({ prefix: FILE_MANAGED_OBJECT_PREFIX, cursor: first.nextCursor })).resolves.toEqual({
      keys: [],
      nextCursor: undefined
    })
    expect(await readdir(temporaryRoot)).toEqual([])
  })

  it('fails closed after the explicit per-page filesystem scan budget', async () => {
    const root = await storageRoot()
    const managedRoot = join(root, FILE_MANAGED_OBJECT_PREFIX)
    await mkdir(managedRoot, { recursive: true })
    const names = Array.from({ length: LOCAL_MAX_FILESYSTEM_ENTRIES_PER_PAGE + 1 }, () =>
      newKey().slice(FILE_MANAGED_OBJECT_PREFIX.length)
    )
    for (let offset = 0; offset < names.length; offset += 250) {
      await Promise.all(names.slice(offset, offset + 250).map((name) => writeFile(join(managedRoot, name), 'x')))
    }
    const storage = new LocalObjectStorage(root, storageSecret)

    await expect(storage.listPage({ prefix: FILE_MANAGED_OBJECT_PREFIX })).rejects.toThrow(
      'Local object listing exceeded its bounded filesystem scan'
    )
  })
})

async function storageRoot() {
  const directory = await mkdtemp(join(tmpdir(), 'swl-local-storage-'))
  temporaryDirectories.push(directory)
  return join(directory, 'objects')
}

function newKey() {
  return `files/v1/file_${randomUUID()}`
}

function md5(value: Buffer) {
  return createHash('md5').update(value).digest('base64')
}

function write(storage: LocalObjectStorage, key: string, content: Buffer) {
  return storage.writeVerifiedObject({
    key,
    body: Readable.from([content]),
    expectedByteSize: content.byteLength,
    expectedContentMd5: md5(content)
  })
}

async function collect(stream: Readable) {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

function decryptCursor(cursor: string, secret: string) {
  const encoded = Buffer.from(cursor, 'base64url')
  const key = createHash('sha256').update('swl:file-storage-cursor:v2').update('\0').update(secret).digest()
  const decipher = createDecipheriv('aes-256-gcm', key, encoded.subarray(0, 12))
  decipher.setAuthTag(encoded.subarray(12, 28))
  return JSON.parse(Buffer.concat([decipher.update(encoded.subarray(28)), decipher.final()]).toString('utf8'))
}

function authenticatedTemporaryArtifactName(index: number) {
  const nonceBytes = Buffer.alloc(18)
  nonceBytes.writeUInt32BE(index, 14)
  const nonce = nonceBytes.toString('base64url')
  const key = createHash('sha256')
    .update('swl:file-storage-temp-artifact:v1')
    .update('\0')
    .update(storageSecret)
    .digest()
  const signature = createHmac('sha256', key).update(nonce).digest('base64url')
  return `swl-upload-v1.${nonce}.${signature}.tmp`
}
