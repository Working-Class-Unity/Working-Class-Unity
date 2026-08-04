import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { compareAndSetPendingWorkspaceInvitationStatus } from '../server/db/repositories/workspace-invitations'
import { resolveWorkspaceMembershipByOrganizationIdForUser } from '../server/db/repositories/workspaces'
import { expirePendingFamilyInvitations } from '../server/services/jobs/family-invitation-expiration'
import {
  acceptWorkspaceInvitation,
  cancelWorkspaceInvitation,
  getWorkspaceInvitationForRecipient,
  rejectWorkspaceInvitation,
  sendWorkspaceInvitation,
  type WorkspaceInvitationAuthApi
} from '../server/services/workspace-invitations'
import {
  billingCheckoutAttempts,
  billingCustomers,
  billingSubscriptions,
  invitation,
  member,
  session,
  user
} from '../server/db/schema'
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

describe('workspace invitation recipient lifecycle', () => {
  it('shows only a minimized invitation to the verified matching recipient and conceals every ownership failure', async () => {
    fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('recipient-owner@example.test', 'Recipient Owner')
    const recipient = await fixture.signIn('recipient@example.test', 'Right Recipient')
    const intruder = await fixture.signIn('intruder@example.test', 'Wrong Recipient')
    const created = await createInvitation(fixture, owner, recipient.user.email)

    const view = await getWorkspaceInvitationForRecipient(context(fixture, recipient), created.id)
    expect(view).toEqual({
      workspace: { name: owner.workspace.name },
      expiresAt: expect.stringMatching(/Z$/)
    })
    expect(JSON.stringify(view)).not.toMatch(/recipient@example|intruder@example|organization_|inviter|slug/i)

    const wrongRecipient = getWorkspaceInvitationForRecipient(context(fixture, intruder), created.id)
    await expect(wrongRecipient).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Invitation not found'
    })
    await expectConcealedInvitationMutations(fixture, intruder, created.id, owner.workspace.id)

    fixture.connection.db.update(user).set({ emailVerified: false }).where(eq(user.id, recipient.user.id)).run()
    const unverifiedRecipient = getWorkspaceInvitationForRecipient(context(fixture, recipient), created.id)
    await expect(unverifiedRecipient).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Invitation not found'
    })
    await expectConcealedInvitationMutations(fixture, recipient, created.id, owner.workspace.id)

    fixture.connection.db.update(user).set({ emailVerified: true }).where(eq(user.id, recipient.user.id)).run()
    fixture.sqlite.exec('drop trigger invitation_member_role_before_update')
    fixture.connection.db.update(invitation).set({ role: 'admin' }).where(eq(invitation.id, created.id)).run()
    await expect(getWorkspaceInvitationForRecipient(context(fixture, recipient), created.id)).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Invitation not found'
    })
    await expect(
      acceptWorkspaceInvitation(context(fixture, recipient), created.id, recipient.user.id)
    ).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Invitation not found'
    })
    expect(invitationById(fixture, created.id)).toMatchObject({ role: 'admin', status: 'pending' })
    expect(
      fixture.connection.db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, owner.workspace.id), eq(member.userId, recipient.user.id)))
        .all()
    ).toEqual([])
  })

  it('atomically claims acceptance, reauthorizes by immutable organization ID, and enforces later loss', async () => {
    fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('concurrent-owner@example.test', 'Concurrent Owner')
    const recipient = await fixture.signIn('concurrent-recipient@example.test', 'Concurrent Recipient')
    const created = await createInvitation(fixture, owner, recipient.user.email)
    const recipientContext = context(fixture, recipient)

    const outcomes = await Promise.allSettled([
      acceptWorkspaceInvitation(recipientContext, created.id, recipient.user.id),
      acceptWorkspaceInvitation(recipientContext, created.id, recipient.user.id)
    ])
    const fulfilled = outcomes.filter((result) => result.status === 'fulfilled')
    const rejected = outcomes.filter((result) => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((fulfilled[0] as PromiseFulfilledResult<unknown>).value).toEqual({
      status: 'accepted',
      location: '/app'
    })

    const memberships = fixture.connection.db
      .select()
      .from(member)
      .where(and(eq(member.organizationId, owner.workspace.id), eq(member.userId, recipient.user.id)))
      .all()
    expect(memberships).toHaveLength(1)
    expect(invitationById(fixture, created.id)).toMatchObject({ status: 'accepted' })
    expect(
      resolveWorkspaceMembershipByOrganizationIdForUser(fixture.connection, recipient.user.id, owner.workspace.id)
    ).toMatchObject({
      id: owner.workspace.id,
      role: 'member'
    })

    const persistedSession = fixture.connection.db
      .select({ activeOrganizationId: session.activeOrganizationId })
      .from(session)
      .where(eq(session.userId, recipient.user.id))
      .get()
    expect(persistedSession).toEqual({ activeOrganizationId: owner.workspace.id })

    fixture.connection.db
      .delete(member)
      .where(and(eq(member.organizationId, owner.workspace.id), eq(member.userId, recipient.user.id)))
      .run()
    expect(
      resolveWorkspaceMembershipByOrganizationIdForUser(fixture.connection, recipient.user.id, owner.workspace.id)
    ).toBeNull()
    await expect(acceptWorkspaceInvitation(recipientContext, created.id, recipient.user.id)).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Invitation not found'
    })
  })

  it('conceals a reported acceptance when its persisted membership is missing', async () => {
    fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('missing-member-owner@example.test', 'Missing Member Owner')
    const recipient = await fixture.signIn('missing-member-recipient@example.test', 'Missing Member Recipient')
    const created = await createInvitation(fixture, owner, recipient.user.email)
    const actualApi = fixture.auth.api
    const incompleteApi = {
      ...actualApi,
      acceptInvitation: async (input: Parameters<WorkspaceInvitationAuthApi['acceptInvitation']>[0]) => {
        const result = await actualApi.acceptInvitation(input)
        fixture!.connection.db
          .delete(member)
          .where(and(eq(member.organizationId, owner.workspace.id), eq(member.userId, recipient.user.id)))
          .run()
        return result
      }
    } satisfies WorkspaceInvitationAuthApi

    await expect(
      acceptWorkspaceInvitation({ ...context(fixture, recipient), api: incompleteApi }, created.id, recipient.user.id)
    ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'Invitation not found' })
    expect(
      resolveWorkspaceMembershipByOrganizationIdForUser(fixture.connection, recipient.user.id, owner.workspace.id)
    ).toBeNull()
  })

  it('serializes acceptance against simultaneous cancellation and rejection', async () => {
    for (const terminalAction of ['cancel', 'reject'] as const) {
      const activeFixture = createWorkspaceInvitationFixture()

      try {
        const owner = await activeFixture.signIn(`${terminalAction}-owner@example.test`, `${terminalAction} owner`)
        const recipient = await activeFixture.signIn(
          `${terminalAction}-recipient@example.test`,
          `${terminalAction} recipient`
        )
        const created = await createInvitation(activeFixture, owner, recipient.user.email)
        const acceptGate = deferred<undefined>()
        const acceptStarted = deferred<undefined>()
        let terminalApiCalls = 0
        const actualApi = activeFixture.auth.api
        const coordinatedApi = {
          ...actualApi,
          acceptInvitation: async (input: Parameters<WorkspaceInvitationAuthApi['acceptInvitation']>[0]) => {
            acceptStarted.resolve(undefined)
            await acceptGate.promise
            return actualApi.acceptInvitation(input)
          },
          cancelInvitation: async (input: Parameters<WorkspaceInvitationAuthApi['cancelInvitation']>[0]) => {
            terminalApiCalls += 1
            return actualApi.cancelInvitation(input)
          },
          rejectInvitation: async (input: Parameters<WorkspaceInvitationAuthApi['rejectInvitation']>[0]) => {
            terminalApiCalls += 1
            return actualApi.rejectInvitation(input)
          }
        } satisfies WorkspaceInvitationAuthApi
        const recipientContext = { ...context(activeFixture, recipient), api: coordinatedApi }
        const ownerContext = { ...context(activeFixture, owner), api: coordinatedApi }
        const acceptance = acceptWorkspaceInvitation(recipientContext, created.id, recipient.user.id)
        await acceptStarted.promise
        const competingTerminalAction =
          terminalAction === 'cancel'
            ? cancelWorkspaceInvitation(ownerContext, owner.user.id, created.id)
            : rejectWorkspaceInvitation(recipientContext, created.id, recipient.user.id)

        await Promise.resolve()
        expect(terminalApiCalls).toBe(0)
        acceptGate.resolve(undefined)

        const [acceptOutcome, terminalOutcome] = await Promise.allSettled([acceptance, competingTerminalAction])
        expect(acceptOutcome).toMatchObject({
          status: 'fulfilled',
          value: { status: 'accepted', location: '/app' }
        })
        expect(terminalOutcome).toMatchObject({
          status: 'rejected',
          reason: { statusCode: 404, statusMessage: 'Invitation not found' }
        })
        expect(terminalApiCalls).toBe(0)
        expect(invitationById(activeFixture, created.id)).toMatchObject({ status: 'accepted' })
        expect(
          activeFixture.connection.db
            .select({ id: member.id })
            .from(member)
            .where(and(eq(member.organizationId, owner.workspace.id), eq(member.userId, recipient.user.id)))
            .all()
        ).toHaveLength(1)
      } finally {
        activeFixture.cleanup()
      }
    }
  })

  it('does not overwrite invitation state committed by acceptance or worker expiration', async () => {
    fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('terminal-cas-owner@example.test', 'Terminal CAS Owner')
    const acceptedRecipient = await fixture.signIn('terminal-cas-accepted@example.test', 'Accepted Recipient')
    const expiredRecipient = await fixture.signIn('terminal-cas-expired@example.test', 'Expired Recipient')
    const accepted = await createInvitation(fixture, owner, acceptedRecipient.user.email)
    const expired = await createInvitation(fixture, owner, expiredRecipient.user.email)

    await expect(
      acceptWorkspaceInvitation(context(fixture, acceptedRecipient), accepted.id, acceptedRecipient.user.id)
    ).resolves.toEqual({ status: 'accepted', location: '/app' })
    expect(
      fixture.sqlite
        .transaction(() =>
          compareAndSetPendingWorkspaceInvitationStatus(fixture!.connection, {
            invitationId: accepted.id,
            organizationId: owner.workspace.id,
            status: 'canceled'
          })
        )
        .immediate()
    ).toBe(false)
    expect(invitationById(fixture, accepted.id)).toMatchObject({ status: 'accepted' })

    const expiredAt = new Date(Date.now() - 1_000)
    fixture.connection.db.update(invitation).set({ expiresAt: expiredAt }).where(eq(invitation.id, expired.id)).run()
    expect(expirePendingFamilyInvitations(fixture.connection, { cursor: null }, new Date())).toMatchObject({
      expired: 1
    })
    expect(
      fixture.sqlite
        .transaction(() =>
          compareAndSetPendingWorkspaceInvitationStatus(fixture!.connection, {
            expectedEmail: expiredRecipient.user.email,
            invitationId: expired.id,
            organizationId: owner.workspace.id,
            status: 'rejected'
          })
        )
        .immediate()
    ).toBe(false)
    expect(invitationById(fixture, expired.id)).toMatchObject({ status: 'canceled' })
  })

  it('matches pinned expiry and rejection behavior: expired GET is concealed while explicit reject remains terminal', async () => {
    fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('expiry-owner@example.test', 'Expiry Owner')
    const recipient = await fixture.signIn('expiry-recipient@example.test', 'Expiry Recipient')
    const created = await createInvitation(fixture, owner, recipient.user.email)
    fixture.connection.db
      .update(invitation)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(invitation.id, created.id))
      .run()

    await expect(getWorkspaceInvitationForRecipient(context(fixture, recipient), created.id)).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Invitation not found'
    })
    await expect(
      rejectWorkspaceInvitation(context(fixture, recipient), created.id, recipient.user.id)
    ).resolves.toEqual({
      status: 'rejected'
    })
    expect(invitationById(fixture, created.id)).toMatchObject({ status: 'rejected' })
  })

  it('conceals an invalid invitation expiry returned by the auth boundary', async () => {
    fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('invalid-expiry-owner@example.test', 'Invalid Expiry Owner')
    const recipient = await fixture.signIn('invalid-expiry-recipient@example.test', 'Invalid Expiry Recipient')
    const created = await createInvitation(fixture, owner, recipient.user.email)
    const actualApi = fixture.auth.api
    const invalidExpiryApi = {
      ...actualApi,
      getInvitation: async (input: Parameters<WorkspaceInvitationAuthApi['getInvitation']>[0]) => ({
        ...(await actualApi.getInvitation(input)),
        expiresAt: 'not-a-date' as unknown as Date
      })
    } satisfies WorkspaceInvitationAuthApi

    await expect(
      getWorkspaceInvitationForRecipient({ ...context(fixture, recipient), api: invalidExpiryApi }, created.id)
    ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'Invitation not found' })
  })

  it('converts the reserved final seat to membership without double counting', async () => {
    fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('member-limit-owner@example.test', 'Member Limit Owner')
    const recipient = await fixture.signIn('member-limit-recipient@example.test', 'Member Limit Recipient')
    const created = await createInvitation(fixture, owner, recipient.user.email)
    const nowSeconds = Math.floor(Date.now() / 1000)
    const insertUser = fixture.sqlite.prepare(
      'insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)'
    )
    const insertMember = fixture.sqlite.prepare(
      'insert into member (id, organization_id, user_id, role, created_at) values (?, ?, ?, ?, ?)'
    )
    fixture.sqlite.transaction(() => {
      for (let index = 0; index < 4; index += 1) {
        const userId = `capacity_user_${index}`
        insertUser.run(userId, `Capacity ${index}`, `capacity-${index}@example.test`, nowSeconds, nowSeconds)
        insertMember.run(`capacity_member_${index}`, owner.workspace.id, userId, 'member', Date.now() + index)
      }
    })()
    await expect(
      acceptWorkspaceInvitation(context(fixture, recipient), created.id, recipient.user.id)
    ).resolves.toEqual({ status: 'accepted', location: '/app' })
    expect(invitationById(fixture, created.id)).toMatchObject({ status: 'accepted' })
    expect(
      fixture.connection.db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, owner.workspace.id), eq(member.userId, recipient.user.id)))
        .all()
    ).toHaveLength(1)
  })

  it('rejects a second family membership while leaving the unclaimed invitation pending', async () => {
    fixture = createWorkspaceInvitationFixture()
    const firstOwner = await fixture.signIn('first-family-owner@example.test', 'First Family Owner')
    const secondOwner = await fixture.signIn('second-family-owner@example.test', 'Second Family Owner')
    const recipient = await fixture.signIn('one-family-recipient@example.test', 'One Family Recipient')
    const firstInvitation = await createInvitation(fixture, firstOwner, recipient.user.email)
    const secondInvitation = await createInvitation(fixture, secondOwner, recipient.user.email)

    await expect(
      acceptWorkspaceInvitation(context(fixture, recipient), firstInvitation.id, recipient.user.id)
    ).resolves.toEqual({ status: 'accepted', location: '/app' })
    await expect(
      acceptWorkspaceInvitation(context(fixture, recipient), secondInvitation.id, recipient.user.id)
    ).rejects.toMatchObject({ statusCode: 409, statusMessage: 'Family invitation cannot be accepted right now' })

    expect(invitationById(fixture, secondInvitation.id)).toMatchObject({ status: 'pending' })
    expect(
      fixture.connection.db
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, recipient.user.id))
        .all()
        .filter(({ organizationId }) => organizationId !== recipient.workspace.id)
    ).toEqual([{ organizationId: firstOwner.workspace.id }])
  })

  it('lets exactly one of two distinct family invitations win concurrent acceptance', async () => {
    fixture = createWorkspaceInvitationFixture()
    const firstOwner = await fixture.signIn('race-first-owner@example.test', 'Race First Owner')
    const secondOwner = await fixture.signIn('race-second-owner@example.test', 'Race Second Owner')
    const recipient = await fixture.signIn('race-one-family@example.test', 'Race One Family')
    const firstInvitation = await createInvitation(fixture, firstOwner, recipient.user.email)
    const secondInvitation = await createInvitation(fixture, secondOwner, recipient.user.email)

    const outcomes = await Promise.allSettled([
      acceptWorkspaceInvitation(context(fixture, recipient), firstInvitation.id, recipient.user.id),
      acceptWorkspaceInvitation(context(fixture, recipient), secondInvitation.id, recipient.user.id)
    ])

    expect(outcomes.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected'])
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected')
    expect(rejected).toMatchObject({ reason: { statusCode: expect.any(Number) } })
    expect([404, 409]).toContain((rejected as PromiseRejectedResult).reason.statusCode)
    expect(
      fixture.connection.db
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, recipient.user.id))
        .all()
        .filter(({ organizationId }) => organizationId !== recipient.workspace.id)
    ).toHaveLength(1)
    expect(
      [invitationById(fixture, firstInvitation.id).status, invitationById(fixture, secondInvitation.id).status].sort()
    ).toEqual(['accepted', 'pending'])
  })

  it('rejects joining while the personal family has an accepted member or an unexpired outgoing invitation', async () => {
    fixture = createWorkspaceInvitationFixture()
    const targetOwner = await fixture.signIn('operated-target-owner@example.test', 'Target Owner')
    const recipient = await fixture.signIn('operated-recipient@example.test', 'Operated Recipient')
    const dependent = await fixture.signIn('operated-dependent@example.test', 'Operated Dependent')
    const targetInvitation = await createInvitation(fixture, targetOwner, recipient.user.email)
    const outgoing = await createInvitation(fixture, recipient, dependent.user.email)

    await expect(
      acceptWorkspaceInvitation(context(fixture, recipient), targetInvitation.id, recipient.user.id)
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(invitationById(fixture, targetInvitation.id)).toMatchObject({ status: 'pending' })

    await acceptWorkspaceInvitation(context(fixture, dependent), outgoing.id, dependent.user.id)
    await expect(
      acceptWorkspaceInvitation(context(fixture, recipient), targetInvitation.id, recipient.user.id)
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(invitationById(fixture, targetInvitation.id)).toMatchObject({ status: 'pending' })
  })

  it('treats only unexpired outgoing invitations as unresolved family operation', async () => {
    fixture = createWorkspaceInvitationFixture()
    const targetOwner = await fixture.signIn('expired-outgoing-owner@example.test', 'Target Owner')
    const recipient = await fixture.signIn('expired-outgoing-recipient@example.test', 'Recipient')
    const targetInvitation = await createInvitation(fixture, targetOwner, recipient.user.email)
    const outgoing = await createInvitation(fixture, recipient, 'future-relative@example.test')
    fixture.connection.db
      .update(invitation)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(invitation.id, outgoing.id))
      .run()
    fixture.connection.db
      .update(billingSubscriptions)
      .set({ cancelAtPeriodEnd: false, status: 'canceled' })
      .where(eq(billingSubscriptions.organizationId, recipient.workspace.id))
      .run()

    await expect(
      acceptWorkspaceInvitation(context(fixture, recipient), targetInvitation.id, recipient.user.id)
    ).resolves.toEqual({ status: 'accepted', location: '/app' })
  })

  it('blocks a non-current Personal subscription and allows retained terminal subscription history', async () => {
    fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-history-owner@example.test', 'Billing History Owner')
    const recipient = await fixture.signIn('billing-history-recipient@example.test', 'Billing History Recipient')
    const created = await createInvitation(fixture, owner, recipient.user.email)
    const personal = seedVerifiedBilling(fixture, recipient, { plan: 'personal', status: 'past_due' })
    await expect(
      acceptWorkspaceInvitation(context(fixture, recipient), created.id, recipient.user.id)
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(invitationById(fixture, created.id)).toMatchObject({ status: 'pending' })

    fixture.connection.db
      .update(billingSubscriptions)
      .set({ cancelAtPeriodEnd: true, status: 'canceled', updatedAt: new Date().toISOString() })
      .where(eq(billingSubscriptions.id, personal.subscriptionId))
      .run()
    await expect(
      acceptWorkspaceInvitation(context(fixture, recipient), created.id, recipient.user.id)
    ).rejects.toMatchObject({ statusCode: 409 })

    fixture.connection.db
      .update(billingSubscriptions)
      .set({ cancelAtPeriodEnd: false, updatedAt: new Date().toISOString() })
      .where(eq(billingSubscriptions.id, personal.subscriptionId))
      .run()
    await expect(
      acceptWorkspaceInvitation(context(fixture, recipient), created.id, recipient.user.id)
    ).resolves.toEqual({ status: 'accepted', location: '/app' })
  })

  it('allows a retained customer-only provider record that is not current billing authority', async () => {
    fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('customer-history-owner@example.test', 'Customer History Owner')
    const recipient = await fixture.signIn('customer-history-recipient@example.test', 'Customer History Recipient')
    const created = await createInvitation(fixture, owner, recipient.user.email)
    const now = new Date().toISOString()
    fixture.connection.db
      .insert(billingCustomers)
      .values({
        id: 'billing_customer_only_history',
        organizationId: recipient.workspace.id,
        stripeCustomerId: 'cus_only_history',
        createdAt: now,
        updatedAt: now
      })
      .run()

    await expect(
      acceptWorkspaceInvitation(context(fixture, recipient), created.id, recipient.user.id)
    ).resolves.toEqual({ status: 'accepted', location: '/app' })
  })

  it('blocks an open personal Checkout attempt and allows retry after it becomes terminal', async () => {
    fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('checkout-authority-owner@example.test', 'Checkout Authority Owner')
    const recipient = await fixture.signIn('checkout-authority-recipient@example.test', 'Checkout Authority Recipient')
    const created = await createInvitation(fixture, owner, recipient.user.email)
    const now = new Date().toISOString()

    fixture.connection.db
      .insert(billingCheckoutAttempts)
      .values({
        id: 'billing_attempt_authority',
        organizationId: recipient.workspace.id,
        planKey: 'family',
        cadence: 'monthly',
        stripePriceId: 'price_family_authority',
        idempotencyKey: 'checkout_authority',
        state: 'pending',
        successUrl: 'https://app.example.test/account/billing?checkout=success',
        cancelUrl: 'https://app.example.test/account/billing?checkout=cancel',
        reuseUntil: new Date(Date.now() + 60_000).toISOString(),
        createdAt: now,
        updatedAt: now
      })
      .run()
    await expect(
      acceptWorkspaceInvitation(context(fixture, recipient), created.id, recipient.user.id)
    ).rejects.toMatchObject({ statusCode: 409 })

    fixture.connection.db
      .update(billingCheckoutAttempts)
      .set({ state: 'expired', updatedAt: new Date().toISOString() })
      .where(eq(billingCheckoutAttempts.id, 'billing_attempt_authority'))
      .run()
    await expect(
      acceptWorkspaceInvitation(context(fixture, recipient), created.id, recipient.user.id)
    ).resolves.toEqual({ status: 'accepted', location: '/app' })
  })

  it('repairs the pinned transaction:false partial result when membership persists', async () => {
    fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('partial-owner@example.test', 'Partial Owner')
    const recipient = await fixture.signIn('partial-recipient@example.test', 'Partial Recipient')
    const created = await createInvitation(fixture, owner, recipient.user.email)
    fixture.sqlite.exec(`
      CREATE TRIGGER test_fail_active_organization_update
      BEFORE UPDATE OF active_organization_id ON session
      WHEN new.active_organization_id IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'injected active organization failure');
      END
    `)

    await expect(
      acceptWorkspaceInvitation(context(fixture, recipient), created.id, recipient.user.id)
    ).resolves.toEqual({ status: 'accepted', location: '/app' })
    expect(invitationById(fixture, created.id)).toMatchObject({ status: 'accepted' })
    expect(
      fixture.connection.db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, owner.workspace.id), eq(member.userId, recipient.user.id)))
        .all()
    ).toHaveLength(1)
    expect(
      fixture.connection.db
        .select({ activeOrganizationId: session.activeOrganizationId })
        .from(session)
        .where(eq(session.userId, recipient.user.id))
        .get()
    ).toEqual({ activeOrganizationId: null })
  })

  it('does not enlist unrelated acknowledged writes while Better Auth acceptance is suspended', async () => {
    fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('suspended-owner@example.test', 'Suspended Owner')
    const recipient = await fixture.signIn('suspended-recipient@example.test', 'Suspended Recipient')
    const created = await createInvitation(fixture, owner, recipient.user.email)
    const acceptanceStarted = deferred<undefined>()
    const acceptanceMayFail = deferred<undefined>()
    const actualApi = fixture.auth.api
    const failingApi = {
      ...actualApi,
      acceptInvitation: async () => {
        acceptanceStarted.resolve(undefined)
        await acceptanceMayFail.promise
        throw new Error('injected Better Auth acceptance failure')
      }
    } satisfies WorkspaceInvitationAuthApi
    fixture.sqlite.exec('create table unrelated_acceptance_write (id text primary key)')

    const acceptance = acceptWorkspaceInvitation(
      { ...context(fixture, recipient), api: failingApi },
      created.id,
      recipient.user.id
    )
    await acceptanceStarted.promise

    const acknowledged = fixture.sqlite
      .prepare('insert into unrelated_acceptance_write (id) values (?)')
      .run('acknowledged')
    let nestedTransactionError: unknown
    try {
      fixture.sqlite.exec('begin immediate')
      fixture.sqlite.prepare('insert into unrelated_acceptance_write (id) values (?)').run('separate-transaction')
      fixture.sqlite.exec('commit')
    } catch (error) {
      nestedTransactionError = error
    } finally {
      acceptanceMayFail.resolve(undefined)
    }

    await expect(acceptance).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Invitation not found'
    })
    expect(acknowledged.changes).toBe(1)
    expect(nestedTransactionError).toBeUndefined()
    expect(fixture.sqlite.prepare('select id from unrelated_acceptance_write order by id').all()).toEqual([
      { id: 'acknowledged' },
      { id: 'separate-transaction' }
    ])
    expect(fixture.sqlite.inTransaction).toBe(false)
  })
})

function context(activeFixture: WorkspaceInvitationFixture, actor: SignedInFixtureUser) {
  return { api: activeFixture.auth.api, connection: activeFixture.connection, headers: actor.headers }
}

async function createInvitation(activeFixture: WorkspaceInvitationFixture, owner: SignedInFixtureUser, email: string) {
  const existingBilling = activeFixture.connection.db
    .select({ id: billingSubscriptions.id })
    .from(billingSubscriptions)
    .where(eq(billingSubscriptions.organizationId, owner.workspace.id))
    .get()
  if (!existingBilling) seedVerifiedBilling(activeFixture, owner, { plan: 'family' })
  await sendWorkspaceInvitation(context(activeFixture, owner), {
    ownerUserId: owner.user.id,
    email,
    appName: activeFixture.config.public.appName,
    appUrl: activeFixture.config.public.appUrl,
    sender: successfulSender
  })

  const created = activeFixture.connection.db
    .select()
    .from(invitation)
    .where(and(eq(invitation.email, email), eq(invitation.organizationId, owner.workspace.id)))
    .get()
  if (!created) throw new Error('Invitation fixture was not created')
  return created
}

const successfulSender: TransactionalEmailSender = {
  async send() {}
}

async function expectConcealedInvitationMutations(
  activeFixture: WorkspaceInvitationFixture,
  actor: SignedInFixtureUser,
  invitationId: string,
  organizationId: string
) {
  await expect(
    acceptWorkspaceInvitation(context(activeFixture, actor), invitationId, actor.user.id)
  ).rejects.toMatchObject({
    statusCode: 404,
    statusMessage: 'Invitation not found'
  })
  await expect(
    rejectWorkspaceInvitation(context(activeFixture, actor), invitationId, actor.user.id)
  ).rejects.toMatchObject({
    statusCode: 404,
    statusMessage: 'Invitation not found'
  })
  expect(invitationById(activeFixture, invitationId)).toMatchObject({ status: 'pending' })
  expect(
    activeFixture.connection.db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, actor.user.id)))
      .all()
  ).toEqual([])
}

function invitationById(activeFixture: WorkspaceInvitationFixture, invitationId: string) {
  const row = activeFixture.connection.db.select().from(invitation).where(eq(invitation.id, invitationId)).get()
  if (!row) throw new Error('Invitation fixture row is missing')
  return row
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}
