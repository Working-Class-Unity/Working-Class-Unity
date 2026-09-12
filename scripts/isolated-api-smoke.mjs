import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runIsolatedApiSmoke } from './api-smoke.mjs'
import {
  cleanupDisposableState,
  createCleanupCoordinator,
  remainingTimeout,
  reservePort,
  runManaged,
  selectEnvironment,
  spawnManaged,
  stopManaged,
  waitForHttp
} from './ci-browser-helpers.mjs'
import { assertIsolatedSmokeInvocation, createSqliteWriteObserver } from './isolated-smoke-policy.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runPnpm = resolve(root, 'scripts/run-pnpm.mjs')
const serverEntry = resolve(root, '.output/server/index.mjs')
const serverPreload = resolve(root, '.output/server/sentry.server.config.mjs')
const requireFromApp = createRequire(resolve(root, 'package.json'))
const inheritedEnvironment = selectEnvironment(process.env, [
  'CI',
  'COLORTERM',
  'COMSPEC',
  'FORCE_COLOR',
  'HOME',
  'LANG',
  'LC_ALL',
  'LOGNAME',
  'NO_COLOR',
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'SystemRoot',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'TZ',
  'USER',
  'WINDIR'
])

let sandbox
let databasePath
let runtimeCwd
let fixtureId
let readinessToken
let databaseObserver
let server
let serverOutputMonitor
const activeChildren = new Set()
const childClosePromises = new WeakMap()
const overallDeadline = Date.now() + 300_000

try {
  assertIsolatedSmokeInvocation(process.argv.slice(2), process.env)
  sandbox = mkdtempSync(join(tmpdir(), 'swl-isolated-api-smoke-'))
  databasePath = join(sandbox, 'data', 'app.db')
  runtimeCwd = join(sandbox, 'runtime-workspace')
  fixtureId = `r011-${randomBytes(8).toString('hex')}`
  readinessToken = `ready_${randomBytes(32).toString('base64url')}`

  const coordinator = createCleanupCoordinator({ cleanup })
  let result
  await coordinator.run(async () => {
    mkdirSync(dirname(databasePath), { recursive: true })
    mkdirSync(runtimeCwd, { recursive: true })

    if (process.env.NODE_ENV === 'test' && process.env.SWL_API_SMOKE_TEST_FAIL_AFTER_SANDBOX === '1') {
      throw new Error('Injected isolated API smoke failure after sandbox creation.')
    }

    if (!process.argv.includes('--skip-build')) {
      await runPhase(
        'isolated API production build',
        process.execPath,
        [runPnpm, 'run', 'build'],
        buildEnvironment(),
        180_000
      )
    }
    assert(existsSync(serverEntry), `Production server entry was not built: ${serverEntry}`)
    assert(existsSync(serverPreload), `Production Sentry preload was not built: ${serverPreload}`)
    assert(!existsSync(databasePath), 'Production build touched the isolated runtime database.')

    await runPhase(
      'isolated API database migration',
      process.execPath,
      [runPnpm, 'run', 'db:migrate'],
      databaseEnvironment(),
      60_000
    )
    assert(existsSync(databasePath), 'Isolated API migration did not create the disposable database.')

    const port = await reservePort()
    const baseUrl = `http://127.0.0.1:${port}`
    seedEventFixture()
    databaseObserver = createSqliteWriteObserver(requireFromApp('better-sqlite3'), databasePath)
    serverOutputMonitor = createOutputMonitor('isolated API built server')
    server = spawnManaged(process.execPath, ['--import', serverPreload, serverEntry], {
      cwd: runtimeCwd,
      env: applicationEnvironment(baseUrl, port),
      stdio: ['ignore', 'pipe', 'pipe'],
      onSpawn: track
    })
    capture(server.stdout, serverOutputMonitor)
    capture(server.stderr, serverOutputMonitor)

    await waitForHttp(`${baseUrl}/api/live`, {
      child: server,
      requestTimeoutMs: 2_000,
      timeoutMs: remainingTimeout(overallDeadline, 45_000, 'isolated API server liveness')
    })

    result = await runIsolatedApiSmoke({ baseUrl, fixtureId })
    databaseObserver.assertUnchanged('Public API smoke')

    const completedServer = server
    server = undefined
    await stopManaged(completedServer, { graceMs: 5_000 })
    await waitForChildClose(completedServer)
    untrack(completedServer)
    serverOutputMonitor.assertNoForbidden()
  })

  assert(!existsSync(sandbox), 'Isolated API sandbox remained after cleanup.')
  console.log(
    `Isolated API smoke passed for fixture ${result.fixtureId}; public requests made no database writes and the disposable database and runtime workspace were removed.`
  )
} catch (error) {
  const diagnostic = serverOutputMonitor?.redactedDiagnostic().trim()
  if (diagnostic) {
    console.error(`${serverOutputMonitor.label} output (redacted):`)
    console.error(diagnostic)
  }
  console.error(`Isolated API smoke failed: ${redact(error instanceof Error ? error.message : String(error))}`)
  process.exitCode = 1
}

function buildEnvironment() {
  return {
    ...inheritedEnvironment,
    CI: 'true',
    NODE_ENV: 'production',
    NITRO_PRESET: 'node-server'
  }
}

function databaseEnvironment() {
  return {
    ...inheritedEnvironment,
    CI: 'true',
    NODE_ENV: 'production',
    NUXT_DATABASE_URL: `file:${databasePath}`
  }
}

function applicationEnvironment(baseUrl, port) {
  return {
    ...databaseEnvironment(),
    NITRO_HOST: '127.0.0.1',
    NITRO_PORT: String(port),
    NITRO_PRESET: 'node-server',
    NUXT_PUBLIC_APP_NAME: 'Isolated API Smoke',
    NUXT_PUBLIC_APP_URL: baseUrl,
    NUXT_READINESS_TOKEN: readinessToken
  }
}

async function runPhase(label, command, args, env, maximumMs) {
  let child
  try {
    await runManaged(command, args, {
      cwd: root,
      env,
      graceMs: 5_000,
      label,
      onSpawn: (spawnedChild) => {
        child = spawnedChild
        track(spawnedChild)
      },
      stdio: 'inherit',
      timeoutMs: remainingTimeout(overallDeadline, maximumMs, label)
    })
  } finally {
    if (child) {
      await waitForChildClose(child)
      untrack(child)
    }
  }
}

function seedEventFixture() {
  const Database = requireFromApp('better-sqlite3')
  const sqlite = new Database(databasePath, { fileMustExist: true })
  try {
    // Match runtime journaling before observing writes; switching journal mode
    // itself changes data_version even when no event rows change.
    sqlite.pragma('journal_mode = WAL')
    const tables = sqlite
      .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name")
      .all()
      .map((row) => row.name)
    assert(
      JSON.stringify(tables) ===
        JSON.stringify([
          '__drizzle_migrations',
          'event_provider_links',
          'event_session_provider_links',
          'event_sessions',
          'event_tags',
          'events',
          'external_record_snapshots',
          'import_batches'
        ]),
      'Runtime database must contain only event tables and its migration ledger.'
    )
    const eventInsert = sqlite.prepare(
      'insert into events (id, title, kind, visibility, status) values (?, ?, ?, ?, ?)'
    )
    const sessionInsert = sqlite.prepare(
      'insert into event_sessions (id, event_id, starts_at, timezone, virtual_url, rsvp_url, status) values (?, ?, ?, ?, ?, ?, ?)'
    )
    sqlite.transaction(() => {
      for (const [label, visibility, eventStatus, sessionStatus] of [
        ['public', 'public', 'active', 'scheduled'],
        ['members', 'members', 'active', 'scheduled'],
        ['member-tag', 'public', 'active', 'scheduled'],
        ['hidden', 'hidden', 'active', 'scheduled'],
        ['archived', 'public', 'archived', 'scheduled'],
        ['canceled', 'public', 'active', 'canceled']
      ]) {
        const id = `${fixtureId}-${label}`
        eventInsert.run(id, `${label} fixture event`, 'meeting', visibility, eventStatus)
        sessionInsert.run(
          `${id}-session`,
          id,
          '2030-01-15T18:00:00.000Z',
          'America/Los_Angeles',
          'https://private-video.invalid/secret',
          'https://solidarity.example.com/event/public',
          sessionStatus
        )
      }
      sqlite
        .prepare("insert into event_tags (event_id, kind, value) values (?, 'event', 'audience-members')")
        .run(`${fixtureId}-member-tag`)
    })()
  } finally {
    sqlite.close()
  }
}

async function cleanup() {
  let stopFailure
  try {
    const results = await Promise.allSettled(
      [...activeChildren].map(async (child) => {
        const stopped = await stopManaged(child, { graceMs: 5_000 })
        await waitForChildClose(child)
        untrack(child)
        return stopped
      })
    )
    stopFailure = results.find((result) => result.status === 'rejected')?.reason
    databaseObserver?.close()
  } finally {
    if (sandbox) {
      cleanupDisposableState({ sandbox, databasePath, runtimeCwd })
    }
  }
  if (stopFailure) throw stopFailure
}

function track(child) {
  activeChildren.add(child)
  childClosePromise(child)
}

function untrack(child) {
  activeChildren.delete(child)
}

function childClosePromise(child) {
  let promise = childClosePromises.get(child)
  if (!promise) {
    promise = new Promise((resolveClose) => child.once('close', resolveClose))
    childClosePromises.set(child, promise)
  }
  return promise
}

async function waitForChildClose(child) {
  let timer
  const timeoutMs = 5_000
  const outcome = await Promise.race([
    childClosePromise(child).then(() => 'closed'),
    new Promise((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout('timeout'), timeoutMs)
    })
  ])
  clearTimeout(timer)
  if (outcome !== 'closed') throw new Error(`Child output did not drain within ${timeoutMs}ms`)
}

function capture(stream, outputMonitor) {
  stream?.on('data', (chunk) => outputMonitor.consume(chunk))
}

function createOutputMonitor(label) {
  const forbiddenValues = [readinessToken, databasePath]
  const detected = new Set()
  const maximumValueLength = Math.max(...forbiddenValues.map((value) => value.length))
  let overlap = ''
  let rawDiagnostic = ''

  return {
    label,
    consume(chunk) {
      const text = chunk.toString()
      const combined = `${overlap}${text}`
      forbiddenValues.forEach((value, index) => {
        if (combined.includes(value)) detected.add(index)
      })
      rawDiagnostic = `${rawDiagnostic}${text}`.slice(-8_192)
      overlap = combined.slice(-Math.max(0, maximumValueLength - 1))
    },
    assertNoForbidden() {
      assert(detected.size === 0, `${label} output contained isolated fixture secrets or database paths.`)
    },
    redactedDiagnostic() {
      return redact(rawDiagnostic)
    }
  }
}

function redact(value) {
  let result = String(value)
  for (const secret of [readinessToken, databasePath]) {
    if (secret) result = result.replaceAll(secret, '[redacted]')
  }
  return result
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
