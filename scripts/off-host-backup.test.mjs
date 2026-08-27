import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { promisify } from 'node:util'
import {
  OFF_HOST_BACKUP_MAX_BYTES,
  OffHostBackupError,
  R2BackupStore,
  fetchVerifiedSnapshot,
  formatOffHostBackupSuccess,
  readBackupConfiguration,
  runOffHostBackupCli,
  uploadVerifiedSnapshot,
  verifyLatestReceipt
} from '../server/off-host-backup.mjs'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const Database = require('../node_modules/better-sqlite3')
const maintenanceEntry = resolve('server/maintenance.mjs')
const accountId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const fixedNow = new Date('2026-07-16T12:34:56.789Z')
const fixedSnapshotName = 'sqlite-offhost-2026-07-16T12-34-56-789Z-a1b2c3d4e5f6.db'

test('backup configuration is explicit, private, and restricted to Cloudflare account endpoints', () => {
  assert.throws(() => readBackupConfiguration({}), /BACKUP_R2_ACCOUNT_ID is required/)
  const configuration = readBackupConfiguration(backupEnvironment('/tmp/app.db'))
  assert.equal(configuration.bucket, 'private-database-backups')
  assert.equal(
    readBackupConfiguration({
      ...backupEnvironment('/tmp/app.db'),
      BACKUP_R2_ENDPOINT: `https://${accountId}.us.r2.cloudflarestorage.com`
    }).endpoint,
    `https://${accountId}.us.r2.cloudflarestorage.com`
  )

  for (const endpoint of [
    `http://${accountId}.r2.cloudflarestorage.com`,
    `http://${accountId}.us.r2.cloudflarestorage.com`,
    `https://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.r2.cloudflarestorage.com`,
    'https://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.us.r2.cloudflarestorage.com',
    `https://${accountId}.r2.cloudflarestorage.com/public`,
    `https://${accountId}.us.r2.cloudflarestorage.com/public`,
    'https://example.com'
  ]) {
    assert.throws(
      () => readBackupConfiguration({ ...backupEnvironment('/tmp/app.db'), BACKUP_R2_ENDPOINT: endpoint }),
      /BACKUP_R2_ENDPOINT must be a private Cloudflare HTTPS account endpoint/
    )
  }

  assert.equal(OFF_HOST_BACKUP_MAX_BYTES, 5 * 1024 * 1024 * 1024 - 5 * 1024 * 1024)
})

test('configuration fails before local mutation and remote freshness is independent of database state', async (t) => {
  const sandbox = disposableDirectory(t)
  const absentDataDirectory = join(sandbox, 'absent-data')
  const invalidEnvironment = {
    ...backupEnvironment(join(absentDataDirectory, 'app.db')),
    BACKUP_R2_ENDPOINT: 'https://example.com'
  }
  await assert.rejects(runOffHostBackupCli(['validate-config'], {}), /BACKUP_R2_ACCOUNT_ID is required/)
  await assert.rejects(
    runOffHostBackupCli(['validate-config'], invalidEnvironment),
    /private Cloudflare HTTPS account endpoint/
  )
  await assert.rejects(
    runOffHostBackupCli(['backup'], invalidEnvironment, { store: new MemoryStore() }),
    /private Cloudflare HTTPS account endpoint/
  )
  assert(!existsSync(absentDataDirectory))

  const validation = await runOffHostBackupCli(
    ['validate-config'],
    backupEnvironment(join(absentDataDirectory, 'app.db'))
  )
  assert.deepEqual(validation, { command: 'validate-config' })
  assert.equal(formatOffHostBackupSuccess(validation), 'Off-host backup configuration passed.')
  assert(!existsSync(absentDataDirectory))

  const store = new MemoryStore()
  const bytes = Buffer.from('fresh receipt')
  const sha256 = digest(bytes, 'sha256', 'hex')
  const key = objectKey(sha256)
  store.objects.set(key, {
    bytes,
    metadata: { byteSize: bytes.byteLength, sha256, format: 'sqlite-online-backup-v1' }
  })
  const { NUXT_DATABASE_URL: ignored, ...providerOnlyEnvironment } = backupEnvironment('/not/available/app.db')
  assert.equal(ignored, 'file:/not/available/app.db')
  const receipt = await runOffHostBackupCli(['verify-latest', '--max-age-hours', '12'], providerOnlyEnvironment, {
    store,
    now: () => fixedNow
  })
  assert.equal(receipt.key, key)
  const output = formatOffHostBackupSuccess(receipt)
  assert.match(output, /Off-host backup freshness passed/)
  assert(output.includes(key))
  assert(output.includes(sha256))
})

test('the pinned SDK sends one conditional Content-MD5 write and reads bytes without hidden retry', async (t) => {
  const sandbox = disposableDirectory(t)
  const bytes = Buffer.from('verified sqlite snapshot')
  const path = join(sandbox, fixedSnapshotName)
  writeFileSync(path, bytes, { mode: 0o600 })
  const sha256 = digest(bytes, 'sha256', 'hex')
  const key = objectKey(sha256)
  const transport = fakeTransport([{ statusCode: 200 }])
  const store = new R2BackupStore(readBackupConfiguration(backupEnvironment('/tmp/app.db')), {
    requestHandler: transport.handler
  })
  t.after(() => store.destroy())

  await store.put(
    key,
    {
      path,
      byteSize: bytes.byteLength,
      md5Base64: digest(bytes, 'md5', 'base64'),
      sha256
    },
    undefined
  )
  assert.equal(transport.requests.length, 1)
  assert.equal(transport.requests[0].method, 'PUT')
  assert.equal(transport.requests[0].headers['if-none-match'], '*')
  assert.equal(transport.requests[0].headers['content-length'], String(bytes.byteLength))
  assert.equal(transport.requests[0].headers['content-md5'], digest(bytes, 'md5', 'base64'))
  assert.equal(transport.requests[0].headers['x-amz-meta-swl-sha256'], sha256)
  assert.deepEqual(transport.requests[0].body, bytes)

  const rejectedTransport = fakeTransport([], { reject: new Error('provider unavailable') })
  const rejectedStore = new R2BackupStore(readBackupConfiguration(backupEnvironment('/tmp/app.db')), {
    requestHandler: rejectedTransport.handler
  })
  t.after(() => rejectedStore.destroy())
  await assert.rejects(
    rejectedStore.put(
      key,
      {
        path,
        byteSize: bytes.byteLength,
        md5Base64: digest(bytes, 'md5', 'base64'),
        sha256
      },
      undefined
    ),
    /could not write the immutable backup object/
  )
  assert.equal(rejectedTransport.requests.length, 1)
})

test('the R2 adapter parses HEAD, GET, and paginated-list evidence and normalizes timeouts', async (t) => {
  const bytes = Buffer.from('remote backup bytes')
  const sha256 = digest(bytes, 'sha256', 'hex')
  const key = objectKey(sha256)
  const listXml = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>private-database-backups</Name><Prefix>sqlite/v1/2026/07/16/</Prefix><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated><Contents><Key>${key}</Key><LastModified>2026-07-16T12:34:56.789Z</LastModified><ETag>&quot;ignored&quot;</ETag><Size>${bytes.byteLength}</Size><StorageClass>STANDARD</StorageClass></Contents></ListBucketResult>`
  )
  const transport = fakeTransport([
    {
      statusCode: 200,
      headers: {
        'content-length': String(bytes.byteLength),
        'x-amz-meta-swl-sha256': sha256,
        'x-amz-meta-swl-format': 'sqlite-online-backup-v1'
      }
    },
    {
      statusCode: 200,
      headers: {
        'content-length': String(bytes.byteLength),
        'x-amz-meta-swl-sha256': sha256,
        'x-amz-meta-swl-format': 'sqlite-online-backup-v1'
      },
      body: bytes
    },
    {
      statusCode: 200,
      headers: { 'content-type': 'application/xml', 'content-length': String(listXml.byteLength) },
      body: listXml
    }
  ])
  const store = new R2BackupStore(readBackupConfiguration(backupEnvironment('/tmp/app.db')), {
    requestHandler: transport.handler
  })
  t.after(() => store.destroy())

  assert.deepEqual(await store.head(key), {
    byteSize: bytes.byteLength,
    sha256,
    format: 'sqlite-online-backup-v1'
  })
  assert.deepEqual(await store.readAndHash(key), {
    byteSize: bytes.byteLength,
    responseByteSize: bytes.byteLength,
    sha256,
    metadata: { byteSize: bytes.byteLength, sha256, format: 'sqlite-online-backup-v1' }
  })
  assert.deepEqual(await store.listDatePrefix('sqlite/v1/2026/07/16/'), [{ key, createdAt: fixedNow, sha256 }])
  assert.deepEqual(
    transport.requests.map((request) => request.method),
    ['HEAD', 'GET', 'GET']
  )

  const timeoutStore = new R2BackupStore(readBackupConfiguration(backupEnvironment('/tmp/app.db')), {
    requestHandler: abortingTransport(),
    requestTimeoutMs: 5
  })
  t.after(() => timeoutStore.destroy())
  await assert.rejects(timeoutStore.head(key), (error) => {
    assert.equal(error.message, 'The R2 provider could not read backup metadata.')
    assert(!error.message.includes('local-fake-secret-key'))
    assert(!error.message.includes(key))
    return true
  })
})

test('upload reconciles an uncertain write only by fully hashing the immutable remote bytes', async (t) => {
  const sandbox = disposableDirectory(t)
  const bytes = Buffer.from('consistent snapshot bytes')
  const path = join(sandbox, fixedSnapshotName)
  writeFileSync(path, bytes, { mode: 0o600 })

  const store = new MemoryStore({ ambiguousPut: true })
  const receipt = await uploadVerifiedSnapshot({ path, store })
  assert.equal(receipt.byteSize, bytes.byteLength)
  assert.equal(receipt.sha256, digest(bytes, 'sha256', 'hex'))
  assert.equal(store.putCalls, 1)
  assert.equal(store.readCalls, 1)
  assert.deepEqual(store.objects.get(receipt.key)?.bytes, bytes)

  const retry = await uploadVerifiedSnapshot({ path, store })
  assert.equal(retry.key, receipt.key)
  assert.equal(retry.reused, true)
  assert.equal(store.putCalls, 1)
  assert.equal(store.readCalls, 2)

  store.objects.get(receipt.key).bytes = Buffer.from('tampered snapshot bytes')
  await assert.rejects(uploadVerifiedSnapshot({ path, store }), /downloaded R2 backup bytes do not match/)
})

test('a missing or mismatched object never becomes a successful receipt', async (t) => {
  const sandbox = disposableDirectory(t)
  const path = join(sandbox, fixedSnapshotName)
  writeFileSync(path, 'snapshot')

  await assert.rejects(
    uploadVerifiedSnapshot({ path, store: new MemoryStore({ failPut: true }) }),
    /immutable R2 backup object is missing/
  )

  const conflicting = new MemoryStore()
  const sha256 = digest(Buffer.from('snapshot'), 'sha256', 'hex')
  conflicting.objects.set(objectKey(sha256), {
    bytes: Buffer.from('other'),
    metadata: { byteSize: 5, sha256, format: 'sqlite-online-backup-v1' }
  })
  await assert.rejects(uploadVerifiedSnapshot({ path, store: conflicting }), /unexpected byte size/)
})

test('the operator creates, exactly verifies, uploads, reads back, and removes its local routine snapshot', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  await migrate(databasePath)
  writeSetting(databasePath, 'recovery-sentinel', 'off-host')
  const store = new MemoryStore()

  const receipt = await runOffHostBackupCli(['backup'], backupEnvironment(databasePath), {
    store,
    now: () => fixedNow,
    maintenanceEntry
  })
  assert.equal(receipt.command, 'backup')
  assert.equal(store.objects.size, 1)
  assert(!readdirSync(join(sandbox, 'backups')).some((name) => name.startsWith('sqlite-offhost-')))
  assert(!existsSync(join(sandbox, 'backups', '.off-host-backup.lock')))

  const fetched = await runOffHostBackupCli(['fetch', '--key', receipt.key], backupEnvironment(databasePath), {
    store,
    maintenanceEntry
  })
  assert.equal(readSetting(fetched.path, 'recovery-sentinel'), 'off-host')
  assert.equal(readFileSync(fetched.path).byteLength, receipt.byteSize)

  await assert.rejects(
    runOffHostBackupCli(['fetch', '--key', receipt.key], backupEnvironment(databasePath), {
      store,
      maintenanceEntry
    }),
    /already exists; refusing to overwrite/
  )
})

test('maintenance receives no R2 credentials and interrupted backup debris is removed', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  await migrate(databasePath)
  const credentialFixture = join(sandbox, 'credential-maintenance.mjs')
  writeFileSync(
    credentialFixture,
    `import { copyFile } from 'node:fs/promises'
const forbidden = Object.keys(process.env).filter((name) => name.startsWith('BACKUP_R2_'))
if (forbidden.length) throw new Error('backup credentials reached maintenance')
const output = process.argv[process.argv.indexOf('--output') + 1]
await copyFile(process.env.NUXT_DATABASE_URL.slice(5), output)
`
  )
  const credentialReceipt = await runOffHostBackupCli(['backup'], backupEnvironment(databasePath), {
    store: new MemoryStore(),
    now: () => fixedNow,
    maintenanceEntry: credentialFixture,
    verifyBackup: async () => {}
  })
  assert.equal(credentialReceipt.command, 'backup')

  const marker = join(sandbox, 'maintenance-started')
  const interruptionFixture = join(sandbox, 'interrupted-maintenance.mjs')
  writeFileSync(
    interruptionFixture,
    `import { writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
const output = process.argv[process.argv.indexOf('--output') + 1]
writeFileSync(join(dirname(output), \`.\${basename(output)}.write-\${process.pid}-aaaaaaaaaaaa.tmp\`), 'partial')
writeFileSync(${JSON.stringify(marker)}, 'started')
setInterval(() => {}, 1000)
`
  )
  const controller = new AbortController()
  const pending = runOffHostBackupCli(['backup'], backupEnvironment(databasePath), {
    store: new MemoryStore(),
    now: () => fixedNow,
    maintenanceEntry: interruptionFixture,
    signal: controller.signal
  })
  await waitForPath(marker)
  controller.abort(new Error('test interruption'))
  await assert.rejects(pending, /maintenance process was interrupted/)
  assert(!readdirSync(join(sandbox, 'backups')).some((name) => name.includes('.write-')))
  assert(!existsSync(join(sandbox, 'backups', '.off-host-backup.lock')))
})

test('cleanup failure rejects success and does not replace the primary operation error', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  await migrate(databasePath)
  await assert.rejects(
    runOffHostBackupCli(['backup'], backupEnvironment(databasePath), {
      store: new MemoryStore(),
      now: () => fixedNow,
      maintenanceEntry,
      removePath: async () => {
        throw new Error('injected lock cleanup failure')
      }
    }),
    (error) => {
      assert.match(error.message, /private off-host backup lock could not be removed/)
      assert.equal(error.cleanupRequired, true)
      return true
    }
  )

  const backupsDirectory = join(sandbox, 'fetch-cleanup')
  mkdirSync(backupsDirectory)
  const bytes = Buffer.from('downloaded bytes')
  const sha256 = digest(bytes, 'sha256', 'hex')
  const key = objectKey(sha256)
  const store = new MemoryStore()
  store.objects.set(key, {
    bytes,
    metadata: { byteSize: bytes.byteLength, sha256, format: 'sqlite-online-backup-v1' }
  })
  const primary = new OffHostBackupError('injected database verification failure')
  await assert.rejects(
    fetchVerifiedSnapshot({
      key,
      paths: { databasePath, dataDirectory: sandbox, backupsDirectory },
      store,
      backupBucket: 'private-database-backups',
      verifyBackup: async () => {
        throw primary
      },
      removePath: async () => {
        throw new Error('injected stage cleanup failure')
      }
    }),
    (error) => {
      assert.equal(error, primary)
      assert.equal(error.cleanupRequired, true)
      return true
    }
  )
})

test('a snapshot changed after database verification is retained and never published', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  await migrate(databasePath)
  const backupsDirectory = join(sandbox, 'backups')
  mkdirSync(backupsDirectory)
  const snapshotPath = join(backupsDirectory, fixedSnapshotName)
  await execFileAsync(process.execPath, [maintenanceEntry, 'backup', '--output', snapshotPath], {
    env: { ...process.env, NUXT_DATABASE_URL: `file:${databasePath}` }
  })
  const store = new MemoryStore()
  await assert.rejects(
    runOffHostBackupCli(['upload', '--input', snapshotPath], backupEnvironment(databasePath), {
      store,
      verifyBackup: async () => appendFileSync(snapshotPath, 'changed-after-verification')
    }),
    /database-verified backup snapshot changed before publication/
  )
  assert.equal(store.putCalls, 0)
  assert(existsSync(snapshotPath))
})

test('SQLite-only publication fails closed when active Files bytes are bound to local storage', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  await migrate(databasePath)
  addActiveFile(databasePath, { driver: 'local', bucket: 'local' })
  const store = new MemoryStore()

  await assert.rejects(
    runOffHostBackupCli(['backup'], backupEnvironment(databasePath), {
      store,
      now: () => fixedNow,
      maintenanceEntry
    }),
    (error) => {
      assert(error instanceof OffHostBackupError)
      assert.match(error.message, /maintenance process rejected the backup/)
      assert.match(error.retainedSnapshot, /^sqlite-offhost-/)
      return true
    }
  )
  assert.equal(store.objects.size, 0)
  assert.equal(readdirSync(join(sandbox, 'backups')).filter((name) => name.startsWith('sqlite-offhost-')).length, 1)
  assert(!existsSync(join(sandbox, 'backups', '.off-host-backup.lock')))
})

test('corrupt and stale-ledger retry inputs fail before any provider request', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  await migrate(databasePath)
  const backupsDirectory = join(sandbox, 'backups')
  mkdirSync(backupsDirectory)
  const stalePath = join(backupsDirectory, fixedSnapshotName)
  await execFileAsync(process.execPath, [maintenanceEntry, 'backup', '--output', stalePath], {
    env: { ...process.env, NUXT_DATABASE_URL: `file:${databasePath}` }
  })
  const stale = new Database(stalePath)
  try {
    stale.prepare("update __drizzle_migrations set hash = 'forged' where rowid = 1").run()
  } finally {
    stale.close()
  }
  const store = new MemoryStore()
  await assert.rejects(
    runOffHostBackupCli(['upload', '--input', stalePath], backupEnvironment(databasePath), {
      store,
      maintenanceEntry
    }),
    /maintenance process rejected the backup/
  )
  assert.equal(store.putCalls, 0)
  assert(existsSync(stalePath))

  rmSync(stalePath)
  const corruptPath = join(backupsDirectory, fixedSnapshotName)
  writeFileSync(corruptPath, 'not sqlite')
  await assert.rejects(
    runOffHostBackupCli(['upload', '--input', corruptPath], backupEnvironment(databasePath), {
      store,
      maintenanceEntry
    }),
    /maintenance process rejected the backup/
  )
  assert.equal(store.putCalls, 0)
  assert(existsSync(corruptPath))
})

test('active Files metadata is publishable only when the copied snapshot has one matching R2 binding', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  await migrate(databasePath)
  addActiveFile(databasePath, {
    driver: 'r2',
    bucket: 'private-user-files',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`
  })

  const receipt = await runOffHostBackupCli(['backup'], backupEnvironment(databasePath), {
    store: new MemoryStore(),
    now: () => fixedNow,
    maintenanceEntry
  })
  assert.equal(receipt.command, 'backup')
})

test('the database backup bucket cannot be reused as the persisted Files bucket', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  await migrate(databasePath)
  addActiveFile(databasePath, {
    driver: 'r2',
    bucket: 'private-database-backups',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`
  })
  const store = new MemoryStore()
  await assert.rejects(
    runOffHostBackupCli(['backup'], backupEnvironment(databasePath), {
      store,
      now: () => fixedNow,
      maintenanceEntry
    }),
    /maintenance process rejected the backup/
  )
  assert.equal(store.putCalls, 0)

  const inactiveSandbox = disposableDirectory(t)
  const inactiveDatabasePath = join(inactiveSandbox, 'app.db')
  await migrate(inactiveDatabasePath)
  const sqlite = new Database(inactiveDatabasePath)
  try {
    insertStorageBinding(sqlite, {
      driver: 'r2',
      bucket: 'private-database-backups',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`
    })
  } finally {
    sqlite.close()
  }
  const inactiveStore = new MemoryStore()
  await assert.rejects(
    runOffHostBackupCli(['backup'], backupEnvironment(inactiveDatabasePath), {
      store: inactiveStore,
      now: () => fixedNow,
      maintenanceEntry
    }),
    /maintenance process rejected the backup/
  )
  assert.equal(inactiveStore.putCalls, 0)
})

test('fetch stages privately and removes partial bytes when interrupted or corrupted', async (t) => {
  const sandbox = disposableDirectory(t)
  const backupsDirectory = join(sandbox, 'backups')
  mkdirSync(backupsDirectory)
  const paths = { dataDirectory: sandbox, databasePath: join(sandbox, 'app.db'), backupsDirectory }
  const bytes = Buffer.from('download source')
  const sha256 = digest(bytes, 'sha256', 'hex')
  const key = objectKey(sha256)
  const controller = new AbortController()
  const interruptedStore = new MemoryStore({ interruptRead: controller })
  interruptedStore.objects.set(key, {
    bytes,
    metadata: { byteSize: bytes.byteLength, sha256, format: 'sqlite-online-backup-v1' }
  })

  const pending = fetchVerifiedSnapshot({
    key,
    paths,
    store: interruptedStore,
    signal: controller.signal,
    verifyBackup: async () => assert.fail('interrupted bytes must not reach database verification')
  })
  await interruptedStore.readStarted
  controller.abort(new Error('test interruption'))
  await assert.rejects(pending)
  assert.deepEqual(readdirSync(backupsDirectory), [])

  const corruptStore = new MemoryStore()
  corruptStore.objects.set(key, {
    bytes: Buffer.from('corrupt bytes'),
    metadata: { byteSize: bytes.byteLength, sha256, format: 'sqlite-online-backup-v1' }
  })
  await assert.rejects(
    fetchVerifiedSnapshot({
      key,
      paths,
      store: corruptStore,
      verifyBackup: async () => assert.fail('corrupt bytes must not reach database verification')
    }),
    /downloaded R2 backup bytes do not match/
  )
  assert.deepEqual(readdirSync(backupsDirectory), [])
})

test('self-consistent foreign remote bytes reach database verification and leave no staged file', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  const bytes = Buffer.from('self-consistent but not sqlite')
  const sha256 = digest(bytes, 'sha256', 'hex')
  const key = objectKey(sha256)
  const store = new MemoryStore()
  store.objects.set(key, {
    bytes,
    metadata: { byteSize: bytes.byteLength, sha256, format: 'sqlite-online-backup-v1' }
  })

  await assert.rejects(
    runOffHostBackupCli(['fetch', '--key', key], backupEnvironment(databasePath), {
      store,
      maintenanceEntry
    }),
    /maintenance process rejected the backup/
  )
  assert.deepEqual(readdirSync(join(sandbox, 'backups')), [])
})

test('path escapes, symlinks, overlapping operations, and stale receipts fail without provider mutation', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  await migrate(databasePath)
  const backupsDirectory = join(sandbox, 'backups')
  mkdirSync(backupsDirectory)
  const outside = join(sandbox, 'outside.db')
  writeFileSync(outside, 'outside')
  const linked = join(backupsDirectory, fixedSnapshotName)
  symlinkSync(outside, linked)
  const store = new MemoryStore()

  await assert.rejects(
    runOffHostBackupCli(['upload', '--input', linked], backupEnvironment(databasePath), {
      store,
      maintenanceEntry
    }),
    /existing regular file, not a symbolic link/
  )
  assert.equal(store.objects.size, 0)
  rmSync(linked)

  mkdirSync(join(backupsDirectory, '.off-host-backup.lock'))
  await assert.rejects(
    runOffHostBackupCli(['backup'], backupEnvironment(databasePath), { store, maintenanceEntry }),
    /Another off-host backup operation may still be active/
  )
  assert.equal(store.objects.size, 0)

  const sha256 = 'a'.repeat(64)
  store.objects.set(objectKey(sha256, '2026-07-15T20-00-00-000Z'), {
    bytes: Buffer.from('stale'),
    metadata: { byteSize: 5, sha256, format: 'sqlite-online-backup-v1' }
  })
  await assert.rejects(
    verifyLatestReceipt({ store, now: fixedNow, maximumAgeHours: 12 }),
    /latest immutable R2 backup receipt is stale/
  )

  const weekStore = new MemoryStore()
  const weekKey = objectKey(sha256, '2026-07-10T12-34-56-789Z')
  weekStore.objects.set(weekKey, {
    bytes: Buffer.from('old but allowed'),
    metadata: { byteSize: 15, sha256, format: 'sqlite-online-backup-v1' }
  })
  assert.equal((await verifyLatestReceipt({ store: weekStore, now: fixedNow, maximumAgeHours: 168 })).key, weekKey)
})

class MemoryStore {
  constructor(options = {}) {
    this.options = options
    this.objects = new Map()
    this.putCalls = 0
    this.readCalls = 0
    this.readStarted = new Promise((accept) => {
      this.acceptReadStarted = accept
    })
  }

  async head(key) {
    return this.objects.get(key)?.metadata ?? null
  }

  async put(key, snapshot) {
    this.putCalls += 1
    if (this.options.failPut) throw new OffHostBackupError('injected provider failure')
    const bytes = readFileSync(snapshot.path)
    this.objects.set(key, {
      bytes,
      metadata: {
        byteSize: bytes.byteLength,
        sha256: snapshot.sha256,
        format: 'sqlite-online-backup-v1'
      }
    })
    if (this.options.ambiguousPut) throw new OffHostBackupError('injected uncertain result')
  }

  async readAndHash(key, signal, destinationPath) {
    this.readCalls += 1
    const object = this.objects.get(key)
    if (!object) throw new OffHostBackupError('missing object')
    if (this.options.interruptRead) {
      if (destinationPath) writeFileSync(destinationPath, object.bytes.subarray(0, 2), { flag: 'wx', mode: 0o600 })
      this.acceptReadStarted()
      await new Promise((accept, reject) => {
        if (signal?.aborted) return reject(signal.reason)
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }
    if (destinationPath) writeFileSync(destinationPath, object.bytes, { flag: 'wx', mode: 0o600 })
    return {
      byteSize: object.bytes.byteLength,
      responseByteSize: object.bytes.byteLength,
      sha256: digest(object.bytes, 'sha256', 'hex'),
      metadata: object.metadata
    }
  }

  async listDatePrefix(prefix) {
    return [...this.objects.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => {
        const timestamp = key.match(/sqlite-offhost-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-/)?.[1]
        const iso = timestamp.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, '$1T$2:$3:$4.$5Z')
        return { key, createdAt: new Date(iso), sha256: key.match(/-sha256-([a-f0-9]{64})\.db$/)[1] }
      })
  }
}

function fakeTransport(responses, options = {}) {
  const queue = [...responses]
  const requests = []
  const handler = {
    async handle(request) {
      const bodyChunks = []
      if (request.body && typeof request.body[Symbol.asyncIterator] === 'function') {
        for await (const chunk of request.body) bodyChunks.push(Buffer.from(chunk))
      }
      requests.push({
        method: request.method,
        path: request.path,
        headers: request.headers,
        body: Buffer.concat(bodyChunks)
      })
      if (options.reject) throw options.reject
      const next = queue.shift()
      if (!next) throw new Error('Unexpected fake R2 request')
      return {
        response: {
          statusCode: next.statusCode,
          headers: {
            'x-amz-request-id': `fake-request-${requests.length}`,
            ...next.headers
          },
          body: next.body === undefined ? undefined : Readable.from([next.body])
        }
      }
    },
    destroy() {}
  }
  return { handler, requests }
}

function abortingTransport() {
  return {
    async handle(_request, options) {
      await new Promise((accept, reject) => {
        if (options.abortSignal.aborted) return reject(options.abortSignal.reason)
        options.abortSignal.addEventListener('abort', () => reject(options.abortSignal.reason), { once: true })
      })
    },
    destroy() {}
  }
}

function backupEnvironment(databasePath) {
  return {
    NUXT_DATABASE_URL: `file:${databasePath}`,
    BACKUP_R2_ACCOUNT_ID: accountId,
    BACKUP_R2_BUCKET: 'private-database-backups',
    BACKUP_R2_ENDPOINT: `https://${accountId}.r2.cloudflarestorage.com`,
    BACKUP_R2_ACCESS_KEY_ID: 'local-fake-access-key',
    BACKUP_R2_SECRET_ACCESS_KEY: 'local-fake-secret-key'
  }
}

function objectKey(sha256, timestamp = '2026-07-16T12-34-56-789Z') {
  const date = timestamp.slice(0, 10).replaceAll('-', '/')
  return `sqlite/v1/${date}/sqlite-offhost-${timestamp}-a1b2c3d4e5f6-sha256-${sha256}.db`
}

function digest(bytes, algorithm, encoding) {
  return createHash(algorithm).update(bytes).digest(encoding)
}

async function migrate(databasePath) {
  await execFileAsync(process.execPath, [maintenanceEntry, 'migrate', '--confirm-app-stopped'], {
    env: { ...process.env, NUXT_DATABASE_URL: `file:${databasePath}` }
  })
}

function writeSetting(databasePath, key, value) {
  const sqlite = new Database(databasePath)
  try {
    sqlite.prepare('insert into app_settings (key, value) values (?, ?)').run(key, JSON.stringify(value))
  } finally {
    sqlite.close()
  }
}

function readSetting(databasePath, key) {
  const sqlite = new Database(databasePath, { readonly: true })
  try {
    return JSON.parse(sqlite.prepare('select value from app_settings where key = ?').get(key).value)
  } finally {
    sqlite.close()
  }
}

function addActiveFile(databasePath, binding) {
  const sqlite = new Database(databasePath)
  try {
    sqlite.pragma('foreign_keys = ON')
    sqlite
      .prepare('insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, ?, ?, ?)')
      .run('user_backup', 'Backup User', 'backup@example.test', 1, 1784200000000, 1784200000000)
    insertStorageBinding(sqlite, binding)
    sqlite
      .prepare(
        `insert into files (
          id, owner_id, bucket, object_key, original_name, content_type, byte_size,
          content_md5, status, upload_expires_at, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)`
      )
      .run(
        'file_backup',
        'user_backup',
        binding.bucket,
        'files/v1/file_123e4567-e89b-42d3-a456-426614174000',
        'private.txt',
        'text/plain',
        7,
        'Mhw89IbtUJFk7eweGYH+yA==',
        '2026-07-16T13:00:00.000Z',
        '2026-07-16T12:00:00.000Z',
        '2026-07-16T12:00:00.000Z'
      )
  } finally {
    sqlite.close()
  }
}

function insertStorageBinding(sqlite, binding) {
  sqlite
    .prepare('insert into app_settings (key, value) values (?, ?)')
    .run('files.storage-binding.v1', JSON.stringify({ version: 1, ...binding }))
}

function disposableDirectory(t) {
  const path = mkdtempSync(join(tmpdir(), 'swl-off-host-backup-'))
  t.after(() => rmSync(path, { recursive: true, force: true }))
  return path
}

async function waitForPath(path) {
  const deadline = Date.now() + 5000
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${path}`)
    await new Promise((accept) => setTimeout(accept, 10))
  }
}
