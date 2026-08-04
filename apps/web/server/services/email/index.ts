import { randomUUID } from 'node:crypto'
import { chmod, mkdir, open, rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import nodemailer from 'nodemailer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'
import { getAppRuntimeConfig, type AppRuntimeConfig } from '../../utils/runtime'
import {
  renderEnglishBillingNotificationEmail,
  renderEnglishMagicLinkEmail,
  renderEnglishWorkspaceInvitationEmail,
  type EnglishBillingNotificationKind
} from './templates/en'

export type TransactionalEmailMessage = Readonly<{
  to: string
  subject: string
  text: string
  html: string
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
  if (config.transport === 'smtp') {
    return createSmtpEmailSender(config)
  }
  throw new TransactionalEmailDeliveryError()
}

export function createMagicLinkEmail(input: { to: string; url: string; appName: string }): TransactionalEmailMessage {
  const to = requireHeaderValue(input.to)
  const appName = normalizeDisplayText(input.appName)
  const url = requireHttpUrl(input.url)
  return renderEnglishMagicLinkEmail({ to, url, appName })
}

export function createWorkspaceInvitationEmail(input: {
  to: string
  url: string
  appName: string
  workspaceName: string
}): TransactionalEmailMessage {
  const to = requireHeaderValue(input.to)
  const appName = normalizeDisplayText(input.appName)
  const workspaceName = normalizeDisplayText(input.workspaceName)
  const url = requireHttpUrl(input.url)
  return renderEnglishWorkspaceInvitationEmail({ to, url, appName, workspaceName })
}

type BillingNotificationEmailInput =
  | Readonly<{
      to: string
      appName: string
      kind: Exclude<EnglishBillingNotificationKind, 'family_access_ending'>
    }>
  | Readonly<{
      to: string
      appName: string
      kind: 'family_access_ending'
      effectiveAt: string | Date
    }>

export function createBillingNotificationEmail(input: BillingNotificationEmailInput): TransactionalEmailMessage {
  const to = requireHeaderValue(input.to)
  const appName = normalizeDisplayText(input.appName)
  if (input.kind === 'family_access_ending') {
    return renderEnglishBillingNotificationEmail({
      to,
      appName,
      kind: input.kind,
      effectiveAt: requireDate(input.effectiveAt)
    })
  }
  return renderEnglishBillingNotificationEmail({ to, appName, kind: input.kind })
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

function createSmtpEmailSender(config: AppRuntimeConfig['email']): TransactionalEmailSender {
  const transportOptions: SMTPTransport.Options = {
    host: config.smtp.host,
    port: Number(config.smtp.port),
    secure: config.smtp.security === 'tls',
    requireTLS: config.smtp.security === 'starttls',
    ignoreTLS: false,
    opportunisticTLS: false,
    auth: {
      user: config.smtp.username,
      pass: config.smtp.password
    },
    tls: {
      rejectUnauthorized: true,
      servername: config.smtp.host
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    dnsTimeout: 10_000,
    logger: false,
    debug: false,
    transactionLog: false,
    disableFileAccess: true,
    disableUrlAccess: true
  }
  const transporter = nodemailer.createTransport(transportOptions)

  return {
    async send(message) {
      try {
        const info = await transporter.sendMail({
          from: config.from,
          ...normalizeMessage(message),
          disableFileAccess: true,
          disableUrlAccess: true
        })
        if (info.rejected.length > 0 || info.accepted.length === 0) {
          throw new TransactionalEmailDeliveryError()
        }
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
  return { to, subject, text: message.text, html: message.html }
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

function requireDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new TransactionalEmailDeliveryError()
  return date.toISOString()
}
