import { Buffer } from 'node:buffer'
import { request as nodeRequest, type IncomingHttpHeaders, type OutgoingHttpHeaders } from 'node:http'

type BodyRequestOptions = Readonly<{
  endRequest?: boolean
  headers?: OutgoingHttpHeaders
  method?: string
}>

type TestHttpResponse = Readonly<{
  body: string
  headers: IncomingHttpHeaders
  status: number
}>

export function requestWithDeclaredBody(
  url: string | URL,
  declaredByteLength: number,
  chunks: readonly Uint8Array[],
  options: BodyRequestOptions = {}
): Promise<TestHttpResponse> {
  return requestWithBodyChunks(url, chunks, {
    ...options,
    headers: bodyHeaders(options.headers, 'content-length', String(declaredByteLength))
  })
}

export function requestWithChunkedBody(
  url: string | URL,
  chunks: readonly Uint8Array[],
  options: BodyRequestOptions = {}
): Promise<TestHttpResponse> {
  return requestWithBodyChunks(url, chunks, {
    ...options,
    headers: bodyHeaders(options.headers, 'transfer-encoding', 'chunked')
  })
}

function requestWithBodyChunks(
  url: string | URL,
  chunks: readonly Uint8Array[],
  options: BodyRequestOptions
): Promise<TestHttpResponse> {
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    }
    const request = nodeRequest(
      url,
      {
        method: options.method ?? 'POST',
        headers: options.headers
      },
      (response) => {
        const responseChunks: Buffer[] = []
        response.on('data', (chunk) => responseChunks.push(Buffer.from(chunk)))
        response.on('error', fail)
        response.on('end', () => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          if (options.endRequest === false) request.destroy()
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(responseChunks).toString('utf8'),
            headers: response.headers
          })
        })
      }
    )
    request.on('error', fail)
    const timeout = setTimeout(() => {
      request.destroy()
      fail(new Error('Timed out waiting for test HTTP response'))
    }, 5_000)

    request.flushHeaders()
    for (const chunk of chunks) request.write(chunk)
    if (options.endRequest !== false) request.end()
  })
}

function bodyHeaders(
  headers: OutgoingHttpHeaders | undefined,
  framingName: 'content-length' | 'transfer-encoding',
  framingValue: string
): OutgoingHttpHeaders {
  const framedHeaders: OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() !== 'content-length' && name.toLowerCase() !== 'transfer-encoding') {
      framedHeaders[name] = value
    }
  }
  framedHeaders[framingName] = framingValue
  return framedHeaders
}
