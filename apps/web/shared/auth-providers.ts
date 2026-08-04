export const socialProviderIds = ['google'] as const

export type SocialProviderId = (typeof socialProviderIds)[number]
export type PublicSocialProviderState = 'disabled' | 'ready'
export type PublicSocialProviderStates = Readonly<Record<SocialProviderId, PublicSocialProviderState>>

type SocialProviderManifestEntry = Readonly<{
  label: string
  enabledEnvironmentKey: string
  clientIdEnvironmentKey: string
  clientSecretEnvironmentKey: string
  scopes: readonly string[]
}>

/**
 * The app-owned social-provider inventory. Runtime validation, Better Auth
 * configuration, public state projection, UI, and tests consume this object so
 * a provider cannot silently exist in only one layer.
 */
export const socialProviderManifest = {
  google: {
    label: 'Google',
    enabledEnvironmentKey: 'NUXT_SOCIAL_PROVIDERS_GOOGLE_ENABLED',
    clientIdEnvironmentKey: 'NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_ID',
    clientSecretEnvironmentKey: 'NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_SECRET',
    // Authentication-only OpenID Connect scopes. Caller-supplied additions are
    // rejected at the application hook before Better Auth creates OAuth state.
    scopes: ['openid', 'email']
  }
} as const satisfies Record<SocialProviderId, SocialProviderManifestEntry>
