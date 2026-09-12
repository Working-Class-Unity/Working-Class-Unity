import { isIP } from 'node:net'
import { isAbsolute } from 'node:path'
import destr from 'destr'
import { z } from 'zod'

/** Token bytes are preserved; the leading letter avoids Nitro scalar coercion. */
export const readinessTokenPattern = /^[A-Za-z][A-Za-z0-9._~+/-]{31,}$/

/** App-owned paths: only NUXT_ leaf variables may override runtime configuration. */
export const canonicalAppRuntimePaths = [
  ['OBSERVABILITY', 'object'],
  ['PUBLIC', 'object'],
  ['DATABASE_URL', 'leaf'],
  ['READINESS_TOKEN', 'leaf'],
  ['SENTRY_DSN', 'leaf'],
  ['SENTRY_ENVIRONMENT', 'leaf'],
  ['SENTRY_RELEASE', 'leaf'],
  ['SENTRY_TRACES_SAMPLE_RATE', 'leaf'],
  ['OBSERVABILITY_TEST_TOKEN', 'leaf'],
  ['PUBLIC_APP_NAME', 'leaf'],
  ['PUBLIC_APP_URL', 'leaf'],
  ['PUBLIC_SENTRY_DSN', 'leaf'],
  ['PUBLIC_SENTRY_ENVIRONMENT', 'leaf'],
  ['PUBLIC_SENTRY_RELEASE', 'leaf'],
  ['PUBLIC_SENTRY_TRACES_SAMPLE_RATE', 'leaf']
] as const

const forbiddenNuxtObjectKeys = new Set(
  canonicalAppRuntimePaths.filter(([, kind]) => kind === 'object').map(([path]) => `NUXT_${path}`)
)
const forbiddenNitroKeys = new Set(canonicalAppRuntimePaths.map(([path]) => `NITRO_${path}`))
type RuntimeEnvironment = Record<string, string | undefined>

export type RuntimeConfigIssue = Readonly<{
  code: 'invalid' | 'mismatch' | 'missing' | 'shape'
  key: string
  message: string
}>

const sampleRateSchema = z.union([z.string(), z.number()]).transform(String)
const runtimeConfigSchema = z.object({
  databaseUrl: z.string(),
  readinessToken: z.string(),
  sentryDsn: z.string(),
  sentryEnvironment: z.string(),
  sentryRelease: z.string(),
  sentryTracesSampleRate: sampleRateSchema,
  observability: z.object({ testToken: z.string() }),
  public: z.object({
    appName: z.string(),
    appUrl: z.string(),
    sentryDsn: z.string(),
    sentryEnvironment: z.string(),
    sentryRelease: z.string(),
    sentryTracesSampleRate: sampleRateSchema
  })
})

type ParsedRuntimeConfig = z.infer<typeof runtimeConfigSchema>
type DeepReadonly<T> = T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> } : T
export type AppRuntimeConfig = DeepReadonly<ParsedRuntimeConfig>
export type RuntimeConfigEvaluation = DeepReadonly<{
  config?: AppRuntimeConfig
  issues: RuntimeConfigIssue[]
}>

let cachedAppRuntimeConfig: AppRuntimeConfig | undefined

export class RuntimeConfigValidationError extends Error {
  readonly issues: readonly RuntimeConfigIssue[]

  constructor(issues: readonly RuntimeConfigIssue[]) {
    const sorted = issues.toSorted((left, right) =>
      `${left.key}\0${left.code}`.localeCompare(`${right.key}\0${right.code}`)
    )
    super(formatRuntimeConfigIssues(sorted))
    this.name = 'RuntimeConfigValidationError'
    this.issues = deepFreeze(sorted)
  }
}

export function getAppRuntimeConfig(): AppRuntimeConfig {
  cachedAppRuntimeConfig ??=
    typeof useRuntimeConfig === 'undefined'
      ? assertStartableRuntimeConfig(evaluateRuntimeEnvironment(process.env))
      : validateRuntimeConfig(useRuntimeConfig(), process.env)
  return cachedAppRuntimeConfig
}

export function evaluateRuntimeEnvironment(environment: RuntimeEnvironment): RuntimeConfigEvaluation {
  return evaluateRuntimeConfig(runtimeConfigFromEnvironment(environment), environment)
}

export function runtimeConfigFromEnvironment(environment: RuntimeEnvironment) {
  // Match Nitro's pinned destr coercion so operator checks and the server agree.
  const value = (key: string, fallback = ''): unknown =>
    environment[key] === undefined ? fallback : (destr(environment[key]) ?? fallback)
  return {
    databaseUrl: value('NUXT_DATABASE_URL'),
    readinessToken: value('NUXT_READINESS_TOKEN'),
    sentryDsn: value('NUXT_SENTRY_DSN'),
    sentryEnvironment: value('NUXT_SENTRY_ENVIRONMENT'),
    sentryRelease: value('NUXT_SENTRY_RELEASE'),
    sentryTracesSampleRate: value('NUXT_SENTRY_TRACES_SAMPLE_RATE', '0.05'),
    observability: { testToken: value('NUXT_OBSERVABILITY_TEST_TOKEN') },
    public: {
      appName: value('NUXT_PUBLIC_APP_NAME', 'Working Class Unity'),
      appUrl: value('NUXT_PUBLIC_APP_URL'),
      sentryDsn: value('NUXT_PUBLIC_SENTRY_DSN'),
      sentryEnvironment: value('NUXT_PUBLIC_SENTRY_ENVIRONMENT'),
      sentryRelease: value('NUXT_PUBLIC_SENTRY_RELEASE'),
      sentryTracesSampleRate: value('NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE', '0.05')
    }
  }
}

export function evaluateRuntimeConfig(input: unknown, environment: RuntimeEnvironment): RuntimeConfigEvaluation {
  const issues: RuntimeConfigIssue[] = []
  validateEnvironmentKeys(environment, issues)
  const parsed = runtimeConfigSchema.safeParse(input)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push(
        configIssue('shape', environmentKeyForPath(issue.path), 'must use the documented runtime configuration shape')
      )
    }
    return deepFreeze({ issues })
  }
  const config = parsed.data
  validateDatabaseUrl(config.databaseUrl, environment.NODE_ENV, issues)
  requireMatch(config.databaseUrl, environment.NUXT_DATABASE_URL, 'NUXT_DATABASE_URL', issues)

  const token = config.readinessToken
  requireMatch(token, environment.NUXT_READINESS_TOKEN, 'NUXT_READINESS_TOKEN', issues)
  if (!token) {
    issues.push(configIssue('missing', 'NUXT_READINESS_TOKEN', 'is required'))
  } else if (!readinessTokenPattern.test(token)) {
    issues.push(
      configIssue(
        'invalid',
        'NUXT_READINESS_TOKEN',
        'must start with an ASCII letter and contain at least 32 Bearer-token characters'
      )
    )
  }
  if (environment.NODE_ENV === 'production' && token === 'local-readiness-token-change-me-32-chars') {
    issues.push(configIssue('invalid', 'NUXT_READINESS_TOKEN', 'must not use the committed local development value'))
  }

  requireMatch(config.public.appUrl, environment.NUXT_PUBLIC_APP_URL, 'NUXT_PUBLIC_APP_URL', issues)
  validateAppOrigin(config.public.appUrl, environment.NODE_ENV, issues)
  if (!config.public.appName || config.public.appName !== config.public.appName.trim()) {
    issues.push(configIssue('invalid', 'NUXT_PUBLIC_APP_NAME', 'must be nonblank and already trimmed'))
  }
  requireMatch(config.public.appName, environment.NUXT_PUBLIC_APP_NAME, 'NUXT_PUBLIC_APP_NAME', issues)
  requireMatch(
    config.observability.testToken,
    environment.NUXT_OBSERVABILITY_TEST_TOKEN,
    'NUXT_OBSERVABILITY_TEST_TOKEN',
    issues
  )
  validateSentry(config, environment, issues)
  return deepFreeze({ config, issues })
}

export function assertStartableRuntimeConfig(evaluation: RuntimeConfigEvaluation): AppRuntimeConfig {
  if (evaluation.issues.length || !evaluation.config) {
    throw new RuntimeConfigValidationError(
      evaluation.issues.length
        ? evaluation.issues
        : [configIssue('shape', 'NUXT_RUNTIME_CONFIG', 'could not be normalized')]
    )
  }
  return evaluation.config
}

export function validateRuntimeConfig(input: unknown, environment: RuntimeEnvironment): AppRuntimeConfig {
  return assertStartableRuntimeConfig(evaluateRuntimeConfig(input, environment))
}

export function readDatabaseUrl(environment: RuntimeEnvironment = process.env): string {
  const databaseUrl = environment.NUXT_DATABASE_URL ?? ''
  const issues: RuntimeConfigIssue[] = []
  validateDatabaseUrl(databaseUrl, environment.NODE_ENV, issues)
  if (issues.length) throw new RuntimeConfigValidationError(issues)
  return databaseUrl
}

export function formatRuntimeConfigIssues(issues: readonly RuntimeConfigIssue[]): string {
  return `Invalid runtime configuration:\n${issues.map((issue) => `- ${issue.key}: ${issue.message}`).join('\n')}`
}

function validateEnvironmentKeys(environment: RuntimeEnvironment, issues: RuntimeConfigIssue[]) {
  for (const key of Object.keys(environment)) {
    if (environment[key] === undefined) continue
    if (/^(?:NUXT|NITRO)_SECURITY(?:_|$)/.test(key)) {
      issues.push(configIssue('invalid', key, 'must not override the reviewed application security policy'))
    } else if (forbiddenNuxtObjectKeys.has(key)) {
      issues.push(configIssue('invalid', key, 'must not set an object node; use the documented NUXT_ leaf variables'))
    } else if (forbiddenNitroKeys.has(key)) {
      issues.push(configIssue('invalid', key, 'is an unsupported NITRO_ alias; use the documented NUXT_ leaf variable'))
    } else if (key === 'NITRO_ENV_EXPANSION') {
      issues.push(configIssue('invalid', key, 'must not alter the pinned runtime configuration resolution behavior'))
    }
  }
}

function validateDatabaseUrl(value: string, nodeEnvironment: string | undefined, issues: RuntimeConfigIssue[]) {
  const key = 'NUXT_DATABASE_URL'
  if (!value) {
    issues.push(configIssue('missing', key, 'is required'))
  } else if (!value.startsWith('file:') || value !== value.trim()) {
    issues.push(configIssue('invalid', key, 'must be an already trimmed file: URL'))
  } else if (!value.slice(5)) {
    issues.push(configIssue('invalid', key, 'must include a SQLite path'))
  } else if (nodeEnvironment === 'production' && !isAbsolute(value.slice(5))) {
    issues.push(configIssue('invalid', key, 'must use an absolute path in production'))
  }
}

function validateAppOrigin(value: string, nodeEnvironment: string | undefined, issues: RuntimeConfigIssue[]) {
  const key = 'NUXT_PUBLIC_APP_URL'
  if (!value) {
    issues.push(configIssue('missing', key, 'is required'))
    return
  }
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) {
      throw new Error('invalid origin')
    }
    if (nodeEnvironment === 'production' && url.protocol !== 'https:' && !isLoopbackHostname(url.hostname)) {
      issues.push(configIssue('invalid', key, 'must use HTTPS in production except on loopback'))
    }
  } catch {
    issues.push(
      configIssue('invalid', key, 'must be an exact HTTP(S) origin without credentials, path, query, or fragment')
    )
  }
}

function validateSentry(config: ParsedRuntimeConfig, environment: RuntimeEnvironment, issues: RuntimeConfigIssue[]) {
  const enabled = Boolean(config.sentryDsn || config.public.sentryDsn)
  for (const [prefix, sentry] of [
    ['NUXT', config],
    ['NUXT_PUBLIC', config.public]
  ] as const) {
    const key = `${prefix}_SENTRY_DSN`
    requireMatch(sentry.sentryDsn, environment[key], key, issues)
    if (enabled) {
      if (!sentry.sentryDsn) {
        issues.push(configIssue('missing', key, 'is required when Sentry is configured'))
      } else {
        try {
          const url = new URL(sentry.sentryDsn)
          if (!['http:', 'https:'].includes(url.protocol) || sentry.sentryDsn !== sentry.sentryDsn.trim()) {
            throw new Error('invalid DSN')
          }
        } catch {
          issues.push(configIssue('invalid', key, 'must be an already trimmed absolute HTTP(S) URL'))
        }
      }
    }
    for (const [suffix, value] of [
      ['ENVIRONMENT', sentry.sentryEnvironment],
      ['RELEASE', sentry.sentryRelease]
    ] as const) {
      requireMatch(value, environment[`${prefix}_SENTRY_${suffix}`], `${prefix}_SENTRY_${suffix}`, issues)
    }
    const rateKey = `${prefix}_SENTRY_TRACES_SAMPLE_RATE`
    const rawRate = environment[rateKey]
    if (rawRate !== undefined) requireMatch(sentry.sentryTracesSampleRate, String(destr(rawRate)), rateKey, issues)
    const number = Number(sentry.sentryTracesSampleRate)
    if (!sentry.sentryTracesSampleRate.trim() || !Number.isFinite(number) || number < 0 || number > 1) {
      issues.push(configIssue('invalid', rateKey, 'must be a finite number between 0 and 1'))
    }
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '::1') return true
  return isIP(normalized) === 4 && normalized.split('.')[0] === '127'
}

function requireMatch(value: string, runtimeValue: string | undefined, key: string, issues: RuntimeConfigIssue[]) {
  if (runtimeValue !== undefined && value !== runtimeValue) {
    issues.push(configIssue('mismatch', key, 'did not resolve from the runtime environment'))
  }
}

function environmentKeyForPath(path: PropertyKey[]): string {
  return `NUXT_${path
    .map((part) =>
      String(part)
        .replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toUpperCase()
    )
    .join('_')}`
}

function configIssue(code: RuntimeConfigIssue['code'], key: string, message: string): RuntimeConfigIssue {
  return { code, key, message }
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value)) deepFreeze(nested)
  }
  return value as DeepReadonly<T>
}
