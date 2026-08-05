import * as Sentry from '@sentry/nuxt'
import { getAppRuntimeConfig } from '../utils/runtime'

const sentryWasPreloadedBeforeApplication = Boolean(Sentry.getClient())

export default defineNitroPlugin(() => {
  getAppRuntimeConfig()

  if (process.env.NODE_ENV === 'production' && !sentryWasPreloadedBeforeApplication) {
    throw new Error('Sentry must be preloaded before the production application starts')
  }
})
