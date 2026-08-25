import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { DatabaseConnection } from '../../db/connect'
import { jobQueue, type JsonValue } from '../../db/schema'
import { captureException } from '../observability/capture'

export type JobPayload = JsonValue
export type JobHandler = (payload: JobPayload) => Promise<void>

export const maxStoredJobDiagnosticBytes = 256
export const jobDiagnosticCodes = Object.freeze({
  handlerFailed: 'JOB_HANDLER_FAILED',
  invalidPayload: 'JOB_PAYLOAD_INVALID',
  leaseExpiredFinalAttempt: 'JOB_LEASE_EXPIRED_FINAL_ATTEMPT'
} as const)

export type JobFailureStatus = 'retry-scheduled' | 'terminal-failed' | 'lease-lost'
export type RunNextJobResult = { ran: false } | { ran: true; jobId: number; status: 'succeeded' | JobFailureStatus }

export type ClaimJobOptions = Readonly<{
  leaseMs?: number
  now?: Date
  types?: readonly string[]
}>

const defaultJobLeaseMs = 5 * 60 * 1000

export function claimNextJobForConnection(
  connection: DatabaseConnection,
  workerId = `worker_${randomUUID()}`,
  options: ClaimJobOptions = {}
) {
  const types = options.types ? [...new Set(options.types)] : null
  if (types?.length === 0) return null

  const now = options.now ?? new Date()
  const nowIso = now.toISOString()
  const staleBefore = new Date(now.getTime() - (options.leaseMs ?? defaultJobLeaseMs)).toISOString()
  const lockToken = `${workerId}:${randomUUID()}`
  const typeClause = types ? `and type in (${types.map(() => '?').join(', ')})` : ''
  connection.sqlite
    .prepare(
      `
      update job_queue
      set
        status = 'failed',
        locked_at = null,
        locked_by = null,
        last_error = ?,
        updated_at = ?
      where status = 'running'
        and attempts >= max_attempts
        and (locked_at is null or locked_at <= ?)
        ${typeClause}
    `
    )
    .run(jobDiagnosticCodes.leaseExpiredFinalAttempt, nowIso, staleBefore, ...(types ?? []))
  const row = connection.sqlite
    .prepare(
      `
      update job_queue
      set
        status = 'running',
        locked_at = ?,
        locked_by = ?,
        attempts = attempts + 1,
        last_error = null,
        updated_at = ?
      where id = (
        select id
        from job_queue
        where attempts < max_attempts
          and (
            (status = 'queued' and (run_after is null or run_after <= ?))
            or (status = 'running' and (locked_at is null or locked_at <= ?))
          )
          ${typeClause}
        order by
          case when status = 'running' then 0 else 1 end,
          coalesce(run_after, created_at),
          id
        limit 1
      )
      returning
        id, type, status, payload, attempts, max_attempts, run_after,
        locked_at, locked_by, last_error, created_at, updated_at
    `
    )
    .get(nowIso, lockToken, nowIso, nowIso, staleBefore, ...(types ?? [])) as RawJobRow | undefined

  if (!row) return null

  try {
    return jobFromRawRow(row)
  } catch {
    connection.sqlite
      .prepare(
        `
        update job_queue
        set status = 'failed', locked_at = null, locked_by = null, last_error = ?, updated_at = ?
        where id = ? and status = 'running' and locked_by = ?
      `
      )
      .run(jobDiagnosticCodes.invalidPayload, nowIso, row.id, lockToken)
    return null
  }
}

export async function completeJobForConnection(connection: DatabaseConnection, id: number, lockedBy: string) {
  const completed = await connection.db
    .update(jobQueue)
    .set({
      status: 'succeeded',
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      updatedAt: new Date().toISOString()
    })
    .where(and(eq(jobQueue.id, id), eq(jobQueue.status, 'running'), eq(jobQueue.lockedBy, lockedBy)))
    .returning({ id: jobQueue.id })

  return completed.length === 1
}

export async function failJobForConnection(
  connection: DatabaseConnection,
  id: number,
  lockedBy: string,
  options: {
    retryDelaySeconds?: number
  } = {}
): Promise<JobFailureStatus> {
  const [job] = await connection.db
    .select()
    .from(jobQueue)
    .where(and(eq(jobQueue.id, id), eq(jobQueue.status, 'running'), eq(jobQueue.lockedBy, lockedBy)))
    .limit(1)

  if (!job) {
    return 'lease-lost'
  }

  const shouldRetry = job.attempts < job.maxAttempts
  const now = new Date()

  const failed = await connection.db
    .update(jobQueue)
    .set({
      status: shouldRetry ? 'queued' : 'failed',
      runAfter: shouldRetry
        ? new Date(now.getTime() + (options.retryDelaySeconds ?? 60) * 1000).toISOString()
        : job.runAfter,
      lockedAt: null,
      lockedBy: null,
      lastError: jobDiagnosticCodes.handlerFailed,
      updatedAt: now.toISOString()
    })
    .where(and(eq(jobQueue.id, id), eq(jobQueue.status, 'running'), eq(jobQueue.lockedBy, lockedBy)))
    .returning({ id: jobQueue.id })

  if (failed.length !== 1) return 'lease-lost'
  return shouldRetry ? 'retry-scheduled' : 'terminal-failed'
}

export async function runNextJobForConnection(
  connection: DatabaseConnection,
  handlers: Record<string, JobHandler>,
  workerId?: string,
  options: ClaimJobOptions = {}
): Promise<RunNextJobResult> {
  const job = claimNextJobForConnection(connection, workerId, {
    ...options,
    types: Object.keys(handlers)
  })

  if (!job) {
    return {
      ran: false
    }
  }

  try {
    const handler = handlers[job.type]

    if (!handler) {
      throw new Error(`No handler registered for job type: ${job.type}`)
    }

    await handler(job.payload)
    const completed = await completeJobForConnection(connection, job.id, job.lockedBy)

    return {
      ran: true,
      jobId: job.id,
      status: completed ? 'succeeded' : 'lease-lost'
    }
  } catch (error) {
    await captureException(error, 'background-job-execution-failed')
    const status = await failJobForConnection(connection, job.id, job.lockedBy)

    return {
      ran: true,
      jobId: job.id,
      status
    }
  }
}

type RawJobRow = {
  id: number
  type: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  payload: string
  attempts: number
  max_attempts: number
  run_after: string | null
  locked_at: string | null
  locked_by: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

function jobFromRawRow(row: RawJobRow) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    payload: JSON.parse(row.payload) as JsonValue,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAfter: row.run_after,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by!,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
