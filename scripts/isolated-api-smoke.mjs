import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
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
import { assertIsolatedSmokeInvocation } from './isolated-smoke-policy.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runPnpm = resolve(root, 'scripts/run-pnpm.mjs')
const serverEntry = resolve(root, '.output/server/index.mjs')
const serverPreload = resolve(root, '.output/server/sentry.server.config.mjs')
const stripeProviderPreload = resolve(root, 'scripts/isolated-stripe-provider-preload.mjs')
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
let emailCaptureDirectory
let fixtureId
let authSecret
let readinessToken
let stripeSecret
let stripeWebhookSecret
let stripeProvider
let stripeProviderUrl
const stripeProviderRequests = []
const stripeCatalog = {
  portalConfigurationId: 'bpc_isolated',
  personalWeeklyPriceId: 'price_isolated_personal_weekly',
  personalMonthlyPriceId: 'price_isolated_personal_monthly',
  personalAnnualPriceId: 'price_isolated_personal_annual',
  familyMonthlyPriceId: 'price_isolated_family_monthly',
  familyAnnualPriceId: 'price_isolated_family_annual'
}
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
  emailCaptureDirectory = join(sandbox, 'email-capture')
  fixtureId = `r011-${randomBytes(8).toString('hex')}`
  authSecret = `auth_${randomBytes(32).toString('base64url')}`
  readinessToken = `ready_${randomBytes(32).toString('base64url')}`
  stripeSecret = `rk_test_${randomBytes(24).toString('hex')}`
  stripeWebhookSecret = `whsec_${randomBytes(24).toString('hex')}`

  const coordinator = createCleanupCoordinator({ cleanup })
  let result
  await coordinator.run(async () => {
    mkdirSync(dirname(databasePath), { recursive: true })
    mkdirSync(runtimeCwd, { recursive: true })

    if (process.env.NODE_ENV === 'test' && process.env.SWL_API_SMOKE_TEST_FAIL_AFTER_SANDBOX === '1') {
      throw new Error('Injected isolated API smoke failure after sandbox creation.')
    }

    await runPhase(
      'isolated API production build',
      process.execPath,
      [runPnpm, 'run', 'build'],
      buildEnvironment(),
      180_000
    )
    assert(existsSync(serverEntry), `Production server entry was not built: ${serverEntry}`)
    assert(existsSync(serverPreload), `Production Sentry preload was not built: ${serverPreload}`)
    assert(existsSync(stripeProviderPreload), `Stripe provider preload was not found: ${stripeProviderPreload}`)
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
    stripeProvider = createServer(handleStripeProviderRequest)
    stripeProvider.unref()
    stripeProvider.listen(0, '127.0.0.1')
    await once(stripeProvider, 'listening')
    const stripeProviderAddress = stripeProvider.address()
    assert(
      stripeProviderAddress && typeof stripeProviderAddress === 'object',
      'The isolated Stripe provider did not bind a loopback port.'
    )
    stripeProviderUrl = `http://127.0.0.1:${stripeProviderAddress.port}`
    serverOutputMonitor = createOutputMonitor('isolated API built server')
    server = spawnManaged(
      process.execPath,
      ['--import', stripeProviderPreload, '--import', serverPreload, serverEntry],
      {
        cwd: runtimeCwd,
        env: applicationEnvironment(baseUrl, port),
        stdio: ['ignore', 'pipe', 'pipe'],
        onSpawn: track
      }
    )
    capture(server.stdout, serverOutputMonitor)
    capture(server.stderr, serverOutputMonitor)

    await waitForHttp(`${baseUrl}/api/live`, {
      child: server,
      requestTimeoutMs: 2_000,
      timeoutMs: remainingTimeout(overallDeadline, 45_000, 'isolated API server liveness')
    })

    result = await runIsolatedApiSmoke({ baseUrl, fixtureId, stripeWebhookSecret, emailCaptureDirectory })
    assertStripeProviderInteraction()
    const fixtureCounts = assertFixtureRecorded()

    const completedServer = server
    server = undefined
    await stopManaged(completedServer, { graceMs: 5_000 })
    await waitForChildClose(completedServer)
    untrack(completedServer)
    serverOutputMonitor.assertNoForbidden()

    result = { ...result, fixtureCounts }
  })

  assert(!existsSync(sandbox), 'Isolated API sandbox remained after cleanup.')
  console.log(
    `Isolated API smoke passed: recorded fixture ${result.fixtureId} ` +
      `(${formatCounts(result.fixtureCounts)}); the disposable database, local provider state, and runtime workspace were removed.`
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
    NUXT_BETTER_AUTH_SECRET: authSecret,
    NUXT_BETTER_AUTH_URL: baseUrl,
    NUXT_SOCIAL_PROVIDERS_GOOGLE_ENABLED: 'false',
    NUXT_EMAIL_TRANSPORT: 'capture',
    NUXT_EMAIL_FROM: 'baseline@example.test',
    NUXT_EMAIL_CAPTURE_DIRECTORY: emailCaptureDirectory,
    NUXT_FILES_DRIVER: 'local',
    NUXT_MODULES_AI_ENABLED: 'false',
    NUXT_OPENAI_FILE_SEARCH_ENABLED: 'false',
    NUXT_OPENAI_WEB_SEARCH_ENABLED: 'false',
    NUXT_MODULES_BILLING_ENABLED: 'true',
    NUXT_MODULES_FILES_ENABLED: 'true',
    NUXT_MODULES_JOBS_ENABLED: 'true',
    NUXT_MODULES_OBSERVABILITY_ENABLED: 'false',
    NUXT_MODULES_TURNSTILE_ENABLED: 'false',
    NUXT_PUBLIC_APP_NAME: 'Isolated API Smoke',
    NUXT_PUBLIC_APP_URL: baseUrl,
    NUXT_READINESS_TOKEN: readinessToken,
    NUXT_STRIPE_SECRET_KEY: stripeSecret,
    NUXT_STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
    NUXT_STRIPE_PORTAL_CONFIGURATION_ID: stripeCatalog.portalConfigurationId,
    NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID: stripeCatalog.personalWeeklyPriceId,
    NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID: stripeCatalog.personalMonthlyPriceId,
    NUXT_STRIPE_PERSONAL_ANNUAL_PRICE_ID: stripeCatalog.personalAnnualPriceId,
    NUXT_STRIPE_FAMILY_MONTHLY_PRICE_ID: stripeCatalog.familyMonthlyPriceId,
    NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID: stripeCatalog.familyAnnualPriceId,
    SWL_ISOLATED_STRIPE_PROVIDER_URL: stripeProviderUrl
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

function assertFixtureRecorded() {
  const Database = requireFromApp('better-sqlite3')
  const sqlite = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    const likeFixture = `%${fixtureId}%`
    const counts = {
      billingEvents: count(
        sqlite,
        'select count(*) as count from billing_events where stripe_event_id like ?',
        likeFixture
      ),
      files: count(sqlite, 'select count(*) as count from files'),
      ownerMemberships: count(
        sqlite,
        `select count(*) as count
         from member
         join organization on organization.id = member.organization_id
         where organization.personal_owner_user_id = member.user_id
           and member.role = 'owner'`
      ),
      personalWorkspaces: count(
        sqlite,
        'select count(*) as count from organization where personal_owner_user_id is not null'
      ),
      projects: count(sqlite, 'select count(*) as count from projects'),
      users: count(sqlite, 'select count(*) as count from user where email like ?', likeFixture)
    }
    assert(counts.users > 0, 'Expected isolated users to be recorded.')
    assert(
      counts.personalWorkspaces === counts.users,
      `Expected one personal workspace per isolated user, received ${counts.personalWorkspaces}.`
    )
    assert(
      counts.ownerMemberships === counts.users,
      `Expected one personal owner membership per isolated user, received ${counts.ownerMemberships}.`
    )
    assert(counts.projects > 0, 'Expected an isolated private project fixture.')
    assert(counts.files >= 1, 'Expected an isolated file metadata fixture.')
    assert(counts.billingEvents === 1, 'Expected one packaged Stripe webhook receipt fixture.')

    const objectFiles = listFiles(join(dirname(databasePath), 'objects'))
    assert(objectFiles.length === 1, `Expected one isolated local object, received ${objectFiles.length}.`)
    assert(readFileSync(objectFiles[0], 'utf8') === 'hello', 'Isolated local object bytes did not match the fixture.')
    return { ...counts, localObjects: objectFiles.length }
  } finally {
    sqlite.close()
  }
}

function count(sqlite, sql, parameter) {
  const statement = sqlite.prepare(sql)
  const row = parameter === undefined ? statement.get() : statement.get(parameter)
  return Number(row?.count ?? 0)
}

function listFiles(directory) {
  if (!existsSync(directory)) return []
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(path))
    else if (entry.isFile()) files.push(path)
  }
  return files.sort((left, right) => left.localeCompare(right))
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
    await stopStripeProvider()
  } finally {
    if (sandbox) {
      cleanupDisposableState({ sandbox, databasePath, runtimeCwd })
    }
  }
  if (stopFailure) throw stopFailure
}

function handleStripeProviderRequest(request, response) {
  const requestUrl = new URL(request.url ?? '/', stripeProviderUrl)
  const prefix = '/v1/checkout/sessions/'
  const sessionId = requestUrl.pathname.startsWith(prefix)
    ? decodeURIComponent(requestUrl.pathname.slice(prefix.length))
    : ''
  const expansionValues = [...requestUrl.searchParams.entries()]
    .filter(([key]) => /^expand(?:\[\d+\])?$/.test(key))
    .map(([, value]) => value)

  stripeProviderRequests.push({
    authorized: request.headers.authorization === `Bearer ${stripeSecret}`,
    expansions: expansionValues,
    method: request.method,
    pathname: requestUrl.pathname
  })

  if (
    request.method !== 'GET' ||
    request.headers.authorization !== `Bearer ${stripeSecret}` ||
    !new RegExp(`^cs_test_${escapeRegExp(fixtureId)}-billing-[1-9][0-9]*$`).test(sessionId) ||
    expansionValues.length !== 1 ||
    expansionValues[0] !== 'line_items'
  ) {
    respondStripeJson(response, 404, {
      error: { code: 'isolated_provider_request_rejected', type: 'invalid_request_error' }
    })
    return
  }

  const attemptId = `billing_attempt_${sessionId.slice('cs_test_'.length)}`
  respondStripeJson(response, 200, {
    id: sessionId,
    object: 'checkout.session',
    client_reference_id: attemptId,
    customer: null,
    line_items: {
      object: 'list',
      data: [
        {
          id: `li_${sessionId.slice('cs_test_'.length)}`,
          object: 'item',
          price: stripeCatalog.personalMonthlyPriceId,
          quantity: 1
        }
      ],
      has_more: false,
      url: `${requestUrl.pathname}/line_items`
    },
    metadata: { billing_attempt_id: attemptId },
    mode: 'subscription',
    payment_status: 'unpaid',
    status: 'expired',
    subscription: null
  })
}

function respondStripeJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json',
    'request-id': 'req_isolated_api_smoke'
  })
  response.end(JSON.stringify(body))
}

function assertStripeProviderInteraction() {
  assert(
    stripeProviderRequests.length === 1,
    `Expected one bounded Stripe provider read, received ${stripeProviderRequests.length}.`
  )
  const [request] = stripeProviderRequests
  assert(request.authorized, 'The isolated Stripe provider request did not use the fixture key.')
  assert(request.method === 'GET', 'The isolated Stripe provider received a mutating request.')
  assert(
    request.pathname.startsWith('/v1/checkout/sessions/cs_test_'),
    'The isolated Stripe provider received an unexpected path.'
  )
  assert(
    request.expansions.length === 1 && request.expansions[0] === 'line_items',
    'The isolated Stripe provider did not receive the bounded Checkout expansion.'
  )
}

async function stopStripeProvider() {
  const activeProvider = stripeProvider
  stripeProvider = undefined
  stripeProviderUrl = undefined
  if (!activeProvider?.listening) return
  await new Promise((resolveClose, rejectClose) => {
    activeProvider.close((error) => (error ? rejectClose(error) : resolveClose()))
  })
}

function escapeRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
  const forbiddenValues = [
    authSecret,
    readinessToken,
    stripeSecret,
    stripeWebhookSecret,
    ...Object.values(stripeCatalog),
    databasePath
  ]
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

function formatCounts(counts) {
  return Object.entries(counts)
    .map(([name, value]) => `${name}=${value}`)
    .join(', ')
}

function redact(value) {
  let result = String(value)
  for (const secret of [
    authSecret,
    readinessToken,
    stripeSecret,
    stripeWebhookSecret,
    ...Object.values(stripeCatalog),
    databasePath
  ]) {
    if (secret) result = result.replaceAll(secret, '[redacted]')
  }
  return result
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
