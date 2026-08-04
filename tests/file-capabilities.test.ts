import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFileDownloadToken,
  createFileUploadToken,
  verifyFileDownloadToken,
  verifyFileUploadToken
} from '../server/services/storage/file-tokens'
import type { AppRuntimeConfig } from '../server/utils/runtime'
import * as runtime from '../server/utils/runtime'

const capabilitySecret = 'file-capability-test-secret-at-least-thirty-two-characters'
const fileId = 'file_123e4567-e89b-42d3-a456-426614174000'
const ownerId = 'capability-owner'
const contentMd5 = 'ndTkYSaMgDT1yFZOFVxnpg=='

beforeEach(() => {
  vi.spyOn(runtime, 'getAppRuntimeConfig').mockReturnValue({
    betterAuth: { secret: capabilitySecret },
    modules: { files: { enabled: true } }
  } as AppRuntimeConfig)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('private file capabilities', () => {
  it('rejects malformed and tampered capabilities without reflecting their bearer value or signing secret', () => {
    const token = uploadToken('2099-01-01T00:15:00.000Z')
    const [body, signature] = token.split('.') as [string, string]
    const replacement = signature.endsWith('A') ? 'B' : 'A'
    const changedSignature = `${signature.slice(0, -1)}${replacement}`

    for (const candidate of ['', `${body}.`, `${body}.${signature}.extra`, `${body}.${changedSignature}`]) {
      const error = catchError(() => verifyFileUploadToken(candidate))
      expect(error).toMatchObject({ statusCode: 403, statusMessage: 'File capability is invalid' })
      expect(String(error)).not.toContain(capabilitySecret)
      if (candidate) expect(String(error)).not.toContain(candidate)
    }
  })

  it('keeps upload and download authorities action-specific', () => {
    const expiresAt = '2099-01-01T00:15:00.000Z'
    const upload = uploadToken(expiresAt)
    const download = createFileDownloadToken({ fileId, ownerId, expiresAt })

    expect(catchError(() => verifyFileDownloadToken(upload))).toMatchObject({
      statusCode: 403,
      statusMessage: 'File capability is invalid'
    })
    expect(catchError(() => verifyFileUploadToken(download))).toMatchObject({
      statusCode: 403,
      statusMessage: 'File capability is invalid'
    })
  })

  it('expires a valid capability at its exact persisted deadline', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z'))
    const token = createFileDownloadToken({
      fileId,
      ownerId,
      expiresAt: '2026-07-15T12:00:01.000Z'
    })

    expect(verifyFileDownloadToken(token)).toEqual({
      action: 'download',
      fileId,
      ownerId,
      expiresAt: '2026-07-15T12:00:01.000Z'
    })

    vi.advanceTimersByTime(1_000)
    expect(catchError(() => verifyFileDownloadToken(token))).toMatchObject({
      statusCode: 403,
      statusMessage: 'File capability has expired'
    })
  })

  it('refuses caller-shaped identifiers and invalid upload declarations before issuing a capability', () => {
    expect(
      catchError(() =>
        createFileDownloadToken({
          fileId: 'caller-shaped-file-id',
          ownerId,
          expiresAt: '2099-01-01T00:15:00.000Z'
        })
      )
    ).toMatchObject({ statusCode: 403, statusMessage: 'File capability is invalid' })

    expect(
      catchError(() =>
        createFileUploadToken({
          fileId,
          ownerId,
          expiresAt: '2099-01-01T00:15:00.000Z',
          byteSize: 0,
          contentType: 'text/plain',
          contentMd5
        })
      )
    ).toMatchObject({ statusCode: 403, statusMessage: 'File capability is invalid' })
  })
})

function uploadToken(expiresAt: string) {
  return createFileUploadToken({
    fileId,
    ownerId,
    expiresAt,
    byteSize: 1,
    contentType: 'text/plain',
    contentMd5
  })
}

function catchError(action: () => unknown) {
  try {
    action()
  } catch (error) {
    return error
  }
  throw new Error('Expected the file capability operation to fail')
}
