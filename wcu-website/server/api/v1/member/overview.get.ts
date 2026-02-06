import { ClientResponseError, type RecordModel } from 'pocketbase'

import type { MemberOverviewResponse } from '~~/shared/types/membership'

import { requireSession } from '~~/server/lib/auth/session'
import { mapDuesRecord, mapMemberProfileRecord } from '~~/server/lib/membership/mappers'
import { getPocketBaseCollectionConfig } from '~~/server/lib/pocketbase/config'
import { getPocketBaseServiceClient } from '~~/server/lib/pocketbase/client'

const isNotFoundError = (error: unknown): boolean => {
  return error instanceof ClientResponseError && error.status === 404
}

export default defineEventHandler(async (event): Promise<MemberOverviewResponse> => {
  const session = requireSession(event)

  const serviceClient = await getPocketBaseServiceClient()
  const {
    memberProfileCollection,
    duesRecordCollection,
    memberProfileUserField,
    duesRecordUserField,
  } = getPocketBaseCollectionConfig()

  const profileFilter = serviceClient.filter(`${memberProfileUserField} = {:userId}`, { userId: session.userId })

  let profileRecord: RecordModel | null = null

  try {
    profileRecord = await serviceClient.collection(memberProfileCollection).getFirstListItem(profileFilter)
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Unable to load member profile',
      })
    }
  }

  const duesFilter = serviceClient.filter(`${duesRecordUserField} = {:userId}`, { userId: session.userId })

  const duesList = await serviceClient.collection(duesRecordCollection).getList<RecordModel>(1, 24, {
    filter: duesFilter,
    sort: '-paidAt,-paid_at,-created',
  })

  return {
    profile: profileRecord ? mapMemberProfileRecord(profileRecord) : null,
    duesRecords: duesList.items.map(mapDuesRecord),
  }
})
