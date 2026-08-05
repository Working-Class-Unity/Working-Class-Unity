import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { billingStripeJobTypes } from '../server/services/payments/stripe/jobs'

const [
  billingAccountDeletionCancellationJobType,
  billingDetachedSubscriptionCancellationJobType,
  billingWebhookReconciliationJobType,
  billingReconciliationSafetyJobType,
  billingTransitionConvergenceJobType,
  billingNotificationDeliveryJobType
] = billingStripeJobTypes

const execFileAsync = promisify(execFile)
const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
const tsxImport = createRequire(import.meta.url).resolve('tsx')
const workerEntry = fileURLToPath(new URL('../server/worker.ts', import.meta.url))
const workerPreload = fileURLToPath(new URL('../worker-sentry.server.config.ts', import.meta.url))
const webRoot = fileURLToPath(new URL('..', import.meta.url))

describe('worker entry', () => {
  it('fails before opening SQLite in production without the Sentry preload', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'swl-worker-preload-'))
    const databasePath = join(directory, 'unopened-database', 'worker.db')

    try {
      const execution = execFileAsync(process.execPath, ['--import', tsxImport, workerEntry], {
        cwd: webRoot,
        env: workerEnvironment(databasePath),
        encoding: 'utf8',
        timeout: 30_000
      })

      await expect(execution).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining('Sentry must be preloaded before the production worker starts')
      })
      expect(existsSync(dirname(databasePath))).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 40_000)

  it('runs configured local Files cleanup and retains one future safety sweep', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'swl-worker-files-'))
    const databasePath = join(directory, 'worker.db')
    const objectPath = join(dirname(databasePath), 'objects/files/v1/file_123e4567-e89b-42d3-a456-426614174000')
    let sqlite: InstanceType<typeof Database> | undefined
    let worker: RunningWorker | undefined
    try {
      sqlite = createMigratedDatabase(databasePath)
      sqlite
        .prepare('insert into app_settings (key, value) values (?, ?)')
        .run('files.storage-binding.v1', JSON.stringify({ version: 1, driver: 'local', bucket: 'local' }))
      const jobId = insertJob(sqlite, 'files.cleanup-orphans')
      mkdirSync(dirname(objectPath), { recursive: true })
      writeFileSync(objectPath, 'orphaned worker fixture')

      worker = startWorker(databasePath)

      expect(await waitForCompletedJob(sqlite, jobId)).toEqual(completedOnce)
      const cleanupJobs = await waitForFileCleanupConvergence(sqlite, objectPath)
      const completed = cleanupJobs.filter((job) => job.status === 'succeeded')
      const queued = cleanupJobs.filter((job) => job.status === 'queued')
      expect(completed.length).toBeGreaterThan(1)
      expect(completed.every((job) => job.attempts === 1)).toBe(true)
      expect(queued).toEqual([
        {
          status: 'queued',
          attempts: 0,
          payload: '{}',
          runAfter: expect.any(String)
        }
      ])
      expect(Date.parse(queued[0]!.runAfter!)).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000)
      const output = await stopWorker(worker)
      expect(output.stdout).toContain(`Worker processed job ${jobId}: succeeded`)
    } finally {
      await forceStopWorker(worker)
      if (sqlite?.open) sqlite.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }, 40_000)

  it('registers every Billing job handler', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'swl-worker-billing-deletion-'))
    const databasePath = join(directory, 'worker.db')
    let sqlite: InstanceType<typeof Database> | undefined
    let worker: RunningWorker | undefined
    try {
      sqlite = createMigratedDatabase(databasePath)
      const jobId = Number(
        sqlite
          .prepare('insert into job_queue (type, payload) values (?, ?)')
          .run(billingAccountDeletionCancellationJobType, JSON.stringify({ requestId: 'missing_request' }))
          .lastInsertRowid
      )
      const cycleStartedAt = new Date().toISOString()
      sqlite
        .prepare(
          'insert into billing_events (stripe_event_id, event_type, provider_created_at, processed_at) values (?, ?, ?, ?)'
        )
        .run('evt_worker_duplicate', 'customer.subscription.updated', 1, cycleStartedAt)
      const supportingJobs = [
        insertJob(sqlite, billingDetachedSubscriptionCancellationJobType, {
          subjectId: 'missing_detached_subject'
        }),
        insertJob(sqlite, billingReconciliationSafetyJobType, { cursor: null, cycleStartedAt }),
        insertJob(sqlite, billingWebhookReconciliationJobType, {
          eventId: 'evt_worker_duplicate',
          eventType: 'customer.subscription.updated',
          eventCreatedAt: 1,
          objectId: 'sub_worker_duplicate'
        }),
        insertJob(sqlite, billingTransitionConvergenceJobType, { transitionId: 'missing_transition' }),
        insertJob(sqlite, billingNotificationDeliveryJobType, {
          notificationKey: 'b'.repeat(64),
          kind: 'payment_attention',
          purchaserUserId: 'missing_user',
          authorityReference: null
        })
      ]
      worker = startWorker(databasePath, {
        NUXT_STRIPE_SECRET_KEY: 'rk_test_worker_entry',
        NUXT_STRIPE_WEBHOOK_SECRET: 'whsec_worker_entry',
        NUXT_STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_worker_entry',
        NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID: 'price_worker_personal_weekly',
        NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID: 'price_worker_personal_monthly',
        NUXT_STRIPE_PERSONAL_ANNUAL_PRICE_ID: 'price_worker_personal_annual',
        NUXT_STRIPE_FAMILY_MONTHLY_PRICE_ID: 'price_worker_family_monthly',
        NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID: 'price_worker_family_annual'
      })

      expect(await waitForCompletedJob(sqlite, jobId)).toEqual(completedOnce)
      for (const supportingJobId of supportingJobs) {
        expect(await waitForCompletedJob(sqlite, supportingJobId)).toEqual(completedOnce)
      }
      const output = await stopWorker(worker)
      expect(output.stdout).toContain(`Worker processed job ${jobId}: succeeded`)
    } finally {
      await forceStopWorker(worker)
      if (sqlite?.open) sqlite.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }, 40_000)
})

const completedOnce = {
  attempts: 1,
  last_error: null,
  locked_at: null,
  locked_by: null,
  status: 'succeeded'
}

function createMigratedDatabase(databasePath: string) {
  const sqlite = new Database(databasePath)
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('journal_mode = WAL')
  migrate(drizzle({ client: sqlite }), { migrationsFolder })
  return sqlite
}

function readJob(sqlite: InstanceType<typeof Database>, jobId: number) {
  return sqlite
    .prepare('select status, attempts, locked_at, locked_by, last_error from job_queue where id = ?')
    .get(jobId)
}

function insertJob(sqlite: InstanceType<typeof Database>, type: string, payload: unknown = {}) {
  return Number(
    sqlite.prepare('insert into job_queue (type, payload) values (?, ?)').run(type, JSON.stringify(payload))
      .lastInsertRowid
  )
}

type WorkerOutput = { stdout: string; stderr: string }
type RunningWorker = WorkerOutput & {
  child: ReturnType<typeof spawn>
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
}

function startWorker(databasePath: string, overrides: Record<string, string> = {}): RunningWorker {
  const child = spawn(process.execPath, ['--import', tsxImport, '--import', workerPreload, workerEntry], {
    cwd: webRoot,
    env: workerEnvironment(databasePath, overrides),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const worker: RunningWorker = {
    child,
    stdout: '',
    stderr: '',
    exited: new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => resolve({ code, signal }))
    })
  }

  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => (worker.stdout += chunk))
  child.stderr?.on('data', (chunk: string) => (worker.stderr += chunk))
  return worker
}

async function waitForCompletedJob(sqlite: InstanceType<typeof Database>, jobId: number) {
  const deadline = Date.now() + 15_000
  let job = readJob(sqlite, jobId)
  while ((job as { status?: string } | undefined)?.status !== 'succeeded' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
    job = readJob(sqlite, jobId)
  }
  if ((job as { status?: string } | undefined)?.status !== 'succeeded') {
    throw new Error(`Worker did not complete job ${jobId}: ${JSON.stringify(job)}`)
  }
  return job
}

async function waitForFileCleanupConvergence(sqlite: InstanceType<typeof Database>, objectPath: string) {
  const deadline = Date.now() + 15_000
  let jobs = readFileCleanupJobs(sqlite)
  while ((existsSync(objectPath) || !hasOnlyFutureSafetyJob(jobs)) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
    jobs = readFileCleanupJobs(sqlite)
  }
  if (existsSync(objectPath) || !hasOnlyFutureSafetyJob(jobs)) {
    throw new Error(`Worker did not converge file cleanup: ${JSON.stringify(jobs)}`)
  }
  return jobs
}

function hasOnlyFutureSafetyJob(jobs: ReturnType<typeof readFileCleanupJobs>) {
  const active = jobs.filter((job) => job.status === 'queued' || job.status === 'running')
  return (
    jobs.every((job) => job.status === 'succeeded' || job.status === 'queued') &&
    active.length === 1 &&
    active[0]?.status === 'queued' &&
    active[0].attempts === 0 &&
    active[0].payload === '{}' &&
    typeof active[0].runAfter === 'string' &&
    Date.parse(active[0].runAfter) > Date.now() + 23 * 60 * 60 * 1000
  )
}

function readFileCleanupJobs(sqlite: InstanceType<typeof Database>) {
  return sqlite
    .prepare(
      "select status, attempts, payload, run_after as runAfter from job_queue where type = 'files.cleanup-orphans' order by id"
    )
    .all() as Array<{ status: string; attempts: number; payload: string; runAfter: string | null }>
}

async function stopWorker(worker: RunningWorker) {
  expect(worker.child.kill('SIGTERM')).toBe(true)
  const exit = await withTimeout(worker.exited, 10_000, 'Worker did not stop after SIGTERM')
  expect(exit).toEqual({ code: 0, signal: null })
  expect(worker.stderr).toBe('')
  expect(worker.stdout).toContain('Worker started\n')
  expect(worker.stdout).toContain('Worker received SIGTERM; finishing current job before shutdown\n')
  expect(worker.stdout).toContain('Worker stopped\n')
  return worker
}

async function forceStopWorker(worker?: RunningWorker) {
  if (!worker || worker.child.exitCode !== null || worker.child.signalCode !== null) return
  worker.child.kill('SIGKILL')
  await withTimeout(worker.exited, 5_000, 'Worker did not stop after SIGKILL').catch(() => undefined)
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function workerEnvironment(databasePath: string, overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    CI: 'true',
    NODE_ENV: 'production',
    NUXT_DATABASE_URL: `file:${databasePath}`,
    NUXT_READINESS_TOKEN: 'worker-entry-readiness-value-at-least-thirty-two-chars',
    NUXT_BETTER_AUTH_SECRET: 'worker-entry-auth-value-at-least-thirty-two-chars',
    NUXT_BETTER_AUTH_URL: 'http://127.0.0.1:3000',
    NUXT_EMAIL_TRANSPORT: 'capture',
    NUXT_EMAIL_FROM: 'Worker Test <worker@example.test>',
    NUXT_EMAIL_CAPTURE_DIRECTORY: join(dirname(databasePath), 'email'),
    NUXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
    NUXT_STRIPE_SECRET_KEY: 'rk_test_worker_entry',
    NUXT_STRIPE_WEBHOOK_SECRET: 'whsec_worker_entry',
    NUXT_STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_worker_entry',
    NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID: 'price_worker_personal_weekly',
    NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID: 'price_worker_personal_monthly',
    NUXT_STRIPE_PERSONAL_ANNUAL_PRICE_ID: 'price_worker_personal_annual',
    NUXT_STRIPE_FAMILY_MONTHLY_PRICE_ID: 'price_worker_family_monthly',
    NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID: 'price_worker_family_annual',
    NUXT_FILES_DRIVER: 'local',
    NUXT_OPENAI_API_KEY: 'worker-openai-key-not-a-provider-credential',
    NUXT_OPENAI_PROJECT_ID: 'proj_worker_entry',
    NUXT_OPENAI_MODEL: 'gpt-5.6-luna',
    NUXT_OPENAI_FILE_SEARCH_VECTOR_STORE_ID: 'vs_worker_empty',
    NUXT_OPENAI_WEB_SEARCH_ALLOWED_DOMAINS: 'example.test',
    NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY: 'worker-turnstile-secret-not-a-provider-credential',
    NUXT_PUBLIC_TURNSTILE_SITE_KEY: 'worker-turnstile-site-not-a-provider-credential',
    NUXT_SENTRY_DSN: 'https://server@example.ingest.sentry.io/1',
    NUXT_PUBLIC_SENTRY_DSN: 'https://public@example.ingest.sentry.io/2',
    ...overrides
  }
}
