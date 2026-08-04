import type { DatabaseConnection } from '../db/connect'
import { FamilyAuthorityInvariantError, getExternalFamilyMembership } from '../db/repositories/family-authority'
import { configurationError, conflictError } from '../utils/errors'

export type FamilyMembershipServiceContext = Readonly<{
  connection: DatabaseConnection
}>

/**
 * Better Auth 1.6.23's leave endpoint performs a member delete followed by a
 * separate active-session update and does not invoke configured member hooks.
 * This app-owned transaction preserves that narrow behavior atomically for the
 * single persisted external-family membership.
 */
export async function leaveJoinedFamily(
  context: FamilyMembershipServiceContext,
  userId: string
): Promise<Readonly<{ status: 'left' }>> {
  context.connection.sqlite
    .transaction(() => {
      const membership = resolveExternalMembership(context.connection, userId)
      if (!membership) throw conflictError('No joined family membership to leave')

      const removed = context.connection.sqlite
        .prepare(
          `delete from member
           where id = ?
             and organization_id = ?
             and user_id = ?
             and role = 'member'`
        )
        .run(membership.id, membership.organizationId, userId)
      if (removed.changes !== 1) {
        throw configurationError('Family membership is temporarily unavailable')
      }

      context.connection.sqlite
        .prepare(
          `update session
           set active_organization_id = null, updated_at = ?
           where user_id = ?
             and active_organization_id = ?`
        )
        .run(Date.now(), userId, membership.organizationId)
    })
    .immediate()

  return Object.freeze({ status: 'left' as const })
}

function resolveExternalMembership(connection: DatabaseConnection, userId: string) {
  try {
    return getExternalFamilyMembership(connection, userId)
  } catch (error) {
    if (error instanceof FamilyAuthorityInvariantError) {
      throw configurationError('Family membership is temporarily unavailable')
    }
    throw error
  }
}
