import * as Sentry from '@sentry/nuxt'
import { connectDatabase } from './db/connect'
import { getTransactionalEmailSender } from './services/email'
import { runNextJobForConnection, type JobHandler } from './services/jobs/job-queue'
import { runWorkerLoop } from './services/jobs/worker-loop'
import { billingStripeConfiguration } from './services/payments/stripe/app-composition'
import { createBillingStripeJobHandlers, ensureBillingStripeJobs } from './services/payments/stripe/jobs'
import { cleanupOrphanedFileObjects, ensureFileReconciliationSafetyJob } from './services/storage/orphan-cleanup'
import { getAppRuntimeConfig, readDatabaseUrl } from './utils/runtime'

const config = getAppRuntimeConfig()

if (process.env.NODE_ENV === 'production' && !Sentry.getClient()) {
  throw new Error('Sentry must be preloaded before the production worker starts')
}
const connection = connectDatabase(readDatabaseUrl())
const shutdown = new AbortController()
const requestShutdown = (signal: NodeJS.Signals) => {
  if (shutdown.signal.aborted) return
  console.log(`Worker received ${signal}; finishing current job before shutdown`)
  shutdown.abort()
}
const onSigterm = () => requestShutdown('SIGTERM')
const onSigint = () => requestShutdown('SIGINT')
let nextFileSafetyCheckAt = 0
let nextBillingSafetyCheckAt = 0
const handlers: Record<string, JobHandler> = {
  ...createBillingStripeJobHandlers({
    configuration: billingStripeConfiguration(config),
    integration: undefined,
    sender: getTransactionalEmailSender(),
    connection
  }),
  'files.cleanup-orphans': async (payload) => {
    await cleanupOrphanedFileObjects(connection, payload)
  }
}

process.once('SIGTERM', onSigterm)
process.once('SIGINT', onSigint)
console.log('Worker started')

try {
  await runWorkerLoop(() => runNextJobForConnection(connection, handlers), {
    signal: shutdown.signal,
    onResult: (result) => console.log(`Worker processed job ${result.jobId}: ${result.status}`),
    beforeClaim: () => {
      const now = new Date()
      if (now.getTime() >= nextFileSafetyCheckAt) {
        const state = ensureFileReconciliationSafetyJob(connection, now)
        nextFileSafetyCheckAt = now.getTime() + (state === 'covered-active' ? 1_000 : 60_000)
      }
      if (now.getTime() >= nextBillingSafetyCheckAt) {
        ensureBillingStripeJobs(connection, now)
        nextBillingSafetyCheckAt = now.getTime() + 60_000
      }
    }
  })
} finally {
  process.off('SIGTERM', onSigterm)
  process.off('SIGINT', onSigint)
  if (Sentry.getClient()) {
    try {
      if (!(await Sentry.flush(2_000))) console.error('Worker telemetry flush did not complete during shutdown')
    } catch {
      console.error('Worker telemetry flush did not complete during shutdown')
    }
  }
  if (connection.sqlite.open) connection.sqlite.close()
  console.log('Worker stopped')
}
