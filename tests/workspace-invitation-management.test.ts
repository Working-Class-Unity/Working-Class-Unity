import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { hasExternalFamilyMembership } from '../server/db/repositories/family-authority'
import {
  cancelWorkspaceInvitation,
  listWorkspaceInvitationSummaries,
  resendWorkspaceInvitation,
  sendWorkspaceInvitation,
  type WorkspaceInvitationAuthApi
} from '../server/services/workspace-invitations'
import { billingSubscriptions, invitation, session } from '../server/db/schema'
import type { TransactionalEmailMessage, TransactionalEmailSender } from '../server/services/email'
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

describe('family-plan invitation management', () => {
  it('creates one member invitation and sends one minimized opaque application link', async () => {
    fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('owner@example.test', 'Owner Person')
    const sender = captureSender()

    await expect(send(fixture, owner, sender, 'SHARED.PERSON@EXAMPLE.TEST')).resolves.toEqual({ status: 'sent' })

    const rows = fixture.connection.db.select().from(invitation).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      email: 'shared.person@example.test',
      organizationId: owner.workspace.id,
      inviterId: owner.user.id,
      role: 'member',
      status: 'pending'
    })
    expect(rows[0]!.id).toMatch(/^[A-Za-z0-9_-]{1,128}$/)
    expect(rows[0]!.expiresAt.getTime() - Date.now()).toBeGreaterThan(47 * 60 * 60 * 1000)
    expect(rows[0]!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(48 * 60 * 60 * 1000)

    expect(sender.messages).toHaveLength(1)
    const message = sender.messages[0]!
    const expectedUrl = `http://localhost:3000/invite/${rows[0]!.id}`
    expect(message.to).toBe('shared.person@example.test')
    expect(message.subject).toBe('Workspace invitation')
    expect(message.text.match(new RegExp(expectedUrl, 'g'))).toHaveLength(1)
    expect(message.html.match(new RegExp(expectedUrl, 'g'))).toHaveLength(1)
    expect(message.text).not.toContain(owner.user.email)
    expect(message.html).not.toContain(owner.user.email)
  })

  it('lets exactly one concurrent reservation claim the final Family seat', async () => {
    fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('concurrent-owner@example.test', 'Concurrent Owner')
    ensureFamilyManagerBilling(fixture, owner)
    const now = Date.now()
    const insert = fixture.sqlite.prepare(
      'insert into invitation (id, organization_id, email, role, status, expires_at, created_at, inviter_id) values (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    fixture.sqlite.transaction(() => {
      for (let index = 0; index < 4; index += 1) {
        insert.run(
          `concurrent_reserved_${index}`,
          owner.workspace.id,
          `concurrent-reserved-${index}@example.test`,
          'member',
          'pending',
          now + 60 * 60 * 1_000,
          now + index,
          owner.user.id
        )
      }
    })()
    const context = { api: fixture.auth.api, connection: fixture.connection, headers: owner.headers }
    const input = (email: string) => ({
      ownerUserId: owner.user.id,
      email,
      appName: fixture!.config.public.appName,
      appUrl: fixture!.config.public.appUrl,
      sender: captureSender()
    })

    const outcomes = await Promise.allSettled([
      sendWorkspaceInvitation(context, input('concurrent-first@example.test')),
      sendWorkspaceInvitation(context, input('concurrent-second@example.test'))
    ])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ statusCode: 409, statusMessage: 'Invitation cannot be created' })
      })
    ])
    expect(fixture.connection.db.select().from(invitation).all()).toHaveLength(5)
  })

  it('reports delivery failure generically and explicitly resends the same member invitation', async () => {
    fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delivery-owner@example.test', 'Delivery Owner')

    await expect(send(fixture, owner, captureSender(true), 'delivery-recipient@example.test')).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Invitation delivery is temporarily unavailable'
    })

    const pending = fixture.connection.db.select().from(invitation).get()!
    fixture.connection.db
      .update(invitation)
      .set({ expiresAt: new Date(Date.now() + 60_000) })
      .where(eq(invitation.id, pending.id))
      .run()

    const sender = captureSender()
    await expect(resend(fixture, owner, sender, pending.id)).resolves.toEqual({ status: 'resent' })

    const rows = fixture.connection.db.select().from(invitation).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: pending.id, role: 'member', status: 'pending' })
    expect(rows[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 47 * 60 * 60 * 1000)
    expect(sender.messages[0]?.text).toContain('as a member')
  })

  it('owns invitation creation and resend without Better Auth mutation calls', async () => {
    fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('app-owned-owner@example.test', 'App-owned Owner')
    const sender = captureSender()
    const appOwnedApi = {
      ...fixture.auth.api,
      createInvitation: async () => {
        throw new Error('Better Auth invitation mutation must not be called')
      }
    } satisfies WorkspaceInvitationAuthApi

    ensureFamilyManagerBilling(fixture, owner)
    await expect(
      sendWorkspaceInvitation(
        { api: appOwnedApi, connection: fixture.connection, headers: owner.headers },
        {
          ownerUserId: owner.user.id,
          email: 'app-owned-recipient@example.test',
          appName: fixture.config.public.appName,
          appUrl: fixture.config.public.appUrl,
          sender
        }
      )
    ).resolves.toEqual({ status: 'sent' })

    const created = invitationFor(fixture, 'app-owned-recipient@example.test')
    await expect(
      resendWorkspaceInvitation(
        { api: appOwnedApi, connection: fixture.connection, headers: owner.headers },
        resendInput(fixture, owner, sender, created.id)
      )
    ).resolves.toEqual({ status: 'resent' })
    expect(sender.messages).toHaveLength(2)
    expect(fixture.connection.db.select().from(invitation).all()).toHaveLength(1)
  })

  it('keeps joined-group selection non-authoritative, fixes invitation roles, and blocks dormant-family management', async () => {
    fixture = createWorkspaceInvitationFixture()
    const firstOwner = await fixture.signIn('first-owner@example.test', 'First Owner')
    const secondOwner = await fixture.signIn('second-owner@example.test', 'Second Owner')

    await send(fixture, firstOwner, captureSender(), secondOwner.user.email)
    await fixture.auth.api.acceptInvitation({
      headers: secondOwner.headers,
      body: { invitationId: invitationFor(fixture, secondOwner.user.email).id }
    })
    expect(
      fixture.connection.db
        .select({ activeOrganizationId: session.activeOrganizationId })
        .from(session)
        .where(eq(session.userId, secondOwner.user.id))
        .get()
    ).toEqual({ activeOrganizationId: firstOwner.workspace.id })

    await expect(
      fixture.auth.api.createInvitation({
        headers: secondOwner.headers,
        body: {
          email: 'forbidden-target@example.test',
          role: 'member',
          organizationId: firstOwner.workspace.id,
          resend: false
        }
      })
    ).rejects.toMatchObject({ statusCode: 403 })

    await expect(send(fixture, secondOwner, captureSender(), 'second-family@example.test')).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Family management is unavailable while sharing another plan'
    })
    expect(() => listWorkspaceInvitationSummaries({ connection: fixture!.connection }, secondOwner.user.id)).toThrow(
      expect.objectContaining({ statusCode: 403 })
    )
    await expect(resend(fixture, secondOwner, captureSender(), 'opaque-invitation')).rejects.toMatchObject({
      statusCode: 403
    })
    await expect(
      cancelWorkspaceInvitation(
        { api: fixture.auth.api, connection: fixture.connection, headers: secondOwner.headers },
        secondOwner.user.id,
        'opaque-invitation'
      )
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(
      fixture.connection.db.select().from(invitation).where(eq(invitation.email, 'second-family@example.test')).get()
    ).toBeUndefined()

    await expect(
      fixture.auth.api.createInvitation({
        headers: firstOwner.headers,
        body: {
          email: 'role-injection@example.test',
          role: 'admin',
          organizationId: firstOwner.workspace.id,
          resend: false
        }
      })
    ).resolves.toMatchObject({ role: 'member' })
  })

  it('enforces five reserved member seats and returns bounded role-free projections', async () => {
    fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('limit-owner@example.test', 'Limit Owner')
    const now = Date.now()
    const insert = fixture.sqlite.prepare(
      'insert into invitation (id, organization_id, email, role, status, expires_at, created_at, inviter_id) values (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    fixture.sqlite.transaction(() => {
      for (let index = 0; index < 5; index += 1) {
        insert.run(
          `limit_invitation_${index}`,
          owner.workspace.id,
          `pending-${index}@example.test`,
          'member',
          'pending',
          now + 60 * 60 * 1000,
          now + index,
          owner.user.id
        )
      }
    })()

    await expect(send(fixture, owner, captureSender(), 'over-limit@example.test')).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'Invitation cannot be created'
    })

    const summaries = listWorkspaceInvitationSummaries({ connection: fixture.connection }, owner.user.id)
    expect(summaries).toHaveLength(5)
    expect(summaries[0]).toEqual({
      id: expect.any(String),
      email: expect.stringMatching(/@example\.test$/),
      expiresAt: expect.stringMatching(/Z$/)
    })
    expect(Object.keys(summaries[0]!).toSorted()).toEqual(['email', 'expiresAt', 'id'])
  })

  it('treats pending invitations as reservations and releases a seat only after expiry', async () => {
    fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('capacity-owner@example.test', 'Capacity Owner')
    const now = Date.now()
    const insertInvitation = fixture.sqlite.prepare(
      'insert into invitation (id, organization_id, email, role, status, expires_at, created_at, inviter_id) values (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    for (let index = 0; index < 5; index += 1) {
      insertInvitation.run(
        `capacity_pending_${index}`,
        owner.workspace.id,
        `capacity-pending-${index}@example.test`,
        'member',
        'pending',
        now + 60_000,
        now + index,
        owner.user.id
      )
    }

    await expect(send(fixture, owner, captureSender(), 'pending-is-reserved@example.test')).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'Invitation cannot be created'
    })

    fixture.connection.db
      .update(invitation)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(invitation.id, 'capacity_pending_0'))
      .run()
    await expect(send(fixture, owner, captureSender(), 'expired-seat-reused@example.test')).resolves.toEqual({
      status: 'sent'
    })
  })

  it('fails closed when persisted external family authority is malformed', async () => {
    fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('malformed-family-owner@example.test', 'Malformed Family Owner')
    const sender = captureSender()
    const now = Date.now()

    fixture.sqlite.exec('drop trigger member_external_family_authority_before_insert')
    fixture.sqlite
      .prepare(
        `insert into organization (id, name, slug, created_at, personal_owner_user_id)
         values (?, ?, ?, ?, null)`
      )
      .run('malformed_external_family', 'Malformed external family', 'malformed-external-family', now)
    fixture.sqlite
      .prepare('insert into member (id, organization_id, user_id, role, created_at) values (?, ?, ?, ?, ?)')
      .run('malformed_external_member', 'malformed_external_family', owner.user.id, 'member', now)

    await expect(send(fixture, owner, sender, 'blocked-recipient@example.test')).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Family plan is temporarily unavailable'
    })
    expect(sender.messages).toHaveLength(0)
    expect(fixture.connection.db.select().from(invitation).all()).toHaveLength(0)
  })

  it('binds resend and cancellation to the marker owner and pending invitation ID', async () => {
    fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('cancel-owner@example.test', 'Cancel Owner')
    const otherOwner = await fixture.signIn('other-owner@example.test', 'Other Owner')
    await send(fixture, owner, captureSender(), 'cancel@example.test')
    const created = invitationFor(fixture, 'cancel@example.test')

    await expect(resend(fixture, otherOwner, captureSender(), created.id)).rejects.toMatchObject({ statusCode: 404 })
    expect(() => listWorkspaceInvitationSummaries({ connection: fixture.connection }, 'missing-owner')).toThrow(
      expect.objectContaining({ statusCode: 503, statusMessage: 'Family plan is temporarily unavailable' })
    )
    const otherContext = { api: fixture.auth.api, connection: fixture.connection, headers: otherOwner.headers }
    await expect(cancelWorkspaceInvitation(otherContext, otherOwner.user.id, created.id)).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Invitation not found'
    })

    const ownerContext = { api: fixture.auth.api, connection: fixture.connection, headers: owner.headers }
    await expect(cancelWorkspaceInvitation(ownerContext, owner.user.id, created.id)).resolves.toEqual({
      status: 'canceled'
    })
    expect(invitationFor(fixture, 'cancel@example.test')).toMatchObject({ status: 'canceled' })
    await expect(cancelWorkspaceInvitation(ownerContext, owner.user.id, created.id)).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Invitation not found'
    })
  })
})

function send(
  activeFixture: WorkspaceInvitationFixture,
  actor: SignedInFixtureUser,
  sender: ReturnType<typeof captureSender>,
  email: string
) {
  ensureFamilyManagerBilling(activeFixture, actor)
  return sendWorkspaceInvitation(
    { api: activeFixture.auth.api, connection: activeFixture.connection, headers: actor.headers },
    {
      ownerUserId: actor.user.id,
      email,
      appName: activeFixture.config.public.appName,
      appUrl: activeFixture.config.public.appUrl,
      sender
    }
  )
}

function resend(
  activeFixture: WorkspaceInvitationFixture,
  actor: SignedInFixtureUser,
  sender: ReturnType<typeof captureSender>,
  invitationId: string
) {
  ensureFamilyManagerBilling(activeFixture, actor)
  return resendWorkspaceInvitation(
    { api: activeFixture.auth.api, connection: activeFixture.connection, headers: actor.headers },
    resendInput(activeFixture, actor, sender, invitationId)
  )
}

function ensureFamilyManagerBilling(activeFixture: WorkspaceInvitationFixture, actor: SignedInFixtureUser) {
  try {
    if (hasExternalFamilyMembership(activeFixture.connection, actor.user.id)) return
  } catch {
    // Preserve malformed-authority fixtures for the production service to map.
    return
  }
  const existing = activeFixture.connection.db
    .select({ id: billingSubscriptions.id })
    .from(billingSubscriptions)
    .where(eq(billingSubscriptions.organizationId, actor.workspace.id))
    .get()
  if (!existing) seedVerifiedBilling(activeFixture, actor, { plan: 'family' })
}

function resendInput(
  activeFixture: WorkspaceInvitationFixture,
  actor: SignedInFixtureUser,
  sender: ReturnType<typeof captureSender>,
  invitationId: string
) {
  return {
    ownerUserId: actor.user.id,
    invitationId,
    appName: activeFixture.config.public.appName,
    appUrl: activeFixture.config.public.appUrl,
    sender
  }
}

function invitationFor(activeFixture: WorkspaceInvitationFixture, email: string) {
  const row = activeFixture.connection.db.select().from(invitation).where(eq(invitation.email, email)).get()
  if (!row) throw new Error(`Invitation fixture missing for ${email}`)
  return row
}

function captureSender(fail = false): TransactionalEmailSender & { messages: TransactionalEmailMessage[] } {
  const messages: TransactionalEmailMessage[] = []
  return {
    messages,
    async send(message) {
      messages.push(message)
      if (fail) throw new Error('injected delivery failure')
    }
  }
}
