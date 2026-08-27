import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { FILE_MANAGED_OBJECT_PREFIX, isFileObjectKey } from '../server/services/storage/file-object-keys'
import {
  R2_DOWNLOAD_EXPIRY_SECONDS,
  R2ObjectStorage,
  R2PartialDeleteError,
  R2_MAX_UPLOAD_BYTES,
  R2_UPLOAD_EXPIRY_SECONDS,
  normalizeCloudflareR2Endpoint,
  normalizeR2BucketName,
  r2BrowserRequestOrigin,
  type R2ObjectStorageConfig,
  type R2ObjectStorageOptions
} from '../server/services/storage/r2-object-storage'

const accountId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const foreignAccountId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const newObjectKey = 'files/v1/file_123e4567-e89b-42d3-a456-426614174000'
const secondObjectKey = 'files/v1/file_223e4567-e89b-42d3-a456-426614174000'
const callerShapedObjectKey = 'caller/private.txt'
const signingDate = new Date('2026-07-15T12:00:00.000Z')

const storages: R2ObjectStorage[] = []

afterEach(() => {
  for (const storage of storages.splice(0)) storage.destroy()
})

describe('Cloudflare R2 endpoint and managed-key boundary', () => {
  it('accepts only the configured Cloudflare account and its documented jurisdiction endpoints', () => {
    expect(normalizeCloudflareR2Endpoint(`https://${accountId}.r2.cloudflarestorage.com/`, accountId)).toBe(
      `https://${accountId}.r2.cloudflarestorage.com`
    )
    expect(normalizeCloudflareR2Endpoint(`https://${accountId}.eu.r2.cloudflarestorage.com`, accountId)).toBe(
      `https://${accountId}.eu.r2.cloudflarestorage.com`
    )
    expect(normalizeCloudflareR2Endpoint(`https://${accountId}.us.r2.cloudflarestorage.com`, accountId)).toBe(
      `https://${accountId}.us.r2.cloudflarestorage.com`
    )
    expect(normalizeCloudflareR2Endpoint(`https://${accountId}.fedramp.r2.cloudflarestorage.com`, accountId)).toBe(
      `https://${accountId}.fedramp.r2.cloudflarestorage.com`
    )
    expect(
      r2BrowserRequestOrigin({
        accountId,
        bucket: 'private-files',
        endpoint: `https://${accountId}.us.r2.cloudflarestorage.com`
      })
    ).toBe(`https://private-files.${accountId}.us.r2.cloudflarestorage.com`)

    for (const endpoint of [
      `http://${accountId}.r2.cloudflarestorage.com`,
      `http://${accountId}.us.r2.cloudflarestorage.com`,
      `https://${foreignAccountId}.r2.cloudflarestorage.com`,
      `https://${foreignAccountId}.us.r2.cloudflarestorage.com`,
      `https://private-files.${accountId}.r2.cloudflarestorage.com`,
      `https://${accountId}.apac.r2.cloudflarestorage.com`,
      `https://${accountId}.r2.cloudflarestorage.com/bucket`,
      `https://${accountId}.us.r2.cloudflarestorage.com/bucket`,
      `https://${accountId}.r2.cloudflarestorage.com?redirect=elsewhere`,
      'https://example.com'
    ]) {
      expect(() => normalizeCloudflareR2Endpoint(endpoint, accountId)).toThrow(
        'R2 endpoint must be a valid Cloudflare HTTPS account endpoint'
      )
    }

    expect(() => normalizeCloudflareR2Endpoint('not a URL', accountId)).toThrow(
      'R2 endpoint must be a valid Cloudflare HTTPS account endpoint'
    )
    expect(() => normalizeCloudflareR2Endpoint(`https://${accountId}.r2.cloudflarestorage.com`, 'not-an-id')).toThrow(
      'R2 account ID must be 32 lowercase hexadecimal characters'
    )
  })

  it('accepts only documented Cloudflare R2 bucket names', () => {
    expect(normalizeR2BucketName('private-files-1')).toBe('private-files-1')
    for (const bucket of ['ab', '-private', 'private-', 'Private', 'private_files', 'a'.repeat(64)]) {
      expect(() => normalizeR2BucketName(bucket)).toThrow(
        'R2 bucket must use its 3-63 character lowercase alphanumeric and hyphen name'
      )
    }
  })

  it('accepts only immutable canonical Files object keys', () => {
    expect(isFileObjectKey(newObjectKey)).toBe(true)
    expect(isFileObjectKey('files/v1/file_123e4567-e89b-12d3-a456-426614174000')).toBe(false)
    expect(isFileObjectKey('files/v1/file_123E4567-E89B-42D3-A456-426614174000')).toBe(false)
    expect(isFileObjectKey(callerShapedObjectKey)).toBe(false)
    expect(isFileObjectKey('other/file_123e4567-e89b-42d3-a456-426614174000')).toBe(false)
  })
})

describe('Cloudflare R2 signed capabilities', () => {
  it('uses one current signing instant when the caller does not supply a clock', async () => {
    const storage = createStorage()
    const before = Date.now()
    const requests = await storage.createUploadRequests({
      key: newObjectKey,
      byteSize: 5,
      contentType: 'image/png',
      contentMd5: '1B2M2Y8AsgTpgAmY7PhCfg=='
    })
    const after = Date.now()

    expect(requests.upload.expiresAt).toBe(requests.head.expiresAt)
    expect(Date.parse(requests.upload.expiresAt)).toBeGreaterThanOrEqual(before + R2_UPLOAD_EXPIRY_SECONDS * 1_000)
    expect(Date.parse(requests.upload.expiresAt)).toBeLessThanOrEqual(after + R2_UPLOAD_EXPIRY_SECONDS * 1_000)
  })

  it('binds an immutable 15-minute PUT and diagnostic HEAD without an automatic CRC32 query', async () => {
    const storage = createStorage(undefined, { now: () => new Date('2026-07-15T13:00:00.000Z') })
    const requests = await storage.createUploadRequests({
      key: newObjectKey,
      byteSize: 5,
      contentType: 'image/png',
      contentMd5: '1B2M2Y8AsgTpgAmY7PhCfg==',
      signingDate
    })
    const uploadUrl = new URL(requests.upload.url)
    const headUrl = new URL(requests.head.url)

    expect(requests.upload).toMatchObject({
      method: 'PUT',
      headers: {
        'content-length': '5',
        'content-type': 'image/png',
        'content-md5': '1B2M2Y8AsgTpgAmY7PhCfg==',
        'if-none-match': '*',
        'content-disposition': 'attachment',
        'cache-control': 'private, no-store'
      },
      expiresAt: '2026-07-15T12:15:00.000Z'
    })
    expect(uploadUrl.hostname).toBe(`private-files.${accountId}.r2.cloudflarestorage.com`)
    expect(uploadUrl.pathname).toBe(`/${newObjectKey}`)
    expect(uploadUrl.searchParams.get('X-Amz-Expires')).toBe(String(R2_UPLOAD_EXPIRY_SECONDS))
    expect(uploadUrl.searchParams.get('X-Amz-SignedHeaders')).toBe(
      'cache-control;content-disposition;content-length;content-md5;content-type;host;if-none-match'
    )
    expect(uploadUrl.searchParams.has('x-amz-sdk-checksum-algorithm')).toBe(false)
    expect(uploadUrl.searchParams.has('x-amz-checksum-crc32')).toBe(false)

    expect(requests.head).toEqual({
      method: 'HEAD',
      url: expect.any(String),
      headers: {},
      expiresAt: '2026-07-15T12:15:00.000Z'
    })
    expect(headUrl.hostname).toBe(uploadUrl.hostname)
    expect(headUrl.pathname).toBe(uploadUrl.pathname)
    expect(headUrl.searchParams.get('X-Amz-Expires')).toBe(String(R2_UPLOAD_EXPIRY_SECONDS))
    expect(headUrl.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
  })

  it('issues a 60-second GET for a persisted canonical row', async () => {
    const storage = createStorage(undefined, { now: () => signingDate })

    const request = await storage.createDownloadRequest(newObjectKey)
    const url = new URL(request.url)
    expect(request).toMatchObject({
      method: 'GET',
      headers: {},
      expiresAt: '2026-07-15T12:01:00.000Z'
    })
    expect(url.pathname).toBe(`/${newObjectKey}`)
    expect(url.searchParams.get('X-Amz-Expires')).toBe(String(R2_DOWNLOAD_EXPIRY_SECONDS))
  })

  it('refuses to presign a new upload to a caller-shaped key', async () => {
    const storage = createStorage()

    await expect(
      storage.createUploadRequests({
        key: callerShapedObjectKey,
        byteSize: 5,
        contentType: 'text/plain',
        contentMd5: '1B2M2Y8AsgTpgAmY7PhCfg=='
      })
    ).rejects.toThrow('R2 upload key must be a server-generated Files v1 object key')
  })

  it('binds the declared upload size within the application limit', async () => {
    const storage = createStorage()

    for (const byteSize of [0, R2_MAX_UPLOAD_BYTES + 1, Number.NaN]) {
      await expect(
        storage.createUploadRequests({
          key: newObjectKey,
          byteSize,
          contentType: 'text/plain',
          contentMd5: '1B2M2Y8AsgTpgAmY7PhCfg=='
        })
      ).rejects.toThrow(`R2 upload size must be between 1 and ${R2_MAX_UPLOAD_BYTES} bytes`)
    }
  })

  it('rejects malformed signing inputs and incomplete client configuration before provider work', async () => {
    const storage = createStorage()

    for (const contentType of ['', ' text/plain', 'x'.repeat(181), 'text/plain\r\nmalicious: value']) {
      await expect(
        storage.createUploadRequests({
          key: newObjectKey,
          byteSize: 1,
          contentType,
          contentMd5: '1B2M2Y8AsgTpgAmY7PhCfg=='
        })
      ).rejects.toThrow('R2 upload requires a valid Content-Type value')
    }
    await expect(
      storage.createUploadRequests({
        key: newObjectKey,
        byteSize: 1,
        contentType: 'text/plain',
        contentMd5: 'not-a-canonical-digest'
      })
    ).rejects.toThrow('R2 upload requires a canonical base64 Content-MD5 value')
    await expect(
      storage.createUploadRequests({
        key: newObjectKey,
        byteSize: 1,
        contentType: 'text/plain',
        contentMd5: '1B2M2Y8AsgTpgAmY7PhCfg==',
        signingDate: new Date('invalid')
      })
    ).rejects.toThrow('R2 signing date must be valid')

    expect(() => new R2ObjectStorage(r2Config(), { requestTimeoutMs: 0 })).toThrow(
      'R2 request timeout must be a positive integer'
    )
    expect(() => new R2ObjectStorage({ ...r2Config(), accessKeyId: ' padded' })).toThrow('R2 access key ID is required')
    expect(() => new R2ObjectStorage({ ...r2Config(), secretAccessKey: '' })).toThrow(
      'R2 secret access key is required'
    )
  })
})

describe('Cloudflare R2 credentialed operations', () => {
  it('reads HEAD metadata without interpreting ETag or provider checksum fields', async () => {
    const transport = fakeTransport([
      {
        statusCode: 200,
        headers: {
          'content-length': '7',
          'content-type': 'text/plain',
          'content-disposition': 'attachment',
          'last-modified': 'Wed, 15 Jul 2026 12:00:00 GMT',
          etag: '"not-a-checksum-contract"',
          'x-amz-checksum-md5': 'provider-field-is-not-trusted'
        }
      }
    ])
    const storage = createStorage(transport.handler)

    const metadata = await storage.headPersistedObject(newObjectKey)

    expect(metadata).toEqual({
      key: newObjectKey,
      byteSize: 7,
      contentType: 'text/plain',
      contentDisposition: 'attachment',
      lastModified: new Date('2026-07-15T12:00:00.000Z')
    })
    expect(metadata).not.toHaveProperty('etag')
    expect(metadata).not.toHaveProperty('checksum')
    expect(transport.requests).toHaveLength(1)
    expect(transport.requests[0]?.request.method).toBe('HEAD')
    expect(transport.requests[0]?.request.path).toBe(`/${newObjectKey}`)
    expect(transport.requests[0]?.options.abortSignal).toBeInstanceOf(AbortSignal)
  })

  it('maps provider not-found HEAD responses to an absent object', async () => {
    const transport = fakeTransport([
      {
        statusCode: 404,
        body: '<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>'
      }
    ])
    const storage = createStorage(transport.handler)

    await expect(storage.headPersistedObject(newObjectKey)).resolves.toBeNull()
    expect(transport.requests).toHaveLength(1)
  })

  it('passes an opaque continuation token unchanged and trusts IsTruncated rather than page length', async () => {
    const nextToken = 'opaque/+token=='
    const transport = fakeTransport([
      {
        statusCode: 200,
        body: `<?xml version="1.0" encoding="UTF-8"?>
          <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
            <Name>private-files</Name>
            <Prefix>${FILE_MANAGED_OBJECT_PREFIX}</Prefix>
            <KeyCount>1</KeyCount>
            <MaxKeys>2</MaxKeys>
            <IsTruncated>true</IsTruncated>
            <Contents><Key>${newObjectKey}</Key><Size>7</Size></Contents>
            <NextContinuationToken>${nextToken.replace('&', '&amp;')}</NextContinuationToken>
          </ListBucketResult>`
      }
    ])
    const storage = createStorage(transport.handler)

    const page = await storage.listPage({
      prefix: FILE_MANAGED_OBJECT_PREFIX,
      limit: 2,
      continuationToken: nextToken
    })

    expect(page).toEqual({ keys: [newObjectKey], nextContinuationToken: nextToken })
    expect(transport.requests).toHaveLength(1)
    expect(transport.requests[0]?.request.query).toMatchObject({
      'continuation-token': nextToken,
      'list-type': '2',
      'max-keys': '2',
      prefix: FILE_MANAGED_OBJECT_PREFIX
    })

    await expect(storage.listPage({ prefix: 'foreign/' as typeof FILE_MANAGED_OBJECT_PREFIX })).rejects.toThrow(
      'R2 reconciliation prefix is not managed by Files'
    )
    expect(transport.requests).toHaveLength(1)
  })

  it('rejects invalid page bounds and malformed provider pagination', async () => {
    const transport = fakeTransport([
      {
        statusCode: 200,
        body: `<?xml version="1.0" encoding="UTF-8"?>
          <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
            <Name>private-files</Name>
            <Prefix>${FILE_MANAGED_OBJECT_PREFIX}</Prefix>
            <KeyCount>0</KeyCount>
            <MaxKeys>100</MaxKeys>
            <IsTruncated>false</IsTruncated>
          </ListBucketResult>`
      },
      {
        statusCode: 200,
        body: `<?xml version="1.0" encoding="UTF-8"?>
          <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
            <Name>private-files</Name>
            <Prefix>${FILE_MANAGED_OBJECT_PREFIX}</Prefix>
            <KeyCount>1</KeyCount>
            <MaxKeys>100</MaxKeys>
            <IsTruncated>false</IsTruncated>
            <Contents><Size>1</Size></Contents>
          </ListBucketResult>`
      },
      {
        statusCode: 200,
        body: `<?xml version="1.0" encoding="UTF-8"?>
          <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
            <Name>private-files</Name>
            <Prefix>${FILE_MANAGED_OBJECT_PREFIX}</Prefix>
            <KeyCount>0</KeyCount>
            <MaxKeys>100</MaxKeys>
            <IsTruncated>true</IsTruncated>
          </ListBucketResult>`
      },
      {
        statusCode: 200,
        body: `<?xml version="1.0" encoding="UTF-8"?>
          <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
            <Name>private-files</Name>
            <Prefix>${FILE_MANAGED_OBJECT_PREFIX}</Prefix>
            <KeyCount>2</KeyCount>
            <MaxKeys>1</MaxKeys>
            <IsTruncated>false</IsTruncated>
            <Contents><Key>${newObjectKey}</Key><Size>1</Size></Contents>
            <Contents><Key>files/v1/file_223e4567-e89b-42d3-a456-426614174000</Key><Size>1</Size></Contents>
          </ListBucketResult>`
      },
      {
        statusCode: 200,
        body: `<?xml version="1.0" encoding="UTF-8"?>
          <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
            <Name>private-files</Name>
            <Prefix>${FILE_MANAGED_OBJECT_PREFIX}</Prefix>
            <KeyCount>2</KeyCount>
            <MaxKeys>2</MaxKeys>
            <IsTruncated>false</IsTruncated>
            <Contents><Key>${newObjectKey}</Key><Size>1</Size></Contents>
            <Contents><Key>${newObjectKey}</Key><Size>1</Size></Contents>
          </ListBucketResult>`
      }
    ])
    const storage = createStorage(transport.handler)

    for (const limit of [0, 101, Number.NaN]) {
      await expect(storage.listPage({ prefix: FILE_MANAGED_OBJECT_PREFIX, limit })).rejects.toThrow(
        'R2 object pages must contain between 1 and 100 objects'
      )
    }
    for (const continuationToken of ['', 'x'.repeat(4097)]) {
      await expect(storage.listPage({ prefix: FILE_MANAGED_OBJECT_PREFIX, continuationToken })).rejects.toThrow(
        'R2 continuation tokens must contain between 1 and 4096 characters'
      )
    }
    await expect(storage.listPage({ prefix: FILE_MANAGED_OBJECT_PREFIX })).resolves.toEqual({
      keys: [],
      nextContinuationToken: undefined
    })
    await expect(storage.listPage({ prefix: FILE_MANAGED_OBJECT_PREFIX })).rejects.toThrow(
      'R2 returned an object page entry without a key'
    )
    await expect(storage.listPage({ prefix: FILE_MANAGED_OBJECT_PREFIX })).rejects.toThrow(
      'R2 returned a truncated object page without a continuation token'
    )
    await expect(storage.listPage({ prefix: FILE_MANAGED_OBJECT_PREFIX, limit: 1 })).rejects.toThrow(
      'R2 returned more objects than the requested page limit'
    )
    await expect(storage.listPage({ prefix: FILE_MANAGED_OBJECT_PREFIX, limit: 2 })).rejects.toThrow(
      'R2 returned a duplicate object in one page'
    )
    expect(transport.requests).toHaveLength(5)
  })

  it('surfaces partial bulk-delete failures without exposing object keys in the error', async () => {
    const transport = fakeTransport([
      {
        statusCode: 200,
        body: `<?xml version="1.0" encoding="UTF-8"?>
          <DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
            <Deleted><Key>${newObjectKey}</Key></Deleted>
            <Error><Key>${secondObjectKey}</Key><Code>InternalError</Code><Message>retry</Message></Error>
          </DeleteResult>`
      }
    ])
    const storage = createStorage(transport.handler)

    const error = await storage.deleteObjects([newObjectKey, secondObjectKey]).catch((failure: unknown) => failure)

    expect(error).toBeInstanceOf(R2PartialDeleteError)
    expect(error).toMatchObject({ failedCount: 1, codes: ['InternalError'] })
    expect(String(error)).not.toContain(newObjectKey)
    expect(String(error)).not.toContain(secondObjectKey)
    expect(transport.requests).toHaveLength(1)
    expect(transport.requests[0]?.request.method).toBe('POST')
    expect(transport.requests[0]?.request.query).toHaveProperty('delete')
  })

  it('skips empty deletion and reports plural provider errors with a safe fallback code', async () => {
    const transport = fakeTransport([
      {
        statusCode: 200,
        body: `<?xml version="1.0" encoding="UTF-8"?>
          <DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
            <Error><Key>${newObjectKey}</Key><Message>retry</Message></Error>
            <Error><Key>${secondObjectKey}</Key><Code>InternalError</Code><Message>retry</Message></Error>
          </DeleteResult>`
      }
    ])
    const storage = createStorage(transport.handler)

    await expect(storage.deleteObjects([])).resolves.toBeUndefined()
    const error = await storage.deleteObjects([newObjectKey, secondObjectKey]).catch((failure: unknown) => failure)
    expect(error).toBeInstanceOf(R2PartialDeleteError)
    expect(error).toMatchObject({ failedCount: 2, codes: ['InternalError', 'Unknown'] })
    expect(String(error)).toContain('2 managed objects')
    expect(transport.requests).toHaveLength(1)
  })

  it('accepts a successful nonempty provider deletion response', async () => {
    const transport = fakeTransport([
      {
        statusCode: 200,
        body: `<?xml version="1.0" encoding="UTF-8"?>
          <DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
            <Deleted><Key>${newObjectKey}</Key></Deleted>
          </DeleteResult>`
      }
    ])
    const storage = createStorage(transport.handler)

    await expect(storage.deleteObjects([newObjectKey])).resolves.toBeUndefined()
    expect(transport.requests).toHaveLength(1)
    expect(transport.requests[0]?.request.method).toBe('POST')
  })

  it('uses the SDK standard retry policy with exactly three total attempts for retryable provider failures', async () => {
    const unavailable = {
      statusCode: 503,
      body: '<Error><Code>ServiceUnavailable</Code><Message>retry later</Message></Error>'
    }
    const transport = fakeTransport([unavailable, unavailable, unavailable])
    const storage = createStorage(transport.handler)

    await expect(storage.headPersistedObject(newObjectKey)).rejects.toMatchObject({
      name: 'ServiceUnavailable',
      $metadata: expect.objectContaining({ attempts: 3 })
    })
    expect(transport.requests).toHaveLength(3)
    expect(transport.requests.every(({ options }) => options.abortSignal instanceof AbortSignal)).toBe(true)
  })

  it('does not retry a deterministic access-denied response', async () => {
    const transport = fakeTransport([
      {
        statusCode: 403,
        body: '<Error><Code>AccessDenied</Code><Message>denied</Message></Error>'
      }
    ])
    const storage = createStorage(transport.handler)

    await expect(storage.headPersistedObject(newObjectKey)).rejects.toMatchObject({
      name: 'AccessDenied',
      $metadata: expect.objectContaining({ attempts: 1 })
    })
    expect(transport.requests).toHaveLength(1)
  })

  it('actively aborts a hanging provider transport at the configured request deadline', async () => {
    const observedSignals: AbortSignal[] = []
    let abortEvents = 0
    const handler = {
      handle(_request: ObservedRequest, options: ObservedHandlerOptions) {
        if (options.abortSignal) observedSignals.push(options.abortSignal)
        return new Promise<never>((_resolve, reject) => {
          const signal = options.abortSignal
          if (!signal) return reject(new Error('missing abort signal'))
          const rejectForAbort = () => {
            abortEvents += 1
            reject(signal.reason ?? new Error('aborted'))
          }
          if (signal.aborted) rejectForAbort()
          else signal.addEventListener('abort', rejectForAbort, { once: true })
        })
      },
      destroy() {}
    } as NonNullable<R2ObjectStorageOptions['requestHandler']>
    const storage = createStorage(handler, { requestTimeoutMs: 10 })

    await expect(storage.headPersistedObject(newObjectKey)).rejects.toBeDefined()
    expect(observedSignals).toHaveLength(3)
    expect(observedSignals.every((signal) => signal.aborted)).toBe(true)
    expect(abortEvents).toBe(3)
  })

  it('never sends unbounded deletion batches or keys outside persisted managed shapes', async () => {
    const transport = fakeTransport([])
    const storage = createStorage(transport.handler)

    await expect(storage.deleteObjects(Array.from({ length: 101 }, () => newObjectKey))).rejects.toThrow(
      'R2 deletion is limited to 100 managed objects per request'
    )
    await expect(storage.deleteObjects(['foreign/private.txt'])).rejects.toThrow(
      'R2 object key is outside the managed Files prefix'
    )
    expect(transport.requests).toHaveLength(0)
  })

  it('fails closed if R2 returns an object outside the requested prefix', async () => {
    const transport = fakeTransport([
      {
        statusCode: 200,
        body: `<?xml version="1.0" encoding="UTF-8"?>
          <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
            <Name>private-files</Name>
            <Prefix>${FILE_MANAGED_OBJECT_PREFIX}</Prefix>
            <KeyCount>1</KeyCount>
            <MaxKeys>100</MaxKeys>
            <IsTruncated>false</IsTruncated>
            <Contents><Key>foreign/${newObjectKey}</Key><Size>7</Size></Contents>
          </ListBucketResult>`
      }
    ])
    const storage = createStorage(transport.handler)

    await expect(storage.listPage({ prefix: FILE_MANAGED_OBJECT_PREFIX })).rejects.toThrow(
      'R2 returned an object outside the requested prefix'
    )
  })

  it('fails closed on a malformed object inside the current managed prefix', async () => {
    const transport = fakeTransport([
      {
        statusCode: 200,
        body: `<?xml version="1.0" encoding="UTF-8"?>
          <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
            <Name>private-files</Name>
            <Prefix>${FILE_MANAGED_OBJECT_PREFIX}</Prefix>
            <KeyCount>1</KeyCount>
            <MaxKeys>100</MaxKeys>
            <IsTruncated>false</IsTruncated>
            <Contents><Key>${FILE_MANAGED_OBJECT_PREFIX}operator-created.txt</Key><Size>7</Size></Contents>
          </ListBucketResult>`
      }
    ])
    const storage = createStorage(transport.handler)

    await expect(storage.listPage({ prefix: FILE_MANAGED_OBJECT_PREFIX })).rejects.toThrow(
      'R2 returned a malformed object inside the current Files prefix'
    )
  })
})

function createStorage(
  requestHandler?: NonNullable<R2ObjectStorageOptions['requestHandler']>,
  options: Omit<R2ObjectStorageOptions, 'requestHandler'> = {}
) {
  const storage = new R2ObjectStorage(r2Config(), { ...options, requestHandler })
  storages.push(storage)
  return storage
}

function r2Config(): R2ObjectStorageConfig {
  return {
    accountId,
    bucket: 'private-files',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-access-key'
  }
}

type FakeProviderResponse = Readonly<{
  statusCode: number
  headers?: Readonly<Record<string, string>>
  body?: string
}>

type ObservedRequest = Readonly<{
  method: string
  path: string
  query?: Readonly<Record<string, string>>
}>

type ObservedHandlerOptions = Readonly<{
  abortSignal?: AbortSignal
}>

function fakeTransport(responses: readonly FakeProviderResponse[]) {
  const queue = [...responses]
  const requests: Array<{ request: ObservedRequest; options: ObservedHandlerOptions }> = []
  const handler = {
    async handle(request: ObservedRequest, options: ObservedHandlerOptions) {
      requests.push({ request, options })
      const next = queue.shift()
      if (!next) throw new Error('Unexpected R2 provider request')

      return {
        response: {
          statusCode: next.statusCode,
          headers: {
            'content-type': 'application/xml',
            'x-amz-request-id': `fake-request-${requests.length}`,
            ...next.headers
          },
          body: next.body === undefined ? undefined : Readable.from([next.body])
        }
      }
    },
    destroy() {}
  }

  return {
    handler: handler as NonNullable<R2ObjectStorageOptions['requestHandler']>,
    requests
  }
}
