import { build } from 'esbuild'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverRoot = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(serverRoot, '..')
const outputRoot = resolve(webRoot, '.output/server')

// Package the same migration and maintenance inputs for local and container use.
mkdirSync(resolve(outputRoot, 'db'), { recursive: true })
rmSync(resolve(outputRoot, 'db/migrations'), { recursive: true, force: true })
cpSync(resolve(serverRoot, 'db/migrations'), resolve(outputRoot, 'db/migrations'), { recursive: true })
cpSync(resolve(serverRoot, 'maintenance.mjs'), resolve(outputRoot, 'maintenance.mjs'))
mkdirSync(resolve(outputRoot, 'node_modules/drizzle-orm/better-sqlite3'), { recursive: true })
for (const modulePath of ['migrator.js', 'better-sqlite3/migrator.js']) {
  cpSync(
    resolve(webRoot, 'node_modules/drizzle-orm', modulePath),
    resolve(outputRoot, 'node_modules/drizzle-orm', modulePath)
  )
}

const entries = [
  ['sentry.server.config.ts', 'sentry.server.config.mjs'],
  ['server/off-host-backup.mjs', 'off-host-backup.mjs'],
  ['scripts/import-solidarity-events.ts', 'import-solidarity-events.mjs'],
  ['scripts/solidarity-event-operator.ts', 'solidarity-event-operator.mjs'],
  ['scripts/copy-legacy-events.ts', 'copy-legacy-events.mjs']
]

for (const [entry, output] of entries) {
  await build({
    entryPoints: [resolve(webRoot, entry)],
    outfile: resolve(webRoot, '.output/server', output),
    alias: { '#shared': resolve(webRoot, 'shared') },
    banner: {
      js: "import { createRequire as __wcuCreateRequire } from 'node:module'; const require = __wcuCreateRequire(import.meta.url);"
    },
    bundle: true,
    external: ['@sentry/nuxt', 'better-sqlite3'],
    format: 'esm',
    logLevel: 'info',
    platform: 'node',
    target: 'node24'
  })
}
