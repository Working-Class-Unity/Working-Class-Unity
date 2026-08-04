import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  billingSubscriptions,
  billingSubscriptionTransitions,
  invitation,
  member,
  organization,
  projects,
  session,
  user
} from '../server/db/schema'
import type { TransactionalEmailMessage, TransactionalEmailSender } from '../server/services/email'
import { createBillingFamilyLifecycleSignalJobHandler } from '../server/services/payments/billing-family-lifecycle'
import { hashBillingFamilyLifecycleEpisodeKey } from '../server/services/payments/billing-family-lifecycle-signal'
import {
  billingNotificationDeliveryJobType,
  createBillingNotificationDeliveryHandler
} from '../server/services/payments/billing-notification-delivery'
import type { CaptureDiagnosticCode } from '../server/services/observability/capture'
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

describe('billing Family lifecycle signal handler', () => {
  it('cancels reservations and notifies accepted members once when Family access is scheduled to end', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('ending-manager@example.test', 'Ending Manager')
    const relative = await fixture.signIn('ending-relative@example.test', 'Ending Relative')
    const billing = seedVerifiedBilling(fixture, manager, {
      plan: 'family',
      currentPeriodEnd: new Date(Date.now() + 60 * 60 * 1_000)
    })
    addExternalFamilyMember(fixture, manager, relative, 'ending-member')
    addPendingInvitation(fixture, manager, 'ending-invitation', 'pending-relative@example.test')
    addFamilyToPersonalTransition(fixture, manager, billing.subscriptionId, {
      effectiveAt: billing.currentPeriodEnd,
      id: 'ending-transition',
      state: 'scheduled'
    })
    const messages: TransactionalEmailMessage[] = []
    const handler = createBillingFamilyLifecycleSignalJobHandler(
      lifecycleContext(fixture, new Date(Date.now() + 1_000))
    )
    const payload = {
      action: 'renewal_ending',
      billingSubscriptionId: billing.subscriptionId,
      billingTransitionId: 'ending-transition',
      episodeKey: hashBillingFamilyLifecycleEpisodeKey('ending-transition')
    } as const

    await handler(payload)
    await handler(payload)
    await deliverQueuedNotifications(fixture, messages)

    expect(invitationStatus(fixture, 'ending-invitation')).toBe('canceled')
    expect(fixture.connection.db.select().from(member).where(eq(member.id, 'ending-member')).get()).toBeTruthy()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      subject: 'Family access is scheduled to end',
      to: relative.user.email
    })
    expect(messages[0]!.text).toContain('scheduled to end on')
    expect(messages[0]!.text).toContain('UTC')
    expect(messageBody(messages[0]!)).not.toMatch(
      /ending-manager|ending-transition|billing_subscription|(?:sub|cus|price)_[a-z0-9_]+/i
    )
  })

  it('rechecks transition authority and leaves Family state untouched when a queued signal is stale', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('stale-manager@example.test', 'Stale Manager')
    const relative = await fixture.signIn('stale-relative@example.test', 'Stale Relative')
    const billing = seedVerifiedBilling(fixture, manager, { plan: 'family' })
    addExternalFamilyMember(fixture, manager, relative, 'stale-member')
    addPendingInvitation(fixture, manager, 'stale-invitation', 'pending-stale@example.test')
    addFamilyToPersonalTransition(fixture, manager, billing.subscriptionId, {
      effectiveAt: billing.currentPeriodEnd,
      id: 'stale-transition',
      state: 'canceled'
    })
    const messages: TransactionalEmailMessage[] = []
    const handler = createBillingFamilyLifecycleSignalJobHandler(lifecycleContext(fixture))

    await handler({
      action: 'renewal_ending',
      billingSubscriptionId: billing.subscriptionId,
      billingTransitionId: 'stale-transition',
      episodeKey: hashBillingFamilyLifecycleEpisodeKey('stale-transition')
    })
    await deliverQueuedNotifications(fixture, messages)

    expect(invitationStatus(fixture, 'stale-invitation')).toBe('pending')
    expect(fixture.connection.db.select().from(member).where(eq(member.id, 'stale-member')).get()).toBeTruthy()
    expect(messages).toHaveLength(0)
  })

  it('atomically dissolves only external memberships at an effective downgrade and restores residual Personal state', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('dissolve-manager@example.test', 'Dissolve Manager')
    const relative = await fixture.signIn('dissolve-relative@example.test', 'Dissolve Relative')
    const effectiveAt = new Date(Date.now() - 60_000)
    const billing = seedVerifiedBilling(fixture, manager, {
      plan: 'family',
      currentPeriodEnd: effectiveAt
    })
    const residual = seedVerifiedBilling(fixture, relative, {
      cancelAtPeriodEnd: true,
      plan: 'personal',
      currentPeriodEnd: new Date(Date.now() + 10 * 24 * 60 * 60 * 1_000)
    })
    addPersonalSubscriberExternalMember(fixture, manager, relative, {
      billingSubscriptionId: residual.subscriptionId,
      currentPeriodEnd: residual.currentPeriodEnd,
      memberId: 'dissolve-member'
    })
    addPendingInvitation(fixture, manager, 'dissolve-invitation', 'pending-dissolve@example.test')
    addFamilyToPersonalTransition(fixture, manager, billing.subscriptionId, {
      effectiveAt: effectiveAt.toISOString(),
      id: 'dissolve-transition',
      state: 'scheduled'
    })
    fixture.connection.db
      .insert(projects)
      .values({ id: 'dissolve-private-project', name: 'Private data', ownerUserId: relative.user.id })
      .run()
    fixture.connection.db
      .update(session)
      .set({ activeOrganizationId: manager.workspace.id })
      .where(eq(session.userId, relative.user.id))
      .run()
    fixture.connection.db
      .update(billingSubscriptions)
      .set({
        cancelAtPeriodEnd: false,
        cadence: 'monthly',
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString(),
        planKey: 'personal',
        stripePriceId: 'price_personal_monthly',
        status: 'active'
      })
      .where(eq(billingSubscriptions.id, billing.subscriptionId))
      .run()
    const residualBefore = fixture.connection.db
      .select()
      .from(billingSubscriptions)
      .where(eq(billingSubscriptions.id, residual.subscriptionId))
      .get()
    const messages: TransactionalEmailMessage[] = []
    const handler = createBillingFamilyLifecycleSignalJobHandler(
      lifecycleContext(fixture, new Date(Date.now() + 1_000))
    )
    const payload = {
      action: 'coverage_ended',
      billingSubscriptionId: billing.subscriptionId,
      billingTransitionId: 'dissolve-transition',
      episodeKey: hashBillingFamilyLifecycleEpisodeKey('dissolve-transition')
    } as const

    await handler(payload)
    await handler(payload)
    await deliverQueuedNotifications(fixture, messages)

    expect(invitationStatus(fixture, 'dissolve-invitation')).toBe('canceled')
    expect(fixture.connection.db.select().from(member).where(eq(member.id, 'dissolve-member')).get()).toBeUndefined()
    expect(
      fixture.connection.db
        .select({ role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, manager.workspace.id), eq(member.userId, manager.user.id)))
        .get()
    ).toEqual({ role: 'owner' })
    expect(
      fixture.connection.db
        .select({ role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, relative.workspace.id), eq(member.userId, relative.user.id)))
        .get()
    ).toEqual({ role: 'owner' })
    expect(
      fixture.connection.db
        .select({ activeOrganizationId: session.activeOrganizationId })
        .from(session)
        .where(eq(session.userId, relative.user.id))
        .all()
    ).toSatisfy(
      (rows: Array<{ activeOrganizationId: string | null }>) =>
        rows.length > 0 && rows.every((row) => row.activeOrganizationId === null)
    )
    expect(fixture.connection.db.select().from(user).where(eq(user.id, relative.user.id)).get()).toBeTruthy()
    expect(
      fixture.connection.db.select().from(organization).where(eq(organization.id, relative.workspace.id)).get()
    ).toBeTruthy()
    expect(
      fixture.connection.db.select().from(projects).where(eq(projects.id, 'dissolve-private-project')).get()
    ).toBeTruthy()
    expect(
      fixture.connection.db
        .select()
        .from(billingSubscriptions)
        .where(eq(billingSubscriptions.id, residual.subscriptionId))
        .get()
    ).toEqual(residualBefore)
    expect(
      fixture.connection.db
        .select({ state: billingSubscriptionTransitions.state })
        .from(billingSubscriptionTransitions)
        .where(eq(billingSubscriptionTransitions.id, 'dissolve-transition'))
        .get()
    ).toEqual({ state: 'applied' })
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      subject: 'Your Family membership ended',
      to: relative.user.email
    })
    expect(messageBody(messages[0]!)).toContain('account and private data remain yours')
    expect(messageBody(messages[0]!)).not.toMatch(
      /dissolve-manager|dissolve-transition|dissolve-private-project|(?:sub|cus|price)_[a-z0-9_]+/i
    )
  })

  it('dissolves a terminal Family projection only for the exact accepted provider edge', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('terminal-manager@example.test', 'Terminal Manager')
    const relative = await fixture.signIn('terminal-relative@example.test', 'Terminal Relative')
    const billing = seedVerifiedBilling(fixture, manager, { plan: 'family' })
    addExternalFamilyMember(fixture, manager, relative, 'terminal-member')
    fixture.connection.db
      .update(session)
      .set({ activeOrganizationId: manager.workspace.id })
      .where(eq(session.userId, relative.user.id))
      .run()
    fixture.connection.db
      .update(billingSubscriptions)
      .set({ projectionEventId: 'terminal-edge', status: 'canceled' })
      .where(eq(billingSubscriptions.id, billing.subscriptionId))
      .run()
    const messages: TransactionalEmailMessage[] = []
    const handler = createBillingFamilyLifecycleSignalJobHandler(lifecycleContext(fixture))

    await handler({
      action: 'coverage_ended',
      billingSubscriptionId: billing.subscriptionId,
      billingTransitionId: null,
      episodeKey: hashBillingFamilyLifecycleEpisodeKey('different-edge')
    })
    await deliverQueuedNotifications(fixture, messages)
    expect(fixture.connection.db.select().from(member).where(eq(member.id, 'terminal-member')).get()).toBeTruthy()

    await handler({
      action: 'coverage_ended',
      billingSubscriptionId: billing.subscriptionId,
      billingTransitionId: null,
      episodeKey: hashBillingFamilyLifecycleEpisodeKey('terminal-edge')
    })
    await deliverQueuedNotifications(fixture, messages)
    expect(fixture.connection.db.select().from(member).where(eq(member.id, 'terminal-member')).get()).toBeUndefined()
    expect(messages).toHaveLength(1)
  })

  it.each(['past_due', 'unpaid'] as const)(
    'sends payer and member %s grace notices once and keeps failures privacy-safe and non-authoritative',
    async (status) => {
      fixture = createWorkspaceInvitationFixture()
      const manager = await fixture.signIn(`grace-${status}-manager@example.test`, 'Grace Manager')
      const relative = await fixture.signIn(`grace-${status}-relative@example.test`, 'Grace Relative')
      const billing = seedVerifiedBilling(fixture, manager, { plan: 'family' })
      addExternalFamilyMember(fixture, manager, relative, 'grace-member')
      const now = new Date()
      fixture.connection.db
        .update(billingSubscriptions)
        .set({
          graceEndsAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1_000).toISOString(),
          graceInvoiceId: 'in_grace_episode',
          graceStartedAt: now.toISOString(),
          status
        })
        .where(eq(billingSubscriptions.id, billing.subscriptionId))
        .run()
      const sent: TransactionalEmailMessage[] = []
      const capture = vi.fn(async () => undefined)
      const sender: TransactionalEmailSender = {
        async send(message) {
          sent.push(message)
          throw new Error(`unsafe provider failure ${message.to} ${billing.stripeSubscriptionId} in_grace_episode`)
        }
      }
      const handler = createBillingFamilyLifecycleSignalJobHandler(
        lifecycleContext(fixture, new Date(now.getTime() + 1_000))
      )
      const payload = {
        action: 'payment_grace_started',
        billingSubscriptionId: billing.subscriptionId,
        billingTransitionId: null,
        episodeKey: hashBillingFamilyLifecycleEpisodeKey('in_grace_episode')
      } as const

      await expect(handler(payload)).resolves.toBeUndefined()
      await expect(handler(payload)).resolves.toBeUndefined()
      await deliverQueuedNotifications(fixture, sent, { capture, sender, expectFailure: true })

      expect(sent).toHaveLength(2)
      expect(sent.map((message) => message.to)).toEqual([manager.user.email, relative.user.email])
      expect(sent.map((message) => message.subject)).toEqual([
        'Your subscription payment needs attention',
        'Family access may change'
      ])
      for (const message of sent) {
        expect(messageBody(message)).toContain('no payment, invoice, or other member details')
        expect(messageBody(message)).not.toMatch(/in_grace_episode|(?:sub|cus|price)_[a-z0-9_]+/i)
      }
      expect(capture).toHaveBeenCalledTimes(2)
      expect(capture).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Billing notification delivery failed' }),
        'family-lifecycle-notification-failed'
      )
      expect(JSON.stringify(capture.mock.calls)).not.toMatch(
        /grace-manager|grace-relative|in_grace_episode|(?:sub|cus|price)_[a-z0-9_]+/i
      )
      expect(fixture.connection.db.select().from(member).where(eq(member.id, 'grace-member')).get()).toBeTruthy()
    }
  )

  it('sends action-required attention only to the payer and never invents a Family grace notice', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('attention-manager@example.test', 'Attention Manager')
    const relative = await fixture.signIn('attention-relative@example.test', 'Attention Relative')
    const billing = seedVerifiedBilling(fixture, manager, { plan: 'family' })
    addExternalFamilyMember(fixture, manager, relative, 'attention-member')
    fixture.connection.db
      .update(billingSubscriptions)
      .set({ status: 'past_due' })
      .where(eq(billingSubscriptions.id, billing.subscriptionId))
      .run()
    const messages: TransactionalEmailMessage[] = []
    const handler = createBillingFamilyLifecycleSignalJobHandler(lifecycleContext(fixture))
    const payload = {
      action: 'payment_attention',
      billingSubscriptionId: billing.subscriptionId,
      billingTransitionId: null,
      episodeKey: hashBillingFamilyLifecycleEpisodeKey('in_attention')
    } as const

    await handler(payload)
    await handler(payload)
    await deliverQueuedNotifications(fixture, messages)

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      subject: 'Your subscription payment needs attention',
      to: manager.user.email
    })
    expect(messages[0]!.to).not.toBe(relative.user.email)
    expect(messageBody(messages[0]!)).not.toMatch(/in_attention|(?:sub|cus|price)_[a-z0-9_]+/i)
    expect(fixture.connection.db.select().from(member).where(eq(member.id, 'attention-member')).get()).toBeTruthy()
  })

  it('sends payer attention for an exact action-required Personal-to-Family transition', async () => {
    fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('transition-attention@example.test', 'Transition Attention')
    const billing = seedVerifiedBilling(fixture, owner, { plan: 'personal' })
    const transitionId = 'transition-attention'
    const subscription = fixture.connection.db
      .select({ revision: billingSubscriptions.revision })
      .from(billingSubscriptions)
      .where(eq(billingSubscriptions.id, billing.subscriptionId))
      .get()!
    fixture.connection.db
      .insert(billingSubscriptionTransitions)
      .values({
        billingSubscriptionId: billing.subscriptionId,
        capturedBillingRevision: subscription.revision,
        id: transitionId,
        idempotencyKey: 'transition-attention-key',
        kind: 'personal_to_family',
        organizationId: owner.workspace.id,
        sourceCadence: 'monthly',
        sourcePlanKey: 'personal',
        state: 'action_required',
        stateReason: 'payment_resolution_required',
        stripePendingInvoiceId: 'in_transition_attention',
        stripePendingUpdateExpiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
        targetCadence: 'monthly',
        targetPlanKey: 'family'
      })
      .run()
    const messages: TransactionalEmailMessage[] = []
    const handler = createBillingFamilyLifecycleSignalJobHandler(lifecycleContext(fixture))
    const payload = {
      action: 'payment_attention',
      billingSubscriptionId: billing.subscriptionId,
      billingTransitionId: transitionId,
      episodeKey: hashBillingFamilyLifecycleEpisodeKey(transitionId)
    } as const

    await handler(payload)
    await handler(payload)
    await deliverQueuedNotifications(fixture, messages)

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      subject: 'Your subscription payment needs attention',
      to: owner.user.email
    })
    expect(messageBody(messages[0]!)).not.toMatch(
      /transition-attention|in_transition_attention|(?:sub|cus|price)_[a-z0-9_]+/i
    )
  })

  it('rejects payloads with extra fields or mismatched transition episode identities', async () => {
    fixture = createWorkspaceInvitationFixture()
    const handler = createBillingFamilyLifecycleSignalJobHandler(lifecycleContext(fixture))

    await expect(
      handler({
        action: 'coverage_ended',
        billingSubscriptionId: 'subscription',
        billingTransitionId: 'transition',
        episodeKey: hashBillingFamilyLifecycleEpisodeKey('another-transition')
      })
    ).rejects.toThrow('Invalid billing Family lifecycle signal payload')
    await expect(
      handler({
        action: 'renewal_ending',
        billingSubscriptionId: 'subscription',
        billingTransitionId: null,
        episodeKey: hashBillingFamilyLifecycleEpisodeKey('edge'),
        rawProviderBody: 'must-not-be-queued'
      })
    ).rejects.toThrow('Invalid billing Family lifecycle signal payload')
  })
})

function lifecycleContext(activeFixture: WorkspaceInvitationFixture, now = new Date()) {
  return {
    connection: activeFixture.connection,
    now: () => now
  }
}

async function deliverQueuedNotifications(
  activeFixture: WorkspaceInvitationFixture,
  messages: TransactionalEmailMessage[],
  options: Readonly<{
    capture?: (error: unknown, code: CaptureDiagnosticCode) => Promise<void>
    expectFailure?: boolean
    sender?: TransactionalEmailSender
  }> = {}
) {
  const sender: TransactionalEmailSender =
    options.sender ??
    ({
      async send(message) {
        messages.push(message)
      }
    } satisfies TransactionalEmailSender)
  const handler = createBillingNotificationDeliveryHandler({
    appName: activeFixture.config.public.appName,
    capture: options.capture,
    connection: activeFixture.connection,
    sender
  })
  const jobs = activeFixture.sqlite
    .prepare('select payload from job_queue where type = ? order by id')
    .all(billingNotificationDeliveryJobType) as Array<{ payload: string }>
  for (const job of jobs) {
    const delivery = handler(JSON.parse(job.payload))
    if (options.expectFailure) {
      await expect(delivery).rejects.toThrow('Billing notification delivery failed')
    } else {
      await delivery
    }
  }
}

function addExternalFamilyMember(
  activeFixture: WorkspaceInvitationFixture,
  manager: SignedInFixtureUser,
  relative: SignedInFixtureUser,
  id: string
) {
  activeFixture.sqlite
    .prepare(
      `insert into member (id, organization_id, user_id, role, created_at)
       values (?, ?, ?, 'member', ?)`
    )
    .run(id, manager.workspace.id, relative.user.id, Date.now())
}

function addPersonalSubscriberExternalMember(
  activeFixture: WorkspaceInvitationFixture,
  manager: SignedInFixtureUser,
  relative: SignedInFixtureUser,
  input: Readonly<{
    billingSubscriptionId: string
    currentPeriodEnd: string
    memberId: string
  }>
) {
  const invitationId = `join-${input.memberId}`
  addPendingInvitation(activeFixture, manager, invitationId, relative.user.email)
  const subscription = activeFixture.connection.db
    .select({ revision: billingSubscriptions.revision })
    .from(billingSubscriptions)
    .where(eq(billingSubscriptions.id, input.billingSubscriptionId))
    .get()!
  activeFixture.sqlite
    .prepare(
      `insert into family_join_attempts (
         id, recipient_user_id, personal_organization_id,
         personal_billing_subscription_id, captured_personal_billing_revision,
         target_organization_id, invitation_id, accepted_member_id,
         stripe_cancellation_idempotency_key, personal_paid_through,
         state, state_reason, revision
       ) values (?, ?, ?, ?, ?, ?, ?, null, ?, ?, 'membership_pending', null, 0)`
    )
    .run(
      `attempt-${input.memberId}`,
      relative.user.id,
      relative.workspace.id,
      input.billingSubscriptionId,
      subscription.revision,
      manager.workspace.id,
      invitationId,
      `renewal-off-${input.memberId}`,
      input.currentPeriodEnd
    )
  addExternalFamilyMember(activeFixture, manager, relative, input.memberId)
  activeFixture.sqlite.prepare("update invitation set status = 'accepted' where id = ?").run(invitationId)
  activeFixture.sqlite
    .prepare(
      `update family_join_attempts
       set accepted_member_id = ?, state = 'completed', revision = revision + 1
       where id = ?`
    )
    .run(input.memberId, `attempt-${input.memberId}`)
}

function addPendingInvitation(
  activeFixture: WorkspaceInvitationFixture,
  manager: SignedInFixtureUser,
  id: string,
  email: string
) {
  activeFixture.sqlite
    .prepare(
      `insert into invitation (
         id, organization_id, email, role, status, expires_at, created_at, inviter_id
       ) values (?, ?, ?, 'member', 'pending', ?, ?, ?)`
    )
    .run(id, manager.workspace.id, email, Date.now() + 48 * 60 * 60 * 1_000, Date.now(), manager.user.id)
}

function addFamilyToPersonalTransition(
  activeFixture: WorkspaceInvitationFixture,
  manager: SignedInFixtureUser,
  billingSubscriptionId: string,
  input: Readonly<{
    effectiveAt: string
    id: string
    state: 'scheduled' | 'canceled'
  }>
) {
  const subscription = activeFixture.connection.db
    .select({ revision: billingSubscriptions.revision })
    .from(billingSubscriptions)
    .where(eq(billingSubscriptions.id, billingSubscriptionId))
    .get()!
  activeFixture.connection.db
    .insert(billingSubscriptionTransitions)
    .values({
      billingSubscriptionId,
      capturedBillingRevision: subscription.revision,
      effectiveAt: input.effectiveAt,
      id: input.id,
      idempotencyKey: `idempotency-${input.id}`,
      kind: 'family_to_personal',
      organizationId: manager.workspace.id,
      sourceCadence: 'monthly',
      sourcePlanKey: 'family',
      state: input.state,
      targetCadence: 'monthly',
      targetPlanKey: 'personal'
    })
    .run()
}

function invitationStatus(activeFixture: WorkspaceInvitationFixture, id: string) {
  return activeFixture.connection.db
    .select({ status: invitation.status })
    .from(invitation)
    .where(eq(invitation.id, id))
    .get()?.status
}

function messageBody(message: TransactionalEmailMessage) {
  return `${message.subject}\n${message.text}\n${message.html}`
}
