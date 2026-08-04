import { createAuthClient } from 'better-auth/vue'
import { magicLinkClient, organizationClient } from 'better-auth/client/plugins'
import { organizationAccessControl, organizationPluginRoles } from '#shared/organization-access'

// The app pins its auth route; separate config guards reject alternate origin
// fallbacks. Auth and billing fetch the public session endpoint with a relative
// Nuxt useFetch call so SSR cookies and the hydration payload share one key.
export const authClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [
    organizationClient({
      ac: organizationAccessControl,
      roles: organizationPluginRoles
    }),
    magicLinkClient()
  ]
})
