import type Stripe from 'stripe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BillingStripeRuntimeConfiguration } from '../../server/services/payments/stripe/configuration'
import type { BillingStripeIntegration } from '../../server/services/payments/stripe/public-contract'
import {
  billingTransitionConvergenceJobType,
  billingTransitionConvergenceMaxAttempts,
  billingTransitionPendingRecoveryDelayMs,
  createBillingTransitionConvergenceHandler,
  ensureBillingTransitionConvergenceJobs
} from '../../server/services/payments/stripe/transition-convergence'
import {
  createBillingStripeRuntimeFixture,
  seedBillingCustomer,
  seedBillingSubscription,
  type BillingStripeRuntimeFixture
} from './runtime-fixture'

const fixtures: BillingStripeRuntimeFixture[] = []
const now = new Date('2026-07-15T12:00:00.000Z')
const configuration = {
  enabled: true,
  appName: 'Convergence Test',
  appUrl: 'https://app.example.test',
  stripe: {
    secretKey: 'rk_test_convergence',
    webhookSecret: 'whsec_convergence',
    portalConfigurationId: 'bpc_convergence',
    prices: {
      'personal.weekly': 'price_personal_weekly',
      'personal.monthly': 'price_personal_monthly',
      'personal.annual': 'price_personal_annual',
      'family.monthly': 'price_family_monthly',
      'family.annual': 'price_family_annual'
    }
  }
} as const satisfies BillingStripeRuntimeConfiguration

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.sqlite.close()
})

describe('Billing transition convergence fences', () => {
  it('does not time out a transition after a deletion fence appears during convergence', async () => {
    const fixture = createBillingStripeRuntimeFixture('purchaser_convergence_deletion')
    fixtures.push(fixture)
    const customerId = seedBillingCustomer(fixture)
    const subscriptionId = seedBillingSubscription(fixture, {
      customerId,
      planKey: 'personal',
      cadence: 'monthly',
      stripePriceId: 'price_personal_monthly'
    })
    const oldUpdatedAt = new Date(now.getTime() - billingTransitionPendingRecoveryDelayMs - 1_000).toISOString()
    fixture.sqlite
      .prepare(
        `insert into billing_subscription_transitions (
         id, purchaser_user_id, billing_subscription_id, kind, source_plan_key, source_cadence,
         target_plan_key, target_cadence, effective_at, idempotency_key,
         captured_billing_revision, state, revision, updated_at
       ) values ('transition_convergence_deletion', ?, ?, 'personal_to_family',
                 'personal', 'monthly', 'family', 'monthly', null,
                 'transition_convergence_deletion_idempotency', 0, 'pending', 0, ?)`
      )
      .run(fixture.purchaserUserId, subscriptionId, oldUpdatedAt)

    let insertedFence = false
    const integration: BillingStripeIntegration = {
      authorizePurchaserBilling() {
        return 'authorized'
      },
      synchronizePurchaserBilling(connection) {
        if (!insertedFence) {
          insertedFence = true
          connection.sqlite
            .prepare(
              `insert into billing_account_deletion_requests (
               id, purchaser_user_id, billing_subscription_id, billing_customer_id,
               expected_stripe_subscription_id, expected_stripe_customer_id,
               captured_billing_revision, state, reason, cancellation_confirmed_at, revision
             ) values ('deletion_during_convergence', ?, ?, ?, 'sub_test', 'cus_test',
                       1, 'pending', null, null, 0)`
            )
            .run(fixture.purchaserUserId, subscriptionId, customerId)
        }
        return undefined
      }
    }
    const provider = providerSubscription()
    const handler = createBillingTransitionConvergenceHandler({
      connection: fixture.connection,
      client: {
        subscriptions: {
          async retrieve() {
            return provider
          },
          async list(parameters: Stripe.SubscriptionListParams) {
            return {
              object: 'list',
              data: parameters.status === 'active' ? [provider] : [],
              has_more: false,
              url: '/v1/subscriptions'
            } as Stripe.ApiList<Stripe.Subscription>
          }
        }
      } as never,
      config: configuration,
      integration,
      now: () => now
    })

    await expect(handler({ transitionId: 'transition_convergence_deletion' })).rejects.toThrow(
      'Billing transition requires further reconciliation'
    )
    expect(
      fixture.sqlite
        .prepare(
          `select state, state_reason as stateReason, revision
       from billing_subscription_transitions where id = 'transition_convergence_deletion'`
        )
        .get()
    ).toEqual({ state: 'pending', stateReason: null, revision: 0 })
    expect(
      fixture.sqlite
        .prepare(`select state from billing_account_deletion_requests where id = 'deletion_during_convergence'`)
        .get()
    ).toEqual({ state: 'pending' })
  })

  it('converges a missed scheduled downgrade and emits the normalized coverage episode', async () => {
    const fixture = runtimeFixture('scheduled')
    const customerId = seedBillingCustomer(fixture, 'cus_convergence_scheduled')
    const subscriptionId = seedBillingSubscription(fixture, {
      customerId,
      stripeSubscriptionId: 'sub_convergence_scheduled',
      stripeSubscriptionItemId: 'si_convergence_scheduled',
      planKey: 'family',
      cadence: 'monthly',
      stripePriceId: 'price_family_monthly',
      currentPeriodStart: '2026-07-01T00:00:00.000Z',
      currentPeriodEnd: '2026-08-01T00:00:00.000Z'
    })
    const transitionId = 'transition_convergence_scheduled'
    insertTransition(fixture, subscriptionId, {
      id: transitionId,
      kind: 'family_to_personal',
      sourcePlan: 'family',
      targetPlan: 'personal',
      state: 'scheduled',
      effectiveAt: '2026-08-01T00:00:00.000Z',
      scheduleId: 'sub_sched_convergence'
    })
    const schedule = providerSchedule({
      customer: 'cus_convergence_scheduled',
      subscription: 'sub_convergence_scheduled',
      status: 'released',
      sourcePrice: 'price_family_monthly',
      targetPrice: 'price_personal_monthly'
    })
    const provider = transitionProvider(
      providerSubscriptionFor({
        customer: 'cus_convergence_scheduled',
        id: 'sub_convergence_scheduled',
        itemId: 'si_convergence_scheduled',
        price: 'price_personal_monthly',
        periodStart: '2026-08-01T00:00:00.000Z',
        periodEnd: '2026-09-01T00:00:00.000Z'
      }),
      schedule
    )
    const synchronization: unknown[] = []
    const integration: BillingStripeIntegration = {
      authorizePurchaserBilling: () => 'authorized',
      synchronizePurchaserBilling(_connection, request) {
        synchronization.push(request)
        return undefined
      }
    }
    const handler = createBillingTransitionConvergenceHandler({
      connection: fixture.connection,
      client: provider.client,
      config: configuration,
      integration,
      now: () => new Date('2026-08-02T00:00:00.000Z')
    })

    await handler({ transitionId })

    expect(transitionRow(fixture, transitionId)).toMatchObject({ state: 'applied', stateReason: null })
    expect(subscriptionRow(fixture)).toMatchObject({
      planKey: 'personal',
      cadence: 'monthly',
      stripePriceId: 'price_personal_monthly',
      reconciliationRequired: 0
    })
    expect(provider.retrieveSchedule).toHaveBeenCalledWith(
      'sub_sched_convergence',
      {},
      { timeout: 5_000, maxNetworkRetries: 0 }
    )
    expect(synchronization).toEqual([
      expect.objectContaining({
        kind: 'state_committed',
        transition: expect.objectContaining({ id: transitionId, state: 'applied' }),
        effects: [
          expect.objectContaining({
            action: 'coverage_ended',
            episodeKey: expect.stringMatching(/^billing_episode_[a-f0-9]{64}$/),
            transitionId
          })
        ]
      })
    ])
    expect(JSON.stringify(synchronization)).not.toContain(transitionId + ':')
  })

  it('converges an applied action-required upgrade and a missed pending-update expiry', async () => {
    for (const outcome of ['applied', 'expired'] as const) {
      const fixture = runtimeFixture(`action_${outcome}`)
      const customer = `cus_convergence_${outcome}`
      const subscription = `sub_convergence_${outcome}`
      const customerId = seedBillingCustomer(fixture, customer)
      const subscriptionId = seedBillingSubscription(fixture, {
        customerId,
        stripeSubscriptionId: subscription,
        stripeSubscriptionItemId: `si_convergence_${outcome}`,
        planKey: 'personal',
        cadence: 'monthly',
        stripePriceId: 'price_personal_monthly'
      })
      const transitionId = `transition_convergence_${outcome}`
      const invoiceId = `in_convergence_${outcome}`
      insertTransition(fixture, subscriptionId, {
        id: transitionId,
        kind: 'personal_to_family',
        sourcePlan: 'personal',
        targetPlan: 'family',
        state: 'action_required',
        pendingInvoiceId: invoiceId,
        pendingExpiresAt: '2026-07-20T11:00:00.000Z'
      })
      const provider = transitionProvider(
        providerSubscriptionFor({
          customer,
          id: subscription,
          itemId: `si_convergence_${outcome}`,
          price: outcome === 'applied' ? 'price_family_monthly' : 'price_personal_monthly',
          periodStart: '2026-07-01T00:00:00.000Z',
          periodEnd: '2026-08-01T00:00:00.000Z',
          invoice: transitionInvoice(customer, subscription, invoiceId, outcome === 'applied' ? 'paid' : 'void')
        })
      )
      const handler = createBillingTransitionConvergenceHandler({
        connection: fixture.connection,
        client: provider.client,
        config: configuration,
        now: () => new Date('2026-07-20T12:00:00.000Z')
      })

      await handler({ transitionId })

      expect(transitionRow(fixture, transitionId)).toMatchObject({
        state: outcome === 'applied' ? 'applied' : 'failed',
        stateReason: outcome === 'applied' ? null : 'pending_update_expired'
      })
      expect(subscriptionRow(fixture)).toMatchObject({
        planKey: outcome === 'applied' ? 'family' : 'personal',
        reconciliationRequired: 0
      })
    }
  })

  it('recovers missing and exhausted jobs without duplicating active coverage', () => {
    const fixture = runtimeFixture('ensure')
    const customerId = seedBillingCustomer(fixture, 'cus_convergence_ensure')
    const subscriptionId = seedBillingSubscription(fixture, {
      customerId,
      stripeSubscriptionId: 'sub_convergence_ensure'
    })
    const transitionId = 'transition_convergence_ensure'
    insertTransition(fixture, subscriptionId, {
      id: transitionId,
      kind: 'family_to_personal',
      sourcePlan: 'family',
      targetPlan: 'personal',
      state: 'scheduled',
      effectiveAt: '2026-08-01T00:00:00.000Z',
      scheduleId: 'sub_sched_ensure'
    })

    expect(ensureBillingTransitionConvergenceJobs(fixture.connection, now)).toBe(1)
    expect(ensureBillingTransitionConvergenceJobs(fixture.connection, now)).toBe(0)
    expect(convergenceJobs(fixture)).toEqual([
      expect.objectContaining({
        payload: JSON.stringify({ transitionId }),
        runAfter: '2026-08-01T00:00:00.000Z',
        status: 'queued'
      })
    ])
    fixture.sqlite
      .prepare(
        `update job_queue set status = 'failed', attempts = max_attempts
       where type = ? and json_extract(payload, '$.transitionId') = ?`
      )
      .run(billingTransitionConvergenceJobType, transitionId)
    expect(ensureBillingTransitionConvergenceJobs(fixture.connection, now)).toBe(1)
    expect(ensureBillingTransitionConvergenceJobs(fixture.connection, now)).toBe(0)
    expect(convergenceJobs(fixture)).toEqual([
      expect.objectContaining({ attempts: billingTransitionConvergenceMaxAttempts, status: 'failed' }),
      expect.objectContaining({ attempts: 0, status: 'queued' })
    ])
  })

  it('recovers a command crash window and fails an unresolved provider operation closed', async () => {
    const fixture = runtimeFixture('command_crash')
    const customerId = seedBillingCustomer(fixture, 'cus_convergence_crash')
    const subscriptionId = seedBillingSubscription(fixture, {
      customerId,
      stripeSubscriptionId: 'sub_convergence_crash',
      stripeSubscriptionItemId: 'si_convergence_crash',
      planKey: 'personal',
      stripePriceId: 'price_personal_monthly'
    })
    const transitionId = 'transition_convergence_crash'
    const oldUpdatedAt = new Date(now.getTime() - billingTransitionPendingRecoveryDelayMs - 1_000).toISOString()
    insertTransition(fixture, subscriptionId, {
      id: transitionId,
      kind: 'personal_to_family',
      sourcePlan: 'personal',
      targetPlan: 'family',
      state: 'pending',
      updatedAt: oldUpdatedAt
    })
    const provider = transitionProvider(
      providerSubscriptionFor({
        customer: 'cus_convergence_crash',
        id: 'sub_convergence_crash',
        itemId: 'si_convergence_crash',
        price: 'price_personal_monthly',
        periodStart: '2026-07-01T00:00:00.000Z',
        periodEnd: '2026-08-01T00:00:00.000Z'
      })
    )
    const handler = createBillingTransitionConvergenceHandler({
      connection: fixture.connection,
      client: provider.client,
      config: configuration,
      now: () => now
    })

    expect(ensureBillingTransitionConvergenceJobs(fixture.connection, now)).toBe(1)
    expect(convergenceJobs(fixture)[0]).toMatchObject({
      runAfter: new Date(Date.parse(oldUpdatedAt) + billingTransitionPendingRecoveryDelayMs).toISOString()
    })
    await expect(handler({ transitionId })).rejects.toThrow('Billing transition requires further reconciliation')
    expect(transitionRow(fixture, transitionId)).toMatchObject({
      state: 'reconciliation_required',
      stateReason: 'transition_provider_operation_incomplete'
    })
    expect(subscriptionRow(fixture)).toMatchObject({
      reconciliationRequired: 1,
      reconciliationReason: 'transition_provider_operation_incomplete'
    })
  })

  it('recovers a configured schedule crash and fails an unrecorded schedule reference closed', async () => {
    for (const scheduleRecorded of [true, false]) {
      const fixture = runtimeFixture(`schedule_${scheduleRecorded}`)
      const customer = `cus_convergence_schedule_${scheduleRecorded}`
      const subscription = `sub_convergence_schedule_${scheduleRecorded}`
      const customerId = seedBillingCustomer(fixture, customer)
      const subscriptionId = seedBillingSubscription(fixture, {
        customerId,
        stripeSubscriptionId: subscription,
        stripeSubscriptionItemId: `si_convergence_schedule_${scheduleRecorded}`,
        planKey: 'personal',
        cadence: 'monthly',
        stripePriceId: 'price_personal_monthly'
      })
      const transitionId = `transition_convergence_schedule_${scheduleRecorded}`
      const schedule = providerSchedule({
        customer,
        subscription,
        status: 'active',
        sourcePrice: 'price_personal_monthly',
        targetPrice: 'price_personal_annual'
      })
      insertTransition(fixture, subscriptionId, {
        id: transitionId,
        kind: 'cadence_change',
        sourcePlan: 'personal',
        sourceCadence: 'monthly',
        targetPlan: 'personal',
        targetCadence: 'annual',
        state: 'pending',
        effectiveAt: '2026-08-01T00:00:00.000Z',
        scheduleId: scheduleRecorded ? schedule.id : null,
        updatedAt: new Date(now.getTime() - billingTransitionPendingRecoveryDelayMs - 1_000).toISOString()
      })
      const provider = transitionProvider(
        providerSubscriptionFor({
          customer,
          id: subscription,
          itemId: `si_convergence_schedule_${scheduleRecorded}`,
          price: 'price_personal_monthly',
          periodStart: '2026-07-01T00:00:00.000Z',
          periodEnd: '2026-08-01T00:00:00.000Z',
          schedule
        }),
        schedule
      )
      const handler = createBillingTransitionConvergenceHandler({
        connection: fixture.connection,
        client: provider.client,
        config: configuration,
        now: () => now
      })

      if (scheduleRecorded) await expect(handler({ transitionId })).resolves.toBeUndefined()
      else await expect(handler({ transitionId })).rejects.toThrow('Billing transition requires further reconciliation')
      expect(transitionRow(fixture, transitionId)).toMatchObject(
        scheduleRecorded
          ? { state: 'scheduled', stateReason: null }
          : { state: 'reconciliation_required', stateReason: 'unrecorded_transition_schedule' }
      )
      expect(subscriptionRow(fixture)).toMatchObject({ reconciliationRequired: scheduleRecorded ? 0 : 1 })
    }
  })

  it('rejects non-exact payloads before reading Stripe', async () => {
    const fixture = runtimeFixture('payload')
    const list = vi.fn()
    const retrieve = vi.fn()
    const handler = createBillingTransitionConvergenceHandler({
      connection: fixture.connection,
      client: { subscriptions: { list, retrieve } } as never,
      config: configuration
    })

    await expect(handler({ transitionId: 'transition', injected: true })).rejects.toThrow(
      'Invalid Billing transition convergence payload'
    )
    expect(list).not.toHaveBeenCalled()
    expect(retrieve).not.toHaveBeenCalled()
  })
})

function runtimeFixture(suffix: string): BillingStripeRuntimeFixture {
  const fixture = createBillingStripeRuntimeFixture(`purchaser_convergence_${suffix}`)
  fixtures.push(fixture)
  return fixture
}

function insertTransition(
  fixture: BillingStripeRuntimeFixture,
  billingSubscriptionId: string,
  input: Readonly<{
    id: string
    kind: 'cadence_change' | 'personal_to_family' | 'family_to_personal'
    sourcePlan: 'personal' | 'family'
    sourceCadence?: 'weekly' | 'monthly' | 'annual'
    targetPlan: 'personal' | 'family'
    targetCadence?: 'weekly' | 'monthly' | 'annual'
    effectiveAt?: string | null
    scheduleId?: string | null
    pendingInvoiceId?: string | null
    pendingExpiresAt?: string | null
    state: 'pending' | 'action_required' | 'scheduled' | 'reconciliation_required'
    updatedAt?: string
  }>
): void {
  const revision = (
    fixture.sqlite.prepare('select revision from billing_subscriptions where id = ?').get(billingSubscriptionId) as {
      revision: number
    }
  ).revision
  const updatedAt = input.updatedAt ?? now.toISOString()
  fixture.sqlite
    .prepare(
      `insert into billing_subscription_transitions (
       id, purchaser_user_id, billing_subscription_id, kind, source_plan_key, source_cadence,
       target_plan_key, target_cadence, effective_at, stripe_subscription_schedule_id,
       stripe_pending_invoice_id, stripe_pending_update_expires_at, idempotency_key,
       captured_billing_revision, state, state_reason, revision, created_at, updated_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(
      input.id,
      fixture.purchaserUserId,
      billingSubscriptionId,
      input.kind,
      input.sourcePlan,
      input.sourceCadence ?? 'monthly',
      input.targetPlan,
      input.targetCadence ?? 'monthly',
      input.effectiveAt ?? null,
      input.scheduleId ?? null,
      input.pendingInvoiceId ?? null,
      input.pendingExpiresAt ?? null,
      `idempotency_${input.id}`,
      revision,
      input.state,
      input.state === 'action_required' ? 'payment_resolution_required' : null,
      updatedAt,
      updatedAt
    )
}

function transitionProvider(subscription: Stripe.Subscription, schedule: Stripe.SubscriptionSchedule | null = null) {
  const list = vi.fn(
    async (parameters: Stripe.SubscriptionListParams) =>
      ({
        object: 'list',
        data: parameters.status === subscription.status ? [subscription] : [],
        has_more: false,
        url: '/v1/subscriptions'
      }) as Stripe.ApiList<Stripe.Subscription>
  )
  const retrieve = vi.fn(async () => subscription)
  const retrieveSchedule = vi.fn(async () => schedule)
  return {
    list,
    retrieve,
    retrieveSchedule,
    client: {
      subscriptions: { list, retrieve },
      subscriptionSchedules: { retrieve: retrieveSchedule }
    } as never
  }
}

function providerSubscriptionFor(
  input: Readonly<{
    customer: string
    id: string
    itemId: string
    price: string
    periodStart: string
    periodEnd: string
    invoice?: Stripe.Invoice | null
    schedule?: Stripe.SubscriptionSchedule | null
  }>
): Stripe.Subscription {
  return {
    id: input.id,
    object: 'subscription',
    customer: input.customer,
    status: 'active',
    collection_method: 'charge_automatically',
    cancel_at: null,
    cancel_at_period_end: false,
    canceled_at: null,
    ended_at: null,
    pause_collection: null,
    trial_end: null,
    discounts: [],
    billing_schedules: [],
    schedule: input.schedule ?? null,
    pending_update: null,
    latest_invoice: input.invoice ?? null,
    metadata: {},
    items: {
      object: 'list',
      data: [
        {
          id: input.itemId,
          object: 'subscription_item',
          subscription: input.id,
          current_period_start: Date.parse(input.periodStart) / 1_000,
          current_period_end: Date.parse(input.periodEnd) / 1_000,
          quantity: 1,
          price: { id: input.price, object: 'price' },
          discounts: []
        } as Stripe.SubscriptionItem
      ],
      has_more: false,
      url: `/v1/subscription_items?subscription=${input.id}`
    }
  } as Stripe.Subscription
}

function providerSchedule(
  input: Readonly<{
    customer: string
    subscription: string
    status: 'active' | 'released'
    sourcePrice: string
    targetPrice: string
  }>
): Stripe.SubscriptionSchedule {
  return {
    id: 'sub_sched_convergence',
    object: 'subscription_schedule',
    customer: input.customer,
    subscription: input.status === 'released' ? null : input.subscription,
    released_subscription: input.status === 'released' ? input.subscription : null,
    status: input.status,
    end_behavior: 'release',
    phases: [
      schedulePhase('2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', input.sourcePrice),
      schedulePhase('2026-08-01T00:00:00.000Z', '2027-08-01T00:00:00.000Z', input.targetPrice)
    ]
  } as Stripe.SubscriptionSchedule
}

function schedulePhase(start: string, end: string, price: string): Stripe.SubscriptionSchedule.Phase {
  return {
    start_date: Date.parse(start) / 1_000,
    end_date: Date.parse(end) / 1_000,
    items: [{ price, quantity: 1, discounts: [] }],
    add_invoice_items: [],
    discounts: null,
    trial_end: null,
    proration_behavior: 'none'
  } as Stripe.SubscriptionSchedule.Phase
}

function transitionInvoice(
  customer: string,
  subscription: string,
  id: string,
  status: 'paid' | 'void'
): Stripe.Invoice {
  return {
    id,
    object: 'invoice',
    customer,
    status,
    billing_reason: 'subscription_update',
    collection_method: 'charge_automatically',
    attempted: true,
    attempt_count: 1,
    amount_remaining: 0,
    parent: {
      type: 'subscription_details',
      quote_details: null,
      subscription_details: { metadata: null, subscription }
    }
  } as Stripe.Invoice
}

function transitionRow(fixture: BillingStripeRuntimeFixture, id: string) {
  return fixture.sqlite
    .prepare(
      `select state, state_reason as stateReason, revision
     from billing_subscription_transitions where id = ?`
    )
    .get(id) as Record<string, unknown>
}

function subscriptionRow(fixture: BillingStripeRuntimeFixture) {
  return fixture.sqlite
    .prepare(
      `select plan_key as planKey, cadence, stripe_price_id as stripePriceId,
            reconciliation_required as reconciliationRequired,
            reconciliation_reason as reconciliationReason, revision
     from billing_subscriptions where purchaser_user_id = ?`
    )
    .get(fixture.purchaserUserId) as Record<string, unknown>
}

function convergenceJobs(fixture: BillingStripeRuntimeFixture) {
  return fixture.sqlite
    .prepare(
      `select status, payload, attempts, max_attempts as maxAttempts, run_after as runAfter
     from job_queue where type = ? order by id`
    )
    .all(billingTransitionConvergenceJobType) as Array<Record<string, unknown>>
}

function providerSubscription(): Stripe.Subscription {
  return {
    id: 'sub_test',
    object: 'subscription',
    customer: 'cus_test',
    status: 'active',
    collection_method: 'charge_automatically',
    cancel_at: null,
    cancel_at_period_end: false,
    pause_collection: null,
    trial_end: null,
    discounts: [],
    billing_schedules: [],
    schedule: null,
    pending_update: null,
    latest_invoice: null,
    metadata: {},
    items: {
      object: 'list',
      data: [
        {
          id: 'si_test',
          object: 'subscription_item',
          current_period_start: Date.parse('2026-07-01T00:00:00.000Z') / 1_000,
          current_period_end: Date.parse('2026-08-01T00:00:00.000Z') / 1_000,
          quantity: 1,
          price: { id: 'price_personal_monthly', object: 'price' },
          discounts: []
        } as Stripe.SubscriptionItem
      ],
      has_more: false,
      url: '/v1/subscription_items?subscription=sub_test'
    }
  } as Stripe.Subscription
}
