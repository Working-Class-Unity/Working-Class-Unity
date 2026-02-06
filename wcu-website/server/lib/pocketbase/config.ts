interface PocketBaseCollectionConfig {
  authCollection: string
  magicLinkCollection: string
  memberProfileCollection: string
  duesRecordCollection: string
  memberProfileUserField: string
  duesRecordUserField: string
}

const DEFAULT_AUTH_COLLECTION = 'users'
const DEFAULT_MAGIC_LINK_COLLECTION = 'auth_magic_links'
const DEFAULT_MEMBER_PROFILE_COLLECTION = 'member_profiles'
const DEFAULT_DUES_RECORD_COLLECTION = 'dues_records'
const DEFAULT_MEMBER_PROFILE_USER_FIELD = 'userId'
const DEFAULT_DUES_RECORD_USER_FIELD = 'userId'

export function getPocketBaseCollectionConfig(): PocketBaseCollectionConfig {
  const config = useRuntimeConfig()

  return {
    authCollection: config.pocketbaseAuthCollection || DEFAULT_AUTH_COLLECTION,
    magicLinkCollection: config.pocketbaseMagicLinkCollection || DEFAULT_MAGIC_LINK_COLLECTION,
    memberProfileCollection: config.pocketbaseMemberProfileCollection || DEFAULT_MEMBER_PROFILE_COLLECTION,
    duesRecordCollection: config.pocketbaseDuesRecordCollection || DEFAULT_DUES_RECORD_COLLECTION,
    memberProfileUserField: config.pocketbaseMemberProfileUserField || DEFAULT_MEMBER_PROFILE_USER_FIELD,
    duesRecordUserField: config.pocketbaseDuesRecordUserField || DEFAULT_DUES_RECORD_USER_FIELD,
  }
}
