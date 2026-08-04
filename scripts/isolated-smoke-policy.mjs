import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const forbiddenExactEnvironmentKeys = new Set([
  'API_SMOKE_BASE_URL',
  'APP_URL',
  'DATABASE_URL',
  'DEPLOYMENT_SMOKE_BASE_URL',
  'NEXTAUTH_URL',
  'NEXT_PUBLIC_AUTH_URL',
  'VERCEL_URL'
])
const forbiddenEnvironmentPrefixes = ['AWS_', 'BETTER_AUTH_', 'CLOUDFLARE_', 'NITRO_', 'NUXT_', 'SENTRY_', 'STRIPE_']

export function assertIsolatedSmokeInvocation(args, environment) {
  if (args.length !== 0) {
    throw new Error('The isolated API smoke does not accept a deployment URL or command-line options.')
  }

  const forbiddenKeys = Object.keys(environment)
    .filter(
      (key) =>
        forbiddenExactEnvironmentKeys.has(key) || forbiddenEnvironmentPrefixes.some((prefix) => key.startsWith(prefix))
    )
    .sort((left, right) => left.localeCompare(right))

  if (forbiddenKeys.length) {
    throw new Error(
      `The isolated API smoke refuses ambient application or provider configuration: ${forbiddenKeys.join(', ')}.`
    )
  }
}

export function fingerprintDirectory(directory) {
  if (!existsSync(directory)) return 'absent'

  const root = resolve(directory)
  const entries = []
  walk(root, root, entries)
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex')
}

export function createSqliteWriteObserver(Database, databasePath) {
  const sqlite = new Database(databasePath, { readonly: true, fileMustExist: true })
  const initialDataVersion = Number(sqlite.pragma('data_version', { simple: true }))
  let closed = false

  return {
    assertUnchanged(label) {
      if (closed) throw new Error('SQLite write observer is already closed.')
      const currentDataVersion = Number(sqlite.pragma('data_version', { simple: true }))
      if (currentDataVersion !== initialDataVersion) {
        throw new Error(`${label} changed SQLite data_version from ${initialDataVersion} to ${currentDataVersion}.`)
      }
    },
    close() {
      if (closed) return
      closed = true
      sqlite.close()
    }
  }
}

function walk(root, current, entries) {
  for (const name of readdirSync(current).sort((left, right) => left.localeCompare(right))) {
    const path = join(current, name)
    const entry = lstatSync(path)
    const relativePath = relative(root, path)
    if (entry.isSymbolicLink()) {
      entries.push(['symlink', relativePath, readlinkSync(path)])
      continue
    }
    if (entry.isDirectory()) {
      entries.push(['directory', relativePath])
      walk(root, path, entries)
      continue
    }
    if (entry.isFile()) {
      entries.push(['file', relativePath, createHash('sha256').update(readFileSync(path)).digest('hex')])
      continue
    }
    entries.push(['other', relativePath, entry.mode])
  }
}
