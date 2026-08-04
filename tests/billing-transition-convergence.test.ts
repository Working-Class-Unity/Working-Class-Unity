import type Stripe from 'stripe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TransactionalEmailMessage } from '../server/services/email'
import { createBillingFamilyLifecycleSignalJobHandler } from '../server/services/payments/billing-family-lifecycle'
import {
  billingFamilyLifecycleSignalJobType,
  hashBillingFamilyLifecycleEpisodeKey
} from '../server/services/payments/billing-family-lifecycle-signal'
import {
  billingNotificationDeliveryJobType,
  createBillingNotificationDeliveryHandler
} from '../server/services/payments/billing-notification-delivery'
import {
  billingTransitionConvergenceJobType,
  billingTransitionConvergenceMaxAttempts,
  billingTransitionPendingRecoveryDelayMs,
  createBillingTransitionConvergenceHandler,
  ensureBillingTransitionConvergenceJobs
} from '../server/services/payments/billing-transition-convergence'
import type { StripeBillingClient } from '../server/services/payments/stripe-client'
import {
  createWorkspaceInvitationFixture,
  seedVerifiedBilling,
  type SignedInFixtureUser,
  type WorkspaceInvitationFixture
} from './helpers/workspace-invitation-fixture'

let fixture: WorkspaceInvitationFixture | undefined

afterEach(() => {
  fixture?.cleanup()
  fixture = undefined
})

describe('billing transition convergence jobs', () => {
  it('converges a missed scheduled downgrade and emits the exact dissolution episode', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('converge-manager@example.test', 'Converge Manager')
    const relative = await fixture.signIn('converge-relative@example.test', 'Converge Relative')
    const observedAt = wholeSecond(new Date(Date.now() + 60_000))
    const effectiveAt = wholeSecond(new Date(observedAt.getTime() - 60_000))
    const periodStart = wholeSecond(new Date(effectiveAt.getTime() - 24 * 60 * 60 * 1_000))
    const targetEnd = wholeSecond(new Date(effectiveAt.getTime() + 30 * 24 * 60 * 60 * 1_000))
    const billing = seedBilling(fixture, manager, 'family', periodStart, effectiveAt)
    fixture.sqlite
      .prepare(
        `insert into member (id, organization_id, user_id, role, created_at)
         values ('converge-relative-member', ?, ?, 'member', ?)`
      )
      .run(manager.workspace.id, relative.user.id, Date.now())
    const transitionId = 'transition_converge_scheduled'
    seedTransition(fixture, manager, billing.subscriptionId, {
      effectiveAt,
      id: transitionId,
      kind: 'family_to_personal',
      scheduleId: 'sub_sched_converge',
      sourcePlan: 'family',
      state: 'scheduled',
      targetPlan: 'personal'
    })
    const schedule = providerSchedule(billing, periodStart, effectiveAt, targetEnd, 'released')
    const provider = providerClient(
      providerSubscription(billing, 'personal', effectiveAt, targetEnd, {
        invoice: null,
        schedule: null
      }),
      schedule
    )
    const handler = createBillingTransitionConvergenceHandler({
      connection: fixture.connection,
      client: provider.client,
      config: fixture.config,
      now: () => observedAt
    })

    await handler({ transitionId })

    expect(transitionRow(fixture, transitionId)).toMatchObject({ state: 'applied', state_reason: null })
    expect(subscriptionRow(fixture, billing.subscriptionId)).toMatchObject({
      plan_key: 'personal',
      cadence: 'monthly',
      stripe_price_id: 'price_personal_monthly',
      reconciliation_required: 0
    })
    expect(provider.retrieveSchedule).toHaveBeenCalledWith(
      'sub_sched_converge',
      {},
      { timeout: 5_000, maxNetworkRetries: 0 }
    )
    const signal = lifecycleJobs(fixture, 'coverage_ended')[0]
    expect(signal).toMatchObject({
      payload: JSON.stringify({
        action: 'coverage_ended',
        billingSubscriptionId: billing.subscriptionId,
        billingTransitionId: transitionId,
        episodeKey: hashBillingFamilyLifecycleEpisodeKey(transitionId)
      })
    })

    const messages: TransactionalEmailMessage[] = []
    const lifecycleHandler = createBillingFamilyLifecycleSignalJobHandler({
      connection: fixture.connection,
      now: () => observedAt
    })
    await lifecycleHandler(JSON.parse(signal!.payload))
    const notification = notificationJobs(fixture)[0]
    const notificationHandler = createBillingNotificationDeliveryHandler({
      appName: fixture.config.public.appName,
      connection: fixture.connection,
      sender: {
        async send(message) {
          messages.push(message)
        }
      }
    })
    await notificationHandler(JSON.parse(notification!.payload))

    expect(fixture.sqlite.prepare("select 1 from member where id = 'converge-relative-member'").get()).toBeUndefined()
    expect(messages).toEqual([
      expect.objectContaining({
        subject: 'Your Family membership ended',
        to: relative.user.email
      })
    ])
  })

  it('converges an applied action-required upgrade and a missed pending-update expiry', async () => {
    for (const outcome of ['applied', 'expired'] as const) {
      fixture = createWorkspaceInvitationFixture()
      const owner = await fixture.signIn(`converge-${outcome}@example.test`, `Converge ${outcome}`)
      const periodStart = new Date('2026-07-01T00:00:00.000Z')
      const periodEnd = new Date('2026-08-01T00:00:00.000Z')
      const observedAt = new Date('2026-07-20T12:00:00.000Z')
      const expiresAt = new Date('2026-07-20T11:00:00.000Z')
      const billing = seedBilling(fixture, owner, 'personal', periodStart, periodEnd)
      const transitionId = `transition_converge_${outcome}`
      seedTransition(fixture, owner, billing.subscriptionId, {
        expiresAt,
        id: transitionId,
        invoiceId: `in_converge_${outcome}`,
        kind: 'personal_to_family',
        sourcePlan: 'personal',
        state: 'action_required',
        targetPlan: 'family'
      })
      const invoice = transitionInvoice(billing, `in_converge_${outcome}`, outcome === 'applied' ? 'paid' : 'void')
      const provider = providerClient(
        providerSubscription(billing, outcome === 'applied' ? 'family' : 'personal', periodStart, periodEnd, {
          invoice,
          schedule: null
        })
      )
      const handler = createBillingTransitionConvergenceHandler({
        connection: fixture.connection,
        client: provider.client,
        config: fixture.config,
        now: () => observedAt
      })

      await handler({ transitionId })

      expect(transitionRow(fixture, transitionId)).toMatchObject({
        state: outcome === 'applied' ? 'applied' : 'failed',
        state_reason: outcome === 'applied' ? null : 'pending_update_expired'
      })
      expect(subscriptionRow(fixture, billing.subscriptionId)).toMatchObject({
        plan_key: outcome === 'applied' ? 'family' : 'personal',
        reconciliation_required: 0
      })
      fixture.cleanup()
      fixture = undefined
    }
  })

  it('recovers missing and exhausted jobs without duplicating active coverage', async () => {
    fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('converge-safety@example.test', 'Converge Safety')
    const periodStart = new Date('2026-07-01T00:00:00.000Z')
    const effectiveAt = new Date('2026-08-01T00:00:00.000Z')
    const now = new Date('2026-07-20T12:00:00.000Z')
    const billing = seedBilling(fixture, owner, 'family', periodStart, effectiveAt)
    const transitionId = 'transition_converge_safety'
    seedTransition(fixture, owner, billing.subscriptionId, {
      effectiveAt,
      id: transitionId,
      kind: 'family_to_personal',
      scheduleId: 'sub_sched_safety',
      sourcePlan: 'family',
      state: 'scheduled',
      targetPlan: 'personal'
    })

    expect(ensureBillingTransitionConvergenceJobs(fixture.connection, now)).toBe(1)
    expect(ensureBillingTransitionConvergenceJobs(fixture.connection, now)).toBe(0)
    expect(convergenceJobs(fixture)).toEqual([
      expect.objectContaining({
        payload: JSON.stringify({ transitionId }),
        runAfter: effectiveAt.toISOString(),
        status: 'queued'
      })
    ])

    fixture.sqlite
      .prepare(
        `update job_queue
         set status = 'failed', attempts = max_attempts
         where type = ? and json_extract(payload, '$.transitionId') = ?`
      )
      .run(billingTransitionConvergenceJobType, transitionId)
    expect(ensureBillingTransitionConvergenceJobs(fixture.connection, now)).toBe(1)
    expect(convergenceJobs(fixture)).toEqual([
      expect.objectContaining({
        attempts: billingTransitionConvergenceMaxAttempts,
        status: 'failed'
      }),
      expect.objectContaining({ attempts: 0, status: 'queued' })
    ])
  })

  it('recovers command crash windows and fails an unresolved provider operation closed', async () => {
    fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('converge-crash@example.test', 'Converge Crash')
    const periodStart = new Date('2026-07-01T00:00:00.000Z')
    const periodEnd = new Date('2026-08-01T00:00:00.000Z')
    const observedAt = new Date('2026-07-20T12:00:00.000Z')
    const billing = seedBilling(fixture, owner, 'personal', periodStart, periodEnd)
    const transitionId = 'transition_converge_crash'
    const oldUpdatedAt = new Date(observedAt.getTime() - billingTransitionPendingRecoveryDelayMs - 1_000)
    seedTransition(fixture, owner, billing.subscriptionId, {
      id: transitionId,
      kind: 'personal_to_family',
      sourcePlan: 'personal',
      state: 'pending',
      targetPlan: 'family',
      updatedAt: oldUpdatedAt
    })
    const sourceProvider = providerClient(
      providerSubscription(billing, 'personal', periodStart, periodEnd, { invoice: null, schedule: null })
    )
    const sourceHandler = createBillingTransitionConvergenceHandler({
      connection: fixture.connection,
      client: sourceProvider.client,
      config: fixture.config,
      now: () => observedAt
    })

    expect(ensureBillingTransitionConvergenceJobs(fixture.connection, observedAt)).toBe(1)
    expect(convergenceJobs(fixture)[0]).toMatchObject({
      runAfter: new Date(oldUpdatedAt.getTime() + billingTransitionPendingRecoveryDelayMs).toISOString()
    })
    await expect(sourceHandler({ transitionId })).rejects.toThrow('Billing transition requires further reconciliation')

    expect(transitionRow(fixture, transitionId)).toMatchObject({
      state: 'reconciliation_required',
      state_reason: 'transition_provider_operation_incomplete'
    })
    expect(subscriptionRow(fixture, billing.subscriptionId)).toMatchObject({
      reconciliation_required: 1,
      reconciliation_reason: 'transition_provider_operation_incomplete'
    })
    fixture.sqlite
      .prepare(
        `update job_queue
         set status = 'succeeded', attempts = 1
         where type = ? and json_extract(payload, '$.transitionId') = ?`
      )
      .run(billingTransitionConvergenceJobType, transitionId)
    expect(ensureBillingTransitionConvergenceJobs(fixture.connection, observedAt)).toBe(1)
    await expect(sourceHandler({ transitionId })).rejects.toThrow('Billing transition requires further reconciliation')

    const appliedProvider = providerClient(
      providerSubscription(billing, 'family', periodStart, periodEnd, {
        invoice: transitionInvoice(billing, 'in_converge_recovered', 'paid'),
        schedule: null
      })
    )
    fixture.sqlite
      .prepare(
        `update billing_subscription_transitions
         set stripe_pending_invoice_id = 'in_converge_recovered'
         where id = ?`
      )
      .run(transitionId)
    const appliedHandler = createBillingTransitionConvergenceHandler({
      connection: fixture.connection,
      client: appliedProvider.client,
      config: fixture.config,
      now: () => new Date(observedAt.getTime() + 60_000)
    })
    await appliedHandler({ transitionId })

    expect(transitionRow(fixture, transitionId)).toMatchObject({ state: 'applied', state_reason: null })
    expect(subscriptionRow(fixture, billing.subscriptionId)).toMatchObject({
      plan_key: 'family',
      reconciliation_required: 0,
      reconciliation_reason: null
    })
  })

  it('recovers a configured schedule crash and fails an unrecorded schedule reference closed', async () => {
    for (const scheduleRecorded of [true, false]) {
      fixture = createWorkspaceInvitationFixture()
      const owner = await fixture.signIn(`converge-schedule-${scheduleRecorded}@example.test`, 'Schedule Crash')
      const periodStart = new Date('2026-07-01T00:00:00.000Z')
      const periodEnd = new Date('2026-08-01T00:00:00.000Z')
      const targetEnd = new Date('2026-09-01T00:00:00.000Z')
      const observedAt = new Date('2026-07-20T12:00:00.000Z')
      const billing = seedBilling(fixture, owner, 'personal', periodStart, periodEnd)
      const transitionId = `transition_schedule_crash_${scheduleRecorded}`
      const schedule = providerSchedule(billing, periodStart, periodEnd, targetEnd, 'active', {
        sourcePrice: 'price_personal_monthly',
        targetPrice: 'price_personal_annual'
      })
      seedTransition(fixture, owner, billing.subscriptionId, {
        effectiveAt: periodEnd,
        id: transitionId,
        kind: 'cadence_change',
        scheduleId: scheduleRecorded ? schedule.id : null,
        sourceCadence: 'monthly',
        sourcePlan: 'personal',
        state: 'pending',
        targetCadence: 'annual',
        targetPlan: 'personal',
        updatedAt: new Date(observedAt.getTime() - billingTransitionPendingRecoveryDelayMs - 1_000)
      })
      const provider = providerClient(
        providerSubscription(billing, 'personal', periodStart, periodEnd, {
          invoice: null,
          priceId: 'price_personal_monthly',
          schedule
        }),
        schedule
      )
      const handler = createBillingTransitionConvergenceHandler({
        connection: fixture.connection,
        client: provider.client,
        config: fixture.config,
        now: () => observedAt
      })

      if (scheduleRecorded) {
        await expect(handler({ transitionId })).resolves.toBeUndefined()
      } else {
        await expect(handler({ transitionId })).rejects.toThrow('Billing transition requires further reconciliation')
      }

      expect(transitionRow(fixture, transitionId)).toMatchObject(
        scheduleRecorded
          ? { state: 'scheduled', state_reason: null }
          : {
              state: 'reconciliation_required',
              state_reason: 'unrecorded_transition_schedule'
            }
      )
      expect(subscriptionRow(fixture, billing.subscriptionId)).toMatchObject({
        reconciliation_required: scheduleRecorded ? 0 : 1
      })
      fixture.cleanup()
      fixture = undefined
    }
  })

  it('rejects non-exact payloads before reading Stripe', async () => {
    fixture = createWorkspaceInvitationFixture()
    const provider = providerClient(null)
    const handler = createBillingTransitionConvergenceHandler({
      connection: fixture.connection,
      client: provider.client,
      config: fixture.config
    })

    await expect(handler({ transitionId: 'transition', injected: true })).rejects.toThrow(
      'Invalid billing transition convergence job payload'
    )
    expect(provider.list).not.toHaveBeenCalled()
  })
})

type SeededBilling = ReturnType<typeof seedVerifiedBilling>

function seedBilling(
  activeFixture: WorkspaceInvitationFixture,
  owner: SignedInFixtureUser,
  plan: 'personal' | 'family',
  periodStart: Date,
  periodEnd: Date
): SeededBilling {
  const billing = seedVerifiedBilling(activeFixture, owner, {
    plan,
    currentPeriodEnd: periodEnd
  })
  activeFixture.sqlite
    .prepare(
      `update billing_subscriptions
       set current_period_start = ?, current_period_end = ?
       where id = ?`
    )
    .run(periodStart.toISOString(), periodEnd.toISOString(), billing.subscriptionId)
  return billing
}

function seedTransition(
  activeFixture: WorkspaceInvitationFixture,
  owner: SignedInFixtureUser,
  billingSubscriptionId: string,
  input: Readonly<{
    effectiveAt?: Date
    expiresAt?: Date
    id: string
    invoiceId?: string
    kind: 'cadence_change' | 'personal_to_family' | 'family_to_personal'
    scheduleId?: string | null
    sourceCadence?: 'monthly' | 'annual'
    sourcePlan: 'personal' | 'family'
    state: 'pending' | 'action_required' | 'scheduled' | 'reconciliation_required'
    targetCadence?: 'monthly' | 'annual'
    targetPlan: 'personal' | 'family'
    updatedAt?: Date
  }>
): void {
  const subscription = subscriptionRow(activeFixture, billingSubscriptionId)
  const updatedAt = input.updatedAt ?? new Date()
  activeFixture.sqlite
    .prepare(
      `insert into billing_subscription_transitions (
         id, organization_id, billing_subscription_id, kind,
         source_plan_key, source_cadence, target_plan_key, target_cadence,
         effective_at, idempotency_key, captured_billing_revision,
         stripe_subscription_schedule_id, stripe_pending_invoice_id,
         stripe_pending_update_expires_at, state, state_reason,
         created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      owner.workspace.id,
      billingSubscriptionId,
      input.kind,
      input.sourcePlan,
      input.sourceCadence ?? 'monthly',
      input.targetPlan,
      input.targetCadence ?? 'monthly',
      input.effectiveAt?.toISOString() ?? null,
      `idempotency_${input.id}`,
      subscription.revision,
      input.scheduleId ?? null,
      input.invoiceId ?? null,
      input.expiresAt?.toISOString() ?? null,
      input.state,
      input.state === 'action_required' ? 'payment_resolution_required' : null,
      updatedAt.toISOString(),
      updatedAt.toISOString()
    )
}

function providerClient(subscription: Stripe.Subscription | null, schedule: Stripe.SubscriptionSchedule | null = null) {
  const list = vi.fn(
    async (parameters: Stripe.SubscriptionListParams) =>
      ({
        object: 'list',
        data: subscription?.status === parameters.status ? [subscription] : [],
        has_more: false,
        url: '/v1/subscriptions'
      }) as Stripe.ApiList<Stripe.Subscription>
  )
  const retrieve = vi.fn(async () => subscription as Stripe.Subscription)
  const retrieveSchedule = vi.fn(async () => schedule)
  return {
    list,
    retrieveSchedule,
    client: {
      subscriptions: { list, retrieve },
      subscriptionSchedules: { retrieve: retrieveSchedule }
    } as unknown as StripeBillingClient
  }
}

function providerSubscription(
  billing: SeededBilling,
  plan: 'personal' | 'family',
  periodStart: Date,
  periodEnd: Date,
  options: Readonly<{
    invoice: Stripe.Invoice | null
    priceId?: string
    schedule: string | Stripe.SubscriptionSchedule | null
  }>
): Stripe.Subscription {
  const priceId = options.priceId ?? `price_${plan}_monthly`
  return {
    id: billing.stripeSubscriptionId,
    object: 'subscription',
    customer: billing.stripeCustomerId,
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
    schedule: options.schedule,
    pending_update: null,
    latest_invoice: options.invoice,
    metadata: {},
    items: {
      object: 'list',
      data: [
        {
          id: billing.stripeSubscriptionItemId,
          object: 'subscription_item',
          subscription: billing.stripeSubscriptionId,
          current_period_start: epoch(periodStart),
          current_period_end: epoch(periodEnd),
          quantity: 1,
          price: { id: priceId, object: 'price' },
          discounts: []
        } as Stripe.SubscriptionItem
      ],
      has_more: false,
      url: `/v1/subscription_items?subscription=${billing.stripeSubscriptionId}`
    }
  } as Stripe.Subscription
}

function transitionInvoice(billing: SeededBilling, id: string, status: 'paid' | 'void'): Stripe.Invoice {
  return {
    id,
    object: 'invoice',
    customer: billing.stripeCustomerId,
    status,
    billing_reason: 'subscription_update',
    collection_method: 'charge_automatically',
    attempted: true,
    attempt_count: 1,
    amount_remaining: 0,
    parent: {
      type: 'subscription_details',
      quote_details: null,
      subscription_details: {
        metadata: null,
        subscription: billing.stripeSubscriptionId
      }
    }
  } as Stripe.Invoice
}

function providerSchedule(
  billing: SeededBilling,
  sourceStart: Date,
  sourceEnd: Date,
  targetEnd: Date,
  status: 'active' | 'released',
  prices: Readonly<{ sourcePrice: string; targetPrice: string }> = {
    sourcePrice: 'price_family_monthly',
    targetPrice: 'price_personal_monthly'
  }
): Stripe.SubscriptionSchedule {
  return {
    id: 'sub_sched_converge',
    object: 'subscription_schedule',
    customer: billing.stripeCustomerId,
    subscription: status === 'released' ? null : billing.stripeSubscriptionId,
    released_subscription: status === 'released' ? billing.stripeSubscriptionId : null,
    status,
    end_behavior: 'release',
    phases: [
      schedulePhase(sourceStart, sourceEnd, prices.sourcePrice),
      schedulePhase(sourceEnd, targetEnd, prices.targetPrice)
    ]
  } as Stripe.SubscriptionSchedule
}

function schedulePhase(start: Date, end: Date, priceId: string): Stripe.SubscriptionSchedule.Phase {
  return {
    start_date: epoch(start),
    end_date: epoch(end),
    items: [{ price: priceId, quantity: 1, discounts: [] }],
    add_invoice_items: [],
    discounts: null,
    trial_end: null,
    proration_behavior: 'none'
  } as Stripe.SubscriptionSchedule.Phase
}

function wholeSecond(value: Date): Date {
  return new Date(Math.floor(value.getTime() / 1_000) * 1_000)
}

function epoch(value: Date): number {
  return Math.floor(value.getTime() / 1_000)
}

function transitionRow(activeFixture: WorkspaceInvitationFixture, id: string) {
  return activeFixture.sqlite.prepare('select * from billing_subscription_transitions where id = ?').get(id) as Record<
    string,
    unknown
  >
}

function subscriptionRow(activeFixture: WorkspaceInvitationFixture, id: string) {
  return activeFixture.sqlite.prepare('select * from billing_subscriptions where id = ?').get(id) as Record<
    string,
    unknown
  >
}

function convergenceJobs(activeFixture: WorkspaceInvitationFixture) {
  return activeFixture.sqlite
    .prepare(
      `select status, payload, attempts, max_attempts as maxAttempts, run_after as runAfter
       from job_queue
       where type = ?
       order by id`
    )
    .all(billingTransitionConvergenceJobType) as Array<Record<string, unknown>>
}

function lifecycleJobs(activeFixture: WorkspaceInvitationFixture, action: string) {
  return activeFixture.sqlite
    .prepare(
      `select payload
       from job_queue
       where type = ? and json_extract(payload, '$.action') = ?
       order by id`
    )
    .all(billingFamilyLifecycleSignalJobType, action) as Array<{ payload: string }>
}

function notificationJobs(activeFixture: WorkspaceInvitationFixture) {
  return activeFixture.sqlite
    .prepare('select payload from job_queue where type = ? order by id')
    .all(billingNotificationDeliveryJobType) as Array<{ payload: string }>
}
