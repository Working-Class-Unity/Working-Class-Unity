import { spawnSync } from 'node:child_process'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const environment = { ...process.env }
const databaseUrl = environment.NUXT_DATABASE_URL

if (databaseUrl?.startsWith('file:')) {
  const databasePath = databaseUrl.slice('file:'.length)
  if (databasePath && !isAbsolute(databasePath)) {
    environment.NUXT_DATABASE_URL = `file:${resolve(process.cwd(), databasePath)}`
  }
}

const maintenanceEntry = fileURLToPath(new URL('../maintenance.mjs', import.meta.url))
const result = spawnSync(process.execPath, [maintenanceEntry, 'migrate', '--confirm-app-stopped'], {
  env: environment,
  stdio: 'inherit'
})

if (result.error) throw result.error
if (result.signal) process.kill(process.pid, result.signal)
process.exitCode = result.status ?? 1
