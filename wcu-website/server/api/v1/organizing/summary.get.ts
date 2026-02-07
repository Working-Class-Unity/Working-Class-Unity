import { ClientResponseError, type ListOptions, type ListResult, type RecordModel } from 'pocketbase'

import type { OrganizingSummaryResponse } from '~~/shared/types/tenant-ops'

import { assertMinimumRole } from '~~/server/lib/auth/rbac'
import { countInteractionsInWindow, mapOutreachInteraction } from '~~/server/lib/organizing/summary'
import { getPocketBaseCollectionConfig } from '~~/server/lib/pocketbase/config'
import { getPocketBaseServiceClient } from '~~/server/lib/pocketbase/client'

const isNotFoundError = (error: unknown): boolean => {
  return error instanceof ClientResponseError && error.status === 404
}

async function safeGetList(
  collectionName: string,
  page: number,
  perPage: number,
  options: ListOptions
): Promise<ListResult<RecordModel> | null> {
  const serviceClient = await getPocketBaseServiceClient()

  try {
    return await serviceClient.collection(collectionName).getList<RecordModel>(page, perPage, options)
  } catch (error) {
    if (isNotFoundError(error)) {
      return null
    }

    throw createError({
      statusCode: 500,
      statusMessage: `Unable to query ${collectionName}`,
    })
  }
}

export default defineEventHandler(async (event): Promise<OrganizingSummaryResponse> => {
  assertMinimumRole(event, 'organizer')

  const serviceClient = await getPocketBaseServiceClient()
  const {
    buildingsCollection,
    outreachCollection,
    outreachDateField,
    outreachBuildingField,
  } = getPocketBaseCollectionConfig()

  const activeBuildingsFilter = serviceClient.filter('status = {:active} || status = {:target}', {
    active: 'active',
    target: 'target',
  })

  const [totalBuildingsResult, activeBuildingsResult, recentInteractionsResult, outreachCountResult] = await Promise.all([
    safeGetList(buildingsCollection, 1, 1, {}),
    safeGetList(buildingsCollection, 1, 1, { filter: activeBuildingsFilter }),
    safeGetList(outreachCollection, 1, 12, { sort: `-${outreachDateField}` }),
    safeGetList(outreachCollection, 1, 250, { sort: `-${outreachDateField}` }),
  ])

  const recentInteractions = recentInteractionsResult?.items.map((record) => {
    return mapOutreachInteraction(record, outreachDateField, outreachBuildingField)
  }) || []

  const outreachLast30Days = outreachCountResult
    ? countInteractionsInWindow(outreachCountResult.items, outreachDateField, 30)
    : 0

  return {
    totalBuildings: totalBuildingsResult?.totalItems || 0,
    activeBuildings: activeBuildingsResult?.totalItems || 0,
    outreachLast30Days,
    recentInteractions,
  }
})
