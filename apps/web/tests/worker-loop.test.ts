import { describe, expect, it } from 'vitest'
import { runWorkerLoop } from '../server/services/jobs/worker-loop'

describe('worker loop', () => {
  it('finishes the in-flight result without claiming another job after shutdown', async () => {
    const shutdown = new AbortController()
    const results: Array<{ jobId: number; status: string }> = []
    let claims = 0

    await runWorkerLoop(
      async () => {
        claims += 1
        shutdown.abort()
        return { ran: true, jobId: 42, status: 'succeeded' }
      },
      {
        signal: shutdown.signal,
        onResult: ({ jobId, status }) => results.push({ jobId, status })
      }
    )

    expect(claims).toBe(1)
    expect(results).toEqual([{ jobId: 42, status: 'succeeded' }])
  })

  it('aborts an idle wait without making another claim', async () => {
    const shutdown = new AbortController()
    let claims = 0

    await runWorkerLoop(
      async () => {
        claims += 1
        queueMicrotask(() => shutdown.abort())
        return { ran: false }
      },
      { signal: shutdown.signal, idleDelayMs: 10_000 }
    )

    expect(claims).toBe(1)
  })

  it('runs maintenance before claiming and stops if that work requests shutdown', async () => {
    const shutdown = new AbortController()
    let claims = 0
    let maintenanceRuns = 0

    await runWorkerLoop(
      async () => {
        claims += 1
        return { ran: false }
      },
      {
        signal: shutdown.signal,
        idleDelayMs: 10_000,
        beforeClaim: () => {
          maintenanceRuns += 1
          shutdown.abort()
        }
      }
    )

    expect(claims).toBe(0)
    expect(maintenanceRuns).toBe(1)
  })

  it('continues maintenance checks while jobs remain continuously available', async () => {
    const shutdown = new AbortController()
    let claims = 0
    let maintenanceRuns = 0

    await runWorkerLoop(
      async () => {
        claims += 1
        return { ran: true, jobId: claims, status: 'succeeded' }
      },
      {
        signal: shutdown.signal,
        beforeClaim: () => {
          maintenanceRuns += 1
          if (maintenanceRuns === 3) shutdown.abort()
        }
      }
    )

    expect(claims).toBe(2)
    expect(maintenanceRuns).toBe(3)
  })
})
