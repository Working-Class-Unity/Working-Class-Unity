import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  findAnchor,
  reservePort,
  selectEnvironment,
  stopChild,
  waitForServer,
  withAbortTimeout
} from './framework-security-helpers.mjs'

const root = process.cwd()
const appRoot = resolve(root)
const require = createRequire(import.meta.url)
const appManifest = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
const frameworkVersions = Object.fromEntries(
  ['nuxt', 'vue', 'vue-router'].map((name) => [name, appManifest.dependencies?.[name]])
)
const resolvedFramework = Object.fromEntries(
  Object.keys(frameworkVersions).map((name) => {
    const path = require.resolve(`${name}/package.json`, { paths: [appRoot] })
    return [name, { path, manifest: JSON.parse(readFileSync(path, 'utf8')) }]
  })
)
const nuxtPackagePath = resolvedFramework.nuxt.path
const nuxtPackage = resolvedFramework.nuxt.manifest
const nuxtEntry = resolve(dirname(nuxtPackagePath), nuxtPackage.bin.nuxt)
const nuxtNodeModules = dirname(dirname(nuxtPackagePath))
const sandbox = mkdtempSync(join(tmpdir(), 'swl-framework-security-'))
const appDirectory = join(sandbox, 'app')
const middlewareDirectory = join(appDirectory, 'middleware')
const pagesDirectory = join(appDirectory, 'pages')
const port = await reservePort()
const baseUrl = `http://127.0.0.1:${port}`
const requestTimeoutMs = 10_000
const externalRedirectPayload = 'https://evil.example/x><img src=x onerror=alert(document.domain)>'
const encodedExternalRedirect = 'https://evil.example/x%3E%3Cimg%20src=x%20onerror=alert(document.domain)%3E'
const checks = []
let child
let serverOutput = ''
let cleanupPromise
let terminatingSignal
const signalHandlers = new Map(['SIGINT', 'SIGTERM'].map((signal) => [signal, () => void terminateFromSignal(signal)]))

for (const [signal, handler] of signalHandlers) {
  process.once(signal, handler)
}

try {
  for (const [name, expectedVersion] of Object.entries(frameworkVersions)) {
    check(
      typeof expectedVersion === 'string' && resolvedFramework[name].manifest.version === expectedVersion,
      `installed ${name} matches the exact app manifest pin`,
      'compatibility'
    )
  }

  writeFixture()

  child = spawn(process.execPath, [nuxtEntry, 'dev', sandbox, '--host', '127.0.0.1', '--port', String(port)], {
    cwd: root,
    env: {
      ...selectEnvironment(process.env, [
        'CI',
        'COLORTERM',
        'FORCE_COLOR',
        'HOME',
        'LANG',
        'LC_ALL',
        'LOGNAME',
        'NO_COLOR',
        'PATH',
        'TEMP',
        'TERM',
        'TMP',
        'TMPDIR',
        'TZ',
        'USER'
      ]),
      CI: 'true',
      NODE_ENV: 'development',
      NUXT_TELEMETRY_DISABLED: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  capture(child.stdout)
  capture(child.stderr)

  await waitForServer(child, `${baseUrl}/case-probe`, 45_000)

  const lowerCase = await request('/case-probe')
  const lowerCaseHtml = lowerCase.body
  check(lowerCase.status === 200, 'lower-case fixture route renders')
  check(lowerCase.headers.get('x-framework-case-rule') === 'matched', 'route rule applies to its canonical case')

  const upperCase = await request('/CASE-PROBE')
  const upperCaseHtml = upperCase.body
  check(upperCase.status === 200, 'Vue Router resolves a case-variant route')
  check(
    upperCase.headers.get('x-framework-case-rule') === 'matched',
    'Nuxt route rules match the same case variant as Vue Router'
  )

  const unsafeAnchor = findAnchor(upperCaseHtml, 'unsafe-link')
  check(Boolean(unsafeAnchor), 'unsafe-link fixture renders an anchor')
  check(
    !/\shref\s*=/i.test(unsafeAnchor ?? '') && !/javascript:/i.test(unsafeAnchor ?? ''),
    'NuxtLink removes a script-capable href'
  )

  const safeAnchor = findAnchor(lowerCaseHtml, 'safe-link')
  check(Boolean(safeAnchor), 'safe-link fixture renders an anchor')
  check(/\shref="\/safe"/i.test(safeAnchor ?? ''), 'NuxtLink preserves an ordinary same-origin href')

  const externalRedirect = await request('/redirect-external-encoded')
  check(externalRedirect.status === 307, 'external redirect fixture returns its requested status')
  check(
    externalRedirect.headers.get('location') === encodedExternalRedirect,
    'external redirect Location percent-encodes the injected markup delimiters'
  )
  check(
    externalRedirect.body.includes(`url=${encodedExternalRedirect}`) && !/<img\b/i.test(externalRedirect.body),
    'external redirect meta-refresh body cannot materialize the injected element'
  )

  const normalizedRedirect = await request('/redirect-normalized')
  check(normalizedRedirect.status === 307, 'path-normalization fixture returns its requested status')
  check(
    normalizedRedirect.headers.get('location') === '/evil.example',
    'navigateTo normalizes the crafted path to a same-origin Location'
  )
  check(
    normalizedRedirect.body.includes('url=/evil.example') && !normalizedRedirect.body.includes('url=//evil.example'),
    'navigateTo normalizes the crafted meta-refresh target to a same-origin path'
  )

  const safeRedirect = await request('/redirect-safe')
  check(
    safeRedirect.status === 307 && safeRedirect.headers.get('location') === '/safe',
    'navigateTo preserves an ordinary same-origin redirect'
  )

  const unmatched = await request('/not-a-route')
  check(
    unmatched.headers.get('x-framework-case-rule') === null,
    'the case-insensitive rule does not broaden to an unrelated route'
  )

  const compatibilityCount = checks.filter((entry) => entry.kind === 'compatibility').length
  const behaviorCount = checks.length - compatibilityCount
  console.log(
    `Framework security smoke passed: ${checks.length} checks (${compatibilityCount} compatibility, ${behaviorCount} behavioral) on Nuxt ${nuxtPackage.version}.`
  )
} catch (error) {
  if (serverOutput.trim()) {
    console.error('Nuxt fixture output:')
    console.error(serverOutput.trim())
  }
  throw error
} finally {
  await cleanup()
  removeSignalHandlers()
}

function writeFixture() {
  mkdirSync(middlewareDirectory, { recursive: true })
  mkdirSync(pagesDirectory, { recursive: true })
  symlinkSync(nuxtNodeModules, join(sandbox, 'node_modules'), 'dir')
  writeFileSync(
    join(sandbox, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        type: 'module',
        dependencies: frameworkVersions
      },
      null,
      2
    )}\n`
  )
  writeFileSync(
    join(sandbox, 'nuxt.config.ts'),
    `export default defineNuxtConfig({
  devtools: { enabled: false },
  routeRules: {
    '/case-probe': { appMiddleware: ['case-rule'] }
  }
})
`
  )
  writeFileSync(join(appDirectory, 'app.vue'), '<template><NuxtPage /></template>\n')
  writeFileSync(
    join(middlewareDirectory, 'case-rule.ts'),
    `export default defineNuxtRouteMiddleware(() => {
  if (import.meta.server) {
    useResponseHeader('x-framework-case-rule').value = 'matched'
  }
})
`
  )
  writeFileSync(
    join(pagesDirectory, 'case-probe.vue'),
    `<template>
  <main>
    <NuxtLink id="unsafe-link" to="javascript:alert(1)">Unsafe link</NuxtLink>
    <NuxtLink id="safe-link" to="/safe">Safe link</NuxtLink>
  </main>
</template>
`
  )
  writeFileSync(join(pagesDirectory, 'safe.vue'), '<template><main>Safe destination</main></template>\n')
  writeFileSync(
    join(pagesDirectory, 'redirect-safe.vue'),
    `<script setup>
await navigateTo('/safe', { redirectCode: 307 })
</script>

<template><main>Redirecting safely</main></template>
`
  )
  writeFileSync(
    join(pagesDirectory, 'redirect-external-encoded.vue'),
    `<script setup>
await navigateTo(${JSON.stringify(externalRedirectPayload)}, { external: true, redirectCode: 307 })
</script>

<template><main>External redirect</main></template>
`
  )
  writeFileSync(
    join(pagesDirectory, 'redirect-normalized.vue'),
    `<script setup>
await navigateTo('/..//evil.example', { redirectCode: 307 })
</script>

<template><main>Normalized redirect</main></template>
`
  )
}

function capture(stream) {
  stream?.on('data', (chunk) => {
    const text = chunk.toString()
    serverOutput = `${serverOutput}${text}`.slice(-16_384)
  })
}

async function request(path) {
  const url = new URL(path, baseUrl)
  return withAbortTimeout(
    async (signal) => {
      const response = await fetch(url, {
        headers: { accept: 'text/html' },
        redirect: 'manual',
        signal
      })
      return {
        body: await response.text(),
        headers: response.headers,
        status: response.status
      }
    },
    requestTimeoutMs,
    `Framework security request to ${url}`
  )
}

function check(condition, name, kind = 'behavior') {
  if (!condition) {
    throw new Error(`Framework security smoke failed: ${name}`)
  }
  checks.push({ name, kind })
  console.log(`ok - ${name}`)
}

function cleanup() {
  cleanupPromise ??= (async () => {
    await stopChild(child)
    rmSync(sandbox, { recursive: true, force: true })
  })()

  return cleanupPromise
}

async function terminateFromSignal(signal) {
  if (terminatingSignal) {
    return
  }

  terminatingSignal = signal

  try {
    await cleanup()
  } catch (error) {
    console.error(`Cleanup failed while handling ${signal}:`)
    console.error(error)
  } finally {
    removeSignalHandlers()
    process.kill(process.pid, signal)
  }
}

function removeSignalHandlers() {
  for (const [signal, handler] of signalHandlers) {
    process.removeListener(signal, handler)
  }
}
