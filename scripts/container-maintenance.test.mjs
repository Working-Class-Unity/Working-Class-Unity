import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const Database = require('../node_modules/better-sqlite3')
const entry = resolve('server/maintenance.mjs')
const migrationsFolder = resolve('server/db/migrations')
const runPnpm = resolve('scripts/run-pnpm.mjs')
const stoppedApp = '--confirm-app-stopped'
const finalMigrationCount = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')).entries
  .length

test('maintenance rejects missing configuration, relative paths, and unknown commands', async () => {
  const missing = await runProcess(['migrate', stoppedApp], { NUXT_DATABASE_URL: undefined })
  assert.equal(missing.code, 1)
  assert.match(missing.stderr, /NUXT_DATABASE_URL must be an already-trimmed absolute file: path/)

  const relative = await runProcess(['migrate', stoppedApp], { NUXT_DATABASE_URL: 'file:./data/app.db' })
  assert.equal(relative.code, 1)
  assert.match(relative.stderr, /absolute file: path/)

  const unknown = await runProcess(['vacuum'], { NUXT_DATABASE_URL: 'file:/tmp/app.db' })
  assert.equal(unknown.code, 1)
  assert.match(unknown.stderr, /Usage: node \.output\/server\/maintenance\.mjs/)

  const unconfirmed = await runProcess(['migrate'], { NUXT_DATABASE_URL: 'file:/tmp/app.db' })
  assert.equal(unconfirmed.code, 1)
  assert.match(unconfirmed.stderr, /Migration requires --confirm-app-stopped/)
})

test('fresh and repeat migrations are idempotent and back up existing state', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')

  const fresh = await runMaintenance(databasePath, ['migrate', stoppedApp])
  assert.equal(fresh.code, 0)
  assert.match(
    fresh.stdout,
    new RegExp(
      `${finalMigrationCount} newly applied; ${finalMigrationCount}/${finalMigrationCount} current; pre-migration backup not required`
    )
  )
  assert.equal(fresh.stderr, '')

  writeEventTitle(databasePath, 'migration-sentinel', 'preserved')
  const repeat = await runMaintenance(databasePath, ['migrate', stoppedApp])
  assert.equal(repeat.code, 0)
  assert.match(
    repeat.stdout,
    new RegExp(
      `0 newly applied; ${finalMigrationCount}/${finalMigrationCount} current; pre-migration backup written as app-pre-migrate-`
    )
  )
  assert.equal(readEventTitle(databasePath, 'migration-sentinel'), 'preserved')
  assert.equal(readdirSync(join(sandbox, 'backups')).filter((name) => name.includes('pre-migrate')).length, 1)

  const sqlite = new Database(databasePath, { readonly: true })
  try {
    const migrations = sqlite.prepare('select count(*) as count from __drizzle_migrations').get()
    assert.equal(migrations.count, finalMigrationCount)
    assert.equal(
      sqlite.prepare("select count(*) as count from sqlite_master where type = 'table' and name = 'events'").get()
        .count,
      1
    )
  } finally {
    sqlite.close()
  }
})

test('verification rejects a changed packaged index', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  assert.equal((await runMaintenance(databasePath, ['migrate', stoppedApp])).code, 0)

  const sqlite = new Database(databasePath)
  try {
    sqlite.exec('drop index events_status_kind_idx')
  } finally {
    sqlite.close()
  }

  const result = await runMaintenance(databasePath, ['verify'])
  assert.equal(result.code, 1)
  assert.match(
    result.stderr,
    /does not exactly match the packaged migration prefix: missing index:events_status_kind_idx/
  )
})

test('same-named changed event indexes cannot be verified, backed up, or restored', async (t) => {
  const sandbox = disposableDirectory(t)
  const weakenedDirectory = join(sandbox, 'weakened')
  const weakenedDatabasePath = join(weakenedDirectory, 'app.db')
  mkdirSync(weakenedDirectory)
  assert.equal((await runMaintenance(weakenedDatabasePath, ['migrate', stoppedApp])).code, 0)
  writeEventTitle(weakenedDatabasePath, 'changed-index-sentinel', 'preserved')

  const weakened = new Database(weakenedDatabasePath)
  try {
    weakened.exec(`
      drop index events_status_kind_idx;
      create index events_status_kind_idx on events (title);
    `)
  } finally {
    weakened.close()
  }

  const weakenedBytes = readFileSync(weakenedDatabasePath)
  const rejectedBackupPath = join(weakenedDirectory, 'backups', 'must-not-exist.db')
  for (const args of [['verify'], ['backup', '--output', rejectedBackupPath]]) {
    const result = await runMaintenance(weakenedDatabasePath, args)
    assert.equal(result.code, 1)
    assert.match(
      result.stderr,
      /does not exactly match the packaged migration prefix: changed index:events_status_kind_idx/
    )
    assert.deepEqual(readFileSync(weakenedDatabasePath), weakenedBytes)
    assert.equal(readEventTitle(weakenedDatabasePath, 'changed-index-sentinel'), 'preserved')
  }
  assert(!existsSync(join(weakenedDirectory, 'backups')))

  const liveDirectory = join(sandbox, 'live')
  const liveDatabasePath = join(liveDirectory, 'app.db')
  const restoreInputPath = join(liveDirectory, 'backups', 'changed-index.db')
  mkdirSync(join(liveDirectory, 'backups'), { recursive: true })
  assert.equal((await runMaintenance(liveDatabasePath, ['migrate', stoppedApp])).code, 0)
  writeEventTitle(liveDatabasePath, 'live-index-sentinel', 'preserved')
  cpSync(weakenedDatabasePath, restoreInputPath)
  const liveBytes = readFileSync(liveDatabasePath)
  const restoreInputBytes = readFileSync(restoreInputPath)

  const restore = await runMaintenance(liveDatabasePath, ['restore', '--input', restoreInputPath, stoppedApp])
  assert.equal(restore.code, 1)
  assert.match(
    restore.stderr,
    /does not exactly match the packaged migration prefix: changed index:events_status_kind_idx/
  )
  assert.deepEqual(readFileSync(liveDatabasePath), liveBytes)
  assert.deepEqual(readFileSync(restoreInputPath), restoreInputBytes)
  assert.equal(readEventTitle(liveDatabasePath, 'live-index-sentinel'), 'preserved')
  assert.deepEqual(readdirSync(join(liveDirectory, 'backups')), ['changed-index.db'])
  assert(!readdirSync(liveDirectory).some((name) => name.startsWith('.restore-')))
})

test('migration fails closed when the applied ledger does not match packaged migrations', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  const sqlite = new Database(databasePath)
  try {
    sqlite.exec('create table __drizzle_migrations (id SERIAL primary key, hash text not null, created_at numeric)')
    sqlite
      .prepare('insert into __drizzle_migrations (hash, created_at) values (?, ?)')
      .run('not-a-packaged-migration', Number.MAX_SAFE_INTEGER)
  } finally {
    sqlite.close()
  }

  const result = await runMaintenance(databasePath, ['migrate', stoppedApp])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /applied migration ledger does not exactly match the packaged migrations/)
  const drifted = new Database(databasePath, { readonly: true })
  try {
    assert.equal(
      drifted.prepare("select count(*) as count from sqlite_master where type = 'table' and name = 'events'").get()
        .count,
      0
    )
  } finally {
    drifted.close()
  }
})

test('migration rejects a drifted current ledger before backup or mutation', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  assert.equal((await runMaintenance(databasePath, ['migrate', stoppedApp])).code, 0)
  writeEventTitle(databasePath, 'drift-sentinel', 'preserved')
  const sqlite = new Database(databasePath)
  try {
    sqlite.prepare('update __drizzle_migrations set hash = ? where rowid = 1').run('drifted-prefix-hash')
  } finally {
    sqlite.close()
  }

  const result = await runMaintenance(databasePath, ['migrate', stoppedApp])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /applied migration ledger does not exactly match the packaged migrations/)
  const unchanged = new Database(databasePath, { readonly: true })
  try {
    assert.equal(
      unchanged.prepare('select count(*) as count from __drizzle_migrations').get().count,
      finalMigrationCount
    )
    assert.equal(unchanged.prepare("select title from events where id = 'drift-sentinel'").get().title, 'preserved')
  } finally {
    unchanged.close()
  }
  assert(!existsSync(join(sandbox, 'backups')))
})

test('the documented migration command uses maintenance for relative URLs and rejects an empty ledger', async (t) => {
  const sandbox = disposableDirectory(t)
  const freshDatabasePath = join(sandbox, 'fresh.db')
  const appDirectory = resolve('.')
  const freshRelativeUrl = `file:${relative(appDirectory, freshDatabasePath)}`

  const fresh = await runPublicMigration(freshRelativeUrl)
  assert.equal(fresh.code, 0, fresh.stderr)
  assert.match(
    fresh.stdout,
    new RegExp(`${finalMigrationCount} newly applied; ${finalMigrationCount}/${finalMigrationCount} current`)
  )

  const failedFirstDatabasePath = join(sandbox, 'failed-first.db')
  const failedFirst = new Database(failedFirstDatabasePath)
  try {
    failedFirst.exec(
      'create table __drizzle_migrations (id SERIAL primary key, hash text not null, created_at numeric)'
    )
  } finally {
    failedFirst.close()
  }

  const unsupportedRetry = await runPublicMigration(`file:${failedFirstDatabasePath}`)
  assert.equal(unsupportedRetry.code, 1)
  assert.match(unsupportedRetry.stderr, /must contain a recognized non-empty packaged migration ledger/)
  const rolledBack = new Database(failedFirstDatabasePath, { readonly: true })
  try {
    assert.equal(rolledBack.prepare('select count(*) as count from __drizzle_migrations').get().count, 0)
    assert.equal(
      rolledBack.prepare("select count(*) as count from sqlite_master where type = 'table' and name = 'events'").get()
        .count,
      0
    )
  } finally {
    rolledBack.close()
  }
})

test('a failed first initialization rolls back and requires manual disposal before another attempt', async (t) => {
  const sandbox = disposableDirectory(t)
  const fixtureRoot = join(sandbox, 'broken-package')
  const fixtureEntry = join(fixtureRoot, 'maintenance.mjs')
  const fixtureMigrations = join(fixtureRoot, 'db', 'migrations')
  const databasePath = join(sandbox, 'app.db')
  mkdirSync(join(fixtureRoot, 'db'), { recursive: true })
  symlinkSync(resolve('node_modules'), join(fixtureRoot, 'node_modules'), 'dir')
  cpSync(entry, fixtureEntry)
  cpSync(migrationsFolder, fixtureMigrations, { recursive: true })
  appendFileSync(
    join(fixtureMigrations, '0000_public_events.sql'),
    '\n--> statement-breakpoint\nselect * from injected_missing_migration_table;\n'
  )

  const failed = await runProcess(['migrate', stoppedApp], { NUXT_DATABASE_URL: 'file:' + databasePath }, fixtureEntry)
  assert.equal(failed.code, 1)
  assert.match(failed.stderr, /injected_missing_migration_table/)
  const rolledBack = new Database(databasePath, { readonly: true })
  try {
    assert.equal(rolledBack.prepare('select count(*) as count from __drizzle_migrations').get().count, 0)
    assert.equal(
      rolledBack.prepare("select count(*) as count from sqlite_master where type = 'table' and name = 'events'").get()
        .count,
      0
    )
  } finally {
    rolledBack.close()
  }

  const retry = await runProcess(['migrate', stoppedApp], { NUXT_DATABASE_URL: 'file:' + databasePath }, fixtureEntry)
  assert.equal(retry.code, 1)
  assert.match(retry.stderr, /must contain a recognized non-empty packaged migration ledger/)
})

test('fresh migration rejects orphaned SQLite sidecars without consuming them', async (t) => {
  const sandbox = disposableDirectory(t)
  for (const [index, suffix] of ['-wal', '-shm', '-journal'].entries()) {
    const directory = join(sandbox, 'sidecar-' + index)
    const databasePath = join(directory, 'app.db')
    const sidecarPath = databasePath + suffix
    mkdirSync(directory)
    if (suffix === '-journal') writeFileSync(databasePath, '')
    writeFileSync(sidecarPath, 'preserve' + suffix)

    const result = await runMaintenance(databasePath, ['migrate', stoppedApp])
    assert.equal(result.code, 1)
    assert.match(result.stderr, /absent or empty SQLite database has orphaned journal\/WAL\/SHM state/)
    assert.equal(readFileSync(sidecarPath, 'utf8'), 'preserve' + suffix)
    if (suffix !== '-journal') assert(!existsSync(databasePath))
    else assert.equal(statSync(databasePath).size, 0)
  }
})

test('migration cannot adopt a populated foreign SQLite database without the app ledger', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  const foreign = new Database(databasePath)
  try {
    foreign.exec("create table foreign_data (value text not null); insert into foreign_data values ('keep')")
  } finally {
    foreign.close()
  }

  const result = await runMaintenance(databasePath, ['migrate', stoppedApp])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /Existing database must contain a recognized non-empty packaged migration ledger/)
  const unchanged = new Database(databasePath, { readonly: true })
  try {
    assert.equal(unchanged.prepare('select value from foreign_data').get().value, 'keep')
    assert.equal(
      unchanged.prepare("select count(*) as count from sqlite_master where type = 'table' and name = 'events'").get()
        .count,
      0
    )
  } finally {
    unchanged.close()
  }
})

test('backup creates a verified snapshot and refuses unsafe destinations', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  const outputPath = join(sandbox, 'backups', 'snapshot.db')
  assert.equal((await runMaintenance(databasePath, ['migrate', stoppedApp])).code, 0)
  writeEventTitle(databasePath, 'backup-sentinel', 'snapshot')

  const backup = await runMaintenance(databasePath, ['backup', '--output', outputPath])
  assert.equal(backup.code, 0)
  assert.match(backup.stdout, /Backup passed: snapshot\.db; integrity ok; foreign keys ok/)
  assert.equal(readEventTitle(outputPath, 'backup-sentinel'), 'snapshot')
  assert.equal(statSync(outputPath).mode & 0o777, 0o600)

  const duplicate = await runMaintenance(databasePath, ['backup', '--output', outputPath])
  assert.equal(duplicate.code, 1)
  assert.match(duplicate.stderr, /refusing to overwrite/)

  const liveTarget = await runMaintenance(databasePath, ['backup', '--output', databasePath])
  assert.equal(liveTarget.code, 1)
  assert.match(liveTarget.stderr, /directly inside the backup directory/)

  const outside = await runMaintenance(databasePath, ['backup', '--output', join(sandbox, '..', 'escape.db')])
  assert.equal(outside.code, 1)
  assert.match(outside.stderr, /directly inside the backup directory/)
})

test('backup and restore reject symbolic-link escapes from the backup directory', async (t) => {
  const outputSandbox = disposableDirectory(t)
  const outputDatabase = join(outputSandbox, 'app.db')
  assert.equal((await runMaintenance(outputDatabase, ['migrate', stoppedApp])).code, 0)
  const outside = disposableDirectory(t)
  symlinkSync(outside, join(outputSandbox, 'backups'))

  const escapedOutput = join(outputSandbox, 'backups', 'escaped.db')
  const escapedBackup = await runMaintenance(outputDatabase, ['backup', '--output', escapedOutput])
  assert.equal(escapedBackup.code, 1)
  assert.match(escapedBackup.stderr, /backup directory must be a real directory/)
  assert(!existsSync(join(outside, 'escaped.db')))

  const inputSandbox = disposableDirectory(t)
  const inputDatabase = join(inputSandbox, 'app.db')
  assert.equal((await runMaintenance(inputDatabase, ['migrate', stoppedApp])).code, 0)
  const backupsDirectory = join(inputSandbox, 'backups')
  mkdirSync(backupsDirectory)
  const outsideInput = join(outside, 'known-good.db')
  assert.equal((await runMaintenance(outsideInput, ['migrate', stoppedApp])).code, 0)
  const linkedInput = join(backupsDirectory, 'linked.db')
  symlinkSync(outsideInput, linkedInput)

  const linkedRestore = await runMaintenance(inputDatabase, ['restore', '--input', linkedInput, stoppedApp])
  assert.equal(linkedRestore.code, 1)
  assert.match(linkedRestore.stderr, /existing regular file, not a symbolic link/)
})

test('restore requires an explicit stopped-app assertion', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  const backupPath = join(sandbox, 'backups', 'snapshot.db')
  assert.equal((await runMaintenance(databasePath, ['migrate', stoppedApp])).code, 0)
  assert.equal((await runMaintenance(databasePath, ['backup', '--output', backupPath])).code, 0)

  const result = await runMaintenance(databasePath, ['restore', '--input', backupPath])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /requires --confirm-app-stopped/)
})

test('corrupt or foreign-key-invalid restore input leaves live state unchanged', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  assert.equal((await runMaintenance(databasePath, ['migrate', stoppedApp])).code, 0)
  writeEventTitle(databasePath, 'restore-sentinel', 'live')

  mkdirSync(join(sandbox, 'backups'))
  const corruptPath = join(sandbox, 'backups', 'corrupt.db')
  writeFileSync(corruptPath, 'not a sqlite database')
  const corrupt = await runMaintenance(databasePath, ['restore', '--input', corruptPath, '--confirm-app-stopped'])
  assert.equal(corrupt.code, 1)
  assert.match(corrupt.stderr, /not a valid verified SQLite database/)
  assert.equal(readEventTitle(databasePath, 'restore-sentinel'), 'live')

  const foreignKeyPath = join(sandbox, 'backups', 'foreign-key-invalid.db')
  const invalid = new Database(foreignKeyPath)
  try {
    invalid.pragma('foreign_keys = OFF')
    invalid.exec(
      'create table parent (id integer primary key); create table child (parent_id integer references parent(id)); insert into child (parent_id) values (99)'
    )
  } finally {
    invalid.close()
  }
  const foreignKey = await runMaintenance(databasePath, ['restore', '--input', foreignKeyPath, '--confirm-app-stopped'])
  assert.equal(foreignKey.code, 1)
  assert.match(foreignKey.stderr, /foreign_key_check reported violations/)
  assert.equal(readEventTitle(databasePath, 'restore-sentinel'), 'live')
  assert(!readdirSync(sandbox).some((name) => name.startsWith('.restore-')))
})

test('valid foreign SQLite without the app ledger cannot replace live state', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  const foreignPath = join(sandbox, 'backups', 'foreign.db')
  assert.equal((await runMaintenance(databasePath, ['migrate', stoppedApp])).code, 0)
  writeEventTitle(databasePath, 'restore-sentinel', 'live')
  mkdirSync(join(sandbox, 'backups'))
  const foreign = new Database(foreignPath)
  try {
    foreign.exec("create table foreign_data (value text not null); insert into foreign_data values ('wrong-app')")
  } finally {
    foreign.close()
  }

  const result = await runMaintenance(databasePath, ['restore', '--input', foreignPath, stoppedApp])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /Restore input must contain a recognized non-empty packaged migration ledger/)
  assert.equal(readEventTitle(databasePath, 'restore-sentinel'), 'live')
  assert(!readdirSync(sandbox).some((name) => name.startsWith('.restore-')))
})

test('a changed current schema cannot be verified or restored', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  const invalidPath = join(sandbox, 'backups', 'changed-schema.db')
  assert.equal((await runMaintenance(databasePath, ['migrate', stoppedApp])).code, 0)
  writeEventTitle(databasePath, 'restore-sentinel', 'live')
  assert.equal((await runMaintenance(databasePath, ['backup', '--output', invalidPath])).code, 0)

  const invalid = new Database(invalidPath)
  try {
    invalid.exec('alter table events add column speculative_value text')
  } finally {
    invalid.close()
  }

  const liveBytes = readFileSync(databasePath)
  const invalidBytes = readFileSync(invalidPath)
  for (const [path, args] of [
    [invalidPath, ['verify']],
    [databasePath, ['restore', '--input', invalidPath, stoppedApp]]
  ]) {
    const result = await runMaintenance(path, args)
    assert.equal(result.code, 1)
    assert.match(result.stderr, /does not exactly match the packaged migration prefix: changed table:events/)
  }
  assert.deepEqual(readFileSync(databasePath), liveBytes)
  assert.deepEqual(readFileSync(invalidPath), invalidBytes)
  assert.equal(readEventTitle(databasePath, 'restore-sentinel'), 'live')
})

test('restore fails closed while another connection holds the live database lock', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  const backupPath = join(sandbox, 'backups', 'known-good.db')
  assert.equal((await runMaintenance(databasePath, ['migrate', stoppedApp])).code, 0)
  writeEventTitle(databasePath, 'restore-sentinel', 'live')
  assert.equal((await runMaintenance(databasePath, ['backup', '--output', backupPath])).code, 0)

  const writer = new Database(databasePath)
  try {
    writer.exec('BEGIN EXCLUSIVE')
    const result = await runMaintenance(databasePath, ['restore', '--input', backupPath, stoppedApp])
    assert.equal(result.code, 1)
    assert.match(result.stderr, /database is busy or inaccessible/)
    assert(!readdirSync(sandbox).some((name) => name.startsWith('.restore-quarantine-')))
  } finally {
    if (writer.inTransaction) writer.exec('ROLLBACK')
    writer.close()
  }
  assert.equal(readEventTitle(databasePath, 'restore-sentinel'), 'live')
})

test('valid restore replaces healthy state from a current-baseline backup', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  const backupPath = join(sandbox, 'backups', 'known-good.db')
  assert.equal((await runMaintenance(databasePath, ['migrate', stoppedApp])).code, 0)
  writeEventTitle(databasePath, 'restore-sentinel', 'known-good')
  writeRestoreDomainFixture(databasePath)
  assert.equal((await runMaintenance(databasePath, ['backup', '--output', backupPath])).code, 0)
  writeEventTitle(databasePath, 'restore-sentinel', 'mutated-live')
  mutateRestoreDomainFixture(databasePath)

  const restored = await runMaintenance(databasePath, ['restore', '--input', backupPath, '--confirm-app-stopped'])
  assert.equal(restored.code, 0)
  assert.match(restored.stdout, /known-good\.db restored and migrated/)
  assert.match(restored.stdout, /pre-restore backup written as app-pre-restore-/)
  assert.equal(readEventTitle(databasePath, 'restore-sentinel'), 'known-good')
  const sqlite = new Database(databasePath, { readonly: true })
  try {
    assert.equal(sqlite.prepare('select count(*) as count from __drizzle_migrations').get().count, finalMigrationCount)
    assert.deepEqual(sqlite.prepare("select title, visibility from events where id = 'restore-event'").get(), {
      title: 'Member meeting',
      visibility: 'members'
    })
    assert.deepEqual(
      sqlite.prepare("select status, delivery_mode, starts_at from event_sessions where id = 'restore-session'").get(),
      {
        status: 'scheduled',
        delivery_mode: 'hybrid',
        starts_at: '2026-09-15T18:00:00.000Z'
      }
    )
    assert.equal(sqlite.prepare("select value from event_tags where event_id = 'restore-event'").get().value, 'general')
    assert.equal(
      sqlite.prepare("select external_id from event_provider_links where event_id = 'restore-event'").get().external_id,
      'solidarity-restore-event'
    )
    assert.equal(
      sqlite
        .prepare(
          "select paired_external_id from event_session_provider_links where event_session_id = 'restore-session'"
        )
        .get().paired_external_id,
      'solidarity-restore-virtual'
    )
    assert.equal(
      sqlite
        .prepare(
          "select count(*) as count from sqlite_schema where type = 'table' and name in ('user', 'session', 'files', 'billing_subscriptions')"
        )
        .get().count,
      0
    )
  } finally {
    sqlite.close()
  }
  assert(!existsSync(`${databasePath}-wal`))
  assert(!existsSync(`${databasePath}-shm`))
  assert(!existsSync(`${databasePath}-journal`))
  assert(!readdirSync(sandbox).some((name) => name.startsWith('.restore-quarantine-')))

  const verified = await runMaintenance(databasePath, ['verify'])
  assert.equal(verified.code, 0)
  assert.match(verified.stdout, /integrity ok; foreign keys ok/)
})

test('valid restore recovers a corrupt live database and retains its complete raw state', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  const backupPath = join(sandbox, 'backups', 'known-good.db')
  assert.equal((await runMaintenance(databasePath, ['migrate', stoppedApp])).code, 0)
  writeEventTitle(databasePath, 'restore-sentinel', 'known-good')
  assert.equal((await runMaintenance(databasePath, ['backup', '--output', backupPath])).code, 0)
  writeFileSync(databasePath, 'corrupt-live-database')
  writeFileSync(`${databasePath}-wal`, 'corrupt-live-wal')
  writeFileSync(`${databasePath}-shm`, 'corrupt-live-shm')
  writeFileSync(`${databasePath}-journal`, 'corrupt-live-journal')

  const restored = await runMaintenance(databasePath, ['restore', '--input', backupPath, stoppedApp])
  assert.equal(restored.code, 0, restored.stderr)
  assert.match(restored.stdout, /pre-restore backup not available; prior state retained as \.restore-quarantine-/)
  assert.equal(readEventTitle(databasePath, 'restore-sentinel'), 'known-good')

  const quarantine = readdirSync(sandbox).find((name) => name.startsWith('.restore-quarantine-'))
  assert(quarantine)
  assert.equal(readFileSync(join(sandbox, quarantine, 'app.db'), 'utf8'), 'corrupt-live-database')
  assert(readFileSync(join(sandbox, quarantine, 'app.db-wal')).length > 0)
  assert(readFileSync(join(sandbox, quarantine, 'app.db-shm')).length > 0)
  assert(readFileSync(join(sandbox, quarantine, 'app.db-journal')).length > 0)
  assert.equal(statSync(join(sandbox, quarantine)).mode & 0o777, 0o700)
})

test('valid restore retains orphaned live sidecars when the main database is missing', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  const backupPath = join(sandbox, 'backups', 'known-good.db')
  assert.equal((await runMaintenance(databasePath, ['migrate', stoppedApp])).code, 0)
  writeEventTitle(databasePath, 'restore-sentinel', 'known-good')
  assert.equal((await runMaintenance(databasePath, ['backup', '--output', backupPath])).code, 0)
  rmSync(databasePath)
  writeFileSync(`${databasePath}-wal`, 'orphaned-live-wal')
  writeFileSync(`${databasePath}-shm`, 'orphaned-live-shm')
  writeFileSync(`${databasePath}-journal`, 'orphaned-live-journal')

  const restored = await runMaintenance(databasePath, ['restore', '--input', backupPath, stoppedApp])
  assert.equal(restored.code, 0, restored.stderr)
  assert.match(restored.stdout, /pre-restore backup not available; prior state retained as \.restore-quarantine-/)
  assert.equal(readEventTitle(databasePath, 'restore-sentinel'), 'known-good')

  const quarantine = readdirSync(sandbox).find((name) => name.startsWith('.restore-quarantine-'))
  assert(quarantine)
  assert(!existsSync(join(sandbox, quarantine, 'app.db')))
  assert.equal(readFileSync(join(sandbox, quarantine, 'app.db-wal'), 'utf8'), 'orphaned-live-wal')
  assert.equal(readFileSync(join(sandbox, quarantine, 'app.db-shm'), 'utf8'), 'orphaned-live-shm')
  assert.equal(readFileSync(join(sandbox, quarantine, 'app.db-journal'), 'utf8'), 'orphaned-live-journal')
  assert.equal(statSync(join(sandbox, quarantine)).mode & 0o777, 0o700)
})

test('post-install failure rolls the complete prior database state back', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  const backupPath = join(sandbox, 'backups', 'known-good.db')
  assert.equal((await runMaintenance(databasePath, ['migrate', stoppedApp])).code, 0)
  writeEventTitle(databasePath, 'rollback-sentinel', 'known-good')
  assert.equal((await runMaintenance(databasePath, ['backup', '--output', backupPath])).code, 0)
  writeFileSync(databasePath, '')
  const priorDatabase = readFileSync(databasePath)
  writeFileSync(`${databasePath}-wal`, 'rollback-wal')
  writeFileSync(`${databasePath}-shm`, 'rollback-shm')
  writeFileSync(`${databasePath}-journal`, 'rollback-journal')

  const failed = await runMaintenance(databasePath, ['restore', '--input', backupPath, stoppedApp], {
    NODE_ENV: 'test',
    SWL_MAINTENANCE_TEST_FAIL_AFTER_INSTALL: '1'
  })
  assert.equal(failed.code, 1)
  assert.match(failed.stderr, /Injected post-install failure/)
  assert.deepEqual(readFileSync(databasePath), priorDatabase)
  assert.equal(readFileSync(`${databasePath}-wal`, 'utf8'), 'rollback-wal')
  assert.equal(readFileSync(`${databasePath}-shm`, 'utf8'), 'rollback-shm')
  assert.equal(readFileSync(`${databasePath}-journal`, 'utf8'), 'rollback-journal')
  assert(!readdirSync(sandbox).some((name) => name.startsWith('.restore-quarantine-')))
})

function disposableDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'swl-maintenance-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

function writeEventTitle(databasePath, id, title) {
  const sqlite = new Database(databasePath)
  try {
    sqlite
      .prepare(
        `insert into events (id, title, kind) values (?, ?, 'meeting')
      on conflict(id) do update set title = excluded.title`
      )
      .run(id, title)
  } finally {
    sqlite.close()
  }
}

function readEventTitle(databasePath, id) {
  const sqlite = new Database(databasePath, { readonly: true })
  try {
    return sqlite.prepare('select title from events where id = ?').get(id).title
  } finally {
    sqlite.close()
  }
}

function writeRestoreDomainFixture(databasePath) {
  const sqlite = new Database(databasePath)
  try {
    sqlite.pragma('foreign_keys = ON')
    sqlite.exec(`
      insert into events (id, title, kind, visibility)
        values ('restore-event', 'Member meeting', 'meeting', 'members');
      insert into event_sessions (id, event_id, delivery_mode, starts_at, timezone)
        values ('restore-session', 'restore-event', 'hybrid', '2026-09-15T18:00:00.000Z', 'America/Los_Angeles');
      insert into event_tags (event_id, kind, value) values ('restore-event', 'event', 'general');
      insert into event_provider_links (id, event_id, provider, external_id, last_seen_at)
        values ('restore-event-link', 'restore-event', 'solidarity', 'solidarity-restore-event', '2026-09-11T12:00:00.000Z');
      insert into event_session_provider_links (id, event_session_id, provider, external_id, paired_external_id, last_seen_at)
        values ('restore-session-link', 'restore-session', 'solidarity', 'solidarity-restore-session', 'solidarity-restore-virtual', '2026-09-11T12:00:00.000Z');
    `)
  } finally {
    sqlite.close()
  }
}

function mutateRestoreDomainFixture(databasePath) {
  const sqlite = new Database(databasePath)
  try {
    sqlite.exec(`
      update events set title = 'Changed meeting', visibility = 'public' where id = 'restore-event';
      update event_sessions set status = 'canceled' where id = 'restore-session';
      delete from event_tags;
      delete from event_session_provider_links;
      delete from event_provider_links;
    `)
  } finally {
    sqlite.close()
  }
}

function runMaintenance(databasePath, args, environment = {}) {
  return runProcess(args, { ...environment, NUXT_DATABASE_URL: `file:${databasePath}` })
}

function runPublicMigration(databaseUrl) {
  return runExecutable(process.execPath, [runPnpm, 'run', 'db:migrate'], {
    NUXT_DATABASE_URL: databaseUrl
  })
}

async function runProcess(args, environment, executable = entry) {
  return runExecutable(process.execPath, [executable, ...args], environment)
}

async function runExecutable(executable, args, environment) {
  try {
    const { stdout, stderr } = await execFileAsync(executable, args, {
      encoding: 'utf8',
      env: withEnvironment(environment),
      timeout: 30_000
    })
    return { code: 0, stderr, stdout }
  } catch (error) {
    if (typeof error?.code !== 'number') throw error
    return { code: error.code, stderr: error.stderr ?? '', stdout: error.stdout ?? '' }
  }
}

function withEnvironment(overrides) {
  const environment = { ...process.env }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete environment[key]
    else environment[key] = value
  }
  return environment
}
