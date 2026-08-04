import { createError, getRequestHeader } from 'h3'
import { captureException } from '../../services/observability/capture'
import { notFoundError, unauthorizedError } from '../../utils/errors'
import { getAppRuntimeConfig } from '../../utils/runtime'

export default defineEventHandler(async (event) => {
  const testToken = getAppRuntimeConfig().observability.testToken

  if (!testToken) {
    throw notFoundError('Observability test route is not enabled')
  }

  if (getRequestHeader(event, 'x-observability-test-token') !== testToken) {
    throw unauthorizedError('Invalid observability test token')
  }

  const error = new Error('Sentry server test error')

  await captureException(error, 'observability-test-error')

  throw createError({
    statusCode: 500,
    statusMessage: 'Observability test error captured'
  })
})
