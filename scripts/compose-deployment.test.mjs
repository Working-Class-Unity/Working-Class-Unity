import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'

const compose = parse(readFileSync(resolve('docker-compose.yml'), 'utf8'), { merge: true })
const services = compose.services
const serviceNames = ['migrate', 'web', 'backup-runner']
const sourceCommit = '0123456789abcdef0123456789abcdef01234567'
const project = 'wcu-compose-test'
const cleared = '${WCU_CLEARED_ENVIRONMENT:-}'
const applicationSecrets = ['NUXT_READINESS_TOKEN', 'NUXT_SENTRY_DSN', 'NUXT_OBSERVABILITY_TEST_TOKEN']
const backupEnvironment = {
  BACKUP_R2_ACCOUNT_ID: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  BACKUP_R2_BUCKET: 'private-database-backups',
  BACKUP_R2_ENDPOINT: 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.r2.cloudflarestorage.com',
  BACKUP_R2_ACCESS_KEY_ID: 'test-access-key',
  BACKUP_R2_SECRET_ACCESS_KEY: 'test-secret-key'
}

function environment(overrides = {}) {
  const result = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^(NUXT_|BACKUP_|WCU_|SOURCE_COMMIT|COMPOSE_)/.test(name))
  )
  return {
    ...result,
    SOURCE_COMMIT: sourceCommit,
    NUXT_PUBLIC_APP_URL: 'https://example.test',
    NUXT_READINESS_TOKEN: 'private-readiness-token-for-compose-test',
    ...Object.fromEntries(Object.keys(backupEnvironment).map((name) => [name, ''])),
    ...overrides
  }
}

function render(overrides = {}) {
  return JSON.parse(
    execFileSync('docker', ['compose', '--project-name', project, 'config', '--format', 'json'], {
      encoding: 'utf8',
      env: environment(overrides),
      stdio: ['ignore', 'pipe', 'pipe']
    })
  )
}

test('one commit-qualified image serves only web, migration, and backup roles', () => {
  const rendered = render(backupEnvironment)
  assert.deepEqual(Object.keys(rendered.services).sort(), serviceNames.toSorted())
  for (const [name, service] of Object.entries(rendered.services)) {
    assert.equal(service.image, `${project}_app:${sourceCommit}`)
    assert.equal(service.pull_policy, 'never')
    assert.equal(Boolean(service.build), name === 'migrate')
    assert.equal(service.ports, undefined)
  }
  assert.deepEqual(services.web.expose, ['3000'])
  assert.deepEqual(compose.volumes, { 'app-data': null })
})

test('public runtime requires only its origin and readiness token, while backup credentials remain required', () => {
  const required = Object.entries(services.web.environment)
    .filter(([, value]) => String(value).includes(':?'))
    .map(([name]) => name)
  assert.deepEqual(required.sort(), ['NUXT_PUBLIC_APP_URL', 'NUXT_READINESS_TOKEN'])
  assert.throws(() => render(), /BACKUP_R2_.*required variable.*missing a value/i)
  for (const name of Object.keys(backupEnvironment)) {
    assert.throws(() => render({ ...backupEnvironment, [name]: '' }), /required variable.*missing a value/i)
    assert.equal(services['backup-runner'].environment[name], '${' + name + ':?}')
  }
  assert.match(services['backup-runner'].command[2], /off-host-backup\.mjs validate-config/)
  assert.match(services['backup-runner'].command[2], /exec sleep infinity/)
})

test('one-shot migration gates each persistent database service', () => {
  assert.deepEqual(services.migrate.command, [
    'node',
    '.output/server/maintenance.mjs',
    'migrate',
    '--confirm-app-stopped'
  ])
  assert.equal(services.migrate.restart, 'no')
  assert.deepEqual(services.migrate.healthcheck, { disable: true })
  for (const name of ['web', 'backup-runner']) {
    assert.deepEqual(services[name].depends_on, { migrate: { condition: 'service_completed_successfully' } })
    assert.deepEqual(services[name].volumes, ['app-data:/app/data'])
  }
})

test('Coolify shared environment files cannot refill credentials cleared for other roles', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'wcu-compose-'))
  const envPath = resolve(directory, '.env')
  const overridePath = resolve(directory, 'compose.yml')
  const credentials = Object.fromEntries(applicationSecrets.map((name) => [name, `private-${name}`]))
  try {
    writeFileSync(
      envPath,
      Object.entries({ ...backupEnvironment, ...credentials })
        .map(([k, v]) => `${k}=${v}`)
        .join('\n')
    )
    writeFileSync(
      overridePath,
      `services:\n${serviceNames.map((name) => `  ${name}:\n    env_file:\n      - ${JSON.stringify(envPath)}\n`).join('')}`
    )
    const rendered = JSON.parse(
      execFileSync(
        'docker',
        [
          'compose',
          '--project-name',
          project,
          '-f',
          resolve('docker-compose.yml'),
          '-f',
          overridePath,
          'config',
          '--format',
          'json'
        ],
        { encoding: 'utf8', env: environment({ ...backupEnvironment, ...credentials }) }
      )
    )
    for (const name of Object.keys(backupEnvironment)) {
      assert.equal(rendered.services['backup-runner'].environment[name], backupEnvironment[name])
      for (const role of ['web', 'migrate']) {
        assert.equal(services[role].environment[name], cleared)
        assert.equal(rendered.services[role].environment[name], '')
      }
    }
    for (const name of applicationSecrets) {
      assert.equal(rendered.services.web.environment[name], credentials[name])
      for (const role of ['migrate', 'backup-runner']) {
        assert.equal(services[role].environment[name], cleared)
        assert.equal(rendered.services[role].environment[name], '')
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
