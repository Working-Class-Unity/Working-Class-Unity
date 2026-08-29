import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'

const entry = resolve('scripts/ci-container-build.mjs')
const canaryPath = resolve('.env.container-canary')

test('Docker context packages the Stripe membership operators', () => {
  const dockerignore = readFileSync(resolve('.dockerignore'), 'utf8')

  assert.match(dockerignore, /^!scripts\/sync-stripe-membership-links\.ts$/m)
  assert.match(dockerignore, /^!scripts\/adopt-stripe-membership-account\.ts$/m)
})

test('Docker build stage trusts public TLS certificates before Sentry upload', () => {
  const dockerfile = readFileSync(resolve('Dockerfile'), 'utf8')
  const buildStage = dockerfile.slice(
    dockerfile.indexOf('FROM node:24-bookworm-slim AS build'),
    dockerfile.indexOf('FROM node:24-bookworm-slim AS runtime')
  )
  const caBundleCopy = 'COPY --from=deps /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt'
  const caBundleCheck = 'RUN test -s /etc/ssl/certs/ca-certificates.crt'

  assert(buildStage.includes(caBundleCopy))
  assert(buildStage.includes(caBundleCheck))
  assert(buildStage.indexOf(caBundleCopy) < buildStage.indexOf(caBundleCheck))
  assert(buildStage.indexOf(caBundleCheck) < buildStage.indexOf('npm run pnpm -- run build'))
})

test('Docker build accepts every optional Coolify build secret without changing safe defaults', () => {
  const dockerfile = readFileSync(resolve('Dockerfile'), 'utf8')
  const buildInstruction = dockerfile
    .replaceAll(/\\\n\s*/g, ' ')
    .split('\n')
    .find((line) => line.startsWith('RUN ') && line.includes('npm run pnpm -- run build'))
  const secretNames = [
    'SENTRY_AUTH_TOKEN',
    'SENTRY_ORG',
    'SENTRY_PROJECT',
    'SENTRY_RELEASE',
    'SENTRY_URL',
    'SENTRY_UPLOAD_CACHE_BUST'
  ]

  assert(buildInstruction)
  assert.deepEqual(
    buildInstruction.match(/--mount=type=secret,[^\s]+/g),
    secretNames.map((name) => `--mount=type=secret,id=${name},env=BUILD_SECRET_${name},required=false`)
  )
  assert.deepEqual(dockerfile.match(/^ARG [A-Z_]+(?:=.*)?$/gm), [
    'ARG SENTRY_ORG',
    'ARG SENTRY_PROJECT',
    'ARG SENTRY_RELEASE',
    'ARG SENTRY_URL',
    'ARG SENTRY_UPLOAD_CACHE_BUST=disabled'
  ])
  assert.doesNotMatch(dockerfile, /^ARG SENTRY_AUTH_TOKEN(?:=|$)/m)
  assert.doesNotMatch(dockerfile, /^ENV SENTRY_AUTH_TOKEN(?:=|\s)/m)

  const bridgeCommand = buildInstruction
    .replace(/^RUN (?:--mount=type=secret,[^\s]+\s+)+/, '')
    .replace(/npm run pnpm -- run build$/, 'env -0')
  const runBridge = (env) => {
    const result = spawnSync('/bin/sh', ['-c', bridgeCommand], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        SENTRY_UPLOAD_CACHE_BUST: 'disabled',
        ...env
      }
    })
    assert.equal(result.status, 0, result.stderr)
    const observed = Object.fromEntries(
      result.stdout
        .split('\0')
        .filter(Boolean)
        .map((entry) => entry.split(/=(.*)/s, 2))
    )
    return Object.fromEntries(secretNames.map((name) => [name, observed[name]]))
  }
  const argValues = Object.fromEntries(secretNames.map((name) => [name, `arg-${name}`]))
  const secretValues = Object.fromEntries(secretNames.map((name) => [name, `secret-${name}`]))
  const emptyBuildSecrets = Object.fromEntries(secretNames.map((name) => [`BUILD_SECRET_${name}`, '']))
  const buildSecrets = Object.fromEntries(secretNames.map((name) => [`BUILD_SECRET_${name}`, secretValues[name]]))

  assert.deepEqual(
    runBridge({
      BUILD_SECRET_SENTRY_RELEASE: '',
      BUILD_SECRET_SENTRY_URL: '',
      SENTRY_AUTH_TOKEN: argValues.SENTRY_AUTH_TOKEN,
      SENTRY_RELEASE: '',
      SENTRY_URL: ''
    }),
    {
      SENTRY_AUTH_TOKEN: '',
      SENTRY_ORG: '',
      SENTRY_PROJECT: '',
      SENTRY_RELEASE: undefined,
      SENTRY_URL: undefined,
      SENTRY_UPLOAD_CACHE_BUST: 'disabled'
    }
  )
  assert.deepEqual(runBridge({ ...argValues, ...emptyBuildSecrets }), {
    ...argValues,
    SENTRY_AUTH_TOKEN: ''
  })
  assert.deepEqual(runBridge({ ...argValues, ...buildSecrets }), secretValues)
})

test('container build proof rejects unknown options before creating a canary or calling Docker', async () => {
  assert(!existsSync(canaryPath))
  const result = await runProcess(['--unknown'])
  assert.equal(result.code, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /Usage: node scripts\/ci-container-build\.mjs/)
  assert.doesNotMatch(result.stderr, /docker version|Docker context canary/)
  assert(!existsSync(canaryPath))
})

test('container build proof rejects malformed image names before creating a canary', async () => {
  const result = await runProcess(['--image', 'bad image'])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /Usage: node scripts\/ci-container-build\.mjs/)
  assert(!existsSync(canaryPath))
})

test('container build proof never deletes a pre-existing canary-path file', async (t) => {
  assert(!existsSync(canaryPath))
  writeFileSync(canaryPath, 'user-owned-local-file', { flag: 'wx' })
  t.after(() => rmSync(canaryPath, { force: true }))

  const result = await runProcess(['--image', 'swl-base-app:should-not-build'])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /Refusing to overwrite an existing Docker context canary path/)
  assert.equal(readFileSync(canaryPath, 'utf8'), 'user-owned-local-file')
})

function runProcess(args) {
  return new Promise((resolvePromise, reject) => {
    execFile(process.execPath, [entry, ...args], { timeout: 5_000 }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') {
        reject(error)
        return
      }
      resolvePromise({ code: error?.code ?? 0, stderr, stdout })
    })
  })
}
