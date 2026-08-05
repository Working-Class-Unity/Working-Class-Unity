type RuntimeEnvironment = Readonly<Record<string, string | undefined>>

export type SentryServerPreloadConfiguration = Readonly<{
  dsn: string
  environment: string
  release?: string
  tracesSampleRate: number
}>

/**
 * The server config is loaded by Node before Nitro, so it cannot depend on
 * Nuxt runtime config. Keep this boundary limited to the exact Observability
 * inputs needed to initialize Sentry early enough to observe startup failures.
 */
export function resolveSentryServerPreloadConfiguration(
  environment: RuntimeEnvironment
): SentryServerPreloadConfiguration | undefined {
  const dsn = exactHttpUrl(environment.NUXT_SENTRY_DSN)
  const publicDsn = exactHttpUrl(environment.NUXT_PUBLIC_SENTRY_DSN)
  const tracesSampleRate = optionalSampleRate(environment.NUXT_SENTRY_TRACES_SAMPLE_RATE)
  const publicTracesSampleRate = optionalSampleRate(environment.NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE)

  if (!dsn || !publicDsn || tracesSampleRate === undefined || publicTracesSampleRate === undefined) {
    return undefined
  }

  const release = environment.NUXT_SENTRY_RELEASE || environment.NUXT_PUBLIC_SENTRY_RELEASE

  return {
    dsn,
    environment: environment.NUXT_SENTRY_ENVIRONMENT ?? environment.NODE_ENV ?? 'development',
    ...(release ? { release } : {}),
    tracesSampleRate
  }
}

function exactHttpUrl(value: string | undefined): string | undefined {
  if (!value || value !== value.trim()) return undefined

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : undefined
  } catch {
    return undefined
  }
}

function optionalSampleRate(value: string | undefined): number | undefined {
  if (value === undefined) return 0.05
  if (!value.trim()) return undefined

  const number = Number(value)
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : undefined
}
