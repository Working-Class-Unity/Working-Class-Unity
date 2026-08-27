import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { constants as fsConstants, createReadStream } from 'node:fs'
import { chmod, link, lstat, mkdir, open, readdir, realpath, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const OFF_HOST_BACKUP_PREFIX = 'sqlite/v1/'
export const OFF_HOST_BACKUP_MAX_BYTES = 5 * 1024 * 1024 * 1024 - 5 * 1024 * 1024

const requestTimeoutMs = 10 * 60 * 1000
const maximumFreshnessHours = 7 * 24
const maximumClockSkewMs = 5 * 60 * 1000
const maximumRecentObjectsPerDay = 1000
const snapshotReadBufferBytes = 1024 * 1024
const formatMetadata = 'sqlite-online-backup-v1'
const backupFilenamePattern = /^sqlite-offhost-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-([a-f0-9]{12})\.db$/
const objectKeyPattern =
  /^sqlite\/v1\/(\d{4})\/(\d{2})\/(\d{2})\/sqlite-offhost-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-([a-f0-9]{12})-sha256-([a-f0-9]{64})\.db$/
const cloudflareAccountIdPattern = /^[0-9a-f]{32}$/

export class OffHostBackupError extends Error {}

export class R2BackupStore {
  constructor(config, options = {}) {
    this.bucket = normalizeBucketName(config.bucket)
    this.endpoint = normalizeCloudflareEndpoint(config.endpoint, config.accountId)
    this.requestTimeoutMs = options.requestTimeoutMs ?? requestTimeoutMs
    if (!Number.isSafeInteger(this.requestTimeoutMs) || this.requestTimeoutMs < 1) {
      throw new OffHostBackupError('The R2 request timeout must be a positive integer.')
    }

    const clientConfig = {
      region: 'auto',
      endpoint: this.endpoint,
      credentials: {
        accessKeyId: requireCredential(config.accessKeyId, 'BACKUP_R2_ACCESS_KEY_ID'),
        secretAccessKey: requireCredential(config.secretAccessKey, 'BACKUP_R2_SECRET_ACCESS_KEY')
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      retryMode: 'standard',
      maxAttempts: 1,
      logger: {
        debug() {},
        info() {},
        warn() {},
        error() {}
      }
    }
    if (options.requestHandler) clientConfig.requestHandler = options.requestHandler
    this.client = new S3Client(clientConfig)
  }

  destroy() {
    this.client.destroy()
  }

  async head(key, signal) {
    const objectKey = parseObjectKey(key).key
    try {
      const result = await this.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: objectKey
        }),
        signal
      )
      return remoteMetadata(result)
    } catch (error) {
      if (isNotFound(error)) return null
      throw providerFailure('read backup metadata')
    }
  }

  async put(key, snapshot, signal) {
    const objectKey = parseObjectKey(key).key
    try {
      await this.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
          Body: createReadStream(snapshot.path),
          ContentLength: snapshot.byteSize,
          ContentMD5: snapshot.md5Base64,
          ContentType: 'application/vnd.sqlite3',
          ContentDisposition: 'attachment',
          CacheControl: 'private, no-store',
          IfNoneMatch: '*',
          Metadata: {
            'swl-sha256': snapshot.sha256,
            'swl-format': formatMetadata
          }
        }),
        signal
      )
    } catch {
      throw providerFailure('write the immutable backup object')
    }
  }

  async readAndHash(key, signal, destinationPath) {
    const objectKey = parseObjectKey(key).key
    let result
    try {
      result = await this.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: objectKey
        }),
        signal
      )
    } catch {
      throw providerFailure('read the immutable backup object')
    }

    if (!result.Body || typeof result.Body[Symbol.asyncIterator] !== 'function') {
      throw new OffHostBackupError('R2 returned a backup object without a readable body.')
    }

    const hash = createHash('sha256')
    let byteSize = 0
    let output
    try {
      if (destinationPath) output = await open(destinationPath, 'wx', 0o600)
      for await (const value of result.Body) {
        if (signal?.aborted) throw signal.reason ?? new Error('Aborted')
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
        byteSize += chunk.byteLength
        if (byteSize > OFF_HOST_BACKUP_MAX_BYTES) {
          throw new OffHostBackupError('The R2 backup object exceeds the supported single-object size.')
        }
        hash.update(chunk)
        if (output) await writeAll(output, chunk)
      }
      if (output) await output.sync()
    } catch (error) {
      if (error instanceof OffHostBackupError) throw error
      throw providerFailure('read the complete immutable backup object')
    } finally {
      await output?.close().catch(() => {})
    }

    return {
      byteSize,
      sha256: hash.digest('hex'),
      responseByteSize: result.ContentLength,
      metadata: remoteMetadata(result)
    }
  }

  async listDatePrefix(datePrefix, signal) {
    let result
    try {
      result = await this.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: datePrefix,
          MaxKeys: maximumRecentObjectsPerDay
        }),
        signal
      )
    } catch {
      throw providerFailure('list recent backup receipts')
    }

    if (result.IsTruncated) {
      throw new OffHostBackupError('R2 returned an unexpected number of backup objects for one UTC day.')
    }
    return (result.Contents ?? []).map((entry) => {
      if (!entry.Key) throw new OffHostBackupError('R2 returned a backup receipt without an object key.')
      return parseObjectKey(entry.Key)
    })
  }

  async send(command, signal) {
    const timeout = AbortSignal.timeout(this.requestTimeoutMs)
    const abortSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
    return this.client.send(command, { abortSignal })
  }
}

async function writeAll(output, chunk) {
  let offset = 0
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await output.write(chunk, offset, chunk.byteLength - offset)
    if (bytesWritten < 1) throw new OffHostBackupError('The staged backup download could not be written completely.')
    offset += bytesWritten
  }
}

export function readBackupConfiguration(environment) {
  const accountId = requireSetting(environment.BACKUP_R2_ACCOUNT_ID, 'BACKUP_R2_ACCOUNT_ID')
  return {
    accountId,
    bucket: normalizeBucketName(requireSetting(environment.BACKUP_R2_BUCKET, 'BACKUP_R2_BUCKET')),
    endpoint: normalizeCloudflareEndpoint(
      requireSetting(environment.BACKUP_R2_ENDPOINT, 'BACKUP_R2_ENDPOINT'),
      accountId
    ),
    accessKeyId: requireCredential(environment.BACKUP_R2_ACCESS_KEY_ID, 'BACKUP_R2_ACCESS_KEY_ID'),
    secretAccessKey: requireCredential(environment.BACKUP_R2_SECRET_ACCESS_KEY, 'BACKUP_R2_SECRET_ACCESS_KEY')
  }
}

export async function uploadVerifiedSnapshot({ path, store, signal, verifiedSnapshot }) {
  const snapshot = await inspectSnapshot(path, signal)
  if (verifiedSnapshot) assertSameSnapshot(verifiedSnapshot, snapshot)
  const key = objectKeyForSnapshot(snapshot)
  const existing = await store.head(key, signal)
  if (!existing) {
    try {
      await store.put(key, snapshot, signal)
    } catch {
      // A timed-out or interrupted conditional PUT can still have committed. Only
      // the full strongly-consistent read below may reconcile that uncertainty.
    }
  }

  await verifyRemoteObject(store, key, snapshot, signal)
  return { key, byteSize: snapshot.byteSize, sha256: snapshot.sha256, reused: Boolean(existing) }
}

export async function fetchVerifiedSnapshot({
  key,
  paths,
  store,
  signal,
  verifyBackup,
  backupBucket,
  removePath = rm
}) {
  const parsed = parseObjectKey(key)
  const finalPath = join(paths.backupsDirectory, basename(parsed.key))
  await assertUnusedRegularPath(finalPath, 'Fetched backup output')
  const stagedPath = join(
    paths.backupsDirectory,
    `.off-host-fetch-${process.pid}-${randomBytes(6).toString('hex')}.tmp`
  )

  let operationError
  try {
    const expected = await requireRemoteMetadata(store, parsed.key, parsed.sha256, signal)
    const downloaded = await store.readAndHash(parsed.key, signal, stagedPath)
    assertRemoteBytes(downloaded, expected.byteSize, parsed.sha256)
    await chmod(stagedPath, 0o600)
    await verifyBackup(stagedPath, { current: false, offHostCoverage: true, backupBucket, signal })
    await link(stagedPath, finalPath)
    return { path: finalPath, key: parsed.key, byteSize: downloaded.byteSize, sha256: downloaded.sha256 }
  } catch (error) {
    operationError = error
    throw error
  } finally {
    await removeAfterOperation(
      stagedPath,
      { force: true },
      operationError,
      removePath,
      'The private fetched-backup staging file could not be removed; inspect it before retrying.'
    )
  }
}

export async function verifyLatestReceipt({ store, now, maximumAgeHours, signal }) {
  if (!Number.isFinite(maximumAgeHours) || maximumAgeHours <= 0 || maximumAgeHours > maximumFreshnessHours) {
    throw new OffHostBackupError(
      `Maximum backup age must be greater than 0 and at most ${maximumFreshnessHours} hours.`
    )
  }
  const current = normalizeDate(now)
  const daysToSearch = Math.ceil(maximumAgeHours / 24)
  const prefixes = Array.from({ length: daysToSearch + 1 }, (_, index) =>
    dateObjectPrefix(new Date(current.getTime() - index * 24 * 60 * 60 * 1000))
  )
  const entries = (await Promise.all(prefixes.map((prefix) => store.listDatePrefix(prefix, signal)))).flat()
  if (entries.length === 0) throw new OffHostBackupError('No recent immutable R2 backup receipt was found.')

  const latest = entries.reduce((candidate, entry) =>
    entry.createdAt.getTime() > candidate.createdAt.getTime() ? entry : candidate
  )
  const ageMs = current.getTime() - latest.createdAt.getTime()
  if (ageMs < -maximumClockSkewMs) {
    throw new OffHostBackupError('The latest R2 backup receipt is unacceptably far in the future.')
  }
  if (ageMs > maximumAgeHours * 60 * 60 * 1000) {
    throw new OffHostBackupError('The latest immutable R2 backup receipt is stale.')
  }
  await requireRemoteMetadata(store, latest.key, latest.sha256, signal)
  return { key: latest.key, ageMinutes: Math.max(0, Math.floor(ageMs / 60_000)) }
}

export async function runOffHostBackupCli(args, environment, dependencies = {}) {
  const command = args[0]
  const signal = dependencies.signal
  const now = dependencies.now ?? (() => new Date())
  const configuration = readBackupConfiguration(environment)
  if (command === 'validate-config') {
    if (args.length !== 1) throw usageError()
    return { command }
  }
  const store = dependencies.store ?? new R2BackupStore(configuration, dependencies.storeOptions)
  const ownsStore = !dependencies.store
  const removePath = dependencies.removePath ?? rm
  const verifyBackup =
    dependencies.verifyBackup ??
    ((path, options) => runMaintenanceVerification(path, options, environment, dependencies.maintenanceEntry, signal))

  try {
    if (command === 'verify-latest') {
      const value = parseSingleOption(
        args.slice(1),
        '--max-age-hours',
        'Freshness verification requires one --max-age-hours NUMBER.'
      )
      return await verifyLatestReceipt({ store, now: now(), maximumAgeHours: Number(value), signal })
    }

    if (!['backup', 'upload', 'fetch'].includes(command)) throw usageError()
    if (command === 'backup' && args.length !== 1) throw usageError()
    const uploadInput =
      command === 'upload' ? parseSingleOption(args.slice(1), '--input', 'Upload requires one --input PATH.') : ''
    const fetchKey =
      command === 'fetch' ? parseSingleOption(args.slice(1), '--key', 'Fetch requires one --key OBJECT_KEY.') : ''
    const paths = await databasePaths(environment)

    if (command === 'backup') {
      return await withOperatorLock(
        paths,
        async () => {
          const snapshotPath = join(paths.backupsDirectory, snapshotFilename(now()))
          await runMaintenance(
            ['backup', '--output', snapshotPath],
            environment,
            dependencies.maintenanceEntry,
            signal,
            snapshotPath
          )
          try {
            const verifiedSnapshot = await inspectSnapshot(snapshotPath, signal)
            await verifyBackup(snapshotPath, {
              current: true,
              offHostCoverage: true,
              backupBucket: configuration.bucket,
              signal
            })
            const receipt = await uploadVerifiedSnapshot({ path: snapshotPath, store, signal, verifiedSnapshot })
            await rm(snapshotPath)
            return { command, ...receipt }
          } catch (error) {
            throw retainedSnapshotFailure(error, snapshotPath)
          }
        },
        removePath
      )
    }

    if (command === 'upload') {
      const inputPath = await resolveBackupInput(paths, uploadInput, 'Upload input')
      return await withOperatorLock(
        paths,
        async () => {
          try {
            const verifiedSnapshot = await inspectSnapshot(inputPath, signal)
            await verifyBackup(inputPath, {
              current: true,
              offHostCoverage: true,
              backupBucket: configuration.bucket,
              signal
            })
            const receipt = await uploadVerifiedSnapshot({ path: inputPath, store, signal, verifiedSnapshot })
            await rm(inputPath)
            return { command, ...receipt }
          } catch (error) {
            throw retainedSnapshotFailure(error, inputPath)
          }
        },
        removePath
      )
    }

    if (command === 'fetch') {
      return await withOperatorLock(
        paths,
        async () => {
          const receipt = await fetchVerifiedSnapshot({
            key: fetchKey,
            paths,
            store,
            signal,
            verifyBackup,
            backupBucket: configuration.bucket,
            removePath
          })
          return { command, ...receipt }
        },
        removePath
      )
    }

    throw usageError()
  } finally {
    if (ownsStore) store.destroy()
  }
}

async function verifyRemoteObject(store, key, snapshot, signal) {
  const expected = await requireRemoteMetadata(store, key, snapshot.sha256, signal)
  if (expected.byteSize !== snapshot.byteSize) {
    throw new OffHostBackupError('The immutable R2 backup object has an unexpected byte size.')
  }
  const downloaded = await store.readAndHash(key, signal)
  assertRemoteBytes(downloaded, snapshot.byteSize, snapshot.sha256)
}

async function requireRemoteMetadata(store, key, sha256, signal) {
  const metadata = await store.head(key, signal)
  if (!metadata) throw new OffHostBackupError('The immutable R2 backup object is missing after publication.')
  if (
    !Number.isSafeInteger(metadata.byteSize) ||
    metadata.byteSize < 1 ||
    metadata.byteSize > OFF_HOST_BACKUP_MAX_BYTES ||
    metadata.sha256 !== sha256 ||
    metadata.format !== formatMetadata
  ) {
    throw new OffHostBackupError('The immutable R2 backup object metadata does not match its verified receipt.')
  }
  return metadata
}

function assertRemoteBytes(downloaded, expectedByteSize, expectedSha256) {
  if (
    downloaded.byteSize !== expectedByteSize ||
    (downloaded.responseByteSize !== undefined && downloaded.responseByteSize !== expectedByteSize) ||
    downloaded.sha256 !== expectedSha256
  ) {
    throw new OffHostBackupError('The downloaded R2 backup bytes do not match the verified receipt.')
  }
}

async function inspectSnapshot(path, signal) {
  const name = basename(path)
  const match = name.match(backupFilenamePattern)
  if (!match) throw new OffHostBackupError('The backup snapshot does not have an operator-generated immutable name.')

  let handle
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
  } catch {
    throw new OffHostBackupError('The backup snapshot must be an existing regular file, not a symbolic link.')
  }

  let hashed
  try {
    hashed = await hashOpenedSnapshot(handle, signal)
  } finally {
    await handle.close().catch(() => {})
  }
  return {
    path,
    name,
    timestamp: match[1],
    nonce: match[2],
    ...hashed
  }
}

async function hashOpenedSnapshot(handle, signal) {
  const before = await handle.stat({ bigint: true })
  if (!before.isFile()) {
    throw new OffHostBackupError('The backup snapshot must be an existing regular file, not a symbolic link.')
  }
  if (before.size < 1n || before.size > BigInt(OFF_HOST_BACKUP_MAX_BYTES)) {
    throw new OffHostBackupError(`The backup snapshot must contain between 1 and ${OFF_HOST_BACKUP_MAX_BYTES} bytes.`)
  }

  const md5 = createHash('md5')
  const sha256 = createHash('sha256')
  const buffer = Buffer.allocUnsafe(snapshotReadBufferBytes)
  const expectedSize = Number(before.size)
  let byteSize = 0
  while (byteSize < expectedSize) {
    if (signal?.aborted) throw new OffHostBackupError('Backup snapshot hashing was interrupted.')
    const requested = Math.min(buffer.byteLength, expectedSize - byteSize)
    const { bytesRead } = await handle.read(buffer, 0, requested, byteSize)
    if (bytesRead < 1) throw new OffHostBackupError('The backup snapshot changed while it was hashed.')
    const chunk = buffer.subarray(0, bytesRead)
    byteSize += bytesRead
    md5.update(chunk)
    sha256.update(chunk)
  }
  const after = await handle.stat({ bigint: true })
  const identity = snapshotIdentity(before)
  if (!sameSnapshotIdentity(identity, snapshotIdentity(after))) {
    throw new OffHostBackupError('The backup snapshot changed while it was hashed.')
  }
  return {
    byteSize,
    md5Base64: md5.digest('base64'),
    sha256: sha256.digest('hex'),
    identity
  }
}

function snapshotIdentity(entry) {
  return {
    device: String(entry.dev),
    inode: String(entry.ino),
    mode: String(entry.mode),
    links: String(entry.nlink),
    byteSize: String(entry.size),
    modifiedNs: String(entry.mtimeNs),
    changedNs: String(entry.ctimeNs)
  }
}

function sameSnapshotIdentity(left, right) {
  return Object.keys(left).every((key) => left[key] === right[key])
}

function assertSameSnapshot(verified, candidate) {
  if (
    verified.byteSize !== candidate.byteSize ||
    verified.md5Base64 !== candidate.md5Base64 ||
    verified.sha256 !== candidate.sha256 ||
    !sameSnapshotIdentity(verified.identity, candidate.identity)
  ) {
    throw new OffHostBackupError('The database-verified backup snapshot changed before publication.')
  }
}

function objectKeyForSnapshot(snapshot) {
  const createdAt = parseFilenameTimestamp(snapshot.timestamp)
  const year = String(createdAt.getUTCFullYear()).padStart(4, '0')
  const month = String(createdAt.getUTCMonth() + 1).padStart(2, '0')
  const day = String(createdAt.getUTCDate()).padStart(2, '0')
  return `${OFF_HOST_BACKUP_PREFIX}${year}/${month}/${day}/sqlite-offhost-${snapshot.timestamp}-${snapshot.nonce}-sha256-${snapshot.sha256}.db`
}

function parseObjectKey(key) {
  const match = typeof key === 'string' ? key.match(objectKeyPattern) : null
  if (!match) throw new OffHostBackupError('The R2 backup object key is outside the immutable SQLite namespace.')
  const createdAt = parseFilenameTimestamp(match[4])
  const year = String(createdAt.getUTCFullYear()).padStart(4, '0')
  const month = String(createdAt.getUTCMonth() + 1).padStart(2, '0')
  const day = String(createdAt.getUTCDate()).padStart(2, '0')
  if (match[1] !== year || match[2] !== month || match[3] !== day) {
    throw new OffHostBackupError('The R2 backup object key has inconsistent date components.')
  }
  return { key, createdAt, sha256: match[6] }
}

function parseFilenameTimestamp(timestamp) {
  const iso = timestamp.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, '$1T$2:$3:$4.$5Z')
  const value = new Date(iso)
  if (!Number.isFinite(value.getTime()) || value.toISOString() !== iso) {
    throw new OffHostBackupError('The backup receipt contains an invalid UTC timestamp.')
  }
  return value
}

function snapshotFilename(now) {
  const value = normalizeDate(now)
  return `sqlite-offhost-${value.toISOString().replaceAll(/[:.]/g, '-')}-${randomBytes(6).toString('hex')}.db`
}

function dateObjectPrefix(date) {
  const year = String(date.getUTCFullYear()).padStart(4, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${OFF_HOST_BACKUP_PREFIX}${year}/${month}/${day}/`
}

async function databasePaths(environment) {
  const databaseUrl = environment.NUXT_DATABASE_URL
  if (!databaseUrl || databaseUrl !== databaseUrl.trim() || !databaseUrl.startsWith('file:')) {
    throw new OffHostBackupError('NUXT_DATABASE_URL must be an already-trimmed absolute file: path.')
  }
  const candidate = databaseUrl.slice('file:'.length)
  if (!candidate || !isAbsolute(candidate) || candidate.includes('\0')) {
    throw new OffHostBackupError('NUXT_DATABASE_URL must be an already-trimmed absolute file: path.')
  }
  const databasePath = resolve(candidate)
  const dataDirectory = dirname(databasePath)
  await mkdir(dataDirectory, { recursive: true })
  const dataEntry = await lstat(dataDirectory)
  if (!dataEntry.isDirectory() || dataEntry.isSymbolicLink()) {
    throw new OffHostBackupError('The application data directory must be a real directory, not a symbolic link.')
  }
  const canonicalData = await realpath(dataDirectory)
  const backupsDirectory = join(dataDirectory, 'backups')
  await mkdir(backupsDirectory, { recursive: true, mode: 0o700 })
  const backupEntry = await lstat(backupsDirectory)
  const canonicalBackups = await realpath(backupsDirectory)
  if (
    !backupEntry.isDirectory() ||
    backupEntry.isSymbolicLink() ||
    relative(canonicalData, canonicalBackups) !== 'backups'
  ) {
    throw new OffHostBackupError(
      'The backup directory must be a real directory directly inside the application data directory.'
    )
  }
  return { databasePath, dataDirectory, backupsDirectory }
}

async function resolveBackupInput(paths, candidate, label) {
  if (!candidate || !isAbsolute(candidate)) {
    throw new OffHostBackupError(`${label} must be an absolute path directly inside the backup directory.`)
  }
  const path = resolve(candidate)
  if (dirname(path) !== resolve(paths.backupsDirectory)) {
    throw new OffHostBackupError(`${label} must be a file directly inside the backup directory.`)
  }
  const entry = await lstat(path).catch(() => null)
  if (!entry?.isFile() || entry.isSymbolicLink()) {
    throw new OffHostBackupError(`${label} must be an existing regular file, not a symbolic link.`)
  }
  if (dirname(await realpath(path)) !== (await realpath(paths.backupsDirectory))) {
    throw new OffHostBackupError(`${label} must resolve directly inside the backup directory.`)
  }
  return path
}

async function assertUnusedRegularPath(path, label) {
  const entry = await lstat(path).catch(() => null)
  if (entry) throw new OffHostBackupError(`${label} already exists; refusing to overwrite it.`)
}

async function withOperatorLock(paths, operation, removePath) {
  const lockPath = join(paths.backupsDirectory, '.off-host-backup.lock')
  try {
    await mkdir(lockPath, { mode: 0o700 })
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EEXIST') {
      throw new OffHostBackupError(
        'Another off-host backup operation may still be active; inspect the private lock before retrying.'
      )
    }
    throw error
  }

  let operationError
  try {
    return await operation()
  } catch (error) {
    operationError = error
    throw error
  } finally {
    await removeAfterOperation(
      lockPath,
      { recursive: true, force: true },
      operationError,
      removePath,
      'The private off-host backup lock could not be removed; inspect it before retrying.'
    )
  }
}

async function runMaintenance(args, environment, maintenanceEntry, signal, cleanupOutputPath) {
  const entry = maintenanceEntry ?? fileURLToPath(new URL('./maintenance.mjs', import.meta.url))
  let childPid
  try {
    await new Promise((accept, reject) => {
      const child = spawn(process.execPath, [entry, ...args], {
        env: maintenanceEnvironment(environment),
        stdio: ['ignore', 'inherit', 'inherit']
      })
      childPid = child.pid
      const interrupt = () => child.kill('SIGTERM')
      if (signal?.aborted) interrupt()
      else signal?.addEventListener('abort', interrupt, { once: true })
      child.once('error', (error) => {
        signal?.removeEventListener('abort', interrupt)
        reject(error)
      })
      child.once('exit', (code, childSignal) => {
        signal?.removeEventListener('abort', interrupt)
        if (childSignal) reject(new OffHostBackupError('The database maintenance process was interrupted.'))
        else if (code !== 0) reject(new OffHostBackupError('The database maintenance process rejected the backup.'))
        else accept()
      })
    })
  } catch (error) {
    if (cleanupOutputPath && childPid) {
      try {
        await cleanupInterruptedMaintenanceFiles(cleanupOutputPath, childPid)
      } catch {
        markCleanupRequired(error)
      }
    }
    throw error
  }
}

async function runMaintenanceVerification(path, options, environment, maintenanceEntry, signal) {
  const args = ['verify-backup', '--input', path]
  if (options.current) args.push('--require-current')
  if (options.offHostCoverage) {
    args.push('--require-off-host-coverage', '--backup-r2-bucket', options.backupBucket)
  }
  await runMaintenance(args, environment, maintenanceEntry, signal)
}

export function maintenanceEnvironment(environment) {
  return { NUXT_DATABASE_URL: environment.NUXT_DATABASE_URL }
}

async function cleanupInterruptedMaintenanceFiles(outputPath, childPid) {
  const directory = dirname(outputPath)
  const escapedName = escapeRegExp(basename(outputPath))
  const pattern = new RegExp(`^\\.${escapedName}\\.write-${childPid}-[a-f0-9]{12}\\.tmp(?:-(?:wal|shm|journal))?$`)
  const names = await readdir(directory).catch(() => [])
  await Promise.all(
    names.filter((name) => pattern.test(name)).map((name) => rm(join(directory, name), { force: true }))
  )
}

async function removeAfterOperation(path, options, operationError, removePath, failureMessage) {
  try {
    await removePath(path, options)
  } catch {
    if (operationError) {
      markCleanupRequired(operationError)
      return
    }
    const error = new OffHostBackupError(failureMessage)
    error.cleanupRequired = true
    throw error
  }
}

function markCleanupRequired(error) {
  if (error && (typeof error === 'object' || typeof error === 'function')) error.cleanupRequired = true
}

function escapeRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseSingleOption(args, expectedName, message) {
  if (args.length !== 2 || args[0] !== expectedName || !args[1] || args[1].startsWith('--')) {
    throw new OffHostBackupError(message)
  }
  return args[1]
}

function usageError() {
  return new OffHostBackupError(
    'Usage: node .output/server/off-host-backup.mjs <validate-config|backup|upload --input PATH|fetch --key OBJECT_KEY|verify-latest --max-age-hours NUMBER>'
  )
}

function remoteMetadata(result) {
  return {
    byteSize: result.ContentLength,
    sha256: result.Metadata?.['swl-sha256'],
    format: result.Metadata?.['swl-format']
  }
}

function retainedSnapshotFailure(error, path) {
  const failure =
    error instanceof OffHostBackupError ? error : new OffHostBackupError('The off-host backup did not complete safely.')
  failure.retainedSnapshot = basename(path)
  return failure
}

function providerFailure(operation) {
  return new OffHostBackupError(`The R2 provider could not ${operation}.`)
}

function isNotFound(error) {
  return error?.name === 'NotFound' || error?.name === 'NoSuchKey' || Number(error?.$metadata?.httpStatusCode) === 404
}

function requireSetting(value, name) {
  if (!value || value !== value.trim()) throw new OffHostBackupError(`${name} is required for the backup operator.`)
  return value
}

function requireCredential(value, name) {
  return requireSetting(value, name)
}

function normalizeBucketName(bucket) {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(bucket)) {
    throw new OffHostBackupError('BACKUP_R2_BUCKET must be a valid private R2 bucket name.')
  }
  return bucket
}

function normalizeCloudflareEndpoint(endpoint, accountId) {
  if (!cloudflareAccountIdPattern.test(accountId)) {
    throw new OffHostBackupError('BACKUP_R2_ACCOUNT_ID must be 32 lowercase hexadecimal characters.')
  }
  let url
  try {
    url = new URL(endpoint)
  } catch {
    throw new OffHostBackupError('BACKUP_R2_ENDPOINT must be a private Cloudflare HTTPS account endpoint.')
  }
  const validHostname =
    url.hostname === `${accountId}.r2.cloudflarestorage.com` ||
    url.hostname === `${accountId}.eu.r2.cloudflarestorage.com` ||
    url.hostname === `${accountId}.us.r2.cloudflarestorage.com` ||
    url.hostname === `${accountId}.fedramp.r2.cloudflarestorage.com`
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !validHostname
  ) {
    throw new OffHostBackupError('BACKUP_R2_ENDPOINT must be a private Cloudflare HTTPS account endpoint.')
  }
  return url.origin
}

function normalizeDate(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new OffHostBackupError('The backup operator clock must provide a valid date.')
  }
  return value
}

async function main() {
  const controller = new AbortController()
  let interrupted = false
  const interrupt = () => {
    interrupted = true
    controller.abort(new Error('Interrupted'))
  }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)

  try {
    const result = await runOffHostBackupCli(process.argv.slice(2), process.env, { signal: controller.signal })
    console.log(formatOffHostBackupSuccess(result))
  } catch (error) {
    const message = error instanceof OffHostBackupError ? error.message : 'The off-host backup operation failed safely.'
    const retained = error instanceof OffHostBackupError && error.retainedSnapshot
    const cleanup = error && typeof error === 'object' && error.cleanupRequired
    console.error(
      `Off-host backup failed: ${message}${retained ? ` Local snapshot retained as ${retained}.` : ''}${cleanup ? ' Private cleanup requires operator inspection.' : ''}`
    )
    process.exitCode = interrupted ? 130 : 1
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
  }
}

export function formatOffHostBackupSuccess(result) {
  if (result.command === 'validate-config') return 'Off-host backup configuration passed.'
  if ('path' in result) {
    return `Off-host backup fetch passed: ${basename(result.path)}; size ${result.byteSize} bytes; SHA-256 verified.`
  }
  if ('ageMinutes' in result) {
    return `Off-host backup freshness passed: ${result.key}; latest immutable receipt age ${result.ageMinutes} minutes.`
  }
  return `Off-host backup passed: ${result.key}; immutable object verified; size ${result.byteSize} bytes; SHA-256 ${result.sha256}.`
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
