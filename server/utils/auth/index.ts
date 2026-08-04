import { connectDatabase } from '../../db/connect'
import { getTransactionalEmailSender } from '../../services/email'
import { getAppRuntimeConfig } from '../runtime'
import { createAuthentication } from './create'

const config = getAppRuntimeConfig()
const database = connectDatabase(config.databaseUrl)

export const auth = createAuthentication(config, database, getTransactionalEmailSender)

export type BetterAuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>
