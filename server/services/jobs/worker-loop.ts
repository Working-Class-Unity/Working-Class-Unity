import { setTimeout as delay } from 'node:timers/promises'
import type { RunNextJobResult } from './job-queue'

type WorkerLoopOptions = Readonly<{
  signal: AbortSignal
  idleDelayMs?: number
  onResult?: (result: Extract<RunNextJobResult, { ran: true }>) => void
  beforeClaim?: () => void | Promise<void>
}>

export async function runWorkerLoop(
  runNext: () => Promise<RunNextJobResult>,
  { signal, idleDelayMs = 1_000, onResult, beforeClaim }: WorkerLoopOptions
) {
  while (!signal.aborted) {
    await beforeClaim?.()
    if (signal.aborted) break
    const result = await runNext()

    if (result.ran) {
      onResult?.(result)
      continue
    }

    try {
      await delay(idleDelayMs, undefined, { signal })
    } catch (error) {
      if (!signal.aborted) throw error
    }
  }
}
