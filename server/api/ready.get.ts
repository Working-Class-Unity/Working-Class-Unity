import { getHeader, setHeader, setResponseStatus } from 'h3'
import { evaluateReadiness, readinessReadyResponse, readinessUnauthorizedResponse } from '../utils/readiness'
import { getAppRuntimeConfig } from '../utils/runtime'

export default defineEventHandler((event) => {
  setHeader(event, 'cache-control', 'no-store')

  const result = evaluateReadiness(getHeader(event, 'authorization'), getAppRuntimeConfig())

  if (result === readinessUnauthorizedResponse) {
    setHeader(event, 'www-authenticate', 'Bearer realm="readiness"')
    setResponseStatus(event, 401)
    return result
  }

  if (result !== readinessReadyResponse) {
    setResponseStatus(event, 503)
  }

  return result
})
