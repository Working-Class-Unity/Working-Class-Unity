import { setResponseHeader, setResponseStatus } from 'h3'
import { isBasicReleaseExcludedPathname } from '../../shared/basic-release-policy'
import { getCanonicalRequestPathname } from '../utils/request-path'

export default defineEventHandler((event) => {
  const pathname = getCanonicalRequestPathname(event)
  if (!isBasicReleaseExcludedPathname(pathname)) return

  setResponseHeader(event, 'cache-control', 'no-store')
  setResponseStatus(event, 404, 'Not Found')
  return { statusCode: 404, statusMessage: 'Not Found' }
})
