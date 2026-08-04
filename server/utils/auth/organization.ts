import { organization } from 'better-auth/plugins'
import type { OrganizationOptions } from 'better-auth/plugins/organization'
import { familyPlanCapacity } from '../../../shared/family-plan'
import { organizationAccessControl, organizationPluginRoles } from '../../../shared/organization-access'
import type { DatabaseConnection } from '../../db/connect'
import { assertCanAcceptFamilyInvitation } from '../../db/repositories/family-authority'

export const disabledOrganizationAuthPaths = [
  '/organization/create',
  '/organization/check-slug',
  '/organization/update',
  '/organization/delete',
  '/organization/set-active',
  '/organization/get-full-organization',
  '/organization/list',
  '/organization/invite-member',
  '/organization/cancel-invitation',
  '/organization/accept-invitation',
  '/organization/get-invitation',
  '/organization/reject-invitation',
  '/organization/list-invitations',
  '/organization/list-user-invitations',
  '/organization/get-active-member',
  '/organization/remove-member',
  '/organization/update-member-role',
  '/organization/leave',
  '/organization/list-members',
  '/organization/get-active-member-role',
  '/organization/has-permission'
] as const

export const organizationPluginOptions = {
  ac: organizationAccessControl,
  roles: organizationPluginRoles,
  creatorRole: 'owner',
  allowUserToCreateOrganization: false,
  membershipLimit: familyPlanCapacity,
  invitationLimit: 100,
  cancelPendingInvitationsOnReInvite: false,
  requireEmailVerificationOnInvitation: true,
  disableOrganizationDeletion: true,
  organizationHooks: {
    beforeCreateInvitation: async ({ invitation }) => ({
      data: {
        ...invitation,
        role: 'member'
      }
    })
  },
  teams: {
    enabled: false
  },
  dynamicAccessControl: {
    enabled: false
  },
  schema: {
    organization: {
      additionalFields: {
        personalOwnerUserId: {
          type: 'string',
          required: false,
          input: false,
          returned: false,
          unique: true,
          references: {
            model: 'user',
            field: 'id',
            onDelete: 'restrict'
          }
        }
      }
    }
  }
} as const satisfies OrganizationOptions

export type WorkspaceInvitationAdmission = Readonly<{
  invitationId: string
  organizationId: string
  role: string
  userId: string
}>

/** Better Auth owns recipient verification; persisted authority owns admission. */
export function assertWorkspaceInvitationAdmission(
  connection: DatabaseConnection,
  input: WorkspaceInvitationAdmission
): Promise<void> {
  if (input.role !== 'member') {
    throw new Error('Unsupported family-plan invitation role')
  }

  assertCanAcceptFamilyInvitation(connection, {
    invitationId: input.invitationId,
    organizationId: input.organizationId,
    userId: input.userId
  })
  return Promise.resolve()
}

export function createWorkspaceOrganizationPlugin(connection: DatabaseConnection) {
  // Delivery remains outside `sendInvitationEmail`: pinned Better Auth catches
  // that callback's rejection. The app invitation command sends synchronously
  // after Better Auth creates or reuses the pending invitation. Pinned resend
  // skips beforeCreateInvitation, so the app and database also enforce member.
  return organization({
    ...organizationPluginOptions,
    organizationHooks: {
      ...organizationPluginOptions.organizationHooks,
      beforeAcceptInvitation: ({ invitation, user }) =>
        assertWorkspaceInvitationAdmission(connection, {
          invitationId: invitation.id,
          organizationId: invitation.organizationId,
          role: invitation.role,
          userId: user.id
        })
    }
  })
}
