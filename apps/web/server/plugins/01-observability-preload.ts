import * as Sentry from '@sentry/nuxt'
import { getAppRuntimeConfig } from '../utils/runtime'

const sentryWasPreloadedBeforeApplication = Boolean(Sentry.getClient())

export default defineNitroPlugin(() => {
  const config = getAppRuntimeConfig()

  if (config.modules.observability.enabled && !sentryWasPreloadedBeforeApplication) {
    throw new Error('Sentry must be preloaded before the production application starts')
  }
})
