import { createHmac, timingSafeEqual } from 'node:crypto'
import { forbiddenError } from '../../utils/errors'
import { requireModuleReady } from '../../utils/module-state'
import { getAppRuntimeConfig } from '../../utils/runtime'

const tokenVersion = 'v2'
const fileIdPattern = /^file_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const contentMd5Pattern = /^[A-Za-z0-9+/]{21}[AQgw]==$/
const maxFileUploadBytes = 25 * 1024 * 1024

type FileCapabilityBase = Readonly<{
  fileId: string
  ownerId: string
  expiresAt: string
}>

export type FileUploadTokenPayload = FileCapabilityBase &
  Readonly<{
    action: 'upload'
    byteSize: number
    contentType: string
    contentMd5: string
  }>

export type FileDownloadTokenPayload = FileCapabilityBase &
  Readonly<{
    action: 'download'
  }>

type FileCapabilityPayload = FileUploadTokenPayload | FileDownloadTokenPayload

export function createFileUploadToken(payload: Omit<FileUploadTokenPayload, 'action'>) {
  return createFileCapabilityToken({ ...payload, action: 'upload' })
}

export function createFileDownloadToken(payload: Omit<FileDownloadTokenPayload, 'action'>) {
  return createFileCapabilityToken({ ...payload, action: 'download' })
}

export function verifyFileUploadToken(token: string): FileUploadTokenPayload {
  const payload = verifyFileCapabilityToken(token)
  if (payload.action !== 'upload') throw invalidTokenError()
  return payload
}

export function verifyFileDownloadToken(token: string): FileDownloadTokenPayload {
  const payload = verifyFileCapabilityToken(token)
  if (payload.action !== 'download') throw invalidTokenError()
  return payload
}

function createFileCapabilityToken(payload: FileCapabilityPayload) {
  requireModuleReady('files')
  assertCapabilityPayload(payload)
  const body = Buffer.from(JSON.stringify({ version: tokenVersion, ...payload })).toString('base64url')
  return `${body}.${sign(body)}`
}

function verifyFileCapabilityToken(token: string): FileCapabilityPayload {
  requireModuleReady('files')
  const [body, signature, extra] = token.split('.')
  if (!body || !signature || extra || !safeEqual(signature, sign(body))) throw invalidTokenError()

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as FileCapabilityPayload & {
      version?: unknown
    }
    if (parsed.version !== tokenVersion) throw invalidTokenError()
    assertCapabilityPayload(parsed)
    if (Date.parse(parsed.expiresAt) <= Date.now()) throw forbiddenError('File capability has expired')
    return parsed.action === 'upload'
      ? {
          action: 'upload',
          fileId: parsed.fileId,
          ownerId: parsed.ownerId,
          expiresAt: parsed.expiresAt,
          byteSize: parsed.byteSize,
          contentType: parsed.contentType,
          contentMd5: parsed.contentMd5
        }
      : {
          action: 'download',
          fileId: parsed.fileId,
          ownerId: parsed.ownerId,
          expiresAt: parsed.expiresAt
        }
  } catch (error) {
    if (isFileCapabilityError(error)) throw error
    throw invalidTokenError()
  }
}

function assertCapabilityPayload(payload: FileCapabilityPayload) {
  if (
    !payload ||
    !fileIdPattern.test(payload.fileId) ||
    typeof payload.ownerId !== 'string' ||
    !payload.ownerId ||
    typeof payload.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(payload.expiresAt))
  ) {
    throw invalidTokenError()
  }

  if (payload.action === 'download') return
  if (
    payload.action !== 'upload' ||
    !Number.isSafeInteger(payload.byteSize) ||
    payload.byteSize < 1 ||
    payload.byteSize > maxFileUploadBytes ||
    typeof payload.contentType !== 'string' ||
    !payload.contentType.trim() ||
    payload.contentType !== payload.contentType.trim() ||
    payload.contentType.length > 180 ||
    !contentMd5Pattern.test(payload.contentMd5)
  ) {
    throw invalidTokenError()
  }
}

function invalidTokenError() {
  return forbiddenError('File capability is invalid')
}

function isFileCapabilityError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'statusCode' in error)
}

function sign(body: string) {
  return createHmac('sha256', uploadTokenSecret()).update('swl:file-capability:v2\0').update(body).digest('base64url')
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function uploadTokenSecret() {
  return getAppRuntimeConfig().betterAuth.secret
}
