import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'
import type { DatabaseConnection } from '../../../db/connect'
import type {
  BillingOfferingKey,
  BillingStripePurchaserState,
  BillingTransitionKind,
  StripeSubscriptionStatus
} from '../../../../shared/billing'
import type { BillingStripeRuntimeConfiguration } from './configuration'

export type BillingStripeConnection = Readonly<{
  sqlite: DatabaseConnection['sqlite']
}>

export type BillingStripeProjectionSnapshot = Readonly<{
  billingSubscriptionId: string | null
  purchaserUserId: string
  status: StripeSubscriptionStatus | 'none' | 'ambiguous'
  offering: BillingOfferingKey | null
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  paymentGraceActive: boolean
  graceStartedAt: string | null
  graceEndsAt: string | null
  reconciliationRequired: boolean
  revision: number
}>

export type BillingStripeStateCommitCause =
  | 'checkout_reconciliation'
  | 'webhook'
  | 'manual_reconciliation'
  | 'reconciliation_safety'
  | 'transition'
  | 'transition_convergence'
  | 'renewal_stop'

export type BillingStripeAuthorizationRequest =
  | Readonly<{
      kind: 'checkout'
      purchaserUserId: string
      offering: BillingOfferingKey
    }>
  | Readonly<{
      kind: 'change'
      purchaserUserId: string
      sourceOffering: BillingOfferingKey
      targetOffering: BillingOfferingKey
    }>
  | Readonly<{
      kind: 'portal'
      purchaserUserId: string
    }>
  | Readonly<{
      kind: 'reconcile'
      purchaserUserId: string
    }>
  | Readonly<{
      kind: 'projection'
      purchaserUserId: string
      source: BillingStripeStateCommitCause
      before: BillingStripeProjectionSnapshot
      after: BillingStripeProjectionSnapshot
    }>

export type BillingStripeAuthorizationResult =
  'authorized' | 'authority_lost' | 'state_changed' | 'reconciliation_required'

export type BillingStripeSynchronizationRequest =
  | Readonly<{
      kind: 'transition_reserved'
      purchaserUserId: string
      billingSubscriptionId: string
      transitionId: string
      transitionKind: BillingTransitionKind
      sourceOffering: BillingOfferingKey
      targetOffering: BillingOfferingKey
      capturedBillingRevision: number
    }>
  | Readonly<{
      kind: 'state_committed'
      purchaserUserId: string
      cause: BillingStripeStateCommitCause
      before: BillingStripeProjectionSnapshot
      after: BillingStripeProjectionSnapshot
      transition: BillingStripeTransitionSnapshot | null
      effects: readonly BillingStripeLifecycleEffect[]
    }>

export type BillingStripeTransitionSnapshot = Readonly<{
  id: string
  kind: BillingTransitionKind
  sourceOffering: BillingOfferingKey
  targetOffering: BillingOfferingKey
  state: 'pending' | 'action_required' | 'scheduled' | 'reconciliation_required' | 'applied' | 'failed' | 'canceled'
  effectiveAt: string | null
}>

export type BillingStripeLifecycleEffect = Readonly<{
  action: 'payment_attention' | 'payment_grace_started' | 'renewal_ending' | 'coverage_ended'
  episodeKey: string
  effectiveAt: string | null
  transitionId: string | null
}>

export type BillingStripeOperation =
  | 'checkout'
  | 'change'
  | 'portal'
  | 'reconcile'
  | 'webhook'
  | 'account_deletion_cancellation'
  | 'detached_subscription_cancellation'
  | 'webhook_reconciliation'
  | 'reconciliation_safety'
  | 'transition_convergence'
  | 'notification_delivery'

export type BillingStripeIntegration<
  TConnection extends BillingStripeConnection = BillingStripeConnection,
  TProjectedState = BillingStripePurchaserState
> = Readonly<{
  authorizePurchaserBilling: (
    connection: TConnection,
    request: BillingStripeAuthorizationRequest
  ) => BillingStripeAuthorizationResult
  synchronizePurchaserBilling: (connection: TConnection, request: BillingStripeSynchronizationRequest) => undefined
  projectPurchaserState?: (
    connection: TConnection,
    purchaserUserId: string,
    state: BillingStripePurchaserState
  ) => TProjectedState
}>

export type BillingStripeComposition<
  TConnection extends BillingStripeConnection = BillingStripeConnection,
  TProjectedState = BillingStripePurchaserState
> = Readonly<{
  connection: () => TConnection
  configuration: () => BillingStripeRuntimeConfiguration
  requireUserId: (event: H3Event) => Promise<string>
  reportFailure: (error: Error, operation: BillingStripeOperation) => void | Promise<void>
  integration?: BillingStripeIntegration<TConnection, TProjectedState>
}>

export function defineBillingStripeComposition<
  TConnection extends BillingStripeConnection,
  TProjectedState = BillingStripePurchaserState
>(
  composition: BillingStripeComposition<TConnection, TProjectedState>
): BillingStripeComposition<TConnection, TProjectedState> {
  return Object.freeze({ ...composition })
}

export function authorizePurchaserBilling<TConnection extends BillingStripeConnection>(
  connection: TConnection,
  integration: BillingStripeIntegration<TConnection, unknown> | undefined,
  request: BillingStripeAuthorizationRequest
): BillingStripeAuthorizationResult {
  const result = integration?.authorizePurchaserBilling(connection, request) ?? 'authorized'
  if (!['authorized', 'authority_lost', 'state_changed', 'reconciliation_required'].includes(result)) {
    throw new TypeError('Billing Stripe authorization callback must return a closed synchronous result')
  }
  return result
}

export function synchronizePurchaserBilling<TConnection extends BillingStripeConnection>(
  connection: TConnection,
  integration: BillingStripeIntegration<TConnection, unknown> | undefined,
  request: BillingStripeSynchronizationRequest
): void {
  const normalized =
    request.kind === 'state_committed'
      ? Object.freeze({
          ...request,
          effects: Object.freeze(request.effects.map(normalizeLifecycleEffect))
        })
      : request
  const result = integration?.synchronizePurchaserBilling(connection, normalized)
  if (result !== undefined) {
    throw new TypeError('Billing Stripe synchronization callback must complete synchronously')
  }
}

function normalizeLifecycleEffect(effect: BillingStripeLifecycleEffect): BillingStripeLifecycleEffect {
  const digest = createHash('sha256')
    .update(JSON.stringify([effect.action, effect.episodeKey, effect.transitionId]))
    .digest('hex')
  return Object.freeze({ ...effect, episodeKey: `billing_episode_${digest}` })
}
