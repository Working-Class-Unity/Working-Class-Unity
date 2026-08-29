import { randomUUID } from 'node:crypto'
import { chmod, mkdir, open, rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Resend } from 'resend'
import { getAppRuntimeConfig, type AppRuntimeConfig } from '../../utils/runtime'
import {
  renderEnglishAccountActivationEmail,
  renderEnglishAccountEmailVerificationEmail,
  renderEnglishBillingEmailVerificationEmail,
  renderEnglishIdentityReviewEmail,
  renderEnglishMagicLinkEmail
} from './templates/en'

export type TransactionalEmailMessage = Readonly<{
  to: string
  subject: string
  text: string
  html: string
  idempotencyKey?: string
}>

export interface TransactionalEmailSender {
  send(message: TransactionalEmailMessage): Promise<void>
}

type CapturedTransactionalEmail = Readonly<{
  version: 1
  transport: 'capture'
  message: Readonly<{
    from: string
    to: string
    subject: string
    text: string
    html: string
    idempotencyKey?: string
  }>
  createdAt: string
}>

export class TransactionalEmailDeliveryError extends Error {
  constructor() {
    super('Transactional email delivery failed')
    this.name = 'TransactionalEmailDeliveryError'
  }
}

let cachedSender: TransactionalEmailSender | undefined

export function getTransactionalEmailSender(): TransactionalEmailSender {
  cachedSender ??= createTransactionalEmailSender(getAppRuntimeConfig().email)
  return cachedSender
}

export function createTransactionalEmailSender(config: AppRuntimeConfig['email']): TransactionalEmailSender {
  if (config.transport === 'capture') {
    return createCaptureEmailSender(config)
  }
  if (config.transport === 'resend') {
    return createResendEmailSender(config)
  }
  throw new TransactionalEmailDeliveryError()
}

export function createMagicLinkEmail(input: { to: string; url: string; appName: string }): TransactionalEmailMessage {
  const to = requireHeaderValue(input.to)
  const appName = normalizeDisplayText(input.appName)
  const url = requireHttpUrl(input.url)
  return renderEnglishMagicLinkEmail({ to, url, appName })
}

export function createAccountActivationEmail(input: {
  to: string
  url: string
  appName: string
}): TransactionalEmailMessage {
  const to = requireHeaderValue(input.to)
  const appName = normalizeDisplayText(input.appName)
  const url = requireHttpUrl(input.url)
  return renderEnglishAccountActivationEmail({ to, url, appName })
}

export function createAccountEmailVerificationEmail(input: {
  to: string
  url: string
  appName: string
}): TransactionalEmailMessage {
  const to = requireHeaderValue(input.to)
  const appName = normalizeDisplayText(input.appName)
  const url = requireHttpUrl(input.url)
  return renderEnglishAccountEmailVerificationEmail({ to, url, appName })
}

export function createIdentityReviewEmail(input: {
  appName: string
  reason: string
  reviewId: string
  userId: string
}): TransactionalEmailMessage {
  const appName = normalizeDisplayText(input.appName)
  const reason = normalizeDisplayText(input.reason)
  const reviewId = normalizeDisplayText(input.reviewId)
  const userId = normalizeDisplayText(input.userId)
  return {
    ...renderEnglishIdentityReviewEmail({ appName, reason, reviewId, userId }),
    idempotencyKey: `identity-review-${reviewId}`
  }
}

export function createBillingEmailVerificationEmail(input: {
  appName: string
  to: string
  url: string
  verificationId: string
}): TransactionalEmailMessage {
  const appName = normalizeDisplayText(input.appName)
  const to = requireHeaderValue(input.to)
  const url = requireHttpUrl(input.url)
  const verificationId = normalizeDisplayText(input.verificationId)
  return {
    ...renderEnglishBillingEmailVerificationEmail({ appName, to, url }),
    idempotencyKey: `billing-email-verification-${verificationId}`
  }
}

function createCaptureEmailSender(config: AppRuntimeConfig['email']): TransactionalEmailSender {
  const directory = resolve(process.cwd(), config.captureDirectory)

  return {
    async send(message) {
      const normalizedMessage = normalizeMessage(message)
      const capture: CapturedTransactionalEmail = {
        version: 1,
        transport: 'capture',
        message: {
          from: config.from,
          ...normalizedMessage
        },
        createdAt: new Date().toISOString()
      }
      const id = randomUUID()
      const temporaryPath = resolve(directory, `.${id}.tmp`)
      const destinationPath = resolve(directory, `${id}.json`)
      let handle: Awaited<ReturnType<typeof open>> | undefined

      try {
        await mkdir(directory, { recursive: true, mode: 0o700 })
        await chmod(directory, 0o700)
        handle = await open(temporaryPath, 'wx', 0o600)
        await handle.writeFile(`${JSON.stringify(capture, null, 2)}\n`, 'utf8')
        await handle.chmod(0o600)
        await handle.sync()
        await handle.close()
        handle = undefined
        await rename(temporaryPath, destinationPath)
      } catch {
        try {
          await handle?.close()
        } catch {
          // Preserve the normalized delivery error from the capture boundary.
        }
        await rm(temporaryPath, { force: true }).catch(() => undefined)
        throw new TransactionalEmailDeliveryError()
      }
    }
  }
}

function createResendEmailSender(config: AppRuntimeConfig['email']): TransactionalEmailSender {
  const resend = new Resend(config.resend.apiKey)

  return {
    async send(message) {
      try {
        const { idempotencyKey, ...email } = normalizeMessage(message)
        const { error } = await resend.emails.send(
          {
            from: config.from,
            ...email
          },
          idempotencyKey ? { idempotencyKey } : undefined
        )
        if (error) throw error
      } catch {
        throw new TransactionalEmailDeliveryError()
      }
    }
  }
}

function normalizeMessage(message: TransactionalEmailMessage): TransactionalEmailMessage {
  const to = requireHeaderValue(message.to)
  const subject = requireHeaderValue(message.subject)
  if (!message.text || !message.html) throw new TransactionalEmailDeliveryError()
  const idempotencyKey = message.idempotencyKey ? requireHeaderValue(message.idempotencyKey) : undefined
  if (idempotencyKey && idempotencyKey.length > 256) throw new TransactionalEmailDeliveryError()
  return { to, subject, text: message.text, html: message.html, ...(idempotencyKey ? { idempotencyKey } : {}) }
}

function requireHeaderValue(value: string): string {
  if (!value || value !== value.trim() || /[\r\n]/.test(value)) {
    throw new TransactionalEmailDeliveryError()
  }
  return value
}

function normalizeDisplayText(value: string): string {
  const normalized = value.replaceAll(/[\r\n]+/g, ' ').trim()
  if (!normalized) throw new TransactionalEmailDeliveryError()
  return normalized
}

function requireHttpUrl(value: string): string {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Unsupported protocol')
    }
    return url.toString()
  } catch {
    throw new TransactionalEmailDeliveryError()
  }
}
