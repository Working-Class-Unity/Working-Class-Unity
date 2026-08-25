import { Buffer } from 'node:buffer'
import { createError, getRequestHeader, readValidatedBody, type H3Event, type ValidateFunction } from 'h3'

const h3RawBodySymbol = Symbol.for('h3RawBody')

type H3RawBodyRequest = H3Event['node']['req'] & {
  [h3RawBodySymbol]?: Buffer
}

export async function readValidatedBodyWithByteLimit<T>(
  event: H3Event,
  byteLimit: number,
  validate: ValidateFunction<T>
): Promise<T> {
  const declaredLength = getRequestHeader(event, 'content-length')
  if (declaredLengthExceedsLimit(declaredLength, byteLimit)) rejectOversizedBody(event)

  const chunks: Buffer[] = []
  let byteLength = 0
  for await (const chunk of event.node.req.iterator({ destroyOnReturn: false })) {
    const chunkByteLength = Buffer.byteLength(chunk)
    if (byteLength + chunkByteLength > byteLimit) {
      chunks.length = 0
      rejectOversizedBody(event)
    }
    byteLength += chunkByteLength
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  const request = event.node.req as H3RawBodyRequest
  request[h3RawBodySymbol] = Buffer.concat(chunks, byteLength)
  return readValidatedBody(event, validate)
}

function declaredLengthExceedsLimit(value: string | undefined, byteLimit: number): boolean {
  const normalized = value?.trim()
  if (!normalized || !/^\d+$/.test(normalized)) return false
  return BigInt(normalized) > BigInt(byteLimit)
}

function rejectOversizedBody(event: H3Event): never {
  event.node.req.resume()
  throw createError({ statusCode: 413, statusMessage: 'Payload Too Large' })
}
