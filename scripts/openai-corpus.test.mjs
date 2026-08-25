import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import {
  OPENAI_CORPUS_BASE_URL,
  OPENAI_CORPUS_MAX_FILE_BYTES,
  OPENAI_CORPUS_OPERATION_TIMEOUT_MS,
  parseCorpusCommand,
  runCorpusCommand
} from './openai-corpus.mjs'

const credentials = {
  OPENAI_CORPUS_OPERATOR_API_KEY: 'operator-test-key',
  OPENAI_CORPUS_PROJECT_ID: 'proj_operator_test'
}
const execFileAsync = promisify(execFile)
const markerUuid = '4bcd1f2a-5988-4f00-9661-4d52ca0d9894'

test('basic-release CLI exits before reading credentials or contacting OpenAI', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, ['scripts/openai-corpus.mjs', 'verify', 'vs_unavailable'], {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH,
        OPENAI_CORPUS_OPERATOR_API_KEY: 'must-not-be-read',
        OPENAI_CORPUS_PROJECT_ID: 'must-not-be-read'
      }
    }),
    (error) => {
      assert.equal(error.code, 1)
      assert.match(error.stderr, /OpenAI corpus command failed: Not Found/)
      assert.doesNotMatch(error.stderr, /must-not-be-read/)
      return true
    }
  )
})

test('CLI grammar is closed before credentials or fetch can be used', async () => {
  assert.deepEqual(parseCorpusCommand(['verify', 'vs_abc']), { command: 'verify', storeId: 'vs_abc' })
  assert.deepEqual(parseCorpusCommand(['delete', 'vs_abc', '--confirm', 'vs_abc']), {
    command: 'delete',
    storeId: 'vs_abc'
  })
  for (const argv of [
    [],
    ['list'],
    ['prepare'],
    ['verify', 'unsafe/id'],
    ['delete', 'vs_one'],
    ['delete', 'vs_one', '--confirm', 'vs_two'],
    ['delete', 'vs_one', '--yes', 'vs_one']
  ]) {
    assert.throws(() => parseCorpusCommand(argv))
  }

  let environmentReads = 0
  let fetchCalls = 0
  await assert.rejects(
    runCorpusCommand({
      argv: ['--help'],
      environment: new Proxy(
        {},
        {
          get() {
            environmentReads += 1
          }
        }
      ),
      fetchImpl: () => {
        fetchCalls += 1
      }
    })
  )
  assert.equal(environmentReads, 0)
  assert.equal(fetchCalls, 0)
})

test('prepare uses the pinned SDK against only the official origin and writes a private ready receipt', async (t) => {
  const fixture = await createManifestFixture(t, {
    'corpus/intro.txt': 'public corpus introduction',
    'corpus/nested/reference.md': '# Reference\n'
  })
  const provider = createOpenAIFake({ inProgressRetrievals: 1 })
  const logs = []

  const result = await runFixtureCommand(fixture, provider, ['prepare', fixture.manifestPath], {
    logger: { log: (message) => logs.push(message) }
  })

  assert.deepEqual(result, { command: 'prepare', fileCount: 2, storeId: provider.storeId })
  const receiptPath = join(fixture.receiptDirectory, `${provider.storeId}.json`)
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
  const receiptInfo = await lstat(receiptPath)
  const directoryInfo = await lstat(fixture.receiptDirectory)
  assert.equal(receipt.status, 'ready')
  assert.equal(receipt.projectId, credentials.OPENAI_CORPUS_PROJECT_ID)
  assert.equal(receipt.markerId, markerUuid)
  assert.deepEqual(
    receipt.files.map(({ path, sha256 }) => ({ path, sha256 })),
    [
      { path: 'corpus/intro.txt', sha256: digest('public corpus introduction') },
      { path: 'corpus/nested/reference.md', sha256: digest('# Reference\n') }
    ]
  )
  assert.equal(receiptInfo.mode & 0o777, 0o600)
  assert.equal(directoryInfo.mode & 0o777, 0o700)
  assert.equal(JSON.stringify(receipt).includes('operator-test-key'), false)
  assert.equal(logs.join('\n').includes('operator-test-key'), false)
  assert.equal(logs.join('\n').includes('public corpus introduction'), false)

  assert.equal(
    provider.requests.some(({ method, path }) => method === 'GET' && path === '/v1/vector_stores'),
    false
  )
  assert.equal(
    provider.requests.some(({ method, path }) => method === 'GET' && path === '/v1/files'),
    false
  )
  for (const request of provider.requests) {
    assert.equal(request.origin, OPENAI_CORPUS_BASE_URL.replace('/v1', ''), `${request.method} ${request.path}`)
    assert.equal(request.headers.get('authorization'), 'Bearer operator-test-key')
    assert.equal(request.headers.get('openai-project'), credentials.OPENAI_CORPUS_PROJECT_ID)
    assert.equal(request.headers.get('x-stainless-retry-count'), '0')
  }
  const createRequest = provider.requests.find(({ method, path }) => method === 'POST' && path === '/v1/vector_stores')
  assert.deepEqual(createRequest.json.metadata, {
    wcu_managed_by: 'wcu-file-search-corpus-v1',
    wcu_receipt_id: markerUuid
  })
})

test('manifest path, filename, link, duplicate, count, and byte caps fail before credentials or provider access', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'swl-openai-corpus-invalid-'))
  t.after(() => rm(root, { force: true, recursive: true }))
  const outside = join(root, 'outside.txt')
  await writeFile(outside, 'outside')

  const cases = []
  cases.push(await manifestCase(root, 'escape', ['../outside.txt']))
  cases.push(await manifestCase(root, 'control', ['bad\nname.txt']))

  const duplicateDirectory = join(root, 'duplicate')
  await mkdir(duplicateDirectory)
  await writeFile(join(duplicateDirectory, 'same.txt'), 'same')
  cases.push(await writeManifest(duplicateDirectory, ['same.txt', 'same.txt']))

  const duplicateNameDirectory = join(root, 'duplicate-name')
  await mkdir(join(duplicateNameDirectory, 'a'), { recursive: true })
  await mkdir(join(duplicateNameDirectory, 'b'), { recursive: true })
  await writeFile(join(duplicateNameDirectory, 'a', 'shared.txt'), 'first')
  await writeFile(join(duplicateNameDirectory, 'b', 'shared.txt'), 'second')
  cases.push(await writeManifest(duplicateNameDirectory, ['a/shared.txt', 'b/shared.txt']))
  cases.push(await manifestCase(root, 'blank-name', [' ']))
  cases.push(await manifestCase(root, 'untrimmed-name', [' padded.txt']))
  cases.push(await manifestCase(root, 'long-name', [`${'a'.repeat(513)}.txt`]))

  const symlinkDirectory = join(root, 'symlink')
  await mkdir(symlinkDirectory)
  await writeFile(join(symlinkDirectory, 'target.txt'), 'target')
  await symlink('target.txt', join(symlinkDirectory, 'link.txt'))
  cases.push(await writeManifest(symlinkDirectory, ['link.txt']))

  const countDirectory = join(root, 'count')
  await mkdir(countDirectory)
  cases.push(
    await writeManifest(
      countDirectory,
      Array.from({ length: 101 }, (_, index) => `f-${index}.txt`)
    )
  )

  const largeDirectory = join(root, 'large')
  await mkdir(largeDirectory)
  const largePath = join(largeDirectory, 'large.txt')
  await writeFile(largePath, '')
  await truncate(largePath, OPENAI_CORPUS_MAX_FILE_BYTES + 1)
  cases.push(await writeManifest(largeDirectory, ['large.txt']))

  const totalDirectory = join(root, 'total')
  await mkdir(totalDirectory)
  const totalEntries = []
  for (let index = 0; index < 11; index += 1) {
    const name = `part-${index}.txt`
    await writeFile(join(totalDirectory, name), '')
    await truncate(join(totalDirectory, name), OPENAI_CORPUS_MAX_FILE_BYTES)
    totalEntries.push(name)
  }
  cases.push(await writeManifest(totalDirectory, totalEntries))

  for (const manifestPath of cases) {
    let environmentRead = false
    let providerCalled = false
    await assert.rejects(
      runCorpusCommand({
        argv: ['prepare', manifestPath],
        environment: new Proxy(
          {},
          {
            get() {
              environmentRead = true
              throw new Error('credentials were read')
            }
          }
        ),
        fetchImpl: () => {
          providerCalled = true
          throw new Error('provider was called')
        },
        receiptDirectory: join(root, 'receipts')
      })
    )
    assert.equal(environmentRead, false, manifestPath)
    assert.equal(providerCalled, false, manifestPath)
  }
})

test('missing operator credentials fail closed without using generic OpenAI credentials or fetch', async (t) => {
  const fixture = await createManifestFixture(t, { 'one.txt': 'one' })
  let fetchCalled = false

  await assert.rejects(
    runCorpusCommand({
      argv: ['prepare', fixture.manifestPath],
      environment: {
        OPENAI_API_KEY: 'must-not-be-used',
        OPENAI_PROJECT_ID: 'must-not-be-used'
      },
      fetchImpl: () => {
        fetchCalled = true
        throw new Error('unexpected fetch')
      },
      receiptDirectory: fixture.receiptDirectory
    }),
    /OPENAI_CORPUS_OPERATOR_API_KEY is required/
  )
  assert.equal(fetchCalled, false)
})

test('prepare hashes the exact upload bytes and compensates before uploading a mismatch', async (t) => {
  const fixture = await createManifestFixture(t, { 'one.txt': 'expected bytes' })
  const manifest = JSON.parse(await readFile(fixture.manifestPath, 'utf8'))
  manifest.files[0].sha256 = '0'.repeat(64)
  await writeFile(fixture.manifestPath, `${JSON.stringify(manifest)}\n`)
  const provider = createOpenAIFake()

  await assert.rejects(
    runFixtureCommand(fixture, provider, ['prepare', fixture.manifestPath]),
    /corpus file sha256 mismatch/
  )
  assert.deepEqual(
    provider.requests.map(({ method, path }) => [method, path]),
    [
      ['POST', '/v1/vector_stores'],
      ['DELETE', `/v1/vector_stores/${provider.storeId}`]
    ]
  )
  const receipt = await readFixtureReceipt(fixture, provider.storeId)
  assert.equal(receipt.status, 'compensated')
  assert.deepEqual(receipt.files, [])
})

test('verify follows explicit bounded cursor pages and rejects unreceipted files', async (t) => {
  const fixture = await createManifestFixture(t, { 'one.txt': 'one', 'two.txt': 'two' })
  const provider = createOpenAIFake({ listPageSize: 1 })
  await runFixtureCommand(fixture, provider, ['prepare', fixture.manifestPath])

  const result = await runFixtureCommand(fixture, provider, ['verify', provider.storeId])
  assert.deepEqual(result, { command: 'verify', fileCount: 2, storeId: provider.storeId })
  const listRequests = provider.requests.filter(
    ({ method, path }) => method === 'GET' && path === `/v1/vector_stores/${provider.storeId}/files`
  )
  assert.equal(listRequests.length, 2)
  assert.equal(listRequests[0].searchParams.get('limit'), '100')
  assert.equal(listRequests[0].searchParams.has('after'), false)
  assert.equal(listRequests[1].searchParams.get('after'), provider.fileIds[0])

  provider.attachedFileIds.push('file-unreceipted')
  await assert.rejects(
    runFixtureCommand(fixture, provider, ['verify', provider.storeId]),
    /exceeds the 100-file operator cap|absent from the receipt|exactly match|file total does not match/
  )
})

test('delete requires exact confirmation, refuses unknown resources, and removes only receipted objects', async (t) => {
  const fixture = await createManifestFixture(t, { 'one.txt': 'one', 'two.txt': 'two' })
  const provider = createOpenAIFake()
  await runFixtureCommand(fixture, provider, ['prepare', fixture.manifestPath])

  await assert.rejects(
    runFixtureCommand(fixture, provider, ['delete', provider.storeId, '--confirm', 'vs_other']),
    /must exactly match/
  )
  assert.equal(
    provider.requests.some(({ method }) => method === 'DELETE'),
    false
  )

  provider.attachedFileIds.push('file-unreceipted')
  await assert.rejects(
    runFixtureCommand(fixture, provider, ['delete', provider.storeId, '--confirm', provider.storeId]),
    /absent from the receipt/
  )
  assert.equal(
    provider.requests.some(({ method }) => method === 'DELETE'),
    false
  )
  provider.attachedFileIds.pop()

  const result = await runFixtureCommand(fixture, provider, ['delete', provider.storeId, '--confirm', provider.storeId])
  assert.deepEqual(result, { command: 'delete', fileCount: 2, storeId: provider.storeId })
  const deletes = provider.requests.filter(({ method }) => method === 'DELETE').map(({ path }) => path)
  assert.deepEqual(deletes, [
    `/v1/vector_stores/${provider.storeId}`,
    `/v1/files/${provider.fileIds[0]}`,
    `/v1/files/${provider.fileIds[1]}`
  ])
  const receipt = await readFixtureReceipt(fixture, provider.storeId)
  assert.equal(receipt.status, 'deleted')
  assert.deepEqual(receipt.cleanupFailures, [])
})

test('prepare compensates known resources once and never exposes a provider envelope', async (t) => {
  const fixture = await createManifestFixture(t, { 'one.txt': 'operator corpus content' })
  const provider = createOpenAIFake({ failAttachmentAt: 1 })

  await assert.rejects(runFixtureCommand(fixture, provider, ['prepare', fixture.manifestPath]), (error) => {
    assert.match(error.message, /OpenAI file attachment 1 failed \(status 500\)/)
    assert.equal(error.message.includes('sensitive provider response'), false)
    assert.equal(error.message.includes('operator corpus content'), false)
    return true
  })
  const deletes = provider.requests.filter(({ method }) => method === 'DELETE').map(({ path }) => path)
  assert.deepEqual(deletes, [`/v1/vector_stores/${provider.storeId}`, `/v1/files/${provider.fileIds[0]}`])
  const receipt = await readFixtureReceipt(fixture, provider.storeId)
  assert.equal(receipt.status, 'compensated')
  assert.deepEqual(receipt.cleanupFailures, [])
})

test('prepare never deletes a vector store whose returned ownership marker cannot be verified', async (t) => {
  const fixture = await createManifestFixture(t, { 'one.txt': 'operator corpus content' })
  const provider = createOpenAIFake({ returnUnownedStore: true })

  await assert.rejects(
    runFixtureCommand(fixture, provider, ['prepare', fixture.manifestPath]),
    /vector store is not marked as operator-managed/
  )
  assert.deepEqual(
    provider.requests.map(({ method, path }) => [method, path]),
    [['POST', '/v1/vector_stores']]
  )
})

test('delete continues after a file cleanup failure and records only normalized evidence', async (t) => {
  const fixture = await createManifestFixture(t, { 'one.txt': 'one', 'two.txt': 'two' })
  const provider = createOpenAIFake()
  await runFixtureCommand(fixture, provider, ['prepare', fixture.manifestPath])
  provider.failDeleteFileIds.add(provider.fileIds[0])

  await assert.rejects(
    runFixtureCommand(fixture, provider, ['delete', provider.storeId, '--confirm', provider.storeId]),
    /cleanup is incomplete \(1 resource failure\(s\)\)/
  )
  const deletes = provider.requests.filter(({ method }) => method === 'DELETE').map(({ path }) => path)
  assert.deepEqual(deletes, [
    `/v1/vector_stores/${provider.storeId}`,
    `/v1/files/${provider.fileIds[0]}`,
    `/v1/files/${provider.fileIds[1]}`
  ])
  const receipt = await readFixtureReceipt(fixture, provider.storeId)
  assert.equal(receipt.status, 'cleanup_incomplete')
  assert.deepEqual(receipt.cleanupFailures, [
    {
      action: 'delete_file',
      resourceId: provider.fileIds[0],
      status: 500
    }
  ])
  assert.equal(JSON.stringify(receipt).includes('sensitive provider response'), false)
})

test('the operation deadline is capped at thirty minutes', async () => {
  await assert.rejects(
    runCorpusCommand({ argv: ['verify', 'vs_test'], timeoutMs: OPENAI_CORPUS_OPERATION_TIMEOUT_MS + 1 }),
    /invalid corpus operation deadline/
  )
})

async function createManifestFixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'swl-openai-corpus-'))
  t.after(() => rm(root, { force: true, recursive: true }))
  const manifestDirectory = join(root, 'manifest')
  await mkdir(manifestDirectory)
  for (const [path, contents] of Object.entries(files)) {
    const destination = join(manifestDirectory, ...path.split('/'))
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, contents)
  }
  return {
    manifestPath: await writeManifest(manifestDirectory, Object.keys(files), true),
    receiptDirectory: join(root, 'private-receipts'),
    root
  }
}

async function manifestCase(root, name, files) {
  const directory = join(root, name)
  await mkdir(directory)
  return writeManifest(directory, files)
}

async function writeManifest(directory, files, calculateHashes = false) {
  const path = join(directory, 'corpus.json')
  const entries = []
  for (const file of files) {
    let sha256 = '0'.repeat(64)
    if (calculateHashes) sha256 = digest(await readFile(join(directory, ...file.split('/'))))
    entries.push({ path: file, sha256 })
  }
  await writeFile(path, `${JSON.stringify({ files: entries, name: 'Test corpus', version: 1 })}\n`)
  return path
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function runFixtureCommand(fixture, provider, argv, overrides = {}) {
  return runCorpusCommand({
    argv,
    environment: credentials,
    fetchImpl: provider.fetch,
    logger: { log() {} },
    receiptDirectory: fixture.receiptDirectory,
    sleepImpl: async () => undefined,
    uuid: () => markerUuid,
    ...overrides
  })
}

async function readFixtureReceipt(fixture, storeId) {
  return JSON.parse(await readFile(join(fixture.receiptDirectory, `${storeId}.json`), 'utf8'))
}

function createOpenAIFake({ failAttachmentAt, inProgressRetrievals = 0, listPageSize = 100, returnUnownedStore } = {}) {
  const storeId = 'vs_operator_test'
  const requests = []
  const fileIds = []
  const attachedFileIds = []
  const failDeleteFileIds = new Set()
  let storeExists = false
  let storeMetadata
  let attachmentAttempts = 0
  let retrievalsRemaining = inProgressRetrievals

  const fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (url.protocol === 'data:') return new Response('')
    const method = init.method ?? input?.method ?? 'GET'
    const headers = new Headers(init.headers ?? input?.headers)
    const request = {
      headers,
      json: await optionalJsonBody(init.body),
      method,
      origin: url.origin,
      path: url.pathname,
      searchParams: url.searchParams
    }
    requests.push(request)
    assert.equal(url.origin, 'https://api.openai.com')
    assert.equal(url.pathname.startsWith('/v1/'), true)

    if (method === 'POST' && url.pathname === '/v1/vector_stores') {
      storeExists = true
      storeMetadata = request.json.metadata
      return jsonResponse(
        returnUnownedStore
          ? { ...vectorStore('completed'), metadata: { wcu_managed_by: 'someone-else' } }
          : vectorStore('completed')
      )
    }
    if (method === 'POST' && url.pathname === '/v1/files') {
      const id = `file-operator-${fileIds.length + 1}`
      fileIds.push(id)
      return jsonResponse({
        bytes: 1,
        created_at: 1,
        filename: `file-${fileIds.length}.txt`,
        id,
        object: 'file',
        purpose: 'assistants',
        status: 'processed'
      })
    }
    if (method === 'POST' && url.pathname === `/v1/vector_stores/${storeId}/files`) {
      attachmentAttempts += 1
      if (attachmentAttempts === failAttachmentAt) return providerError(500)
      attachedFileIds.push(request.json.file_id)
      return jsonResponse(vectorStoreFile(request.json.file_id, 'in_progress'))
    }
    if (method === 'GET' && url.pathname === `/v1/vector_stores/${storeId}`) {
      if (!storeExists) return providerError(404)
      const status = retrievalsRemaining > 0 ? 'in_progress' : 'completed'
      retrievalsRemaining = Math.max(0, retrievalsRemaining - 1)
      return jsonResponse(vectorStore(status))
    }
    if (method === 'GET' && url.pathname === `/v1/vector_stores/${storeId}/files`) {
      const after = url.searchParams.get('after')
      const start = after ? attachedFileIds.indexOf(after) + 1 : 0
      const ids = attachedFileIds.slice(start, start + listPageSize)
      return jsonResponse({
        data: ids.map((id) => vectorStoreFile(id, 'completed')),
        first_id: ids[0] ?? null,
        has_more: start + ids.length < attachedFileIds.length,
        last_id: ids.at(-1) ?? null,
        object: 'list'
      })
    }
    if (method === 'DELETE' && url.pathname === `/v1/vector_stores/${storeId}`) {
      if (!storeExists) return providerError(404)
      storeExists = false
      return jsonResponse({ deleted: true, id: storeId, object: 'vector_store.deleted' })
    }
    if (method === 'DELETE' && url.pathname.startsWith('/v1/files/')) {
      const id = decodeURIComponent(url.pathname.slice('/v1/files/'.length))
      if (failDeleteFileIds.has(id)) return providerError(500)
      return jsonResponse({ deleted: true, id, object: 'file' })
    }
    return providerError(404)
  }

  function vectorStore(status) {
    const completed = status === 'completed' ? attachedFileIds.length : 0
    return {
      created_at: 1,
      file_counts: {
        cancelled: 0,
        completed,
        failed: 0,
        in_progress: attachedFileIds.length - completed,
        total: attachedFileIds.length
      },
      id: storeId,
      last_active_at: 1,
      metadata: storeMetadata,
      name: 'Test corpus',
      object: 'vector_store',
      status,
      usage_bytes: 1
    }
  }

  return {
    attachedFileIds,
    failDeleteFileIds,
    fetch,
    fileIds,
    requests,
    storeId
  }
}

function vectorStoreFile(id, status) {
  return {
    created_at: 1,
    id,
    last_error: null,
    object: 'vector_store.file',
    status,
    usage_bytes: 1,
    vector_store_id: 'vs_operator_test'
  }
}

async function optionalJsonBody(body) {
  if (typeof body === 'string') return JSON.parse(body)
  if (body instanceof Uint8Array) return JSON.parse(Buffer.from(body).toString('utf8'))
  return undefined
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', 'x-request-id': 'req_test' },
    status
  })
}

function providerError(status) {
  return jsonResponse(
    {
      error: {
        code: 'provider_test_error',
        message: 'sensitive provider response',
        type: 'server_error'
      }
    },
    status
  )
}
