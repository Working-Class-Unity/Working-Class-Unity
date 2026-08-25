import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve, sep } from 'node:path'

const isWindows = process.platform === 'win32'

export function selectEnvironment(source, keys) {
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]))
}

export async function reservePort() {
  const socket = createServer()
  socket.unref()
  socket.listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const address = socket.address()
  const selectedPort = typeof address === 'object' && address ? address.port : null
  await new Promise((resolveClose, rejectClose) => {
    socket.close((error) => (error ? rejectClose(error) : resolveClose()))
  })

  if (!selectedPort) {
    throw new Error('Could not reserve a local loopback port')
  }
  return selectedPort
}

export function spawnManaged(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio ?? 'inherit',
    detached: !isWindows
  })

  options.onSpawn?.(child)
  child.once('error', (error) => {
    child.managedSpawnError = error
  })
  return child
}

export async function runManaged(command, args, options) {
  const child = spawnManaged(command, args, options)
  try {
    const outcome = await waitForExitOrTimeout(child, options.timeoutMs)

    if (outcome === 'timeout') {
      const stopped = await stopManaged(child, { graceMs: options.graceMs })
      throw new Error(
        `${options.label} exceeded ${options.timeoutMs}ms and was ${stopped.forced ? 'force-killed' : 'terminated'}`
      )
    }

    await stopManaged(child, { graceMs: options.graceMs })
    if (outcome.error) {
      throw outcome.error
    }
    if (outcome.code !== 0) {
      throw new Error(
        `${options.label} failed with ${outcome.signal ? `signal ${outcome.signal}` : `exit ${outcome.code}`}`
      )
    }

    return outcome
  } finally {
    if (!managedTreeExists(child)) {
      options.onExit?.(child)
    }
  }
}

export async function stopManaged(child, options = {}) {
  if (!child || !managedTreeExists(child)) {
    return { forced: false, alreadyExited: true }
  }

  const graceMs = options.graceMs ?? 5_000
  signalProcessGroup(child, 'SIGTERM')
  if (await waitForManagedTreeExit(child, graceMs)) {
    return { forced: false, alreadyExited: false }
  }

  signalProcessGroup(child, 'SIGKILL')
  if (!(await waitForManagedTreeExit(child, Math.max(graceMs, 1_000)))) {
    throw new Error(`Process group ${child.pid ?? 'unknown'} did not exit after SIGKILL`)
  }

  return { forced: true, alreadyExited: false }
}

export function managedTreeExists(child) {
  if (!child?.pid) {
    return false
  }
  if (isWindows) {
    return !hasExited(child)
  }

  try {
    process.kill(-child.pid, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') {
      return false
    }
    if (error?.code === 'EPERM') {
      return true
    }
    throw error
  }
}

export async function waitForHttp(url, options) {
  const deadline = Date.now() + options.timeoutMs
  let lastError

  while (Date.now() < deadline) {
    if (options.child?.managedSpawnError) {
      throw options.child.managedSpawnError
    }
    if (options.child && hasExited(options.child)) {
      throw new Error(`Server exited before readiness at ${url}`)
    }

    const remaining = deadline - Date.now()
    const requestTimeout = Math.max(1, Math.min(options.requestTimeoutMs, remaining))
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(requestTimeout)
      })
      if (response.ok) {
        await response.body?.cancel()
        return
      }
      lastError = new Error(`readiness returned HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }

    await delay(Math.min(250, Math.max(1, deadline - Date.now())))
  }

  throw new Error(
    `Server did not become ready at ${url} within ${options.timeoutMs}ms: ${lastError?.message ?? 'no response'}`
  )
}

export function cleanupDisposableState({ sandbox, databasePath, runtimeCwd, artifactPaths = [] }) {
  const sandboxRoot = resolve(sandbox)
  const candidates = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`, runtimeCwd, ...artifactPaths]

  for (const candidate of candidates) {
    assertInside(sandboxRoot, candidate)
    rmSync(candidate, { recursive: true, force: true })
  }

  rmSync(sandboxRoot, { recursive: true, force: true })
  if (existsSync(sandboxRoot)) {
    throw new Error(`Disposable browser sandbox remains after cleanup: ${sandboxRoot}`)
  }
}

export function remainingTimeout(deadline, maximumMs, label) {
  const remaining = deadline - Date.now()
  if (remaining <= 0) {
    throw new Error(`Overall browser smoke deadline expired before ${label}`)
  }
  return Math.max(1, Math.min(maximumMs, remaining))
}

export function createCleanupCoordinator({ cleanup, processTarget = process, signals = ['SIGINT', 'SIGTERM'] }) {
  let cleanupPromise
  let installed = false
  let handledSignal
  const handlers = new Map(signals.map((signal) => [signal, () => void handleSignal(signal)]))

  function cleanupOnce() {
    cleanupPromise ??= Promise.resolve().then(cleanup)
    return cleanupPromise
  }

  function install() {
    if (installed) {
      return
    }
    installed = true
    for (const [signal, handler] of handlers) {
      processTarget.once(signal, handler)
    }
  }

  function uninstall() {
    if (!installed) {
      return
    }
    installed = false
    for (const [signal, handler] of handlers) {
      processTarget.removeListener(signal, handler)
    }
  }

  async function handleSignal(signal) {
    if (handledSignal) {
      return
    }
    handledSignal = signal

    try {
      await cleanupOnce()
    } catch (error) {
      console.error(`Cleanup failed while handling ${signal}:`)
      console.error(error)
    } finally {
      uninstall()
      processTarget.kill(processTarget.pid, signal)
    }
  }

  async function run(operation) {
    install()
    let operationError
    let cleanupError

    try {
      await operation()
    } catch (error) {
      operationError = error
    } finally {
      try {
        await cleanupOnce()
      } catch (error) {
        cleanupError = error
      }
      uninstall()
    }

    if (operationError) {
      if (cleanupError) {
        console.error('Cleanup also failed after the primary browser error:')
        console.error(cleanupError)
      }
      throw operationError
    }
    if (cleanupError) {
      throw cleanupError
    }
  }

  return { cleanup: cleanupOnce, handleSignal, install, run, uninstall }
}

function signalProcessGroup(child, signal) {
  if (!child.pid) {
    return
  }

  try {
    if (isWindows) {
      if (!hasExited(child)) {
        child.kill(signal)
      }
    } else {
      process.kill(-child.pid, signal)
    }
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      throw error
    }
  }
}

async function waitForManagedTreeExit(child, timeoutMs) {
  if (isWindows) {
    return (await waitForExitOrTimeout(child, timeoutMs)) !== 'timeout'
  }

  const deadline = Date.now() + timeoutMs
  while (managedTreeExists(child)) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      return false
    }
    await delayReferenced(Math.min(25, remaining))
  }
  return true
}

function waitForExitOrTimeout(child, timeoutMs) {
  if (hasExited(child)) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  }

  return new Promise((resolveOutcome) => {
    let settled = false
    const timer = setTimeout(() => finish('timeout'), timeoutMs)
    timer.unref?.()

    const onExit = (code, signal) => finish({ code, signal })
    const onError = (error) => finish({ error, code: null, signal: null })
    child.once('exit', onExit)
    child.once('error', onError)

    function finish(outcome) {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      child.removeListener('exit', onExit)
      child.removeListener('error', onError)
      resolveOutcome(outcome)
    }
  })
}

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null
}

function assertInside(sandboxRoot, candidate) {
  const target = resolve(candidate)
  if (target !== sandboxRoot && !target.startsWith(`${sandboxRoot}${sep}`)) {
    throw new Error(`Refusing to clean path outside browser sandbox: ${target}`)
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => {
    const timer = setTimeout(resolveDelay, ms)
    timer.unref?.()
  })
}

function delayReferenced(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}
