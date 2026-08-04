#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildNpmExecArgs, assertSupportedNode, readManifestContract } from './toolchain-contract.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const pnpmArgs = process.argv.slice(2)

if (pnpmArgs.length === 0) {
  console.error('Usage: node scripts/run-pnpm.mjs <pnpm arguments>')
  process.exit(64)
}

try {
  assertSupportedNode()
  const { pnpmVersion } = readManifestContract(root)
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(npmCommand, buildNpmExecArgs(pnpmVersion, pnpmArgs), {
    cwd: root,
    env: {
      ...process.env,
      NPM_CONFIG_UPDATE_NOTIFIER: 'false'
    },
    stdio: 'inherit'
  })

  if (result.error) {
    throw result.error
  }

  process.exit(result.status ?? 1)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
