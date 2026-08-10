import { createAuthClient } from 'better-auth/vue'
import { inferAdditionalFields, magicLinkClient } from 'better-auth/client/plugins'
import { profileUserFields } from '#shared/profile'

// The app pins its auth route; separate config guards reject alternate origin
// fallbacks. Session requests use a relative URL so SSR cookies and the
// hydration payload share one key.
export const authClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [magicLinkClient(), inferAdditionalFields({ user: profileUserFields })]
})
