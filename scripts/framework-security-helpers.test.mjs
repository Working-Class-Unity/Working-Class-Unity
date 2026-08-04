import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import test from 'node:test'
import { findAnchor, selectEnvironment, stopChild, waitForServer } from './framework-security-helpers.mjs'

test('fixture environment keeps only explicitly approved ambient keys', () => {
  assert.deepEqual(selectEnvironment({ PATH: '/bin', NODE_OPTIONS: '--inspect', SECRET: 'private' }, ['PATH']), {
    PATH: '/bin'
  })
})

test('anchor lookup scopes assertions to the requested rendered link', () => {
  const html = '<a id="safe" href="/safe">Safe</a><a id="unsafe">Unsafe</a>'
  assert.equal(findAnchor(html, 'safe'), '<a id="safe" href="/safe">')
  assert.equal(findAnchor(html, 'unsafe'), '<a id="unsafe">')
  assert.equal(findAnchor(html, 'missing'), undefined)
})

test('readiness polling fails closed when the child exits or times out', async () => {
  await assert.rejects(
    waitForServer({ exitCode: 17 }, 'http://127.0.0.1:1', 20, {
      fetchImplementation: async () => ({ status: 200 }),
      pollMs: 1
    }),
    /exited before readiness with code 17/
  )

  await assert.rejects(
    waitForServer({ exitCode: null }, 'http://127.0.0.1:1', 10, {
      fetchImplementation: async () => {
        throw new Error('not listening')
      },
      pollMs: 1
    }),
    /did not answer .* within 10ms/
  )
})

test('readiness polling aborts an in-flight fetch that never settles', { timeout: 1_000 }, async () => {
  let requestSignal

  await assert.rejects(
    waitForServer({ exitCode: null }, 'http://127.0.0.1:1', 25, {
      fetchImplementation: async (_url, { signal }) => {
        requestSignal = signal
        return new Promise(() => {})
      },
      pollMs: 1
    }),
    /did not answer .* within 25ms/
  )

  assert.ok(requestSignal instanceof AbortSignal)
  assert.equal(requestSignal.aborted, true)
})

test('fixture cleanup stops cooperative and unresponsive child processes', async () => {
  const cooperative = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore'
  })
  await once(cooperative, 'spawn')
  await stopChild(cooperative, { graceMs: 100 })
  assert.notEqual(cooperative.exitCode ?? cooperative.signalCode, null)

  const unresponsive = spawn(
    process.execPath,
    ['-e', "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000)"],
    { stdio: ['ignore', 'pipe', 'ignore'] }
  )
  await once(unresponsive.stdout, 'data')
  await stopChild(unresponsive, { graceMs: 50 })
  assert.equal(unresponsive.signalCode, 'SIGKILL')
})
