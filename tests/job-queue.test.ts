import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { DatabaseConnection } from '../server/db/connect'
import * as schema from '../server/db/schema/index'
import {
  claimNextJobForConnection,
  completeJobForConnection,
  failJobForConnection,
  jobDiagnosticCodes,
  maxStoredJobDiagnosticBytes,
  runNextJobForConnection
} from '../server/services/jobs/job-queue'

const observabilityBoundary = vi.hoisted(() => ({
  captureException: vi.fn(async () => undefined)
}))

vi.mock('../server/services/observability/capture', () => ({
  captureException: observabilityBoundary.captureException
}))

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))

describe('background job queue', () => {
  it('leaves queued work untouched when no handler type is registered', async () => {
    const fixture = createFixture('empty-handler-registry')
    try {
      const jobId = Number(
        fixture.sqlite.prepare("insert into job_queue (type, payload) values ('files.cleanup-orphans', '{}')").run()
          .lastInsertRowid
      )

      await expect(runNextJobForConnection(fixture.connection, {}, 'worker_without_handlers')).resolves.toEqual({
        ran: false
      })
      expect(fixture.sqlite.prepare('select attempts, status from job_queue where id = ?').get(jobId)).toEqual({
        attempts: 0,
        status: 'queued'
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('reclaims a crashed queue lease atomically and rejects the former worker completion', async () => {
    const fixture = createFixture('lease-recovery')
    fixture.sqlite
      .prepare("insert into job_queue (type, payload, max_attempts) values ('files.cleanup-orphans', '{}', 3)")
      .run()

    try {
      const first = claimNextJobForConnection(fixture.connection, 'worker_one', {
        now: new Date('2026-07-11T00:00:00.000Z')
      })
      expect(first).toEqual(expect.objectContaining({ attempts: 1, status: 'running' }))
      expect(
        claimNextJobForConnection(fixture.connection, 'worker_two', {
          now: new Date('2026-07-11T00:04:59.000Z')
        })
      ).toBeNull()

      const reclaimed = claimNextJobForConnection(fixture.connection, 'worker_two', {
        now: new Date('2026-07-11T00:05:01.000Z')
      })
      expect(reclaimed).toEqual(expect.objectContaining({ id: first!.id, attempts: 2, status: 'running' }))
      expect(reclaimed!.lockedBy).not.toBe(first!.lockedBy)
      await expect(failJobForConnection(fixture.connection, first!.id, first!.lockedBy)).resolves.toBe('lease-lost')
      await expect(completeJobForConnection(fixture.connection, first!.id, first!.lockedBy)).resolves.toBe(false)
      await expect(completeJobForConnection(fixture.connection, reclaimed!.id, reclaimed!.lockedBy)).resolves.toBe(true)
      expect(fixture.sqlite.prepare('select status, attempts from job_queue where id = ?').get(first!.id)).toEqual({
        status: 'succeeded',
        attempts: 2
      })

      fixture.sqlite
        .prepare("insert into job_queue (type, payload, max_attempts) values ('test.cleanup', '{}', 1)")
        .run()
      const completionLeaseLost = await runNextJobForConnection(
        fixture.connection,
        {
          'test.cleanup': async () => {
            fixture.sqlite
              .prepare("update job_queue set locked_by = 'replacement-token' where type = 'test.cleanup'")
              .run()
          }
        },
        'worker_completion_lost'
      )
      expect(completionLeaseLost).toEqual({ ran: true, jobId: expect.any(Number), status: 'lease-lost' })

      fixture.sqlite
        .prepare("insert into job_queue (type, payload, max_attempts) values ('files.cleanup-orphans', '{}', 1)")
        .run()
      const finalAttempt = claimNextJobForConnection(fixture.connection, 'worker_final', {
        now: new Date('2026-07-11T01:00:00.000Z')
      })
      expect(finalAttempt).toEqual(expect.objectContaining({ attempts: 1, status: 'running' }))
      expect(
        claimNextJobForConnection(fixture.connection, 'worker_after_final', {
          now: new Date('2026-07-11T01:05:01.000Z')
        })
      ).toBeNull()
      expect(
        fixture.sqlite.prepare('select status, locked_by, last_error from job_queue where id = ?').get(finalAttempt!.id)
      ).toEqual({
        status: 'failed',
        locked_by: null,
        last_error: jobDiagnosticCodes.leaseExpiredFinalAttempt
      })

      fixture.sqlite.prepare("insert into job_queue (type, payload) values ('files.cleanup-orphans', 'not-json')").run()
      const validAfterMalformed = Number(
        fixture.sqlite.prepare("insert into job_queue (type, payload) values ('files.cleanup-orphans', '{}')").run()
          .lastInsertRowid
      )
      await expect(
        runNextJobForConnection(
          fixture.connection,
          { 'files.cleanup-orphans': async () => undefined },
          'worker_malformed',
          { now: new Date('2026-07-11T02:00:00.000Z') }
        )
      ).resolves.toEqual({ ran: false })
      expect(
        fixture.sqlite.prepare("select status, locked_by, last_error from job_queue where payload = 'not-json'").get()
      ).toEqual({ status: 'failed', locked_by: null, last_error: jobDiagnosticCodes.invalidPayload })
      await expect(
        runNextJobForConnection(
          fixture.connection,
          { 'files.cleanup-orphans': async () => undefined },
          'worker_after_malformed',
          { now: new Date('2026-07-11T02:00:01.000Z') }
        )
      ).resolves.toEqual({ ran: true, jobId: validAfterMalformed, status: 'succeeded' })
    } finally {
      fixture.cleanup()
    }
  })

  it('finalizes only registered expired job types while claiming the next registered row', () => {
    const fixture = createFixture('registered-types')
    try {
      const insert = fixture.sqlite.prepare("insert into job_queue (type, payload, max_attempts) values (?, '{}', ?)")
      const foreignId = Number(insert.run('future.unregistered', 1).lastInsertRowid)
      const expiredRegisteredId = Number(insert.run('files.cleanup-orphans', 1).lastInsertRowid)

      expect(
        claimNextJobForConnection(fixture.connection, 'future_worker', {
          now: new Date('2026-07-11T03:00:00.000Z'),
          types: ['future.unregistered']
        })
      ).toEqual(expect.objectContaining({ id: foreignId, status: 'running' }))
      expect(
        claimNextJobForConnection(fixture.connection, 'files_worker', {
          now: new Date('2026-07-11T03:00:00.000Z'),
          types: ['files.cleanup-orphans']
        })
      ).toEqual(expect.objectContaining({ id: expiredRegisteredId, status: 'running' }))

      const queuedRegisteredId = Number(insert.run('files.cleanup-orphans', 3).lastInsertRowid)
      expect(
        claimNextJobForConnection(fixture.connection, 'files_replacement', {
          now: new Date('2026-07-11T03:05:01.000Z'),
          types: ['files.cleanup-orphans']
        })
      ).toEqual(expect.objectContaining({ id: queuedRegisteredId, status: 'running' }))
      expect(
        fixture.sqlite.prepare('select status, locked_by, last_error from job_queue where id = ?').get(foreignId)
      ).toEqual({ status: 'running', locked_by: expect.any(String), last_error: null })
      expect(
        fixture.sqlite
          .prepare('select status, locked_by, last_error from job_queue where id = ?')
          .get(expiredRegisteredId)
      ).toEqual({
        status: 'failed',
        locked_by: null,
        last_error: jobDiagnosticCodes.leaseExpiredFinalAttempt
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('retries handler failures without persisting sensitive errors and terminally fails exhausted jobs', async () => {
    const fixture = createFixture('handler-failures')
    const sensitiveCanary = `secret-job-handler-canary-${'🧨'.repeat(maxStoredJobDiagnosticBytes)}`
    fixture.sqlite.prepare("insert into job_queue (type, payload, max_attempts) values ('test.cleanup', '{}', 2)").run()

    try {
      const handler = vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error(sensitiveCanary))
        .mockResolvedValueOnce(undefined)
      const retriedResult = await runNextJobForConnection(
        fixture.connection,
        { 'test.cleanup': handler },
        'worker_retry'
      )
      expect(retriedResult).toEqual({ ran: true, jobId: expect.any(Number), status: 'retry-scheduled' })

      const retried = fixture.sqlite
        .prepare(
          "select status, attempts, run_after as runAfter, last_error as lastError from job_queue where type = 'test.cleanup'"
        )
        .get() as { status: string; attempts: number; runAfter: string; lastError: string }
      expect(retried).toMatchObject({
        status: 'queued',
        attempts: 1,
        lastError: jobDiagnosticCodes.handlerFailed
      })
      expect(retried.lastError).not.toContain('secret-job-handler-canary')
      expect(new TextEncoder().encode(retried.lastError).byteLength).toBeLessThanOrEqual(maxStoredJobDiagnosticBytes)

      await expect(
        runNextJobForConnection(fixture.connection, { 'test.cleanup': handler }, 'worker_retry_early', {
          now: new Date(Date.parse(retried.runAfter) - 1)
        })
      ).resolves.toEqual({ ran: false })
      expect(handler).toHaveBeenCalledOnce()
      expect(
        fixture.sqlite.prepare("select status, attempts from job_queue where type = 'test.cleanup'").get()
      ).toEqual({ status: 'queued', attempts: 1 })

      const succeeded = await runNextJobForConnection(fixture.connection, { 'test.cleanup': handler }, 'worker_retry', {
        now: new Date(Date.parse(retried.runAfter) + 1)
      })
      expect(succeeded).toEqual({ ran: true, jobId: retriedResult.jobId, status: 'succeeded' })
      expect(handler).toHaveBeenCalledTimes(2)
      expect(
        fixture.sqlite.prepare("select status, attempts, last_error from job_queue where type = 'test.cleanup'").get()
      ).toEqual({ status: 'succeeded', attempts: 2, last_error: null })

      fixture.sqlite
        .prepare("insert into job_queue (type, payload, max_attempts) values ('test.cleanup', '{}', 1)")
        .run()
      const exhausted = await runNextJobForConnection(
        fixture.connection,
        { 'test.cleanup': async () => Promise.reject(new Error(sensitiveCanary)) },
        'worker_terminal'
      )
      expect(exhausted).toEqual({ ran: true, jobId: expect.any(Number), status: 'terminal-failed' })
      const terminal = fixture.sqlite
        .prepare('select status, last_error as lastError from job_queue where id = ?')
        .get(exhausted.jobId) as { status: string; lastError: string }
      expect(terminal).toEqual({ status: 'failed', lastError: jobDiagnosticCodes.handlerFailed })
      expect(terminal.lastError).not.toContain('secret-job-handler-canary')
      expect(new TextEncoder().encode(terminal.lastError).byteLength).toBeLessThanOrEqual(maxStoredJobDiagnosticBytes)
    } finally {
      fixture.cleanup()
    }
  })
})

function createFixture(label: string) {
  const directory = mkdtempSync(join(tmpdir(), `wcu-job-queue-${label}-`))
  const databasePath = join(directory, 'app.db')
  const sqlite = new Database(databasePath)
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle({ client: sqlite, schema })
  migrate(db, { migrationsFolder })
  const connection: DatabaseConnection = { sqlite, db, databasePath }

  return {
    sqlite,
    connection,
    cleanup: () => {
      sqlite.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
}
