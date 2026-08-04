import { once } from 'node:events'
export { reservePort, selectEnvironment } from './ci-browser-helpers.mjs'

export function findAnchor(html, id) {
  return html.match(/<a\b[^>]*>/gi)?.find((tag) => tag.includes(`id="${id}"`))
}

export async function withAbortTimeout(operation, timeoutMs, label = 'Operation') {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`${label} has no remaining time`)
  }

  const controller = new AbortController()
  const timeoutError = new Error(`${label} exceeded ${timeoutMs}ms`)
  let timeoutId
  const timeout = new Promise((_, rejectTimeout) => {
    timeoutId = setTimeout(() => {
      controller.abort(timeoutError)
      rejectTimeout(timeoutError)
    }, timeoutMs)
  })

  try {
    return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), timeout])
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function waitForServer(serverProcess, url, timeoutMs, { fetchImplementation = fetch, pollMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Nuxt fixture exited before readiness with code ${serverProcess.exitCode}`)
    }

    try {
      const remainingMs = deadline - Date.now()
      const response = await withAbortTimeout(
        (signal) => fetchImplementation(url, { redirect: 'manual', signal }),
        remainingMs,
        `Nuxt readiness request to ${url}`
      )
      if (response.status > 0) {
        return
      }
    } catch {
      // The listener may not be ready yet.
    }

    const remainingMs = deadline - Date.now()
    if (remainingMs > 0) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(pollMs, remainingMs)))
    }
  }

  throw new Error(`Nuxt fixture did not answer ${url} within ${timeoutMs}ms`)
}

export async function stopChild(serverProcess, { graceMs = 5_000 } = {}) {
  if (!serverProcess || serverProcess.exitCode !== null) {
    return
  }

  const exited = once(serverProcess, 'exit')
  serverProcess.kill('SIGTERM')
  const timedOut = new Promise((resolveTimeout) => {
    setTimeout(() => resolveTimeout('timeout'), graceMs).unref()
  })

  if ((await Promise.race([exited, timedOut])) === 'timeout' && serverProcess.exitCode === null) {
    const forceExited = once(serverProcess, 'exit')
    serverProcess.kill('SIGKILL')
    await forceExited
  }
}
