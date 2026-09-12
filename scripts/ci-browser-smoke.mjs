import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createOutputMonitor, reportBrowserDiagnostics, scanArtifactTree } from './ci-browser-diagnostics.mjs'
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
const playwrightOutput = join(sandbox, 'playwright-output')
const rawServerStdout = join(sandbox, 'server-stdout.log')
const rawServerStderr = join(sandbox, 'server-stderr.log')
const serverEntry = resolve(root, '.output/server/index.mjs')
const serverPreload = resolve(root, '.output/server/sentry.server.config.mjs')
const browserPort = await reservePort()
const buildName = 'Build Sentinel - Must Not Render'
const buildUrl = 'https://build-sentinel.invalid'
const runtimeName = 'Runtime Browser Baseline'
const buildSentryRelease = 'build-sentry-release-must-not-render'
const runtimeSentryRelease = 'runtime-sentry-release'
const buildReadinessCanary = 'ci-only-build-readiness-canary-must-not-render'
const runtimeReadinessToken = 'ci-only-runtime-readiness-token-32-bytes-minimum'
const maxRawServerOutputBytes = 1_048_576
const activeChildren = new Set()
const childClosePromises = new WeakMap()
const forbiddenValues = [buildReadinessCanary, runtimeReadinessToken, databasePath]
const playwrightOutputMonitor = createOutputMonitor('Playwright', forbiddenValues)
const rawServerOutputMonitor = createOutputMonitor('raw built browser server', forbiddenValues)
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

    if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--skip-build')) {
      throw new Error('Usage: node scripts/ci-browser-smoke.mjs [--skip-build]')
    }
    if (!process.argv.includes('--skip-build')) {
      await runPhase('production build', 'pnpm', ['run', 'build'], buildEnv, 180_000)
    }
    if (!existsSync(serverEntry)) {
      throw new Error(`Production server entry was not built: ${serverEntry}`)
    }
    if (!existsSync(serverPreload)) {
      throw new Error(`Production Sentry preload was not built: ${serverPreload}`)
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
      port: browserPort
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
      BROWSER_RUNTIME_DATABASE_PATH: databasePath,
      BROWSER_RUNTIME_READINESS_TOKEN: runtimeReadinessToken,
      BROWSER_RUNTIME_SENTRY_ORIGIN: 'https://sentry.browser.invalid',
      BROWSER_RUNTIME_SENTRY_RELEASE: runtimeSentryRelease,
      BROWSER_RUNTIME_CWD: runtimeCwd,
      BROWSER_SERVER_ENTRY: serverEntry,
      BROWSER_SERVER_PRELOAD: serverPreload,
      BROWSER_SERVER_STDERR_PATH: rawServerStderr,
      BROWSER_SERVER_STDOUT_PATH: rawServerStdout,
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
    reportBrowserDiagnostics([playwrightOutputMonitor, rawServerOutputMonitor], browserDiagnosticsSafe)
    throw error
  }
})

function applicationEnvironment({ appName, appUrl, databasePath: selectedDatabasePath, port: selectedPort }) {
  return {
    ...databaseEnvironment(selectedDatabasePath),
    NITRO_PRESET: 'node-server',
    NITRO_HOST: '127.0.0.1',
    NITRO_PORT: String(selectedPort),
    NUXT_PUBLIC_APP_NAME: appName,
    NUXT_PUBLIC_APP_URL: appUrl,
    NUXT_READINESS_TOKEN: runtimeReadinessToken,
    NUXT_SENTRY_DSN: 'http://public@127.0.0.1:9/1',
    NUXT_PUBLIC_SENTRY_DSN: 'https://public@sentry.browser.invalid/1',
    NUXT_SENTRY_TRACES_SAMPLE_RATE: '0',
    NUXT_PUBLIC_SENTRY_ENVIRONMENT: 'runtime-browser',
    NUXT_PUBLIC_SENTRY_RELEASE: runtimeSentryRelease,
    NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: '0.125'
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
