import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { createIsolatedClientAddressBook, runIsolatedApiSmoke } from './api-smoke.mjs'
import { createSqliteWriteObserver, fingerprintDirectory } from './isolated-smoke-policy.mjs'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const Database = require('../apps/web/node_modules/better-sqlite3')
const entry = resolve('scripts/isolated-api-smoke.mjs')

test('isolated API command refuses arbitrary targets before creating a sandbox', async (t) => {
  const temporaryRoot = disposableDirectory(t)
  const result = await runProcess(['https://production.example.com'], cleanEnvironment(temporaryRoot))

  assert.equal(result.code, 1)
  assert.match(result.stderr, /does not accept a deployment URL or command-line options/)
  assert.equal(result.stdout, '')
  assert.deepEqual(readdirSync(temporaryRoot), [])
})

test('isolated API command refuses ambient provider credentials without leaking values', async (t) => {
  const temporaryRoot = disposableDirectory(t)
  const liveSecret = 'sk_live_must_never_reach_the_fixture'
  const result = await runProcess([], {
    ...cleanEnvironment(temporaryRoot),
    NUXT_STRIPE_SECRET_KEY: liveSecret
  })

  assert.equal(result.code, 1)
  assert.match(result.stderr, /refuses ambient application or provider configuration: NUXT_STRIPE_SECRET_KEY/)
  assert.doesNotMatch(result.stderr, new RegExp(liveSecret))
  assert.equal(result.stdout, '')
  assert.deepEqual(readdirSync(temporaryRoot), [])
})

test('isolated API command removes its sandbox after an injected operation failure', async (t) => {
  const temporaryRoot = disposableDirectory(t)
  const result = await runProcess([], {
    ...cleanEnvironment(temporaryRoot),
    NODE_ENV: 'test',
    SWL_API_SMOKE_TEST_FAIL_AFTER_SANDBOX: '1'
  })

  assert.equal(result.code, 1)
  assert.match(result.stderr, /Injected isolated API smoke failure after sandbox creation/)
  assert.equal(result.stdout, '')
  assert.deepEqual(readdirSync(temporaryRoot), [])
})

test('mutating API client refuses a non-loopback target', async () => {
  await assert.rejects(
    runIsolatedApiSmoke({
      baseUrl: 'https://production.example.com',
      fixtureId: 'r011-policy-fixture',
      stripeWebhookSecret: 'whsec_isolated_fixture',
      emailCaptureDirectory: resolve('/tmp/swl-isolated-email-policy-fixture')
    }),
    /requires an HTTP loopback URL/
  )
})

test('isolated auth clients receive stable and distinct trusted fixture addresses', () => {
  const addresses = createIsolatedClientAddressBook()
  const firstClient = new Map()
  const secondClient = new Map()

  assert.equal(addresses.addressFor(), '192.0.2.1')
  assert.equal(addresses.addressFor(firstClient), '192.0.2.2')
  assert.equal(addresses.addressFor(firstClient), '192.0.2.2')
  assert.equal(addresses.addressFor(secondClient), '192.0.2.3')
})

test('provider-directory fingerprint changes with fixture bytes', (t) => {
  const temporaryRoot = disposableDirectory(t)
  const objects = join(temporaryRoot, 'objects')
  assert.equal(fingerprintDirectory(objects), 'absent')
  mkdirSync(objects)
  writeFileSync(join(objects, 'fixture.txt'), 'first')
  const first = fingerprintDirectory(objects)
  writeFileSync(join(objects, 'fixture.txt'), 'second')
  const second = fingerprintDirectory(objects)
  assert.notEqual(first, second)
})

test('SQLite observer rejects a commit from another connection', (t) => {
  const temporaryRoot = disposableDirectory(t)
  const databasePath = join(temporaryRoot, 'app.db')
  const writer = new Database(databasePath)
  writer.exec('create table fixture (id integer primary key, value text not null)')
  const observer = createSqliteWriteObserver(Database, databasePath)
  try {
    observer.assertUnchanged('control')
    writer.prepare('insert into fixture (value) values (?)').run('mutation')
    assert.throws(() => observer.assertUnchanged('deployment smoke'), /changed SQLite data_version/)
  } finally {
    observer.close()
    writer.close()
  }
})

function disposableDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'swl-isolated-api-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

function cleanEnvironment(temporaryRoot) {
  return Object.fromEntries(
    Object.entries({
      CI: 'true',
      HOME: process.env.HOME,
      LANG: process.env.LANG,
      PATH: process.env.PATH,
      TEMP: temporaryRoot,
      TMP: temporaryRoot,
      TMPDIR: temporaryRoot,
      TZ: process.env.TZ
    }).filter(([, value]) => value !== undefined)
  )
}

async function runProcess(args, environment) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [entry, ...args], {
      encoding: 'utf8',
      env: environment,
      timeout: 5_000
    })
    return { code: 0, stderr, stdout }
  } catch (error) {
    if (typeof error?.code !== 'number') throw error
    return { code: error.code, stderr: error.stderr ?? '', stdout: error.stdout ?? '' }
  }
}
