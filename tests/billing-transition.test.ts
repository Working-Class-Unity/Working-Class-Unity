import type Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import type { BillingCadence, BillingPlan } from '../shared/billing'
import {
  changeBillingOfferingForConnection,
  getBillingStateForConnection,
  type BillingServiceContext
} from '../server/services/payments/billing-service'
import {
  billingFamilyLifecycleSignalJobType,
  hashBillingFamilyLifecycleEpisodeKey
} from '../server/services/payments/billing-family-lifecycle-signal'
import { billingTransitionConvergenceJobType } from '../server/services/payments/billing-transition-convergence'
import type { StripeBillingClient } from '../server/services/payments/stripe-client'
import type { AppRuntimeConfig } from '../server/utils/runtime'
import {
  createWorkspaceInvitationFixture,
  type SignedInFixtureUser,
  type WorkspaceInvitationFixture
} from './helpers/workspace-invitation-fixture'

const stripeConfig = {
  secretKey: 'sk_test_transition',
  webhookSecret: 'whsec_transition',
  portalConfigurationId: 'bpc_transition',
  personalWeeklyPriceId: 'price_personal_weekly_transition',
  personalMonthlyPriceId: 'price_personal_monthly_transition',
  personalAnnualPriceId: 'price_personal_annual_transition',
  familyMonthlyPriceId: 'price_family_monthly_transition',
  familyAnnualPriceId: 'price_family_annual_transition'
} as const

const commandNow = new Date('2026-07-15T12:00:00.000Z')

describe('application-owned Stripe billing transitions', () => {
  it('schedules a same-plan cadence change for the exact next renewal', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('transition-cadence@example.test', 'Cadence Owner')
    const source = seedActiveSubscription(fixture, owner, 'personal', 'monthly')
    const provider = transitionProvider(source)

    try {
      const state = await changeBillingOfferingForConnection(
        billingContext(fixture, provider.client),
        owner.user.id,
        { offering: 'personal.annual' },
        commandNow
      )

      expect(state).toMatchObject({
        entitlement: { granted: true, source: 'personal', plan: 'personal', cadence: 'monthly' },
        subscription: { state: 'active', plan: 'personal', cadence: 'monthly' },
        transition: {
          kind: 'cadence_change',
          targetOffering: 'personal.annual',
          effectiveAt: source.currentPeriodEnd,
          state: 'scheduled'
        },
        capabilities: { canChange: false }
      })
      expect(provider.scheduleCreate).toHaveBeenCalledWith(
        { from_subscription: source.stripeSubscriptionId },
        { idempotencyKey: expect.stringMatching(/^billing_change_.*_schedule_create$/) }
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
              items: [{ price: stripeConfig.personalMonthlyPriceId, quantity: 1 }],
              proration_behavior: 'none'
            },
            {
              start_date: epoch(source.currentPeriodEnd),
              duration: { interval: 'year', interval_count: 1 },
              items: [{ price: stripeConfig.personalAnnualPriceId, quantity: 1 }],
              proration_behavior: 'none'
            }
          ]
        },
        { idempotencyKey: expect.stringMatching(/^billing_change_.*_schedule_configure$/) }
      )
      expect(transitionRow(fixture)).toMatchObject({
        kind: 'cadence_change',
        state: 'scheduled',
        source_plan_key: 'personal',
        source_cadence: 'monthly',
        target_plan_key: 'personal',
        target_cadence: 'annual',
        effective_at: source.currentPeriodEnd,
        stripe_subscription_schedule_id: 'sub_sched_transition'
      })
      expect(jobRows(fixture, billingTransitionConvergenceJobType)).toEqual([
        expect.objectContaining({
          payload: JSON.stringify({ transitionId: transitionRow(fixture)!.id }),
          run_after: source.currentPeriodEnd
        })
      ])
    } finally {
      fixture.cleanup()
    }
  })

  it('uses the same schedule mechanism for Family-to-Personal at renewal', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('transition-downgrade@example.test', 'Downgrade Owner')
    const relative = await fixture.signIn('transition-downgrade-relative@example.test', 'Downgrade Relative')
    const source = seedActiveSubscription(fixture, owner, 'family', 'annual')
    fixture.sqlite
      .prepare('insert into member (id, organization_id, user_id, role, created_at) values (?, ?, ?, ?, ?)')
      .run('member_transition_downgrade', owner.workspace.id, relative.user.id, 'member', Date.now())
    fixture.sqlite
      .prepare(
        `insert into invitation (
           id, organization_id, email, role, status, expires_at, created_at, inviter_id
         ) values (?, ?, ?, 'member', 'pending', ?, ?, ?)`
      )
      .run(
        'invitation_transition_downgrade',
        owner.workspace.id,
        'pending-downgrade@example.test',
        commandNow.getTime() + 60_000,
        commandNow.getTime(),
        owner.user.id
      )
    const provider = transitionProvider(source)

    try {
      const state = await changeBillingOfferingForConnection(
        billingContext(fixture, provider.client),
        owner.user.id,
        { offering: 'personal.monthly' },
        commandNow
      )

      expect(state).toMatchObject({
        entitlement: { granted: true, source: 'manager', plan: 'family', cadence: 'annual' },
        transition: {
          kind: 'family_to_personal',
          targetOffering: 'personal.monthly',
          effectiveAt: source.currentPeriodEnd,
          state: 'scheduled'
        },
        seats: { accepted: 2, reserved: 0 },
        capabilities: {
          canChange: false,
          canCreateFamilyInvitation: false,
          canResendFamilyInvitation: false,
          canAddFamilyMember: false,
          canRemoveFamilyMember: true
        }
      })
      expect(
        fixture.sqlite.prepare('select status from invitation where id = ?').get('invitation_transition_downgrade')
      ).toEqual({ status: 'canceled' })
      expect(
        fixture.sqlite.prepare('select count(*) as count from member where organization_id = ?').get(owner.workspace.id)
      ).toEqual({ count: 2 })
      expect(provider.subscriptionUpdate).not.toHaveBeenCalled()
      expect(provider.scheduleCreate).toHaveBeenCalledTimes(1)
      expect(provider.scheduleUpdate.mock.calls[0]?.[1]).toMatchObject({
        end_behavior: 'release',
        phases: [
          { items: [{ price: stripeConfig.familyAnnualPriceId, quantity: 1 }] },
          {
            duration: { interval: 'month', interval_count: 1 },
            items: [{ price: stripeConfig.personalMonthlyPriceId, quantity: 1 }]
          }
        ]
      })
      const transition = transitionRow(fixture)!
      expect(jobRows(fixture, billingTransitionConvergenceJobType)).toEqual([
        expect.objectContaining({
          payload: JSON.stringify({ transitionId: transition.id }),
          run_after: source.currentPeriodEnd
        })
      ])
      expect(jobRows(fixture, billingFamilyLifecycleSignalJobType)).toEqual([
        expect.objectContaining({
          payload: JSON.stringify({
            action: 'renewal_ending',
            billingSubscriptionId: transition.billing_subscription_id,
            billingTransitionId: transition.id,
            episodeKey: hashBillingFamilyLifecycleEpisodeKey(transition.id)
          })
        })
      ])
    } finally {
      fixture.cleanup()
    }
  })

  it('applies a paid same-cadence Personal-to-Family update to the existing item', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('transition-upgrade@example.test', 'Upgrade Owner')
    const source = seedActiveSubscription(fixture, owner, 'personal', 'monthly')
    let transitionWasReserved = false
    const provider = transitionProvider(source, {
      onRetrieve() {
        const row = transitionRow(fixture)
        transitionWasReserved = Boolean(row?.idempotency_key)
      }
    })

    try {
      const state = await changeBillingOfferingForConnection(
        billingContext(fixture, provider.client),
        owner.user.id,
        { offering: 'family.monthly' },
        commandNow
      )

      expect(transitionWasReserved).toBe(true)
      expect(provider.subscriptionUpdate).toHaveBeenCalledWith(
        source.stripeSubscriptionId,
        {
          items: [
            {
              id: source.stripeSubscriptionItemId,
              price: stripeConfig.familyMonthlyPriceId,
              quantity: 1
            }
          ],
          payment_behavior: 'pending_if_incomplete',
          proration_behavior: 'always_invoice',
          expand: ['latest_invoice']
        },
        { idempotencyKey: expect.stringMatching(/^billing_change_/) }
      )
      expect(provider.subscriptionRetrieve.mock.calls).toEqual([
        [source.stripeSubscriptionId, { expand: ['latest_invoice'] }],
        [source.stripeSubscriptionId, { expand: ['latest_invoice'] }],
        [source.stripeSubscriptionId]
      ])
      expect(state).toMatchObject({
        entitlement: { granted: true, source: 'manager', state: 'active', plan: 'family', cadence: 'monthly' },
        subscription: { state: 'active', plan: 'family', cadence: 'monthly' },
        transition: null
      })
      expect(transitionRow(fixture)).toMatchObject({ state: 'applied' })
      expect(subscriptionRow(fixture)).toMatchObject({
        stripe_subscription_id: source.stripeSubscriptionId,
        stripe_subscription_item_id: source.stripeSubscriptionItemId,
        plan_key: 'family',
        cadence: 'monthly',
        stripe_price_id: stripeConfig.familyMonthlyPriceId,
        status: 'active'
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('resets the billing anchor only when an immediate upgrade changes cadence', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('transition-anchor@example.test', 'Anchor Owner')
    const source = seedActiveSubscription(fixture, owner, 'personal', 'weekly')
    const provider = transitionProvider(source)

    try {
      await changeBillingOfferingForConnection(
        billingContext(fixture, provider.client),
        owner.user.id,
        { offering: 'family.annual' },
        commandNow
      )

      expect(provider.subscriptionUpdate.mock.calls[0]?.[1]).toMatchObject({
        billing_cycle_anchor: 'now',
        items: [
          {
            id: source.stripeSubscriptionItemId,
            price: stripeConfig.familyAnnualPriceId,
            quantity: 1
          }
        ],
        payment_behavior: 'pending_if_incomplete',
        proration_behavior: 'always_invoice'
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('keeps Personal entitlement and stores only private correlation when payment needs action', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('transition-action@example.test', 'Action Owner')
    const source = seedActiveSubscription(fixture, owner, 'personal', 'monthly')
    const provider = transitionProvider(source, { updateOutcome: 'pending' })

    try {
      const state = await changeBillingOfferingForConnection(
        billingContext(fixture, provider.client),
        owner.user.id,
        { offering: 'family.monthly' },
        commandNow
      )
      const serialized = JSON.stringify(state)

      expect(state).toMatchObject({
        entitlement: { granted: true, source: 'personal', state: 'active', plan: 'personal', cadence: 'monthly' },
        subscription: { state: 'active', plan: 'personal', cadence: 'monthly' },
        transition: {
          kind: 'personal_to_family',
          targetOffering: 'family.monthly',
          effectiveAt: null,
          state: 'action_required'
        },
        capabilities: { canChange: false, canManage: true }
      })
      expect(transitionRow(fixture)).toMatchObject({
        state: 'action_required',
        state_reason: 'payment_resolution_required',
        stripe_pending_invoice_id: 'in_transition_update',
        stripe_pending_update_expires_at: '2026-07-16T11:00:00.000Z'
      })
      expect(serialized).not.toContain('in_transition_update')
      expect(serialized).not.toContain('pi_secret')
      expect(serialized).not.toContain('hosted_invoice_url')
      expect(provider.subscriptionList).not.toHaveBeenCalled()
      const transition = transitionRow(fixture)!
      expect(jobRows(fixture, billingTransitionConvergenceJobType)).toEqual([
        expect.objectContaining({
          payload: JSON.stringify({ transitionId: transition.id }),
          run_after: '2026-07-16T11:00:00.000Z'
        })
      ])
      expect(jobRows(fixture, billingFamilyLifecycleSignalJobType)).toEqual([
        expect.objectContaining({
          payload: JSON.stringify({
            action: 'payment_attention',
            billingSubscriptionId: transition.billing_subscription_id,
            billingTransitionId: transition.id,
            episodeKey: hashBillingFamilyLifecycleEpisodeKey(transition.id)
          })
        })
      ])
    } finally {
      fixture.cleanup()
    }
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
      const fixture = createWorkspaceInvitationFixture()
      const owner = await fixture.signIn(
        `transition-foreign-${sourceMutation.schedule ? 'schedule' : 'pending'}@example.test`,
        'Foreign State'
      )
      const source = seedActiveSubscription(fixture, owner, 'personal', 'monthly')
      const provider = transitionProvider(source, { sourceMutation })

      try {
        await expect(
          changeBillingOfferingForConnection(
            billingContext(fixture, provider.client),
            owner.user.id,
            { offering: 'family.monthly' },
            commandNow
          )
        ).rejects.toMatchObject({ statusCode: 409 })
        expect(provider.subscriptionUpdate).not.toHaveBeenCalled()
        expect(provider.scheduleCreate).not.toHaveBeenCalled()
        expect(transitionRow(fixture)).toMatchObject({
          state: 'reconciliation_required',
          state_reason: 'source_subscription_diverged'
        })
        expect(getBillingStateForConnection(fixture.connection, owner.user.id).entitlement).toMatchObject({
          granted: false,
          source: null,
          state: 'reconciliation_required'
        })
      } finally {
        fixture.cleanup()
      }
    }
  })

  it('fails closed when Stripe returns a schedule with a different target duration', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('transition-schedule-duration@example.test', 'Schedule Duration')
    const source = seedActiveSubscription(fixture, owner, 'personal', 'monthly')
    const provider = transitionProvider(source, { scheduleTargetEndOffsetSeconds: 1 })

    try {
      await expect(
        changeBillingOfferingForConnection(
          billingContext(fixture, provider.client),
          owner.user.id,
          { offering: 'personal.annual' },
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
        stripe_price_id: stripeConfig.personalMonthlyPriceId
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('does not grant the target when the independent current read still shows the source', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('transition-stale-current@example.test', 'Stale Current')
    const source = seedActiveSubscription(fixture, owner, 'personal', 'monthly')
    const provider = transitionProvider(source, { postUpdateRetrieveKeepsSource: true })

    try {
      await expect(
        changeBillingOfferingForConnection(
          billingContext(fixture, provider.client),
          owner.user.id,
          { offering: 'family.monthly' },
          commandNow
        )
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(subscriptionRow(fixture)).toMatchObject({
        plan_key: 'personal',
        cadence: 'monthly',
        stripe_price_id: stripeConfig.personalMonthlyPriceId
      })
      expect(transitionRow(fixture)).toMatchObject({
        state: 'reconciliation_required',
        state_reason: 'current_subscription_diverged'
      })
      expect(getBillingStateForConnection(fixture.connection, owner.user.id).entitlement).toMatchObject({
        granted: false,
        source: null,
        state: 'reconciliation_required'
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('does not grant the target when a second nonterminal subscription is discovered', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('transition-ambiguous-live@example.test', 'Ambiguous Live')
    const source = seedActiveSubscription(fixture, owner, 'personal', 'monthly')
    const provider = transitionProvider(source, { additionalLiveStatuses: ['trialing'] })

    try {
      await expect(
        changeBillingOfferingForConnection(
          billingContext(fixture, provider.client),
          owner.user.id,
          { offering: 'family.monthly' },
          commandNow
        )
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(transitionRow(fixture)).toMatchObject({
        state: 'reconciliation_required',
        state_reason: 'current_subscription_diverged'
      })
      expect(subscriptionRow(fixture)).toMatchObject({
        plan_key: 'personal',
        cadence: 'monthly'
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('rechecks the captured local revision after provider reads', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('transition-revision-race@example.test', 'Revision Race')
    const source = seedActiveSubscription(fixture, owner, 'personal', 'monthly')
    const provider = transitionProvider(source, {
      onRetrieve() {
        fixture.sqlite
          .prepare('update billing_subscriptions set revision = revision + 1 where organization_id = ?')
          .run(owner.workspace.id)
      }
    })

    try {
      await expect(
        changeBillingOfferingForConnection(
          billingContext(fixture, provider.client),
          owner.user.id,
          { offering: 'family.monthly' },
          commandNow
        )
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(provider.subscriptionUpdate).not.toHaveBeenCalled()
      expect(transitionRow(fixture)).toMatchObject({
        state: 'reconciliation_required',
        state_reason: 'local_transition_authority_changed'
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('makes an indeterminate provider call durable reconciliation under the persisted key', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('transition-provider-failure@example.test', 'Provider Failure')
    const source = seedActiveSubscription(fixture, owner, 'personal', 'monthly')
    const provider = transitionProvider(source, { retrieveFailure: true })

    try {
      await expect(
        changeBillingOfferingForConnection(
          billingContext(fixture, provider.client),
          owner.user.id,
          { offering: 'family.monthly' },
          commandNow
        )
      ).rejects.toMatchObject({ statusCode: 502 })
      expect(transitionRow(fixture)).toMatchObject({
        idempotency_key: expect.stringMatching(/^billing_change_/),
        state: 'reconciliation_required',
        state_reason: 'provider_transition_indeterminate'
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('rejects same offering and inactive authority before Stripe mutation', async () => {
    const sameFixture = createWorkspaceInvitationFixture()
    const sameOwner = await sameFixture.signIn('transition-same@example.test', 'Same Offering')
    const sameSource = seedActiveSubscription(sameFixture, sameOwner, 'personal', 'monthly')
    const sameProvider = transitionProvider(sameSource)

    try {
      await expect(
        changeBillingOfferingForConnection(
          billingContext(sameFixture, sameProvider.client),
          sameOwner.user.id,
          { offering: 'personal.monthly' },
          commandNow
        )
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(sameProvider.subscriptionRetrieve).not.toHaveBeenCalled()
    } finally {
      sameFixture.cleanup()
    }

    const inactiveFixture = createWorkspaceInvitationFixture()
    const inactiveOwner = await inactiveFixture.signIn('transition-inactive@example.test', 'Inactive')
    const inactiveSource = seedActiveSubscription(inactiveFixture, inactiveOwner, 'personal', 'monthly')
    inactiveFixture.sqlite
      .prepare("update billing_subscriptions set status = 'past_due' where organization_id = ?")
      .run(inactiveOwner.workspace.id)
    const inactiveProvider = transitionProvider(inactiveSource)

    try {
      await expect(
        changeBillingOfferingForConnection(
          billingContext(inactiveFixture, inactiveProvider.client),
          inactiveOwner.user.id,
          { offering: 'family.monthly' },
          commandNow
        )
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(inactiveProvider.subscriptionRetrieve).not.toHaveBeenCalled()
    } finally {
      inactiveFixture.cleanup()
    }
  })

  it('rejects a new transition before Stripe I/O once account deletion is fenced', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('transition-deletion-fence@example.test', 'Deletion Fence')
    const source = seedActiveSubscription(fixture, owner, 'personal', 'monthly')
    const provider = transitionProvider(source)
    fixture.sqlite.prepare('update organization set billing_deletion_pending = 1 where id = ?').run(owner.workspace.id)

    try {
      await expect(
        changeBillingOfferingForConnection(
          billingContext(fixture, provider.client),
          owner.user.id,
          { offering: 'family.monthly' },
          commandNow
        )
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(provider.subscriptionRetrieve).not.toHaveBeenCalled()
      expect(transitionRow(fixture)).toBeUndefined()
    } finally {
      fixture.cleanup()
    }
  })
})

function billingContext(fixture: WorkspaceInvitationFixture, client: StripeBillingClient): BillingServiceContext {
  return {
    connection: fixture.connection,
    client,
    config: {
      modules: { billing: { enabled: true } },
      public: { appUrl: 'https://app.example.test' },
      stripe: stripeConfig
    } as unknown as AppRuntimeConfig
  }
}

type LocalSource = Readonly<{
  plan: BillingPlan
  cadence: BillingCadence
  stripeCustomerId: string
  stripeSubscriptionId: string
  stripeSubscriptionItemId: string
  stripePriceId: string
  currentPeriodStart: string
  currentPeriodEnd: string
}>

function seedActiveSubscription(
  fixture: WorkspaceInvitationFixture,
  owner: SignedInFixtureUser,
  plan: BillingPlan,
  cadence: BillingCadence
): LocalSource {
  const suffix = owner.user.email.split('@')[0]
  const customerId = `billing_customer_${suffix}`
  const stripeCustomerId = `cus_${suffix}`
  const stripeSubscriptionId = `sub_${suffix}`
  const stripeSubscriptionItemId = `si_${suffix}`
  const stripePriceId = priceId(plan, cadence)
  const currentPeriodStart = '2026-07-01T00:00:00.000Z'
  const currentPeriodEnd = cadence === 'annual' ? '2027-07-01T00:00:00.000Z' : '2026-08-01T00:00:00.000Z'
  const now = commandNow.toISOString()
  fixture.sqlite
    .prepare(
      `insert into billing_customers (id, organization_id, stripe_customer_id, created_at, updated_at)
       values (?, ?, ?, ?, ?)`
    )
    .run(customerId, owner.workspace.id, stripeCustomerId, now, now)
  fixture.sqlite
    .prepare(
      `insert into billing_subscriptions (
         id, organization_id, billing_customer_id, stripe_subscription_id, stripe_subscription_item_id,
         status, plan_key, cadence, stripe_price_id, current_period_start, current_period_end,
         projection_order_ms, reconciliation_required, reconciliation_reason, revision, created_at, updated_at
       ) values (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, 1, 0, null, 0, ?, ?)`
    )
    .run(
      `billing_subscription_${suffix}`,
      owner.workspace.id,
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
    plan,
    cadence,
    stripeCustomerId,
    stripeSubscriptionId,
    stripeSubscriptionItemId,
    stripePriceId,
    currentPeriodStart,
    currentPeriodEnd
  }
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

const priceByOffering = {
  'personal.weekly': stripeConfig.personalWeeklyPriceId,
  'personal.monthly': stripeConfig.personalMonthlyPriceId,
  'personal.annual': stripeConfig.personalAnnualPriceId,
  'family.monthly': stripeConfig.familyMonthlyPriceId,
  'family.annual': stripeConfig.familyAnnualPriceId
} as const

function transitionRow(fixture: WorkspaceInvitationFixture) {
  return fixture.sqlite.prepare('select * from billing_subscription_transitions order by rowid desc limit 1').get() as
    Record<string, unknown> | undefined
}

function subscriptionRow(fixture: WorkspaceInvitationFixture) {
  return fixture.sqlite.prepare('select * from billing_subscriptions order by rowid desc limit 1').get() as Record<
    string,
    unknown
  >
}

function jobRows(fixture: WorkspaceInvitationFixture, type: string) {
  return fixture.sqlite
    .prepare('select type, payload, run_after from job_queue where type = ? order by id')
    .all(type) as Array<Record<string, unknown>>
}

function epoch(value: string): number {
  return Math.floor(Date.parse(value) / 1_000)
}
