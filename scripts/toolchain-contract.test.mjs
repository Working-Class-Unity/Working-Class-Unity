import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  assertSupportedNode,
  buildNpmExecArgs,
  parsePnpmVersion,
  validateRepositoryDeclarations
} from './toolchain-contract.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))

test('repository declarations agree on Node and pnpm versions', () => {
  assert.deepEqual(validateRepositoryDeclarations(root), [])
})

test('the supported Node line enforces Nuxt 4.5 minimums within Node 24', () => {
  assert.doesNotThrow(() => assertSupportedNode('24.11.0'))
  assert.doesNotThrow(() => assertSupportedNode('24.99.0'))
  assert.throws(() => assertSupportedNode('24.10.99'), /Node\.js >=24\.11\.0 <25\.0\.0 is required/)
  assert.throws(() => assertSupportedNode('25.0.0'), /Node\.js >=24\.11\.0 <25\.0\.0 is required/)
})

test('pnpm metadata requires an exact semantic version', () => {
  assert.equal(parsePnpmVersion('pnpm@11.1.2'), '11.1.2')
  assert.throws(() => parsePnpmVersion('pnpm@11'), /exact pnpm version/)
  assert.throws(() => parsePnpmVersion('pnpm@latest'), /exact pnpm version/)
  assert.throws(() => parsePnpmVersion('npm@11.1.2'), /exact pnpm version/)
})

test('npm exec receives the exact pnpm package and forwards arguments', () => {
  assert.deepEqual(buildNpmExecArgs('11.1.2', ['install', '--frozen-lockfile']), [
    'exec',
    '--yes',
    '--package=pnpm@11.1.2',
    '--',
    'pnpm',
    'install',
    '--frozen-lockfile'
  ])
})

test('the portable runner rejects an empty invocation', () => {
  const result = spawnSync(process.execPath, ['scripts/run-pnpm.mjs'], {
    cwd: root,
    encoding: 'utf8'
  })

  assert.equal(result.status, 64)
  assert.match(result.stderr, /Usage:/)
})
