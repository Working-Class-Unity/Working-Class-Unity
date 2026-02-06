interface PocketBaseCollectionConfig {
  authCollection: string
  magicLinkCollection: string
}

const DEFAULT_AUTH_COLLECTION = 'users'
const DEFAULT_MAGIC_LINK_COLLECTION = 'auth_magic_links'

export function getPocketBaseCollectionConfig(): PocketBaseCollectionConfig {
  const config = useRuntimeConfig()

  return {
    authCollection: config.pocketbaseAuthCollection || DEFAULT_AUTH_COLLECTION,
    magicLinkCollection: config.pocketbaseMagicLinkCollection || DEFAULT_MAGIC_LINK_COLLECTION,
  }
}
