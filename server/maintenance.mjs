import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, linkSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const migrationsFolder = fileURLToPath(new URL('./db/migrations/', import.meta.url))
const supportedInitializationBaselineCount = 2
const packagedApplicationSchemas = new Map()

class DatabaseVerificationError extends Error {}
class DatabaseAccessError extends Error {}

try {
  await run(process.argv.slice(2), process.env)
} catch (error) {
  console.error(`Maintenance failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}

async function run(args, environment) {
  const command = args[0]
  const databasePath = readDatabasePath(environment)
  const dataDirectory = dirname(databasePath)

  if (command === 'migrate') {
    requireStoppedAppConfirmation(args.slice(1), 'Migration')
    assertLiveDatabaseEntries(databasePath)
    assertNoOrphanSidecarsForFreshDatabase(databasePath)
    if (isPopulatedFile(databasePath)) verifyAppDatabaseIdentity(databasePath, 'Existing database')
    assertDatabaseCanBeReplaced(databasePath)
    const result = await migrateDatabase(databasePath, dataDirectory, { backupExisting: true })
    console.log(
      `Migration passed: ${result.applied} newly applied; ${result.current}/${result.available} current; pre-migration backup ${result.backup ? `written as ${basename(result.backup)}` : 'not required'}.`
    )
    return
  }

  if (command === 'backup') {
    verifyDatabase(databasePath)
    verifyMigrationLedger(databasePath)
    const options = parseValuedOptions(args.slice(1), new Set(['--output']))
    const outputPath = options.get('--output')
      ? resolveBackupPath(dataDirectory, options.get('--output'), 'Backup output')
      : defaultBackupPath(databasePath, dataDirectory, 'backup')
    const backup = await backupDatabase(databasePath, outputPath, dataDirectory)
    verifyMigrationLedger(backup)
    console.log(`Backup passed: ${basename(backup)}; integrity ok; foreign keys ok; migration ledger current.`)
    return
  }

  if (command === 'verify' && args.length === 1) {
    verifyDatabase(databasePath)
    verifyMigrationLedger(databasePath)
    console.log('Database verification passed: integrity ok; foreign keys ok; migration ledger current.')
    return
  }

  if (command === 'verify-backup') {
    const { input, requireCurrent, requireOffHostCoverage, backupR2Bucket } = parseVerifyBackupOptions(args.slice(1))
    const inputPath = resolveBackupPath(dataDirectory, input, 'Backup verification input', { mustExist: true })
    verifyDatabase(inputPath)
    if (requireCurrent) {
      verifyMigrationLedger(inputPath)
    } else {
      verifyAppDatabaseIdentity(inputPath, 'Backup verification input')
    }
    if (requireOffHostCoverage) assertOffHostBackupCoverage(inputPath, backupR2Bucket)
    console.log(
      `Backup verification passed: ${basename(inputPath)}; integrity ok; foreign keys ok; migration ledger ${requireCurrent ? 'current' : 'recognized'}${requireOffHostCoverage ? '; off-host Files coverage ok' : ''}.`
    )
    return
  }

  if (command === 'restore') {
    const { input, confirmed } = parseRestoreOptions(args.slice(1))
    if (!confirmed) {
      throw new Error('Restore requires --confirm-app-stopped after the application has been stopped.')
    }
    const inputPath = resolveBackupPath(dataDirectory, input, 'Restore input', { mustExist: true })
    const result = await restoreDatabase(databasePath, inputPath, dataDirectory, {
      failAfterInstall: environment.NODE_ENV === 'test' && environment.SWL_MAINTENANCE_TEST_FAIL_AFTER_INSTALL === '1'
    })
    console.log(
      `Restore passed: ${basename(inputPath)} restored and migrated; restored sessions and one-time verifications invalidated; pre-restore backup ${result.backup ? `written as ${basename(result.backup)}` : 'not available'}${result.quarantine ? `; prior state retained as ${basename(result.quarantine)}` : ''}.`
    )
    return
  }

  throw new Error(
    'Usage: node .output/server/maintenance.mjs <migrate --confirm-app-stopped|backup [--output PATH]|verify|verify-backup --input PATH [--require-current] [--require-off-host-coverage --backup-r2-bucket BUCKET]|restore --input PATH --confirm-app-stopped>'
  )
}

function readDatabasePath(environment) {
  const databaseUrl = environment.NUXT_DATABASE_URL
  if (!databaseUrl || databaseUrl.trim() !== databaseUrl || !databaseUrl.startsWith('file:')) {
    throw new Error('NUXT_DATABASE_URL must be an already-trimmed absolute file: path.')
  }

  const path = databaseUrl.slice('file:'.length)
  if (!path || !isAbsolute(path) || path.includes('\0')) {
    throw new Error('NUXT_DATABASE_URL must be an already-trimmed absolute file: path.')
  }

  return resolve(path)
}

async function migrateDatabase(databasePath, dataDirectory, { backupExisting }) {
  ensureDataDirectory(dataDirectory)
  let backup = null

  if (backupExisting && isPopulatedFile(databasePath)) {
    backup = await backupDatabase(
      databasePath,
      defaultBackupPath(databasePath, dataDirectory, 'pre-migrate'),
      dataDirectory
    )
  }

  const sqlite = new Database(databasePath)
  let appliedBefore
  let appliedAfter
  try {
    sqlite.pragma('foreign_keys = ON')
    appliedBefore = validateMigrationLedgerPrefix(sqlite)
    migrate(drizzle({ client: sqlite }), { migrationsFolder })
    appliedAfter = validateMigrationLedger(sqlite)
  } finally {
    sqlite.close()
  }

  makeDatabaseStandalone(databasePath)
  verifyDatabase(databasePath)
  return {
    applied: appliedAfter - appliedBefore,
    available: migrationCount(),
    backup,
    current: appliedAfter
  }
}

async function backupDatabase(databasePath, outputPath, dataDirectory) {
  assertLiveDatabaseEntries(databasePath)
  if (!isPopulatedFile(databasePath)) {
    throw new Error('The SQLite database does not exist or is empty.')
  }
  const safeOutputPath = resolveBackupPath(dataDirectory, outputPath, 'Backup output')
  const stagedPath = join(
    dirname(safeOutputPath),
    `.${basename(safeOutputPath)}.write-${process.pid}-${randomBytes(6).toString('hex')}.tmp`
  )

  try {
    const source = new Database(databasePath, { readonly: true, fileMustExist: true })
    try {
      await source.backup(stagedPath)
    } finally {
      source.close()
    }
    makeDatabaseStandalone(stagedPath)
    verifyDatabase(stagedPath)
    chmodSync(stagedPath, 0o600)
    assertUnusedPath(safeOutputPath, 'Backup output')
    linkSync(stagedPath, safeOutputPath)
    return safeOutputPath
  } finally {
    removeDatabaseFiles(stagedPath)
  }
}

async function restoreDatabase(databasePath, inputPath, dataDirectory, { failAfterInstall }) {
  assertLiveDatabaseEntries(databasePath)
  verifyDatabase(inputPath)
  verifyAppDatabaseIdentity(inputPath, 'Restore input')

  const stagedPath = join(
    dataDirectory,
    `.${basename(databasePath)}.restore-${process.pid}-${randomBytes(6).toString('hex')}.tmp`
  )

  try {
    const source = new Database(inputPath, { readonly: true, fileMustExist: true })
    try {
      await source.backup(stagedPath)
    } finally {
      source.close()
    }
    verifyDatabase(stagedPath)
    verifyAppDatabaseIdentity(stagedPath, 'Staged restore database')
    await migrateDatabase(stagedPath, dataDirectory, { backupExisting: false })
    invalidateRestoredAuthenticationState(stagedPath)
    verifyDatabase(stagedPath)
    verifyMigrationLedger(stagedPath)
    assertNoDatabaseSidecars(stagedPath)

    let backup = null
    let retainQuarantine = false
    if (isPopulatedFile(databasePath)) {
      let liveVerified = false
      try {
        verifyDatabase(databasePath)
        liveVerified = true
      } catch (error) {
        if (!(error instanceof DatabaseVerificationError)) throw error
        retainQuarantine = true
      }
      if (liveVerified) {
        assertDatabaseCanBeReplaced(databasePath)
        backup = await backupDatabase(
          databasePath,
          defaultBackupPath(databasePath, dataDirectory, 'pre-restore'),
          dataDirectory
        )
      }
    } else if (databaseStatePaths(databasePath).some((path) => pathEntry(path))) {
      retainQuarantine = true
    }

    const quarantine = replaceDatabaseState(databasePath, stagedPath, dataDirectory, {
      failAfterInstall,
      retainQuarantine
    })
    return { backup, quarantine }
  } finally {
    removeDatabaseFiles(stagedPath)
  }
}

function invalidateRestoredAuthenticationState(path) {
  const sqlite = new Database(path)
  try {
    sqlite.pragma('foreign_keys = ON')
    const invalidate = sqlite.transaction(() => {
      sqlite.prepare('delete from session').run()
      sqlite.prepare('delete from verification').run()
    })
    invalidate.immediate()
  } finally {
    sqlite.close()
  }
  makeDatabaseStandalone(path)
}

function replaceDatabaseState(databasePath, stagedPath, dataDirectory, { failAfterInstall, retainQuarantine }) {
  const quarantineDirectory = join(
    dataDirectory,
    `.restore-quarantine-${process.pid}-${randomBytes(6).toString('hex')}`
  )
  const livePaths = databaseStatePaths(databasePath)
  const movedPaths = []
  let replacementInstalled = false
  mkdirSync(quarantineDirectory, { mode: 0o700 })

  try {
    for (const livePath of livePaths) {
      if (!pathEntry(livePath)) continue
      const quarantinePath = join(quarantineDirectory, basename(livePath))
      renameSync(livePath, quarantinePath)
      movedPaths.push([livePath, quarantinePath])
    }

    renameSync(stagedPath, databasePath)
    replacementInstalled = true
    if (failAfterInstall) throw new Error('Injected post-install failure for rollback verification.')
    verifyDatabase(databasePath)
  } catch (error) {
    try {
      if (replacementInstalled) {
        removeDatabaseFiles(databasePath)
      }
      for (const [livePath, quarantinePath] of movedPaths.reverse()) {
        renameSync(quarantinePath, livePath)
      }
      rmSync(quarantineDirectory, { recursive: true, force: true })
    } catch {
      throw new Error(
        `Restore replacement failed and automatic rollback was incomplete; retain ${basename(quarantineDirectory)} for manual recovery.`
      )
    }
    throw error
  }

  if (retainQuarantine) return quarantineDirectory
  try {
    rmSync(quarantineDirectory, { recursive: true, force: true })
    return null
  } catch {
    return quarantineDirectory
  }
}

function verifyDatabase(path) {
  if (!isPopulatedFile(path)) {
    throw new DatabaseVerificationError('The SQLite database does not exist or is empty.')
  }

  let sqlite
  try {
    sqlite = new Database(path, { readonly: true, fileMustExist: true })
    const integrity = sqlite.pragma('integrity_check')
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
      throw new DatabaseVerificationError('SQLite integrity_check did not return exactly ok.')
    }
    const foreignKeys = sqlite.pragma('foreign_key_check')
    if (foreignKeys.length !== 0) {
      throw new DatabaseVerificationError('SQLite foreign_key_check reported violations.')
    }
  } catch (error) {
    if (error instanceof DatabaseVerificationError) throw error
    if (isCorruptionError(error)) {
      throw new DatabaseVerificationError('The supplied file is not a valid verified SQLite database.')
    }
    throw new DatabaseAccessError(
      'SQLite verification could not complete because the database is busy or inaccessible.'
    )
  } finally {
    sqlite?.close()
  }
}

function isCorruptionError(error) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  return code === 'SQLITE_NOTADB' || code === 'SQLITE_READONLY_ROLLBACK' || code.startsWith('SQLITE_CORRUPT')
}

function verifyMigrationLedger(path) {
  const sqlite = new Database(path, { readonly: true, fileMustExist: true })
  try {
    validateMigrationLedger(sqlite)
  } finally {
    sqlite.close()
  }
}

function verifyAppDatabaseIdentity(path, label) {
  const sqlite = new Database(path, { readonly: true, fileMustExist: true })
  try {
    const appliedCount = validateMigrationLedgerPrefix(sqlite)
    if (appliedCount === 0) {
      throw new Error(`${label} must contain a recognized non-empty packaged migration ledger.`)
    }
    if (appliedCount < supportedInitializationBaselineCount) {
      throw new Error(`${label} must contain the complete supported pre-release initialization baseline.`)
    }
  } finally {
    sqlite.close()
  }
}

function assertDatabaseCanBeReplaced(databasePath) {
  if (!isPopulatedFile(databasePath)) return

  const sqlite = new Database(databasePath)
  try {
    sqlite.pragma('busy_timeout = 1000')
    sqlite.exec('BEGIN EXCLUSIVE')
    sqlite.exec('ROLLBACK')
  } catch {
    throw new Error('The live database is busy; stop the application before migration or restore.')
  } finally {
    if (sqlite.inTransaction) sqlite.exec('ROLLBACK')
    sqlite.close()
  }
}

function requireStoppedAppConfirmation(args, label) {
  if (args.length !== 1 || args[0] !== '--confirm-app-stopped') {
    throw new Error(`${label} requires --confirm-app-stopped after the application has been stopped.`)
  }
}

function parseValuedOptions(args, allowed) {
  const options = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    const value = args[index + 1]
    if (!allowed.has(name) || !value || value.startsWith('--') || options.has(name)) {
      throw new Error('Invalid or duplicate maintenance option.')
    }
    options.set(name, value)
  }
  return options
}

function parseRestoreOptions(args) {
  let input = ''
  let confirmed = false

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--confirm-app-stopped' && !confirmed) {
      confirmed = true
      continue
    }
    if (argument === '--input' && !input) {
      input = args[index + 1] ?? ''
      index += 1
      continue
    }
    throw new Error('Invalid or duplicate restore option.')
  }

  if (!input || input.startsWith('--')) {
    throw new Error('Restore requires one --input PATH directly inside the backup directory.')
  }
  return { input, confirmed }
}

function parseVerifyBackupOptions(args) {
  let input = ''
  let requireCurrent = false
  let requireOffHostCoverage = false
  let backupR2Bucket = ''

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--require-current' && !requireCurrent) {
      requireCurrent = true
      continue
    }
    if (argument === '--require-off-host-coverage' && !requireOffHostCoverage) {
      requireOffHostCoverage = true
      continue
    }
    if (argument === '--input' && !input) {
      input = args[index + 1] ?? ''
      index += 1
      continue
    }
    if (argument === '--backup-r2-bucket' && !backupR2Bucket) {
      backupR2Bucket = args[index + 1] ?? ''
      index += 1
      continue
    }
    throw new Error('Invalid or duplicate backup verification option.')
  }

  if (!input || input.startsWith('--')) {
    throw new Error('Backup verification requires one --input PATH directly inside the backup directory.')
  }
  if (requireOffHostCoverage !== Boolean(backupR2Bucket)) {
    throw new Error('Off-host backup verification requires --backup-r2-bucket together with coverage checking.')
  }
  if (backupR2Bucket && !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(backupR2Bucket)) {
    throw new Error('Off-host backup verification requires a valid private R2 backup bucket name.')
  }
  return { input, requireCurrent, requireOffHostCoverage, backupR2Bucket }
}

function assertOffHostBackupCoverage(path, backupR2Bucket) {
  const sqlite = new Database(path, { readonly: true, fileMustExist: true })
  try {
    const activeFiles = Number(
      sqlite.prepare("select count(*) as count from files where status in ('pending', 'ready')").get()?.count ?? 0
    )
    const bindingRows = sqlite.prepare("select value from app_settings where key = 'files.storage-binding.v1'").all()
    if (bindingRows.length === 1) {
      let persistedBinding
      try {
        persistedBinding = JSON.parse(String(bindingRows[0].value))
      } catch {
        // Active Files rows below still fail closed for an invalid binding.
      }
      if (persistedBinding?.driver === 'r2' && persistedBinding.bucket === backupR2Bucket) {
        throw new DatabaseVerificationError(
          'The database-backup R2 bucket must be separate from the persisted private Files bucket.'
        )
      }
    }

    if (activeFiles === 0) return
    if (bindingRows.length !== 1) throw incompleteLocalFilesBackup()

    let binding
    try {
      binding = JSON.parse(String(bindingRows[0].value))
    } catch {
      throw incompleteLocalFilesBackup()
    }

    const validBinding =
      binding &&
      typeof binding === 'object' &&
      !Array.isArray(binding) &&
      binding.version === 1 &&
      binding.driver === 'r2' &&
      typeof binding.bucket === 'string' &&
      /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(binding.bucket) &&
      isPrivateCloudflareR2Endpoint(binding.endpoint)
    if (!validBinding) throw incompleteLocalFilesBackup()

    const buckets = sqlite
      .prepare("select distinct bucket from files where status in ('pending', 'ready') order by bucket")
      .all()
      .map((row) => String(row.bucket))
    if (buckets.length !== 1 || buckets[0] !== binding.bucket) throw incompleteLocalFilesBackup()
  } finally {
    sqlite.close()
  }
}

function isPrivateCloudflareR2Endpoint(value) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      /^[0-9a-f]{32}\.(?:eu\.|fedramp\.)?r2\.cloudflarestorage\.com$/.test(url.hostname)
    )
  } catch {
    return false
  }
}

function incompleteLocalFilesBackup() {
  return new DatabaseVerificationError(
    'The SQLite snapshot contains active Files rows whose bytes are not proven to reside in its bound private R2 bucket; refusing off-host publication.'
  )
}

function resolveBackupPath(dataDirectory, candidate, label, { mustExist = false } = {}) {
  if (!candidate || !isAbsolute(candidate)) {
    throw new Error(`${label} must be an absolute path directly inside the backup directory.`)
  }
  const backupsDirectory = ensureBackupDirectory(dataDirectory)
  const path = resolve(candidate)
  if (dirname(path) !== resolve(backupsDirectory)) {
    throw new Error(`${label} must be a file directly inside the backup directory.`)
  }

  const entry = pathEntry(path)
  if (mustExist) {
    if (!entry?.isFile() || entry.isSymbolicLink()) {
      throw new Error(`${label} must be an existing regular file, not a symbolic link.`)
    }
    if (dirname(realpathSync(path)) !== realpathSync(backupsDirectory)) {
      throw new Error(`${label} must resolve directly inside the backup directory.`)
    }
  } else if (entry) {
    throw new Error(`${label} already exists; refusing to overwrite it.`)
  }
  return path
}

function ensureDataDirectory(dataDirectory) {
  mkdirSync(dataDirectory, { recursive: true })
  const entry = lstatSync(dataDirectory)
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error('The application data directory must be a real directory, not a symbolic link.')
  }
  return realpathSync(dataDirectory)
}

function ensureBackupDirectory(dataDirectory) {
  const canonicalDataDirectory = ensureDataDirectory(dataDirectory)
  const backupsDirectory = join(dataDirectory, 'backups')
  mkdirSync(backupsDirectory, { recursive: true })
  const entry = lstatSync(backupsDirectory)
  const canonicalBackupsDirectory = realpathSync(backupsDirectory)
  if (
    !entry.isDirectory() ||
    entry.isSymbolicLink() ||
    relative(canonicalDataDirectory, canonicalBackupsDirectory) !== 'backups'
  ) {
    throw new Error('The backup directory must be a real directory directly inside the application data directory.')
  }
  return backupsDirectory
}

function assertUnusedPath(path, label) {
  if (pathEntry(path)) throw new Error(`${label} already exists; refusing to overwrite it.`)
}

function assertLiveDatabaseEntries(databasePath) {
  ensureDataDirectory(dirname(databasePath))
  for (const path of databaseStatePaths(databasePath)) {
    const entry = pathEntry(path)
    if (entry && (!entry.isFile() || entry.isSymbolicLink())) {
      throw new Error('The live database and sidecars must be regular files, not symbolic links or directories.')
    }
  }
}

function assertNoOrphanSidecarsForFreshDatabase(databasePath) {
  if (isPopulatedFile(databasePath)) return
  if (
    databaseStatePaths(databasePath)
      .slice(1)
      .some((path) => pathEntry(path))
  ) {
    throw new Error(
      'An absent or empty SQLite database has orphaned journal/WAL/SHM state; discard the database and all sidecars together before fresh initialization.'
    )
  }
}

function makeDatabaseStandalone(databasePath) {
  const sqlite = new Database(databasePath)
  try {
    if (String(sqlite.pragma('journal_mode', { simple: true })).toLowerCase() === 'wal') {
      const checkpoint = sqlite.pragma('wal_checkpoint(TRUNCATE)')[0]
      if (Number(checkpoint?.busy) !== 0) {
        throw new Error('SQLite could not checkpoint the standalone database.')
      }
      const mode = sqlite.pragma('journal_mode = DELETE', { simple: true })
      if (String(mode).toLowerCase() !== 'delete') {
        throw new Error('SQLite could not return the standalone database to delete journal mode.')
      }
    }
  } finally {
    sqlite.close()
  }
  assertNoDatabaseSidecars(databasePath)
}

function assertNoDatabaseSidecars(databasePath) {
  for (const sidecar of databaseStatePaths(databasePath).slice(1)) {
    const entry = pathEntry(sidecar)
    if (!entry) continue
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 0) {
      throw new Error('A standalone SQLite database retained journal/WAL/SHM state; refusing to publish it.')
    }
    rmSync(sidecar)
  }
}

function removeDatabaseFiles(databasePath) {
  for (const path of databaseStatePaths(databasePath)) {
    rmSync(path, { force: true })
  }
}

function databaseStatePaths(databasePath) {
  return [databasePath, `${databasePath}-wal`, `${databasePath}-shm`, `${databasePath}-journal`]
}

function pathEntry(path) {
  return lstatSync(path, { throwIfNoEntry: false })
}

function defaultBackupPath(databasePath, dataDirectory, purpose) {
  const extension = basename(databasePath).match(/(\.[^.]+)$/)?.[1] ?? '.db'
  const stem = basename(databasePath, extension)
  return join(dataDirectory, 'backups', `${stem}-${purpose}-${timestamp()}${extension}`)
}

function timestamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, '-')
}

function isPopulatedFile(path) {
  const entry = pathEntry(path)
  return Boolean(entry?.isFile() && !entry.isSymbolicLink() && entry.size > 0)
}

function appliedMigrationCount(sqlite) {
  const table = sqlite
    .prepare("select count(*) as count from sqlite_master where type = 'table' and name = '__drizzle_migrations'")
    .get()
  if (Number(table?.count) !== 1) return 0
  return Number(sqlite.prepare('select count(*) as count from __drizzle_migrations').get()?.count ?? 0)
}

function validateMigrationLedger(sqlite) {
  const expected = migrationMetadata()
  const applied = readAppliedMigrations(sqlite)
  if (applied.length !== expected.length || !migrationRowsMatch(applied, expected)) {
    throw new Error('The applied migration ledger does not exactly match the packaged migrations.')
  }
  verifyAppSchema(sqlite, applied.length)
  return applied.length
}

function validateMigrationLedgerPrefix(sqlite) {
  const expected = migrationMetadata()
  const applied = readAppliedMigrations(sqlite)
  if (applied.length > expected.length || !migrationRowsMatch(applied, expected)) {
    throw new Error('The applied migration ledger does not exactly match the packaged migrations.')
  }
  if (applied.length > 0) verifyAppSchema(sqlite, applied.length)
  return applied.length
}

function readAppliedMigrations(sqlite) {
  if (appliedMigrationCount(sqlite) === 0) return []
  return sqlite.prepare('select hash, created_at from __drizzle_migrations order by created_at asc').all()
}

function migrationRowsMatch(applied, expected) {
  return applied.every(
    (migration, index) =>
      String(migration.hash) === expected[index]?.hash && Number(migration.created_at) === expected[index]?.createdAt
  )
}

function verifyAppSchema(sqlite, appliedCount) {
  const availableMigrations = migrationCount()
  if (
    availableMigrations < supportedInitializationBaselineCount ||
    appliedCount < 1 ||
    appliedCount > availableMigrations
  ) {
    throw new Error('Schema verification does not cover the complete packaged baseline.')
  }
  verifyExactPackagedApplicationSchema(sqlite, appliedCount)
}

function verifyExactPackagedApplicationSchema(sqlite, appliedCount) {
  const expected = packagedApplicationSchema(appliedCount)
  const actual = readApplicationSchema(sqlite)
  const expectedByKey = new Map(expected.map((entry) => [entry.key, entry]))
  const actualByKey = new Map(actual.map((entry) => [entry.key, entry]))
  const differences = [
    ...expected.filter((entry) => !actualByKey.has(entry.key)).map((entry) => `missing ${entry.key}`),
    ...actual.filter((entry) => !expectedByKey.has(entry.key)).map((entry) => `unexpected ${entry.key}`),
    ...expected
      .filter((entry) => actualByKey.has(entry.key) && actualByKey.get(entry.key)?.signature !== entry.signature)
      .map((entry) => `changed ${entry.key}`)
  ]

  if (differences.length) {
    const visible = differences.slice(0, 12)
    const remaining = differences.length - visible.length
    throw new DatabaseVerificationError(
      `SQLite app schema does not exactly match the packaged migration prefix: ${visible.join(', ')}${remaining ? `, and ${remaining} more` : ''}.`
    )
  }
}

function packagedApplicationSchema(appliedCount) {
  const cached = packagedApplicationSchemas.get(appliedCount)
  if (cached) return cached

  const migrations = readMigrationFiles({ migrationsFolder })
  if (appliedCount < 1 || appliedCount > migrations.length) {
    throw new Error('Schema verification does not cover the requested packaged migration prefix.')
  }

  const scratch = new Database(':memory:')
  try {
    scratch.pragma('foreign_keys = ON')
    const apply = scratch.transaction(() => {
      for (const migration of migrations.slice(0, appliedCount)) {
        for (const statement of migration.sql) {
          if (statement.trim()) scratch.exec(statement)
        }
      }
    })
    apply()
    const schema = readApplicationSchema(scratch)
    packagedApplicationSchemas.set(appliedCount, schema)
    return schema
  } finally {
    scratch.close()
  }
}

function readApplicationSchema(sqlite) {
  return sqlite
    .prepare(
      `select type, name, tbl_name as tableName, sql
       from sqlite_schema
       where type in ('table', 'view', 'index', 'trigger')
         and name <> '__drizzle_migrations'
         and name not glob 'sqlite_*'
         and sql is not null
       order by type, name`
    )
    .all()
    .map((row) => {
      const type = String(row.type)
      const name = String(row.name)
      const tableName = String(row.tableName)
      const sql = String(row.sql).trim().replaceAll(/\s+/g, ' ')
      return {
        key: `${type}:${name}`,
        signature: `${type}\0${name}\0${tableName}\0${sql}`
      }
    })
}

function migrationCount() {
  return migrationMetadata().length
}

function migrationMetadata() {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'))
  if (!Array.isArray(journal.entries)) return []
  return journal.entries.map((entry) => {
    const sql = readFileSync(join(migrationsFolder, `${entry.tag}.sql`), 'utf8')
    return {
      createdAt: Number(entry.when),
      hash: createHash('sha256').update(sql).digest('hex')
    }
  })
}
