import { afterEach, describe, expect, it } from 'vitest'
import {
  assertCanAcceptFamilyInvitation,
  getExternalFamilyMembership
} from '../server/db/repositories/family-authority'
import { getBillingStateForConnection } from '../server/services/payments/billing-service'
import {
  createWorkspaceInvitationFixture,
  type SignedInFixtureUser,
  type WorkspaceInvitationFixture
} from './helpers/workspace-invitation-fixture'

let fixture: WorkspaceInvitationFixture | undefined

afterEach(() => {
  fixture?.cleanup()
  fixture = undefined
})

describe('persisted family authority corruption', () => {
  it('fails closed when legacy or corrupt state contains two external family memberships', async () => {
    fixture = createWorkspaceInvitationFixture()
    const firstManager = await fixture.signIn('duplicate-first-manager@example.test', 'First Manager')
    const secondManager = await fixture.signIn('duplicate-second-manager@example.test', 'Second Manager')
    const relative = await fixture.signIn('duplicate-relative@example.test', 'Duplicate Relative')
    fixture.sqlite.exec('drop index member_one_external_family_uidx')
    insertExternalMembership(fixture, firstManager, relative, 'member_duplicate_first')
    insertExternalMembership(fixture, secondManager, relative, 'member_duplicate_second')

    expect(() => getExternalFamilyMembership(fixture!.connection, relative.user.id)).toThrow(
      expect.objectContaining({
        name: 'FamilyAuthorityInvariantError',
        message: 'User belongs to more than one external family'
      })
    )
    expect(() => getBillingStateForConnection(fixture!.connection, relative.user.id)).toThrow(
      expect.objectContaining({
        statusCode: 503,
        statusMessage: 'Billing is temporarily unavailable'
      })
    )
  })

  it('fails closed when an external member row points to an organization without a personal manager', async () => {
    fixture = createWorkspaceInvitationFixture()
    const relative = await fixture.signIn('markerless-relative@example.test', 'Markerless Relative')
    fixture.sqlite.exec('drop trigger member_external_family_authority_before_insert')
    fixture.sqlite
      .prepare(
        `insert into organization (id, name, slug, created_at, personal_owner_user_id)
         values ('organization_markerless', 'Markerless', 'markerless-family', ?, null)`
      )
      .run(Date.now())
    fixture.sqlite
      .prepare(
        `insert into member (id, organization_id, user_id, role, created_at)
         values ('member_markerless', 'organization_markerless', ?, 'member', ?)`
      )
      .run(relative.user.id, Date.now())

    expect(() => getExternalFamilyMembership(fixture!.connection, relative.user.id)).toThrow(
      expect.objectContaining({
        name: 'FamilyAuthorityInvariantError',
        message: 'External family membership is malformed'
      })
    )
  })

  it('rejects missing, self-owned, and ownerless invitation targets without choosing an authority', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('invalid-target-manager@example.test', 'Target Manager')
    const recipient = await fixture.signIn('invalid-target-recipient@example.test', 'Target Recipient')

    for (const organizationId of ['organization_missing', recipient.workspace.id]) {
      expect(() =>
        assertCanAcceptFamilyInvitation(fixture!.connection, {
          organizationId,
          userId: recipient.user.id
        })
      ).toThrow(
        expect.objectContaining({
          name: 'FamilyAuthorityInvariantError',
          message: 'Invitation does not target another personal family'
        })
      )
    }

    fixture.sqlite.exec('drop trigger member_family_owner_after_delete')
    fixture.sqlite
      .prepare("delete from member where organization_id = ? and user_id = ? and role = 'owner'")
      .run(recipient.workspace.id, recipient.user.id)
    expect(() =>
      assertCanAcceptFamilyInvitation(fixture!.connection, {
        organizationId: manager.workspace.id,
        userId: recipient.user.id
      })
    ).toThrow(
      expect.objectContaining({
        name: 'FamilyAuthorityInvariantError',
        message: 'Personal family organization is missing'
      })
    )
  })
})

function insertExternalMembership(
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
