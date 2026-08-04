import { setHeader, setResponseStatus } from 'h3'

/**
 * Public process liveness only. Keep this app-owned handler free of runtime
 * configuration, dependency checks, and provider calls so an orchestrator can
 * distinguish a running process from dependency readiness.
 */
export default defineEventHandler((event) => {
  setHeader(event, 'cache-control', 'no-store')
  setResponseStatus(event, 204)
  return null
})
