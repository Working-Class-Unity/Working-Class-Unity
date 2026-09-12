import { createError } from 'h3'

const SENSITIVE_FIELD_PATTERN = /(authorization|cookie|password|privateKey|secret|token)/i

export function validationError(statusMessage = 'Invalid request input', data?: unknown) {
  return createError({
    statusCode: 400,
    statusMessage,
    data: safeErrorData(data)
  })
}

export function unauthorizedError(statusMessage = 'Authentication required') {
  return createError({
    statusCode: 401,
    statusMessage
  })
}

export function notFoundError(statusMessage = 'Not found') {
  return createError({
    statusCode: 404,
    statusMessage
  })
}

export function safeErrorData(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data
  }

  if (['boolean', 'number', 'string'].includes(typeof data)) {
    return data
  }

  if (Array.isArray(data)) {
    return data.map((item) => safeErrorData(item))
  }

  if (typeof data === 'object') {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>).map(([key, value]) => [
        key,
        SENSITIVE_FIELD_PATTERN.test(key) ? '[redacted]' : safeErrorData(value)
      ])
    )
  }

  return String(data)
}
