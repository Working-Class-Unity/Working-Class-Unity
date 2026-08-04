import * as Sentry from '@sentry/nuxt'
import { connectDatabase } from './db/connect'
import { ensureFamilyJoinRecoveryJobs } from './db/repositories/family-join'
import { getTransactionalEmailSender } from './services/email'
import {
  createFamilyInvitationExpirationJobHandlers,
  ensureFamilyInvitationExpirationJob
} from './services/jobs/family-invitation-expiration'
import { createFamilyJoinRecoveryJobHandlers } from './services/jobs/family-join-recovery'
import { runNextJobForConnection, type JobHandler } from './services/jobs/job-queue'
import { runWorkerLoop } from './services/jobs/worker-loop'
import {
  billingAccountDeletionCancellationJobType,
  createBillingAccountDeletionCancellationJobHandler,
  ensureBillingAccountDeletionCancellationJobs
} from './services/payments/billing-account-deletion-job'
import {
  billingDetachedSubscriptionCancellationJobType,
  createBillingDetachedSubscriptionCancellationHandler,
  ensureBillingDetachedSubscriptionCancellationJobs
} from './services/payments/billing-detached-subscription-cancellation'
import { createStripeBillingCatalog } from './services/payments/billing-catalog'
import { createBillingFamilyLifecycleJobHandlers } from './services/payments/billing-family-lifecycle'
import { ensureBillingFamilyLifecycleJobs } from './services/payments/billing-family-lifecycle-safety'
import {
  billingNotificationDeliveryJobType,
  createBillingNotificationDeliveryHandler,
  ensureBillingNotificationDeliveryJobs
} from './services/payments/billing-notification-delivery'
import {
  billingReconciliationSafetyJobType,
  createBillingReconciliationSafetyHandler,
  ensureBillingReconciliationSafetyJob
} from './services/payments/billing-reconciliation-safety'
import {
  billingTransitionConvergenceJobType,
  createBillingTransitionConvergenceHandler,
  ensureBillingTransitionConvergenceJobs
} from './services/payments/billing-transition-convergence'
import { createBillingWebhookReconciliationHandler } from './services/payments/billing-webhook-reconciliation'
import {
  billingWebhookReconciliationJobType,
  ensureBillingWebhookReconciliationJobs
} from './services/payments/billing-webhook-reference'
import { getStripeClient } from './services/payments/stripe-client'
import { cleanupOrphanedFileObjects, ensureFileReconciliationSafetyJob } from './services/storage/orphan-cleanup'
import { isModuleReady } from './utils/module-state'
import { getAppRuntimeConfig, readDatabaseUrl } from './utils/runtime'

const config = getAppRuntimeConfig()

if (!isModuleReady('jobs', config)) {
  if (Sentry.getClient()) throw new Error('Sentry must not be preloaded while the production worker is disabled')
  const idle = setInterval(() => undefined, 60_000)
  await new Promise<void>((resolve) => {
    const stop = (signal: NodeJS.Signals) => {
      process.off('SIGTERM', onSigterm)
      process.off('SIGINT', onSigint)
      clearInterval(idle)
      console.log(`Worker received ${signal}; stopping idle worker`)
      resolve()
    }
    const onSigterm = () => stop('SIGTERM')
    const onSigint = () => stop('SIGINT')
    process.once('SIGTERM', onSigterm)
    process.once('SIGINT', onSigint)
    console.log('Worker idle: jobs module is disabled')
  })
  console.log('Worker stopped')
} else {
  if (isModuleReady('observability', config) && !Sentry.getClient()) {
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
  const filesReady = isModuleReady('files', config)
  const billingReady = isModuleReady('billing', config)
  let nextFileSafetyCheckAt = 0
  let nextBillingSafetyCheckAt = 0
  const handlers: Record<string, JobHandler> = {}
  if (billingReady) {
    const stripe = getStripeClient(config)
    handlers[billingAccountDeletionCancellationJobType] = createBillingAccountDeletionCancellationJobHandler(
      connection,
      () => stripe,
      createStripeBillingCatalog(config.stripe)
    )
    handlers[billingDetachedSubscriptionCancellationJobType] = createBillingDetachedSubscriptionCancellationHandler(
      connection,
      () => stripe
    )
    handlers[billingWebhookReconciliationJobType] = createBillingWebhookReconciliationHandler({
      connection,
      client: stripe,
      config
    })
    handlers[billingReconciliationSafetyJobType] = createBillingReconciliationSafetyHandler({
      connection,
      client: stripe,
      config
    })
    handlers[billingTransitionConvergenceJobType] = createBillingTransitionConvergenceHandler({
      connection,
      client: stripe,
      config
    })
    handlers[billingNotificationDeliveryJobType] = createBillingNotificationDeliveryHandler({
      appName: config.public.appName,
      connection,
      sender: getTransactionalEmailSender()
    })
    Object.assign(
      handlers,
      createBillingFamilyLifecycleJobHandlers({
        connection
      }),
      createFamilyInvitationExpirationJobHandlers(connection),
      createFamilyJoinRecoveryJobHandlers({
        connection,
        getStripeClient: () => stripe
      })
    )
  }
  if (filesReady) {
    handlers['files.cleanup-orphans'] = async (payload) => {
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
      beforeClaim:
        filesReady || billingReady
          ? () => {
              const now = new Date()
              if (filesReady && now.getTime() >= nextFileSafetyCheckAt) {
                const state = ensureFileReconciliationSafetyJob(connection, now)
                nextFileSafetyCheckAt = now.getTime() + (state === 'covered-active' ? 1_000 : 60_000)
              }
              if (billingReady && now.getTime() >= nextBillingSafetyCheckAt) {
                ensureBillingAccountDeletionCancellationJobs(connection, now)
                ensureBillingDetachedSubscriptionCancellationJobs(connection, now)
                ensureFamilyInvitationExpirationJob(connection, now)
                ensureFamilyJoinRecoveryJobs(connection, now)
                ensureBillingFamilyLifecycleJobs(connection, now)
                ensureBillingNotificationDeliveryJobs(connection, now)
                ensureBillingReconciliationSafetyJob(connection, now)
                ensureBillingTransitionConvergenceJobs(connection, now)
                ensureBillingWebhookReconciliationJobs(connection, now)
                nextBillingSafetyCheckAt = now.getTime() + 60_000
              }
            }
          : undefined
    })
  } finally {
    process.off('SIGTERM', onSigterm)
    process.off('SIGINT', onSigint)
    if (isModuleReady('observability', config)) {
      try {
        if (!(await Sentry.flush(2_000))) console.error('Worker telemetry flush did not complete during shutdown')
      } catch {
        console.error('Worker telemetry flush did not complete during shutdown')
      }
    }
    if (connection.sqlite.open) connection.sqlite.close()
    console.log('Worker stopped')
  }
}
