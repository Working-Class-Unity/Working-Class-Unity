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
const clearedEnvironmentName = 'WCU_CLEARED_ENVIRONMENT'
const clearedEnvironmentExpression = '${WCU_CLEARED_ENVIRONMENT:-}'
const applicationSecretNames = [
  'NUXT_READINESS_TOKEN',
  'NUXT_BETTER_AUTH_SECRET',
  'NUXT_EMAIL_RESEND_API_KEY',
  'NUXT_STRIPE_SECRET_KEY',
  'NUXT_STRIPE_WEBHOOK_SECRET',
  'NUXT_CLOUDFLARE_R2_ACCESS_KEY_ID',
  'NUXT_CLOUDFLARE_R2_SECRET_ACCESS_KEY',
  'NUXT_OPENAI_API_KEY',
  'NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY',
  'NUXT_SENTRY_DSN',
  'NUXT_OBSERVABILITY_TEST_TOKEN'
]
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
  'NUXT_EMAIL_TRANSPORT',
  'NUXT_EMAIL_FROM',
  'NUXT_STRIPE_SECRET_KEY',
  'NUXT_STRIPE_WEBHOOK_SECRET',
  'NUXT_STRIPE_PORTAL_CONFIGURATION_ID',
  'NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID',
  'NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID',
  'NUXT_STRIPE_PERSONAL_ANNUAL_PRICE_ID',
  'NUXT_STRIPE_FAMILY_MONTHLY_PRICE_ID',
  'NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID',
  'NUXT_FILES_DRIVER',
  'NUXT_OPENAI_API_KEY',
  'NUXT_OPENAI_PROJECT_ID',
  'NUXT_OPENAI_MODEL',
  'NUXT_OPENAI_FILE_SEARCH_VECTOR_STORE_ID',
  'NUXT_OPENAI_WEB_SEARCH_ALLOWED_DOMAINS',
  'NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY',
  'NUXT_PUBLIC_TURNSTILE_SITE_KEY',
  'NUXT_SENTRY_DSN',
  'NUXT_PUBLIC_SENTRY_DSN'
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
  const requiredEntries = Object.entries(services.web.environment).filter(
    ([, value]) => typeof value === 'string' && value.includes(':?')
  )
  assert.deepEqual(requiredEntries.map(([name]) => name).sort(), requiredEnvironmentNames.toSorted())
  for (const [name, value] of requiredEntries) {
    assert.equal(value, '${' + name + ':?}')
  }
})

test('backup is unconditional with fail-closed runtime configuration', () => {
  const backupRunner = services['backup-runner']
  assert(!Object.hasOwn(backupRunner, 'profiles'))
  assert.equal(backupRunner.init, true)
  for (const name of backupEnvironmentNames) {
    assert.equal(backupRunner.environment[name], '${' + name + ':?}')
    for (const serviceName of ['migrate', 'web', 'worker']) {
      assert.equal(services[serviceName].environment[name], clearedEnvironmentExpression)
    }
  }
  assert.deepEqual(backupRunner.command.slice(0, 2), ['sh', '-ec'])
  assert.match(backupRunner.command[2], /node \.output\/server\/off-host-backup\.mjs validate-config/)
  assert.match(backupRunner.command[2], /exec sleep infinity/)
})

test('rendered Compose requires configured backup and always includes it', () => {
  assert.throws(
    () => renderedCompose(),
    /BACKUP_R2_(?:ACCOUNT_ID|BUCKET|ENDPOINT|ACCESS_KEY_ID|SECRET_ACCESS_KEY).*required variable.*missing a value/i
  )
  const configuredCompose = renderedCompose(validBackupEnvironment)

  assert.deepEqual(Object.keys(configuredCompose.services).sort(), serviceNames.toSorted())

  for (const service of Object.values(configuredCompose.services)) {
    assert.equal(service.image, `${composeProjectName}_app:${sourceCommit}`)
    assert.equal(service.pull_policy, 'never')
  }
})

test('service environment overrides Coolify shared env-file backup credentials', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'swl-compose-coolify-'))
  const environmentPath = resolve(directory, '.env')
  const overridePath = resolve(directory, 'coolify-compose.yml')
  const runtimeEnvironment = {
    ...Object.fromEntries(requiredEnvironmentNames.map((name) => [name, `test-${name.toLowerCase()}`])),
    ...Object.fromEntries(applicationSecretNames.map((name) => [name, `private-${name.toLowerCase()}`])),
    SOURCE_COMMIT: sourceCommit,
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

    for (const name of backupEnvironmentNames) {
      for (const serviceName of ['migrate', 'web', 'worker']) {
        assert.equal(rendered.services[serviceName].environment[name], '')
      }
      assert.equal(rendered.services['backup-runner'].environment[name], validBackupEnvironment[name])
    }
    for (const name of applicationSecretNames) {
      assert.equal(rendered.services.migrate.environment[name], '')
      assert.equal(rendered.services['backup-runner'].environment[name], '')
      assert.equal(rendered.services.web.environment[name], runtimeEnvironment[name])
      assert.equal(rendered.services.worker.environment[name], runtimeEnvironment[name])
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
    assert.deepEqual(services[serviceName].volumes, services.migrate.volumes)
  }
})

test('one-shot operators do not receive application provider credentials', () => {
  for (const name of applicationSecretNames) {
    assert.equal(services.migrate.environment[name], clearedEnvironmentExpression)
    assert.equal(services['backup-runner'].environment[name], clearedEnvironmentExpression)
  }
  assert.equal(services.migrate.environment.NUXT_DATABASE_URL, 'file:/app/data/app.db')
  assert.equal(services['backup-runner'].environment.NUXT_DATABASE_URL, 'file:/app/data/app.db')
})

test('Coolify-cleared values use only the reserved unset indirection', () => {
  for (const name of applicationSecretNames) {
    assert.equal(compose['x-cleared-application-secrets'][name], clearedEnvironmentExpression)
  }
  for (const name of backupEnvironmentNames) {
    assert.equal(services.migrate.environment[name], clearedEnvironmentExpression)
    assert.equal(services.web.environment[name], clearedEnvironmentExpression)
    assert.equal(services.worker.environment[name], clearedEnvironmentExpression)
  }

  const reservedValue = 'reserved-value-must-never-be-configured'
  const rendered = renderedCompose({ [clearedEnvironmentName]: reservedValue, ...validBackupEnvironment })
  for (const name of applicationSecretNames) {
    assert.equal(rendered.services.migrate.environment[name], reservedValue)
    assert.equal(rendered.services['backup-runner'].environment[name], reservedValue)
  }
  for (const name of backupEnvironmentNames) {
    assert.equal(rendered.services.migrate.environment[name], reservedValue)
    assert.equal(rendered.services.web.environment[name], reservedValue)
    assert.equal(rendered.services.worker.environment[name], reservedValue)
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
  for (const name of [...backupEnvironmentNames, ...applicationSecretNames, clearedEnvironmentName, 'SOURCE_COMMIT']) {
    delete environment[name]
  }
  return environment
}
