import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { createApp, createError, createRouter, defineEventHandler, toNodeListener, type EventHandler } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fileUploadCompleteBodyLimitBytes,
  fileUploadCreateBodyLimitBytes
} from '../server/services/storage/file-policy'
import { requestWithChunkedBody, requestWithDeclaredBody } from './helpers/http-request'

const sessionMocks = vi.hoisted(() => ({ requireSession: vi.fn() }))
const serviceMocks = vi.hoisted(() => ({
  createFileUploadTarget: vi.fn(),
  completeFileUpload: vi.fn()
}))

vi.mock('../server/utils/auth/require-session', () => sessionMocks)
vi.mock('../server/services/storage/file-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/services/storage/file-service')>()),
  createFileUploadTarget: serviceMocks.createFileUploadTarget,
  completeFileUpload: serviceMocks.completeFileUpload
}))

let server: Server
let baseUrl: string

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', defineEventHandler)
  const [uploads, complete] = await Promise.all([
    import('../server/api/files/uploads.post').then((module) => module.default),
    import('../server/api/files/[id]/complete.post').then((module) => module.default)
  ])
  const router = createRouter()
    .post('/api/files/uploads', uploads as EventHandler)
    .post('/api/files/:id/complete', complete as EventHandler)
  server = createServer(toNodeListener(createApp().use(router)))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new TypeError('Expected a TCP test address')
  baseUrl = `http://127.0.0.1:${address.port}`
})

beforeEach(() => {
  vi.clearAllMocks()
  sessionMocks.requireSession.mockResolvedValue({ user: { id: 'file-http-owner' } })
  serviceMocks.createFileUploadTarget.mockResolvedValue({ file: publicFile('file-http-created') })
  serviceMocks.completeFileUpload.mockResolvedValue(publicFile('file-http-created'))
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

describe('private Files HTTP body boundaries', () => {
  it('authenticates before rejecting an oversized upload request', async () => {
    sessionMocks.requireSession.mockRejectedValueOnce(
      createError({ statusCode: 401, statusMessage: 'Authentication required' })
    )
    const response = await requestWithDeclaredBody(
      new URL('/api/files/uploads', baseUrl),
      fileUploadCreateBodyLimitBytes + 1,
      [],
      { endRequest: false, headers: { 'content-type': 'application/json' } }
    )

    expect(response.status).toBe(401)
    expect(serviceMocks.createFileUploadTarget).not.toHaveBeenCalled()
  })

  it('admits exactly 4,096 upload bytes and rejects declared or streamed byte 4,097', async () => {
    const exact = uploadBodyWithByteLength(fileUploadCreateBodyLimitBytes)
    const admitted = await requestWithDeclaredBody(new URL('/api/files/uploads', baseUrl), exact.byteLength, [exact], {
      headers: { 'content-type': 'application/json' }
    })
    expect(admitted.status).toBe(201)
    expect(serviceMocks.createFileUploadTarget).toHaveBeenCalledOnce()

    vi.clearAllMocks()
    sessionMocks.requireSession.mockResolvedValue({ user: { id: 'file-http-owner' } })
    const declared = await requestWithDeclaredBody(
      new URL('/api/files/uploads', baseUrl),
      fileUploadCreateBodyLimitBytes + 1,
      [],
      { endRequest: false, headers: { 'content-type': 'application/json' } }
    )
    expectPayloadTooLarge(declared)
    const overflow = Buffer.concat([exact, Buffer.from(' ')])
    const chunked = await requestWithChunkedBody(
      new URL('/api/files/uploads', baseUrl),
      [overflow.subarray(0, fileUploadCreateBodyLimitBytes), overflow.subarray(fileUploadCreateBodyLimitBytes)],
      { endRequest: false, headers: { 'content-type': 'application/json' } }
    )
    expectPayloadTooLarge(chunked)
    expect(serviceMocks.createFileUploadTarget).not.toHaveBeenCalled()
  })

  it('admits exactly 1,024 completion bytes and rejects declared or streamed byte 1,025', async () => {
    const exact = emptyObjectBodyWithByteLength(fileUploadCompleteBodyLimitBytes)
    const admitted = await requestWithDeclaredBody(
      new URL('/api/files/file-http-created/complete', baseUrl),
      exact.byteLength,
      [exact],
      { headers: { 'content-type': 'application/json' } }
    )
    expect(admitted.status).toBe(200)
    expect(serviceMocks.completeFileUpload).toHaveBeenCalledOnce()

    vi.clearAllMocks()
    sessionMocks.requireSession.mockResolvedValue({ user: { id: 'file-http-owner' } })
    const declared = await requestWithDeclaredBody(
      new URL('/api/files/file-http-created/complete', baseUrl),
      fileUploadCompleteBodyLimitBytes + 1,
      [],
      { endRequest: false, headers: { 'content-type': 'application/json' } }
    )
    expectPayloadTooLarge(declared)
    const overflow = Buffer.concat([exact, Buffer.from(' ')])
    const chunked = await requestWithChunkedBody(
      new URL('/api/files/file-http-created/complete', baseUrl),
      [overflow.subarray(0, fileUploadCompleteBodyLimitBytes), overflow.subarray(fileUploadCompleteBodyLimitBytes)],
      { endRequest: false, headers: { 'content-type': 'application/json' } }
    )
    expectPayloadTooLarge(chunked)
    expect(serviceMocks.completeFileUpload).not.toHaveBeenCalled()
  })
})

function uploadBodyWithByteLength(byteLength: number) {
  const contentMd5 = createHash('md5').update('x').digest('base64')
  const encoded = Buffer.from(
    JSON.stringify({ filename: 'private.txt', contentType: 'text/plain', byteSize: 1, contentMd5 })
  )
  if (encoded.byteLength > byteLength) throw new Error('File upload body exceeds requested test size')
  return Buffer.concat([encoded, Buffer.alloc(byteLength - encoded.byteLength, 0x20)])
}

function emptyObjectBodyWithByteLength(byteLength: number) {
  const encoded = Buffer.from('{}')
  return Buffer.concat([encoded, Buffer.alloc(byteLength - encoded.byteLength, 0x20)])
}

function publicFile(id: string) {
  return {
    id,
    filename: 'private.txt',
    contentType: 'text/plain',
    byteSize: 1,
    status: 'pending',
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z'
  }
}

function expectPayloadTooLarge(response: { body: string; status: number }) {
  expect(response.status).toBe(413)
  expect(JSON.parse(response.body)).toMatchObject({ statusCode: 413, statusMessage: 'Payload Too Large' })
}
