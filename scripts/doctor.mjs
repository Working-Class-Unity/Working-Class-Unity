#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const privatePaths = [
  '.env',
  '.env.local',
  'data/app.db',
  'data/app.db-shm',
  'data/app.db-wal',
  'app.db',
  'app.db-shm',
  'app.db-wal',
  'debug.log',
  'ops/production-evidence-local.md'
]
const result = spawnSync('git', ['check-ignore', '--verbose', '-z', '--stdin'], {
  cwd: root,
  input: `${privatePaths.join('\0')}\0`,
  encoding: 'utf8'
})

if (result.error || ![0, 1].includes(result.status ?? -1)) {
  console.error(result.error?.message ?? result.stderr.trim() ?? 'git check-ignore failed')
  process.exit(1)
}

const fields = result.stdout.split('\0').filter(Boolean)
const repositoryIgnored = new Set()

for (let index = 0; index + 3 < fields.length; index += 4) {
  const [source, , pattern, path] = fields.slice(index, index + 4)
  if (source === '.gitignore' && !pattern.startsWith('!')) repositoryIgnored.add(path)
}

const exposed = privatePaths.filter((path) => !repositoryIgnored.has(path))

if (exposed.length > 0) {
  console.error(`Private local artifacts must remain ignored by the repository .gitignore:\n${exposed.join('\n')}`)
  process.exit(1)
}

console.log('Doctor passed. Private local artifacts remain ignored by Git.')
