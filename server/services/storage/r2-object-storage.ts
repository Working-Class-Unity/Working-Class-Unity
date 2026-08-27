import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  assertFileObjectKey,
  assertFileReconciliationPrefix,
  isFileObjectKey,
  type FileReconciliationPrefix
} from './file-object-keys'

export const R2_UPLOAD_EXPIRY_SECONDS = 15 * 60
export const R2_DOWNLOAD_EXPIRY_SECONDS = 60
export const R2_MAX_PAGE_SIZE = 100
export const R2_MAX_UPLOAD_BYTES = 25 * 1024 * 1024

const defaultRequestTimeoutMs = 30_000
const cloudflareAccountIdPattern = /^[0-9a-f]{32}$/
const canonicalContentMd5Pattern = /^[A-Za-z0-9+/]{21}[AQgw]==$/

export type R2ObjectStorageConfig = Readonly<{
  accountId: string
  bucket: string
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
}>

export type R2ObjectStorageOptions = Readonly<{
  requestHandler?: S3ClientConfig['requestHandler']
  requestTimeoutMs?: number
  now?: () => Date
}>

export type SignedR2Request = Readonly<{
  method: 'GET' | 'HEAD' | 'PUT'
  url: string
  headers: Readonly<Record<string, string>>
  expiresAt: string
}>

export type R2UploadRequests = Readonly<{
  upload: SignedR2Request & Readonly<{ method: 'PUT' }>
  head: SignedR2Request & Readonly<{ method: 'HEAD' }>
}>

export type R2ObjectMetadata = Readonly<{
  key: string
  byteSize: number | undefined
  contentType: string | undefined
  contentDisposition: string | undefined
  lastModified: Date | undefined
}>

export type R2ObjectPage = Readonly<{
  keys: readonly string[]
  nextContinuationToken: string | undefined
}>

export class R2PartialDeleteError extends Error {
  readonly failedCount: number
  readonly codes: readonly string[]

  constructor(failedCount: number, codes: readonly string[]) {
    super(`R2 did not delete ${failedCount} managed object${failedCount === 1 ? '' : 's'}`)
    this.name = 'R2PartialDeleteError'
    this.failedCount = failedCount
    this.codes = codes
  }
}

export class R2ObjectStorage {
  readonly bucketName: string
  readonly endpoint: string

  private readonly client: S3Client
  private readonly requestTimeoutMs: number
  private readonly now: () => Date

  constructor(config: R2ObjectStorageConfig, options: R2ObjectStorageOptions = {}) {
    this.bucketName = normalizeR2BucketName(config.bucket)
    this.endpoint = normalizeCloudflareR2Endpoint(config.endpoint, config.accountId)
    this.requestTimeoutMs = normalizeRequestTimeout(options.requestTimeoutMs)
    this.now = options.now ?? (() => new Date())

    const clientConfig: S3ClientConfig = {
      region: 'auto',
      endpoint: this.endpoint,
      credentials: {
        accessKeyId: requireNonBlankConfiguration(config.accessKeyId, 'access key ID'),
        secretAccessKey: requireNonBlankConfiguration(config.secretAccessKey, 'secret access key')
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      retryMode: 'standard',
      maxAttempts: 3
    }

    if (options.requestHandler) {
      clientConfig.requestHandler = options.requestHandler
    }

    this.client = new S3Client(clientConfig)
  }

  async createUploadRequests(input: {
    key: string
    byteSize: number
    contentType: string
    contentMd5: string
    signingDate?: Date
  }): Promise<R2UploadRequests> {
    const key = assertNewR2ObjectKey(input.key)
    const byteSize = normalizeUploadByteSize(input.byteSize)
    const contentType = normalizeContentType(input.contentType)
    const contentMd5 = normalizeContentMd5(input.contentMd5)
    const signingDate = normalizeSigningDate(input.signingDate ?? this.now())
    const expiresAt = new Date(signingDate.getTime() + R2_UPLOAD_EXPIRY_SECONDS * 1000).toISOString()

    const [uploadUrl, headUrl] = await Promise.all([
      getSignedUrl(
        this.client,
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          ContentLength: byteSize,
          ContentType: contentType,
          ContentMD5: contentMd5,
          IfNoneMatch: '*',
          ContentDisposition: 'attachment',
          CacheControl: 'private, no-store'
        }),
        {
          expiresIn: R2_UPLOAD_EXPIRY_SECONDS,
          signingDate,
          signableHeaders: new Set(['cache-control', 'content-length', 'content-type'])
        }
      ),
      getSignedUrl(
        this.client,
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: key
        }),
        {
          expiresIn: R2_UPLOAD_EXPIRY_SECONDS,
          signingDate
        }
      )
    ])

    return {
      upload: {
        method: 'PUT',
        url: uploadUrl,
        headers: {
          'content-length': String(byteSize),
          'content-type': contentType,
          'content-md5': contentMd5,
          'if-none-match': '*',
          'content-disposition': 'attachment',
          'cache-control': 'private, no-store'
        },
        expiresAt
      },
      head: {
        method: 'HEAD',
        url: headUrl,
        headers: {},
        expiresAt
      }
    }
  }

  async createDownloadRequest(key: string): Promise<SignedR2Request & Readonly<{ method: 'GET' }>> {
    const objectKey = assertPersistedR2ObjectKey(key)
    const signingDate = this.now()

    return {
      method: 'GET',
      url: await getSignedUrl(
        this.client,
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: objectKey
        }),
        {
          expiresIn: R2_DOWNLOAD_EXPIRY_SECONDS,
          signingDate
        }
      ),
      headers: {},
      expiresAt: new Date(signingDate.getTime() + R2_DOWNLOAD_EXPIRY_SECONDS * 1000).toISOString()
    }
  }

  async headPersistedObject(key: string): Promise<R2ObjectMetadata | null> {
    const objectKey = assertPersistedR2ObjectKey(key)

    try {
      const result = await this.sendWithTimeout((abortSignal) =>
        this.client.send(
          new HeadObjectCommand({
            Bucket: this.bucketName,
            Key: objectKey
          }),
          { abortSignal }
        )
      )

      return {
        key: objectKey,
        byteSize: result.ContentLength,
        contentType: result.ContentType,
        contentDisposition: result.ContentDisposition,
        lastModified: result.LastModified
      }
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  async listPage(input: {
    prefix: FileReconciliationPrefix
    limit?: number
    continuationToken?: string
  }): Promise<R2ObjectPage> {
    const prefix = assertReconciliationPrefix(input.prefix)
    const limit = normalizePageSize(input.limit)
    const continuationToken = normalizeContinuationToken(input.continuationToken)
    const result = await this.sendWithTimeout((abortSignal) =>
      this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
          MaxKeys: limit,
          ContinuationToken: continuationToken
        }),
        { abortSignal }
      )
    )

    const contents = result.Contents ?? []
    if (contents.length > limit) {
      throw new Error('R2 returned more objects than the requested page limit')
    }
    if (contents.some((item) => !item.Key)) {
      throw new Error('R2 returned an object page entry without a key')
    }
    const returnedKeys = contents.map((item) => item.Key!)
    if (new Set(returnedKeys).size !== returnedKeys.length) {
      throw new Error('R2 returned a duplicate object in one page')
    }
    const keys = returnedKeys.map((returnedKey) => listedR2ObjectKey(returnedKey, prefix))
    let nextContinuationToken: string | undefined

    if (result.IsTruncated) {
      if (!result.NextContinuationToken) {
        throw new Error('R2 returned a truncated object page without a continuation token')
      }
      nextContinuationToken = normalizeContinuationToken(result.NextContinuationToken)
    }

    return { keys, nextContinuationToken }
  }

  async deleteObjects(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return
    if (keys.length > R2_MAX_PAGE_SIZE) {
      throw new Error(`R2 deletion is limited to ${R2_MAX_PAGE_SIZE} managed objects per request`)
    }

    const objectKeys = keys.map(assertPersistedR2ObjectKey)
    const result = await this.sendWithTimeout((abortSignal) =>
      this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucketName,
          Delete: {
            Objects: objectKeys.map((Key) => ({ Key })),
            Quiet: true
          }
        }),
        { abortSignal }
      )
    )

    if (result.Errors?.length) {
      const codes = [...new Set(result.Errors.map((error) => error.Code || 'Unknown'))].sort()
      throw new R2PartialDeleteError(result.Errors.length, codes)
    }
  }

  destroy() {
    this.client.destroy()
  }

  private async sendWithTimeout<Output>(operation: (abortSignal: AbortSignal) => Promise<Output>): Promise<Output> {
    return operation(AbortSignal.timeout(this.requestTimeoutMs))
  }
}

export function normalizeCloudflareR2Endpoint(endpoint: string, accountId: string) {
  if (!cloudflareAccountIdPattern.test(accountId)) {
    throw new Error('R2 account ID must be 32 lowercase hexadecimal characters')
  }

  let url: URL

  try {
    url = new URL(endpoint)
  } catch {
    throw new Error('R2 endpoint must be a valid Cloudflare HTTPS account endpoint')
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !isCloudflareAccountEndpointHostname(url.hostname, accountId)
  ) {
    throw new Error('R2 endpoint must be a valid Cloudflare HTTPS account endpoint')
  }

  return url.origin
}

export function r2BrowserRequestOrigin(config: Pick<R2ObjectStorageConfig, 'accountId' | 'bucket' | 'endpoint'>) {
  const endpoint = new URL(normalizeCloudflareR2Endpoint(config.endpoint, config.accountId))
  endpoint.hostname = `${normalizeR2BucketName(config.bucket)}.${endpoint.hostname}`
  return endpoint.origin
}

export function normalizeR2BucketName(bucket: string) {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(bucket)) {
    throw new Error('R2 bucket must use its 3-63 character lowercase alphanumeric and hyphen name')
  }
  return bucket
}

function isCloudflareAccountEndpointHostname(hostname: string, accountId: string) {
  return (
    hostname === `${accountId}.r2.cloudflarestorage.com` ||
    hostname === `${accountId}.eu.r2.cloudflarestorage.com` ||
    hostname === `${accountId}.us.r2.cloudflarestorage.com` ||
    hostname === `${accountId}.fedramp.r2.cloudflarestorage.com`
  )
}

function assertNewR2ObjectKey(key: string) {
  try {
    return assertFileObjectKey(key)
  } catch {
    throw new Error('R2 upload key must be a server-generated Files v1 object key')
  }
}

function assertPersistedR2ObjectKey(key: string) {
  try {
    return assertFileObjectKey(key)
  } catch {
    throw new Error('R2 object key is outside the managed Files prefix')
  }
}

function listedR2ObjectKey(key: string, prefix: FileReconciliationPrefix) {
  if (!key.startsWith(prefix)) throw new Error('R2 returned an object outside the requested prefix')
  if (isFileObjectKey(key)) return key
  throw new Error('R2 returned a malformed object inside the current Files prefix')
}

function assertReconciliationPrefix(prefix: string): FileReconciliationPrefix {
  try {
    return assertFileReconciliationPrefix(prefix)
  } catch {
    throw new Error('R2 reconciliation prefix is not managed by Files')
  }
}

function normalizeContentMd5(contentMd5: string) {
  if (!canonicalContentMd5Pattern.test(contentMd5) || Buffer.from(contentMd5, 'base64').byteLength !== 16) {
    throw new Error('R2 upload requires a canonical base64 Content-MD5 value')
  }
  return contentMd5
}

function normalizeUploadByteSize(byteSize: number) {
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > R2_MAX_UPLOAD_BYTES) {
    throw new Error(`R2 upload size must be between 1 and ${R2_MAX_UPLOAD_BYTES} bytes`)
  }
  return byteSize
}

function normalizeSigningDate(value: Date) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error('R2 signing date must be valid')
  }
  return value
}

function normalizeContentType(contentType: string) {
  if (!contentType || contentType !== contentType.trim() || contentType.length > 180 || /[\r\n]/.test(contentType)) {
    throw new Error('R2 upload requires a valid Content-Type value')
  }
  return contentType
}

function normalizePageSize(limit = R2_MAX_PAGE_SIZE) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > R2_MAX_PAGE_SIZE) {
    throw new Error(`R2 object pages must contain between 1 and ${R2_MAX_PAGE_SIZE} objects`)
  }
  return limit
}

function normalizeContinuationToken(token: string | undefined) {
  if (token === undefined) return undefined
  if (!token || token.length > 4096) {
    throw new Error('R2 continuation tokens must contain between 1 and 4096 characters')
  }
  return token
}

function normalizeRequestTimeout(timeout = defaultRequestTimeoutMs) {
  if (!Number.isSafeInteger(timeout) || timeout < 1) {
    throw new Error('R2 request timeout must be a positive integer')
  }
  return timeout
}

function requireNonBlankConfiguration(value: string, name: string) {
  if (!value || value !== value.trim()) throw new Error(`R2 ${name} is required`)
  return value
}

function isNotFound(error: unknown) {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  return candidate.name === 'NotFound' || candidate.name === 'NoSuchKey' || candidate.$metadata?.httpStatusCode === 404
}
