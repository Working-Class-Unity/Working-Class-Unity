import { ClientResponseError, type RecordModel } from 'pocketbase'
import { Resend } from 'resend'
import { z } from 'zod'

import type { AuthMagicLinkRequestResponse } from '~~/shared/types/auth'

import {
  buildMagicLinkUrl,
  generateMagicLinkToken,
  getMagicLinkExpiryIso,
  getMagicLinkTtlMinutes,
  hashMagicLinkToken,
} from '~~/server/lib/auth/magic-links'
import { getPocketBaseCollectionConfig } from '~~/server/lib/pocketbase/config'
import { getPocketBaseServiceClient } from '~~/server/lib/pocketbase/client'
import { emailSchema, parseBodyWithSchema } from '~~/server/lib/validators/common'

const requestMagicLinkSchema = z.object({
  email: emailSchema,
  next: z.string().trim().optional(),
})

const GENERIC_SUCCESS_MESSAGE = 'If that email is in our system, we just sent a secure sign-in link.'

const isNotFoundError = (error: unknown): boolean => {
  return error instanceof ClientResponseError && error.status === 404
}

const sendMagicLinkEmail = async (email: string, magicLink: string, ttlMinutes: number): Promise<void> => {
  const config = useRuntimeConfig()

  if (!config.resendApiKey || !config.resendFromEmail) {
    return
  }

  const resend = new Resend(config.resendApiKey)

  await resend.emails.send({
    from: config.resendFromEmail,
    to: [email],
    subject: 'Your Working Class Unity sign-in link',
    text: `Use this secure sign-in link within ${ttlMinutes} minutes: ${magicLink}`,
    html: `<p>Use this secure sign-in link within <strong>${ttlMinutes} minutes</strong>.</p><p><a href="${magicLink}">Sign in to Working Class Unity</a></p>`,
  })
}

export default defineEventHandler(async (event): Promise<AuthMagicLinkRequestResponse> => {
  const { email, next } = await parseBodyWithSchema(event, requestMagicLinkSchema)

  const serviceClient = await getPocketBaseServiceClient()
  const { authCollection, magicLinkCollection } = getPocketBaseCollectionConfig()

  let userRecord: RecordModel | null = null

  try {
    const filter = serviceClient.filter('email = {:email}', { email })
    userRecord = await serviceClient.collection(authCollection).getFirstListItem(filter)
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Unable to verify login account',
      })
    }
  }

  if (!userRecord) {
    return {
      success: true,
      message: GENERIC_SUCCESS_MESSAGE,
    }
  }

  const ttlMinutes = getMagicLinkTtlMinutes()
  const token = generateMagicLinkToken()
  const tokenHash = hashMagicLinkToken(token)
  const expiresAt = getMagicLinkExpiryIso(new Date(), ttlMinutes)
  const magicLink = buildMagicLinkUrl(useRuntimeConfig().authMagicLinkOrigin, token, next)

  await serviceClient.collection(magicLinkCollection).create({
    userId: userRecord.id,
    email,
    tokenHash,
    expiresAt,
    consumedAt: null,
    requestedIp: getRequestIP(event, { xForwardedFor: true }) || null,
    userAgent: getHeader(event, 'user-agent') || null,
  })

  await sendMagicLinkEmail(email, magicLink, ttlMinutes)

  return {
    success: true,
    message: GENERIC_SUCCESS_MESSAGE,
    ...(import.meta.dev ? { debugMagicLink: magicLink } : {}),
  }
})
