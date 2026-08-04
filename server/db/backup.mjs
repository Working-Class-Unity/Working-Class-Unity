import { spawnSync } from 'node:child_process'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const environment = { ...process.env }
const databaseUrl = readOption('--database-url') ?? environment.NUXT_DATABASE_URL

if (databaseUrl?.startsWith('file:')) {
  const databasePath = databaseUrl.slice('file:'.length)
  environment.NUXT_DATABASE_URL = `file:${isAbsolute(databasePath) ? resolve(databasePath) : resolve(process.cwd(), databasePath)}`
}

const output = readOption('--output')
const outputDirectory = readOption('--out-dir') ?? environment.SQLITE_BACKUP_DIR
const maintenanceArgs = ['backup']
if (output) {
  maintenanceArgs.push('--output', resolve(output))
} else if (outputDirectory) {
  maintenanceArgs.push('--output', join(resolve(outputDirectory), defaultFilename(environment.NUXT_DATABASE_URL)))
}

const maintenanceEntry = fileURLToPath(new URL('../maintenance.mjs', import.meta.url))
const result = spawnSync(process.execPath, [maintenanceEntry, ...maintenanceArgs], {
  env: environment,
  stdio: 'inherit'
})

if (result.error) throw result.error
if (result.signal) process.kill(process.pid, result.signal)
process.exitCode = result.status ?? 1

function readOption(name) {
  const direct = args.find((argument) => argument.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function defaultFilename(databaseUrl) {
  const databasePath = databaseUrl?.startsWith('file:') ? databaseUrl.slice('file:'.length) : 'sqlite.db'
  const stem = basename(databasePath).replace(/\.[^.]+$/, '') || 'sqlite'
  return `${stem}-backup-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.db`
}
