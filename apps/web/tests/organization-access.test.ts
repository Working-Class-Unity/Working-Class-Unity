import { defaultStatements } from 'better-auth/plugins/organization/access'
import { describe, expect, it } from 'vitest'
import {
  billingActions,
  memberRole,
  organizationPluginRoles,
  organizationStatements,
  ownerRole
} from '../shared/organization-access'

const expectedRoleStatements = {
  owner: {
    organization: [],
    member: [],
    invitation: ['create', 'cancel'],
    team: [],
    ac: [],
    billing: billingActions
  },
  member: {
    organization: [],
    member: [],
    invitation: [],
    team: [],
    ac: [],
    billing: []
  }
} as const

describe('Better Auth workspace access control', () => {
  it('keeps private project authority out of Organization and adds only billing actions', () => {
    expect(organizationStatements).toEqual({
      ...defaultStatements,
      billing: ['read', 'manage']
    })
    expect(ownerRole.statements).toEqual(expectedRoleStatements.owner)
    expect(memberRole.statements).toEqual(expectedRoleStatements.member)
    expect(organizationPluginRoles.admin.statements).toEqual(expectedRoleStatements.member)
  })
})
