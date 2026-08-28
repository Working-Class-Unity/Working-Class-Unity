import type Stripe from 'stripe'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BillingStripeRuntimeConfiguration } from '../../server/services/payments/stripe/configuration'
import type {
  BillingStripeConnection,
  BillingStripeIntegration,
  BillingStripeSynchronizationRequest
} from '../../server/services/payments/stripe/public-contract'
import type { BillingCadence, BillingPlan } from '../../shared/billing'
import type { StripeBillingClient } from '../../server/services/payments/stripe/stripe-client'
import {
  executeBillingTransition,
  type BillingTransitionContext
} from '../../server/services/payments/stripe/transition'
import { billingTransitionConvergenceJobType } from '../../server/services/payments/stripe/transition-store'

const priceByOffering = {
  'personal.weekly': 'price_personal_weekly_transition',
  'personal.monthly': 'price_personal_monthly_transition',
  'personal.annual': 'price_personal_annual_transition',
  'family.monthly': 'price_family_monthly_transition',
  'family.annual': 'price_family_annual_transition'
} as const

const transitionConfiguration = {
  enabled: true,
  appName: 'Transition Test',
  appUrl: 'https://app.example.test',
  stripe: {
    secretKey: 'rk_test_transition',
    webhookSecret: 'whsec_transition',
    portalConfigurationId: 'bpc_transition',
    prices: priceByOffering
  }
} as const satisfies BillingStripeRuntimeConfiguration

const commandNow = new Date('2026-07-15T12:00:00.000Z')
const openConnections: InstanceType<typeof Database>[] = []

afterEach(() => {
  for (const sqlite of openConnections.splice(0)) sqlite.close()
})

describe('Stripe billing transitions', () => {
  it('schedules a same-plan cadence change for the exact next renewal', async () => {
    const fixture = createTransitionFixture('cadence')
    const source = seedActiveSubscription(fixture, 'personal', 'monthly')
    const provider = transitionProvider(source)

    await executeBillingTransition(
      billingContext(fixture, provider.client),
      fixture.purchaserUserId,
      'personal.annual',
      commandNow
    )

    const transition = transitionRow(fixture)!
    const idempotencyKey = transition.idempotency_key as string
    expect(provider.scheduleCreate).toHaveBeenCalledWith(
      { from_subscription: source.stripeSubscriptionId },
      { idempotencyKey: `${idempotencyKey}_schedule_create` }
    )
    expect(provider.scheduleUpdate).toHaveBeenCalledWith(
      'sub_sched_transition',
      {
        end_behavior: 'release',
        proration_behavior: 'none',
        phases: [
          {
            start_date: epoch(source.currentPeriodStart),
            end_date: epoch(source.currentPeriodEnd),
            items: [{ price: priceByOffering['personal.monthly'], quantity: 1 }],
            proration_behavior: 'none'
          },
          {
            start_date: epoch(source.currentPeriodEnd),
            duration: { interval: 'year', interval_count: 1 },
            items: [{ price: priceByOffering['personal.annual'], quantity: 1 }],
            proration_behavior: 'none'
          }
        ]
      },
      { idempotencyKey: `${idempotencyKey}_schedule_configure` }
    )
    expect(transition).toMatchObject({
      purchaser_user_id: fixture.purchaserUserId,
      kind: 'cadence_change',
      state: 'scheduled',
      source_plan_key: 'personal',
      source_cadence: 'monthly',
      target_plan_key: 'personal',
      target_cadence: 'annual',
      effective_at: source.currentPeriodEnd,
      stripe_subscription_schedule_id: 'sub_sched_transition'
    })
    expect(jobRows(fixture)).toEqual([
      expect.objectContaining({
        payload: JSON.stringify({ transitionId: transition.id }),
        run_after: source.currentPeriodEnd
      })
    ])
  })

  it('uses the same schedule mechanism for Family-to-Personal at renewal', async () => {
    const fixture = createTransitionFixture('downgrade')
    const source = seedActiveSubscription(fixture, 'family', 'annual')
    const provider = transitionProvider(source)

    await executeBillingTransition(
      billingContext(fixture, provider.client),
      fixture.purchaserUserId,
      'personal.monthly',
      commandNow
    )

    expect(provider.subscriptionUpdate).not.toHaveBeenCalled()
    expect(provider.scheduleCreate).toHaveBeenCalledTimes(1)
    expect(provider.scheduleUpdate.mock.calls[0]?.[1]).toMatchObject({
      end_behavior: 'release',
      phases: [
        { items: [{ price: priceByOffering['family.annual'], quantity: 1 }] },
        {
          duration: { interval: 'month', interval_count: 1 },
          items: [{ price: priceByOffering['personal.monthly'], quantity: 1 }]
        }
      ]
    })
    const transition = transitionRow(fixture)!
    expect(transition).toMatchObject({
      purchaser_user_id: fixture.purchaserUserId,
      kind: 'family_to_personal',
      state: 'scheduled',
      effective_at: source.currentPeriodEnd
    })
    expect(jobRows(fixture)).toEqual([
      expect.objectContaining({
        payload: JSON.stringify({ transitionId: transition.id }),
        run_after: source.currentPeriodEnd
      })
    ])
    expect(fixture.synchronizationRequests).toEqual([
      expect.objectContaining({
        kind: 'transition_reserved',
        sourceOffering: 'family.annual',
        targetOffering: 'personal.monthly'
      })
    ])
  })

  it('schedules the public $10-to-$27 change for the next renewal without proration', async () => {
    const fixture = createTransitionFixture('upgrade')
    const source = seedActiveSubscription(fixture, 'personal', 'monthly')
    let transitionWasReserved = false
    const provider = transitionProvider(source, {
      onRetrieve() {
        transitionWasReserved = Boolean(transitionRow(fixture)?.idempotency_key)
      }
    })

    await executeBillingTransition(
      billingContext(fixture, provider.client),
      fixture.purchaserUserId,
      'family.monthly',
      commandNow
    )

    const transition = transitionRow(fixture)!
    expect(transitionWasReserved).toBe(true)
    expect(provider.subscriptionUpdate).not.toHaveBeenCalled()
    expect(provider.scheduleCreate).toHaveBeenCalledWith(
      { from_subscription: source.stripeSubscriptionId },
      { idempotencyKey: `${transition.idempotency_key}_schedule_create` }
    )
    expect(provider.scheduleUpdate).toHaveBeenCalledWith(
      'sub_sched_transition',
      {
        end_behavior: 'release',
        proration_behavior: 'none',
        phases: [
          {
            start_date: epoch(source.currentPeriodStart),
            end_date: epoch(source.currentPeriodEnd),
            items: [{ price: priceByOffering['personal.monthly'], quantity: 1 }],
            proration_behavior: 'none'
          },
          {
            start_date: epoch(source.currentPeriodEnd),
            duration: { interval: 'month', interval_count: 1 },
            items: [{ price: priceByOffering['family.monthly'], quantity: 1 }],
            proration_behavior: 'none'
          }
        ]
      },
      { idempotencyKey: `${transition.idempotency_key}_schedule_configure` }
    )
    expect(transition).toMatchObject({ state: 'scheduled', effective_at: source.currentPeriodEnd })
    expect(subscriptionRow(fixture)).toMatchObject({
      purchaser_user_id: fixture.purchaserUserId,
      stripe_subscription_id: source.stripeSubscriptionId,
      stripe_subscription_item_id: source.stripeSubscriptionItemId,
      plan_key: 'personal',
      cadence: 'monthly',
      stripe_price_id: priceByOffering['personal.monthly'],
      status: 'active'
    })
    expect(fixture.synchronizationRequests).toEqual([
      expect.objectContaining({
        kind: 'transition_reserved',
        sourceOffering: 'personal.monthly',
        targetOffering: 'family.monthly'
      })
    ])
  })

  it('resets the billing anchor only when an immediate upgrade changes cadence', async () => {
    const fixture = createTransitionFixture('anchor')
    const source = seedActiveSubscription(fixture, 'personal', 'weekly')
    const provider = transitionProvider(source)

    await executeBillingTransition(
      billingContext(fixture, provider.client),
      fixture.purchaserUserId,
      'family.annual',
      commandNow
    )

    expect(provider.subscriptionUpdate.mock.calls[0]?.[1]).toMatchObject({
      billing_cycle_anchor: 'now',
      items: [
        {
          id: source.stripeSubscriptionItemId,
          price: priceByOffering['family.annual'],
          quantity: 1
        }
      ],
      payment_behavior: 'pending_if_incomplete',
      proration_behavior: 'always_invoice'
    })
  })

  it('stores only private correlation when payment needs action', async () => {
    const fixture = createTransitionFixture('action')
    const source = seedActiveSubscription(fixture, 'personal', 'annual')
    const provider = transitionProvider(source, { updateOutcome: 'pending' })

    await executeBillingTransition(
      billingContext(fixture, provider.client),
      fixture.purchaserUserId,
      'family.annual',
      commandNow
    )

    const transition = transitionRow(fixture)!
    expect(transition).toMatchObject({
      state: 'action_required',
      state_reason: 'payment_resolution_required',
      stripe_pending_invoice_id: 'in_transition_update',
      stripe_pending_update_expires_at: '2026-07-16T11:00:00.000Z'
    })
    expect(subscriptionRow(fixture)).toMatchObject({
      plan_key: 'personal',
      cadence: 'annual',
      stripe_price_id: priceByOffering['personal.annual']
    })
    expect(provider.subscriptionList).not.toHaveBeenCalled()
    expect(jobRows(fixture)).toEqual([
      expect.objectContaining({
        payload: JSON.stringify({ transitionId: transition.id }),
        run_after: '2026-07-16T11:00:00.000Z'
      })
    ])
    expect(fixture.synchronizationRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'state_committed',
          cause: 'transition',
          transition: {
            id: transition.id,
            kind: 'personal_to_family',
            sourceOffering: 'personal.annual',
            targetOffering: 'family.annual',
            state: 'action_required',
            effectiveAt: null
          },
          effects: [
            {
              action: 'payment_attention',
              episodeKey: expect.stringMatching(/^billing_episode_[a-f0-9]{64}$/),
              effectiveAt: '2026-07-16T11:00:00.000Z',
              transitionId: transition.id
            }
          ]
        })
      ])
    )
    const serializedSynchronization = JSON.stringify(fixture.synchronizationRequests)
    expect(serializedSynchronization).not.toContain('in_transition_update')
    expect(serializedSynchronization).not.toContain('hosted_invoice_url')
    expect(
      fixture.connection.sqlite
        .prepare(`select count(*) as count from job_queue where type = 'billing.notification-delivery'`)
        .get()
    ).toEqual({ count: 1 })
    expect(
      JSON.stringify(
        fixture.connection.sqlite
          .prepare(`select payload from job_queue where type = 'billing.notification-delivery'`)
          .get()
      )
    ).not.toContain('in_transition_update')
  })

  it('fails closed when a Dashboard schedule or pending update already exists', async () => {
    for (const sourceMutation of [
      { schedule: 'sub_sched_foreign' },
      {
        pending_update: {
          billing_cycle_anchor: null,
          discount: null,
          discounts: null,
          expires_at: epoch('2026-07-16T11:00:00.000Z'),
          metadata: null,
          subscription_items: null,
          trial_end: null,
          trial_from_plan: null
        }
      }
    ] satisfies ReadonlyArray<Partial<Stripe.Subscription>>) {
      const fixture = createTransitionFixture(`foreign-${sourceMutation.schedule ? 'schedule' : 'pending'}`)
      const source = seedActiveSubscription(fixture, 'personal', 'monthly')
      const provider = transitionProvider(source, { sourceMutation })

      await expect(
        executeBillingTransition(
          billingContext(fixture, provider.client),
          fixture.purchaserUserId,
          'family.monthly',
          commandNow
        )
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(provider.subscriptionUpdate).not.toHaveBeenCalled()
      expect(provider.scheduleCreate).not.toHaveBeenCalled()
      expect(transitionRow(fixture)).toMatchObject({
        state: 'reconciliation_required',
        state_reason: 'source_subscription_diverged'
      })
      expect(subscriptionRow(fixture)).toMatchObject({
        plan_key: 'personal',
        cadence: 'monthly',
        reconciliation_required: 0
      })
    }
  })

  it('fails closed when Stripe returns a schedule with a different target duration', async () => {
    const fixture = createTransitionFixture('schedule-duration')
    const source = seedActiveSubscription(fixture, 'personal', 'monthly')
    const provider = transitionProvider(source, { scheduleTargetEndOffsetSeconds: 1 })

    await expect(
      executeBillingTransition(
        billingContext(fixture, provider.client),
        fixture.purchaserUserId,
        'personal.annual',
        commandNow
      )
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(transitionRow(fixture)).toMatchObject({
      state: 'reconciliation_required',
      state_reason: 'schedule_configuration_diverged',
      stripe_subscription_schedule_id: 'sub_sched_transition'
    })
    expect(subscriptionRow(fixture)).toMatchObject({
      plan_key: 'personal',
      cadence: 'monthly',
      stripe_price_id: priceByOffering['personal.monthly']
    })
  })

  it('does not apply the target when the independent current read still shows the source', async () => {
    const fixture = createTransitionFixture('stale-current')
    const source = seedActiveSubscription(fixture, 'personal', 'annual')
    const provider = transitionProvider(source, { postUpdateRetrieveKeepsSource: true })

    await expect(
      executeBillingTransition(
        billingContext(fixture, provider.client),
        fixture.purchaserUserId,
        'family.annual',
        commandNow
      )
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(subscriptionRow(fixture)).toMatchObject({
      plan_key: 'personal',
      cadence: 'annual',
      stripe_price_id: priceByOffering['personal.annual']
    })
    expect(transitionRow(fixture)).toMatchObject({
      state: 'reconciliation_required',
      state_reason: 'current_subscription_diverged'
    })
  })

  it('does not apply the target when a second nonterminal subscription is discovered', async () => {
    const fixture = createTransitionFixture('ambiguous-live')
    const source = seedActiveSubscription(fixture, 'personal', 'annual')
    const provider = transitionProvider(source, { additionalLiveStatuses: ['trialing'] })

    await expect(
      executeBillingTransition(
        billingContext(fixture, provider.client),
        fixture.purchaserUserId,
        'family.annual',
        commandNow
      )
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(transitionRow(fixture)).toMatchObject({
      state: 'reconciliation_required',
      state_reason: 'current_subscription_diverged'
    })
    expect(subscriptionRow(fixture)).toMatchObject({
      plan_key: 'personal',
      cadence: 'annual'
    })
  })

  it('rechecks the captured local revision after provider reads', async () => {
    const fixture = createTransitionFixture('revision-race')
    const source = seedActiveSubscription(fixture, 'personal', 'monthly')
    const provider = transitionProvider(source, {
      onRetrieve() {
        fixture.connection.sqlite
          .prepare('update billing_subscriptions set revision = revision + 1 where purchaser_user_id = ?')
          .run(fixture.purchaserUserId)
      }
    })

    await expect(
      executeBillingTransition(
        billingContext(fixture, provider.client),
        fixture.purchaserUserId,
        'family.monthly',
        commandNow
      )
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(provider.subscriptionUpdate).not.toHaveBeenCalled()
    expect(transitionRow(fixture)).toMatchObject({
      state: 'reconciliation_required',
      state_reason: 'local_transition_authority_changed'
    })
  })

  it('makes an indeterminate provider call durable reconciliation under the persisted key', async () => {
    const fixture = createTransitionFixture('provider-failure')
    const source = seedActiveSubscription(fixture, 'personal', 'monthly')
    const provider = transitionProvider(source, { retrieveFailure: true })

    await expect(
      executeBillingTransition(
        billingContext(fixture, provider.client),
        fixture.purchaserUserId,
        'family.monthly',
        commandNow
      )
    ).rejects.toMatchObject({ statusCode: 502 })
    expect(transitionRow(fixture)).toMatchObject({
      idempotency_key: expect.stringMatching(/^billing_change_/),
      state: 'reconciliation_required',
      state_reason: 'provider_transition_indeterminate'
    })
  })

  it('rejects same offering and inactive authority before Stripe mutation', async () => {
    const sameFixture = createTransitionFixture('same')
    const sameSource = seedActiveSubscription(sameFixture, 'personal', 'monthly')
    const sameProvider = transitionProvider(sameSource)

    await expect(
      executeBillingTransition(
        billingContext(sameFixture, sameProvider.client),
        sameFixture.purchaserUserId,
        'personal.monthly',
        commandNow
      )
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(sameProvider.subscriptionRetrieve).not.toHaveBeenCalled()

    const inactiveFixture = createTransitionFixture('inactive')
    const inactiveSource = seedActiveSubscription(inactiveFixture, 'personal', 'monthly')
    inactiveFixture.connection.sqlite
      .prepare("update billing_subscriptions set status = 'past_due' where purchaser_user_id = ?")
      .run(inactiveFixture.purchaserUserId)
    const inactiveProvider = transitionProvider(inactiveSource)

    await expect(
      executeBillingTransition(
        billingContext(inactiveFixture, inactiveProvider.client),
        inactiveFixture.purchaserUserId,
        'family.monthly',
        commandNow
      )
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(inactiveProvider.subscriptionRetrieve).not.toHaveBeenCalled()
  })

  it('rejects a new transition before Stripe I/O once account deletion is fenced', async () => {
    const fixture = createTransitionFixture('deletion-fence')
    const source = seedActiveSubscription(fixture, 'personal', 'monthly')
    const provider = transitionProvider(source)
    const subscription = subscriptionRow(fixture)!
    fixture.connection.sqlite
      .prepare(
        `insert into billing_account_deletion_requests (
           id, purchaser_user_id, billing_subscription_id, billing_customer_id,
           expected_stripe_subscription_id, expected_stripe_customer_id,
           captured_billing_revision, state, reason, cancellation_confirmed_at,
           revision, created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, ?, 'pending', null, null, 0, ?, ?)`
      )
      .run(
        'billing_deletion_transition',
        fixture.purchaserUserId,
        subscription.id,
        subscription.billing_customer_id,
        source.stripeSubscriptionId,
        source.stripeCustomerId,
        subscription.revision,
        commandNow.toISOString(),
        commandNow.toISOString()
      )

    await expect(
      executeBillingTransition(
        billingContext(fixture, provider.client),
        fixture.purchaserUserId,
        'family.monthly',
        commandNow
      )
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(provider.subscriptionRetrieve).not.toHaveBeenCalled()
    expect(transitionRow(fixture)).toBeUndefined()
  })
})

type TransitionFixture = Readonly<{
  connection: BillingStripeConnection
  integration: BillingStripeIntegration<BillingStripeConnection, unknown>
  purchaserUserId: string
  synchronizationRequests: BillingStripeSynchronizationRequest[]
}>

function createTransitionFixture(label: string): TransitionFixture {
  const sqlite = new Database(':memory:')
  openConnections.push(sqlite)
  installTransitionSchema(sqlite)
  const purchaserUserId = `user_transition_${label}`
  sqlite.prepare('insert into user (id) values (?)').run(purchaserUserId)
  const synchronizationRequests: BillingStripeSynchronizationRequest[] = []
  const integration: BillingStripeIntegration<BillingStripeConnection, unknown> = {
    authorizePurchaserBilling: () => 'authorized',
    synchronizePurchaserBilling(_connection, request) {
      synchronizationRequests.push(request)
    }
  }
  return {
    connection: { sqlite },
    integration,
    purchaserUserId,
    synchronizationRequests
  }
}

function billingContext(fixture: TransitionFixture, client: StripeBillingClient): BillingTransitionContext {
  return {
    connection: fixture.connection,
    client,
    config: transitionConfiguration,
    integration: fixture.integration
  }
}

type LocalSource = Readonly<{
  stripeCustomerId: string
  stripeSubscriptionId: string
  stripeSubscriptionItemId: string
  stripePriceId: string
  currentPeriodStart: string
  currentPeriodEnd: string
}>

function seedActiveSubscription(fixture: TransitionFixture, plan: BillingPlan, cadence: BillingCadence): LocalSource {
  const suffix = fixture.purchaserUserId.replace('user_transition_', '')
  const customerId = `billing_customer_${suffix}`
  const stripeCustomerId = `cus_${suffix}`
  const stripeSubscriptionId = `sub_${suffix}`
  const stripeSubscriptionItemId = `si_${suffix}`
  const stripePriceId = priceId(plan, cadence)
  const currentPeriodStart = '2026-07-01T00:00:00.000Z'
  const currentPeriodEnd = cadence === 'annual' ? '2027-07-01T00:00:00.000Z' : '2026-08-01T00:00:00.000Z'
  const now = commandNow.toISOString()
  fixture.connection.sqlite
    .prepare(
      `insert into billing_customers (id, purchaser_user_id, stripe_customer_id, created_at, updated_at)
       values (?, ?, ?, ?, ?)`
    )
    .run(customerId, fixture.purchaserUserId, stripeCustomerId, now, now)
  fixture.connection.sqlite
    .prepare(
      `insert into billing_subscriptions (
         id, purchaser_user_id, billing_customer_id, stripe_subscription_id, stripe_subscription_item_id,
         status, plan_key, cadence, stripe_price_id, current_period_start, current_period_end,
         projection_order_ms, reconciliation_required, reconciliation_reason, revision, created_at, updated_at
       ) values (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, 1, 0, null, 0, ?, ?)`
    )
    .run(
      `billing_subscription_${suffix}`,
      fixture.purchaserUserId,
      customerId,
      stripeSubscriptionId,
      stripeSubscriptionItemId,
      plan,
      cadence,
      stripePriceId,
      currentPeriodStart,
      currentPeriodEnd,
      now,
      now
    )
  return {
    stripeCustomerId,
    stripeSubscriptionId,
    stripeSubscriptionItemId,
    stripePriceId,
    currentPeriodStart,
    currentPeriodEnd
  }
}

function installTransitionSchema(sqlite: InstanceType<typeof Database>) {
  sqlite.exec(`
    create table user (
      id text primary key not null
    );
    create table billing_customers (
      id text primary key not null,
      purchaser_user_id text not null references user(id),
      stripe_customer_id text not null,
      created_at text not null,
      updated_at text not null
    );
    create table billing_checkout_attempts (
      id text primary key not null,
      purchaser_user_id text not null references user(id),
      billing_customer_id text,
      plan_key text not null,
      cadence text not null,
      stripe_price_id text not null,
      stripe_session_id text,
      idempotency_key text not null,
      state text not null,
      success_url text not null,
      cancel_url text not null,
      reuse_until text not null,
      created_at text not null,
      updated_at text not null
    );
    create table billing_subscriptions (
      id text primary key not null,
      purchaser_user_id text not null references user(id),
      billing_customer_id text not null references billing_customers(id),
      stripe_subscription_id text,
      stripe_subscription_item_id text,
      status text not null,
      plan_key text,
      cadence text,
      stripe_price_id text,
      current_period_start text,
      current_period_end text,
      cancel_at_period_end integer not null default 0,
      grace_invoice_id text,
      grace_started_at text,
      grace_ends_at text,
      last_verified_at text,
      projection_order_ms integer not null default 0,
      projection_event_id text,
      reconciliation_required integer not null default 0,
      reconciliation_reason text,
      revision integer not null default 0,
      created_at text not null,
      updated_at text not null
    );
    create table billing_subscription_transitions (
      id text primary key not null,
      purchaser_user_id text not null references user(id),
      billing_subscription_id text not null references billing_subscriptions(id),
      kind text not null,
      source_plan_key text not null,
      source_cadence text not null,
      target_plan_key text not null,
      target_cadence text not null,
      effective_at text,
      stripe_subscription_schedule_id text,
      stripe_pending_invoice_id text,
      stripe_pending_update_expires_at text,
      idempotency_key text not null,
      captured_billing_revision integer not null,
      state text not null,
      state_reason text,
      revision integer not null,
      created_at text not null,
      updated_at text not null
    );
    create table billing_account_deletion_requests (
      id text primary key not null,
      purchaser_user_id text not null references user(id),
      billing_subscription_id text,
      billing_customer_id text,
      stripe_membership_user_id text,
      expected_stripe_subscription_id text,
      expected_stripe_customer_id text,
      captured_billing_revision integer not null,
      state text not null,
      reason text,
      cancellation_confirmed_at text,
      revision integer not null,
      created_at text not null,
      updated_at text not null
    );
    create table job_queue (
      id integer primary key autoincrement,
      type text not null,
      status text not null default 'queued',
      payload text not null,
      attempts integer not null default 0,
      max_attempts integer not null default 3,
      run_after text,
      locked_at text,
      locked_by text,
      last_error text,
      created_at text not null,
      updated_at text not null
    );
  `)
}

function transitionProvider(
  source: LocalSource,
  options: Readonly<{
    additionalLiveStatuses?: Stripe.Subscription.Status[]
    postUpdateRetrieveKeepsSource?: boolean
    onRetrieve?: () => void
    retrieveFailure?: boolean
    scheduleTargetEndOffsetSeconds?: number
    sourceMutation?: Partial<Stripe.Subscription>
    updateOutcome?: 'applied' | 'pending'
  }> = {}
) {
  const original = providerSubscription(source)
  let current = { ...original, ...options.sourceMutation } as Stripe.Subscription
  let updated = false
  const subscriptionRetrieve = vi.fn(async () => {
    options.onRetrieve?.()
    if (options.retrieveFailure) throw new Error('indeterminate provider read')
    if (updated && options.postUpdateRetrieveKeepsSource) return original
    return current
  })
  const subscriptionUpdate = vi.fn(
    async (_id: string, params: Stripe.SubscriptionUpdateParams, _request?: Stripe.RequestOptions) => {
      const targetPriceId = params.items?.[0]?.price
      if (typeof targetPriceId !== 'string') throw new TypeError('Expected target Price')
      if (options.updateOutcome === 'pending') {
        current = {
          ...original,
          pending_update: {
            billing_cycle_anchor: params.billing_cycle_anchor === 'now' ? epoch(commandNow.toISOString()) : null,
            discount: null,
            discounts: null,
            expires_at: epoch('2026-07-16T11:00:00.000Z'),
            metadata: null,
            subscription_items: [
              providerItem(source, targetPriceId, epoch(source.currentPeriodStart), epoch(source.currentPeriodEnd))
            ],
            trial_end: null,
            trial_from_plan: null
          },
          latest_invoice: transitionInvoice(source, 'open')
        }
        updated = true
        return current
      }

      const reset = params.billing_cycle_anchor === 'now'
      const start = reset ? epoch(commandNow.toISOString()) : epoch(source.currentPeriodStart)
      const end = reset ? start + 365 * 24 * 60 * 60 : epoch(source.currentPeriodEnd)
      current = {
        ...original,
        items: subscriptionItems(providerItem(source, targetPriceId, start, end), source.stripeSubscriptionId),
        latest_invoice: transitionInvoice(source, 'paid'),
        pending_update: null
      }
      updated = true
      return current
    }
  )
  const subscriptionList = vi.fn(async (parameters: Stripe.SubscriptionListParams) => {
    const live = [
      current,
      ...(options.additionalLiveStatuses ?? []).map(
        (status, index) =>
          ({
            ...current,
            id: `${current.id}_additional_${index}`,
            status
          }) as Stripe.Subscription
      )
    ]
    const matching = live.filter((subscription) => subscription.status === parameters.status)
    const limit = parameters.limit ?? 10
    const data = matching.slice(0, limit)
    return {
      object: 'list' as const,
      data,
      has_more: data.length < matching.length,
      url: '/v1/subscriptions'
    }
  })
  const scheduleCreate = vi.fn(async () => createdSchedule(source))
  const scheduleUpdate = vi.fn(
    async (_id: string, params: Stripe.SubscriptionScheduleUpdateParams, _request?: Stripe.RequestOptions) =>
      configuredSchedule(source, params, options.scheduleTargetEndOffsetSeconds ?? 0)
  )
  return {
    subscriptionRetrieve,
    subscriptionUpdate,
    subscriptionList,
    scheduleCreate,
    scheduleUpdate,
    client: {
      subscriptions: {
        retrieve: subscriptionRetrieve,
        update: subscriptionUpdate,
        list: subscriptionList
      },
      subscriptionSchedules: {
        create: scheduleCreate,
        update: scheduleUpdate
      }
    } as unknown as StripeBillingClient
  }
}

function providerSubscription(source: LocalSource): Stripe.Subscription {
  return {
    id: source.stripeSubscriptionId,
    object: 'subscription',
    customer: source.stripeCustomerId,
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
    items: subscriptionItems(
      providerItem(source, source.stripePriceId, epoch(source.currentPeriodStart), epoch(source.currentPeriodEnd)),
      source.stripeSubscriptionId
    )
  } as Stripe.Subscription
}

function providerItem(
  source: LocalSource,
  stripePriceId: string,
  currentPeriodStart: number,
  currentPeriodEnd: number
): Stripe.SubscriptionItem {
  return {
    id: source.stripeSubscriptionItemId,
    object: 'subscription_item',
    subscription: source.stripeSubscriptionId,
    price: { id: stripePriceId, object: 'price' },
    quantity: 1,
    discounts: [],
    current_period_start: currentPeriodStart,
    current_period_end: currentPeriodEnd
  } as Stripe.SubscriptionItem
}

function subscriptionItems(
  item: Stripe.SubscriptionItem,
  subscriptionId: string
): Stripe.ApiList<Stripe.SubscriptionItem> {
  return {
    object: 'list',
    data: [item],
    has_more: false,
    url: `/v1/subscription_items?subscription=${subscriptionId}`
  }
}

function transitionInvoice(source: LocalSource, status: 'open' | 'paid'): Stripe.Invoice {
  return {
    id: 'in_transition_update',
    object: 'invoice',
    customer: source.stripeCustomerId,
    status,
    billing_reason: 'subscription_update',
    hosted_invoice_url: 'https://invoice.stripe.test/private',
    parent: {
      type: 'subscription_details',
      quote_details: null,
      subscription_details: {
        metadata: null,
        subscription: source.stripeSubscriptionId
      }
    }
  } as Stripe.Invoice
}

function createdSchedule(source: LocalSource): Stripe.SubscriptionSchedule {
  const start = epoch(source.currentPeriodStart)
  const end = epoch(source.currentPeriodEnd)
  return scheduleObject(source, [schedulePhase(start, end, source.stripePriceId, 'create_prorations')])
}

function configuredSchedule(
  source: LocalSource,
  params: Stripe.SubscriptionScheduleUpdateParams,
  targetEndOffsetSeconds: number
): Stripe.SubscriptionSchedule {
  const sourcePhase = params.phases?.[0]
  const targetPhase = params.phases?.[1]
  if (
    typeof sourcePhase?.start_date !== 'number' ||
    typeof sourcePhase.end_date !== 'number' ||
    typeof targetPhase?.start_date !== 'number' ||
    !targetPhase.duration ||
    typeof targetPhase.items[0]?.price !== 'string'
  ) {
    throw new TypeError('Expected exact schedule phases')
  }
  return scheduleObject(source, [
    schedulePhase(
      sourcePhase.start_date,
      sourcePhase.end_date,
      sourcePhase.items[0]!.price as string,
      sourcePhase.proration_behavior ?? 'create_prorations'
    ),
    schedulePhase(
      targetPhase.start_date,
      durationEnd(targetPhase.start_date, targetPhase.duration) + targetEndOffsetSeconds,
      targetPhase.items[0].price,
      targetPhase.proration_behavior ?? 'create_prorations'
    )
  ])
}

function durationEnd(start: number, duration: Stripe.SubscriptionScheduleUpdateParams.Phase.Duration): number {
  if (duration.interval_count !== 1) throw new TypeError('Expected one schedule interval')
  if (duration.interval === 'week') return start + 7 * 24 * 60 * 60
  if (duration.interval !== 'month' && duration.interval !== 'year') {
    throw new TypeError('Unexpected schedule interval')
  }

  const date = new Date(start * 1_000)
  const monthOffset = duration.interval === 'month' ? 1 : 12
  const targetMonthIndex = date.getUTCMonth() + monthOffset
  const targetYear = date.getUTCFullYear() + Math.floor(targetMonthIndex / 12)
  const targetMonth = targetMonthIndex % 12
  const lastTargetDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  return Math.floor(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(date.getUTCDate(), lastTargetDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds()
    ) / 1_000
  )
}

function scheduleObject(source: LocalSource, phases: Stripe.SubscriptionSchedule.Phase[]): Stripe.SubscriptionSchedule {
  return {
    id: 'sub_sched_transition',
    object: 'subscription_schedule',
    customer: source.stripeCustomerId,
    subscription: source.stripeSubscriptionId,
    status: 'active',
    end_behavior: 'release',
    current_phase: {
      start_date: epoch(source.currentPeriodStart),
      end_date: epoch(source.currentPeriodEnd)
    },
    phases,
    released_at: null,
    released_subscription: null,
    canceled_at: null,
    completed_at: null
  } as Stripe.SubscriptionSchedule
}

function schedulePhase(
  startDate: number,
  endDate: number,
  stripePriceId: string,
  prorationBehavior: Stripe.SubscriptionSchedule.Phase.ProrationBehavior
): Stripe.SubscriptionSchedule.Phase {
  return {
    start_date: startDate,
    end_date: endDate,
    items: [
      {
        price: stripePriceId,
        quantity: 1,
        discounts: []
      } as Stripe.SubscriptionSchedule.Phase.Item
    ],
    add_invoice_items: [],
    discounts: null,
    trial_end: null,
    proration_behavior: prorationBehavior
  } as Stripe.SubscriptionSchedule.Phase
}

function priceId(plan: BillingPlan, cadence: BillingCadence): string {
  const offering = `${plan}.${cadence}` as keyof typeof priceByOffering
  return priceByOffering[offering]
}

function transitionRow(fixture: TransitionFixture) {
  return fixture.connection.sqlite
    .prepare('select * from billing_subscription_transitions order by rowid desc limit 1')
    .get() as Record<string, unknown> | undefined
}

function subscriptionRow(fixture: TransitionFixture) {
  return fixture.connection.sqlite.prepare('select * from billing_subscriptions order by rowid desc limit 1').get() as
    Record<string, unknown> | undefined
}

function jobRows(fixture: TransitionFixture) {
  return fixture.connection.sqlite
    .prepare('select type, payload, run_after from job_queue where type = ? order by id')
    .all(billingTransitionConvergenceJobType) as Array<Record<string, unknown>>
}

function epoch(value: string): number {
  return Math.floor(Date.parse(value) / 1_000)
}
