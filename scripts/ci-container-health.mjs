import { execFile, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const migrationCount = JSON.parse(
  readFileSync(new URL('../server/db/migrations/meta/_journal.json', import.meta.url), 'utf8')
).entries.length
const image = parseImageArgument(process.argv.slice(2))
const deadline = Date.now() + 180_000
const containerName = `swl-container-health-${process.pid}-${randomBytes(5).toString('hex')}`
const volumeName = `swl-container-data-${process.pid}-${randomBytes(5).toString('hex')}`
const readinessToken = `ci_${randomBytes(32).toString('base64url')}`
const authSecret = randomBytes(32).toString('base64url')
const persistenceKey = `container-persistence-${randomBytes(8).toString('hex')}`
const persistenceValue = `persisted-${randomBytes(8).toString('hex')}`
const mutatedValue = `mutated-${randomBytes(8).toString('hex')}`
const objectValue = `object-${randomBytes(8).toString('hex')}`
const knownGoodBackup = '/app/data/backups/container-known-good.db'
const corruptBackup = '/app/data/backups/container-corrupt.db'
const applicationEnvironment = {
  CI: 'true',
  NUXT_DATABASE_URL: 'file:/app/data/app.db',
  NUXT_READINESS_TOKEN: readinessToken,
  NUXT_BETTER_AUTH_SECRET: authSecret,
  NUXT_BETTER_AUTH_URL: 'http://127.0.0.1:3000',
  NUXT_EMAIL_TRANSPORT: 'resend',
  NUXT_EMAIL_FROM: 'baseline@example.test',
  NUXT_EMAIL_RESEND_API_KEY: 're_container_health_not_a_provider_credential',
  NUXT_TWILIO_VERIFY_API_KEY_SID: 'SK44444444444444444444444444444444',
  NUXT_TWILIO_VERIFY_API_KEY_SECRET: 'container-twilio-secret-not-a-credential',
  NUXT_TWILIO_VERIFY_SERVICE_SID: 'VA44444444444444444444444444444444',
  NUXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
  NUXT_STRIPE_SECRET_KEY: 'rk_test_container_health_not_a_provider_credential',
  NUXT_STRIPE_WEBHOOK_SECRET: 'whsec_container_health_not_a_provider_credential',
  NUXT_STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_container_health',
  NUXT_STRIPE_MEMBERSHIP_DUES10_PRICE_ID: 'price_container_personal_monthly',
  NUXT_STRIPE_SOLIDARITY_DUES27_PRICE_ID: 'price_container_family_monthly',
  NUXT_STRIPE_LEGACY_DUES10_PRICE_IDS: 'membership-10-1month',
  NUXT_STRIPE_LEGACY_DUES27_PRICE_IDS: 'solidarity-27-1month',
  NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY: 'container-turnstile-secret-not-a-provider-credential',
  NUXT_PUBLIC_TURNSTILE_SITE_KEY: 'container-turnstile-site-not-a-provider-credential',
  NUXT_SENTRY_DSN: '',
  NUXT_PUBLIC_SENTRY_DSN: '',
  NUXT_SENTRY_TRACES_SAMPLE_RATE: '0',
  NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: '0'
}
const maintenanceEnvironment = {
  NUXT_DATABASE_URL: applicationEnvironment.NUXT_DATABASE_URL
}
const dockerEnvironment = { ...process.env, ...applicationEnvironment }
let cleanupStarted = false

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(signal, () => {
    cleanupSync()
    process.exit(signal === 'SIGINT' ? 130 : 143)
  })
}

try {
  await run()
} catch (error) {
  await reportFailure(error)
  process.exitCode = 1
} finally {
  cleanupSync()
}

async function run() {
  await docker(['version', '--format', '{{.Server.Version}}'], {
    label: 'Docker availability',
    timeout: 10_000
  })
  await docker(['volume', 'create', volumeName], { label: 'named volume creation', timeout: 10_000 })

  await runMaintenanceFailure(['verify'], {
    environment: { NUXT_DATABASE_URL: '' },
    label: 'missing maintenance configuration'
  })
  await runMaintenanceFailure(['migrate'], {
    label: 'migration without stopped-app confirmation'
  })
  await runMaintenanceFailure(['migrate', '--confirm-app-stopped'], {
    label: 'read-only migration',
    readOnly: true
  })
  const freshMigration = await runMaintenance(['migrate', '--confirm-app-stopped'], 'fresh named-volume migration')
  assert(
    freshMigration.stdout.includes(
      `${migrationCount} newly applied; ${migrationCount}/${migrationCount} current; pre-migration backup not required`
    ),
    'Fresh migration did not report the exact current package and no-backup boundary'
  )
  const repeatMigration = await runMaintenance(['migrate', '--confirm-app-stopped'], 'repeat named-volume migration')
  assert(
    repeatMigration.stdout.includes(
      `0 newly applied; ${migrationCount}/${migrationCount} current; pre-migration backup written as`
    ),
    'Repeat migration did not report the exact current package and verified pre-migration backup'
  )
  await runOffHostFailure(['backup'], {
    label: 'credential-free off-host backup operator'
  })

  await startApplicationContainer()
  let baseUrl = await resolvePublishedBaseUrl()
  await waitForContainerHealth('healthy', 45_000)
  await assertLiveness(baseUrl, 'before container replacement')
  await assertReadiness(baseUrl, 200, { status: 'ready' })
  await assertNonRootVolumeRuntime()
  await writePersistentState()

  const backup = await runMaintenance(
    ['backup', '--output', knownGoodBackup],
    'online backup while the application is running'
  )
  assert(backup.stdout.includes('integrity ok; foreign keys ok'), 'Online backup did not report both checks')
  await mutatePersistentDatabase()
  await writeCorruptBackup()
  await runMaintenanceFailure(['restore', '--input', knownGoodBackup], {
    label: 'restore without stopped-app confirmation'
  })

  await removeApplicationContainer()
  await runMaintenanceFailure(['restore', '--input', corruptBackup, '--confirm-app-stopped'], {
    label: 'corrupt restore'
  })
  await assertDatabaseValue(mutatedValue, 'after rejected corrupt restore')

  const restore = await runMaintenance(
    ['restore', '--input', knownGoodBackup, '--confirm-app-stopped'],
    'verified stopped-app restore'
  )
  assert(restore.stdout.includes('restored and migrated'), 'Valid restore did not report migration completion')
  await runMaintenance(['verify'], 'restored database verification')

  await startApplicationContainer()
  baseUrl = await resolvePublishedBaseUrl()
  await waitForContainerHealth('healthy', 45_000)
  await assertLiveness(baseUrl, 'after container replacement')
  await assertReadiness(baseUrl, 200, { status: 'ready' })
  await assertNonRootVolumeRuntime()
  await assertPersistentState()

  await docker(
    [
      'exec',
      containerName,
      'node',
      '-e',
      "const{mkdirSync,renameSync}=require('node:fs');renameSync('/app/data/app.db','/app/data/app.db.failed');mkdirSync('/app/data/app.db')"
    ],
    { label: 'database failure injection', timeout: 10_000 }
  )

  await assertReadiness(baseUrl, 503, { status: 'not_ready', code: 'SERVICE_NOT_READY' })
  await assertLiveness(baseUrl, 'after dependency failure')
  await waitForContainerHealth('unhealthy', 30_000)
  await assertLiveness(baseUrl, 'after Docker marked the replacement container unhealthy')
  await assertDockerFailureState()

  console.log(
    'Container maintenance smoke passed: 5 successful maintenance jobs, 6 fail-closed cases, 2 non-root container generations, packaged credential-free off-host operator, persistent database/object state, and the healthy-to-unhealthy readiness transition.'
  )
}

async function startApplicationContainer() {
  const environmentArguments = Object.keys(applicationEnvironment).flatMap((key) => ['--env', key])
  await docker(
    [
      'run',
      '--detach',
      '--name',
      containerName,
      '--publish',
      '127.0.0.1::3000',
      '--mount',
      volumeMount(),
      '--health-interval',
      '1s',
      '--health-timeout',
      '4s',
      '--health-start-period',
      '5s',
      '--health-retries',
      '2',
      ...environmentArguments,
      image
    ],
    { env: dockerEnvironment, label: 'container start', timeout: 20_000 }
  )
}

async function removeApplicationContainer() {
  await docker(['rm', '--force', containerName], { label: 'container replacement removal', timeout: 10_000 })
}

async function runMaintenance(args, label) {
  const environmentArguments = Object.keys(maintenanceEnvironment).flatMap((key) => ['--env', key])
  const result = await docker(
    [
      'run',
      '--rm',
      '--network',
      'none',
      '--no-healthcheck',
      '--mount',
      volumeMount(),
      ...environmentArguments,
      image,
      'node',
      '.output/server/maintenance.mjs',
      ...args
    ],
    { env: { ...process.env, ...maintenanceEnvironment }, label, timeout: 30_000 }
  )
  assert(result.stderr === '', `${label} emitted stderr`)
  return result
}

async function runMaintenanceFailure(args, { environment = maintenanceEnvironment, label, readOnly = false }) {
  const environmentArguments = Object.keys(environment).flatMap((key) => ['--env', key])
  const mount = readOnly ? `${volumeMount()},readonly` : volumeMount()
  const command = [
    'run',
    '--rm',
    '--network',
    'none',
    '--no-healthcheck',
    '--mount',
    mount,
    ...environmentArguments,
    image,
    'node',
    '.output/server/maintenance.mjs',
    ...args
  ]
  const result = await dockerFailure(command, { env: { ...process.env, ...environment }, label, timeout: 30_000 })
  assert(result.stdout === '', `${label} emitted success output`)
  assert(result.stderr.includes('Maintenance failed:'), `${label} did not return the maintenance failure boundary`)
  assert(!result.stderr.includes(readinessToken), `${label} leaked the readiness token`)
  assert(!result.stderr.includes(authSecret), `${label} leaked the auth secret`)
}

async function runOffHostFailure(args, { environment = maintenanceEnvironment, label }) {
  const environmentArguments = Object.keys(environment).flatMap((key) => ['--env', key])
  const command = [
    'run',
    '--rm',
    '--network',
    'none',
    '--no-healthcheck',
    '--mount',
    volumeMount(),
    ...environmentArguments,
    image,
    'node',
    '.output/server/off-host-backup.mjs',
    ...args
  ]
  const result = await dockerFailure(command, { env: { ...process.env, ...environment }, label, timeout: 30_000 })
  assert(result.stdout === '', `${label} emitted success output`)
  assert(
    result.stderr.includes('Off-host backup failed: BACKUP_R2_ACCOUNT_ID is required'),
    `${label} did not prove the packaged operator fails before provider work`
  )
  assert(!result.stderr.includes(readinessToken), `${label} leaked the readiness token`)
  assert(!result.stderr.includes(authSecret), `${label} leaked the auth secret`)
}

async function writePersistentState() {
  await docker(
    [
      'exec',
      containerName,
      'node',
      '-e',
      `const Database=require('/app/.output/server/node_modules/better-sqlite3');const{mkdirSync,writeFileSync}=require('node:fs');const db=new Database('/app/data/app.db');db.prepare("insert into app_settings (key,value) values (?,json_quote(?)) on conflict(key) do update set value=excluded.value").run(${JSON.stringify(persistenceKey)},${JSON.stringify(persistenceValue)});db.close();mkdirSync('/app/data/objects',{recursive:true});writeFileSync('/app/data/objects/container-persistence.txt',${JSON.stringify(objectValue)},{flag:'wx'});`
    ],
    { label: 'persistent database and object write', timeout: 10_000 }
  )
}

async function mutatePersistentDatabase() {
  await docker(
    [
      'exec',
      containerName,
      'node',
      '-e',
      `const Database=require('/app/.output/server/node_modules/better-sqlite3');const db=new Database('/app/data/app.db');db.prepare('update app_settings set value=json_quote(?) where key=?').run(${JSON.stringify(mutatedValue)},${JSON.stringify(persistenceKey)});db.close();`
    ],
    { label: 'post-backup database mutation', timeout: 10_000 }
  )
}

async function writeCorruptBackup() {
  await docker(
    [
      'exec',
      containerName,
      'node',
      '-e',
      `require('node:fs').writeFileSync(${JSON.stringify(corruptBackup)},'not a sqlite database',{flag:'wx'})`
    ],
    { label: 'corrupt restore fixture', timeout: 10_000 }
  )
}

async function assertDatabaseValue(expected, phase) {
  const result = await docker(
    [
      'run',
      '--rm',
      '--mount',
      volumeMount(),
      image,
      'node',
      '-e',
      `const Database=require('/app/.output/server/node_modules/better-sqlite3');const db=new Database('/app/data/app.db',{readonly:true});const row=db.prepare('select value from app_settings where key=?').get(${JSON.stringify(persistenceKey)});db.close();process.stdout.write(JSON.parse(row.value));`
    ],
    { label: `database persistence inspection ${phase}`, timeout: 10_000 }
  )
  assert(result.stdout === expected, `Database sentinel was not ${expected} ${phase}`)
  assert(result.stderr === '', `Database persistence inspection ${phase} emitted stderr`)
}

async function assertPersistentState() {
  const result = await docker(
    [
      'exec',
      containerName,
      'node',
      '-e',
      `const Database=require('/app/.output/server/node_modules/better-sqlite3');const{existsSync,readFileSync,readdirSync}=require('node:fs');const db=new Database('/app/data/app.db',{readonly:true});const row=db.prepare('select value from app_settings where key=?').get(${JSON.stringify(persistenceKey)});db.close();const backups=readdirSync('/app/data/backups');process.stdout.write(JSON.stringify({backups:existsSync(${JSON.stringify(knownGoodBackup)})&&backups.some((name)=>name.includes('pre-migrate'))&&backups.some((name)=>name.includes('pre-restore')),database:JSON.parse(row.value),object:readFileSync('/app/data/objects/container-persistence.txt','utf8')}));`
    ],
    { label: 'replacement persistence inspection', timeout: 10_000 }
  )
  assert(
    isExactRecord(JSON.parse(result.stdout), { backups: true, database: persistenceValue, object: objectValue }),
    'Database and local-object sentinels did not survive container replacement and restore'
  )
}

async function assertNonRootVolumeRuntime() {
  const identity = await docker(['exec', containerName, 'sh', '-c', "id -u; id -g; stat -c '%u:%g' /app/data"], {
    label: 'effective container identity',
    timeout: 10_000
  })
  const [uid, gid, ownership] = identity.stdout.trim().split('\n')
  assert(uid === '1000' && gid === '1000', `Container did not run as the image node user: ${uid}:${gid}`)
  assert(ownership === '1000:1000', `Fresh named volume was not owned by the node user: ${ownership}`)

  const mounts = await docker(['inspect', '--format', '{{json .Mounts}}', containerName], {
    label: 'persistent mount inspection',
    timeout: 5_000
  })
  const parsed = JSON.parse(mounts.stdout)
  assert(
    Array.isArray(parsed) &&
      parsed.some(
        (mount) =>
          mount?.Type === 'volume' &&
          mount?.Name === volumeName &&
          mount?.Destination === '/app/data' &&
          mount?.RW === true
      ),
    'Container did not use the expected writable named volume at /app/data'
  )
}

async function resolvePublishedBaseUrl() {
  const { stdout } = await docker(['port', containerName, '3000/tcp'], {
    label: 'published port lookup',
    timeout: 10_000
  })
  const match = stdout.match(/127\.0\.0\.1:(\d+)\s*$/m)
  assert(match, `Docker did not publish the expected loopback port: ${stdout.trim() || '<empty>'}`)
  return `http://127.0.0.1:${match[1]}`
}

async function waitForContainerHealth(expected, timeoutMs) {
  const expiresAt = Math.min(deadline, Date.now() + timeoutMs)
  let latest = 'unknown'

  while (Date.now() < expiresAt) {
    const { stdout } = await docker(
      ['inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}', containerName],
      { label: 'container health inspection', timeout: 5_000 }
    )
    latest = stdout.trim()
    if (latest === expected) return

    const { stdout: running } = await docker(['inspect', '--format', '{{.State.Running}}', containerName], {
      label: 'container state inspection',
      timeout: 5_000
    })
    assert(running.trim() === 'true', `Container exited while waiting for ${expected} health`)
    await delay(500)
  }

  throw new Error(`Container health did not become ${expected}; last status was ${latest}`)
}

async function assertLiveness(baseUrl, phase) {
  const response = await fetchWithTimeout(`${baseUrl}/api/live`, { timeoutMs: 3_000 })
  const body = await response.text()
  assert(response.status === 204, `Liveness ${phase} expected 204, received ${response.status}`)
  assert(body === '', `Liveness ${phase} returned a response body`)
}

async function assertReadiness(baseUrl, expectedStatus, expectedBody) {
  const response = await fetchWithTimeout(`${baseUrl}/api/ready`, {
    headers: { authorization: `Bearer ${readinessToken}` },
    timeoutMs: 3_000
  })
  const body = await response.json().catch(() => null)
  assert(response.status === expectedStatus, `Readiness expected ${expectedStatus}, received ${response.status}`)
  assert(
    isExactRecord(body, expectedBody),
    `Readiness ${expectedStatus} response did not match its exact redacted contract`
  )
}

async function assertDockerFailureState() {
  const { stdout } = await docker(['inspect', '--format', '{{json .State.Health}}', containerName], {
    label: 'final health inspection',
    timeout: 5_000
  })
  const health = JSON.parse(stdout)
  const logs = Array.isArray(health?.Log) ? health.Log : []
  const failure = logs.findLast((entry) => entry?.ExitCode === 1)

  assert(health?.Status === 'unhealthy', 'Docker did not retain the unhealthy state')
  assert(failure, 'Docker did not record the readiness probe exit code as 1')
  assert(
    logs.every((entry) => entry?.Output === ''),
    'The Docker health probe emitted diagnostic output'
  )
}

async function fetchWithTimeout(url, { headers, timeoutMs }) {
  return fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
}

async function docker(args, { env = process.env, label, timeout }) {
  const remaining = deadline - Date.now()
  assert(remaining > 0, 'Container maintenance smoke exceeded its 180 second deadline')

  try {
    return await execFileAsync('docker', args, {
      encoding: 'utf8',
      env,
      maxBuffer: 1024 * 1024,
      timeout: Math.min(timeout, remaining)
    })
  } catch (error) {
    const stderr = redact(error?.stderr || '')
    const stdout = redact(error?.stdout || '')
    throw new Error(`${label} failed${stderr ? `: ${stderr.trim()}` : stdout ? `: ${stdout.trim()}` : ''}`, {
      cause: error
    })
  }
}

async function dockerFailure(args, { env = process.env, label, timeout }) {
  try {
    await docker(args, { env, label, timeout })
  } catch (error) {
    const cause = error?.cause
    if (typeof cause?.code === 'number') {
      return { stderr: redact(cause.stderr || ''), stdout: redact(cause.stdout || '') }
    }
    throw error
  }
  throw new Error(`${label} unexpectedly succeeded`)
}

async function reportFailure(error) {
  let diagnostics = ''
  try {
    const result = await execFileAsync('docker', ['logs', '--tail', '100', containerName], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 5_000
    })
    diagnostics = redact(`${result.stdout || ''}${result.stderr || ''}`).trim()
  } catch {
    // The application container may not be running. The primary failure is enough.
  }

  console.error(`Container maintenance smoke failed: ${redact(error instanceof Error ? error.message : String(error))}`)
  if (diagnostics) console.error(`Container log tail (secrets redacted):\n${diagnostics}`)
}

function cleanupSync() {
  if (cleanupStarted) return
  cleanupStarted = true
  spawnSync('docker', ['rm', '--force', containerName], {
    encoding: 'utf8',
    stdio: 'ignore',
    timeout: 10_000
  })
  spawnSync('docker', ['volume', 'rm', '--force', volumeName], {
    encoding: 'utf8',
    stdio: 'ignore',
    timeout: 10_000
  })
}

function redact(value) {
  return String(value)
    .replaceAll(readinessToken, '[redacted]')
    .replaceAll(authSecret, '[redacted]')
    .replaceAll(persistenceKey, '[redacted]')
    .replaceAll(persistenceValue, '[redacted]')
    .replaceAll(mutatedValue, '[redacted]')
    .replaceAll(objectValue, '[redacted]')
}

function volumeMount() {
  return `type=volume,source=${volumeName},target=/app/data`
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function isExactRecord(actual, expected) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false
  const expectedKeys = Object.keys(expected)
  const actualKeys = Object.keys(actual)
  return actualKeys.length === expectedKeys.length && expectedKeys.every((key) => actual[key] === expected[key])
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
  throw new Error('Usage: node scripts/ci-container-health.mjs [--image <local-image-tag>]')
}
