import * as Sentry from '@sentry/nuxt'
import { isPublicModuleReady } from '#shared/module-states'
import { createSentryPrivacyOptions, sentryTracePropagationTargets } from './shared/sentry-privacy'

const config = useRuntimeConfig()

if (isPublicModuleReady(config.public.moduleStates, 'observability')) {
  const dsn = String(config.public.sentryDsn || '')
  const environment = String(config.public.sentryEnvironment || 'development')
  const release = config.public.sentryRelease ? String(config.public.sentryRelease) : undefined
  const tracesSampleRate = Number(config.public.sentryTracesSampleRate || '0.05')

  Sentry.init({
    dsn: dsn || undefined,
    enabled: true,
    ...createSentryPrivacyOptions({
      environment,
      release,
      tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0.05
    }),
    tracePropagationTargets: sentryTracePropagationTargets
  })
}
