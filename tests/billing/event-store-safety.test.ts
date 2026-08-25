import type Stripe from 'stripe'
import { afterEach, describe, expect, it } from 'vitest'
import { createStripeBillingCatalog } from '../../server/services/payments/stripe/catalog'
import { enqueueBillingDetachedSubscriptionCancellation } from '../../server/services/payments/stripe/detached-subscription-cancellation'
import { applyStripeEventObservation } from '../../server/services/payments/stripe/event-store'
import {
  projectStripeSubscription,
  type CurrentBillingProjection
} from '../../server/services/payments/stripe/projection'
import type {
  BillingStripeIntegration,
  BillingStripeSynchronizationRequest
} from '../../server/services/payments/stripe/public-contract'
import { resolveBillingStripeWebhookLifecycle } from '../../server/services/payments/stripe/webhook-lifecycle'
import type { StripeEventObservation } from '../../server/services/payments/stripe/webhook'
import {
  createBillingStripeRuntimeFixture,
  seedBillingCustomer,
  seedBillingSubscription,
  seedCheckoutAttempt,
  seedDetachedSubject,
  type BillingStripeRuntimeFixture
} from './runtime-fixture'

const prices = {
  'personal.weekly': 'price_personal_weekly',
  'personal.monthly': 'price_personal_monthly',
  'personal.annual': 'price_personal_annual',
  'family.monthly': 'price_family_monthly',
  'family.annual': 'price_family_annual'
} as const
const catalog = createStripeBillingCatalog(prices)
const periodStart = '2026-07-01T00:00:00.000Z'
const periodEnd = '2026-08-01T00:00:00.000Z'
const openFixtures: BillingStripeRuntimeFixture[] = []

afterEach(() => {
  for (const fixture of openFixtures.splice(0)) fixture.sqlite.close()
})

describe('Billing Stripe webhook transaction safety', () => {
  it('completes a correlated Checkout attempt when exact paid subscription evidence arrives first', () => {
    const fixture = runtimeFixture('purchaser_subscription_first')
    const attemptId = seedCheckoutAttempt(fixture, { id: 'attempt_subscription_first' })
    const provider = subscription({
      id: 'sub_subscription_first',
      customer: 'cus_subscription_first',
      metadata: { billing_attempt_id: attemptId },
      latestInvoice: initialInvoice('in_subscription_first', 'cus_subscription_first', 'sub_subscription_first')
    })

    expect(
      applyStripeEventObservation(
        fixture.connection,
        undefined,
        observation({
          eventId: 'evt_subscription_first',
          eventType: 'customer.subscription.created',
          objectId: 'sub_subscription_first',
          attemptId,
          stripeCustomerId: 'cus_subscription_first',
          projection: projection({ stripeSubscriptionId: 'sub_subscription_first' }),
          providerState: { kind: 'subscription', subscription: provider, schedule: null }
        })
      )
    ).toEqual({ duplicate: false, target: 'live' })
    expect(
      fixture.sqlite
        .prepare(
          `select state, billing_customer_id as billingCustomerId
       from billing_checkout_attempts where id = ?`
        )
        .get(attemptId)
    ).toEqual({
      state: 'completed',
      billingCustomerId: expect.stringMatching(/^billing_customer_/)
    })
    expect(
      fixture.sqlite
        .prepare(`select reconciliation_required as reconciliationRequired from billing_subscriptions`)
        .get()
    ).toEqual({ reconciliationRequired: 0 })
  })

  it('keeps subscription-before-Checkout evidence fail-closed until the paid initial invoice is exact', () => {
    const fixture = runtimeFixture('purchaser_subscription_unverified')
    const attemptId = seedCheckoutAttempt(fixture, { id: 'attempt_subscription_unverified' })
    const provider = subscription({
      id: 'sub_subscription_unverified',
      customer: 'cus_subscription_unverified',
      metadata: { billing_attempt_id: attemptId }
    })

    applyStripeEventObservation(
      fixture.connection,
      undefined,
      observation({
        eventId: 'evt_subscription_unverified',
        eventType: 'customer.subscription.created',
        objectId: provider.id,
        attemptId,
        stripeCustomerId: 'cus_subscription_unverified',
        projection: projection({ stripeSubscriptionId: provider.id }),
        providerState: { kind: 'subscription', subscription: provider, schedule: null }
      })
    )
    expect(fixture.sqlite.prepare(`select state from billing_checkout_attempts where id = ?`).get(attemptId)).toEqual({
      state: 'reconciliation_required'
    })
    expect(
      fixture.sqlite
        .prepare(
          `select reconciliation_required as reconciliationRequired,
              reconciliation_reason as reconciliationReason from billing_subscriptions`
        )
        .get()
    ).toEqual({
      reconciliationRequired: 1,
      reconciliationReason: 'checkout_initial_invoice_unverified'
    })
  })

  it.each([
    ['checkout.session.async_payment_failed', 'failed'],
    ['checkout.session.expired', 'expired']
  ] as const)('associates the exact Checkout customer for %s', (eventType, state) => {
    const fixture = runtimeFixture(`purchaser_checkout_${state}`)
    const attemptId = seedCheckoutAttempt(fixture, { id: `attempt_checkout_${state}` })
    const session = checkoutSession(`cs_checkout_${state}`, attemptId, 'cus_checkout_terminal')

    applyStripeEventObservation(
      fixture.connection,
      undefined,
      observation({
        eventId: `evt_checkout_${state}`,
        eventType,
        objectId: session.id,
        attemptId,
        stripeCustomerId: 'cus_checkout_terminal',
        stripeSessionId: session.id,
        checkoutState: state,
        projection: null,
        providerState: {
          kind: 'checkout',
          session,
          subscription: null,
          schedule: null,
          checkoutOffering: 'family.monthly'
        }
      })
    )
    expect(
      fixture.sqlite
        .prepare(`select state, billing_customer_id as billingCustomerId from billing_checkout_attempts where id = ?`)
        .get(attemptId)
    ).toEqual({ state, billingCustomerId: expect.stringMatching(/^billing_customer_/) })
    expect(
      fixture.sqlite.prepare(`select stripe_customer_id as stripeCustomerId from billing_customers`).get()
    ).toEqual({ stripeCustomerId: 'cus_checkout_terminal' })
  })

  it('leaves customer association null when asynchronous Checkout failure has no customer', () => {
    const fixture = runtimeFixture('purchaser_checkout_failed_without_customer')
    const attemptId = seedCheckoutAttempt(fixture, { id: 'attempt_checkout_failed_without_customer' })
    const session = checkoutSession('cs_checkout_failed_without_customer', attemptId, null)

    applyStripeEventObservation(
      fixture.connection,
      undefined,
      observation({
        eventId: 'evt_checkout_failed_without_customer',
        eventType: 'checkout.session.async_payment_failed',
        objectId: session.id,
        attemptId,
        stripeCustomerId: null,
        stripeSessionId: session.id,
        checkoutState: 'failed',
        projection: null,
        providerState: {
          kind: 'checkout',
          session,
          subscription: null,
          schedule: null,
          checkoutOffering: 'family.monthly'
        }
      })
    )
    expect(
      fixture.sqlite
        .prepare(`select state, billing_customer_id as billingCustomerId from billing_checkout_attempts where id = ?`)
        .get(attemptId)
    ).toEqual({ state: 'failed', billingCustomerId: null })
    expect(tableCount(fixture, 'billing_customers')).toBe(0)
  })

  it('marks only the newer Checkout attempt and projection for reconciliation when an old attempt reports late', () => {
    const fixture = runtimeFixture('purchaser_overlapping_attempts')
    const oldAttemptId = seedCheckoutAttempt(fixture, {
      id: 'attempt_old_checkout',
      state: 'failed'
    })
    const newAttemptId = seedCheckoutAttempt(fixture, { id: 'attempt_new_checkout' })
    const provider = subscription({
      id: 'sub_old_checkout',
      customer: 'cus_overlapping_checkout',
      metadata: { billing_attempt_id: oldAttemptId },
      latestInvoice: initialInvoice('in_old_checkout', 'cus_overlapping_checkout', 'sub_old_checkout')
    })

    applyStripeEventObservation(
      fixture.connection,
      undefined,
      observation({
        eventId: 'evt_old_checkout_late',
        eventType: 'customer.subscription.created',
        objectId: provider.id,
        attemptId: oldAttemptId,
        stripeCustomerId: 'cus_overlapping_checkout',
        projection: projection({ stripeSubscriptionId: provider.id }),
        providerState: { kind: 'subscription', subscription: provider, schedule: null }
      })
    )
    expect(fixture.sqlite.prepare(`select id, state from billing_checkout_attempts order by id`).all()).toEqual(
      [
        { id: newAttemptId, state: 'reconciliation_required' },
        { id: oldAttemptId, state: 'failed' }
      ].sort((left, right) => left.id.localeCompare(right.id))
    )
    expect(
      fixture.sqlite
        .prepare(
          `select reconciliation_required as reconciliationRequired,
              reconciliation_reason as reconciliationReason from billing_subscriptions`
        )
        .get()
    ).toEqual({
      reconciliationRequired: 1,
      reconciliationReason: 'overlapping_checkout_attempt'
    })
  })

  it('fails an unattributed new subscription closed when its customer has an open Checkout', () => {
    const fixture = runtimeFixture('purchaser_unattributed_overlap')
    const customerId = seedBillingCustomer(fixture)
    const attemptId = seedCheckoutAttempt(fixture, {
      id: 'attempt_unattributed_overlap',
      customerId
    })

    applyStripeEventObservation(fixture.connection, undefined, observation({ eventId: 'evt_unattributed_overlap' }))
    expect(fixture.sqlite.prepare(`select state from billing_checkout_attempts where id = ?`).get(attemptId)).toEqual({
      state: 'reconciliation_required'
    })
    expect(
      fixture.sqlite.prepare(`select reconciliation_reason as reconciliationReason from billing_subscriptions`).get()
    ).toEqual({ reconciliationReason: 'overlapping_checkout_attempt' })
  })

  it('fails closed without retargeting a known detached subscription to a conflicting customer', () => {
    const fixture = runtimeFixture()
    seedDetachedSubject(fixture, {
      providerReference: 'sub_known',
      customerReference: 'cus_original',
      status: 'active',
      eventCreatedAt: 100
    })

    expect(
      applyStripeEventObservation(
        fixture.connection,
        undefined,
        observation({
          eventId: 'evt_conflicting_customer',
          eventCreatedAt: 101,
          objectId: 'sub_known',
          stripeCustomerId: 'cus_other',
          projection: projection({ stripeSubscriptionId: 'sub_known' }),
          providerState: {
            kind: 'subscription',
            subscription: subscription({ id: 'sub_known', customer: 'cus_other' }),
            schedule: null
          }
        })
      )
    ).toEqual({ duplicate: false, target: 'detached' })

    expect(
      fixture.sqlite
        .prepare(
          `select provider_customer_reference as customer, provider_status as status
       from detached_billing_subjects where provider_reference = 'sub_known'`
        )
        .get()
    ).toEqual({ customer: 'cus_original', status: 'reconciliation_required' })
    expect(jobCount(fixture, 'billing.detached-subscription-cancellation')).toBe(0)
  })

  it('ignores an unknown provider observation without retaining or canceling it', () => {
    const fixture = runtimeFixture()
    const result = applyStripeEventObservation(
      fixture.connection,
      undefined,
      observation({
        eventId: 'evt_unknown_subject',
        objectId: 'sub_unknown',
        stripeCustomerId: 'cus_unknown',
        projection: projection({ stripeSubscriptionId: 'sub_unknown' }),
        providerState: {
          kind: 'subscription',
          subscription: subscription({ id: 'sub_unknown', customer: 'cus_unknown' }),
          schedule: null
        }
      })
    )

    expect(result).toEqual({ duplicate: false, target: 'ignored' })
    expect(tableCount(fixture, 'detached_billing_subjects')).toBe(0)
    expect(jobCount(fixture, 'billing.detached-subscription-cancellation')).toBe(0)
  })

  it('routes a late correlated subscription through a detached attempt and schedules cancellation', () => {
    const fixture = runtimeFixture()
    seedDetachedSubject(fixture, {
      providerReference: 'attempt:billing_attempt_deleted',
      status: 'checkout_deleted',
      eventCreatedAt: 100
    })
    const provider = subscription({
      id: 'sub_late',
      customer: 'cus_late',
      metadata: { billing_attempt_id: 'billing_attempt_deleted' }
    })

    expect(
      applyStripeEventObservation(
        fixture.connection,
        undefined,
        observation({
          eventId: 'evt_late_subscription',
          eventCreatedAt: 101,
          objectId: 'sub_late',
          attemptId: 'billing_attempt_deleted',
          stripeCustomerId: 'cus_late',
          projection: projection({ stripeSubscriptionId: 'sub_late' }),
          providerState: { kind: 'subscription', subscription: provider, schedule: null }
        })
      )
    ).toEqual({ duplicate: false, target: 'detached' })

    expect(
      fixture.sqlite
        .prepare(
          `select provider_customer_reference as customer, provider_status as status
       from detached_billing_subjects where provider_reference = 'sub_late'`
        )
        .get()
    ).toEqual({ customer: 'cus_late', status: 'active' })
    expect(jobCount(fixture, 'billing.detached-subscription-cancellation')).toBe(1)
  })

  it('retains and schedules an exact live subscription discovered through a known customer anchor', () => {
    const fixture = runtimeFixture()
    seedDetachedSubject(fixture, {
      providerReference: 'customer:cus_late_customer',
      customerReference: 'cus_late_customer',
      status: 'verified_no_live_subscriptions',
      eventCreatedAt: 100
    })
    const provider = subscription({ id: 'sub_late_customer', customer: 'cus_late_customer' })

    expect(
      applyStripeEventObservation(
        fixture.connection,
        undefined,
        observation({
          eventId: 'evt_late_customer_subscription',
          eventCreatedAt: 101,
          objectId: 'sub_late_customer',
          stripeCustomerId: 'cus_late_customer',
          projection: projection({ stripeSubscriptionId: 'sub_late_customer' }),
          providerState: { kind: 'subscription', subscription: provider, schedule: null }
        })
      )
    ).toEqual({ duplicate: false, target: 'detached' })

    expect(
      fixture.sqlite
        .prepare(
          `select provider_customer_reference as customer, provider_status as status
       from detached_billing_subjects where provider_reference = 'sub_late_customer'`
        )
        .get()
    ).toEqual({ customer: 'cus_late_customer', status: 'active' })
    expect(jobCount(fixture, 'billing.detached-subscription-cancellation')).toBe(1)
  })

  it('does not let an attempt-correlated customer conflict bypass detached cancellation safety', () => {
    const fixture = runtimeFixture()
    seedDetachedSubject(fixture, {
      providerReference: 'attempt:billing_attempt_conflict',
      customerReference: 'cus_original',
      status: 'checkout_deleted',
      eventCreatedAt: 100
    })
    seedDetachedSubject(fixture, {
      providerReference: 'sub_conflict',
      customerReference: 'cus_original',
      status: 'active',
      eventCreatedAt: 100
    })
    const provider = subscription({
      id: 'sub_conflict',
      customer: 'cus_other',
      metadata: { billing_attempt_id: 'billing_attempt_conflict' }
    })

    applyStripeEventObservation(
      fixture.connection,
      undefined,
      observation({
        eventId: 'evt_attempt_customer_conflict',
        eventCreatedAt: 101,
        objectId: 'sub_conflict',
        attemptId: 'billing_attempt_conflict',
        stripeCustomerId: 'cus_other',
        projection: projection({ stripeSubscriptionId: 'sub_conflict' }),
        providerState: { kind: 'subscription', subscription: provider, schedule: null }
      })
    )

    expect(
      fixture.sqlite
        .prepare(
          `select provider_customer_reference as customer, provider_status as status
       from detached_billing_subjects where provider_reference = 'sub_conflict'`
        )
        .get()
    ).toEqual({ customer: 'cus_original', status: 'reconciliation_required' })
    expect(jobCount(fixture, 'billing.detached-subscription-cancellation')).toBe(0)
  })

  it('updates only the direct detached subscription and leaves same-customer siblings covered', () => {
    const fixture = runtimeFixture()
    const firstId = seedDetachedSubject(fixture, {
      providerReference: 'sub_sibling_a',
      customerReference: 'cus_siblings',
      status: 'active',
      eventCreatedAt: 100
    })
    const secondId = seedDetachedSubject(fixture, {
      providerReference: 'sub_sibling_b',
      customerReference: 'cus_siblings',
      status: 'active',
      eventCreatedAt: 100
    })
    expect(enqueueBillingDetachedSubscriptionCancellation(fixture.connection, secondId)).toBe(true)

    applyStripeEventObservation(
      fixture.connection,
      undefined,
      observation({
        eventId: 'evt_sibling_a_canceled',
        eventCreatedAt: 101,
        objectId: 'sub_sibling_a',
        stripeCustomerId: 'cus_siblings',
        projection: projection({
          stripeSubscriptionId: 'sub_sibling_a',
          status: 'canceled',
          planKey: null,
          cadence: null,
          stripePriceId: null,
          currentPeriodStart: null,
          currentPeriodEnd: null
        }),
        providerState: {
          kind: 'subscription',
          subscription: subscription({ id: 'sub_sibling_a', customer: 'cus_siblings', status: 'canceled' }),
          schedule: null
        }
      })
    )

    expect(
      fixture.sqlite
        .prepare(
          `select provider_reference as providerReference, provider_status as status
       from detached_billing_subjects where id in (?, ?) order by provider_reference`
        )
        .all(firstId, secondId)
    ).toEqual([
      { providerReference: 'sub_sibling_a', status: 'canceled' },
      { providerReference: 'sub_sibling_b', status: 'active' }
    ])
    expect(jobCount(fixture, 'billing.detached-subscription-cancellation')).toBe(1)
  })

  it('requires an exact transition invoice customer before applying an immediate transition', () => {
    const fixture = seededLiveFixture('invoice', 'personal', 'monthly')
    seedTransition(fixture, {
      kind: 'personal_to_family',
      sourcePlan: 'personal',
      sourceCadence: 'monthly',
      targetPlan: 'family',
      targetCadence: 'monthly',
      pendingInvoiceId: 'in_transition'
    })
    const provider = subscription({
      priceId: prices['family.monthly'],
      latestInvoice: transitionInvoice('in_transition', 'cus_other', 'paid')
    })

    const lifecycle = resolveBillingStripeWebhookLifecycle(
      fixture.connection,
      fixture.purchaserUserId,
      observation({
        eventId: 'evt_transition_invoice',
        objectId: 'sub_test',
        stripeCustomerId: 'cus_test',
        projection: projection({ planKey: 'family', stripePriceId: prices['family.monthly'] }),
        providerState: { kind: 'subscription', subscription: provider, schedule: null }
      })
    )

    expect(lifecycle.projection).toMatchObject({
      reconciliationRequired: true,
      reconciliationReason: 'applied_transition_evidence_mismatch'
    })
    expect(lifecycle.transition).toMatchObject({ state: 'reconciliation_required' })
  })

  it('requires an exact transition schedule customer before accepting scheduled evidence', () => {
    const fixture = seededLiveFixture('schedule', 'family', 'monthly')
    seedTransition(fixture, {
      kind: 'cadence_change',
      sourcePlan: 'family',
      sourceCadence: 'monthly',
      targetPlan: 'family',
      targetCadence: 'annual',
      scheduleId: 'sched_transition'
    })
    const schedule = exactSchedule('cus_other')
    const provider = subscription({ schedule: 'sched_transition' })
    const lifecycle = resolveBillingStripeWebhookLifecycle(
      fixture.connection,
      fixture.purchaserUserId,
      observation({
        eventId: 'evt_transition_schedule',
        objectId: 'sub_test',
        stripeCustomerId: 'cus_test',
        projection: projection(),
        providerState: { kind: 'subscription', subscription: provider, schedule }
      })
    )

    expect(lifecycle.projection).toMatchObject({
      reconciliationRequired: true,
      reconciliationReason: 'transition_schedule_reference_conflict'
    })
    expect(lifecycle.transition).toMatchObject({ state: 'reconciliation_required' })
  })

  it('includes the governing unchanged transition in the state-commit callback', () => {
    const fixture = seededLiveFixture('unchanged', 'family', 'monthly')
    seedTransition(fixture, {
      kind: 'cadence_change',
      sourcePlan: 'family',
      sourceCadence: 'monthly',
      targetPlan: 'family',
      targetCadence: 'annual',
      scheduleId: 'sched_transition',
      state: 'scheduled'
    })
    const requests: BillingStripeSynchronizationRequest[] = []

    const result = applyStripeEventObservation(
      fixture.connection,
      integration(requests),
      observation({
        eventId: 'evt_unchanged_transition',
        objectId: 'sub_test',
        stripeCustomerId: 'cus_test',
        projection: projection(),
        providerState: {
          kind: 'subscription',
          subscription: subscription({ schedule: 'sched_transition' }),
          schedule: exactSchedule('cus_test')
        }
      })
    )

    expect(result).toEqual({ duplicate: false, target: 'live' })
    const committed = requests.findLast((request) => request.kind === 'state_committed')
    expect(committed).toMatchObject({
      transition: {
        id: 'billing_transition_test',
        kind: 'cadence_change',
        sourceOffering: 'family.monthly',
        targetOffering: 'family.annual',
        state: 'scheduled'
      }
    })
  })

  it('receipts a known live purchaser as live and fail-closed when app projection authority is lost', () => {
    const fixture = seededLiveFixture('app_authority', 'family', 'monthly')
    const requests: BillingStripeSynchronizationRequest[] = []

    expect(
      applyStripeEventObservation(
        fixture.connection,
        integration(requests, 'authority_lost'),
        observation({ eventId: 'evt_app_authority_lost' })
      )
    ).toEqual({ duplicate: false, target: 'live' })
    expect(
      fixture.sqlite
        .prepare(
          `select reconciliation_required as reconciliationRequired,
              reconciliation_reason as reconciliationReason from billing_subscriptions`
        )
        .get()
    ).toEqual({
      reconciliationRequired: 1,
      reconciliationReason: 'integration_authority_conflict'
    })
    expect(fixture.sqlite.prepare(`select stripe_event_id as eventId from billing_events`).get()).toEqual({
      eventId: 'evt_app_authority_lost'
    })
    const commit = requests.findLast((request) => request.kind === 'state_committed')
    expect(commit).toMatchObject({ effects: [], after: { reconciliationRequired: true } })
  })

  it('inserts an observed subscription for an exact known customer and receipts it live on app authority loss', () => {
    const fixture = runtimeFixture('purchaser_webhook_new_subscription')
    seedBillingCustomer(fixture)
    const requests: BillingStripeSynchronizationRequest[] = []

    expect(
      applyStripeEventObservation(
        fixture.connection,
        integration(requests, 'authority_lost'),
        observation({ eventId: 'evt_new_subscription_authority_lost' })
      )
    ).toEqual({ duplicate: false, target: 'live' })
    expect(
      fixture.sqlite
        .prepare(
          `select stripe_subscription_id as stripeSubscriptionId,
              reconciliation_required as reconciliationRequired,
              reconciliation_reason as reconciliationReason from billing_subscriptions`
        )
        .get()
    ).toEqual({
      stripeSubscriptionId: 'sub_test',
      reconciliationRequired: 1,
      reconciliationReason: 'integration_authority_conflict'
    })
    expect(tableCount(fixture, 'billing_events')).toBe(1)
    expect(tableCount(fixture, 'detached_billing_subjects')).toBe(0)
    expect(jobCount(fixture, 'billing.notification-delivery')).toBe(0)
    expect(requests.findLast((request) => request.kind === 'state_committed')).toMatchObject({
      effects: [],
      after: { reconciliationRequired: true }
    })
  })

  it('applies exact older payment-failure evidence without moving projection ordering backward', () => {
    const fixture = seededLiveFixture('older_failure', 'family', 'monthly', {
      status: 'past_due',
      projectionOrderMs: 200_000,
      projectionEventId: 'evt_newer_projection'
    })
    const requests: BillingStripeSynchronizationRequest[] = []
    const provider = subscription({ status: 'past_due' })
    const invoice = renewalInvoice('in_exact_failure', 'cus_test', 'open')

    applyStripeEventObservation(
      fixture.connection,
      integration(requests),
      observation({
        eventId: 'evt_older_failure',
        eventType: 'invoice.payment_failed',
        eventCreatedAt: 100,
        objectId: invoice.id,
        stripeCustomerId: 'cus_test',
        projection: projection({ status: 'past_due' }),
        providerState: { kind: 'invoice', invoice, subscription: provider, schedule: null }
      })
    )

    expect(
      fixture.sqlite
        .prepare(
          `select grace_invoice_id as graceInvoiceId, projection_order_ms as projectionOrderMs,
              projection_event_id as projectionEventId from billing_subscriptions`
        )
        .get()
    ).toEqual({
      graceInvoiceId: 'in_exact_failure',
      projectionOrderMs: 200_000,
      projectionEventId: 'evt_newer_projection'
    })
    expect(JSON.stringify(requests)).not.toContain('in_exact_failure')
  })

  it('does not let an older authenticated failure replace a materially newer subscription projection', () => {
    const fixture = seededLiveFixture('older_failure_conflict', 'family', 'monthly', {
      status: 'past_due',
      cancelAtPeriodEnd: true,
      projectionOrderMs: 200_000,
      projectionEventId: 'evt_newer_material_projection'
    })
    const provider = subscription({ status: 'past_due' })
    const invoice = renewalInvoice('in_older_material_failure', 'cus_test', 'open')

    applyStripeEventObservation(
      fixture.connection,
      undefined,
      observation({
        eventId: 'evt_older_material_failure',
        eventType: 'invoice.payment_failed',
        eventCreatedAt: 100,
        objectId: invoice.id,
        stripeCustomerId: 'cus_test',
        projection: projection({ status: 'past_due', cancelAtPeriodEnd: false }),
        providerState: { kind: 'invoice', invoice, subscription: provider, schedule: null }
      })
    )

    expect(billingRow(fixture)).toMatchObject({
      status: 'past_due',
      cancelAtPeriodEnd: 1,
      graceInvoiceId: null,
      graceStartedAt: null,
      graceEndsAt: null,
      projectionOrderMs: 200_000,
      projectionEventId: 'evt_newer_material_projection',
      reconciliationRequired: 1,
      reconciliationReason: 'older_event_current_state_conflict'
    })
  })

  it('does not let an unrelated paid invoice clear the authenticated grace episode', () => {
    const fixture = seededLiveFixture('paid_conflict', 'family', 'monthly', {
      status: 'past_due',
      graceInvoiceId: 'in_original_failure',
      graceStartedAt: '2026-07-01T00:00:00.000Z',
      graceEndsAt: '2026-07-15T00:00:00.000Z'
    })
    const provider = subscription({ status: 'active', latestInvoice: null })
    const invoice = renewalInvoice('in_unrelated_paid', 'cus_test', 'paid')

    applyStripeEventObservation(
      fixture.connection,
      undefined,
      observation({
        eventId: 'evt_unrelated_paid',
        eventType: 'invoice.paid',
        objectId: invoice.id,
        stripeCustomerId: 'cus_test',
        projection: projection(),
        providerState: { kind: 'invoice', invoice, subscription: provider, schedule: null }
      })
    )

    expect(
      fixture.sqlite
        .prepare(
          `select grace_invoice_id as graceInvoiceId, reconciliation_required as reconciliationRequired,
              reconciliation_reason as reconciliationReason from billing_subscriptions`
        )
        .get()
    ).toEqual({
      graceInvoiceId: 'in_original_failure',
      reconciliationRequired: 1,
      reconciliationReason: 'paid_recovery_invoice_conflict'
    })
  })

  it('commits the minimized receipt last and rolls all state back when synchronization fails', () => {
    const fixture = seededLiveFixture('receipt_last', 'family', 'monthly')
    const integration: BillingStripeIntegration = {
      authorizePurchaserBilling: () => 'authorized',
      synchronizePurchaserBilling() {
        throw new Error('app synchronization failed')
      }
    }

    expect(() =>
      applyStripeEventObservation(
        fixture.connection,
        integration,
        observation({
          eventId: 'evt_receipt_last',
          projection: projection({ cancelAtPeriodEnd: true }),
          providerState: {
            kind: 'subscription',
            subscription: { ...subscription(), cancel_at_period_end: true } as Stripe.Subscription,
            schedule: null
          }
        })
      )
    ).toThrow('app synchronization failed')
    expect(billingRow(fixture)).toMatchObject({
      cancelAtPeriodEnd: 0,
      revision: 0,
      reconciliationRequired: 0
    })
    expect(tableCount(fixture, 'billing_events')).toBe(0)
  })

  it.each([
    [199, 'older_event_current_state_conflict'],
    [200, 'equal_event_order_conflict']
  ] as const)('fails closed for a conflicting provider state at event order %s', (eventCreatedAt, reason) => {
    const fixture = seededLiveFixture(`order_${eventCreatedAt}`, 'family', 'monthly', {
      projectionOrderMs: 200_000,
      projectionEventId: 'evt_order_seed'
    })
    const observed = subscription({ priceId: prices['personal.monthly'] })

    applyStripeEventObservation(
      fixture.connection,
      undefined,
      observation({
        eventId: `evt_order_${eventCreatedAt}`,
        eventCreatedAt,
        projection: projection({
          planKey: 'personal',
          cadence: 'monthly',
          stripePriceId: prices['personal.monthly']
        }),
        providerState: { kind: 'subscription', subscription: observed, schedule: null }
      })
    )

    expect(billingRow(fixture)).toMatchObject({
      planKey: 'family',
      projectionOrderMs: 200_000,
      projectionEventId: 'evt_order_seed',
      reconciliationRequired: 1,
      reconciliationReason: reason
    })
  })

  it('treats older and equal observations of the same provider state as corroborating receipts', () => {
    const fixture = seededLiveFixture('order_corroboration', 'family', 'monthly', {
      projectionOrderMs: 200_000,
      projectionEventId: 'evt_order_seed'
    })
    const provider = subscription()
    for (const [eventId, eventCreatedAt] of [
      ['evt_order_old', 199],
      ['evt_order_equal', 200]
    ] as const) {
      applyStripeEventObservation(
        fixture.connection,
        undefined,
        observation({
          eventId,
          eventCreatedAt,
          projection: projectStripeSubscription(provider, 'cus_test', catalog),
          providerState: { kind: 'subscription', subscription: provider, schedule: null }
        })
      )
    }
    expect(billingRow(fixture)).toMatchObject({
      planKey: 'family',
      projectionOrderMs: 200_000,
      projectionEventId: 'evt_order_seed',
      reconciliationRequired: 0,
      reconciliationReason: null
    })
    expect(tableCount(fixture, 'billing_events')).toBe(2)
  })

  it('updates detached continuity monotonically and flags an equal-time conflict', () => {
    const fixture = runtimeFixture('purchaser_detached_monotonic')
    const subjectId = seedDetachedSubject(fixture, {
      providerReference: 'sub_detached_monotonic',
      customerReference: 'cus_detached_monotonic',
      status: 'active',
      eventCreatedAt: 300
    })
    const terminal = subscription({
      id: 'sub_detached_monotonic',
      customer: 'cus_detached_monotonic',
      status: 'canceled'
    })
    const terminalProjection = projection({
      stripeSubscriptionId: terminal.id,
      status: 'canceled'
    })

    for (const [eventId, eventCreatedAt] of [
      ['evt_detached_old', 299],
      ['evt_detached_equal', 300]
    ] as const) {
      expect(
        applyStripeEventObservation(
          fixture.connection,
          undefined,
          observation({
            eventId,
            eventCreatedAt,
            objectId: terminal.id,
            stripeCustomerId: 'cus_detached_monotonic',
            projection: terminalProjection,
            providerState: { kind: 'subscription', subscription: terminal, schedule: null }
          })
        )
      ).toEqual({ duplicate: false, target: 'detached' })
    }
    expect(
      fixture.sqlite
        .prepare(
          `select provider_status as status, provider_status_expires_at as expiresAt,
              provider_event_created_at as eventCreatedAt
       from detached_billing_subjects where id = ?`
        )
        .get(subjectId)
    ).toEqual({
      status: 'reconciliation_required',
      expiresAt: null,
      eventCreatedAt: 300
    })
  })

  it.each(['refund.created', 'charge.dispute.created'] as const)(
    'uses exact current state for %s without suspending a still-active subscription',
    (eventType) => {
      const fixture = seededLiveFixture(`risk_${eventType}`, 'family', 'monthly')
      const provider = subscription()
      applyStripeEventObservation(
        fixture.connection,
        undefined,
        observation({
          eventId: `evt_${eventType}`,
          eventType,
          objectId: eventType === 'refund.created' ? 're_risk' : 'dp_risk',
          providerState: {
            kind: 'financial_risk',
            risk: eventType === 'refund.created' ? 'refund' : 'dispute',
            providerObjectId: eventType === 'refund.created' ? 're_risk' : 'dp_risk',
            chargeId: 'ch_risk',
            paymentIntentId: 'pi_risk',
            invoice: null,
            subscription: provider,
            schedule: null
          }
        })
      )
      expect(billingRow(fixture)).toMatchObject({ status: 'active', reconciliationRequired: 0 })
    }
  )

  it('anchors the earliest exact renewal failure and clears only on the same paid invoice', () => {
    const fixture = seededLiveFixture('grace_episode', 'family', 'monthly', {
      projectionOrderMs: 900_000,
      projectionEventId: 'evt_grace_seed'
    })
    const invoiceId = 'in_grace_episode'
    const failedInvoice = renewalInvoice(invoiceId, 'cus_test', 'open')
    const pastDue = subscription({ status: 'past_due', latestInvoice: failedInvoice })

    for (const eventCreatedAt of [902, 901, 903]) {
      applyStripeEventObservation(
        fixture.connection,
        undefined,
        observation({
          eventId: `evt_grace_failure_${eventCreatedAt}`,
          eventType: 'invoice.payment_failed',
          eventCreatedAt,
          objectId: invoiceId,
          projection: projection({ status: 'past_due' }),
          providerState: { kind: 'invoice', invoice: failedInvoice, subscription: pastDue, schedule: null }
        })
      )
    }
    expect(billingRow(fixture)).toMatchObject({
      status: 'past_due',
      graceInvoiceId: invoiceId,
      graceStartedAt: new Date(901_000).toISOString(),
      graceEndsAt: new Date(901_000 + 14 * 24 * 60 * 60 * 1_000).toISOString()
    })

    const paidInvoice = renewalInvoice(invoiceId, 'cus_test', 'paid')
    const active = subscription({ latestInvoice: paidInvoice })
    applyStripeEventObservation(
      fixture.connection,
      undefined,
      observation({
        eventId: 'evt_grace_paid',
        eventType: 'invoice.paid',
        eventCreatedAt: 904,
        objectId: invoiceId,
        providerState: { kind: 'invoice', invoice: paidInvoice, subscription: active, schedule: null }
      })
    )
    expect(billingRow(fixture)).toMatchObject({
      status: 'active',
      graceInvoiceId: null,
      graceStartedAt: null,
      graceEndsAt: null,
      reconciliationRequired: 0
    })
  })

  it('does not start grace from payment-action-required before an authenticated failure', () => {
    const fixture = seededLiveFixture('payment_action', 'family', 'monthly')
    const invoice = renewalInvoice('in_payment_action', 'cus_test', 'open')
    const provider = subscription({ status: 'past_due', latestInvoice: invoice })
    const requests: BillingStripeSynchronizationRequest[] = []
    applyStripeEventObservation(
      fixture.connection,
      integration(requests),
      observation({
        eventId: 'evt_payment_action',
        eventType: 'invoice.payment_action_required',
        objectId: invoice.id,
        projection: projection({ status: 'past_due' }),
        providerState: { kind: 'invoice', invoice, subscription: provider, schedule: null }
      })
    )
    expect(billingRow(fixture)).toMatchObject({
      status: 'past_due',
      graceInvoiceId: null,
      graceStartedAt: null,
      graceEndsAt: null,
      reconciliationRequired: 0
    })
    expect(requests).toEqual([
      expect.objectContaining({
        effects: [expect.objectContaining({ action: 'payment_attention' })]
      })
    ])
  })
})

function runtimeFixture(purchaserUserId?: string) {
  const fixture = createBillingStripeRuntimeFixture(purchaserUserId)
  openFixtures.push(fixture)
  return fixture
}

function seededLiveFixture(
  suffix: string,
  plan: 'personal' | 'family',
  cadence: 'weekly' | 'monthly' | 'annual',
  subscriptionInput: Parameters<typeof seedBillingSubscription>[1] = {}
) {
  const fixture = runtimeFixture(`purchaser_webhook_${suffix}`)
  seedBillingCustomer(fixture)
  seedBillingSubscription(fixture, {
    planKey: plan,
    cadence,
    stripePriceId: prices[`${plan}.${cadence}` as keyof typeof prices],
    ...subscriptionInput
  })
  return fixture
}

function seedTransition(
  fixture: BillingStripeRuntimeFixture,
  input: Readonly<{
    kind: string
    sourcePlan: string
    sourceCadence: string
    targetPlan: string
    targetCadence: string
    pendingInvoiceId?: string | null
    scheduleId?: string | null
    state?: string
  }>
): void {
  fixture.sqlite
    .prepare(
      `insert into billing_subscription_transitions (
       id, purchaser_user_id, billing_subscription_id, kind, source_plan_key, source_cadence,
       target_plan_key, target_cadence, effective_at, stripe_subscription_schedule_id,
       stripe_pending_invoice_id, stripe_pending_update_expires_at, idempotency_key,
       captured_billing_revision, state, state_reason, revision
     ) values ('billing_transition_test', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null,
               'billing_transition_idempotency', 0, ?, null, 0)`
    )
    .run(
      fixture.purchaserUserId,
      `billing_subscription_${fixture.purchaserUserId}`,
      input.kind,
      input.sourcePlan,
      input.sourceCadence,
      input.targetPlan,
      input.targetCadence,
      input.kind === 'personal_to_family' ? null : periodEnd,
      input.scheduleId ?? null,
      input.pendingInvoiceId ?? null,
      input.state ?? 'pending'
    )
}

function integration(
  requests: BillingStripeSynchronizationRequest[],
  authorization: 'authorized' | 'authority_lost' = 'authorized'
): BillingStripeIntegration {
  return {
    authorizePurchaserBilling() {
      return authorization
    },
    synchronizePurchaserBilling(_connection, request) {
      requests.push(request)
      return undefined
    }
  }
}

function observation(overrides: Partial<StripeEventObservation> = {}): StripeEventObservation {
  return {
    eventId: 'evt_test',
    eventType: 'customer.subscription.updated',
    eventCreatedAt: 200,
    objectId: 'sub_test',
    catalog,
    attemptId: null,
    stripeCustomerId: 'cus_test',
    stripeSessionId: null,
    checkoutState: null,
    projection: projection(),
    reconciliationReason: null,
    providerState: { kind: 'subscription', subscription: subscription(), schedule: null },
    ...overrides
  }
}

function projection(overrides: Partial<CurrentBillingProjection> = {}): CurrentBillingProjection {
  return {
    stripeSubscriptionId: 'sub_test',
    stripeSubscriptionItemId: 'si_test',
    status: 'active' as const,
    planKey: 'family' as const,
    cadence: 'monthly' as const,
    stripePriceId: prices['family.monthly'],
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: false,
    reconciliationRequired: false,
    reconciliationReason: null,
    ...overrides
  }
}

function subscription(
  input: Readonly<{
    id?: string
    customer?: string
    status?: Stripe.Subscription.Status
    priceId?: string
    schedule?: string | null
    latestInvoice?: Stripe.Invoice | null
    metadata?: Stripe.Metadata
  }> = {}
): Stripe.Subscription {
  return {
    id: input.id ?? 'sub_test',
    object: 'subscription',
    customer: input.customer ?? 'cus_test',
    status: input.status ?? 'active',
    collection_method: 'charge_automatically',
    cancel_at: null,
    cancel_at_period_end: false,
    pause_collection: null,
    trial_end: null,
    discounts: [],
    billing_schedules: [],
    schedule: input.schedule ?? null,
    pending_update: null,
    latest_invoice: input.latestInvoice ?? null,
    metadata: input.metadata ?? {},
    items: {
      object: 'list',
      data: [
        {
          id: 'si_test',
          object: 'subscription_item',
          current_period_start: timestamp(periodStart),
          current_period_end: timestamp(periodEnd),
          quantity: 1,
          price: { id: input.priceId ?? prices['family.monthly'], object: 'price' },
          discounts: []
        } as Stripe.SubscriptionItem
      ],
      has_more: false,
      url: '/v1/subscription_items?subscription=sub_test'
    }
  } as Stripe.Subscription
}

function transitionInvoice(id: string, customer: string, status: 'open' | 'paid' | 'void'): Stripe.Invoice {
  return {
    ...invoiceBase(id, customer, status),
    billing_reason: 'subscription_update'
  } as Stripe.Invoice
}

function initialInvoice(id: string, customer: string, subscriptionId: string): Stripe.Invoice {
  return {
    ...invoiceBase(id, customer, 'paid', subscriptionId),
    billing_reason: 'subscription_create'
  } as Stripe.Invoice
}

function renewalInvoice(id: string, customer: string, status: 'open' | 'paid'): Stripe.Invoice {
  return {
    ...invoiceBase(id, customer, status),
    billing_reason: 'subscription_cycle'
  } as Stripe.Invoice
}

function invoiceBase(id: string, customer: string, status: 'open' | 'paid' | 'void', subscriptionId = 'sub_test') {
  return {
    id,
    object: 'invoice',
    customer,
    status,
    collection_method: 'charge_automatically',
    attempted: true,
    attempt_count: 1,
    amount_remaining: status === 'open' ? 1_000 : 0,
    parent: {
      type: 'subscription_details',
      quote_details: null,
      subscription_details: { metadata: null, subscription: subscriptionId }
    }
  }
}

function checkoutSession(id: string, attemptId: string, customer: string | null): Stripe.Checkout.Session {
  return {
    id,
    object: 'checkout.session',
    mode: 'subscription',
    status: id.includes('expired') ? 'expired' : 'complete',
    payment_status: 'unpaid',
    client_reference_id: attemptId,
    customer,
    subscription: null,
    metadata: { billing_attempt_id: attemptId }
  } as Stripe.Checkout.Session
}

function exactSchedule(customer: string): Stripe.SubscriptionSchedule {
  const start = timestamp(periodStart)
  const end = timestamp(periodEnd)
  return {
    id: 'sched_transition',
    object: 'subscription_schedule',
    customer,
    subscription: 'sub_test',
    released_subscription: null,
    status: 'active',
    end_behavior: 'release',
    phases: [
      schedulePhase(start, end, prices['family.monthly']),
      schedulePhase(end, end + 31_536_000, prices['family.annual'])
    ]
  } as Stripe.SubscriptionSchedule
}

function schedulePhase(start: number, end: number, priceId: string): Stripe.SubscriptionSchedule.Phase {
  return {
    start_date: start,
    end_date: end,
    items: [{ price: priceId, quantity: 1, discounts: [] }],
    add_invoice_items: [],
    discounts: [],
    trial_end: null,
    proration_behavior: 'none'
  } as Stripe.SubscriptionSchedule.Phase
}

function timestamp(iso: string): number {
  return Date.parse(iso) / 1_000
}

function tableCount(fixture: BillingStripeRuntimeFixture, table: string): number {
  return (fixture.sqlite.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count
}

function jobCount(fixture: BillingStripeRuntimeFixture, type: string): number {
  return (
    fixture.sqlite.prepare('select count(*) as count from job_queue where type = ?').get(type) as {
      count: number
    }
  ).count
}

function billingRow(fixture: BillingStripeRuntimeFixture): Record<string, unknown> {
  return fixture.sqlite
    .prepare(
      `select status, plan_key as planKey, cadence, stripe_price_id as stripePriceId,
            cancel_at_period_end as cancelAtPeriodEnd,
            grace_invoice_id as graceInvoiceId, grace_started_at as graceStartedAt,
            grace_ends_at as graceEndsAt, projection_order_ms as projectionOrderMs,
            projection_event_id as projectionEventId,
            reconciliation_required as reconciliationRequired,
            reconciliation_reason as reconciliationReason, revision
     from billing_subscriptions where purchaser_user_id = ?`
    )
    .get(fixture.purchaserUserId) as Record<string, unknown>
}
