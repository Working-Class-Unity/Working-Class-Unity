import PocketBase from 'pocketbase'

let cachedServiceClient: PocketBase | null = null

const createClient = (): PocketBase => {
  const config = useRuntimeConfig()

  if (!config.pocketbaseUrl) {
    throw createError({
      statusCode: 500,
      statusMessage: 'POCKETBASE_URL is not configured',
    })
  }

  return new PocketBase(config.pocketbaseUrl)
}

export const getPocketBaseClient = (): PocketBase => {
  return createClient()
}

export const getPocketBaseServiceClient = async (): Promise<PocketBase> => {
  const config = useRuntimeConfig()

  if (!config.pocketbaseServiceEmail || !config.pocketbaseServicePassword) {
    throw createError({
      statusCode: 500,
      statusMessage: 'PocketBase service credentials are not configured',
    })
  }

  if (!cachedServiceClient) {
    cachedServiceClient = createClient()
  }

  if (!cachedServiceClient.authStore.isValid) {
    await cachedServiceClient
      .collection('_superusers')
      .authWithPassword(config.pocketbaseServiceEmail, config.pocketbaseServicePassword)
  }

  return cachedServiceClient
}
