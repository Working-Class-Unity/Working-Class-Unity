import assert from 'node:assert/strict'
import { test } from 'node:test'
import FoundationCompletionReporter, { resultRejection } from './playwright-foundation-reporter.mjs'

test('completion reporter accepts a nonempty run of expected passes', () => {
  const reporter = beginReporter(2)
  recordResult(reporter, passingResult('first'))
  recordResult(reporter, passingResult('second'))
  assert.equal(endQuietly(reporter, 'passed'), undefined)
})

test('completion reporter rejects an empty run', () => {
  assert.deepEqual(endQuietly(beginReporter(0), 'passed'), { status: 'failed' })
})

test('completion reporter rejects skip, fixme, expected-failure, and nonpassing results', () => {
  for (const result of [
    { expectedStatus: 'skipped', outcome: 'skipped', status: 'skipped', title: 'skip' },
    { expectedStatus: 'skipped', outcome: 'skipped', status: 'skipped', title: 'fixme' },
    { expectedStatus: 'failed', outcome: 'expected', status: 'failed', title: 'expected failure' },
    { expectedStatus: 'passed', outcome: 'unexpected', status: 'failed', title: 'failure' },
    { expectedStatus: 'passed', outcome: 'unexpected', status: 'interrupted', title: 'interruption' }
  ]) {
    assert.match(resultRejection(result), new RegExp(result.title))
    const reporter = beginReporter(1)
    recordResult(reporter, result)
    assert.deepEqual(endQuietly(reporter, 'passed'), { status: 'failed' })
  }
})

test('completion reporter rejects a nonpassing full run', () => {
  const reporter = beginReporter(1)
  recordResult(reporter, passingResult('pass'))
  assert.deepEqual(endQuietly(reporter, 'interrupted'), { status: 'failed' })
})

test('actual Playwright config retains completion wiring and required viewports', async () => {
  const environment = {
    BROWSER_BASE_URL: 'http://127.0.0.1:3000',
    BROWSER_RUNTIME_CWD: process.cwd(),
    BROWSER_SERVER_ENTRY: '/tmp/browser-server-entry.mjs',
    BROWSER_SERVER_PRELOAD: '/tmp/browser-server-preload.mjs',
    BROWSER_SERVER_STDERR_PATH: '/tmp/browser-server-stderr.log',
    BROWSER_SERVER_STDOUT_PATH: '/tmp/browser-server-stdout.log',
    BROWSER_TURNSTILE_PROVIDER_PRELOAD: '/tmp/browser-turnstile-provider-preload.mjs'
  }
  const previous = Object.fromEntries(Object.keys(environment).map((name) => [name, process.env[name]]))
  Object.assign(process.env, environment)

  try {
    const { default: config } = await import('../playwright.config.mjs')
    assert.equal(config.forbidOnly, true)
    assert(
      config.reporter.some(
        (reporter) => Array.isArray(reporter) && reporter[0] === './scripts/playwright-foundation-reporter.mjs'
      )
    )
    assertRequiredChromiumViewport(config, 1280, 900)
    assertRequiredChromiumViewport(config, 390, 844)
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

function beginReporter(discoveredCount) {
  const reporter = new FoundationCompletionReporter()
  reporter.onBegin({}, { allTests: () => Array.from({ length: discoveredCount }, () => ({})) })
  return reporter
}

function passingResult(title) {
  return { expectedStatus: 'passed', outcome: 'expected', status: 'passed', title }
}

function recordResult(reporter, result) {
  reporter.onTestEnd(
    {
      expectedStatus: result.expectedStatus,
      outcome: () => result.outcome,
      titlePath: () => ['foundation', result.title]
    },
    { status: result.status }
  )
}

function assertRequiredChromiumViewport(config, width, height) {
  assert(
    config.projects.some((project) => {
      const use = { ...config.use, ...project.use }
      const browserName = use.browserName ?? use.defaultBrowserType
      return browserName === 'chromium' && use.viewport?.width === width && use.viewport?.height === height
    }),
    `missing required Chromium viewport ${width}x${height}`
  )
}

function endQuietly(reporter, status) {
  const originalError = console.error
  const originalLog = console.log
  console.error = () => {}
  console.log = () => {}
  try {
    return reporter.onEnd({ status })
  } finally {
    console.error = originalError
    console.log = originalLog
  }
}
