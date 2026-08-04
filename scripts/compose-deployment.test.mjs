import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'

const compose = parse(readFileSync(resolve('docker-compose.yml'), 'utf8'), { merge: true })
const services = compose.services
const serviceNames = ['migrate', 'web', 'worker', 'backup-runner']
const databaseServiceNames = ['web', 'worker', 'backup-runner']
const sourceCommit = '0123456789abcdef0123456789abcdef01234567'
const composeProjectName = 'baseline-compose-test'
const backupEmptyEnvironmentName = 'BASELINE_BACKUP_ENV_EMPTY'
const backupEmptyEnvironmentExpression = '${BASELINE_BACKUP_ENV_EMPTY:-}'
const backupEnvironmentNames = [
  'BACKUP_R2_ACCOUNT_ID',
  'BACKUP_R2_BUCKET',
  'BACKUP_R2_ENDPOINT',
  'BACKUP_R2_ACCESS_KEY_ID',
  'BACKUP_R2_SECRET_ACCESS_KEY'
]
const validBackupEnvironment = {
  BACKUP_R2_ACCOUNT_ID: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  BACKUP_R2_BUCKET: 'private-database-backups',
  BACKUP_R2_ENDPOINT: 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.r2.cloudflarestorage.com',
  BACKUP_R2_ACCESS_KEY_ID: 'test-access-key',
  BACKUP_R2_SECRET_ACCESS_KEY: 'test-secret-key'
}
const requiredEnvironmentNames = [
  'NUXT_PUBLIC_APP_URL',
  'NUXT_READINESS_TOKEN',
  'NUXT_BETTER_AUTH_SECRET',
  'NUXT_BETTER_AUTH_URL',
  'NUXT_SOCIAL_PROVIDERS_GOOGLE_ENABLED',
  'NUXT_EMAIL_TRANSPORT',
  'NUXT_EMAIL_FROM',
  'NUXT_MODULES_BILLING_ENABLED',
  'NUXT_MODULES_FILES_ENABLED',
  'NUXT_MODULES_AI_ENABLED',
  'NUXT_MODULES_TURNSTILE_ENABLED',
  'NUXT_MODULES_OBSERVABILITY_ENABLED',
  'NUXT_MODULES_JOBS_ENABLED',
  'NUXT_OPENAI_FILE_SEARCH_ENABLED',
  'NUXT_OPENAI_WEB_SEARCH_ENABLED'
]

test('Coolify builds one commit-qualified image for every application role', () => {
  assert.deepEqual(Object.keys(services).sort(), serviceNames.toSorted())
  assert.deepEqual(compose['x-app-image'], {
    image: '${COMPOSE_PROJECT_NAME}_app:${SOURCE_COMMIT:?Set SOURCE_COMMIT to the selected Git commit}',
    pull_policy: 'never'
  })
  for (const serviceName of serviceNames) {
    assert.equal(services[serviceName].image, compose['x-app-image'].image)
    assert.equal(services[serviceName].pull_policy, 'never')
  }
  assert.equal(services.migrate.build, '.')
  for (const serviceName of databaseServiceNames) {
    assert(!Object.hasOwn(services[serviceName], 'build'))
  }
})

test('required Coolify variables have no placeholder defaults', () => {
  const requiredEntries = Object.entries(services.migrate.environment).filter(
    ([, value]) => typeof value === 'string' && value.includes(':?')
  )
  assert.deepEqual(requiredEntries.map(([name]) => name).sort(), requiredEnvironmentNames.toSorted())
  for (const [name, value] of requiredEntries) {
    assert.equal(value, '${' + name + ':?}')
  }
})

test('backup is an explicit profile with fail-closed runtime configuration', () => {
  const backupRunner = services['backup-runner']
  assert.deepEqual(backupRunner.profiles, ['backup'])
  assert.equal(backupRunner.init, true)
  for (const name of backupEnvironmentNames) {
    assert.equal(backupRunner.environment[name], '${' + name + '-}')
    for (const serviceName of ['migrate', 'web', 'worker']) {
      assert.equal(services[serviceName].environment[name], backupEmptyEnvironmentExpression)
    }
  }
  assert.deepEqual(backupRunner.command.slice(0, 2), ['sh', '-ec'])
  assert.match(backupRunner.command[2], /node \.output\/server\/off-host-backup\.mjs validate-config/)
  assert.match(backupRunner.command[2], /exec sleep infinity/)
})

test('rendered Compose selects backup only when its profile is enabled', () => {
  const defaultCompose = renderedCompose()
  const backupCompose = renderedCompose({
    COMPOSE_PROFILES: 'backup',
    ...validBackupEnvironment
  })

  assert.deepEqual(Object.keys(defaultCompose.services).sort(), ['migrate', 'web', 'worker'])
  assert.deepEqual(Object.keys(backupCompose.services).sort(), serviceNames.toSorted())

  for (const rendered of [defaultCompose, backupCompose]) {
    for (const service of Object.values(rendered.services)) {
      assert.equal(service.image, `${composeProjectName}_app:${sourceCommit}`)
      assert.equal(service.pull_policy, 'never')
    }
  }
})

test('service environment overrides Coolify shared env-file backup credentials', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'swl-compose-coolify-'))
  const environmentPath = resolve(directory, '.env')
  const overridePath = resolve(directory, 'coolify-compose.yml')
  const runtimeEnvironment = {
    ...Object.fromEntries(requiredEnvironmentNames.map((name) => [name, `test-${name.toLowerCase()}`])),
    SOURCE_COMMIT: sourceCommit,
    COMPOSE_PROFILES: 'backup',
    [backupEmptyEnvironmentName]: '',
    ...validBackupEnvironment
  }

  try {
    writeFileSync(
      environmentPath,
      Object.entries(runtimeEnvironment)
        .map(([name, value]) => `${name}=${value}`)
        .join('\n')
    )
    writeFileSync(
      overridePath,
      `services:\n${serviceNames.map((name) => `  ${name}:\n    env_file:\n      - ${JSON.stringify(environmentPath)}\n`).join('')}`
    )
    const rendered = JSON.parse(
      execFileSync(
        'docker',
        [
          'compose',
          '--env-file',
          environmentPath,
          '-f',
          resolve('docker-compose.yml'),
          '-f',
          overridePath,
          'config',
          '--format',
          'json'
        ],
        {
          cwd: resolve('.'),
          encoding: 'utf8',
          env: cleanComposeEnvironment()
        }
      )
    )

    for (const serviceName of serviceNames) {
      assert.equal(rendered.services[serviceName].environment[backupEmptyEnvironmentName], '')
    }
    for (const name of backupEnvironmentNames) {
      for (const serviceName of ['migrate', 'web', 'worker']) {
        assert.equal(rendered.services[serviceName].environment[name], '')
      }
      assert.equal(rendered.services['backup-runner'].environment[name], validBackupEnvironment[name])
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('one-shot migration gates every long-lived database service', () => {
  assert.deepEqual(services.migrate.command, [
    'node',
    '.output/server/maintenance.mjs',
    'migrate',
    '--confirm-app-stopped'
  ])
  assert.equal(services.migrate.restart, 'no')
  assert.deepEqual(services.migrate.healthcheck, { disable: true })
  assert(!Object.hasOwn(services.migrate, 'entrypoint'))
  assert.equal(services.migrate.environment.NUXT_DATABASE_URL, 'file:/app/data/app.db')
  assert.deepEqual(services.migrate.volumes, ['app-data:/app/data'])

  for (const serviceName of databaseServiceNames) {
    assert.deepEqual(services[serviceName].depends_on, {
      migrate: { condition: 'service_completed_successfully' }
    })
    for (const [name, value] of Object.entries(services.migrate.environment)) {
      if (serviceName === 'backup-runner' && backupEnvironmentNames.includes(name)) continue
      assert.equal(services[serviceName].environment[name], value)
    }
    assert.deepEqual(services[serviceName].volumes, services.migrate.volumes)
  }
})

test('Compose keeps the deployment surface minimal', () => {
  assert.deepEqual(compose.volumes, { 'app-data': null })
  assert(!Object.hasOwn(compose, 'networks'))

  for (const serviceName of serviceNames) {
    assert(!Object.hasOwn(services[serviceName], 'ports'))
    assert(!Object.hasOwn(services[serviceName], 'networks'))
    assert(!Object.hasOwn(services[serviceName], 'exclude_from_hc'))
  }

  assert.deepEqual(services.web.expose, ['3000'])
  assert(!Object.hasOwn(services.web, 'healthcheck'))
  assert.deepEqual(services.worker.command, [
    'node',
    '--import',
    './.output/server/worker-sentry.server.config.mjs',
    '.output/server/worker.mjs'
  ])
  assert.equal(services.worker.init, true)
  assert.equal(services.worker.stop_grace_period, '360s')
  assert.deepEqual(services.worker.healthcheck, { disable: true })
  assert.deepEqual(services['backup-runner'].healthcheck, { disable: true })
})

function renderedCompose(overrides = {}) {
  const environment = {
    ...cleanComposeEnvironment(),
    ...Object.fromEntries(requiredEnvironmentNames.map((name) => [name, `test-${name.toLowerCase()}`])),
    ...Object.fromEntries(backupEnvironmentNames.map((name) => [name, ''])),
    SOURCE_COMMIT: sourceCommit,
    COMPOSE_PROFILES: '',
    ...overrides
  }

  return JSON.parse(
    execFileSync('docker', ['compose', '--project-name', composeProjectName, 'config', '--format', 'json'], {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: environment
    })
  )
}

function cleanComposeEnvironment() {
  const environment = { ...process.env }
  for (const name of [...backupEnvironmentNames, backupEmptyEnvironmentName, 'COMPOSE_PROFILES', 'SOURCE_COMMIT']) {
    delete environment[name]
  }
  return environment
}
