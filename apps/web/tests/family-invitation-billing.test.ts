import type Stripe from 'stripe'
import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  billingSubscriptions,
  billingSubscriptionTransitions,
  familyJoinAttempts,
  invitation,
  member
} from '../server/db/schema'
import type { FamilyJoinStripeClient } from '../server/services/family-join'
import {
  acceptWorkspaceInvitation,
  resendWorkspaceInvitation,
  sendWorkspaceInvitation
} from '../server/services/workspace-invitations'
import type { TransactionalEmailSender } from '../server/services/email'
import { assertWorkspaceInvitationAdmission } from '../server/utils/auth/organization'
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

describe('billing-current Family invitation admission', () => {
  it.each([
    ['grace', { status: 'past_due' as const }],
    ['renewal off', { cancelAtPeriodEnd: true }],
    ['reconciliation', { reconciliationRequired: true }]
  ])('blocks invitation creation while Family billing is %s', async (_label, billing) => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn(`${_label.replaceAll(' ', '-')}-manager@example.test`, 'Manager')
    seedVerifiedBilling(fixture, manager, { plan: 'family', ...billing })

    await expect(createInvitation(fixture, manager, 'recipient@example.test')).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'Family invitations require current billing'
    })
    expect(fixture.connection.db.select().from(invitation).all()).toEqual([])
  })

  it('blocks resend during a pending downgrade without releasing the existing reservation', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('downgrade-manager@example.test', 'Manager')
    const billing = seedVerifiedBilling(fixture, manager, { plan: 'family' })
    const created = await createInvitation(fixture, manager, 'reserved@example.test')
    const snapshot = fixture.connection.db
      .select({ revision: billingSubscriptions.revision })
      .from(billingSubscriptions)
      .where(eq(billingSubscriptions.id, billing.subscriptionId))
      .get()!

    fixture.connection.db
      .insert(billingSubscriptionTransitions)
      .values({
        id: 'family_downgrade_transition',
        organizationId: manager.workspace.id,
        billingSubscriptionId: billing.subscriptionId,
        kind: 'family_to_personal',
        sourcePlanKey: 'family',
        sourceCadence: 'monthly',
        targetPlanKey: 'personal',
        targetCadence: 'monthly',
        effectiveAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString(),
        idempotencyKey: 'family_downgrade_transition',
        capturedBillingRevision: snapshot.revision
      })
      .run()
    const expiresAt = created.expiresAt.getTime()

    await expect(
      resendWorkspaceInvitation(invitationContext(fixture, manager), {
        ownerUserId: manager.user.id,
        invitationId: created.id,
        appName: fixture.config.public.appName,
        appUrl: fixture.config.public.appUrl,
        sender: successfulSender
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'Family invitations require current billing'
    })
    expect(invitationById(fixture, created.id)).toMatchObject({
      status: 'pending',
      expiresAt: new Date(expiresAt)
    })
  })
})

describe('Personal subscriber Family join protocol', () => {
  it('confirms Stripe renewal-off before accepting and persists paid-through completion', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('join-manager@example.test', 'Manager')
    const recipient = await fixture.signIn('join-recipient@example.test', 'Recipient')
    seedVerifiedBilling(fixture, manager, { plan: 'family' })
    const personal = seedVerifiedBilling(fixture, recipient, { plan: 'personal' })
    const created = await createInvitation(fixture, manager, recipient.user.email)
    const stripe = stripeJoinClient(personal)

    await expect(
      acceptWorkspaceInvitation(acceptanceContext(fixture, recipient, stripe.client), created.id, recipient.user.id)
    ).resolves.toEqual({ location: '/app', status: 'accepted' })

    expect(stripe.update).toHaveBeenCalledWith(
      personal.stripeSubscriptionId,
      { cancel_at_period_end: true },
      { idempotencyKey: expect.stringMatching(/^family_join_cancel_/) }
    )
    expect(stripe.retrieve).toHaveBeenCalledWith(personal.stripeSubscriptionId)
    expect(
      fixture.connection.db
        .select({
          acceptedMemberId: familyJoinAttempts.acceptedMemberId,
          paidThrough: familyJoinAttempts.personalPaidThrough,
          state: familyJoinAttempts.state
        })
        .from(familyJoinAttempts)
        .get()
    ).toEqual({
      acceptedMemberId: expect.stringMatching(/.+/),
      paidThrough: personal.currentPeriodEnd,
      state: 'completed'
    })
    expect(
      fixture.connection.db
        .select({
          cancelAtPeriodEnd: billingSubscriptions.cancelAtPeriodEnd,
          planKey: billingSubscriptions.planKey
        })
        .from(billingSubscriptions)
        .where(eq(billingSubscriptions.id, personal.subscriptionId))
        .get()
    ).toEqual({ cancelAtPeriodEnd: true, planKey: 'personal' })
  })

  it('rejects a Family join before Stripe I/O once Personal account deletion is fenced', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('fenced-join-manager@example.test', 'Manager')
    const recipient = await fixture.signIn('fenced-join-recipient@example.test', 'Recipient')
    seedVerifiedBilling(fixture, manager, { plan: 'family' })
    const personal = seedVerifiedBilling(fixture, recipient, { plan: 'personal' })
    const created = await createInvitation(fixture, manager, recipient.user.email)
    const stripe = stripeJoinClient(personal)
    fixture.sqlite
      .prepare('update organization set billing_deletion_pending = 1 where id = ?')
      .run(recipient.workspace.id)

    await expect(
      acceptWorkspaceInvitation(acceptanceContext(fixture, recipient, stripe.client), created.id, recipient.user.id)
    ).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'Family invitation cannot be accepted right now'
    })
    expect(stripe.update).not.toHaveBeenCalled()
    expect(stripe.retrieve).not.toHaveBeenCalled()
    expect(fixture.connection.db.select().from(familyJoinAttempts).all()).toEqual([])
  })

  it('keeps renewal off durably and retries acceptance without another Stripe mutation', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('retry-manager@example.test', 'Manager')
    const recipient = await fixture.signIn('retry-recipient@example.test', 'Recipient')
    const managerBilling = seedVerifiedBilling(fixture, manager, { plan: 'family' })
    const personal = seedVerifiedBilling(fixture, recipient, { plan: 'personal' })
    const created = await createInvitation(fixture, manager, recipient.user.email)
    const stripe = stripeJoinClient(personal, () => {
      fixture!.connection.db
        .update(billingSubscriptions)
        .set({ cancelAtPeriodEnd: true })
        .where(eq(billingSubscriptions.id, managerBilling.subscriptionId))
        .run()
    })

    await expect(
      acceptWorkspaceInvitation(acceptanceContext(fixture, recipient, stripe.client), created.id, recipient.user.id)
    ).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'Personal renewal is off; Family acceptance requires retry'
    })
    expect(
      fixture.connection.db
        .select({
          paidThrough: familyJoinAttempts.personalPaidThrough,
          reason: familyJoinAttempts.stateReason,
          state: familyJoinAttempts.state
        })
        .from(familyJoinAttempts)
        .get()
    ).toEqual({
      paidThrough: personal.currentPeriodEnd,
      reason: 'family_acceptance_requires_user_retry',
      state: 'reconciliation_required'
    })
    expect(
      fixture.connection.db
        .select({ cancelAtPeriodEnd: billingSubscriptions.cancelAtPeriodEnd })
        .from(billingSubscriptions)
        .where(eq(billingSubscriptions.id, personal.subscriptionId))
        .get()
    ).toEqual({ cancelAtPeriodEnd: true })
    expect(
      fixture.connection.db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, manager.workspace.id), eq(member.userId, recipient.user.id)))
        .all()
    ).toEqual([])

    fixture.connection.db
      .update(billingSubscriptions)
      .set({ cancelAtPeriodEnd: false })
      .where(eq(billingSubscriptions.id, managerBilling.subscriptionId))
      .run()
    await expect(
      acceptWorkspaceInvitation(acceptanceContext(fixture, recipient, stripe.client), created.id, recipient.user.id)
    ).resolves.toEqual({ location: '/app', status: 'accepted' })
    expect(stripe.update).toHaveBeenCalledTimes(1)
    expect(stripe.retrieve).toHaveBeenCalledTimes(1)
  })

  it('rechecks Family billing atomically when Better Auth persists an admitted membership', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('acceptance-race-manager@example.test', 'Manager')
    const recipient = await fixture.signIn('acceptance-race-recipient@example.test', 'Recipient')
    const managerBilling = seedVerifiedBilling(fixture, manager, { plan: 'family' })
    const created = await createInvitation(fixture, manager, recipient.user.email)
    await expect(
      assertWorkspaceInvitationAdmission(fixture.connection, {
        invitationId: created.id,
        organizationId: manager.workspace.id,
        role: 'member',
        userId: recipient.user.id
      })
    ).resolves.toBeUndefined()

    fixture.connection.db.update(invitation).set({ status: 'accepted' }).where(eq(invitation.id, created.id)).run()
    fixture.connection.db
      .update(billingSubscriptions)
      .set({ cancelAtPeriodEnd: true })
      .where(eq(billingSubscriptions.id, managerBilling.subscriptionId))
      .run()

    expect(() =>
      fixture!.sqlite
        .prepare("insert into member (id, organization_id, user_id, role, created_at) values (?, ?, ?, 'member', ?)")
        .run('acceptance-race-member', manager.workspace.id, recipient.user.id, new Date().toISOString())
    ).toThrow('Family membership requires current manager billing authority')
    expect(
      fixture.connection.db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, manager.workspace.id), eq(member.userId, recipient.user.id)))
        .all()
    ).toEqual([])
  })

  it('requires the captured Personal projection to remain unchanged through Stripe confirmation', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('projection-race-manager@example.test', 'Manager')
    const recipient = await fixture.signIn('projection-race-recipient@example.test', 'Recipient')
    seedVerifiedBilling(fixture, manager, { plan: 'family' })
    const personal = seedVerifiedBilling(fixture, recipient, { plan: 'personal' })
    const created = await createInvitation(fixture, manager, recipient.user.email)
    const stripe = stripeJoinClient(personal, () => {
      fixture!.sqlite
        .prepare(
          `update billing_subscriptions
           set stripe_subscription_id = 'sub_replaced_during_join', revision = revision + 1
           where id = ?`
        )
        .run(personal.subscriptionId)
    })

    await expect(
      acceptWorkspaceInvitation(acceptanceContext(fixture, recipient, stripe.client), created.id, recipient.user.id)
    ).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Personal renewal could not be confirmed'
    })
    expect(fixture.connection.db.select({ state: familyJoinAttempts.state }).from(familyJoinAttempts).get()).toEqual({
      state: 'reconciliation_required'
    })
    expect(
      fixture.connection.db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, manager.workspace.id), eq(member.userId, recipient.user.id)))
        .all()
    ).toEqual([])
  })

  it('takes the free-user path without invoking Stripe', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('free-manager@example.test', 'Manager')
    const recipient = await fixture.signIn('free-recipient@example.test', 'Recipient')
    seedVerifiedBilling(fixture, manager, { plan: 'family' })
    const created = await createInvitation(fixture, manager, recipient.user.email)
    const update = vi.fn()
    const retrieve = vi.fn()
    const client = { subscriptions: { update, retrieve } } as unknown as FamilyJoinStripeClient

    await expect(
      acceptWorkspaceInvitation(acceptanceContext(fixture, recipient, client), created.id, recipient.user.id)
    ).resolves.toEqual({ location: '/app', status: 'accepted' })
    expect(update).not.toHaveBeenCalled()
    expect(retrieve).not.toHaveBeenCalled()
  })
})

function invitationContext(activeFixture: WorkspaceInvitationFixture, actor: SignedInFixtureUser) {
  return { api: activeFixture.auth.api, connection: activeFixture.connection, headers: actor.headers }
}

function acceptanceContext(
  activeFixture: WorkspaceInvitationFixture,
  actor: SignedInFixtureUser,
  stripe: FamilyJoinStripeClient
) {
  return { ...invitationContext(activeFixture, actor), stripe }
}

async function createInvitation(
  activeFixture: WorkspaceInvitationFixture,
  manager: SignedInFixtureUser,
  email: string
) {
  await sendWorkspaceInvitation(invitationContext(activeFixture, manager), {
    ownerUserId: manager.user.id,
    email,
    appName: activeFixture.config.public.appName,
    appUrl: activeFixture.config.public.appUrl,
    sender: successfulSender
  })
  const created = activeFixture.connection.db
    .select()
    .from(invitation)
    .where(and(eq(invitation.organizationId, manager.workspace.id), eq(invitation.email, email)))
    .get()
  if (!created) throw new Error('Invitation fixture was not created')
  return created
}

function stripeJoinClient(personal: ReturnType<typeof seedVerifiedBilling>, afterRetrieve?: () => void) {
  const currentPeriodStart = Math.floor((Date.now() - 24 * 60 * 60 * 1_000) / 1_000)
  const currentPeriodEnd = Math.floor(Date.parse(personal.currentPeriodEnd) / 1_000)
  const subscription = {
    id: personal.stripeSubscriptionId,
    cancel_at_period_end: true,
    customer: personal.stripeCustomerId,
    items: {
      data: [
        {
          id: personal.stripeSubscriptionItemId,
          current_period_start: currentPeriodStart,
          current_period_end: currentPeriodEnd,
          price: { id: personal.stripePriceId },
          quantity: 1
        }
      ],
      has_more: false
    },
    status: 'active'
  } as unknown as Stripe.Subscription
  const update = vi.fn(async () => subscription)
  const retrieve = vi.fn(async () => {
    afterRetrieve?.()
    return subscription
  })
  const client = { subscriptions: { update, retrieve } } as unknown as FamilyJoinStripeClient
  return { client, retrieve, update }
}

function invitationById(activeFixture: WorkspaceInvitationFixture, invitationId: string) {
  const row = activeFixture.connection.db.select().from(invitation).where(eq(invitation.id, invitationId)).get()
  if (!row) throw new Error('Invitation fixture row is missing')
  return row
}

const successfulSender: TransactionalEmailSender = {
  async send() {}
}
