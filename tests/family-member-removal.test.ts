import type Stripe from 'stripe'
import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  billingSubscriptions,
  billingSubscriptionTransitions,
  familyJoinAttempts,
  invitation,
  member,
  organization,
  projects,
  session,
  user
} from '../server/db/schema'
import {
  captureFamilyMemberRemovalTarget,
  removeCapturedFamilyMember
} from '../server/db/repositories/family-member-removal'
import { removeFamilyMember } from '../server/services/family-member-removal'
import type { FamilyJoinStripeClient } from '../server/services/family-join'
import { getBillingStateForConnection } from '../server/services/payments/billing-service'
import {
  billingNotificationDeliveryJobType,
  createBillingNotificationDeliveryHandler
} from '../server/services/payments/billing-notification-delivery'
import { acceptWorkspaceInvitation, sendWorkspaceInvitation } from '../server/services/workspace-invitations'
import type { TransactionalEmailSender } from '../server/services/email'
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

describe('manager Family member removal', () => {
  it('removes only the exact external membership and preserves identity, private data, sessions, and residual Personal state', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('remove-manager@example.test', 'Remove Manager')
    const relative = await fixture.signIn('remove-relative@example.test', 'Remove Relative')
    seedVerifiedBilling(fixture, manager, { plan: 'family' })
    const personal = seedVerifiedBilling(fixture, relative, { plan: 'personal' })
    const memberReference = await joinPersonalSubscriber(fixture, manager, relative, personal)
    fixture.connection.db
      .insert(projects)
      .values({ id: 'remove-relative-project', name: 'Private project', ownerUserId: relative.user.id })
      .run()
    fixture.connection.db
      .update(session)
      .set({ activeOrganizationId: manager.workspace.id })
      .where(eq(session.userId, relative.user.id))
      .run()
    const personalBefore = fixture.connection.db
      .select()
      .from(billingSubscriptions)
      .where(eq(billingSubscriptions.id, personal.subscriptionId))
      .get()
    const joinBefore = fixture.connection.db.select().from(familyJoinAttempts).get()
    const messages: Parameters<TransactionalEmailSender['send']>[0][] = []

    await expect(removeFamilyMember(removalContext(fixture), manager.user.id, memberReference)).resolves.toEqual({
      status: 'removed'
    })
    await deliverRemovalNotification(fixture, {
      async send(message) {
        messages.push(message)
      }
    })

    expect(fixture.connection.db.select().from(member).where(eq(member.id, memberReference)).get()).toBeUndefined()
    expect(
      fixture.connection.db
        .select({ role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, relative.workspace.id), eq(member.userId, relative.user.id)))
        .get()
    ).toEqual({ role: 'owner' })
    expect(fixture.connection.db.select().from(user).where(eq(user.id, relative.user.id)).get()).toBeTruthy()
    expect(
      fixture.connection.db.select().from(organization).where(eq(organization.id, relative.workspace.id)).get()
    ).toBeTruthy()
    expect(
      fixture.connection.db.select().from(projects).where(eq(projects.ownerUserId, relative.user.id)).get()
    ).toMatchObject({ id: 'remove-relative-project' })
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
    expect(
      fixture.connection.db
        .select()
        .from(billingSubscriptions)
        .where(eq(billingSubscriptions.id, personal.subscriptionId))
        .get()
    ).toEqual(personalBefore)
    expect(fixture.connection.db.select().from(familyJoinAttempts).get()).toEqual({
      ...joinBefore,
      acceptedMemberId: null
    })
    expect(getBillingStateForConnection(fixture.connection, relative.user.id)).toMatchObject({
      relationship: { kind: 'independent' },
      entitlement: { granted: true, source: 'personal', state: 'active', plan: 'personal' },
      subscription: { renewalEnabled: false }
    })
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      to: relative.user.email,
      subject: 'Your Family membership ended'
    })
    expect(`${messages[0]!.subject}\n${messages[0]!.text}\n${messages[0]!.html}`).not.toMatch(
      /remove manager|remove-manager|stripe|(?:sub|cus|price)_[a-z0-9_]+|card ending|private project/i
    )
  })

  it('keeps the committed removal authoritative when safe notification delivery fails', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('notify-manager@example.test', 'Notify Manager')
    const relative = await fixture.signIn('notify-relative@example.test', 'Notify Relative')
    seedVerifiedBilling(fixture, manager, { plan: 'family' })
    const memberReference = await joinFreeMember(fixture, manager, relative)
    const capture = vi.fn(async () => {
      throw new Error('observability unavailable')
    })
    const sender: TransactionalEmailSender = {
      async send() {
        throw new Error(`smtp failure for ${relative.user.email} ${memberReference}`)
      }
    }

    await expect(removeFamilyMember(removalContext(fixture), manager.user.id, memberReference)).resolves.toEqual({
      status: 'removed'
    })

    expect(fixture.connection.db.select().from(member).where(eq(member.id, memberReference)).get()).toBeUndefined()
    await expect(deliverRemovalNotification(fixture, sender, capture)).rejects.toThrow(
      'Billing notification delivery failed'
    )
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Billing notification delivery failed'
      }),
      'family-lifecycle-notification-failed'
    )
    expect(JSON.stringify(capture.mock.calls)).not.toMatch(/notify-relative|memberReference|smtp failure/i)
  })

  it('cannot remove the manager or treat an arbitrary missing reference as success', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('protected-manager@example.test', 'Protected Manager')
    seedVerifiedBilling(fixture, manager, { plan: 'family' })
    const managerMember = fixture.connection.db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, manager.workspace.id), eq(member.userId, manager.user.id)))
      .get()!

    for (const memberReference of [managerMember.id, 'member_reference_that_never_existed']) {
      await expect(removeFamilyMember(removalContext(fixture), manager.user.id, memberReference)).rejects.toMatchObject(
        {
          statusCode: 404,
          statusMessage: 'Family member not found'
        }
      )
    }
    expect(fixture.connection.db.select().from(member).where(eq(member.id, managerMember.id)).get()).toMatchObject({
      role: 'owner'
    })
  })

  it('rechecks manager reconciliation authority inside the final write transaction', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('race-manager@example.test', 'Race Manager')
    const relative = await fixture.signIn('race-relative@example.test', 'Race Relative')
    const managerBilling = seedVerifiedBilling(fixture, manager, { plan: 'family' })
    const memberReference = await joinFreeMember(fixture, manager, relative)
    const captured = captureFamilyMemberRemovalTarget(fixture.connection, {
      managerUserId: manager.user.id,
      memberReference
    })
    expect(captured).not.toBeNull()
    fixture.connection.db
      .update(billingSubscriptions)
      .set({ reconciliationReason: 'test_final_removal_recheck', reconciliationRequired: true })
      .where(eq(billingSubscriptions.id, managerBilling.subscriptionId))
      .run()

    expect(() => removeCapturedFamilyMember(fixture.connection, captured!)).toThrow(
      'Family manager billing is not current'
    )
    expect(fixture.connection.db.select().from(member).where(eq(member.id, memberReference)).get()).toBeTruthy()
  })

  it('allows removal through a scheduled Family downgrade and period-end cancellation', async () => {
    for (const mode of ['scheduled_downgrade', 'period_end_cancellation'] as const) {
      const activeFixture = createWorkspaceInvitationFixture()
      try {
        const manager = await activeFixture.signIn(`${mode}-manager@example.test`, `${mode} Manager`)
        const relative = await activeFixture.signIn(`${mode}-relative@example.test`, `${mode} Relative`)
        const managerBilling = seedVerifiedBilling(activeFixture, manager, { plan: 'family' })
        const memberReference = await joinFreeMember(activeFixture, manager, relative)

        if (mode === 'period_end_cancellation') {
          activeFixture.connection.db
            .update(billingSubscriptions)
            .set({ cancelAtPeriodEnd: true })
            .where(eq(billingSubscriptions.id, managerBilling.subscriptionId))
            .run()
        } else {
          const snapshot = activeFixture.connection.db
            .select({ revision: billingSubscriptions.revision })
            .from(billingSubscriptions)
            .where(eq(billingSubscriptions.id, managerBilling.subscriptionId))
            .get()!
          activeFixture.connection.db
            .insert(billingSubscriptionTransitions)
            .values({
              id: 'removal_scheduled_downgrade',
              organizationId: manager.workspace.id,
              billingSubscriptionId: managerBilling.subscriptionId,
              kind: 'family_to_personal',
              sourcePlanKey: 'family',
              sourceCadence: 'monthly',
              targetPlanKey: 'personal',
              targetCadence: 'monthly',
              effectiveAt: managerBilling.currentPeriodEnd,
              idempotencyKey: 'removal_scheduled_downgrade',
              capturedBillingRevision: snapshot.revision,
              state: 'scheduled'
            })
            .run()
        }

        await expect(
          removeFamilyMember(removalContext(activeFixture), manager.user.id, memberReference)
        ).resolves.toEqual({ status: 'removed' })
      } finally {
        activeFixture.cleanup()
      }
    }
  })

  it.each(['past_due', 'unpaid'] as const)('allows removal during a valid %s Family grace window', async (status) => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn(`grace-removal-${status}-manager@example.test`, 'Grace Removal Manager')
    const relative = await fixture.signIn(`grace-removal-${status}-relative@example.test`, 'Grace Removal Relative')
    const managerBilling = seedVerifiedBilling(fixture, manager, { plan: 'family' })
    const memberReference = await joinFreeMember(fixture, manager, relative)
    const graceStartedAt = new Date(Date.now() - 60_000)
    const graceEndsAt = new Date(graceStartedAt.getTime() + 14 * 24 * 60 * 60 * 1_000)
    fixture.connection.db
      .update(billingSubscriptions)
      .set({
        graceEndsAt: graceEndsAt.toISOString(),
        graceInvoiceId: `invoice_grace_removal_${status}`,
        graceStartedAt: graceStartedAt.toISOString(),
        status
      })
      .where(eq(billingSubscriptions.id, managerBilling.subscriptionId))
      .run()

    await expect(removeFamilyMember(removalContext(fixture), manager.user.id, memberReference)).resolves.toEqual({
      status: 'removed'
    })
  })

  it.each(['suspended', 'terminal', 'reconciliation'] as const)(
    'denies removal when Family authority is %s',
    async (state) => {
      fixture = createWorkspaceInvitationFixture()
      const manager = await fixture.signIn(`${state}-removal-manager@example.test`, `${state} Manager`)
      const relative = await fixture.signIn(`${state}-removal-relative@example.test`, `${state} Relative`)
      const managerBilling = seedVerifiedBilling(fixture, manager, { plan: 'family' })
      const memberReference = await joinFreeMember(fixture, manager, relative)

      if (state === 'suspended') {
        const graceEndsAt = new Date(Date.now() - 60_000)
        const graceStartedAt = new Date(graceEndsAt.getTime() - 14 * 24 * 60 * 60 * 1_000)
        fixture.connection.db
          .update(billingSubscriptions)
          .set({
            graceEndsAt: graceEndsAt.toISOString(),
            graceInvoiceId: 'invoice_suspended_removal',
            graceStartedAt: graceStartedAt.toISOString(),
            status: 'past_due'
          })
          .where(eq(billingSubscriptions.id, managerBilling.subscriptionId))
          .run()
      } else if (state === 'terminal') {
        fixture.connection.db
          .update(billingSubscriptions)
          .set({ status: 'canceled' })
          .where(eq(billingSubscriptions.id, managerBilling.subscriptionId))
          .run()
      } else {
        fixture.connection.db
          .update(billingSubscriptions)
          .set({ reconciliationReason: 'test_removal_reconciliation', reconciliationRequired: true })
          .where(eq(billingSubscriptions.id, managerBilling.subscriptionId))
          .run()
      }

      await expect(removeFamilyMember(removalContext(fixture), manager.user.id, memberReference)).rejects.toMatchObject(
        {
          statusCode: 409,
          statusMessage: 'Family member removal requires current billing'
        }
      )
      expect(fixture.connection.db.select().from(member).where(eq(member.id, memberReference)).get()).toBeTruthy()
    }
  )

  it('treats only a previously captured exact target that disappeared as idempotent success', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('idempotent-manager@example.test', 'Idempotent Manager')
    const relative = await fixture.signIn('idempotent-relative@example.test', 'Idempotent Relative')
    seedVerifiedBilling(fixture, manager, { plan: 'family' })
    const memberReference = await joinFreeMember(fixture, manager, relative)
    const captured = captureFamilyMemberRemovalTarget(fixture.connection, {
      managerUserId: manager.user.id,
      memberReference
    })
    expect(captured).not.toBeNull()
    fixture.connection.db.delete(member).where(eq(member.id, memberReference)).run()

    expect(removeCapturedFamilyMember(fixture.connection, captured!)).toBe('already_removed')
    expect(
      captureFamilyMemberRemovalTarget(fixture.connection, {
        managerUserId: manager.user.id,
        memberReference: 'never_captured'
      })
    ).toBeNull()
  })
})

async function joinFreeMember(
  activeFixture: WorkspaceInvitationFixture,
  manager: SignedInFixtureUser,
  relative: SignedInFixtureUser
) {
  const created = await createInvitation(activeFixture, manager, relative.user.email)
  await acceptWorkspaceInvitation(
    {
      api: activeFixture.auth.api,
      connection: activeFixture.connection,
      headers: relative.headers,
      stripe: unusedStripeClient()
    },
    created.id,
    relative.user.id
  )
  return requireExternalMemberReference(activeFixture, manager, relative)
}

async function joinPersonalSubscriber(
  activeFixture: WorkspaceInvitationFixture,
  manager: SignedInFixtureUser,
  relative: SignedInFixtureUser,
  personal: ReturnType<typeof seedVerifiedBilling>
) {
  const created = await createInvitation(activeFixture, manager, relative.user.email)
  await acceptWorkspaceInvitation(
    {
      api: activeFixture.auth.api,
      connection: activeFixture.connection,
      headers: relative.headers,
      stripe: confirmedRenewalOffStripeClient(personal)
    },
    created.id,
    relative.user.id
  )
  return requireExternalMemberReference(activeFixture, manager, relative)
}

async function createInvitation(
  activeFixture: WorkspaceInvitationFixture,
  manager: SignedInFixtureUser,
  email: string
) {
  await sendWorkspaceInvitation(
    { api: activeFixture.auth.api, connection: activeFixture.connection, headers: manager.headers },
    {
      ownerUserId: manager.user.id,
      email,
      appName: activeFixture.config.public.appName,
      appUrl: activeFixture.config.public.appUrl,
      sender: successfulSender
    }
  )
  const created = activeFixture.connection.db
    .select({ id: invitation.id })
    .from(invitation)
    .where(and(eq(invitation.organizationId, manager.workspace.id), eq(invitation.email, email)))
    .get()
  if (!created) throw new Error('Family invitation fixture is missing')
  return created
}

function requireExternalMemberReference(
  activeFixture: WorkspaceInvitationFixture,
  manager: SignedInFixtureUser,
  relative: SignedInFixtureUser
) {
  const external = activeFixture.connection.db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, manager.workspace.id), eq(member.userId, relative.user.id)))
    .get()
  if (!external) throw new Error('External Family member fixture is missing')
  return external.id
}

function confirmedRenewalOffStripeClient(personal: ReturnType<typeof seedVerifiedBilling>) {
  const subscription = {
    id: personal.stripeSubscriptionId,
    cancel_at_period_end: true,
    customer: personal.stripeCustomerId,
    items: {
      data: [
        {
          id: personal.stripeSubscriptionItemId,
          current_period_start: Math.floor((Date.now() - 24 * 60 * 60 * 1_000) / 1_000),
          current_period_end: Math.floor(Date.parse(personal.currentPeriodEnd) / 1_000),
          price: { id: personal.stripePriceId },
          quantity: 1
        }
      ],
      has_more: false
    },
    status: 'active'
  } as unknown as Stripe.Subscription

  return {
    subscriptions: {
      async update() {
        return subscription
      },
      async retrieve() {
        return subscription
      }
    }
  } as unknown as FamilyJoinStripeClient
}

function unusedStripeClient() {
  return {
    subscriptions: {
      async update() {
        throw new Error('Stripe must not be called for a free Family join')
      },
      async retrieve() {
        throw new Error('Stripe must not be called for a free Family join')
      }
    }
  } as unknown as FamilyJoinStripeClient
}

const successfulSender: TransactionalEmailSender = {
  async send() {}
}

function removalContext(activeFixture: WorkspaceInvitationFixture) {
  return {
    connection: activeFixture.connection
  }
}

async function deliverRemovalNotification(
  activeFixture: WorkspaceInvitationFixture,
  sender: TransactionalEmailSender,
  capture?: Parameters<typeof createBillingNotificationDeliveryHandler>[0]['capture']
) {
  const row = activeFixture.sqlite
    .prepare('select payload from job_queue where type = ? order by id desc limit 1')
    .get(billingNotificationDeliveryJobType) as { payload: string }
  expect(row.payload).not.toMatch(/@|memberReference|(?:sub|cus|price)_[a-z0-9_]+/i)
  return createBillingNotificationDeliveryHandler({
    appName: activeFixture.config.public.appName,
    capture,
    connection: activeFixture.connection,
    sender
  })(JSON.parse(row.payload))
}
