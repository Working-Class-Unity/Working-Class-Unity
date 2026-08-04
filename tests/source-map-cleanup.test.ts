import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeSourceMapsFromDeployableOutput } from '../source-map-cleanup.mjs'

const sandboxes: string[] = []

afterEach(() => {
  for (const sandbox of sandboxes.splice(0)) rmSync(sandbox, { force: true, recursive: true })
})

describe('deployable source-map cleanup', () => {
  it('removes nested maps, preserves ordinary artifacts, and is repeat-idempotent', async () => {
    const output = sandbox()
    const clientDirectory = join(output, 'public', '_nuxt')
    const serverDirectory = join(output, 'server', 'chunks')
    mkdirSync(clientDirectory, { recursive: true })
    mkdirSync(serverDirectory, { recursive: true })
    writeFileSync(join(clientDirectory, 'app.js'), 'application bundle')
    writeFileSync(join(clientDirectory, 'app.js.map'), 'client source map')
    writeFileSync(join(serverDirectory, 'runtime.mjs.map'), 'server source map')

    await expect(removeSourceMapsFromDeployableOutput(output)).resolves.toBe(2)
    expect(readFileSync(join(clientDirectory, 'app.js'), 'utf8')).toBe('application bundle')
    await expect(removeSourceMapsFromDeployableOutput(output)).resolves.toBe(0)
  })

  it('fails closed when a source-map artifact cannot be removed', async () => {
    const output = sandbox()
    const blockedMap = join(output, 'public', 'blocked.map')
    mkdirSync(blockedMap, { recursive: true })
    writeFileSync(join(blockedMap, 'retained'), 'cannot remove a non-empty directory as a file')

    await expect(removeSourceMapsFromDeployableOutput(output)).rejects.toBeInstanceOf(Error)
    expect(readFileSync(join(blockedMap, 'retained'), 'utf8')).toContain('cannot remove')
  })
})

function sandbox() {
  const directory = mkdtempSync(join(tmpdir(), 'swl-source-map-cleanup-'))
  sandboxes.push(directory)
  return directory
}
