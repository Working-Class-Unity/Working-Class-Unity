import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements } from 'better-auth/plugins/organization/access'

export const billingActions = ['read', 'manage'] as const

// Better Auth Organization owns family-plan membership and invitation
// permissions. Private application resources are authorized by their own
// user/resource predicates and deliberately do not appear here.
export const organizationStatements = {
  ...defaultStatements,
  billing: billingActions
} as const

export const organizationAccessControl = createAccessControl(organizationStatements)

export const ownerRole = organizationAccessControl.newRole({
  organization: [],
  member: [],
  invitation: ['create', 'cancel'],
  team: [],
  ac: [],
  billing: billingActions
})

export const memberRole = organizationAccessControl.newRole({
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: [],
  billing: []
})

export const organizationRoles = {
  owner: ownerRole,
  member: memberRole
} as const

// Better Auth 1.6.23 merges its built-in static roles with configured roles.
// Override its compatibility name so malformed or externally supplied `admin`
// input has no authority, while keeping it out of persistence, application
// types, and DTOs entirely.
export const organizationPluginRoles = {
  ...organizationRoles,
  admin: memberRole
} as const
