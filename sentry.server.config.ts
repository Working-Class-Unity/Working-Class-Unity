import * as Sentry from '@sentry/nuxt'
import { resolveSentryServerPreloadConfiguration } from './shared/sentry-environment'
import { createSentryPrivacyOptions } from './shared/sentry-privacy'

const configuration = resolveSentryServerPreloadConfiguration(process.env)

if (configuration) {
  Sentry.init({
    dsn: configuration.dsn,
    enabled: true,
    ...createSentryPrivacyOptions(configuration),
    includeLocalVariables: false
  })
}
