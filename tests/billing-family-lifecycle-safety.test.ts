import { afterEach, describe, expect, it } from 'vitest'
import type { TransactionalEmailMessage } from '../server/services/email'
import { createBillingFamilyLifecycleSignalJobHandler } from '../server/services/payments/billing-family-lifecycle'
import { ensureBillingFamilyLifecycleJobs } from '../server/services/payments/billing-family-lifecycle-safety'
import {
  billingFamilyLifecycleSignalJobType,
  billingFamilyLifecycleSignalMaxAttempts,
  enqueueBillingFamilyLifecycleSignal,
  hashBillingFamilyLifecycleEpisodeKey
} from '../server/services/payments/billing-family-lifecycle-signal'
import {
  billingNotificationDeliveryJobType,
  createBillingNotificationDeliveryHandler
} from '../server/services/payments/billing-notification-delivery'
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

describe('billing Family lifecycle safety scan', () => {
  it('regenerates an exhausted applied-downgrade dissolution while members remain', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('lifecycle-applied-manager@example.test', 'Applied Manager')
    const relative = await fixture.signIn('lifecycle-applied-relative@example.test', 'Applied Relative')
    const now = new Date()
    const billing = seedVerifiedBilling(fixture, manager, {
      plan: 'family',
      currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000)
    })
    addExternalMember(fixture, manager, relative, 'lifecycle-applied-member')
    const transitionId = 'lifecycle-applied-transition'
    seedFamilyToPersonalTransition(fixture, manager, billing.subscriptionId, {
      effectiveAt: new Date(now.getTime() - 60_000),
      id: transitionId,
      state: 'applied'
    })
    fixture.sqlite
      .prepare(
        `update billing_subscriptions
         set plan_key = 'personal', cadence = 'monthly',
             stripe_price_id = 'price_personal_monthly',
             revision = revision + 1
         where id = ?`
      )
      .run(billing.subscriptionId)
    enqueueBillingFamilyLifecycleSignal(fixture.connection, {
      action: 'coverage_ended',
      billingSubscriptionId: billing.subscriptionId,
      billingTransitionId: transitionId,
      episodeKey: transitionId
    })
    exhaustLatestLifecycleJob(fixture)

    expect(ensureBillingFamilyLifecycleJobs(fixture.connection, now)).toBe(1)
    expect(ensureBillingFamilyLifecycleJobs(fixture.connection, now)).toBe(0)
    expect(lifecycleJobs(fixture)).toEqual([
      expect.objectContaining({
        attempts: billingFamilyLifecycleSignalMaxAttempts,
        status: 'failed'
      }),
      expect.objectContaining({
        attempts: 0,
        payload: JSON.stringify({
          action: 'coverage_ended',
          billingSubscriptionId: billing.subscriptionId,
          billingTransitionId: transitionId,
          episodeKey: hashBillingFamilyLifecycleEpisodeKey(transitionId)
        }),
        status: 'queued'
      })
    ])

    const messages: TransactionalEmailMessage[] = []
    const handler = lifecycleHandler(fixture, messages, now)
    await handler(JSON.parse(lifecycleJobs(fixture)[1]!.payload))
    const notificationHandler = createBillingNotificationDeliveryHandler({
      appName: fixture.config.public.appName,
      connection: fixture.connection,
      sender: {
        async send(message) {
          messages.push(message)
        }
      }
    })
    await notificationHandler(JSON.parse(notificationJobs(fixture)[0]!.payload))
    expect(fixture.sqlite.prepare("select 1 from member where id = 'lifecycle-applied-member'").get()).toBeUndefined()
    expect(messages).toEqual([
      expect.objectContaining({
        subject: 'Your Family membership ended',
        to: relative.user.email
      })
    ])
  })

  it('regenerates an exhausted terminal Family dissolution from the persisted provider episode', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('lifecycle-terminal-manager@example.test', 'Terminal Manager')
    const relative = await fixture.signIn('lifecycle-terminal-relative@example.test', 'Terminal Relative')
    const now = new Date()
    const billing = seedVerifiedBilling(fixture, manager, { plan: 'family' })
    addExternalMember(fixture, manager, relative, 'lifecycle-terminal-member')
    fixture.sqlite
      .prepare(
        `update billing_subscriptions
         set status = 'canceled', projection_event_id = 'evt_terminal_family'
         where id = ?`
      )
      .run(billing.subscriptionId)
    enqueueBillingFamilyLifecycleSignal(fixture.connection, {
      action: 'coverage_ended',
      billingSubscriptionId: billing.subscriptionId,
      billingTransitionId: null,
      episodeKey: 'evt_terminal_family'
    })
    exhaustLatestLifecycleJob(fixture)

    expect(ensureBillingFamilyLifecycleJobs(fixture.connection, now)).toBe(1)
    const recovered = lifecycleJobs(fixture)[1]!
    expect(recovered).toMatchObject({
      payload: JSON.stringify({
        action: 'coverage_ended',
        billingSubscriptionId: billing.subscriptionId,
        billingTransitionId: null,
        episodeKey: hashBillingFamilyLifecycleEpisodeKey('evt_terminal_family')
      }),
      status: 'queued'
    })

    await lifecycleHandler(fixture, [], now)(JSON.parse(recovered.payload))
    expect(fixture.sqlite.prepare("select 1 from member where id = 'lifecycle-terminal-member'").get()).toBeUndefined()
  })

  it('regenerates exact renewal notices for scheduled downgrades and cancellation edges', async () => {
    for (const source of ['transition', 'cancellation'] as const) {
      fixture = createWorkspaceInvitationFixture()
      const manager = await fixture.signIn(`lifecycle-renewal-${source}@example.test`, `Renewal ${source}`)
      const relative = await fixture.signIn(
        `lifecycle-renewal-${source}-relative@example.test`,
        `Renewal ${source} Relative`
      )
      const now = new Date()
      const effectiveAt = new Date(Math.floor((now.getTime() + 24 * 60 * 60 * 1_000) / 1_000) * 1_000)
      const billing = seedVerifiedBilling(fixture, manager, {
        cancelAtPeriodEnd: source === 'cancellation',
        currentPeriodEnd: effectiveAt,
        plan: 'family'
      })
      addExternalMember(fixture, manager, relative, `lifecycle-renewal-${source}-member`)
      const transitionId = source === 'transition' ? 'lifecycle-renewal-transition' : null
      const episodeKey = transitionId ?? 'evt_family_cancellation'
      if (transitionId) {
        seedFamilyToPersonalTransition(fixture, manager, billing.subscriptionId, {
          effectiveAt,
          id: transitionId,
          state: 'scheduled'
        })
      } else {
        fixture.sqlite
          .prepare('update billing_subscriptions set projection_event_id = ? where id = ?')
          .run(episodeKey, billing.subscriptionId)
      }
      enqueueBillingFamilyLifecycleSignal(fixture.connection, {
        action: 'renewal_ending',
        billingSubscriptionId: billing.subscriptionId,
        billingTransitionId: transitionId,
        episodeKey
      })
      exhaustLatestLifecycleJob(fixture)

      expect(ensureBillingFamilyLifecycleJobs(fixture.connection, now)).toBe(1)
      expect(lifecycleJobs(fixture)[1]).toMatchObject({
        payload: JSON.stringify({
          action: 'renewal_ending',
          billingSubscriptionId: billing.subscriptionId,
          billingTransitionId: transitionId,
          episodeKey: hashBillingFamilyLifecycleEpisodeKey(episodeKey)
        }),
        status: 'queued'
      })
      fixture.cleanup()
      fixture = undefined
    }
  })

  it('does not invent lifecycle episodes when no affected member or reservation remains', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('lifecycle-empty@example.test', 'Lifecycle Empty')
    const billing = seedVerifiedBilling(fixture, manager, { plan: 'family' })
    fixture.sqlite
      .prepare(
        `update billing_subscriptions
         set status = 'canceled', projection_event_id = 'evt_empty_terminal'
         where id = ?`
      )
      .run(billing.subscriptionId)

    expect(ensureBillingFamilyLifecycleJobs(fixture.connection, new Date())).toBe(0)
    expect(lifecycleJobs(fixture)).toEqual([])
  })

  it('persists only a one-way digest of a provider episode key', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('lifecycle-private@example.test', 'Lifecycle Private')
    const billing = seedVerifiedBilling(fixture, manager, { plan: 'personal' })
    const providerInvoiceId = 'in_provider_secret_episode'

    enqueueBillingFamilyLifecycleSignal(fixture.connection, {
      action: 'payment_attention',
      billingSubscriptionId: billing.subscriptionId,
      billingTransitionId: null,
      episodeKey: providerInvoiceId
    })

    const job = lifecycleJobs(fixture)[0]!
    expect(job.payload).not.toContain(providerInvoiceId)
    expect(JSON.parse(job.payload)).toMatchObject({
      action: 'payment_attention',
      episodeKey: hashBillingFamilyLifecycleEpisodeKey(providerInvoiceId)
    })
  })

  it('regenerates exhausted attention and grace signals while their payment episodes remain active', async () => {
    for (const episode of ['attention', 'grace'] as const) {
      fixture = createWorkspaceInvitationFixture()
      const manager = await fixture.signIn(`lifecycle-${episode}@example.test`, `Lifecycle ${episode}`)
      const now = new Date()
      const billing = seedVerifiedBilling(fixture, manager, { plan: 'personal' })
      const providerEpisodeId = `in_active_${episode}`
      const projectionEventId = `evt_active_${episode}`
      fixture.sqlite
        .prepare(
          `update billing_subscriptions
           set status = 'past_due',
               projection_event_id = ?,
               grace_invoice_id = ?,
               grace_started_at = ?,
               grace_ends_at = ?
           where id = ?`
        )
        .run(
          projectionEventId,
          episode === 'grace' ? providerEpisodeId : null,
          episode === 'grace' ? new Date(now.getTime() - 60_000).toISOString() : null,
          episode === 'grace' ? new Date(now.getTime() + 14 * 24 * 60 * 60 * 1_000 - 60_000).toISOString() : null,
          billing.subscriptionId
        )
      enqueueBillingFamilyLifecycleSignal(fixture.connection, {
        action: episode === 'grace' ? 'payment_grace_started' : 'payment_attention',
        billingSubscriptionId: billing.subscriptionId,
        billingTransitionId: null,
        episodeKey: providerEpisodeId
      })
      exhaustLatestLifecycleJob(fixture)

      expect(ensureBillingFamilyLifecycleJobs(fixture.connection, now)).toBe(1)
      expect(lifecycleJobs(fixture)[1]).toMatchObject({
        attempts: 0,
        status: 'queued'
      })
      const recovered = JSON.parse(lifecycleJobs(fixture)[1]!.payload) as {
        action: string
        episodeKey: string
      }
      expect(recovered).toMatchObject({
        action: episode === 'grace' ? 'payment_grace_started' : 'payment_attention',
        episodeKey: hashBillingFamilyLifecycleEpisodeKey(episode === 'grace' ? providerEpisodeId : projectionEventId)
      })
      expect(lifecycleJobs(fixture)[1]!.payload).not.toContain(
        episode === 'grace' ? providerEpisodeId : projectionEventId
      )
      expect(ensureBillingFamilyLifecycleJobs(fixture.connection, now)).toBe(0)
      await lifecycleHandler(fixture, [], now)(JSON.parse(lifecycleJobs(fixture)[1]!.payload))
      expect(notificationJobs(fixture)).toHaveLength(1)
      fixture.cleanup()
      fixture = undefined
    }
  })

  it('regenerates an exhausted action-required transition attention signal', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('lifecycle-action-required@example.test', 'Lifecycle Action Required')
    const now = new Date()
    const billing = seedVerifiedBilling(fixture, manager, { plan: 'personal' })
    const transitionId = 'lifecycle-action-required-transition'
    const revision = fixture.sqlite
      .prepare('select revision from billing_subscriptions where id = ?')
      .pluck()
      .get(billing.subscriptionId) as number
    fixture.sqlite
      .prepare(
        `insert into billing_subscription_transitions (
           id, organization_id, billing_subscription_id, kind,
           source_plan_key, source_cadence, target_plan_key, target_cadence,
           effective_at, idempotency_key, stripe_pending_invoice_id,
           stripe_pending_update_expires_at, captured_billing_revision, state
         ) values (?, ?, ?, 'personal_to_family', 'personal', 'monthly',
                   'family', 'monthly', ?, ?, 'in_action_required_private', ?, ?, 'action_required')`
      )
      .run(
        transitionId,
        manager.workspace.id,
        billing.subscriptionId,
        now.toISOString(),
        `idempotency-${transitionId}`,
        new Date(now.getTime() + 60 * 60 * 1_000).toISOString(),
        revision
      )
    enqueueBillingFamilyLifecycleSignal(fixture.connection, {
      action: 'payment_attention',
      billingSubscriptionId: billing.subscriptionId,
      billingTransitionId: transitionId,
      episodeKey: transitionId
    })
    exhaustLatestLifecycleJob(fixture)

    expect(ensureBillingFamilyLifecycleJobs(fixture.connection, now)).toBe(1)
    expect(JSON.parse(lifecycleJobs(fixture)[1]!.payload)).toEqual({
      action: 'payment_attention',
      billingSubscriptionId: billing.subscriptionId,
      billingTransitionId: transitionId,
      episodeKey: hashBillingFamilyLifecycleEpisodeKey(transitionId)
    })
    expect(lifecycleJobs(fixture)[1]!.payload).not.toContain('in_action_required_private')
    expect(ensureBillingFamilyLifecycleJobs(fixture.connection, now)).toBe(0)
  })
})

function addExternalMember(
  activeFixture: WorkspaceInvitationFixture,
  manager: SignedInFixtureUser,
  relative: SignedInFixtureUser,
  id: string
): void {
  activeFixture.sqlite
    .prepare(
      `insert into member (id, organization_id, user_id, role, created_at)
       values (?, ?, ?, 'member', ?)`
    )
    .run(id, manager.workspace.id, relative.user.id, Date.now())
}

function seedFamilyToPersonalTransition(
  activeFixture: WorkspaceInvitationFixture,
  manager: SignedInFixtureUser,
  billingSubscriptionId: string,
  input: Readonly<{
    effectiveAt: Date
    id: string
    state: 'scheduled' | 'applied'
  }>
): void {
  const subscription = activeFixture.sqlite
    .prepare('select revision from billing_subscriptions where id = ?')
    .get(billingSubscriptionId) as { revision: number }
  activeFixture.sqlite
    .prepare(
      `insert into billing_subscription_transitions (
         id, organization_id, billing_subscription_id, kind,
         source_plan_key, source_cadence, target_plan_key, target_cadence,
         effective_at, idempotency_key, captured_billing_revision, state
       ) values (?, ?, ?, 'family_to_personal', 'family', 'monthly',
                 'personal', 'monthly', ?, ?, ?, ?)`
    )
    .run(
      input.id,
      manager.workspace.id,
      billingSubscriptionId,
      input.effectiveAt.toISOString(),
      `idempotency-${input.id}`,
      subscription.revision,
      input.state
    )
}

function exhaustLatestLifecycleJob(activeFixture: WorkspaceInvitationFixture): void {
  activeFixture.sqlite
    .prepare(
      `update job_queue
       set status = 'failed', attempts = max_attempts
       where id = (
         select id from job_queue
         where type = ?
         order by id desc
         limit 1
       )`
    )
    .run(billingFamilyLifecycleSignalJobType)
}

function lifecycleHandler(
  activeFixture: WorkspaceInvitationFixture,
  _messages: TransactionalEmailMessage[],
  now: Date
) {
  return createBillingFamilyLifecycleSignalJobHandler({
    connection: activeFixture.connection,
    now: () => now
  })
}

function lifecycleJobs(activeFixture: WorkspaceInvitationFixture) {
  return activeFixture.sqlite
    .prepare(
      `select status, attempts, payload
       from job_queue
       where type = ?
       order by id`
    )
    .all(billingFamilyLifecycleSignalJobType) as Array<{
    attempts: number
    payload: string
    status: string
  }>
}

function notificationJobs(activeFixture: WorkspaceInvitationFixture) {
  return activeFixture.sqlite
    .prepare('select payload from job_queue where type = ? order by id')
    .all(billingNotificationDeliveryJobType) as Array<{ payload: string }>
}
