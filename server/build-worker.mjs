import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverRoot = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(serverRoot, '..')

await build({
  entryPoints: [resolve(webRoot, 'sentry.server.config.ts')],
  outfile: resolve(webRoot, '.output/server/sentry.server.config.mjs'),
  bundle: true,
  external: ['@sentry/nuxt'],
  format: 'esm',
  logLevel: 'info',
  platform: 'node',
  target: 'node24'
})

await build({
  entryPoints: [resolve(webRoot, 'worker-sentry.server.config.ts')],
  outfile: resolve(webRoot, '.output/server/worker-sentry.server.config.mjs'),
  bundle: true,
  external: ['@sentry/nuxt'],
  format: 'esm',
  logLevel: 'info',
  platform: 'node',
  target: 'node24'
})

await build({
  entryPoints: [resolve(serverRoot, 'worker.ts')],
  outfile: resolve(webRoot, '.output/server/worker.mjs'),
  alias: {
    '#shared': resolve(webRoot, 'shared')
  },
  banner: {
    js: "import { createRequire as __swlCreateRequire } from 'node:module'; const require = __swlCreateRequire(import.meta.url);"
  },
  bundle: true,
  external: ['@sentry/nuxt', 'better-sqlite3'],
  format: 'esm',
  logLevel: 'info',
  platform: 'node',
  target: 'node24'
})

await build({
  entryPoints: [resolve(serverRoot, 'off-host-backup.mjs')],
  outfile: resolve(webRoot, '.output/server/off-host-backup.mjs'),
  banner: {
    js: "import { createRequire as __swlCreateRequire } from 'node:module'; const require = __swlCreateRequire(import.meta.url);"
  },
  bundle: true,
  format: 'esm',
  logLevel: 'info',
  platform: 'node',
  target: 'node24'
})

await build({
  entryPoints: [resolve(webRoot, 'scripts/import-stripe-membership.ts')],
  outfile: resolve(webRoot, '.output/server/import-stripe-membership.mjs'),
  banner: {
    js: "import { createRequire as __swlCreateRequire } from 'node:module'; const require = __swlCreateRequire(import.meta.url);"
  },
  bundle: true,
  external: ['better-sqlite3'],
  format: 'esm',
  logLevel: 'info',
  platform: 'node',
  target: 'node24'
})

await build({
  entryPoints: [resolve(webRoot, 'scripts/sync-stripe-membership-links.ts')],
  outfile: resolve(webRoot, '.output/server/sync-stripe-membership-links.mjs'),
  banner: {
    js: "import { createRequire as __swlCreateRequire } from 'node:module'; const require = __swlCreateRequire(import.meta.url);"
  },
  bundle: true,
  external: ['better-sqlite3'],
  format: 'esm',
  logLevel: 'info',
  platform: 'node',
  target: 'node24'
})

await build({
  entryPoints: [resolve(webRoot, 'scripts/import-solidarity-events.ts')],
  outfile: resolve(webRoot, '.output/server/import-solidarity-events.mjs'),
  banner: {
    js: "import { createRequire as __swlCreateRequire } from 'node:module'; const require = __swlCreateRequire(import.meta.url);"
  },
  bundle: true,
  external: ['better-sqlite3'],
  format: 'esm',
  logLevel: 'info',
  platform: 'node',
  target: 'node24'
})

await build({
  entryPoints: [resolve(webRoot, 'scripts/normalize-solidarity-events.ts')],
  outfile: resolve(webRoot, '.output/server/normalize-solidarity-events.mjs'),
  banner: {
    js: "import { createRequire as __swlCreateRequire } from 'node:module'; const require = __swlCreateRequire(import.meta.url);"
  },
  bundle: true,
  external: ['better-sqlite3'],
  format: 'esm',
  logLevel: 'info',
  platform: 'node',
  target: 'node24'
})
