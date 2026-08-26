import * as Sentry from '@sentry/nuxt'
import { getAppRuntimeConfig } from '../utils/runtime'

const sentryWasPreloadedBeforeApplication = Boolean(Sentry.getClient())

export default defineNitroPlugin(() => {
  const config = getAppRuntimeConfig()

  if (process.env.NODE_ENV === 'production' && config.sentryDsn && !sentryWasPreloadedBeforeApplication) {
    throw new Error('Sentry must be preloaded before the production application starts')
  }
})
