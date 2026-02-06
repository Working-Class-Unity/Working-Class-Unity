import { ClientResponseError, type RecordModel } from 'pocketbase'
import { z } from 'zod'

import {
  hashMagicLinkToken,
  isMagicLinkExpired,
  sanitizeNextPath,
} from '~~/server/lib/auth/magic-links'
import { mapPocketBaseUserRecordToSession } from '~~/server/lib/auth/user-mapper'
import { getPocketBaseCollectionConfig } from '~~/server/lib/pocketbase/config'
import { getPocketBaseServiceClient } from '~~/server/lib/pocketbase/client'
import { parseQueryWithSchema } from '~~/server/lib/validators/common'
import { setSessionForEvent } from '~~/server/lib/auth/session'

const verifyMagicLinkSchema = z.object({
  token: z.string().trim().min(16),
  next: z.string().trim().optional(),
})

const isNotFoundError = (error: unknown): boolean => {
  return error instanceof ClientResponseError && error.status === 404
}

const resolveUserId = (magicLinkRecord: RecordModel): string | null => {
  const userId = magicLinkRecord.userId ?? magicLinkRecord.user

  return typeof userId === 'string' && userId.length > 0 ? userId : null
}

const resolveConsumedAt = (magicLinkRecord: RecordModel): string | null => {
  const consumedAt = magicLinkRecord.consumedAt

  return typeof consumedAt === 'string' && consumedAt.length > 0 ? consumedAt : null
}

export default defineEventHandler(async (event) => {
  const { token, next } = parseQueryWithSchema(event, verifyMagicLinkSchema)

  const serviceClient = await getPocketBaseServiceClient()
  const { authCollection, magicLinkCollection } = getPocketBaseCollectionConfig()

  const tokenHash = hashMagicLinkToken(token)
  const filter = serviceClient.filter('tokenHash = {:tokenHash}', { tokenHash })

  let magicLinkRecord: RecordModel

  try {
    magicLinkRecord = await serviceClient.collection(magicLinkCollection).getFirstListItem(filter)
  } catch (error) {
    if (isNotFoundError(error)) {
      throw createError({
        statusCode: 401,
        statusMessage: 'Invalid or expired sign-in link',
      })
    }

    throw createError({
      statusCode: 500,
      statusMessage: 'Unable to validate sign-in link',
    })
  }

  const alreadyConsumed = resolveConsumedAt(magicLinkRecord)
  const expiresAt = typeof magicLinkRecord.expiresAt === 'string' ? magicLinkRecord.expiresAt : ''

  if (alreadyConsumed || isMagicLinkExpired(expiresAt)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid or expired sign-in link',
    })
  }

  const userId = resolveUserId(magicLinkRecord)

  if (!userId) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Invalid magic link record',
    })
  }

  let userRecord: RecordModel

  try {
    userRecord = await serviceClient.collection(authCollection).getOne(userId)
  } catch (error) {
    if (isNotFoundError(error)) {
      throw createError({
        statusCode: 401,
        statusMessage: 'Account for this sign-in link no longer exists',
      })
    }

    throw createError({
      statusCode: 500,
      statusMessage: 'Unable to load user profile',
    })
  }

  setSessionForEvent(event, mapPocketBaseUserRecordToSession(userRecord))

  await serviceClient.collection(magicLinkCollection).update(magicLinkRecord.id, {
    consumedAt: new Date().toISOString(),
  })

  const safeNextPath = sanitizeNextPath(next)
  return sendRedirect(event, safeNextPath || '/member')
})
