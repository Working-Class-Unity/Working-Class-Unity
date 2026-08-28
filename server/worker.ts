import * as Sentry from '@sentry/nuxt'
import { connectDatabase } from './db/connect'
import { getTransactionalEmailSender } from './services/email'
import { runNextJobForConnection, type JobHandler } from './services/jobs/job-queue'
import { runWorkerLoop } from './services/jobs/worker-loop'
import {
  createIdentityReviewNotificationHandler,
  identityReviewNotificationJobType
} from './services/membership/identity-review-notification'
import { billingStripeConfiguration } from './services/payments/stripe/app-composition'
import { createBillingStripeJobHandlers, ensureBillingStripeJobs } from './services/payments/stripe/jobs'
import { getAppRuntimeConfig, readDatabaseUrl } from './utils/runtime'
import { createAuthentication } from './utils/auth/create'
import {
  createPublicJoinClaimJobHandler,
  ensurePublicJoinClaimJobs,
  publicJoinClaimJobType
} from './services/membership/public-join-job'

const config = getAppRuntimeConfig()

if (process.env.NODE_ENV === 'production' && config.sentryDsn && !Sentry.getClient()) {
  throw new Error('Sentry must be preloaded before the production worker starts')
}
const connection = connectDatabase(readDatabaseUrl())
const emailSender = getTransactionalEmailSender()
const workerAuthentication = createAuthentication(config, connection, () => emailSender)
const shutdown = new AbortController()
const requestShutdown = (signal: NodeJS.Signals) => {
  if (shutdown.signal.aborted) return
  console.log(`Worker received ${signal}; finishing current job before shutdown`)
  shutdown.abort()
}
const onSigterm = () => requestShutdown('SIGTERM')
const onSigint = () => requestShutdown('SIGINT')
let nextBillingSafetyCheckAt = 0
const handlers: Record<string, JobHandler> = {
  [identityReviewNotificationJobType]: createIdentityReviewNotificationHandler({
    appName: config.public.appName,
    connection,
    sender: emailSender
  }),
  [publicJoinClaimJobType]: createPublicJoinClaimJobHandler({
    connection,
    secret: config.betterAuth.secret,
    issueMagicLink: async (body) => {
      const result = await workerAuthentication.api.signInMagicLink({
        body,
        headers: new Headers({ origin: new URL(config.betterAuth.url).origin })
      })
      if (!result.status) throw new Error('Public join magic-link issuance failed')
    }
  }),
  ...createBillingStripeJobHandlers({
    configuration: billingStripeConfiguration(config),
    emailVerificationSecret: config.betterAuth.secret,
    integration: undefined,
    sender: emailSender,
    connection
  })
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
      if (now.getTime() >= nextBillingSafetyCheckAt) {
        ensureBillingStripeJobs(connection, now)
        ensurePublicJoinClaimJobs(connection, now)
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
