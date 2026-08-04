import { getRequestHeader } from 'h3'
import { notFoundError, unauthorizedError } from '../../utils/errors'
import { getAppRuntimeConfig } from '../../utils/runtime'

export default defineEventHandler((event) => {
  const testToken = getAppRuntimeConfig().observability.testToken

  if (!testToken) {
    throw notFoundError('Observability client test is not enabled')
  }

  if (getRequestHeader(event, 'x-observability-test-token') !== testToken) {
    throw unauthorizedError('Invalid observability test token')
  }

  return {
    ok: true,
    test: 'client'
  }
})
