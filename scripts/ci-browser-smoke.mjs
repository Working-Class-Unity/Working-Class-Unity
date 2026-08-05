import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  cleanupDisposableState,
  createCleanupCoordinator,
  remainingTimeout,
  reservePort,
  runManaged,
  selectEnvironment,
  stopManaged
} from './ci-browser-helpers.mjs'

const root = process.cwd()
const overallDeadline = Date.now() + 300_000
const sandbox = mkdtempSync(join(tmpdir(), 'swl-browser-smoke-'))
const runtimeCwd = join(sandbox, 'runtime-cwd')
const databasePath = join(sandbox, 'data', 'runtime.db')
const emailCaptureDirectory = join(sandbox, 'email-capture')
const playwrightOutput = join(sandbox, 'playwright-output')
const rawServerStdout = join(sandbox, 'server-stdout.log')
const rawServerStderr = join(sandbox, 'server-stderr.log')
const serverEntry = resolve(root, '.output/server/index.mjs')
const serverPreload = resolve(root, '.output/server/sentry.server.config.mjs')
const turnstileProviderPreload = resolve(root, 'scripts/isolated-turnstile-provider-preload.mjs')
const browserPort = await reservePort()
const buildName = 'Build Sentinel - Must Not Render'
const buildUrl = 'https://build-sentinel.invalid'
const runtimeName = 'Runtime Browser Baseline'
const buildSentryRelease = 'build-sentry-release-must-not-render'
const runtimeSentryRelease = 'runtime-sentry-release'
const buildReadinessCanary = 'ci-only-build-readiness-canary-must-not-render'
const runtimeSecret = 'ci-only-runtime-browser-secret-32-bytes-minimum'
const runtimeReadinessToken = 'ci-only-runtime-readiness-token-32-bytes-minimum'
const runtimeStripeSecret = 'rk_test_ci_only_runtime_browser_stripe_secret'
const runtimeStripeWebhookSecret = 'whsec_ci_only_runtime_browser_webhook_secret'
const runtimeStripeCatalog = {
  portalConfigurationId: 'bpc_ci_runtime',
  personalWeeklyPriceId: 'price_ci_runtime_personal_weekly',
  personalMonthlyPriceId: 'price_ci_runtime_personal_monthly',
  personalAnnualPriceId: 'price_ci_runtime_personal_annual',
  familyMonthlyPriceId: 'price_ci_runtime_family_monthly',
  familyAnnualPriceId: 'price_ci_runtime_family_annual'
}
const browserAuthEmailMarker = 'ci-only-browser-auth-recipient'
const bearerEmailSubjects = new Set(['Your sign-in link'])
const maxCaptureFileBytes = 65_536
const maxCaptureFiles = 64
const maxCaptureTotalBytes = 1_048_576
const maxRawServerOutputBytes = 1_048_576
const activeChildren = new Set()
const childClosePromises = new WeakMap()
const playwrightOutputMonitor = createOutputMonitor('Playwright')
const rawServerOutputMonitor = createOutputMonitor('raw built browser server')
let browserDiagnosticsSafe = true

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
  'PLAYWRIGHT_BROWSERS_PATH',
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
const buildEnv = buildEnvironment()

const coordinator = createCleanupCoordinator({ cleanup })
await coordinator.run(async () => {
  try {
    mkdirSync(runtimeCwd, { recursive: true })
    mkdirSync(dirname(databasePath), { recursive: true })
    mkdirSync(playwrightOutput, { recursive: true })

    await runPhase('production build', 'pnpm', ['run', 'build'], buildEnv, 180_000)
    if (!existsSync(serverEntry)) {
      throw new Error(`Production server entry was not built: ${serverEntry}`)
    }
    if (!existsSync(serverPreload)) {
      throw new Error(`Production Sentry preload was not built: ${serverPreload}`)
    }
    if (!existsSync(turnstileProviderPreload)) {
      throw new Error(`Turnstile provider preload was not found: ${turnstileProviderPreload}`)
    }

    const migrationEnv = databaseEnvironment(databasePath)
    await runPhase('runtime migration', 'pnpm', ['run', 'db:migrate'], migrationEnv, 60_000)
    if (!existsSync(databasePath)) {
      throw new Error(`Runtime migration did not create the exact disposable database: ${databasePath}`)
    }

    const baseUrl = `http://127.0.0.1:${browserPort}`
    const runtimeEnv = applicationEnvironment({
      appName: runtimeName,
      appUrl: baseUrl,
      databasePath,
      port: browserPort,
      secret: runtimeSecret
    })

    const browserEnv = {
      ...runtimeEnv,
      BROWSER_BASE_URL: baseUrl,
      BROWSER_BUILD_APP_NAME: buildName,
      BROWSER_BUILD_APP_URL: buildUrl,
      BROWSER_BUILD_READINESS_TOKEN: buildReadinessCanary,
      BROWSER_BUILD_SENTRY_RELEASE: buildSentryRelease,
      BROWSER_RUNTIME_APP_NAME: runtimeName,
      BROWSER_RUNTIME_APP_URL: baseUrl,
      BROWSER_RUNTIME_AUTH_SECRET: runtimeSecret,
      BROWSER_RUNTIME_DATABASE_PATH: databasePath,
      BROWSER_RUNTIME_READINESS_TOKEN: runtimeReadinessToken,
      BROWSER_RUNTIME_SENTRY_ORIGIN: 'https://sentry.browser.invalid',
      BROWSER_RUNTIME_SENTRY_RELEASE: runtimeSentryRelease,
      BROWSER_RUNTIME_STRIPE_SECRET: runtimeStripeSecret,
      BROWSER_RUNTIME_STRIPE_WEBHOOK_SECRET: runtimeStripeWebhookSecret,
      BROWSER_AUTH_EMAIL_MARKER: browserAuthEmailMarker,
      BROWSER_EMAIL_CAPTURE_DIRECTORY: emailCaptureDirectory,
      BROWSER_RUNTIME_CWD: runtimeCwd,
      BROWSER_SERVER_ENTRY: serverEntry,
      BROWSER_SERVER_PRELOAD: serverPreload,
      BROWSER_SERVER_STDERR_PATH: rawServerStderr,
      BROWSER_SERVER_STDOUT_PATH: rawServerStdout,
      BROWSER_TURNSTILE_PROVIDER_PRELOAD: turnstileProviderPreload,
      PLAYWRIGHT_OUTPUT_DIR: playwrightOutput
    }
    browserDiagnosticsSafe = false
    let playwrightFailure
    try {
      await runPhase(
        'Chromium browser suite',
        'pnpm',
        ['exec', 'playwright', 'test', '--config=playwright.config.mjs'],
        browserEnv,
        90_000,
        playwrightOutputMonitor
      )
    } catch (error) {
      playwrightFailure = error
    }
    const rawOutputState = rawServerOutputState()
    const capturedSecrets = capturedBrowserSecrets({
      allowEmpty: Boolean(playwrightFailure && rawOutputState === 'absent')
    })
    if (rawOutputState === 'absent' && capturedSecrets.length > 0) {
      throw new Error('Email captures exist without raw built-server output')
    }
    for (const monitor of [playwrightOutputMonitor, rawServerOutputMonitor]) {
      monitor.registerForbidden(capturedSecrets)
    }
    if (rawOutputState === 'present') {
      scanRawServerOutput(rawServerOutputMonitor)
    } else if (!playwrightFailure) {
      throw new Error('Raw built-server output is missing after a successful Playwright run')
    }
    scanArtifactTree(playwrightOutput, playwrightOutputMonitor)
    browserDiagnosticsSafe = true
    for (const monitor of [playwrightOutputMonitor, rawServerOutputMonitor]) {
      monitor.assertNoForbidden()
    }
    if (playwrightFailure) throw playwrightFailure

    console.log('Browser smoke passed: every discovered Playwright case completed against disposable runtime state.')
  } catch (error) {
    if (browserDiagnosticsSafe) {
      for (const monitor of [playwrightOutputMonitor, rawServerOutputMonitor]) {
        const diagnostic = monitor.redactedDiagnostic().trim()
        if (diagnostic) {
          console.error(`${monitor.label} output (redacted):`)
          console.error(diagnostic)
        }
      }
    } else {
      console.error('Browser diagnostics withheld because private capture registration did not complete safely.')
    }
    throw error
  }
})

function applicationEnvironment({ appName, appUrl, databasePath: selectedDatabasePath, port: selectedPort, secret }) {
  return {
    ...databaseEnvironment(selectedDatabasePath),
    NITRO_PRESET: 'node-server',
    NITRO_HOST: '127.0.0.1',
    NITRO_PORT: String(selectedPort),
    NUXT_PUBLIC_APP_NAME: appName,
    NUXT_PUBLIC_APP_URL: appUrl,
    NUXT_BETTER_AUTH_SECRET: secret,
    NUXT_BETTER_AUTH_URL: appUrl,
    NUXT_EMAIL_CAPTURE_DIRECTORY: emailCaptureDirectory,
    NUXT_EMAIL_FROM: 'baseline@example.test',
    NUXT_EMAIL_TRANSPORT: 'capture',
    NUXT_READINESS_TOKEN: runtimeReadinessToken,
    NUXT_FILES_DRIVER: 'local',
    NUXT_OPENAI_API_KEY: 'browser-openai-key-not-a-provider-credential',
    NUXT_OPENAI_PROJECT_ID: 'proj_browser_smoke',
    NUXT_OPENAI_MODEL: 'gpt-5.6-luna',
    NUXT_OPENAI_FILE_SEARCH_VECTOR_STORE_ID: 'vs_browser_empty',
    NUXT_OPENAI_WEB_SEARCH_ALLOWED_DOMAINS: 'example.test',
    NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY: 'isolated-turnstile-browser-secret-not-a-provider-credential',
    NUXT_PUBLIC_TURNSTILE_SITE_KEY: 'isolated-turnstile-browser-site-not-a-provider-credential',
    SWL_ISOLATED_TURNSTILE_HOSTNAME: new URL(appUrl).hostname,
    NUXT_SENTRY_DSN: 'http://public@127.0.0.1:9/1',
    NUXT_PUBLIC_SENTRY_DSN: 'https://public@sentry.browser.invalid/1',
    NUXT_SENTRY_TRACES_SAMPLE_RATE: '0',
    NUXT_PUBLIC_SENTRY_ENVIRONMENT: 'runtime-browser',
    NUXT_PUBLIC_SENTRY_RELEASE: runtimeSentryRelease,
    NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: '0.125',
    NUXT_STRIPE_SECRET_KEY: runtimeStripeSecret,
    NUXT_STRIPE_WEBHOOK_SECRET: runtimeStripeWebhookSecret,
    NUXT_STRIPE_PORTAL_CONFIGURATION_ID: runtimeStripeCatalog.portalConfigurationId,
    NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID: runtimeStripeCatalog.personalWeeklyPriceId,
    NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID: runtimeStripeCatalog.personalMonthlyPriceId,
    NUXT_STRIPE_PERSONAL_ANNUAL_PRICE_ID: runtimeStripeCatalog.personalAnnualPriceId,
    NUXT_STRIPE_FAMILY_MONTHLY_PRICE_ID: runtimeStripeCatalog.familyMonthlyPriceId,
    NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID: runtimeStripeCatalog.familyAnnualPriceId
  }
}

function buildEnvironment() {
  return {
    ...inheritedEnvironment,
    CI: 'true',
    NODE_ENV: 'production',
    NITRO_PRESET: 'node-server',
    NUXT_READINESS_TOKEN: buildReadinessCanary,
    NUXT_PUBLIC_APP_NAME: buildName,
    NUXT_PUBLIC_APP_URL: buildUrl,
    NUXT_PUBLIC_SENTRY_ENVIRONMENT: 'build-browser',
    NUXT_PUBLIC_SENTRY_RELEASE: buildSentryRelease,
    NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: '0.875'
  }
}

function databaseEnvironment(selectedDatabasePath) {
  return {
    ...inheritedEnvironment,
    CI: 'true',
    NODE_ENV: 'production',
    NUXT_DATABASE_URL: `file:${selectedDatabasePath}`
  }
}

async function runPhase(label, command, args, env, maximumMs, outputMonitor) {
  let child
  let phaseError
  try {
    await runManaged(command, args, {
      cwd: root,
      env,
      stdio: outputMonitor ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      graceMs: 5_000,
      label,
      onSpawn: (spawnedChild) => {
        child = spawnedChild
        track(spawnedChild)
        if (outputMonitor) {
          capture(spawnedChild.stdout, outputMonitor)
          capture(spawnedChild.stderr, outputMonitor)
        }
      },
      onExit: undefined,
      timeoutMs: remainingTimeout(overallDeadline, maximumMs, label)
    })
  } catch (error) {
    phaseError = error
  } finally {
    if (child) {
      await waitForChildClose(child)
      untrack(child)
    }
  }
  outputMonitor?.assertNoForbidden()
  if (phaseError) throw phaseError
}

function track(child) {
  activeChildren.add(child)
  childClosePromise(child)
}

function untrack(child) {
  activeChildren.delete(child)
}

async function cleanup() {
  let stopFailure
  try {
    const children = [...activeChildren]
    const results = await Promise.allSettled(
      children.map(async (child) => {
        const stopped = await stopManaged(child, { graceMs: 5_000 })
        await waitForChildClose(child)
        untrack(child)
        return stopped
      })
    )
    stopFailure = results.find((result) => result.status === 'rejected')?.reason
  } finally {
    cleanupDisposableState({
      sandbox,
      databasePath,
      runtimeCwd,
      artifactPaths: [playwrightOutput]
    })
  }
  if (stopFailure) {
    throw stopFailure
  }
}

function capture(stream, outputMonitor) {
  stream?.on('data', (chunk) => outputMonitor.consume(chunk))
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
  const timeoutMs = 5_000
  let timer
  const outcome = await Promise.race([
    childClosePromise(child).then(() => 'closed'),
    new Promise((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout('timeout'), timeoutMs)
    })
  ])
  clearTimeout(timer)
  if (outcome !== 'closed') throw new Error(`Child output did not drain within ${timeoutMs}ms`)
}

function createOutputMonitor(label) {
  const forbiddenValues = [
    buildReadinessCanary,
    runtimeSecret,
    runtimeReadinessToken,
    runtimeStripeSecret,
    runtimeStripeWebhookSecret,
    ...Object.values(runtimeStripeCatalog),
    browserAuthEmailMarker,
    emailCaptureDirectory
  ]
  let forbiddenBuffers = forbiddenValues.map((value) => Buffer.from(value))
  let detected = false
  let overflow = false
  let output = Buffer.alloc(0)

  function inspect(bytes) {
    if (forbiddenBuffers.some((value) => bytes.includes(value))) detected = true
  }

  return {
    label,
    consume(chunk) {
      if (overflow) return
      const bytes = Buffer.from(chunk)
      const remaining = 1_048_576 - output.length
      output = Buffer.concat([output, bytes.subarray(0, Math.max(0, remaining))])
      if (bytes.length > remaining) overflow = true
      inspect(output)
    },
    inspect,
    registerForbidden(values) {
      const additions = values.filter(Boolean).map((value) => Buffer.from(value))
      forbiddenValues.push(...values.filter(Boolean))
      forbiddenBuffers = [...forbiddenBuffers, ...additions]
      inspect(output)
    },
    assertNoForbidden() {
      if (overflow) throw new Error(`${label} exceeded the bounded private-output observation limit`)
      if (detected) throw new Error(`${label} contained a forbidden private value`)
    },
    redactedDiagnostic() {
      if (overflow) return `${label} output omitted after bounded observation overflow`
      const redactionOverlap = Math.max(...forbiddenValues.map((value) => Buffer.byteLength(value)))
      let diagnostic = output.subarray(-(32_768 + redactionOverlap)).toString()
      for (const value of [...forbiddenValues].sort((left, right) => right.length - left.length)) {
        diagnostic = diagnostic.replaceAll(value, '[redacted]')
      }
      return diagnostic.slice(-32_768)
    }
  }
}

function capturedBrowserSecrets({ allowEmpty = false } = {}) {
  try {
    const secrets = []
    if (!existsSync(emailCaptureDirectory)) {
      if (allowEmpty) return secrets
      throw new Error()
    }
    const entries = readdirSync(emailCaptureDirectory, { withFileTypes: true })
    if (entries.length === 0) {
      if (allowEmpty) return secrets
      throw new Error()
    }
    if (entries.length > maxCaptureFiles) throw new Error()
    let observedBytes = 0
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) throw new Error()
      const path = join(emailCaptureDirectory, entry.name)
      const expectedSize = statSync(path).size
      observedBytes += expectedSize
      if (expectedSize > maxCaptureFileBytes || observedBytes > maxCaptureTotalBytes) throw new Error()
      const bytes = readFileSync(path)
      if (bytes.length !== expectedSize) throw new Error()
      const capture = JSON.parse(bytes.toString('utf8'))
      const recipient = capture?.message?.to
      const subject = capture?.message?.subject
      const text = capture?.message?.text
      const html = capture?.message?.html
      if (
        capture.version !== 1 ||
        capture.transport !== 'capture' ||
        typeof recipient !== 'string' ||
        typeof subject !== 'string' ||
        typeof text !== 'string' ||
        typeof html !== 'string'
      ) {
        throw new Error()
      }
      if (bearerEmailSubjects.has(subject)) {
        const matches = text.match(/https?:\/\/\S+/g)
        if (!matches || matches.length !== 1) throw new Error()
        const url = new URL(matches[0])
        const token = url.searchParams.get('token')
        if (!token) throw new Error()
        secrets.push(path, recipient, url.href, token)
      } else {
        throw new Error()
      }
    }
    return secrets
  } catch {
    throw new Error('Email capture registration failed closed')
  }
}

function rawServerOutputState() {
  const existingFiles = [rawServerStdout, rawServerStderr].filter((path) => existsSync(path))
  if (existingFiles.length === 0) return 'absent'
  if (existingFiles.length === 2) return 'present'
  throw new Error('Raw built-server stdout and stderr files must either both exist or both be absent')
}

function scanRawServerOutput(outputMonitor) {
  try {
    let observedBytes = 0
    for (const path of [rawServerStdout, rawServerStderr]) {
      const details = statSync(path)
      observedBytes += details.size
      if (!details.isFile() || (details.mode & 0o777) !== 0o600 || observedBytes > maxRawServerOutputBytes) {
        throw new Error()
      }
      const bytes = readFileSync(path)
      if (bytes.length !== details.size) throw new Error()
      outputMonitor.consume(bytes)
    }
  } catch {
    throw new Error('Raw built-server output secrecy scan failed closed')
  }
}

function scanArtifactTree(directory, outputMonitor) {
  try {
    const pending = [directory]
    let observedBytes = 0
    while (pending.length) {
      const current = pending.pop()
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const path = join(current, entry.name)
        outputMonitor.inspect(Buffer.from(path))
        if (entry.isDirectory()) pending.push(path)
        else if (entry.isFile()) {
          const expectedSize = statSync(path).size
          observedBytes += expectedSize
          if (observedBytes > 16_777_216) throw new Error()
          const bytes = readFileSync(path)
          if (bytes.length !== expectedSize) throw new Error()
          outputMonitor.inspect(bytes)
        } else throw new Error()
      }
    }
  } catch {
    throw new Error('Playwright artifact secrecy scan failed closed')
  }
}
