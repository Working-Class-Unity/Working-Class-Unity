import { defineConfig } from '@playwright/test'

const baseURL = process.env.BROWSER_BASE_URL
if (!baseURL) {
  throw new Error('BROWSER_BASE_URL is required; run the suite through npm run test:browser')
}
const runtimeCwd = requiredEnvironment('BROWSER_RUNTIME_CWD')
const serverEntry = requiredEnvironment('BROWSER_SERVER_ENTRY')
const serverPreload = requiredEnvironment('BROWSER_SERVER_PRELOAD')
const serverStderrPath = requiredEnvironment('BROWSER_SERVER_STDERR_PATH')
const serverStdoutPath = requiredEnvironment('BROWSER_SERVER_STDOUT_PATH')

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.pw.mjs',
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR,
  globalTimeout: 120_000,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 20_000,
  expect: {
    timeout: 5_000
  },
  reporter: [['line'], ['./scripts/playwright-foundation-reporter.mjs']],
  webServer: {
    command:
      'umask 077; exec "$BROWSER_NODE_EXECUTABLE" --import "$BROWSER_SERVER_PRELOAD" "$BROWSER_SERVER_ENTRY" >"$BROWSER_SERVER_STDOUT_PATH" 2>"$BROWSER_SERVER_STDERR_PATH"',
    cwd: runtimeCwd,
    env: {
      BROWSER_NODE_EXECUTABLE: process.execPath,
      BROWSER_SERVER_ENTRY: serverEntry,
      BROWSER_SERVER_PRELOAD: serverPreload,
      BROWSER_SERVER_STDERR_PATH: serverStderrPath,
      BROWSER_SERVER_STDOUT_PATH: serverStdoutPath
    },
    gracefulShutdown: {
      signal: 'SIGTERM',
      timeout: 5_000
    },
    reuseExistingServer: false,
    stderr: 'pipe',
    stdout: 'pipe',
    timeout: 45_000,
    url: `${baseURL}/api/live`
  },
  use: {
    baseURL,
    actionTimeout: 5_000,
    headless: true,
    navigationTimeout: 10_000,
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off'
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 900 }
      }
    },
    {
      name: 'mobile-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 }
      }
    }
  ]
})

function requiredEnvironment(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required; run the suite through npm run test:browser`)
  }
  return value
}
