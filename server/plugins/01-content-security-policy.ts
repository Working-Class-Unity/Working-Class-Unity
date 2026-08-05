import type { ContentSecurityPolicyValue } from 'nuxt-security'
import { withBrowserProviderSources } from '../../shared/content-security-policy'
import { r2BrowserRequestOrigin } from '../services/storage/r2-object-storage'
import { getAppRuntimeConfig } from '../utils/runtime'

export default defineNitroPlugin((nitroApp) => {
  const config = getAppRuntimeConfig()

  nitroApp.hooks.hook('nuxt-security:routeRules', (routeRules) => {
    const headers = routeRules['/**']?.headers
    const policy = headers && typeof headers === 'object' ? headers.contentSecurityPolicy : undefined

    if (!policy || typeof policy === 'boolean') {
      throw new TypeError('The global browser Content Security Policy must be configured')
    }

    headers.contentSecurityPolicy = withBrowserProviderSources(policy as ContentSecurityPolicyValue, {
      sentryDsn: config.public.sentryDsn,
      fileRequestOrigin:
        config.files.driver === 'r2'
          ? r2BrowserRequestOrigin({
              accountId: config.cloudflare.accountId,
              bucket: config.cloudflare.r2.bucket,
              endpoint: config.cloudflare.r2.endpoint
            })
          : ''
    })
  })
})
