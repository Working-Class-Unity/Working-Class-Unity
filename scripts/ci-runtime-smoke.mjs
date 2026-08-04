import assert from 'node:assert/strict'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
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
import { createSqliteWriteObserver, fingerprintDirectory } from './isolated-smoke-policy.mjs'

const root = process.cwd()
const requireFromWeb = createRequire(resolve(root, 'apps/web/package.json'))
const sandbox = mkdtempSync(join(tmpdir(), 'swl-built-runtime-'))
const runtimeCwd = join(sandbox, 'apps', 'web')
const buildDatabasePath = join(sandbox, 'build-data', 'must-not-exist.db')
const canonicalBuildDatabasePath = join(sandbox, 'build-data', 'canonical-must-not-exist.db')
const runtimeDatabasePath = join(sandbox, 'runtime-data', 'app.db')
const runtimeEmailCaptureDirectory = join(sandbox, 'runtime-email-capture')
const serverEntry = resolve(root, 'apps/web/.output/server/index.mjs')
const serverPreload = resolve(root, 'apps/web/.output/server/sentry.server.config.mjs')
const buildPrivateCanary = 'legacy-build-private-canary-must-not-enter-output'
const canonicalBuildAuthCanary = 'canonical-build-auth-canary-must-not-enter-output'
const canonicalBuildReadinessCanary = 'canonical-build-readiness-canary-must-not-enter-output'
const canonicalBuildStripeCanary = 'rk_test_canonical_build_canary_must_not_enter_output'
const canonicalBuildWebhookCanary = 'whsec_canonical_build_canary_must_not_enter_output'
const canonicalBuildStripeCatalogCanaries = {
  portalConfigurationId: 'bpc_canonical_build_must_not_enter_output',
  personalWeeklyPriceId: 'price_canonical_build_personal_weekly',
  personalMonthlyPriceId: 'price_canonical_build_personal_monthly',
  personalAnnualPriceId: 'price_canonical_build_personal_annual',
  familyMonthlyPriceId: 'price_canonical_build_family_monthly',
  familyAnnualPriceId: 'price_canonical_build_family_annual'
}
const canonicalBuildSentryCanary = 'https://build-canary@o0.ingest.invalid/0'
const runtimeAuthSecret = 'runtime-only-auth-secret-sentinel-not-a-credential'
const runtimeGoogleClientId = 'runtime-social-smoke.apps.googleusercontent.com'
const runtimeGoogleClientSecret = 'runtime-google-client-secret-sentinel-not-a-credential'
const runtimeReadinessToken = 'runtime-only-readiness-token-sentinel-not-a-credential'
const runtimeAuthEscapeCanary = 'runtime-auth-escape-canary-must-never-appear'
const runtimeAppUrl = 'https://runtime-app.example.test'
const runtimeAuthUrl = runtimeAppUrl
const runtimeStripeSecret = 'rk_test_runtime_config_boundary_not_used'
const runtimeStripeWebhookSecret = 'whsec_runtime_config_boundary'
const runtimeStripeCatalog = {
  portalConfigurationId: 'bpc_runtime',
  personalWeeklyPriceId: 'price_runtime_personal_weekly',
  personalMonthlyPriceId: 'price_runtime_personal_monthly',
  personalAnnualPriceId: 'price_runtime_personal_annual',
  familyMonthlyPriceId: 'price_runtime_family_monthly',
  familyAnnualPriceId: 'price_runtime_family_annual'
}
const runtimeEmailFrom = 'baseline@example.test'
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
  // Deliberately poison removed legacy names. They must not affect or enter the build.
  DATABASE_URL: `file:${buildDatabasePath}`,
  BETTER_AUTH_SECRET: buildPrivateCanary,
  STRIPE_SECRET_KEY: buildPrivateCanary,
  NUXT_DATABASE_URL: `file:${canonicalBuildDatabasePath}`,
  NUXT_BETTER_AUTH_SECRET: canonicalBuildAuthCanary,
  NUXT_SOCIAL_PROVIDERS_GOOGLE_ENABLED: 'false',
  NUXT_READINESS_TOKEN: canonicalBuildReadinessCanary,
  NUXT_MODULES_BILLING_ENABLED: 'true',
  NUXT_MODULES_JOBS_ENABLED: 'true',
  NUXT_STRIPE_SECRET_KEY: canonicalBuildStripeCanary,
  NUXT_STRIPE_WEBHOOK_SECRET: canonicalBuildWebhookCanary,
  NUXT_STRIPE_PORTAL_CONFIGURATION_ID: canonicalBuildStripeCatalogCanaries.portalConfigurationId,
  NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID: canonicalBuildStripeCatalogCanaries.personalWeeklyPriceId,
  NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID: canonicalBuildStripeCatalogCanaries.personalMonthlyPriceId,
  NUXT_STRIPE_PERSONAL_ANNUAL_PRICE_ID: canonicalBuildStripeCatalogCanaries.personalAnnualPriceId,
  NUXT_STRIPE_FAMILY_MONTHLY_PRICE_ID: canonicalBuildStripeCatalogCanaries.familyMonthlyPriceId,
  NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID: canonicalBuildStripeCatalogCanaries.familyAnnualPriceId,
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
let telemetrySink
const buildOutputMonitor = createOutputMonitor('production build')
let buildVerified = false
let serverOutputMonitor
const activeChildren = new Set()
const childClosePromises = new WeakMap()
const coordinator = createCleanupCoordinator({ cleanup })

await coordinator.run(async () => {
  try {
    mkdirSync(runtimeCwd, { recursive: true })
    await runPhase('pnpm', ['run', 'build'], buildEnv, 180_000, 'production build', {
      outputMonitor: buildOutputMonitor
    })
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
      NUXT_PUBLIC_APP_URL: runtimeAppUrl,
      NUXT_BETTER_AUTH_SECRET: runtimeAuthSecret,
      NUXT_BETTER_AUTH_URL: runtimeAuthUrl,
      NUXT_SOCIAL_PROVIDERS_GOOGLE_ENABLED: 'true',
      NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_ID: runtimeGoogleClientId,
      NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_SECRET: runtimeGoogleClientSecret,
      NUXT_EMAIL_TRANSPORT: 'capture',
      NUXT_EMAIL_FROM: runtimeEmailFrom,
      NUXT_EMAIL_CAPTURE_DIRECTORY: runtimeEmailCaptureDirectory,
      NUXT_READINESS_TOKEN: runtimeReadinessToken,
      NUXT_MODULES_BILLING_ENABLED: 'true',
      NUXT_MODULES_FILES_ENABLED: 'false',
      NUXT_MODULES_AI_ENABLED: 'false',
      NUXT_OPENAI_FILE_SEARCH_ENABLED: 'false',
      NUXT_OPENAI_WEB_SEARCH_ENABLED: 'false',
      NUXT_MODULES_TURNSTILE_ENABLED: 'false',
      NUXT_MODULES_OBSERVABILITY_ENABLED: 'false',
      NUXT_MODULES_JOBS_ENABLED: 'true',
      NUXT_STRIPE_SECRET_KEY: runtimeStripeSecret,
      NUXT_STRIPE_WEBHOOK_SECRET: runtimeStripeWebhookSecret,
      NUXT_STRIPE_PORTAL_CONFIGURATION_ID: runtimeStripeCatalog.portalConfigurationId,
      NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID: runtimeStripeCatalog.personalWeeklyPriceId,
      NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID: runtimeStripeCatalog.personalMonthlyPriceId,
      NUXT_STRIPE_PERSONAL_ANNUAL_PRICE_ID: runtimeStripeCatalog.personalAnnualPriceId,
      NUXT_STRIPE_FAMILY_MONTHLY_PRICE_ID: runtimeStripeCatalog.familyMonthlyPriceId,
      NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID: runtimeStripeCatalog.familyAnnualPriceId
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

    const rejectedTelemetrySink = await startTelemetrySink()
    telemetrySink = rejectedTelemetrySink
    try {
      await assertStartupRejected(
        {
          ...runtimeEnv,
          BETTER_AUTH_TELEMETRY: 'true',
          BETTER_AUTH_TELEMETRY_ENDPOINT: rejectedTelemetrySink.endpoint
        },
        ['BETTER_AUTH_TELEMETRY', 'BETTER_AUTH_TELEMETRY_ENDPOINT'],
        'Better Auth telemetry environment escape'
      )
    } finally {
      await closeTelemetrySink(rejectedTelemetrySink)
      if (telemetrySink === rejectedTelemetrySink) telemetrySink = undefined
    }
    assert(
      rejectedTelemetrySink.requestCount() === 0,
      `rejected Better Auth telemetry overrides made ${rejectedTelemetrySink.requestCount()} request(s)`
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
    await runCommandOriginSmoke()
    await assertDeploymentSmokeReadOnly()
    await assertReadinessDependencyFailure(runtimeEnv)

    const completedServer = child
    child = undefined
    await stopTrackedChild(completedServer)
    serverOutputMonitor.assertNoForbidden()

    console.log(
      'Built runtime smoke passed: 3 representative pre-listen configuration rejections, public liveness, protected 200/401/503 readiness with build-to-runtime token precedence and a dependency-failure transition, one encoded app-command origin canary, and read-only deployment checks with unchanged database/provider state.'
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
  const Database = requireFromWeb('better-sqlite3')
  const observer = createSqliteWriteObserver(Database, runtimeDatabasePath)
  const objectDirectory = join(dirname(runtimeDatabasePath), 'objects')
  try {
    const objectStateBefore = fingerprintDirectory(objectDirectory)
    await runPhase(
      process.execPath,
      [resolve(root, 'scripts/deployment-smoke.mjs'), '--base-url', baseUrl],
      { ...inheritedEnvironment, CI: 'true', NODE_ENV: 'production' },
      60_000,
      'deployment smoke'
    )
    const objectStateAfter = fingerprintDirectory(objectDirectory)
    observer.assertUnchanged('Read-only deployment smoke')
    assert(objectStateAfter === objectStateBefore, 'Read-only deployment smoke changed local provider/object state')
  } finally {
    observer.close()
  }
}

function assertPrivateBuildCanariesAbsent() {
  const outputRoot = resolve(root, 'apps/web/.output')
  for (const path of walkFiles(outputRoot)) {
    const contents = readFileSync(path)
    for (const forbidden of [
      buildPrivateCanary,
      buildDatabasePath,
      canonicalBuildAuthCanary,
      canonicalBuildReadinessCanary,
      canonicalBuildStripeCanary,
      canonicalBuildWebhookCanary,
      ...Object.values(canonicalBuildStripeCatalogCanaries),
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

function assertBaselineSecurityHeaders(response, label) {
  const expected = {
    'x-content-type-options': 'nosniff',
    // Nitro's pinned production error handler deliberately replaces the
    // baseline value with a stricter error-response policy and CSP.
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'content-security-policy': "script-src 'none'; frame-ancestors 'none';",
    'strict-transport-security': 'max-age=15552000; includeSubDomains'
  }
  for (const [name, value] of Object.entries(expected)) {
    assert(response.headers.get(name) === value, `${label} did not retain ${name}`)
  }
}

async function runCommandOriginSmoke() {
  const projectCountBefore = countRuntimeProjects()
  const label = 'Encoded hostile project command'
  const response = await fetchWithTimeout(`${baseUrl}/%61pi/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://attacker.invalid' },
    body: '{malformed'
  })
  const body = await response.json().catch(() => null)

  assert(response.status === 403, `${label} expected command-origin 403, received ${response.status}`)
  assert(body?.data?.code === 'CROSS_ORIGIN_REQUEST_BLOCKED', `${label} did not return the stable origin error code`)
  assert(response.headers.get('cache-control') === 'no-store', `${label} did not disable caching`)
  assert(
    response.headers.get('vary') === 'Origin, Sec-Fetch-Site',
    `${label} did not retain the source-signal vary policy`
  )
  assertBaselineSecurityHeaders(response, label)

  assert(countRuntimeProjects() === projectCountBefore, 'Command-origin smoke unexpectedly mutated project state')
}

function countRuntimeProjects() {
  const Database = requireFromWeb('better-sqlite3')
  const sqlite = new Database(runtimeDatabasePath, { readonly: true })
  try {
    return sqlite.prepare('select count(*) as count from projects').get().count
  } finally {
    sqlite.close()
  }
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
    await closeTelemetrySink(telemetrySink)
    telemetrySink = undefined
  } catch (error) {
    failures.push(error)
  }

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
    throw new AggregateError(failures, 'Runtime process, telemetry sink, or sandbox cleanup failed')
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
    ['private build canary', buildPrivateCanary],
    ['build-only database path', buildDatabasePath],
    ['canonical build auth canary', canonicalBuildAuthCanary],
    ['canonical build readiness canary', canonicalBuildReadinessCanary],
    ['canonical build Stripe canary', canonicalBuildStripeCanary],
    ['canonical build webhook canary', canonicalBuildWebhookCanary],
    ['canonical build Sentry canary', canonicalBuildSentryCanary],
    ['canonical build database path', canonicalBuildDatabasePath],
    ['runtime auth secret', runtimeAuthSecret],
    ['runtime Google client secret', runtimeGoogleClientSecret],
    ['runtime readiness token', runtimeReadinessToken],
    ['runtime auth escape canary', runtimeAuthEscapeCanary],
    ['runtime Stripe secret', runtimeStripeSecret],
    ['runtime Stripe webhook secret', runtimeStripeWebhookSecret],
    ...Object.entries(canonicalBuildStripeCatalogCanaries).map(([key, value]) => [`canonical build ${key}`, value]),
    ...Object.entries(runtimeStripeCatalog).map(([key, value]) => [`runtime ${key}`, value])
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

async function startTelemetrySink() {
  let requests = 0
  const server = createHttpServer((request, response) => {
    requests += 1
    request.resume()
    response.writeHead(204)
    response.end()
  })
  server.unref()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : null
  assert(port, 'Could not bind the bounded Better Auth telemetry sink')

  return {
    endpoint: `http://127.0.0.1:${port}/collect/${runtimeAuthEscapeCanary}`,
    requestCount: () => requests,
    server
  }
}

async function closeTelemetrySink(sink) {
  if (!sink?.server.listening) return

  await new Promise((resolveClose, rejectClose) => {
    const timeout = setTimeout(() => {
      sink.server.closeAllConnections?.()
      rejectClose(new Error('Better Auth telemetry sink did not close within its bounded timeout'))
    }, 5_000)

    sink.server.close((error) => {
      clearTimeout(timeout)
      if (error) rejectClose(error)
      else resolveClose()
    })
    sink.server.closeAllConnections?.()
  })
}
