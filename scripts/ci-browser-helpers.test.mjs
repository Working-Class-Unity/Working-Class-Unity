import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { EventEmitter, once } from 'node:events'
import {
  cleanupDisposableState,
  createCleanupCoordinator,
  managedTreeExists,
  runManaged,
  spawnManaged,
  stopManaged
} from './ci-browser-helpers.mjs'

const node = process.execPath
const isWindows = process.platform === 'win32'
const descendantLeaderSource = String.raw`
  const { spawn } = require('node:child_process')
  const { writeFileSync } = require('node:fs')
  const [statePath, exitCode] = process.argv.slice(1)
  const descendant = spawn(process.execPath, [
    '-e',
    "process.on('SIGTERM', () => {}); process.send('ready'); setInterval(() => {}, 1000)"
  ], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  const readinessTimeout = setTimeout(() => process.exit(9), 1000)
  descendant.once('message', () => {
    clearTimeout(readinessTimeout)
    writeFileSync(statePath, JSON.stringify({ leaderPid: process.pid, descendantPid: descendant.pid }))
    setTimeout(() => process.exit(Number(exitCode)), 25)
  })
`

test('managed command reports a nonzero exit', async () => {
  await assert.rejects(
    runManaged(node, ['-e', 'process.exit(7)'], {
      label: 'nonzero fixture',
      timeoutMs: 2_000,
      graceMs: 100
    }),
    /nonzero fixture failed with exit 7/
  )
})

test('managed command enforces its deadline and terminates the process', async () => {
  await assert.rejects(
    runManaged(node, ['-e', 'setInterval(() => {}, 1_000)'], {
      label: 'timeout fixture',
      timeoutMs: 50,
      graceMs: 100
    }),
    /timeout fixture exceeded 50ms and was terminated/
  )
})

test('managed child receives a cooperative process-group shutdown', async () => {
  const child = spawnManaged(
    node,
    [
      '-e',
      "process.on('SIGTERM', () => process.exit(0)); process.stdout.write('ready\\n'); setInterval(() => {}, 1_000)"
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] }
  )
  await waitForOutput(child, 'ready')

  assert.deepEqual(await stopManaged(child, { graceMs: 1_000 }), {
    forced: false,
    alreadyExited: false
  })
})

test('managed child escalates an ignored SIGTERM to process-group SIGKILL', async () => {
  const child = spawnManaged(
    node,
    ['-e', "process.on('SIGTERM', () => {}); process.stdout.write('ready\\n'); setInterval(() => {}, 1_000)"],
    { stdio: ['ignore', 'pipe', 'inherit'] }
  )
  await waitForOutput(child, 'ready')

  const result = await stopManaged(child, { graceMs: 50 })
  assert.equal(result.forced, true)
  assert.equal(child.signalCode, 'SIGKILL')
})

test('stopManaged kills a living process group after its leader exits', { skip: isWindows }, async (context) => {
  const fixture = createDescendantFixture()
  const leader = spawnManaged(node, ['-e', descendantLeaderSource, fixture.statePath, '7'], {
    stdio: ['ignore', 'ignore', 'inherit']
  })
  context.after(async () => cleanupDescendantFixture(fixture))

  const state = await readDescendantState(fixture.statePath)
  await waitForChildExit(leader)
  assert.equal(leader.exitCode, 7)
  assert.equal(processExists(state.descendantPid), true)
  assert.equal(managedTreeExists(leader), true)

  const result = await stopManaged(leader, { graceMs: 50 })
  assert.equal(result.forced, true)
  assert.equal(managedTreeExists(leader), false)
  assert.equal(await waitForProcessGone(state.descendantPid), true)
})

for (const exitCode of [0, 7]) {
  test(
    `runManaged removes descendants before returning from exit ${exitCode}`,
    { skip: isWindows },
    async (context) => {
      const fixture = createDescendantFixture()
      context.after(async () => cleanupDescendantFixture(fixture))

      const operation = runManaged(node, ['-e', descendantLeaderSource, fixture.statePath, String(exitCode)], {
        label: `descendant exit ${exitCode} fixture`,
        timeoutMs: 2_000,
        graceMs: 50,
        stdio: ['ignore', 'ignore', 'inherit']
      })
      if (exitCode === 0) {
        await operation
      } else {
        await assert.rejects(operation, /descendant exit 7 fixture failed with exit 7/)
      }

      const state = await readDescendantState(fixture.statePath)
      assert.equal(managedTreeExists({ pid: state.leaderPid, exitCode, signalCode: null }), false)
      assert.equal(await waitForProcessGone(state.descendantPid), true)
    }
  )
}

test('cleanup removes database sidecars, runtime cwd, artifacts, and the sandbox', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'swl-browser-helper-'))
  const databasePath = join(sandbox, 'data', 'runtime.db')
  const runtimeCwd = join(sandbox, 'runtime-cwd')
  const artifacts = join(sandbox, 'test-results')
  mkdirSync(join(sandbox, 'data'), { recursive: true })
  mkdirSync(runtimeCwd, { recursive: true })
  mkdirSync(artifacts, { recursive: true })
  for (const path of [
    databasePath,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
    join(runtimeCwd, 'file'),
    join(artifacts, 'trace.zip')
  ]) {
    writeFileSync(path, 'fixture')
  }

  cleanupDisposableState({ sandbox, databasePath, runtimeCwd, artifactPaths: [artifacts] })
  assert.equal(existsSync(sandbox), false)
})

test('cleanup coordinator runs once after success', async () => {
  let cleanups = 0
  const coordinator = createCleanupCoordinator({
    cleanup: () => {
      cleanups += 1
    }
  })
  await coordinator.run(async () => {})
  await coordinator.cleanup()
  assert.equal(cleanups, 1)
})

test('cleanup coordinator retains an injected operation failure after cleanup', async () => {
  const expected = new Error('injected browser failure')
  let cleanups = 0
  const coordinator = createCleanupCoordinator({
    cleanup: () => {
      cleanups += 1
    }
  })

  await assert.rejects(
    coordinator.run(async () => {
      throw expected
    }),
    (error) => error === expected
  )
  assert.equal(cleanups, 1)
})

test('composed cleanup removes disposable state after an injected operation failure', async () => {
  const fixture = createCleanupFixture()
  const expected = new Error('injected composed browser failure')
  const coordinator = createCleanupCoordinator({
    cleanup: () => cleanupDisposableState(fixture)
  })

  await assert.rejects(
    coordinator.run(async () => {
      throw expected
    }),
    (error) => error === expected
  )
  assert.equal(existsSync(fixture.sandbox), false)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`composed cleanup removes disposable state before re-emitting ${signal}`, async () => {
    const processTarget = new EventEmitter()
    processTarget.pid = 42
    processTarget.kill = (pid, receivedSignal) => processTarget.emit('killed', { pid, signal: receivedSignal })
    const fixture = createCleanupFixture()
    const coordinator = createCleanupCoordinator({
      cleanup: () => cleanupDisposableState(fixture),
      processTarget
    })
    coordinator.install()

    const killed = once(processTarget, 'killed')
    processTarget.emit(signal)
    const [{ pid, signal: receivedSignal }] = await killed
    assert.equal(existsSync(fixture.sandbox), false)
    assert.equal(pid, 42)
    assert.equal(receivedSignal, signal)
  })
}

function createCleanupFixture() {
  const sandbox = mkdtempSync(join(tmpdir(), 'swl-browser-coordinator-'))
  const databasePath = join(sandbox, 'data', 'runtime.db')
  const runtimeCwd = join(sandbox, 'runtime-cwd')
  const artifacts = join(sandbox, 'test-results')
  mkdirSync(join(sandbox, 'data'), { recursive: true })
  mkdirSync(runtimeCwd, { recursive: true })
  mkdirSync(artifacts, { recursive: true })
  writeFileSync(databasePath, 'fixture')
  writeFileSync(`${databasePath}-wal`, 'fixture')
  writeFileSync(`${databasePath}-shm`, 'fixture')
  writeFileSync(join(runtimeCwd, 'runtime-artifact'), 'fixture')
  writeFileSync(join(artifacts, 'trace.zip'), 'fixture')
  return { sandbox, databasePath, runtimeCwd, artifactPaths: [artifacts] }
}

function waitForOutput(child, expected) {
  return new Promise((resolveOutput, rejectOutput) => {
    let output = ''
    const timer = setTimeout(() => rejectOutput(new Error(`Timed out waiting for ${expected}`)), 2_000)
    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
      if (output.includes(expected)) {
        clearTimeout(timer)
        resolveOutput()
      }
    })
    child.once('error', rejectOutput)
    child.once('exit', (code) => {
      if (!output.includes(expected)) {
        rejectOutput(new Error(`Child exited ${code} before producing ${expected}`))
      }
    })
  })
}

function createDescendantFixture() {
  const sandbox = mkdtempSync(join(tmpdir(), 'swl-browser-descendant-'))
  return { sandbox, statePath: join(sandbox, 'state.json') }
}

async function readDescendantState(path) {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf8'))
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10))
  }
  throw new Error(`Timed out waiting for descendant fixture state: ${path}`)
}

async function waitForChildExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }
  await once(child, 'exit')
}

function processExists(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') {
      return false
    }
    throw error
  }
}

async function waitForProcessGone(pid) {
  const deadline = Date.now() + 2_000
  while (processExists(pid)) {
    if (Date.now() >= deadline) {
      return false
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25))
  }
  return true
}

async function cleanupDescendantFixture(fixture) {
  if (existsSync(fixture.statePath)) {
    const { leaderPid, descendantPid } = JSON.parse(readFileSync(fixture.statePath, 'utf8'))
    for (const pid of [-leaderPid, descendantPid]) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch (error) {
        if (error?.code !== 'ESRCH') {
          throw error
        }
      }
    }
  }
  rmSync(fixture.sandbox, { recursive: true, force: true })
}
