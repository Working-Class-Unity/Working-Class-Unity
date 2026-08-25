import type { JobHandler } from '../../jobs/job-queue'
import type { TransactionalEmailSender } from '../../email'
import { billingAccountDeletionCancellationJobType } from './account-deletion'
import { createBillingAccountDeletionCancellationJobHandlerWithClient } from './account-deletion-job'
import { ensureBillingAccountDeletionCancellationJobs } from './account-deletion-store'
import type { BillingStripeRuntimeConfiguration } from './configuration'
import {
  billingDetachedSubscriptionCancellationJobType,
  createBillingDetachedSubscriptionCancellationHandler,
  ensureBillingDetachedSubscriptionCancellationJobs
} from './detached-subscription-cancellation'
import {
  billingNotificationDeliveryJobType,
  createBillingNotificationDeliveryHandler,
  ensureBillingNotificationDeliveryJobs
} from './notification-delivery'
import type { BillingStripeConnection, BillingStripeIntegration } from './public-contract'
import {
  billingReconciliationSafetyJobType,
  createBillingReconciliationSafetyHandler,
  ensureBillingReconciliationSafetyJob
} from './reconciliation-safety'
import { createStripeClient } from './stripe-client'
import {
  billingTransitionConvergenceJobType,
  createBillingTransitionConvergenceHandler,
  ensureBillingTransitionConvergenceJobs
} from './transition-convergence'
import { createBillingWebhookReconciliationHandler } from './webhook-reconciliation'
import { billingWebhookReconciliationJobType, ensureBillingWebhookReconciliationJobs } from './webhook-reference'

export const billingStripeJobTypes = Object.freeze([
  billingAccountDeletionCancellationJobType,
  billingDetachedSubscriptionCancellationJobType,
  billingWebhookReconciliationJobType,
  billingReconciliationSafetyJobType,
  billingTransitionConvergenceJobType,
  billingNotificationDeliveryJobType
] as const)

export type BillingStripeJobType = (typeof billingStripeJobTypes)[number]
export type BillingStripeJobHandlers = Readonly<Record<BillingStripeJobType, JobHandler>>

export type BillingStripeJobContext = Readonly<{
  connection: BillingStripeConnection
  configuration: BillingStripeRuntimeConfiguration
  sender: TransactionalEmailSender
  integration?: BillingStripeIntegration<BillingStripeConnection, unknown>
  now?: () => Date
}>

export function createBillingStripeJobHandlers(context: BillingStripeJobContext): BillingStripeJobHandlers {
  const client = createStripeClient(context.configuration.stripe.secretKey)
  return Object.freeze({
    [billingAccountDeletionCancellationJobType]: createBillingAccountDeletionCancellationJobHandlerWithClient(
      context.connection,
      () => client,
      context.configuration
    ),
    [billingDetachedSubscriptionCancellationJobType]: createBillingDetachedSubscriptionCancellationHandler(
      context.connection,
      () => client,
      context.now
    ),
    [billingWebhookReconciliationJobType]: createBillingWebhookReconciliationHandler({
      connection: context.connection,
      client,
      config: context.configuration,
      integration: context.integration
    }),
    [billingReconciliationSafetyJobType]: createBillingReconciliationSafetyHandler({
      connection: context.connection,
      client,
      config: context.configuration,
      integration: context.integration,
      now: context.now
    }),
    [billingTransitionConvergenceJobType]: createBillingTransitionConvergenceHandler({
      connection: context.connection,
      client,
      config: context.configuration,
      integration: context.integration,
      now: context.now
    }),
    [billingNotificationDeliveryJobType]: createBillingNotificationDeliveryHandler({
      appName: context.configuration.appName,
      connection: context.connection,
      sender: context.sender
    })
  })
}

export type EnsureBillingStripeJobsResult = Readonly<{
  accountDeletionCancellation: number
  detachedSubscriptionCancellation: number
  webhookReconciliation: number
  reconciliationSafety: 'idle' | 'scheduled' | 'covered-active' | 'covered-future'
  transitionConvergence: number
  notificationDelivery: number
}>

export function ensureBillingStripeJobs(
  connection: BillingStripeConnection,
  now = new Date()
): EnsureBillingStripeJobsResult {
  return Object.freeze({
    accountDeletionCancellation: ensureBillingAccountDeletionCancellationJobs(connection, now),
    detachedSubscriptionCancellation: ensureBillingDetachedSubscriptionCancellationJobs(connection, now),
    webhookReconciliation: ensureBillingWebhookReconciliationJobs(connection, now),
    reconciliationSafety: ensureBillingReconciliationSafetyJob(connection, now),
    transitionConvergence: ensureBillingTransitionConvergenceJobs(connection, now),
    notificationDelivery: ensureBillingNotificationDeliveryJobs(connection, now)
  })
}
