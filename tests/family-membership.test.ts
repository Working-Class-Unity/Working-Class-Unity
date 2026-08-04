import type Stripe from 'stripe'
import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getExternalFamilyMembership } from '../server/db/repositories/family-authority'
import { invitation, member, organization, projects, session, user } from '../server/db/schema'
import { leaveJoinedFamily } from '../server/services/family-membership'
import type { FamilyJoinStripeClient } from '../server/services/family-join'
import { getBillingStateForConnection } from '../server/services/payments/billing-service'
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
  vi.restoreAllMocks()
  fixture?.cleanup()
  fixture = undefined
})

describe('joined family self-leave', () => {
  it('derives the external family from persisted membership and preserves both personal accounts', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('leave-manager@example.test', 'Leave Manager')
    const relative = await fixture.signIn('leave-relative@example.test', 'Leave Relative')
    await joinFamily(fixture, manager, relative)
    fixture.connection.db
      .insert(projects)
      .values([
        { id: 'leave-manager-private', name: 'Manager private project', ownerUserId: manager.user.id },
        { id: 'leave-relative-private', name: 'Relative private project', ownerUserId: relative.user.id }
      ])
      .run()

    expect(getBillingStateForConnection(fixture.connection, relative.user.id)).toMatchObject({
      relationship: { kind: 'member' },
      entitlement: { granted: true, source: 'family', state: 'active' },
      capabilities: { canLeaveFamily: true }
    })

    await expect(leaveJoinedFamily(context(fixture, relative), relative.user.id)).resolves.toEqual({ status: 'left' })

    expect(getExternalFamilyMembership(fixture.connection, relative.user.id)).toBeNull()
    expect(
      fixture.connection.db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, manager.workspace.id), eq(member.userId, relative.user.id)))
        .all()
    ).toEqual([])
    expect(
      fixture.connection.db
        .select({ id: member.id, role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, relative.workspace.id), eq(member.userId, relative.user.id)))
        .get()
    ).toMatchObject({ role: 'owner' })
    expect(fixture.connection.db.select().from(user).where(eq(user.id, manager.user.id)).get()).toBeTruthy()
    expect(fixture.connection.db.select().from(user).where(eq(user.id, relative.user.id)).get()).toBeTruthy()
    expect(
      fixture.connection.db
        .select({ id: projects.id, name: projects.name, ownerUserId: projects.ownerUserId })
        .from(projects)
        .all()
        .sort((left, right) => left.id.localeCompare(right.id))
    ).toEqual([
      { id: 'leave-manager-private', name: 'Manager private project', ownerUserId: manager.user.id },
      { id: 'leave-relative-private', name: 'Relative private project', ownerUserId: relative.user.id }
    ])
    expect(
      fixture.connection.db.select().from(organization).where(eq(organization.id, manager.workspace.id)).get()
    ).toBeTruthy()
    expect(getBillingStateForConnection(fixture.connection, manager.user.id)).toMatchObject({
      relationship: { kind: 'manager' },
      entitlement: { granted: true, source: 'manager', state: 'active' }
    })
    expect(getBillingStateForConnection(fixture.connection, relative.user.id)).toMatchObject({
      relationship: { kind: 'independent' },
      entitlement: { granted: false },
      capabilities: { canCheckout: true, canLeaveFamily: false }
    })
    expect(
      fixture.connection.db
        .select({ activeOrganizationId: session.activeOrganizationId })
        .from(session)
        .where(eq(session.userId, relative.user.id))
        .get()
    ).toEqual({ activeOrganizationId: null })
  })

  it('does not expose owner leave or accept a client-selected organization', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('owner-cannot-leave@example.test', 'Owner Cannot Leave')
    const api = {
      leaveOrganization: async () => {
        throw new Error('The Better Auth API must not be called')
      }
    } as FamilyMembershipAuthApi

    await expect(
      leaveJoinedFamily({ api, connection: fixture.connection, headers: manager.headers }, manager.user.id)
    ).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'No joined family membership to leave'
    })
    expect(
      fixture.connection.db
        .select({ role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, manager.workspace.id), eq(member.userId, manager.user.id)))
        .get()
    ).toEqual({ role: 'owner' })
  })

  it('restores a renewal-off Personal entitlement after a Personal subscriber leaves', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('personal-leave-manager@example.test', 'Personal Leave Manager')
    const relative = await fixture.signIn('personal-leave-relative@example.test', 'Personal Leave Relative')
    await joinPersonalSubscriberFamily(fixture, manager, relative)

    expect(getBillingStateForConnection(fixture.connection, relative.user.id)).toMatchObject({
      relationship: { kind: 'member' },
      entitlement: { granted: true, source: 'family', state: 'active' },
      subscription: { renewalEnabled: true }
    })

    await expect(leaveJoinedFamily(context(fixture, relative), relative.user.id)).resolves.toEqual({ status: 'left' })

    expect(getBillingStateForConnection(fixture.connection, relative.user.id)).toMatchObject({
      relationship: { kind: 'independent' },
      entitlement: { granted: true, source: 'personal', state: 'active', plan: 'personal' },
      subscription: { renewalEnabled: false }
    })
    expect(getExternalFamilyMembership(fixture.connection, relative.user.id)).toBeNull()
  })

  it('rolls back membership removal when clearing activeOrganizationId fails', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('partial-leave-manager@example.test', 'Partial Leave Manager')
    const relative = await fixture.signIn('partial-leave-relative@example.test', 'Partial Leave Relative')
    await joinFamily(fixture, manager, relative)
    fixture.sqlite.exec(`
      create trigger test_fail_active_organization_clear
      before update of active_organization_id on session
      when old.active_organization_id = '${manager.workspace.id}'
       and new.active_organization_id is null
      begin
        select raise(abort, 'injected active organization clear failure');
      end
    `)

    await expect(leaveJoinedFamily(context(fixture, relative), relative.user.id)).rejects.toThrow(
      'injected active organization clear failure'
    )
    expect(getExternalFamilyMembership(fixture.connection, relative.user.id)).toMatchObject({
      organizationId: manager.workspace.id
    })
    expect(
      fixture.connection.db
        .select({ activeOrganizationId: session.activeOrganizationId })
        .from(session)
        .where(eq(session.userId, relative.user.id))
        .get()
    ).toEqual({ activeOrganizationId: manager.workspace.id })
  })

  it('maps a duplicate persisted membership invariant before changing either membership', async () => {
    fixture = createWorkspaceInvitationFixture()
    const firstManager = await fixture.signIn('invariant-first-manager@example.test', 'First Manager')
    const secondManager = await fixture.signIn('invariant-second-manager@example.test', 'Second Manager')
    const relative = await fixture.signIn('invariant-relative@example.test', 'Invariant Relative')
    await joinFamily(fixture, firstManager, relative)
    fixture.sqlite.exec('drop index member_one_external_family_uidx')
    fixture.sqlite
      .prepare(
        `insert into member (id, organization_id, user_id, role, created_at)
         values ('member_duplicate_leave', ?, ?, 'member', ?)`
      )
      .run(secondManager.workspace.id, relative.user.id, Date.now())
    await expect(leaveJoinedFamily({ connection: fixture.connection }, relative.user.id)).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Family membership is temporarily unavailable'
    })
    expect(
      fixture.connection.db
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(and(eq(member.userId, relative.user.id), eq(member.role, 'member')))
        .all()
    ).toHaveLength(2)
  })

  it('preserves an unexpected database failure instead of relabeling it as an authority conflict', async () => {
    fixture = createWorkspaceInvitationFixture()
    const actor = await fixture.signIn('database-failure-leave@example.test', 'Database Failure')
    const failure = new Error('injected database read failure')
    vi.spyOn(fixture.sqlite, 'prepare').mockImplementationOnce(() => {
      throw failure
    })
    await expect(leaveJoinedFamily({ connection: fixture.connection }, actor.user.id)).rejects.toBe(failure)
  })
})

function context(activeFixture: WorkspaceInvitationFixture, actor: SignedInFixtureUser) {
  return { api: activeFixture.auth.api, connection: activeFixture.connection, headers: actor.headers }
}

async function joinFamily(
  activeFixture: WorkspaceInvitationFixture,
  manager: SignedInFixtureUser,
  relative: SignedInFixtureUser
) {
  seedVerifiedBilling(activeFixture, manager, { plan: 'family' })
  await sendWorkspaceInvitation(context(activeFixture, manager), {
    ownerUserId: manager.user.id,
    email: relative.user.email,
    appName: activeFixture.config.public.appName,
    appUrl: activeFixture.config.public.appUrl,
    sender: successfulSender
  })
  const created = activeFixture.connection.db
    .select({ id: invitation.id })
    .from(invitation)
    .where(eq(invitation.email, relative.user.email))
    .get()
  if (!created) throw new Error('Family invitation fixture is missing')

  await activeFixture.auth.api.acceptInvitation({
    headers: relative.headers,
    body: { invitationId: created.id }
  })
}

async function joinPersonalSubscriberFamily(
  activeFixture: WorkspaceInvitationFixture,
  manager: SignedInFixtureUser,
  relative: SignedInFixtureUser
) {
  seedVerifiedBilling(activeFixture, manager, { plan: 'family' })
  const personal = seedVerifiedBilling(activeFixture, relative, { plan: 'personal' })
  await sendWorkspaceInvitation(context(activeFixture, manager), {
    ownerUserId: manager.user.id,
    email: relative.user.email,
    appName: activeFixture.config.public.appName,
    appUrl: activeFixture.config.public.appUrl,
    sender: successfulSender
  })
  const created = activeFixture.connection.db
    .select({ id: invitation.id })
    .from(invitation)
    .where(eq(invitation.email, relative.user.email))
    .get()
  if (!created) throw new Error('Family invitation fixture is missing')

  await acceptWorkspaceInvitation(
    {
      ...context(activeFixture, relative),
      stripe: confirmedRenewalOffStripeClient(personal)
    },
    created.id,
    relative.user.id
  )
  return personal
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

const successfulSender: TransactionalEmailSender = {
  async send() {}
}
