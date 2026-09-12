import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { createConnection } from 'node:net'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  createCleanupCoordinator,
  reservePort,
  runManaged,
  selectEnvironment,
  spawnManaged,
  stopManaged,
  waitForHttp
} from './ci-browser-helpers.mjs'
import { createSqliteWriteObserver } from './isolated-smoke-policy.mjs'

const args = process.argv.slice(2)
assert(
  args.length === 0 || (args.length === 1 && args[0] === '--skip-build'),
  'Usage: node scripts/ci-runtime-smoke.mjs [--skip-build]'
)
const skipBuild = args.includes('--skip-build')
const root = process.cwd()
const requireFromApp = createRequire(resolve(root, 'package.json'))
const sandbox = mkdtempSync(join(tmpdir(), 'wcu-built-runtime-'))
const runtimeCwd = sandbox
const buildDatabasePath = join(sandbox, 'build-data', 'must-not-exist.db')
const canonicalBuildDatabasePath = join(sandbox, 'build-data', 'canonical-must-not-exist.db')
const runtimeDatabasePath = join(sandbox, 'runtime-data', 'app.db')
const serverEntry = resolve(root, '.output/server/index.mjs')
const serverPreload = resolve(root, '.output/server/sentry.server.config.mjs')
const canonicalBuildReadinessCanary = 'canonical-build-readiness-canary-must-not-enter-output'
const canonicalBuildSentryCanary = 'https://build-canary@o0.ingest.invalid/0'
const runtimeReadinessToken = 'runtime-only-readiness-token-sentinel-not-a-credential'
const httpRequestTimeoutMs = 10_000
const overallDeadline = Date.now() + 300_000
const inheritedEnvironment = selectEnvironment(process.env, [
  'CI',
  'COLORTERM',
  'COMSPEC',
  'FORCE_COLOR',
  'HOME',
  'LANG',
  'LC_ALL',
  'LOGNAME',
  'NODE_OPTIONS',
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
const buildEnv = {
  ...inheritedEnvironment,
  CI: 'true',
  NODE_ENV: 'production',
  NITRO_PRESET: 'node-server',
  // Builds must not capture runtime configuration or create a database.
  DATABASE_URL: `file:${buildDatabasePath}`,
  NUXT_DATABASE_URL: `file:${canonicalBuildDatabasePath}`,
  NUXT_READINESS_TOKEN: canonicalBuildReadinessCanary,
  NUXT_SENTRY_DSN: canonicalBuildSentryCanary
}
const runtimeDatabaseEnv = {
  ...inheritedEnvironment,
  CI: 'true',
  NODE_ENV: 'production',
  NUXT_DATABASE_URL: `file:${runtimeDatabasePath}`
}

let baseUrl
let child
const buildOutputMonitor = createOutputMonitor('production build')
let buildVerified = false
let serverOutputMonitor
const activeChildren = new Set()
const childClosePromises = new WeakMap()
const coordinator = createCleanupCoordinator({ cleanup })

await coordinator.run(async () => {
  try {
    mkdirSync(runtimeCwd, { recursive: true })
    if (!skipBuild) {
      await runPhase('pnpm', ['run', 'build'], buildEnv, 180_000, 'production build', {
        outputMonitor: buildOutputMonitor
      })
    }
    assertPrivateBuildCanariesAbsent()
    assertBuildDatabaseUntouched('production build')
    buildVerified = true

    mkdirSync(dirname(runtimeDatabasePath), { recursive: true })
    await runPhase('pnpm', ['run', 'db:migrate'], runtimeDatabaseEnv, 60_000, 'runtime database migration')
    assert(existsSync(runtimeDatabasePath), 'Runtime migration did not create the exact runtime database')

    if (!existsSync(serverEntry)) {
      throw new Error(`Production server entry was not built: ${serverEntry}`)
    }
    if (!existsSync(serverPreload)) {
      throw new Error(`Production Sentry preload was not built: ${serverPreload}`)
    }

    const port = await reservePort()
    baseUrl = `http://127.0.0.1:${port}`
    const runtimeEnv = {
      ...runtimeDatabaseEnv,
      NITRO_PRESET: 'node-server',
      NITRO_HOST: '127.0.0.1',
      NITRO_PORT: String(port),
      NUXT_PUBLIC_APP_URL: baseUrl,
      NUXT_READINESS_TOKEN: runtimeReadinessToken,
      NUXT_SENTRY_DSN: 'http://public@127.0.0.1:9/1',
      NUXT_PUBLIC_SENTRY_DSN: 'http://public@127.0.0.1:9/1',
      NUXT_SENTRY_TRACES_SAMPLE_RATE: '0',
      NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: '0'
    }
    await assertStartupRejected(
      { ...runtimeEnv, NUXT_DATABASE_URL: undefined },
      ['NUXT_DATABASE_URL'],
      'missing database configuration'
    )
    await assertStartupRejected(
      { ...runtimeEnv, NUXT_SECURITY_ENABLED: 'false' },
      ['NUXT_SECURITY_ENABLED'],
      'nuxt-security runtime override'
    )

    child = spawnManaged(process.execPath, ['--import', serverPreload, serverEntry], {
      cwd: runtimeCwd,
      env: runtimeEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      onSpawn: trackChild
    })
    serverOutputMonitor = createOutputMonitor('built server')
    capture(child.stdout, serverOutputMonitor)
    capture(child.stderr, serverOutputMonitor)

    await waitForHttp(`${baseUrl}/api/live`, {
      child,
      timeoutMs: boundedTimeout(45_000, 'runtime liveness'),
      requestTimeoutMs: 1_000
    })
    await assertRuntimeBoundary(runtimeEnv)
    await assertDeploymentSmokeReadOnly()
    await assertReadinessDependencyFailure(runtimeEnv)

    const completedServer = child
    child = undefined
    await stopTrackedChild(completedServer)
    serverOutputMonitor.assertNoForbidden()

    console.log(
      'Built runtime smoke passed: database and security configuration rejections, provider-free public events, protected 200/401/503 readiness with build-to-runtime token precedence, and read-only deployment checks with unchanged event data.'
    )
  } catch (error) {
    for (const monitor of [buildVerified ? undefined : buildOutputMonitor, serverOutputMonitor]) {
      const diagnostic = monitor?.redactedDiagnostic().trim()
      if (diagnostic) {
        console.error(`${monitor.label} output (redacted):`)
        console.error(diagnostic)
      }
    }
    throw error
  }
})

function assertBuildDatabaseUntouched(stage) {
  const touched = [buildDatabasePath, canonicalBuildDatabasePath].some((path) =>
    ['', '-wal', '-shm'].some((suffix) => existsSync(`${path}${suffix}`))
  )
  assert(!touched, `Build-only database sentinel was touched during ${stage}`)
}

async function assertDeploymentSmokeReadOnly() {
  const Database = requireFromApp('better-sqlite3')
  const observer = createSqliteWriteObserver(Database, runtimeDatabasePath)
  try {
    await runPhase(
      process.execPath,
      [resolve(root, 'scripts/deployment-smoke.mjs'), '--base-url', baseUrl],
      { ...inheritedEnvironment, CI: 'true', NODE_ENV: 'production' },
      60_000,
      'deployment smoke'
    )
    observer.assertUnchanged('Read-only deployment smoke')
  } finally {
    observer.close()
  }
}

function assertPrivateBuildCanariesAbsent() {
  const outputRoot = resolve(root, '.output')
  for (const path of walkFiles(outputRoot)) {
    const contents = readFileSync(path)
    for (const forbidden of [
      buildDatabasePath,
      canonicalBuildReadinessCanary,
      canonicalBuildSentryCanary,
      canonicalBuildDatabasePath
    ]) {
      assert(!contents.includes(Buffer.from(forbidden)), `Production output retained private build canary in ${path}`)
    }
  }
}

function walkFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) return []
    return entry.isDirectory() ? walkFiles(path) : [path]
  })
}

async function assertStartupRejected(environment, expectedKeys, label) {
  const rejectedEnvironment = Object.fromEntries(Object.entries(environment).filter(([, value]) => value !== undefined))
  const rejectedChild = spawnManaged(process.execPath, ['--import', serverPreload, serverEntry], {
    cwd: runtimeCwd,
    env: rejectedEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
    onSpawn: trackChild
  })
  const outputMonitor = createOutputMonitor(`startup rejection: ${label}`)
  let exited = false
  rejectedChild.once('exit', () => {
    exited = true
  })
  for (const stream of [rejectedChild.stdout, rejectedChild.stderr]) {
    capture(stream, outputMonitor)
  }

  let timeout
  try {
    const outcome = await Promise.race([
      childClosePromise(rejectedChild),
      probeForUnexpectedListen(Number(rejectedEnvironment.NITRO_PORT), () => exited),
      new Promise((resolveTimeout) => {
        timeout = setTimeout(() => resolveTimeout({ timeout: true }), boundedTimeout(10_000, label))
      })
    ])
    assert(!outcome.bound, `Built server bound TCP before rejecting ${label}`)
    assert(!outcome.timeout, `Built server listened instead of rejecting ${label}`)
    assert(outcome.code !== 0, `Built server exited successfully for ${label}`)
    const output = outputMonitor.redactedDiagnostic()
    for (const key of expectedKeys) {
      assert(output.includes(key), `${label} did not report ${key}`)
    }
    outputMonitor.assertNoForbidden()
  } finally {
    clearTimeout(timeout)
    await stopTrackedChild(rejectedChild)
  }
}

async function probeForUnexpectedListen(port, hasExited) {
  while (!hasExited()) {
    if (await canConnect(port)) return { bound: true }
    await delay(10)
  }
  return new Promise(() => {})
}

function canConnect(port) {
  return new Promise((resolveConnection) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    let settled = false
    const finish = (connected) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolveConnection(connected)
    }
    socket.setTimeout(100, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

async function assertRuntimeBoundary(runtimeEnvironment) {
  const liveResponse = await fetchWithTimeout(`${baseUrl}/api/live`, {
    headers: { accept: 'application/json' }
  })
  assert(liveResponse.status === 204, `Runtime liveness expected 204, received ${liveResponse.status}`)
  assert((await liveResponse.text()) === '', 'Runtime liveness must not expose a response body')
  assert(liveResponse.headers.get('cache-control') === 'no-store', 'Runtime liveness must disable caching')

  const buildTokenResponse = await fetchWithTimeout(`${baseUrl}/api/ready`, {
    headers: readinessHeaders(canonicalBuildReadinessCanary)
  })
  assert(buildTokenResponse.status === 401, `Build-token readiness expected 401, received ${buildTokenResponse.status}`)
  assert(
    buildTokenResponse.headers.get('www-authenticate') === 'Bearer realm="readiness"',
    'Build-token readiness did not return the Bearer challenge'
  )
  assertExactJson(
    await buildTokenResponse.json().catch(() => null),
    { status: 'unauthorized', code: 'READINESS_AUTH_REQUIRED' },
    'build-token readiness'
  )

  const readinessResponse = await fetchWithTimeout(`${baseUrl}/api/ready`, {
    headers: readinessHeaders(runtimeEnvironment.NUXT_READINESS_TOKEN)
  })
  const readiness = await readinessResponse.json().catch(() => null)
  assert(
    readinessResponse.status === 200,
    `Authorized runtime readiness expected 200, received ${readinessResponse.status}`
  )
  assertExactJson(readiness, { status: 'ready' }, 'authorized readiness')
  assert(!JSON.stringify(readiness).match(/sqlite|database|module|path|duration|check/i), 'Readiness exposed topology')
  const eventsResponse = await fetchWithTimeout(`${baseUrl}/api/events`, {
    headers: { accept: 'application/json' }
  })
  assert(eventsResponse.status === 200, `Public events expected 200, received ${eventsResponse.status}`)
  assertExactJson(await eventsResponse.json(), { events: [] }, 'fresh public calendar')

  const Database = requireFromApp('better-sqlite3')
  const sqlite = new Database(runtimeDatabasePath, { readonly: true, fileMustExist: true })
  try {
    const tables = sqlite.prepare("select name from sqlite_master where type = 'table'").all()
    const retiredTables = tables.filter(({ name }) =>
      /^(user|session|account|verification|people|memberships|account_stripe_memberships|event_rsvps|event_attendance)$/.test(
        name
      )
    )
    assert(retiredTables.length === 0, 'Fresh event database retained identity or membership tables')
  } finally {
    sqlite.close()
  }
  serverOutputMonitor.assertNoForbidden('built server output during runtime boundary checks')
}

async function assertReadinessDependencyFailure(runtimeEnvironment) {
  const unavailableDatabasePath = `${runtimeDatabasePath}.unavailable`
  renameSync(runtimeDatabasePath, unavailableDatabasePath)
  mkdirSync(runtimeDatabasePath)

  const readinessResponse = await fetchWithTimeout(`${baseUrl}/api/ready`, {
    headers: readinessHeaders(runtimeEnvironment.NUXT_READINESS_TOKEN)
  })
  assert(
    readinessResponse.status === 503,
    `Unavailable runtime database readiness expected 503, received ${readinessResponse.status}`
  )
  const readiness = await readinessResponse.json().catch(() => null)
  assertExactJson(readiness, { status: 'not_ready', code: 'SERVICE_NOT_READY' }, 'dependency-failed readiness')
  assert(
    !JSON.stringify(readiness).match(/sqlite|database|module|path|duration|check/i),
    'Failed readiness exposed topology'
  )

  const liveResponse = await fetchWithTimeout(`${baseUrl}/api/live`)
  assert(
    liveResponse.status === 204,
    `Liveness during dependency failure expected 204, received ${liveResponse.status}`
  )
  assert((await liveResponse.text()) === '', 'Liveness during dependency failure exposed a response body')
}

function readinessHeaders(token) {
  return {
    accept: 'application/json',
    authorization: `Bearer ${token}`
  }
}

function assertExactJson(actual, expected, label) {
  assert(actual && typeof actual === 'object' && !Array.isArray(actual), `${label} did not return an object`)
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} returned an unexpected response shape`)
}

async function fetchWithTimeout(url, init = {}) {
  return fetch(url, {
    ...init,
    redirect: init.redirect ?? 'manual',
    signal: AbortSignal.timeout(boundedTimeout(httpRequestTimeoutMs, 'runtime HTTP request'))
  })
}

function boundedTimeout(maximumMs, label) {
  const remainingMs = overallDeadline - Date.now()
  assert(remainingMs > 0, `Built runtime smoke exceeded its overall deadline during ${label}`)
  return Math.max(1, Math.min(maximumMs, remainingMs))
}

async function cleanup() {
  const failures = []

  try {
    await stopActiveChildren()
  } catch (error) {
    failures.push(error)
  }

  try {
    rmSync(sandbox, { recursive: true, force: true })
    assert(!existsSync(sandbox), 'Disposable runtime sandbox remains after cleanup')
  } catch (error) {
    failures.push(error)
  }

  if (failures.length === 1) {
    throw failures[0]
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Runtime process or sandbox cleanup failed')
  }
}

function trackChild(managedChild) {
  activeChildren.add(managedChild)
  childClosePromise(managedChild)
}

async function runPhase(command, args, env, maximumTimeoutMs, label, options = {}) {
  let managedChild
  let phaseError
  try {
    await runManaged(command, args, {
      cwd: options.cwd ?? root,
      env,
      stdio: options.outputMonitor ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      timeoutMs: boundedTimeout(maximumTimeoutMs, label),
      graceMs: 5_000,
      label,
      onSpawn: (spawnedChild) => {
        managedChild = spawnedChild
        trackChild(spawnedChild)
        if (options.outputMonitor) {
          capture(spawnedChild.stdout, options.outputMonitor)
          capture(spawnedChild.stderr, options.outputMonitor)
        }
      }
    })
  } catch (error) {
    phaseError = error
  } finally {
    if (managedChild) {
      await waitForChildClose(managedChild)
      activeChildren.delete(managedChild)
    }
  }

  options.outputMonitor?.assertNoForbidden()
  if (phaseError) throw phaseError
}

async function stopActiveChildren() {
  const outcomes = await Promise.allSettled([...activeChildren].map((managedChild) => stopTrackedChild(managedChild)))
  const failures = outcomes.filter((outcome) => outcome.status === 'rejected').map((outcome) => outcome.reason)

  if (failures.length) {
    throw new AggregateError(failures, 'One or more managed runtime process groups could not be stopped')
  }
}

async function stopTrackedChild(managedChild) {
  await stopManaged(managedChild, { graceMs: 5_000 })
  await waitForChildClose(managedChild)
  activeChildren.delete(managedChild)
}

function capture(stream, outputMonitor) {
  stream?.on('data', (chunk) => outputMonitor.consume(chunk))
}

async function waitForChildClose(managedChild) {
  if (!managedChild) return
  const remaining = overallDeadline - Date.now()
  const timeoutMs = Math.max(1, Math.min(5_000, remaining > 0 ? remaining : 1_000))
  let timer
  const outcome = await Promise.race([
    childClosePromise(managedChild).then(() => 'closed'),
    new Promise((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout('timeout'), timeoutMs)
    })
  ])
  clearTimeout(timer)
  assert(outcome === 'closed', `Child output did not drain within ${timeoutMs}ms`)
}

function childClosePromise(managedChild) {
  let promise = childClosePromises.get(managedChild)
  if (!promise) {
    promise = new Promise((resolveClose) => {
      managedChild.once('close', (code, signal) => resolveClose({ code, signal }))
    })
    childClosePromises.set(managedChild, promise)
  }
  return promise
}

function createOutputMonitor(label) {
  const forbiddenValues = [
    ['build-only database path', buildDatabasePath],
    ['canonical build readiness canary', canonicalBuildReadinessCanary],
    ['canonical build Sentry canary', canonicalBuildSentryCanary],
    ['canonical build database path', canonicalBuildDatabasePath],
    ['runtime readiness token', runtimeReadinessToken]
  ].filter(([, value]) => value)
  const maximumValueLength = Math.max(1, ...forbiddenValues.map(([, value]) => value.length))
  const diagnosticLimit = 16_384
  let overlap = ''
  let rawDiagnostic = ''
  let diagnosticTruncated = false
  const detected = new Set()

  return {
    label,
    consume(chunk) {
      const text = chunk.toString()
      const combined = `${overlap}${text}`
      for (const [name, value] of forbiddenValues) {
        if (combined.includes(value)) detected.add(name)
      }
      overlap = combined.slice(-(maximumValueLength - 1))
      rawDiagnostic = `${rawDiagnostic}${text}`
      const maximumRawLength = diagnosticLimit + maximumValueLength * 2
      if (rawDiagnostic.length > maximumRawLength) {
        diagnosticTruncated = true
        rawDiagnostic = rawDiagnostic.slice(-maximumRawLength)
      }
    },
    assertNoForbidden(stage = label) {
      assert(detected.size === 0, `${stage} contained forbidden output classes: ${[...detected].join(', ')}`)
    },
    redactedDiagnostic() {
      let diagnostic = diagnosticTruncated ? rawDiagnostic.slice(maximumValueLength) : rawDiagnostic
      for (const [, value] of forbiddenValues) diagnostic = diagnostic.replaceAll(value, '[redacted]')
      return diagnostic.slice(-diagnosticLimit)
    }
  }
}
