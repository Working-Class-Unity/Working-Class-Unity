import type { DatabaseConnection } from '../connect'
import {
  requireFamilyManagerRemovalAuthority,
  requireFamilyManagerRemovalAuthorityForOrganization
} from './family-authority'

export type CapturedFamilyMemberRemoval = Readonly<{
  managerUserId: string
  memberReference: string
  organizationId: string
  targetUserId: string
}>

export type FamilyMemberRemovalResult = 'already_removed' | 'removed'

export function captureFamilyMemberRemovalTarget(
  connection: DatabaseConnection,
  input: Readonly<{ managerUserId: string; memberReference: string; now?: Date }>
): CapturedFamilyMemberRemoval | null {
  const authority = requireFamilyManagerRemovalAuthority(connection, input.managerUserId, input.now)
  const target = connection.sqlite
    .prepare(
      `select
         member.id as memberReference,
         member.organization_id as organizationId,
         member.user_id as targetUserId
       from member
       where member.id = ?
         and member.organization_id = ?
         and member.role = 'member'`
    )
    .get(input.memberReference, authority.organizationId) as
    | {
        memberReference: string
        organizationId: string
        targetUserId: string
      }
    | undefined

  if (!target) return null
  return {
    managerUserId: input.managerUserId,
    memberReference: target.memberReference,
    organizationId: target.organizationId,
    targetUserId: target.targetUserId
  }
}

/**
 * Better Auth 1.6.23 has no configured remove hooks in this app and teams are
 * disabled. Its manager-driven removeMember path also clears activeOrganizationId
 * only when the actor removes themself. This app-owned IMMEDIATE command therefore
 * performs the narrower required write: exact external membership plus stale
 * active-organization pointers, while every identity and private-data row remains.
 */
export function removeCapturedFamilyMember(
  connection: DatabaseConnection,
  captured: CapturedFamilyMemberRemoval,
  now = new Date(),
  onRemoved?: (targetUserId: string) => void
): FamilyMemberRemovalResult {
  return connection.sqlite
    .transaction(() => {
      requireFamilyManagerRemovalAuthorityForOrganization(connection, {
        managerUserId: captured.managerUserId,
        organizationId: captured.organizationId,
        now
      })

      const current = connection.sqlite
        .prepare(
          `select
             member.organization_id as organizationId,
             member.user_id as targetUserId,
             member.role
           from member
           where member.id = ?`
        )
        .get(captured.memberReference) as
        | {
            organizationId: string
            role: string
            targetUserId: string
          }
        | undefined

      if (!current) return 'already_removed'
      if (
        current.organizationId !== captured.organizationId ||
        current.targetUserId !== captured.targetUserId ||
        current.role !== 'member'
      ) {
        throw new Error('Captured Family member reference changed')
      }

      const removed = connection.sqlite
        .prepare(
          `delete from member
           where id = ?
             and organization_id = ?
             and user_id = ?
             and role = 'member'`
        )
        .run(captured.memberReference, captured.organizationId, captured.targetUserId)
      if (removed.changes !== 1) throw new Error('Captured Family membership changed during removal')

      connection.sqlite
        .prepare(
          `update session
           set
             active_organization_id = null,
             updated_at = ?
           where user_id = ?
             and active_organization_id = ?`
        )
        .run(now.getTime(), captured.targetUserId, captured.organizationId)
      onRemoved?.(captured.targetUserId)
      return 'removed'
    })
    .immediate()
}
