import { getAppRuntimeConfig } from '../utils/runtime'
import { connectDatabase, type DatabaseConnection } from './connect'
export type { DatabaseConnection } from './connect'

export function useDatabase(): DatabaseConnection {
  return connectDatabase(getAppRuntimeConfig().databaseUrl)
}
