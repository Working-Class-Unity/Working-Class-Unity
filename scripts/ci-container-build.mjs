import { execFile, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const image = parseImageArgument(process.argv.slice(2))
const root = resolve('.')
const canaryDirectory = resolve('server', `.container-canary-${randomBytes(5).toString('hex')}`)
const canaryPaths = [
  resolve('.env.container-canary'),
  resolve('server/.env.container-canary'),
  ...[
    'private.db',
    'private.sqlite',
    'private-journal',
    'private.key',
    'private.pem',
    'backups/private-state',
    'data/private-state'
  ].map((path) => join(canaryDirectory, path))
]
const buildStageCanaryPaths = canaryPaths.map((path) => `/app/${relative(root, path).split(sep).join('/')}`)
const canary = `swl_context_${randomBytes(32).toString('base64url')}`
const sentryAuthTokenCanary = `sntrys_test_${randomBytes(32).toString('base64url')}`
const sentryUploadCacheBust = `r028c-${randomBytes(12).toString('hex')}`
const contextImage = `swl-context-proof:${process.pid}-${randomBytes(5).toString('hex')}`
const createdCanaries = []
let canaryDirectoryCreated = false
let contextBuildAttempted = false
let cleanupStarted = false

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(signal, () => {
    cleanup()
    process.exit(signal === 'SIGINT' ? 130 : 143)
  })
}

try {
  await run()
} catch (error) {
  console.error(`Container build proof failed: ${redact(error instanceof Error ? error.message : String(error))}`)
  process.exitCode = 1
} finally {
  cleanup()
}

async function run() {
  if (canaryPaths.some((path) => existsSync(path))) {
    throw new Error('Refusing to overwrite an existing Docker context canary path; no file was changed.')
  }

  mkdirSync(canaryDirectory)
  canaryDirectoryCreated = true
  for (const path of canaryPaths) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `NUXT_BETTER_AUTH_SECRET=${canary}\n`, { mode: 0o600, flag: 'wx' })
    createdCanaries.push(path)
  }
  await docker(['version', '--format', '{{.Server.Version}}'], 10_000)
  const buildEnvironment = { ...process.env, SWL_TEST_SENTRY_AUTH_TOKEN: sentryAuthTokenCanary }
  const secretArguments = ['--secret', 'id=SENTRY_AUTH_TOKEN,env=SWL_TEST_SENTRY_AUTH_TOKEN']
  contextBuildAttempted = true
  await docker(
    ['build', '--target', 'build', '--tag', contextImage, ...secretArguments, '.'],
    600_000,
    buildEnvironment
  )
  await docker(
    [
      'run',
      '--rm',
      '--entrypoint',
      'node',
      contextImage,
      '-e',
      `const{existsSync}=require('node:fs');const paths=${JSON.stringify(buildStageCanaryPaths)};process.exit(paths.some((path)=>existsSync(path))?1:0)`
    ],
    10_000
  )
  await assertConfiguredUploadFailure(secretArguments, buildEnvironment)
  await docker(['build', '--tag', image, ...secretArguments, '.'], 600_000, buildEnvironment)

  const inspect = await docker(['image', 'inspect', '--format', '{{json .Config}}', image], 10_000)
  const config = JSON.parse(inspect.stdout)
  assert(config?.User === 'node:node', 'Production image must default to the node:node user')
  assert(!inspect.stdout.includes(canary), 'Production image configuration retained the context canary')

  const history = await docker(['image', 'history', '--no-trunc', '--format', '{{json .}}', image], 10_000)
  assert(!history.stdout.includes(canary), 'Production image history retained the context canary')
  assert(!inspect.stdout.includes(sentryAuthTokenCanary), 'Production image configuration retained the Sentry token')
  assert(!history.stdout.includes(sentryAuthTokenCanary), 'Production image history retained the Sentry token')

  await docker(
    [
      'run',
      '--rm',
      '--env',
      'SWL_TEST_SENTRY_AUTH_TOKEN',
      '--entrypoint',
      'node',
      image,
      '-e',
      "const{readFileSync,readdirSync}=require('node:fs');const{join}=require('node:path');const token=process.env.SWL_TEST_SENTRY_AUTH_TOKEN;let maps=0,leaks=0,references=0;const walk=(directory)=>{for(const entry of readdirSync(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory())walk(path);else{const contents=readFileSync(path);if(entry.name.endsWith('.map'))maps++;if(contents.includes(token))leaks++;if(path.includes('/.output/public/')&&/\.(?:m?js)$/.test(entry.name)&&contents.includes('sourceMappingURL='))references++;}}};walk('/app');process.exit(maps?2:leaks?3:references?4:0)"
    ],
    20_000,
    buildEnvironment
  )

  console.log(
    'Container build proof passed: configured Sentry upload failures stop the build, BuildKit keeps the token out of diagnostics and the runtime image, deployable output contains no source maps, the build context excludes private state, and the image defaults to node:node.'
  )
}

async function assertConfiguredUploadFailure(secretArguments, buildEnvironment) {
  const args = [
    'build',
    '--target',
    'build',
    '--build-arg',
    'NUXT_MODULES_OBSERVABILITY_ENABLED=true',
    '--build-arg',
    'SENTRY_ORG=local-proof',
    '--build-arg',
    'SENTRY_PROJECT=local-proof',
    '--build-arg',
    'SENTRY_URL=http://127.0.0.1:1',
    '--build-arg',
    `SENTRY_UPLOAD_CACHE_BUST=${sentryUploadCacheBust}`,
    ...secretArguments,
    '.'
  ]

  try {
    await execFileAsync('docker', args, {
      encoding: 'utf8',
      env: buildEnvironment,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 600_000
    })
  } catch (error) {
    if (typeof error?.code !== 'number') throw error
    const output = `${error.stdout || ''}${error.stderr || ''}`
    assert(!output.includes(sentryAuthTokenCanary), 'Configured upload failure diagnostics exposed the Sentry token')
    assert(
      output.includes('[plugin sentry-vite-plugin]') && output.includes('sourcemaps upload'),
      'Configured build failed outside the official Sentry source-map upload boundary'
    )
    return
  }

  throw new Error('Configured Sentry upload unexpectedly allowed the production build to succeed')
}

async function docker(args, timeout, environment = process.env) {
  try {
    return await execFileAsync('docker', args, {
      encoding: 'utf8',
      env: environment,
      maxBuffer: 32 * 1024 * 1024,
      timeout
    })
  } catch (error) {
    const stderr = redact(error?.stderr || '')
    const stdout = redact(error?.stdout || '')
    throw new Error(`docker ${args[0]} failed${stderr ? `: ${stderr.trim()}` : stdout ? `: ${stdout.trim()}` : ''}`, {
      cause: error
    })
  }
}

function cleanup() {
  if (cleanupStarted) return
  cleanupStarted = true
  for (const path of createdCanaries) rmSync(path, { force: true })
  if (canaryDirectoryCreated) rmSync(canaryDirectory, { force: true, recursive: true })
  if (contextBuildAttempted) {
    spawnSync('docker', ['image', 'rm', '--force', contextImage], {
      encoding: 'utf8',
      stdio: 'ignore',
      timeout: 10_000
    })
  }
}

function redact(value) {
  return String(value).replaceAll(canary, '[redacted]').replaceAll(sentryAuthTokenCanary, '[redacted]')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function parseImageArgument(args) {
  const candidate =
    args.length === 0
      ? process.env.CONTAINER_HEALTH_IMAGE || 'swl-base-app:ci'
      : args.length === 2 && args[0] === '--image'
        ? args[1]
        : ''
  if (candidate && candidate.trim() === candidate && !candidate.startsWith('-') && !/\s/.test(candidate)) {
    return candidate
  }
  throw new Error('Usage: node scripts/ci-container-build.mjs [--image <local-image-tag>]')
}
