import type { DatabaseConnection } from '../db/connect'
import { captureFamilyMemberRemovalTarget, removeCapturedFamilyMember } from '../db/repositories/family-member-removal'
import { FamilyAuthorityInvariantError, FamilyManagerBillingConflictError } from '../db/repositories/family-authority'
import { configurationError, conflictError, notFoundError } from '../utils/errors'
import { enqueueBillingNotificationDelivery } from './payments/billing-notification-delivery'

export type FamilyMemberRemovalServiceContext = Readonly<{
  connection: DatabaseConnection
}>

export async function removeFamilyMember(
  context: FamilyMemberRemovalServiceContext,
  managerUserId: string,
  memberReference: string
): Promise<Readonly<{ status: 'removed' }>> {
  let captured: ReturnType<typeof captureFamilyMemberRemovalTarget>
  try {
    captured = captureFamilyMemberRemovalTarget(context.connection, {
      managerUserId,
      memberReference
    })
  } catch (error) {
    mapFamilyMemberRemovalAuthorityError(error)
  }
  if (!captured) throw notFoundError('Family member not found')

  try {
    removeCapturedFamilyMember(context.connection, captured, new Date(), (targetUserId) => {
      enqueueBillingNotificationDelivery(context.connection, {
        episodeKey: JSON.stringify(['member_removed', captured.organizationId, captured.memberReference, targetUserId]),
        kind: 'member_removed',
        recipientUserId: targetUserId
      })
    })
  } catch (error) {
    mapFamilyMemberRemovalAuthorityError(error)
  }

  return Object.freeze({ status: 'removed' as const })
}

function mapFamilyMemberRemovalAuthorityError(error: unknown): never {
  if (error instanceof FamilyManagerBillingConflictError) {
    throw conflictError('Family member removal requires current billing')
  }
  if (error instanceof FamilyAuthorityInvariantError) {
    throw configurationError('Family membership is temporarily unavailable')
  }
  throw error
}
