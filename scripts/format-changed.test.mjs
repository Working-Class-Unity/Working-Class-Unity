import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { rmSync } from 'node:fs'
import { collectChangedFiles, findUnformattedFiles, isSourceFormatted } from './format-changed.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the formatter detects malformed source instead of passing by file presence', async () => {
  const options = { semi: false, singleQuote: true }

  assert.equal(await isSourceFormatted('const value = { answer: 42 }\n', 'fixture.mjs', options), true)
  assert.equal(await isSourceFormatted('const value={answer:42}\n', 'fixture.mjs', options), false)
})

test('ignored generated files are excluded while supported changed files fail', async () => {
  const root = makeTempRoot()
  mkdirSync(join(root, 'generated'))
  writeFileSync(join(root, '.prettierignore'), 'generated/\n')
  writeFileSync(join(root, '.prettierrc.json'), '{"semi":false,"singleQuote":true}\n')
  writeFileSync(join(root, 'changed.mjs'), 'const changed={value:1}\n')
  writeFileSync(join(root, 'generated', 'snapshot.json'), '{"generated":true}')

  const failures = await findUnformattedFiles(root, ['changed.mjs', 'generated/snapshot.json'])

  assert.deepEqual(failures, ['changed.mjs'])
})

test('base-to-head collection includes every commit plus staged, modified, and untracked files', () => {
  const root = makeTempRoot()
  git(root, ['init', '--initial-branch=main'])
  git(root, ['config', 'user.name', 'CI Contract'])
  git(root, ['config', 'user.email', 'ci@example.invalid'])

  writeFileSync(join(root, 'initial.mjs'), 'export const initial = true\n')
  git(root, ['add', 'initial.mjs'])
  git(root, ['commit', '-m', 'initial'])
  const base = git(root, ['rev-parse', 'HEAD']).trim()

  writeFileSync(join(root, 'second.mjs'), 'export const second = true\n')
  git(root, ['add', 'second.mjs'])
  git(root, ['commit', '-m', 'second'])
  writeFileSync(join(root, 'third.mjs'), 'export const third = true\n')
  git(root, ['add', 'third.mjs'])
  git(root, ['commit', '-m', 'third'])
  const head = git(root, ['rev-parse', 'HEAD']).trim()

  writeFileSync(join(root, 'initial.mjs'), 'export const initial = false\n')
  writeFileSync(join(root, 'staged.mjs'), 'export const staged = true\n')
  git(root, ['add', 'staged.mjs'])
  writeFileSync(join(root, 'untracked.mjs'), 'export const untracked = true\n')

  assert.deepEqual(collectChangedFiles({ root, baseSha: base, headSha: head }), [
    'initial.mjs',
    'second.mjs',
    'staged.mjs',
    'third.mjs',
    'untracked.mjs'
  ])
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'swl-format-contract-'))
  tempRoots.push(root)
  return root
}

function git(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8'
  })

  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}
