import { and, eq } from 'drizzle-orm'
import type { DatabaseConnection } from '../connect'
import { member, organization, type OrganizationRole } from '../schema'

export type WorkspaceMembershipView = {
  id: string
  name: string
  slug: string
  role: OrganizationRole
  isPersonal: boolean
}

export function getPersonalWorkspaceForUser(
  connection: DatabaseConnection,
  userId: string
): WorkspaceMembershipView | null {
  const result = connection.db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: member.role
    })
    .from(organization)
    .innerJoin(member, and(eq(member.organizationId, organization.id), eq(member.userId, userId)))
    .where(eq(organization.personalOwnerUserId, userId))
    .get()

  return result ? { ...result, isPersonal: true } : null
}

export function resolveWorkspaceMembershipByOrganizationIdForUser(
  connection: DatabaseConnection,
  userId: string,
  organizationId: string
): WorkspaceMembershipView | null {
  const result = connection.db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: member.role,
      personalOwnerUserId: organization.personalOwnerUserId
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(eq(member.userId, userId), eq(organization.id, organizationId)))
    .get()

  if (!result) {
    return null
  }

  const { personalOwnerUserId, ...membership } = result
  return {
    ...membership,
    isPersonal: personalOwnerUserId === userId
  }
}
