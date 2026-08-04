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
const { drizzle } = require('../node_modules/drizzle-orm/better-sqlite3')
const { migrate } = require('../node_modules/drizzle-orm/better-sqlite3/migrator')
const entry = resolve('server/maintenance.mjs')
const migrationsFolder = resolve('server/db/migrations')
const runPnpm = resolve('scripts/run-pnpm.mjs')
const stoppedApp = '--confirm-app-stopped'
const finalMigrationCount = 4

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
  assert.match(fresh.stdout, /4 newly applied; 4\/4 current; pre-migration backup not required/)
  assert.equal(fresh.stderr, '')

  writeSetting(databasePath, 'migration-sentinel', 'preserved')
  const repeat = await runMaintenance(databasePath, ['migrate', stoppedApp])
  assert.equal(repeat.code, 0)
  assert.match(repeat.stdout, /0 newly applied; 4\/4 current; pre-migration backup written as app-pre-migrate-/)
  assert.equal(readSetting(databasePath, 'migration-sentinel'), 'preserved')
  assert.equal(readdirSync(join(sandbox, 'backups')).filter((name) => name.includes('pre-migrate')).length, 1)

  const sqlite = new Database(databasePath, { readonly: true })
  try {
    const migrations = sqlite.prepare('select count(*) as count from __drizzle_migrations').get()
    assert.equal(migrations.count, finalMigrationCount)
    assert.equal(
      sqlite.prepare("select count(*) as count from sqlite_master where type = 'table' and name = 'projects'").get()
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
    sqlite.exec('drop index session_token_idx')
  } finally {
    sqlite.close()
  }

  const result = await runMaintenance(databasePath, ['verify'])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /does not exactly match the packaged migration prefix: missing index:session_token_idx/)
})

test('same-named weakened authority triggers cannot be verified, backed up, or restored', async (t) => {
  const sandbox = disposableDirectory(t)
  const weakenedDirectory = join(sandbox, 'weakened')
  const weakenedDatabasePath = join(weakenedDirectory, 'app.db')
  mkdirSync(weakenedDirectory)
  assert.equal((await runMaintenance(weakenedDatabasePath, ['migrate', stoppedApp])).code, 0)
  writeSetting(weakenedDatabasePath, 'weakened-trigger-sentinel', 'preserved')

  const weakened = new Database(weakenedDatabasePath)
  try {
    weakened.exec(`
      drop trigger member_family_capacity_before_insert;
      create trigger member_family_capacity_before_insert
      before insert on member
      begin
        select 1;
      end;
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
      /does not exactly match the packaged migration prefix: changed trigger:member_family_capacity_before_insert/
    )
    assert.deepEqual(readFileSync(weakenedDatabasePath), weakenedBytes)
    assert.equal(readSetting(weakenedDatabasePath, 'weakened-trigger-sentinel'), 'preserved')
  }
  assert(!existsSync(join(weakenedDirectory, 'backups')))

  const liveDirectory = join(sandbox, 'live')
  const liveDatabasePath = join(liveDirectory, 'app.db')
  const restoreInputPath = join(liveDirectory, 'backups', 'weakened-trigger.db')
  mkdirSync(join(liveDirectory, 'backups'), { recursive: true })
  assert.equal((await runMaintenance(liveDatabasePath, ['migrate', stoppedApp])).code, 0)
  writeSetting(liveDatabasePath, 'live-trigger-sentinel', 'preserved')
  cpSync(weakenedDatabasePath, restoreInputPath)
  const liveBytes = readFileSync(liveDatabasePath)
  const restoreInputBytes = readFileSync(restoreInputPath)

  const restore = await runMaintenance(liveDatabasePath, ['restore', '--input', restoreInputPath, stoppedApp])
  assert.equal(restore.code, 1)
  assert.match(
    restore.stderr,
    /does not exactly match the packaged migration prefix: changed trigger:member_family_capacity_before_insert/
  )
  assert.deepEqual(readFileSync(liveDatabasePath), liveBytes)
  assert.deepEqual(readFileSync(restoreInputPath), restoreInputBytes)
  assert.equal(readSetting(liveDatabasePath, 'live-trigger-sentinel'), 'preserved')
  assert.deepEqual(readdirSync(join(liveDirectory, 'backups')), ['weakened-trigger.db'])
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
      drifted
        .prepare("select count(*) as count from sqlite_master where type = 'table' and name = 'app_settings'")
        .get().count,
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
  writeSetting(databasePath, 'drift-sentinel', 'preserved')
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
    assert.equal(
      JSON.parse(unchanged.prepare("select value from app_settings where key = 'drift-sentinel'").get().value),
      'preserved'
    )
  } finally {
    unchanged.close()
  }
  assert(!existsSync(join(sandbox, 'backups')))
})

test('migration rejects an incomplete internal baseline before backup or mutation', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  createRelationalBaselineOnlyDatabase(databasePath, sandbox)

  const partial = new Database(databasePath)
  try {
    partial
      .prepare('insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, 1, 1)')
      .run('partial-user', 'Partial User', 'partial@example.test')
  } finally {
    partial.close()
  }

  const result = await runMaintenance(databasePath, ['migrate', stoppedApp])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /must contain the complete supported pre-release initialization baseline/)
  assert(!existsSync(join(sandbox, 'backups')))

  const unchanged = new Database(databasePath, { readonly: true })
  try {
    assert.equal(unchanged.prepare('select count(*) as count from __drizzle_migrations').get().count, 1)
    assert.equal(unchanged.prepare('select count(*) as count from user').get().count, 1)
    assert.equal(unchanged.prepare('select count(*) as count from organization').get().count, 0)
  } finally {
    unchanged.close()
  }
})

test('the documented migration command uses maintenance for relative URLs and rejects incomplete state', async (t) => {
  const sandbox = disposableDirectory(t)
  const freshDatabasePath = join(sandbox, 'fresh.db')
  const appDirectory = resolve('.')
  const freshRelativeUrl = `file:${relative(appDirectory, freshDatabasePath)}`

  const fresh = await runPublicMigration(freshRelativeUrl)
  assert.equal(fresh.code, 0, fresh.stderr)
  assert.match(fresh.stdout, /4 newly applied; 4\/4 current/)

  const incompleteDatabasePath = join(sandbox, 'incomplete.db')
  createRelationalBaselineOnlyDatabase(incompleteDatabasePath, sandbox)
  const incomplete = await runPublicMigration(`file:${incompleteDatabasePath}`)
  assert.equal(incomplete.code, 1)
  assert.match(incomplete.stderr, /must contain the complete supported pre-release initialization baseline/)

  const unchanged = new Database(incompleteDatabasePath, { readonly: true })
  try {
    assert.equal(unchanged.prepare('select count(*) as count from __drizzle_migrations').get().count, 1)
  } finally {
    unchanged.close()
  }

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
      rolledBack
        .prepare("select count(*) as count from sqlite_master where type = 'table' and name = 'app_settings'")
        .get().count,
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
    join(fixtureMigrations, '0001_runtime_invariants.sql'),
    '\n--> statement-breakpoint\nselect * from injected_missing_migration_table;\n'
  )

  const failed = await runProcess(['migrate', stoppedApp], { NUXT_DATABASE_URL: 'file:' + databasePath }, fixtureEntry)
  assert.equal(failed.code, 1)
  assert.match(failed.stderr, /injected_missing_migration_table/)
  const rolledBack = new Database(databasePath, { readonly: true })
  try {
    assert.equal(rolledBack.prepare('select count(*) as count from __drizzle_migrations').get().count, 0)
    assert.equal(
      rolledBack
        .prepare("select count(*) as count from sqlite_master where type = 'table' and name = 'app_settings'")
        .get().count,
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
      unchanged
        .prepare("select count(*) as count from sqlite_master where type = 'table' and name = 'app_settings'")
        .get().count,
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
  writeSetting(databasePath, 'backup-sentinel', 'snapshot')

  const backup = await runMaintenance(databasePath, ['backup', '--output', outputPath])
  assert.equal(backup.code, 0)
  assert.match(backup.stdout, /Backup passed: snapshot\.db; integrity ok; foreign keys ok/)
  assert.equal(readSetting(outputPath, 'backup-sentinel'), 'snapshot')
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
  writeSetting(databasePath, 'restore-sentinel', 'live')

  mkdirSync(join(sandbox, 'backups'))
  const corruptPath = join(sandbox, 'backups', 'corrupt.db')
  writeFileSync(corruptPath, 'not a sqlite database')
  const corrupt = await runMaintenance(databasePath, ['restore', '--input', corruptPath, '--confirm-app-stopped'])
  assert.equal(corrupt.code, 1)
  assert.match(corrupt.stderr, /not a valid verified SQLite database/)
  assert.equal(readSetting(databasePath, 'restore-sentinel'), 'live')

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
  assert.equal(readSetting(databasePath, 'restore-sentinel'), 'live')
  assert(!readdirSync(sandbox).some((name) => name.startsWith('.restore-')))
})

test('valid foreign SQLite without the app ledger cannot replace live state', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  const foreignPath = join(sandbox, 'backups', 'foreign.db')
  assert.equal((await runMaintenance(databasePath, ['migrate', stoppedApp])).code, 0)
  writeSetting(databasePath, 'restore-sentinel', 'live')
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
  assert.equal(readSetting(databasePath, 'restore-sentinel'), 'live')
  assert(!readdirSync(sandbox).some((name) => name.startsWith('.restore-')))
})

test('a changed current schema cannot be verified or restored', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  const invalidPath = join(sandbox, 'backups', 'changed-schema.db')
  assert.equal((await runMaintenance(databasePath, ['migrate', stoppedApp])).code, 0)
  writeSetting(databasePath, 'restore-sentinel', 'live')
  assert.equal((await runMaintenance(databasePath, ['backup', '--output', invalidPath])).code, 0)

  const invalid = new Database(invalidPath)
  try {
    invalid.exec('alter table app_settings add column speculative_value text')
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
    assert.match(result.stderr, /does not exactly match the packaged migration prefix: changed table:app_settings/)
  }
  assert.deepEqual(readFileSync(databasePath), liveBytes)
  assert.deepEqual(readFileSync(invalidPath), invalidBytes)
  assert.equal(readSetting(databasePath, 'restore-sentinel'), 'live')
})

test('restore fails closed while another connection holds the live database lock', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  const backupPath = join(sandbox, 'backups', 'known-good.db')
  assert.equal((await runMaintenance(databasePath, ['migrate', stoppedApp])).code, 0)
  writeSetting(databasePath, 'restore-sentinel', 'live')
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
  assert.equal(readSetting(databasePath, 'restore-sentinel'), 'live')
})

test('valid restore replaces healthy state from a current-baseline backup', async (t) => {
  const sandbox = disposableDirectory(t)
  const databasePath = join(sandbox, 'app.db')
  const backupPath = join(sandbox, 'backups', 'known-good.db')
  assert.equal((await runMaintenance(databasePath, ['migrate', stoppedApp])).code, 0)
  writeSetting(databasePath, 'restore-sentinel', 'known-good')
  writeRestoreDomainFixture(databasePath)
  assert.equal((await runMaintenance(databasePath, ['backup', '--output', backupPath])).code, 0)
  writeSetting(databasePath, 'restore-sentinel', 'mutated-live')
  mutateRestoreDomainFixture(databasePath)

  const restored = await runMaintenance(databasePath, ['restore', '--input', backupPath, '--confirm-app-stopped'])
  assert.equal(restored.code, 0)
  assert.match(restored.stdout, /known-good\.db restored and migrated/)
  assert.match(restored.stdout, /restored sessions and one-time verifications invalidated/)
  assert.match(restored.stdout, /pre-restore backup written as app-pre-restore-/)
  assert.equal(readSetting(databasePath, 'restore-sentinel'), 'known-good')
  const sqlite = new Database(databasePath, { readonly: true })
  try {
    assert.equal(sqlite.prepare('select count(*) as count from __drizzle_migrations').get().count, finalMigrationCount)
    assert.equal(
      sqlite.prepare("select count(*) as count from pragma_table_info('job_queue') where name = 'max_attempts'").get()
        .count,
      1
    )
    assert.equal(sqlite.prepare("select name from user where id = 'restore-user'").get().name, 'Restore User')
    assert.equal(sqlite.prepare("select count(*) as count from account where user_id = 'restore-user'").get().count, 1)
    assert.equal(
      sqlite.prepare("select count(*) as count from organization where personal_owner_user_id = 'restore-user'").get()
        .count,
      1
    )
    assert.equal(
      sqlite.prepare("select count(*) as count from member where user_id = 'restore-user' and role = 'owner'").get()
        .count,
      1
    )
    assert.equal(
      sqlite.prepare("select count(*) as count from invitation where id = 'restore-invitation'").get().count,
      1
    )
    assert.equal(
      sqlite.prepare("select name from projects where id = 'restore-project'").get().name,
      'Restored project'
    )
    assert.equal(
      sqlite.prepare("select status from billing_subscriptions where id = 'restore-subscription'").get().status,
      'active'
    )
    assert.equal(
      sqlite.prepare("select count(*) as count from detached_billing_subjects where id = 'restore-tombstone'").get()
        .count,
      1
    )
    assert.equal(sqlite.prepare("select status from files where id = 'restore-file'").get().status, 'ready')
    assert.equal(
      sqlite.prepare('select count(*) as count from ai_messages where conversation_id = ?').get(restoreConversationId)
        .count,
      2
    )
    assert.equal(
      sqlite
        .prepare('select count(*) as count from ai_message_file_citations where message_id = ?')
        .get(restoreAssistantMessageId).count,
      1
    )
    assert.equal(
      sqlite
        .prepare('select count(*) as count from ai_message_web_citations where message_id = ?')
        .get(restoreAssistantMessageId).count,
      1
    )
    assert.equal(
      sqlite.prepare("select request_count from ai_usage_buckets where owner_user_id = 'restore-user'").get()
        .request_count,
      1
    )
    assert.equal(sqlite.prepare("select count(*) as count from session where user_id = 'restore-user'").get().count, 0)
    assert.equal(
      sqlite.prepare("select count(*) as count from verification where identifier = 'restore-verification'").get()
        .count,
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
  writeSetting(databasePath, 'restore-sentinel', 'known-good')
  assert.equal((await runMaintenance(databasePath, ['backup', '--output', backupPath])).code, 0)
  writeFileSync(databasePath, 'corrupt-live-database')
  writeFileSync(`${databasePath}-wal`, 'corrupt-live-wal')
  writeFileSync(`${databasePath}-shm`, 'corrupt-live-shm')
  writeFileSync(`${databasePath}-journal`, 'corrupt-live-journal')

  const restored = await runMaintenance(databasePath, ['restore', '--input', backupPath, stoppedApp])
  assert.equal(restored.code, 0, restored.stderr)
  assert.match(restored.stdout, /pre-restore backup not available; prior state retained as \.restore-quarantine-/)
  assert.equal(readSetting(databasePath, 'restore-sentinel'), 'known-good')

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
  writeSetting(databasePath, 'restore-sentinel', 'known-good')
  assert.equal((await runMaintenance(databasePath, ['backup', '--output', backupPath])).code, 0)
  rmSync(databasePath)
  writeFileSync(`${databasePath}-wal`, 'orphaned-live-wal')
  writeFileSync(`${databasePath}-shm`, 'orphaned-live-shm')
  writeFileSync(`${databasePath}-journal`, 'orphaned-live-journal')

  const restored = await runMaintenance(databasePath, ['restore', '--input', backupPath, stoppedApp])
  assert.equal(restored.code, 0, restored.stderr)
  assert.match(restored.stdout, /pre-restore backup not available; prior state retained as \.restore-quarantine-/)
  assert.equal(readSetting(databasePath, 'restore-sentinel'), 'known-good')

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
  writeSetting(databasePath, 'rollback-sentinel', 'known-good')
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

function writeSetting(databasePath, key, value) {
  const sqlite = new Database(databasePath)
  try {
    sqlite
      .prepare(
        'insert into app_settings (key, value) values (?, json_quote(?)) on conflict(key) do update set value = excluded.value'
      )
      .run(key, value)
  } finally {
    sqlite.close()
  }
}

function readSetting(databasePath, key) {
  const sqlite = new Database(databasePath, { readonly: true })
  try {
    return JSON.parse(sqlite.prepare('select value from app_settings where key = ?').get(key).value)
  } finally {
    sqlite.close()
  }
}

const restoreConversationId = 'ai_conversation_123e4567-e89b-42d3-a456-426614174000'
const restoreUserMessageId = 'ai_message_123e4567-e89b-42d3-a456-426614174001'
const restoreAssistantMessageId = 'ai_message_123e4567-e89b-42d3-a456-426614174002'

function writeRestoreDomainFixture(databasePath) {
  const sqlite = new Database(databasePath)
  try {
    sqlite.pragma('foreign_keys = ON')
    sqlite
      .prepare('insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, ?, ?, ?)')
      .run('restore-user', 'Restore User', 'restore@example.test', 1, 1784200000000, 1784200000000)
    sqlite
      .prepare(
        'insert into account (id, account_id, provider_id, user_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?)'
      )
      .run('restore-account', 'restore@example.test', 'credential', 'restore-user', 1784200000000, 1784200000000)
    sqlite
      .prepare('insert into session (id, expires_at, token, created_at, updated_at, user_id) values (?, ?, ?, ?, ?, ?)')
      .run('restore-session', 1884200000000, 'restore-session-token', 1784200000000, 1784200000000, 'restore-user')
    sqlite
      .prepare(
        'insert into verification (id, identifier, value, expires_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?)'
      )
      .run(
        'restore-verification-row',
        'restore-verification',
        'restore-one-time-secret',
        1884200000000,
        1784200000000,
        1784200000000
      )
    const organizationId = sqlite
      .prepare("select id from organization where personal_owner_user_id = 'restore-user'")
      .get().id
    sqlite
      .prepare(
        'insert into invitation (id, organization_id, email, role, status, expires_at, created_at, inviter_id) values (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        'restore-invitation',
        organizationId,
        'invitee@example.test',
        'member',
        'pending',
        1884200000000,
        1784200000000,
        'restore-user'
      )
    sqlite
      .prepare('insert into projects (id, name, owner_user_id, created_at, updated_at) values (?, ?, ?, ?, ?)')
      .run(
        'restore-project',
        'Restored project',
        'restore-user',
        '2026-07-16T12:00:00.000Z',
        '2026-07-16T12:00:00.000Z'
      )
    sqlite
      .prepare(
        'insert into billing_customers (id, organization_id, stripe_customer_id, created_at, updated_at) values (?, ?, ?, ?, ?)'
      )
      .run('restore-customer', organizationId, 'cus_restore', '2026-07-16T12:00:00.000Z', '2026-07-16T12:00:00.000Z')
    sqlite
      .prepare(
        `insert into billing_subscriptions (
          id, organization_id, billing_customer_id, stripe_subscription_id, stripe_subscription_item_id,
          status, plan_key, cadence, stripe_price_id, current_period_start, current_period_end,
          created_at, updated_at
        ) values (?, ?, ?, ?, ?, 'active', 'family', 'monthly', ?, ?, ?, ?, ?)`
      )
      .run(
        'restore-subscription',
        organizationId,
        'restore-customer',
        'sub_restore',
        'si_restore',
        'price_restore',
        '2026-07-16T00:00:00.000Z',
        '2026-08-16T00:00:00.000Z',
        '2026-07-16T12:00:00.000Z',
        '2026-07-16T12:00:00.000Z'
      )
    sqlite
      .prepare(
        `insert into detached_billing_subjects (
          id, provider, provider_reference, provider_customer_reference, provider_status,
          status_updated_at, deleted_at, retention_purpose, retention_policy, purge_after
        ) values (?, 'stripe', ?, ?, 'active', ?, ?, 'external_billing_reconciliation', ?, ?)`
      )
      .run(
        'restore-tombstone',
        'sub_deleted_restore',
        'cus_deleted_restore',
        '2026-07-16T12:00:00.000Z',
        '2026-07-16T12:00:00.000Z',
        'stripe_billing_lifecycle',
        '2026-08-16T12:00:00.000Z'
      )
    sqlite.prepare('insert into app_settings (key, value) values (?, ?)').run(
      'files.storage-binding.v1',
      JSON.stringify({
        version: 1,
        driver: 'r2',
        bucket: 'restore-private-files',
        endpoint: 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.r2.cloudflarestorage.com'
      })
    )
    sqlite
      .prepare(
        `insert into files (
          id, owner_id, bucket, object_key, original_name, content_type, byte_size,
          content_md5, status, upload_expires_at, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)`
      )
      .run(
        'restore-file',
        'restore-user',
        'restore-private-files',
        'files/v1/file_123e4567-e89b-42d3-a456-426614174003',
        'restore.txt',
        'text/plain',
        7,
        'Mhw89IbtUJFk7eweGYH+yA==',
        '2026-07-16T13:00:00.000Z',
        '2026-07-16T12:00:00.000Z',
        '2026-07-16T12:00:00.000Z'
      )
    sqlite
      .prepare(
        `insert into ai_conversations (
          id, owner_user_id, history_revision, next_sequence, created_at, updated_at
        ) values (?, ?, 1, 3, ?, ?)`
      )
      .run(restoreConversationId, 'restore-user', '2026-07-16T12:00:00.000Z', '2026-07-16T12:00:00.000Z')
    const insertMessage = sqlite.prepare(
      'insert into ai_messages (id, conversation_id, sequence, role, content, created_at) values (?, ?, ?, ?, ?, ?)'
    )
    insertMessage.run(
      restoreUserMessageId,
      restoreConversationId,
      1,
      'user',
      'Restore this private prompt',
      '2026-07-16T12:00:00.000Z'
    )
    insertMessage.run(
      restoreAssistantMessageId,
      restoreConversationId,
      2,
      'assistant',
      'Restore this private answer',
      '2026-07-16T12:00:01.000Z'
    )
    sqlite
      .prepare('insert into ai_message_file_citations (message_id, ordinal, title) values (?, 1, ?)')
      .run(restoreAssistantMessageId, 'Recovery source')
    sqlite
      .prepare(
        'insert into ai_message_web_citations (message_id, ordinal, title, url, start_index, end_index) values (?, 1, ?, ?, 0, 7)'
      )
      .run(restoreAssistantMessageId, 'Recovery web source', 'https://example.test/recovery')
    sqlite
      .prepare(
        `insert into ai_usage_buckets (
          owner_user_id, bucket_date, request_count, input_tokens, output_tokens,
          reasoning_tokens, cached_input_tokens, cache_write_tokens, created_at, updated_at
        ) values (?, '2026-07-16', 1, 4, 5, 0, 0, 0, ?, ?)`
      )
      .run('restore-user', '2026-07-16T12:00:00.000Z', '2026-07-16T12:00:00.000Z')
  } finally {
    sqlite.close()
  }
}

function mutateRestoreDomainFixture(databasePath) {
  const sqlite = new Database(databasePath)
  try {
    sqlite.pragma('foreign_keys = ON')
    sqlite.prepare("update user set name = 'Changed User' where id = 'restore-user'").run()
    sqlite.prepare("delete from account where user_id = 'restore-user'").run()
    sqlite.prepare("delete from session where user_id = 'restore-user'").run()
    sqlite.prepare("delete from verification where identifier = 'restore-verification'").run()
    sqlite.prepare("delete from invitation where id = 'restore-invitation'").run()
    sqlite.prepare("delete from projects where id = 'restore-project'").run()
    sqlite.prepare("delete from billing_customers where id = 'restore-customer'").run()
    sqlite.prepare("delete from detached_billing_subjects where id = 'restore-tombstone'").run()
    sqlite.prepare("delete from files where id = 'restore-file'").run()
    sqlite.prepare('delete from ai_conversations where id = ?').run(restoreConversationId)
    sqlite.prepare("delete from ai_usage_buckets where owner_user_id = 'restore-user'").run()
  } finally {
    sqlite.close()
  }
}

function createRelationalBaselineOnlyDatabase(databasePath, sandbox) {
  const partialMigrations = join(sandbox, 'relational-baseline-only')
  const partialMeta = join(partialMigrations, 'meta')
  mkdirSync(partialMeta, { recursive: true })
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'))
  const firstEntry = journal.entries[0]
  assert(firstEntry, 'expected the generated relational baseline migration')
  writeFileSync(join(partialMeta, '_journal.json'), JSON.stringify({ ...journal, entries: [firstEntry] }))
  cpSync(join(migrationsFolder, `${firstEntry.tag}.sql`), join(partialMigrations, `${firstEntry.tag}.sql`))

  const sqlite = new Database(databasePath)
  try {
    sqlite.pragma('foreign_keys = ON')
    migrate(drizzle({ client: sqlite }), { migrationsFolder: partialMigrations })
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
