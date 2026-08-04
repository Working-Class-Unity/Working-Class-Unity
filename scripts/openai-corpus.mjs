import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const OPENAI_CORPUS_BASE_URL = 'https://api.openai.com/v1'
export const OPENAI_CORPUS_OPERATION_TIMEOUT_MS = 30 * 60 * 1_000
export const OPENAI_CORPUS_MAX_FILES = 100
export const OPENAI_CORPUS_MAX_FILE_BYTES = 50 * 1_024 * 1_024
export const OPENAI_CORPUS_MAX_TOTAL_BYTES = 500 * 1_024 * 1_024

const MAX_JSON_BYTES = 1_024 * 1_024
const MARKER_KEY = 'swl_managed_by'
const MARKER_VALUE = 'swl-file-search-corpus-v1'
const RECEIPT_KEY = 'swl_receipt_id'
const CONTROL = /\p{C}/u
const VISIBLE = /^[\x21-\x7e]+$/
const STORE_ID = /^vs_[A-Za-z0-9_-]{1,200}$/
const FILE_ID = /^file-[A-Za-z0-9_-]{1,200}$/
const SHA256 = /^[a-f0-9]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STATUSES = new Set(['preparing', 'ready', 'compensated', 'cleanup_incomplete', 'deleted'])
const defaultReceiptDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'openai-corpus')
const appRequire = createRequire(new URL('../package.json', import.meta.url))
const usage = `Usage:
  pnpm openai:corpus prepare <manifest.json>
  pnpm openai:corpus verify <store-id>
  pnpm openai:corpus delete <store-id> --confirm <same-store-id>`

class ProviderError extends Error {
  constructor(action, cause) {
    const status = Number.isInteger(cause?.status) ? cause.status : undefined
    super(`OpenAI ${action} failed${status ? ` (status ${status})` : ''}`)
    this.status = status
  }
}

export function parseCorpusCommand(argv) {
  const [command, resource, ...rest] = argv
  if (command === 'prepare' && resource && rest.length === 0) return { command, manifestPath: resource }
  if (command === 'verify' && resource && rest.length === 0) {
    validStoreId(resource)
    return { command, storeId: resource }
  }
  if (command === 'delete' && resource && rest.length === 2 && rest[0] === '--confirm') {
    validStoreId(resource)
    validStoreId(rest[1])
    check(resource === rest[1], '--confirm must exactly match the store ID being deleted')
    return { command, storeId: resource }
  }
  throw new Error(usage)
}

export async function runCorpusCommand({
  argv,
  environment = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
  receiptDirectory = defaultReceiptDirectory,
  sleepImpl = sleep,
  timeoutMs = OPENAI_CORPUS_OPERATION_TIMEOUT_MS,
  uuid = randomUUID
}) {
  const command = parseCorpusCommand(argv)
  const deadline = createDeadline(timeoutMs, sleepImpl)
  if (command.command === 'prepare') {
    const manifest = await loadManifest(command.manifestPath, deadline)
    const sdk = createClient({ ...credentials(environment), fetchImpl, timeoutMs })
    return prepare({ deadline, logger, manifest, receiptDirectory, sdk, uuid })
  }
  const receipt = await readReceipt(receiptDirectory, command.storeId)
  const config = credentials(environment)
  check(receipt.projectId === config.project, 'receipt belongs to a different OpenAI project')
  const sdk = createClient({ ...config, fetchImpl, timeoutMs })
  return command.command === 'verify'
    ? verify({ deadline, logger, receipt, sdk })
    : remove({ deadline, logger, receipt, receiptDirectory, sdk })
}

async function prepare({ deadline, logger, manifest, receiptDirectory, sdk, uuid }) {
  const markerId = uuid()
  check(UUID.test(markerId), 'receipt marker generator returned an invalid UUID')
  let receipt
  let store
  try {
    const createdStore = await call('vector-store creation', deadline, (options) =>
      sdk.client.vectorStores.create(
        { metadata: { [MARKER_KEY]: MARKER_VALUE, [RECEIPT_KEY]: markerId }, name: manifest.name },
        options
      )
    )
    validStoreId(createdStore?.id)
    owns(createdStore, markerId)
    store = createdStore
    receipt = makeReceipt(store.id, markerId, sdk.project)
    await writeReceipt(receiptDirectory, receipt)

    for (const [index, file] of manifest.files.entries()) {
      const contents = await verifiedBytes(file)
      const upload = await sdk.toFile(contents, file.filename)
      const uploaded = await call(`file upload ${index + 1}`, deadline, (options) =>
        sdk.client.files.create({ file: upload, purpose: 'assistants' }, options)
      )
      validFileId(uploaded?.id)
      receipt.files.push({ fileId: uploaded.id, path: file.relativePath, sha256: file.sha256 })
      await writeReceipt(receiptDirectory, receipt)
      const attached = await call(`file attachment ${index + 1}`, deadline, (options) =>
        sdk.client.vectorStores.files.create(store.id, { file_id: uploaded.id }, options)
      )
      check(attached?.id === uploaded.id, 'OpenAI returned an unexpected attached file ID')
    }

    const ready = await waitUntilReady(store.id, markerId, manifest.files.length, deadline, sdk)
    assertReady(ready, manifest.files.length)
    receipt.status = 'ready'
    await writeReceipt(receiptDirectory, receipt)
    logger.log(`Prepared OpenAI corpus ${store.id} with ${receipt.files.length} file(s).`)
    return { command: 'prepare', fileCount: receipt.files.length, storeId: receipt.storeId }
  } catch (error) {
    if (store) {
      receipt ??= makeReceipt(store.id, markerId, sdk.project)
      receipt.cleanupFailures = await cleanup(receipt, deadline, sdk)
      receipt.status = receipt.cleanupFailures.length ? 'cleanup_incomplete' : 'compensated'
      await writeReceipt(receiptDirectory, receipt).catch(() => undefined)
      if (receipt.cleanupFailures.length) {
        throw new Error(
          `${message(error)}; compensation was incomplete (${receipt.cleanupFailures.length} resource failure(s))`
        )
      }
    }
    throw error
  }
}

async function verify({ deadline, logger, receipt, sdk }) {
  check(receipt.status === 'ready', `receipt is ${receipt.status}, not ready`)
  const store = await getStore(receipt.storeId, deadline, sdk)
  owns(store, receipt.markerId)
  assertReady(store, receipt.files.length)
  const remote = await listFiles(receipt.storeId, deadline, sdk)
  checkFiles(remote, receipt.files)
  check(
    remote.every((file) => file.status === 'completed'),
    'one or more corpus files are not completed'
  )
  logger.log(`Verified OpenAI corpus ${receipt.storeId} with ${receipt.files.length} file(s).`)
  return { command: 'verify', fileCount: receipt.files.length, storeId: receipt.storeId }
}

async function remove({ deadline, logger, receipt, receiptDirectory, sdk }) {
  let storeMissing = false
  try {
    const store = await getStore(receipt.storeId, deadline, sdk)
    owns(store, receipt.markerId)
    const remote = await listFiles(receipt.storeId, deadline, sdk)
    checkFiles(remote, receipt.files, receipt.status === 'ready')
  } catch (error) {
    if (error instanceof ProviderError && error.status === 404) storeMissing = true
    else throw error
  }
  receipt.status = 'cleanup_incomplete'
  receipt.cleanupFailures = []
  await writeReceipt(receiptDirectory, receipt)
  receipt.cleanupFailures = await cleanup(receipt, deadline, sdk, storeMissing)
  receipt.status = receipt.cleanupFailures.length ? 'cleanup_incomplete' : 'deleted'
  await writeReceipt(receiptDirectory, receipt)
  if (receipt.cleanupFailures.length) {
    throw new Error(
      `OpenAI corpus cleanup is incomplete (${receipt.cleanupFailures.length} resource failure(s)); inspect the private receipt`
    )
  }
  logger.log(`Deleted OpenAI corpus ${receipt.storeId} and ${receipt.files.length} operator-created file(s).`)
  return { command: 'delete', fileCount: receipt.files.length, storeId: receipt.storeId }
}

async function cleanup(receipt, deadline, sdk, storeMissing = false) {
  const failures = []
  const resources = receipt.files.map((file) => ({
    action: 'delete_file',
    id: file.fileId,
    run: (options) => sdk.client.files.delete(file.fileId, options)
  }))
  if (!storeMissing) {
    resources.unshift({
      action: 'delete_vector_store',
      id: receipt.storeId,
      run: (options) => sdk.client.vectorStores.delete(receipt.storeId, options)
    })
  }
  for (const resource of resources) {
    try {
      const deleted = await call(resource.action.replaceAll('_', ' '), deadline, resource.run)
      check(deleted?.deleted === true && deleted.id === resource.id, 'OpenAI did not confirm resource deletion')
    } catch (error) {
      if (error instanceof ProviderError && error.status === 404) continue
      failures.push({ action: resource.action, resourceId: resource.id, status: error.status })
    }
  }
  return failures
}

async function waitUntilReady(storeId, markerId, count, deadline, sdk) {
  while (true) {
    const store = await getStore(storeId, deadline, sdk)
    owns(store, markerId)
    validCounts(store.file_counts)
    check(store.file_counts.failed + store.file_counts.cancelled === 0, 'OpenAI corpus file processing failed')
    if (store.status === 'completed') return store
    check(store.status === 'in_progress', `OpenAI vector store entered unexpected ${String(store.status)} status`)
    check(store.file_counts.total <= count, 'OpenAI vector store contains more files than expected')
    await deadline.sleep(5_000)
  }
}

function getStore(storeId, deadline, sdk) {
  return call('vector-store retrieval', deadline, (options) => sdk.client.vectorStores.retrieve(storeId, options))
}

async function listFiles(storeId, deadline, sdk) {
  const files = []
  const cursors = new Set()
  let after
  for (let pageNumber = 0; pageNumber < OPENAI_CORPUS_MAX_FILES; pageNumber += 1) {
    const page = await call('vector-store file listing', deadline, (options) =>
      sdk.client.vectorStores.files.list(storeId, { after, limit: OPENAI_CORPUS_MAX_FILES, order: 'asc' }, options)
    )
    check(Array.isArray(page?.data), 'OpenAI returned an invalid vector-store file page')
    for (const file of page.data) {
      validFileId(file?.id)
      check(!files.some(({ id }) => id === file.id), 'OpenAI returned a duplicate vector-store file')
      files.push(file)
      check(files.length <= OPENAI_CORPUS_MAX_FILES, 'OpenAI vector store exceeds the 100-file operator cap')
    }
    if (!page.has_more) return files
    const next = page.data.at(-1)?.id
    check(next && !cursors.has(next), 'OpenAI pagination did not advance')
    cursors.add(next)
    after = next
  }
  throw new Error('OpenAI vector-store file pagination exceeded its bound')
}

async function call(action, deadline, run) {
  try {
    return await run(deadline.options())
  } catch (error) {
    if (deadline.signal.aborted) throw new Error('OpenAI corpus operation exceeded its 30-minute deadline')
    if (error instanceof ProviderError) throw error
    throw new ProviderError(action, error)
  }
}

function createClient({ apiKey, project, fetchImpl, timeoutMs }) {
  check(typeof fetchImpl === 'function', 'OpenAI corpus command requires a fetch implementation')
  const OpenAI = appRequire('openai')
  const client = new OpenAI.default({
    apiKey,
    baseURL: OPENAI_CORPUS_BASE_URL,
    fetch: fetchImpl,
    logLevel: 'off',
    maxRetries: 0,
    organization: null,
    project,
    timeout: timeoutMs
  })
  return { client, project, toFile: OpenAI.toFile }
}

function credentials(environment) {
  const apiKey = environment.OPENAI_CORPUS_OPERATOR_API_KEY
  const project = environment.OPENAI_CORPUS_PROJECT_ID
  check(typeof apiKey === 'string' && apiKey.trim(), 'OPENAI_CORPUS_OPERATOR_API_KEY is required')
  check(apiKey === apiKey.trim(), 'OPENAI_CORPUS_OPERATOR_API_KEY must not have surrounding whitespace')
  check(
    typeof project === 'string' && VISIBLE.test(project) && project.length <= 200,
    'OPENAI_CORPUS_PROJECT_ID is required'
  )
  return { apiKey, project }
}

async function loadManifest(path, deadline) {
  deadline.active()
  const manifestPath = resolve(path)
  const info = await lstat(manifestPath)
  check(info.isFile() && !info.isSymbolicLink(), 'corpus manifest must be a regular file, not a symlink')
  check(info.size <= MAX_JSON_BYTES, 'corpus manifest exceeds 1 MiB')
  check((await realpath(manifestPath)) === manifestPath, 'corpus manifest path may not traverse symlinks')
  const directory = await realpath(dirname(manifestPath))
  const source = JSON.parse(await readFile(manifestPath, 'utf8'))
  record(source, 'corpus manifest must be a JSON object')
  check(source.version === 1, 'corpus manifest version must be 1')
  check(typeof source.name === 'string' && source.name === source.name.trim(), 'corpus manifest name is invalid')
  check(
    source.name.length > 0 && source.name.length <= 128 && !CONTROL.test(source.name),
    'corpus manifest name is invalid'
  )
  check(Array.isArray(source.files) && source.files.length > 0, 'corpus manifest must contain files')
  check(source.files.length <= OPENAI_CORPUS_MAX_FILES, 'corpus manifest exceeds the 100-file cap')

  const files = []
  const filenames = new Set()
  const seen = new Set()
  let total = 0
  for (const entry of source.files) {
    record(entry, 'corpus manifest file entry must be an object')
    safePath(entry.path)
    check(
      typeof entry.sha256 === 'string' && SHA256.test(entry.sha256),
      'corpus file sha256 must be lowercase hexadecimal'
    )
    const filename = basename(entry.path)
    check(filename === filename.trim() && filename.length > 0, 'corpus filename must be nonblank and trimmed')
    check(Array.from(filename).length <= 512 && !CONTROL.test(filename), 'corpus filename is too long or invalid')
    check(!filenames.has(filename), `corpus manifest contains a duplicate filename: ${filename}`)
    filenames.add(filename)
    const candidate = resolve(directory, ...entry.path.split('/'))
    const nested = relative(directory, candidate)
    check(
      nested && nested !== '..' && !nested.startsWith(`..${sep}`) && !isAbsolute(nested),
      'corpus file path escapes its manifest directory'
    )
    const actual = await realpath(candidate)
    check(actual === candidate, `corpus file path may not traverse symlinks: ${entry.path}`)
    check(!seen.has(actual), `corpus manifest contains a duplicate file: ${entry.path}`)
    seen.add(actual)
    const fileInfo = await lstat(actual)
    check(fileInfo.isFile() && !fileInfo.isSymbolicLink(), `corpus entry is not a regular file: ${entry.path}`)
    check(fileInfo.size <= OPENAI_CORPUS_MAX_FILE_BYTES, `corpus file exceeds 50 MiB: ${entry.path}`)
    total += fileInfo.size
    check(total <= OPENAI_CORPUS_MAX_TOTAL_BYTES, 'corpus files exceed the 500 MiB total cap')
    files.push({
      filename,
      path: actual,
      relativePath: entry.path,
      sha256: entry.sha256,
      size: fileInfo.size
    })
  }
  return { files, name: source.name }
}

async function verifiedBytes(file) {
  check((await realpath(file.path)) === file.path, `corpus file changed before upload: ${file.relativePath}`)
  const handle = await open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    check(
      info.isFile() && info.size === file.size,
      `corpus file changed after manifest validation: ${file.relativePath}`
    )
    const bytes = await handle.readFile()
    check(
      createHash('sha256').update(bytes).digest('hex') === file.sha256,
      `corpus file sha256 mismatch: ${file.relativePath}`
    )
    return bytes
  } finally {
    await handle.close()
  }
}

function makeReceipt(storeId, markerId, projectId) {
  return { cleanupFailures: [], files: [], markerId, projectId, status: 'preparing', storeId, version: 1 }
}

async function writeReceipt(directory, receipt) {
  validReceipt(receipt)
  directory = await privateDirectory(directory)
  const destination = join(directory, `${receipt.storeId}.json`)
  const temporary = join(directory, `.${receipt.storeId}.${randomUUID()}.tmp`)
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, destination)
    await chmod(destination, 0o600)
  } finally {
    await rm(temporary, { force: true })
  }
}

async function readReceipt(directory, storeId) {
  validStoreId(storeId)
  directory = await privateDirectory(directory)
  const path = join(directory, `${storeId}.json`)
  const info = await lstat(path)
  check(info.isFile() && (info.mode & 0o077) === 0, 'corpus receipt is not a private regular file')
  check(info.size <= MAX_JSON_BYTES, 'corpus receipt exceeds 1 MiB')
  const receipt = JSON.parse(await readFile(path, 'utf8'))
  validReceipt(receipt)
  check(receipt.storeId === storeId, 'corpus receipt store ID does not match its filename')
  return receipt
}

async function privateDirectory(path) {
  const absolute = resolve(path)
  await mkdir(absolute, { mode: 0o700, recursive: true })
  const info = await lstat(absolute)
  check(info.isDirectory() && (await realpath(absolute)) === absolute, 'receipt directory path is unsafe')
  await chmod(absolute, 0o700)
  return absolute
}

function validReceipt(receipt) {
  record(receipt, 'corpus receipt must be a JSON object')
  check(receipt.version === 1 && STORE_ID.test(receipt.storeId), 'corpus receipt identity is invalid')
  check(
    UUID.test(receipt.markerId) && typeof receipt.projectId === 'string' && VISIBLE.test(receipt.projectId),
    'corpus receipt project marker is invalid'
  )
  check(STATUSES.has(receipt.status), 'corpus receipt status is invalid')
  check(
    Array.isArray(receipt.files) && receipt.files.length <= OPENAI_CORPUS_MAX_FILES,
    'corpus receipt files are invalid'
  )
  const ids = new Set()
  for (const file of receipt.files) {
    record(file, 'corpus receipt file is invalid')
    validFileId(file.fileId)
    safePath(file.path)
    check(SHA256.test(file.sha256) && !ids.has(file.fileId), 'corpus receipt file identity is invalid')
    ids.add(file.fileId)
  }
  check(Array.isArray(receipt.cleanupFailures), 'corpus receipt cleanup failures are invalid')
}

function owns(store, markerId) {
  check(store?.metadata?.[MARKER_KEY] === MARKER_VALUE, 'vector store is not marked as operator-managed')
  check(store.metadata?.[RECEIPT_KEY] === markerId, 'vector store marker does not match the private receipt')
}

function assertReady(store, count) {
  check(store?.status === 'completed', `OpenAI vector store is not ready (${String(store?.status)})`)
  validCounts(store.file_counts)
  const counts = store.file_counts
  check(
    counts.total === count && counts.completed === count,
    'OpenAI vector-store file total does not match the receipt'
  )
  check(counts.in_progress + counts.failed + counts.cancelled === 0, 'OpenAI vector store has incomplete files')
}

function validCounts(counts) {
  record(counts, 'OpenAI returned invalid vector-store file counts')
  for (const key of ['cancelled', 'completed', 'failed', 'in_progress', 'total']) {
    check(Number.isInteger(counts[key]) && counts[key] >= 0, `OpenAI returned invalid ${key} file count`)
  }
}

function checkFiles(remote, receipt, exact = true) {
  const known = new Set(receipt.map(({ fileId }) => fileId))
  check(
    remote.every(({ id }) => known.has(id)),
    'OpenAI vector store contains a file absent from the receipt'
  )
  if (exact) check(remote.length === receipt.length, 'OpenAI vector-store files do not exactly match the receipt')
}

function safePath(value) {
  check(typeof value === 'string' && value.length > 0, 'corpus file path is invalid')
  check(Buffer.byteLength(value) <= 1_024 && !CONTROL.test(value), 'corpus file path is invalid')
  check(!value.includes('\\') && !isAbsolute(value), 'corpus file path must use relative POSIX syntax')
  check(
    value.split('/').every((part) => part && !['.', '..'].includes(part)),
    'corpus file path may not escape'
  )
}

function record(value, error) {
  check(value && typeof value === 'object' && !Array.isArray(value), error)
}

function validStoreId(value) {
  check(typeof value === 'string' && STORE_ID.test(value), 'invalid OpenAI vector-store ID')
}

function validFileId(value) {
  check(typeof value === 'string' && FILE_ID.test(value), 'invalid OpenAI file ID')
}

function check(condition, error) {
  if (!condition) throw new Error(error)
}

function message(error) {
  return error instanceof Error ? error.message : 'unknown corpus operation failure'
}

function createDeadline(timeoutMs, sleepImpl) {
  check(
    Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= OPENAI_CORPUS_OPERATION_TIMEOUT_MS,
    'invalid corpus operation deadline'
  )
  const expires = Date.now() + timeoutMs
  const signal = AbortSignal.timeout(timeoutMs)
  const active = () => {
    if (signal.aborted || Date.now() >= expires)
      throw new Error('OpenAI corpus operation exceeded its 30-minute deadline')
  }
  return {
    active,
    options: () => {
      active()
      return { maxRetries: 0, signal, timeout: Math.max(1, expires - Date.now()) }
    },
    signal,
    sleep: async (milliseconds) => {
      active()
      await sleepImpl(Math.min(milliseconds, Math.max(1, expires - Date.now())), signal)
      active()
    }
  }
}

function sleep(milliseconds, signal) {
  return delay(milliseconds, undefined, { signal })
}

async function main() {
  try {
    await runCorpusCommand({ argv: process.argv.slice(2) })
  } catch (error) {
    console.error(`OpenAI corpus command failed: ${message(error)}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
