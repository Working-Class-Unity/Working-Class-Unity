import { createError, getMethod, getRequestHeader, setResponseHeader } from 'h3'
import {
  crossOriginRequestBlockedCode,
  isCommandOriginAllowed,
  requiresCommandOriginPolicy
} from '../utils/request-origin'
import { getCanonicalRequestPathname } from '../utils/request-path'
import { getAppRuntimeConfig } from '../utils/runtime'

export default defineEventHandler((event) => {
  const method = getMethod(event)
  const pathname = getCanonicalRequestPathname(event)

  if (!requiresCommandOriginPolicy(method, pathname)) return

  setResponseHeader(event, 'cache-control', 'no-store')
  setResponseHeader(event, 'vary', 'Origin, Sec-Fetch-Site')

  const config = getAppRuntimeConfig()
  const allowed = isCommandOriginAllowed(
    {
      origin: getRequestHeader(event, 'origin'),
      referer: getRequestHeader(event, 'referer'),
      secFetchSite: getRequestHeader(event, 'sec-fetch-site')
    },
    config.public.appUrl
  )

  if (allowed) return

  throw createError({
    statusCode: 403,
    statusMessage: 'Cross-origin request blocked',
    data: {
      code: crossOriginRequestBlockedCode
    }
  })
})
