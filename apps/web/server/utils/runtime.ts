import { isIP } from 'node:net'
import { isAbsolute } from 'node:path'
import { domainToASCII } from 'node:url'
import {
  moduleManifest,
  runtimeModuleIds,
  type ModuleRequirement,
  type ModuleState,
  type RuntimeModuleId
} from '../../shared/modules'
import { socialProviderIds, socialProviderManifest, type SocialProviderId } from '../../shared/auth-providers'
import destr from 'destr'
import { z } from 'zod'

export { runtimeModuleIds, type RuntimeModuleId } from '../../shared/modules'
export { socialProviderIds, type SocialProviderId } from '../../shared/auth-providers'

export const forbiddenBetterAuthRuntimeEnvironmentKeys = [
  'BETTER_AUTH_SECRETS',
  'BETTER_AUTH_TRUSTED_ORIGINS',
  'BETTER_AUTH_TELEMETRY',
  'BETTER_AUTH_TELEMETRY_ENDPOINT',
  'BETTER_AUTH_TELEMETRY_DEBUG',
  'BETTER_AUTH_TELEMETRY_ID',
  'TEST'
] as const

export const forbiddenBetterAuthBuildEnvironmentKeys = ['NEXT_PUBLIC_AUTH_URL', 'NEXTAUTH_URL', 'VERCEL_URL'] as const

const unsafeProductionAuthSecrets = new Set([
  'better-auth-secret-12345678901234567890',
  'development-only-change-before-production',
  'local-development-secret-change-me-32-chars'
])

const unsafeProductionReadinessTokens = new Set(['local-readiness-token-change-me-32-chars'])

const officialTurnstileTestSiteKeys = new Set([
  '1x00000000000000000000AA',
  '2x00000000000000000000AB',
  '1x00000000000000000000BB',
  '2x00000000000000000000BB',
  '3x00000000000000000000FF'
])

const officialTurnstileTestSecretKeys = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA'
])

/**
 * App-owned policy for a token carried in an Authorization header. Requiring a
 * leading ASCII letter avoids Nitro/destr scalar coercion; the remaining
 * alphabet is a conservative Bearer-token subset. Token bytes are not trimmed.
 */
export const readinessTokenPattern = /^[A-Za-z][A-Za-z0-9._~+/-]{31,}$/

/**
 * Every documented app-owned runtime-config path, including object nodes that
 * must never be supplied as environment values. Nitro's primary NITRO_ prefix
 * can address the same paths as Nuxt's NUXT_ prefix, so this single inventory
 * also generates the complete set of forbidden NITRO_ aliases.
 */
export const canonicalAppRuntimePaths = [
  ['BETTER_AUTH', 'object'],
  ['SOCIAL_PROVIDERS', 'object'],
  ['SOCIAL_PROVIDERS_GOOGLE', 'object'],
  ['EMAIL', 'object'],
  ['EMAIL_SMTP', 'object'],
  ['MODULES', 'object'],
  ['MODULES_BILLING', 'object'],
  ['MODULES_FILES', 'object'],
  ['MODULES_AI', 'object'],
  ['MODULES_TURNSTILE', 'object'],
  ['MODULES_OBSERVABILITY', 'object'],
  ['MODULES_JOBS', 'object'],
  ['STRIPE', 'object'],
  ['FILES', 'object'],
  ['OPENAI', 'object'],
  ['OPENAI_FILE_SEARCH', 'object'],
  ['OPENAI_WEB_SEARCH', 'object'],
  ['OBSERVABILITY', 'object'],
  ['CLOUDFLARE', 'object'],
  ['CLOUDFLARE_R2', 'object'],
  ['CLOUDFLARE_TURNSTILE', 'object'],
  ['PUBLIC', 'object'],
  ['PUBLIC_MODULE_STATES', 'object'],
  ['DATABASE_URL', 'leaf'],
  ['READINESS_TOKEN', 'leaf'],
  ['BETTER_AUTH_SECRET', 'leaf'],
  ['BETTER_AUTH_URL', 'leaf'],
  ['SOCIAL_PROVIDERS_GOOGLE_ENABLED', 'leaf'],
  ['SOCIAL_PROVIDERS_GOOGLE_CLIENT_ID', 'leaf'],
  ['SOCIAL_PROVIDERS_GOOGLE_CLIENT_SECRET', 'leaf'],
  ['EMAIL_TRANSPORT', 'leaf'],
  ['EMAIL_FROM', 'leaf'],
  ['EMAIL_CAPTURE_DIRECTORY', 'leaf'],
  ['EMAIL_SMTP_HOST', 'leaf'],
  ['EMAIL_SMTP_PORT', 'leaf'],
  ['EMAIL_SMTP_SECURITY', 'leaf'],
  ['EMAIL_SMTP_USERNAME', 'leaf'],
  ['EMAIL_SMTP_PASSWORD', 'leaf'],
  ['MODULES_BILLING_ENABLED', 'leaf'],
  ['MODULES_FILES_ENABLED', 'leaf'],
  ['MODULES_AI_ENABLED', 'leaf'],
  ['MODULES_TURNSTILE_ENABLED', 'leaf'],
  ['MODULES_OBSERVABILITY_ENABLED', 'leaf'],
  ['MODULES_JOBS_ENABLED', 'leaf'],
  ['STRIPE_SECRET_KEY', 'leaf'],
  ['STRIPE_WEBHOOK_SECRET', 'leaf'],
  ['STRIPE_PORTAL_CONFIGURATION_ID', 'leaf'],
  ['STRIPE_PERSONAL_WEEKLY_PRICE_ID', 'leaf'],
  ['STRIPE_PERSONAL_MONTHLY_PRICE_ID', 'leaf'],
  ['STRIPE_PERSONAL_ANNUAL_PRICE_ID', 'leaf'],
  ['STRIPE_FAMILY_MONTHLY_PRICE_ID', 'leaf'],
  ['STRIPE_FAMILY_ANNUAL_PRICE_ID', 'leaf'],
  ['FILES_DRIVER', 'leaf'],
  ['OPENAI_API_KEY', 'leaf'],
  ['OPENAI_PROJECT_ID', 'leaf'],
  ['OPENAI_MODEL', 'leaf'],
  ['OPENAI_FILE_SEARCH_ENABLED', 'leaf'],
  ['OPENAI_FILE_SEARCH_VECTOR_STORE_ID', 'leaf'],
  ['OPENAI_WEB_SEARCH_ENABLED', 'leaf'],
  ['OPENAI_WEB_SEARCH_ALLOWED_DOMAINS', 'leaf'],
  ['SENTRY_DSN', 'leaf'],
  ['SENTRY_ENVIRONMENT', 'leaf'],
  ['SENTRY_RELEASE', 'leaf'],
  ['SENTRY_TRACES_SAMPLE_RATE', 'leaf'],
  ['OBSERVABILITY_TEST_TOKEN', 'leaf'],
  ['CLOUDFLARE_ACCOUNT_ID', 'leaf'],
  ['CLOUDFLARE_R2_BUCKET', 'leaf'],
  ['CLOUDFLARE_R2_ENDPOINT', 'leaf'],
  ['CLOUDFLARE_R2_ACCESS_KEY_ID', 'leaf'],
  ['CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'leaf'],
  ['CLOUDFLARE_TURNSTILE_SECRET_KEY', 'leaf'],
  ['PUBLIC_APP_NAME', 'leaf'],
  ['PUBLIC_APP_URL', 'leaf'],
  ['PUBLIC_SENTRY_DSN', 'leaf'],
  ['PUBLIC_SENTRY_ENVIRONMENT', 'leaf'],
  ['PUBLIC_SENTRY_RELEASE', 'leaf'],
  ['PUBLIC_SENTRY_TRACES_SAMPLE_RATE', 'leaf'],
  ['PUBLIC_TURNSTILE_SITE_KEY', 'leaf'],
  ['PUBLIC_MODULE_STATES_BILLING', 'leaf'],
  ['PUBLIC_MODULE_STATES_FILES', 'leaf'],
  ['PUBLIC_MODULE_STATES_AI', 'leaf'],
  ['PUBLIC_MODULE_STATES_TURNSTILE', 'leaf'],
  ['PUBLIC_MODULE_STATES_OBSERVABILITY', 'leaf'],
  ['PUBLIC_MODULE_STATES_JOBS', 'leaf']
] as const

const forbiddenNuxtObjectEnvironmentKeys = new Set(
  canonicalAppRuntimePaths.filter(([, kind]) => kind === 'object').map(([path]) => `NUXT_${path}`)
)

const forbiddenNuxtPublicModuleStateEnvironmentKeys = new Set(
  canonicalAppRuntimePaths
    .filter(([path]) => path === 'PUBLIC_MODULE_STATES' || path.startsWith('PUBLIC_MODULE_STATES_'))
    .map(([path]) => `NUXT_${path}`)
)

const forbiddenNitroRuntimeConfigEnvironmentKeys = new Set(canonicalAppRuntimePaths.map(([path]) => `NITRO_${path}`))

type RuntimeEnvironment = Record<string, string | undefined>

export type RuntimeConfigIssue = Readonly<{
  code: 'invalid' | 'mismatch' | 'missing' | 'shape'
  key: string
  message: string
}>

const runtimeConfigSchema = z.object({
  databaseUrl: z.string(),
  readinessToken: z.string(),
  betterAuth: z.object({
    secret: z.string(),
    url: z.string()
  }),
  socialProviders: z.object(
    Object.fromEntries(
      socialProviderIds.map((id) => [
        id,
        z.object({
          enabled: z.unknown(),
          clientId: z.unknown(),
          clientSecret: z.unknown()
        })
      ])
    ) as Record<
      SocialProviderId,
      z.ZodObject<{ enabled: z.ZodUnknown; clientId: z.ZodUnknown; clientSecret: z.ZodUnknown }>
    >
  ),
  email: z.object({
    transport: z.unknown(),
    from: z.unknown(),
    captureDirectory: z.unknown(),
    smtp: z.object({
      host: z.unknown(),
      port: z.unknown(),
      security: z.unknown(),
      username: z.unknown(),
      password: z.unknown()
    })
  }),
  modules: z.object(
    Object.fromEntries(runtimeModuleIds.map((id) => [id, z.object({ enabled: z.unknown() })])) as Record<
      RuntimeModuleId,
      z.ZodObject<{ enabled: z.ZodUnknown }>
    >
  ),
  stripe: z.unknown(),
  files: z.unknown(),
  openai: z.unknown(),
  sentryDsn: z.unknown(),
  sentryEnvironment: z.unknown(),
  sentryRelease: z.unknown(),
  sentryTracesSampleRate: z.unknown(),
  observability: z.unknown(),
  cloudflare: z.unknown(),
  public: z.object({
    appName: z.string(),
    appUrl: z.string(),
    sentryDsn: z.unknown(),
    sentryEnvironment: z.unknown(),
    sentryRelease: z.unknown(),
    sentryTracesSampleRate: z.unknown(),
    turnstileSiteKey: z.unknown()
  })
})

type ParsedRuntimeConfig = z.infer<typeof runtimeConfigSchema>

type NormalizedRuntimeConfig = {
  databaseUrl: string
  readinessToken: string
  betterAuth: {
    secret: string
    url: string
  }
  socialProviders: Record<
    SocialProviderId,
    {
      enabled: boolean
      clientId: string
      clientSecret: string
    }
  >
  email: {
    transport: '' | 'capture' | 'smtp'
    from: string
    captureDirectory: string
    smtp: {
      host: string
      port: string
      security: '' | 'tls' | 'starttls'
      username: string
      password: string
    }
  }
  files: {
    driver: '' | 'local' | 'r2'
  }
  openai: {
    apiKey: string
    projectId: string
    model: 'gpt-5.6-luna' | ''
    fileSearch: {
      enabled: boolean
      vectorStoreId: string
    }
    webSearch: {
      enabled: boolean
      allowedDomains: string[]
    }
  }
  modules: Record<RuntimeModuleId, { enabled: boolean }>
  stripe: {
    secretKey: string
    webhookSecret: string
    portalConfigurationId: string
    personalWeeklyPriceId: string
    personalMonthlyPriceId: string
    personalAnnualPriceId: string
    familyMonthlyPriceId: string
    familyAnnualPriceId: string
  }
  sentryDsn: string
  sentryEnvironment: string
  sentryRelease: string
  sentryTracesSampleRate: string
  observability: {
    testToken: string
  }
  cloudflare: {
    accountId: string
    r2: {
      bucket: string
      endpoint: string
      accessKeyId: string
      secretAccessKey: string
    }
    turnstile: {
      secretKey: string
    }
  }
  public: {
    appName: string
    appUrl: string
    sentryDsn: string
    sentryEnvironment: string
    sentryRelease: string
    sentryTracesSampleRate: string
    turnstileSiteKey: string
  }
}

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T

export type AppRuntimeConfig = DeepReadonly<NormalizedRuntimeConfig>

export type RuntimeConfigEvaluation = DeepReadonly<{
  config?: AppRuntimeConfig
  coreIssues: RuntimeConfigIssue[]
  moduleIssues: Record<RuntimeModuleId, RuntimeConfigIssue[]>
}>

let cachedAppRuntimeConfig: AppRuntimeConfig | undefined

export class RuntimeConfigValidationError extends Error {
  readonly issues: readonly RuntimeConfigIssue[]

  constructor(issues: readonly RuntimeConfigIssue[]) {
    const sortedIssues = issues.toSorted((left, right) =>
      `${left.key}\0${left.code}`.localeCompare(`${right.key}\0${right.code}`)
    )
    super(formatRuntimeConfigIssues(sortedIssues))
    this.name = 'RuntimeConfigValidationError'
    this.issues = deepFreeze(sortedIssues)
  }
}

export function getAppRuntimeConfig(): AppRuntimeConfig {
  cachedAppRuntimeConfig ??=
    typeof useRuntimeConfig === 'undefined'
      ? assertStartableRuntimeConfig(evaluateRuntimeEnvironment(process.env))
      : validateRuntimeConfig(useRuntimeConfig(), process.env)
  return cachedAppRuntimeConfig
}

export function evaluateRuntimeConfig(input: unknown, environment: RuntimeEnvironment): RuntimeConfigEvaluation {
  const coreIssues: RuntimeConfigIssue[] = []
  const moduleIssues = emptyModuleIssues()
  validateRuntimeEnvironmentKeyContract(environment, coreIssues)
  validateModuleFlagEnvironment(environment, moduleIssues)
  const parsed = runtimeConfigSchema.safeParse(input)

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const runtimeIssue = configIssue(
        'shape',
        environmentKeyForPath(issue.path),
        'must use the documented runtime configuration shape'
      )
      const moduleIds = moduleIdsForConfigPath(issue.path)
      if (moduleIds.length) {
        for (const moduleId of moduleIds) moduleIssues[moduleId].push(runtimeIssue)
      } else {
        coreIssues.push(runtimeIssue)
      }
    }
    return freezeEvaluation(undefined, coreIssues, moduleIssues)
  }

  const config = normalizeRuntimeConfig(parsed.data)
  validateResolvedModuleFlags(config, environment, moduleIssues)
  validateCore(config, environment, coreIssues)
  validateEnabledModules(config, environment, moduleIssues)
  validateModuleDependencies(config, environment, moduleIssues)
  validateR2Endpoint(config, moduleIssues.files)

  return freezeEvaluation(config, coreIssues, moduleIssues)
}

function validateModuleDependencies(
  config: NormalizedRuntimeConfig,
  environment: RuntimeEnvironment,
  moduleIssues: Record<RuntimeModuleId, RuntimeConfigIssue[]>
) {
  if (config.modules.billing.enabled && !config.modules.jobs.enabled) {
    moduleIssues.billing.push(
      configIssue('invalid', 'NUXT_MODULES_JOBS_ENABLED', 'must be true when Billing is enabled')
    )
  }

  if (config.modules.files.enabled && !config.modules.jobs.enabled) {
    moduleIssues.files.push(configIssue('invalid', 'NUXT_MODULES_JOBS_ENABLED', 'must be true when Files is enabled'))
  }

  if (config.modules.ai.enabled) return

  for (const [key, enabled] of [
    ['NUXT_OPENAI_FILE_SEARCH_ENABLED', config.openai.fileSearch.enabled],
    ['NUXT_OPENAI_WEB_SEARCH_ENABLED', config.openai.webSearch.enabled]
  ] as const) {
    const rawValue = environment[key]
    if (rawValue !== 'true' && rawValue !== 'false') {
      moduleIssues.ai.push(configIssue('invalid', key, 'is required and must be exactly true or false'))
      continue
    }

    requireMatch(String(enabled), rawValue, key, moduleIssues.ai)
    if (rawValue === 'true') {
      moduleIssues.ai.push(configIssue('invalid', key, 'must be false when the AI module is disabled'))
    }
  }
}

function validateR2Endpoint(config: NormalizedRuntimeConfig, issues: RuntimeConfigIssue[]) {
  if (!config.modules.files.enabled || config.files.driver !== 'r2') return
  const accountId = config.cloudflare.accountId
  const bucket = config.cloudflare.r2.bucket
  const endpoint = config.cloudflare.r2.endpoint
  for (const [key, value] of [
    ['NUXT_CLOUDFLARE_R2_ACCESS_KEY_ID', config.cloudflare.r2.accessKeyId],
    ['NUXT_CLOUDFLARE_R2_SECRET_ACCESS_KEY', config.cloudflare.r2.secretAccessKey]
  ] as const) {
    if (value && value !== value.trim()) {
      issues.push(configIssue('invalid', key, 'must not contain leading or trailing whitespace'))
    }
  }
  if (!accountId || !endpoint) return
  if (!/^[0-9a-f]{32}$/.test(accountId)) {
    issues.push(
      configIssue(
        'invalid',
        'NUXT_CLOUDFLARE_ACCOUNT_ID',
        'must be the 32-character lowercase hexadecimal Cloudflare account ID when Files uses R2'
      )
    )
    return
  }
  if (bucket && !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(bucket)) {
    issues.push(
      configIssue(
        'invalid',
        'NUXT_CLOUDFLARE_R2_BUCKET',
        'must use the 3-63 character lowercase alphanumeric and hyphen R2 bucket name'
      )
    )
  }

  try {
    const url = new URL(endpoint)
    const allowedHosts = new Set([
      `${accountId}.r2.cloudflarestorage.com`,
      `${accountId}.eu.r2.cloudflarestorage.com`,
      `${accountId}.fedramp.r2.cloudflarestorage.com`
    ])
    if (
      url.protocol !== 'https:' ||
      !allowedHosts.has(url.hostname) ||
      url.port ||
      url.username ||
      url.password ||
      (url.pathname !== '' && url.pathname !== '/') ||
      url.search ||
      url.hash
    ) {
      throw new Error('invalid R2 endpoint')
    }
  } catch {
    issues.push(
      configIssue(
        'invalid',
        'NUXT_CLOUDFLARE_R2_ENDPOINT',
        'must be the HTTPS Cloudflare R2 S3 endpoint for the configured account and contain no path or query'
      )
    )
  }
}

export function assertSafeBetterAuthBuildEnvironment(environment: RuntimeEnvironment): void {
  const issues = forbiddenBetterAuthBuildEnvironmentKeys.flatMap((key) =>
    environment[key] === undefined
      ? []
      : [configIssue('invalid', key, 'must not be present while building the Better Auth client')]
  )
  if (issues.length) throw new RuntimeConfigValidationError(issues)
}

export function evaluateRuntimeEnvironment(environment: RuntimeEnvironment): RuntimeConfigEvaluation {
  return evaluateRuntimeConfig(runtimeConfigFromEnvironment(environment), environment)
}

export function evaluateModuleStates(
  evaluation: RuntimeConfigEvaluation
): Readonly<Record<RuntimeModuleId, ModuleState>> {
  return deepFreeze(
    Object.fromEntries(
      runtimeModuleIds.map((moduleId) => {
        const enabled = evaluation.config?.modules[moduleId].enabled
        const state: ModuleState =
          evaluation.moduleIssues[moduleId].length || enabled === undefined
            ? 'incomplete'
            : enabled === false
              ? 'disabled'
              : evaluation.coreIssues.length
                ? 'incomplete'
                : 'ready'
        return [moduleId, state]
      })
    ) as Record<RuntimeModuleId, ModuleState>
  )
}

export function runtimeConfigFromEnvironment(environment: RuntimeEnvironment): unknown {
  return {
    // Nitro 2.13.4 applies destr@2.0.5 to every NUXT_* runtime-config leaf.
    // Pinned Nitro 2.13.4 publication source: nitrojs/nitro@039b8416 src/runtime/internal/utils.env.ts.
    // Mirror that pinned behavior so readiness and the built server accept and reject the same input.
    databaseUrl: nitroEnvironmentValue(environment, 'NUXT_DATABASE_URL'),
    readinessToken: nitroEnvironmentValue(environment, 'NUXT_READINESS_TOKEN'),
    betterAuth: {
      secret: nitroEnvironmentValue(environment, 'NUXT_BETTER_AUTH_SECRET'),
      url: nitroEnvironmentValue(environment, 'NUXT_BETTER_AUTH_URL')
    },
    socialProviders: Object.fromEntries(
      socialProviderIds.map((id) => {
        const manifest = socialProviderManifest[id]
        return [
          id,
          {
            enabled: nitroEnvironmentValue(environment, manifest.enabledEnvironmentKey),
            clientId: nitroEnvironmentValue(environment, manifest.clientIdEnvironmentKey),
            clientSecret: nitroEnvironmentValue(environment, manifest.clientSecretEnvironmentKey)
          }
        ]
      })
    ),
    email: {
      transport: nitroEnvironmentValue(environment, 'NUXT_EMAIL_TRANSPORT'),
      from: nitroEnvironmentValue(environment, 'NUXT_EMAIL_FROM'),
      captureDirectory: nitroEnvironmentValue(environment, 'NUXT_EMAIL_CAPTURE_DIRECTORY'),
      smtp: {
        host: nitroEnvironmentValue(environment, 'NUXT_EMAIL_SMTP_HOST'),
        port: nitroEnvironmentValue(environment, 'NUXT_EMAIL_SMTP_PORT'),
        security: nitroEnvironmentValue(environment, 'NUXT_EMAIL_SMTP_SECURITY'),
        username: nitroEnvironmentValue(environment, 'NUXT_EMAIL_SMTP_USERNAME'),
        password: nitroEnvironmentValue(environment, 'NUXT_EMAIL_SMTP_PASSWORD')
      }
    },
    modules: Object.fromEntries(
      runtimeModuleIds.map((id) => [
        id,
        { enabled: nitroEnvironmentValue(environment, moduleManifest[id].flagEnvironmentKey) }
      ])
    ),
    stripe: {
      secretKey: nitroEnvironmentValue(environment, 'NUXT_STRIPE_SECRET_KEY'),
      webhookSecret: nitroEnvironmentValue(environment, 'NUXT_STRIPE_WEBHOOK_SECRET'),
      portalConfigurationId: nitroEnvironmentValue(environment, 'NUXT_STRIPE_PORTAL_CONFIGURATION_ID'),
      personalWeeklyPriceId: nitroEnvironmentValue(environment, 'NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID'),
      personalMonthlyPriceId: nitroEnvironmentValue(environment, 'NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID'),
      personalAnnualPriceId: nitroEnvironmentValue(environment, 'NUXT_STRIPE_PERSONAL_ANNUAL_PRICE_ID'),
      familyMonthlyPriceId: nitroEnvironmentValue(environment, 'NUXT_STRIPE_FAMILY_MONTHLY_PRICE_ID'),
      familyAnnualPriceId: nitroEnvironmentValue(environment, 'NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID')
    },
    files: {
      driver: nitroEnvironmentValue(environment, 'NUXT_FILES_DRIVER')
    },
    openai: {
      apiKey: nitroEnvironmentValue(environment, 'NUXT_OPENAI_API_KEY'),
      projectId: nitroEnvironmentValue(environment, 'NUXT_OPENAI_PROJECT_ID'),
      model: nitroEnvironmentValue(environment, 'NUXT_OPENAI_MODEL'),
      fileSearch: {
        enabled: nitroEnvironmentValue(environment, 'NUXT_OPENAI_FILE_SEARCH_ENABLED'),
        vectorStoreId: nitroEnvironmentValue(environment, 'NUXT_OPENAI_FILE_SEARCH_VECTOR_STORE_ID')
      },
      webSearch: {
        enabled: nitroEnvironmentValue(environment, 'NUXT_OPENAI_WEB_SEARCH_ENABLED'),
        allowedDomains: nitroEnvironmentValue(environment, 'NUXT_OPENAI_WEB_SEARCH_ALLOWED_DOMAINS')
      }
    },
    sentryDsn: nitroEnvironmentValue(environment, 'NUXT_SENTRY_DSN'),
    sentryEnvironment: nitroEnvironmentValue(environment, 'NUXT_SENTRY_ENVIRONMENT'),
    sentryRelease: nitroEnvironmentValue(environment, 'NUXT_SENTRY_RELEASE'),
    sentryTracesSampleRate: nitroEnvironmentValue(environment, 'NUXT_SENTRY_TRACES_SAMPLE_RATE', '0.05'),
    observability: {
      testToken: nitroEnvironmentValue(environment, 'NUXT_OBSERVABILITY_TEST_TOKEN')
    },
    cloudflare: {
      accountId: nitroEnvironmentValue(environment, 'NUXT_CLOUDFLARE_ACCOUNT_ID'),
      r2: {
        bucket: nitroEnvironmentValue(environment, 'NUXT_CLOUDFLARE_R2_BUCKET'),
        endpoint: nitroEnvironmentValue(environment, 'NUXT_CLOUDFLARE_R2_ENDPOINT'),
        accessKeyId: nitroEnvironmentValue(environment, 'NUXT_CLOUDFLARE_R2_ACCESS_KEY_ID'),
        secretAccessKey: nitroEnvironmentValue(environment, 'NUXT_CLOUDFLARE_R2_SECRET_ACCESS_KEY')
      },
      turnstile: {
        secretKey: nitroEnvironmentValue(environment, 'NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY')
      }
    },
    public: {
      appName: nitroEnvironmentValue(environment, 'NUXT_PUBLIC_APP_NAME', 'SmallWiseLabs Base App'),
      appUrl: nitroEnvironmentValue(environment, 'NUXT_PUBLIC_APP_URL'),
      sentryDsn: nitroEnvironmentValue(environment, 'NUXT_PUBLIC_SENTRY_DSN'),
      sentryEnvironment: nitroEnvironmentValue(environment, 'NUXT_PUBLIC_SENTRY_ENVIRONMENT'),
      sentryRelease: nitroEnvironmentValue(environment, 'NUXT_PUBLIC_SENTRY_RELEASE'),
      sentryTracesSampleRate: nitroEnvironmentValue(environment, 'NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE', '0.05'),
      turnstileSiteKey: nitroEnvironmentValue(environment, 'NUXT_PUBLIC_TURNSTILE_SITE_KEY')
    }
  }
}

function nitroEnvironmentValue(environment: RuntimeEnvironment, key: string, fallback = ''): unknown {
  const value = environment[key]
  return value === undefined ? fallback : (destr(value) ?? fallback)
}

export function assertStartableRuntimeConfig(evaluation: RuntimeConfigEvaluation): AppRuntimeConfig {
  const issues = [
    ...evaluation.coreIssues,
    ...runtimeModuleIds.flatMap((moduleId) => evaluation.moduleIssues[moduleId])
  ]
  if (issues.length || !evaluation.config) {
    throw new RuntimeConfigValidationError(
      issues.length ? issues : [configIssue('shape', 'NUXT_RUNTIME_CONFIG', 'could not be normalized')]
    )
  }
  return evaluation.config
}

export function validateRuntimeConfig(input: unknown, environment: RuntimeEnvironment): AppRuntimeConfig {
  return assertStartableRuntimeConfig(evaluateRuntimeConfig(input, environment))
}

export function readDatabaseUrl(environment: RuntimeEnvironment = process.env): string {
  const databaseUrl = environment.NUXT_DATABASE_URL?.trim() ?? ''
  const issues: RuntimeConfigIssue[] = []
  validateDatabaseUrl(databaseUrl, environment.NODE_ENV, issues)
  if (issues.length) throw new RuntimeConfigValidationError(issues)
  return databaseUrl
}

export function formatRuntimeConfigIssues(issues: readonly RuntimeConfigIssue[]): string {
  return `Invalid runtime configuration:\n${issues.map((issue) => `- ${issue.key}: ${issue.message}`).join('\n')}`
}

function normalizeRuntimeConfig(config: ParsedRuntimeConfig): NormalizedRuntimeConfig {
  const email = recordValue(config.email)
  const emailSmtp = recordValue(email.smtp)
  const stripe = recordValue(config.stripe)
  const files = recordValue(config.files)
  const openai = recordValue(config.openai)
  const openaiFileSearch = recordValue(openai.fileSearch)
  const openaiFileSearchEnabled = openaiFileSearch.enabled === true
  const openaiWebSearch = recordValue(openai.webSearch)
  const openaiWebSearchEnabled = openaiWebSearch.enabled === true
  const observability = recordValue(config.observability)
  const cloudflare = recordValue(config.cloudflare)
  const r2 = recordValue(cloudflare.r2)
  const turnstile = recordValue(cloudflare.turnstile)

  return {
    databaseUrl: config.databaseUrl.trim(),
    readinessToken: config.readinessToken,
    betterAuth: {
      secret: config.betterAuth.secret,
      url: config.betterAuth.url.trim()
    },
    socialProviders: Object.fromEntries(
      socialProviderIds.map((id) => [
        id,
        {
          enabled: config.socialProviders[id].enabled === true,
          clientId: trimmedStringValue(config.socialProviders[id].clientId),
          clientSecret: stringValue(config.socialProviders[id].clientSecret)
        }
      ])
    ) as NormalizedRuntimeConfig['socialProviders'],
    email: {
      transport: normalizeEmailTransport(email.transport),
      from: trimmedStringValue(email.from),
      captureDirectory: trimmedStringValue(email.captureDirectory),
      smtp: {
        host: trimmedStringValue(emailSmtp.host),
        port: scalarStringValue(emailSmtp.port),
        security: normalizeEmailSmtpSecurity(emailSmtp.security),
        username: stringValue(emailSmtp.username),
        password: stringValue(emailSmtp.password)
      }
    },
    modules: Object.fromEntries(
      runtimeModuleIds.map((id) => [id, { enabled: config.modules[id].enabled === true }])
    ) as Record<RuntimeModuleId, { enabled: boolean }>,
    stripe: {
      secretKey: stringValue(stripe.secretKey),
      webhookSecret: stringValue(stripe.webhookSecret),
      portalConfigurationId: trimmedStringValue(stripe.portalConfigurationId),
      personalWeeklyPriceId: trimmedStringValue(stripe.personalWeeklyPriceId),
      personalMonthlyPriceId: trimmedStringValue(stripe.personalMonthlyPriceId),
      personalAnnualPriceId: trimmedStringValue(stripe.personalAnnualPriceId),
      familyMonthlyPriceId: trimmedStringValue(stripe.familyMonthlyPriceId),
      familyAnnualPriceId: trimmedStringValue(stripe.familyAnnualPriceId)
    },
    files: {
      driver: normalizeFilesDriver(files.driver)
    },
    openai: {
      apiKey: stringValue(openai.apiKey),
      projectId: trimmedStringValue(openai.projectId),
      model: normalizeOpenAIModel(openai.model),
      fileSearch: {
        enabled: openaiFileSearchEnabled,
        vectorStoreId: openaiFileSearchEnabled ? trimmedStringValue(openaiFileSearch.vectorStoreId) : ''
      },
      webSearch: {
        enabled: openaiWebSearchEnabled,
        allowedDomains: openaiWebSearchEnabled ? parseWebSearchAllowedDomains(openaiWebSearch.allowedDomains) : []
      }
    },
    sentryDsn: trimmedStringValue(config.sentryDsn),
    sentryEnvironment: trimmedStringValue(config.sentryEnvironment),
    sentryRelease: trimmedStringValue(config.sentryRelease),
    sentryTracesSampleRate: scalarStringValue(config.sentryTracesSampleRate),
    observability: {
      testToken: stringValue(observability.testToken)
    },
    cloudflare: {
      accountId: trimmedStringValue(cloudflare.accountId),
      r2: {
        bucket: trimmedStringValue(r2.bucket),
        endpoint: trimmedStringValue(r2.endpoint),
        accessKeyId: stringValue(r2.accessKeyId),
        secretAccessKey: stringValue(r2.secretAccessKey)
      },
      turnstile: {
        secretKey: stringValue(turnstile.secretKey)
      }
    },
    public: {
      appName: config.public.appName.trim() || 'SmallWiseLabs Base App',
      appUrl: config.public.appUrl.trim(),
      sentryDsn: trimmedStringValue(config.public.sentryDsn),
      sentryEnvironment: trimmedStringValue(config.public.sentryEnvironment),
      sentryRelease: trimmedStringValue(config.public.sentryRelease),
      sentryTracesSampleRate: scalarStringValue(config.public.sentryTracesSampleRate),
      turnstileSiteKey: stringValue(config.public.turnstileSiteKey)
    }
  }
}

function validateModuleFlagEnvironment(
  environment: RuntimeEnvironment,
  moduleIssues: Record<RuntimeModuleId, RuntimeConfigIssue[]>
) {
  for (const id of runtimeModuleIds) {
    const key = moduleManifest[id].flagEnvironmentKey
    if (environment[key] !== 'true' && environment[key] !== 'false') {
      moduleIssues[id].push(configIssue('invalid', key, 'is required and must be exactly true or false'))
    }
  }
}

function validateRuntimeEnvironmentKeyContract(environment: RuntimeEnvironment, issues: RuntimeConfigIssue[]) {
  for (const key of Object.keys(environment)) {
    if (environment[key] === undefined) continue

    if (
      key === 'NUXT_SECURITY' ||
      key.startsWith('NUXT_SECURITY_') ||
      key === 'NITRO_SECURITY' ||
      key.startsWith('NITRO_SECURITY_')
    ) {
      issues.push(configIssue('invalid', key, 'must not override the reviewed application security policy'))
    } else if (forbiddenNuxtPublicModuleStateEnvironmentKeys.has(key)) {
      issues.push(configIssue('invalid', key, 'is server-derived and must not be supplied as public runtime input'))
    } else if (forbiddenNuxtObjectEnvironmentKeys.has(key)) {
      issues.push(configIssue('invalid', key, 'must not set an object node; use the documented NUXT_ leaf variables'))
    } else if (forbiddenNitroRuntimeConfigEnvironmentKeys.has(key)) {
      issues.push(configIssue('invalid', key, 'is an unsupported NITRO_ alias; use the documented NUXT_ leaf variable'))
    }
  }

  for (const key of forbiddenBetterAuthRuntimeEnvironmentKeys) {
    if (environment[key] !== undefined && (key !== 'TEST' || environment.NODE_ENV === 'production')) {
      issues.push(configIssue('invalid', key, 'is an unsupported Better Auth environment override'))
    }
  }

  for (const key of forbiddenBetterAuthBuildEnvironmentKeys) {
    if (environment[key] !== undefined) {
      issues.push(configIssue('invalid', key, 'is an unsupported Better Auth client URL override'))
    }
  }

  // Nuxt pins inline envExpansion false, and the app rejects the process key as
  // an unsupported input so a future build-config drift cannot silently change
  // resolution. Without the inline pin, Nitro treats any nonempty string
  // (including "false") as enabling expansion.
  if (environment.NITRO_ENV_EXPANSION !== undefined) {
    issues.push(
      configIssue(
        'invalid',
        'NITRO_ENV_EXPANSION',
        'must not alter the pinned runtime configuration resolution behavior'
      )
    )
  }

  // NITRO_ENV_PREFIX is intentionally allowed: the built server pins
  // inlineRuntimeConfig.nitro.envPrefix to NUXT_, which has precedence over it.
}

function validateResolvedModuleFlags(
  config: NormalizedRuntimeConfig,
  environment: RuntimeEnvironment,
  moduleIssues: Record<RuntimeModuleId, RuntimeConfigIssue[]>
) {
  for (const id of runtimeModuleIds) {
    const key = moduleManifest[id].flagEnvironmentKey
    if (
      (environment[key] === 'true' || environment[key] === 'false') &&
      config.modules[id].enabled !== (environment[key] === 'true')
    ) {
      moduleIssues[id].push(configIssue('mismatch', key, 'did not resolve to the configured boolean value'))
    }
  }
}

function validateCore(config: NormalizedRuntimeConfig, environment: RuntimeEnvironment, issues: RuntimeConfigIssue[]) {
  const databaseUrl = environment.NUXT_DATABASE_URL?.trim() ?? ''
  validateDatabaseUrl(databaseUrl, environment.NODE_ENV, issues)
  requireMatch(config.databaseUrl, databaseUrl, 'NUXT_DATABASE_URL', issues)

  const readinessToken = environment.NUXT_READINESS_TOKEN ?? ''
  requireValue(readinessToken, 'NUXT_READINESS_TOKEN', issues)
  requireMatch(config.readinessToken, readinessToken, 'NUXT_READINESS_TOKEN', issues)
  if (readinessToken && readinessToken !== readinessToken.trim()) {
    issues.push(configIssue('invalid', 'NUXT_READINESS_TOKEN', 'must be already trimmed'))
  } else if (readinessToken && !readinessTokenPattern.test(readinessToken)) {
    issues.push(
      configIssue(
        'invalid',
        'NUXT_READINESS_TOKEN',
        'must start with an ASCII letter and contain at least 32 characters drawn from ASCII letters, digits, dots, underscores, tildes, plus signs, slashes, or hyphens'
      )
    )
  }
  if (environment.NODE_ENV === 'production' && unsafeProductionReadinessTokens.has(readinessToken)) {
    issues.push(configIssue('invalid', 'NUXT_READINESS_TOKEN', 'must not use the committed local development value'))
  }

  const authSecret = environment.NUXT_BETTER_AUTH_SECRET ?? ''
  requireValue(authSecret, 'NUXT_BETTER_AUTH_SECRET', issues)
  requireMatch(config.betterAuth.secret, authSecret, 'NUXT_BETTER_AUTH_SECRET', issues)
  const authSecretLength = authSecret.trim().length
  if (authSecretLength > 0 && authSecretLength < 32) {
    issues.push(configIssue('invalid', 'NUXT_BETTER_AUTH_SECRET', 'must contain at least 32 characters'))
  }
  if (environment.NODE_ENV === 'production' && unsafeProductionAuthSecrets.has(authSecret.trim())) {
    issues.push(configIssue('invalid', 'NUXT_BETTER_AUTH_SECRET', 'must not use a known development/default value'))
  }

  const authUrl = environment.NUXT_BETTER_AUTH_URL?.trim() ?? ''
  requireHttpUrl(authUrl, 'NUXT_BETTER_AUTH_URL', issues)
  if (authUrl) {
    try {
      const parsedAuthUrl = new URL(authUrl)
      if (parsedAuthUrl.origin !== authUrl) {
        issues.push(configIssue('invalid', 'NUXT_BETTER_AUTH_URL', 'must be an HTTP(S) origin without a path'))
      }
      if (
        environment.NODE_ENV === 'production' &&
        parsedAuthUrl.protocol !== 'https:' &&
        !isLoopbackHostname(parsedAuthUrl.hostname)
      ) {
        issues.push(configIssue('invalid', 'NUXT_BETTER_AUTH_URL', 'must use HTTPS in production except on loopback'))
      }
    } catch {
      // requireHttpUrl already reports the keyed parse failure.
    }
  }
  requireMatch(config.betterAuth.url, authUrl, 'NUXT_BETTER_AUTH_URL', issues)

  const rawAppUrl = environment.NUXT_PUBLIC_APP_URL ?? ''
  const appUrl = rawAppUrl.trim()
  requireHttpUrl(appUrl, 'NUXT_PUBLIC_APP_URL', issues)
  requireMatch(config.public.appUrl, appUrl, 'NUXT_PUBLIC_APP_URL', issues)
  if (rawAppUrl !== appUrl) {
    issues.push(configIssue('invalid', 'NUXT_PUBLIC_APP_URL', 'must be already trimmed'))
  }
  if (authUrl && appUrl) {
    try {
      if (authUrl !== new URL(appUrl).origin) {
        issues.push(configIssue('invalid', 'NUXT_BETTER_AUTH_URL', 'must equal the canonical application origin'))
      }
    } catch {
      // The keyed URL validators already report either parse failure.
    }
  }

  const appName = environment.NUXT_PUBLIC_APP_NAME
  if (appName !== undefined) {
    if (!appName.trim() || appName !== appName.trim()) {
      issues.push(configIssue('invalid', 'NUXT_PUBLIC_APP_NAME', 'must be nonblank and already trimmed when set'))
    }
    requireMatch(config.public.appName, appName, 'NUXT_PUBLIC_APP_NAME', issues)
  }

  validateEmailConfig(config.email, environment, issues)
  validateSocialProviderConfig(config.socialProviders, environment, issues)
}

function validateSocialProviderConfig(
  config: NormalizedRuntimeConfig['socialProviders'],
  environment: RuntimeEnvironment,
  issues: RuntimeConfigIssue[]
) {
  for (const providerId of socialProviderIds) {
    const manifest = socialProviderManifest[providerId]
    const rawEnabled = environment[manifest.enabledEnvironmentKey]
    if (rawEnabled !== 'true' && rawEnabled !== 'false') {
      issues.push(
        configIssue('invalid', manifest.enabledEnvironmentKey, 'is required and must be exactly true or false')
      )
      continue
    }
    if (config[providerId].enabled !== (rawEnabled === 'true')) {
      issues.push(
        configIssue('mismatch', manifest.enabledEnvironmentKey, 'did not resolve to the configured boolean value')
      )
    }
    if (rawEnabled === 'false') continue

    const rawClientId = environment[manifest.clientIdEnvironmentKey] ?? ''
    const clientId = rawClientId.trim()
    requireValue(rawClientId, manifest.clientIdEnvironmentKey, issues)
    requireAlreadyTrimmed(rawClientId, manifest.clientIdEnvironmentKey, issues)
    requireMatch(config[providerId].clientId, clientId, manifest.clientIdEnvironmentKey, issues)

    const clientSecret = environment[manifest.clientSecretEnvironmentKey] ?? ''
    requireValue(clientSecret, manifest.clientSecretEnvironmentKey, issues)
    requireMatch(config[providerId].clientSecret, clientSecret, manifest.clientSecretEnvironmentKey, issues)
  }
}

function validateEmailConfig(
  config: NormalizedRuntimeConfig['email'],
  environment: RuntimeEnvironment,
  issues: RuntimeConfigIssue[]
) {
  const rawTransport = environment.NUXT_EMAIL_TRANSPORT ?? ''
  const transport = rawTransport.trim()
  requireValue(rawTransport, 'NUXT_EMAIL_TRANSPORT', issues)
  requireMatch(config.transport, transport, 'NUXT_EMAIL_TRANSPORT', issues)
  requireAlreadyTrimmed(rawTransport, 'NUXT_EMAIL_TRANSPORT', issues)
  if (transport !== 'capture' && transport !== 'smtp') {
    issues.push(configIssue('invalid', 'NUXT_EMAIL_TRANSPORT', 'must be exactly capture or smtp'))
  }

  const rawFrom = environment.NUXT_EMAIL_FROM ?? ''
  const from = rawFrom.trim()
  requireValue(rawFrom, 'NUXT_EMAIL_FROM', issues)
  requireMatch(config.from, from, 'NUXT_EMAIL_FROM', issues)
  requireAlreadyTrimmed(rawFrom, 'NUXT_EMAIL_FROM', issues)
  if (/[\r\n]/.test(rawFrom)) {
    issues.push(configIssue('invalid', 'NUXT_EMAIL_FROM', 'must not contain line breaks'))
  }

  if (transport === 'capture') {
    const rawCaptureDirectory = environment.NUXT_EMAIL_CAPTURE_DIRECTORY ?? ''
    const captureDirectory = rawCaptureDirectory.trim()
    requireValue(rawCaptureDirectory, 'NUXT_EMAIL_CAPTURE_DIRECTORY', issues)
    requireMatch(config.captureDirectory, captureDirectory, 'NUXT_EMAIL_CAPTURE_DIRECTORY', issues)
    requireAlreadyTrimmed(rawCaptureDirectory, 'NUXT_EMAIL_CAPTURE_DIRECTORY', issues)

    if (environment.NODE_ENV === 'production' && environment.CI !== 'true') {
      issues.push(
        configIssue(
          'invalid',
          'NUXT_EMAIL_TRANSPORT',
          'capture is test-only in production mode and requires the test process control CI=true'
        )
      )
    }
    return
  }

  if (transport !== 'smtp') return

  const rawHost = environment.NUXT_EMAIL_SMTP_HOST ?? ''
  const host = rawHost.trim()
  requireValue(rawHost, 'NUXT_EMAIL_SMTP_HOST', issues)
  requireMatch(config.smtp.host, host, 'NUXT_EMAIL_SMTP_HOST', issues)
  requireAlreadyTrimmed(rawHost, 'NUXT_EMAIL_SMTP_HOST', issues)
  if (/[\r\n]/.test(rawHost)) {
    issues.push(configIssue('invalid', 'NUXT_EMAIL_SMTP_HOST', 'must not contain line breaks'))
  }

  const rawPort = environment.NUXT_EMAIL_SMTP_PORT ?? ''
  const port = rawPort.trim()
  requireValue(rawPort, 'NUXT_EMAIL_SMTP_PORT', issues)
  requireMatch(config.smtp.port, port, 'NUXT_EMAIL_SMTP_PORT', issues)
  requireAlreadyTrimmed(rawPort, 'NUXT_EMAIL_SMTP_PORT', issues)
  if (port && (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65_535)) {
    issues.push(configIssue('invalid', 'NUXT_EMAIL_SMTP_PORT', 'must be an integer from 1 through 65535'))
  }

  const rawSecurity = environment.NUXT_EMAIL_SMTP_SECURITY ?? ''
  const security = rawSecurity.trim()
  requireValue(rawSecurity, 'NUXT_EMAIL_SMTP_SECURITY', issues)
  requireMatch(config.smtp.security, security, 'NUXT_EMAIL_SMTP_SECURITY', issues)
  requireAlreadyTrimmed(rawSecurity, 'NUXT_EMAIL_SMTP_SECURITY', issues)
  if (security !== 'tls' && security !== 'starttls') {
    issues.push(configIssue('invalid', 'NUXT_EMAIL_SMTP_SECURITY', 'must be exactly tls or starttls'))
  }

  requirePreservedRuntimeValue(environment, config.smtp.username, 'NUXT_EMAIL_SMTP_USERNAME', issues)
  requirePreservedRuntimeValue(environment, config.smtp.password, 'NUXT_EMAIL_SMTP_PASSWORD', issues)
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '::1') return true
  return isIP(normalized) === 4 && normalized.split('.')[0] === '127'
}

function validateDatabaseUrl(databaseUrl: string, nodeEnvironment: string | undefined, issues: RuntimeConfigIssue[]) {
  if (!databaseUrl) {
    issues.push(configIssue('missing', 'NUXT_DATABASE_URL', 'is required'))
    return
  }
  if (!databaseUrl.startsWith('file:')) {
    issues.push(configIssue('invalid', 'NUXT_DATABASE_URL', 'must be a file: URL'))
    return
  }

  const path = databaseUrl.slice('file:'.length)
  if (!path) {
    issues.push(configIssue('invalid', 'NUXT_DATABASE_URL', 'must include a SQLite path'))
  } else if (nodeEnvironment === 'production' && !isAbsolute(path)) {
    issues.push(configIssue('invalid', 'NUXT_DATABASE_URL', 'must use an absolute path in production'))
  }
}

function validateEnabledModules(
  config: NormalizedRuntimeConfig,
  environment: RuntimeEnvironment,
  moduleIssues: Record<RuntimeModuleId, RuntimeConfigIssue[]>
) {
  for (const moduleId of runtimeModuleIds) {
    if (!config.modules[moduleId].enabled) continue

    for (const requirement of moduleManifest[moduleId].requiredConfig) {
      if (!requirementApplies(config, requirement)) continue
      validateModuleRequirement(config, environment, requirement, moduleIssues[moduleId])
    }

    if (moduleId === 'turnstile') {
      validateTurnstileTestKeyContainment(config, environment, moduleIssues.turnstile)
    } else if (moduleId === 'ai') {
      validateOpenAIConfiguration(config, environment, moduleIssues.ai)
    } else if (moduleId === 'billing') {
      validateStripeConfiguration(config, environment, moduleIssues.billing)
    }
  }
}

function validateStripeConfiguration(
  config: NormalizedRuntimeConfig,
  environment: RuntimeEnvironment,
  issues: RuntimeConfigIssue[]
) {
  const secretKey = 'NUXT_STRIPE_SECRET_KEY'
  const secret = environment[secretKey] ?? ''
  requireAlreadyTrimmed(secret, secretKey, issues)
  if (secret && !/^rk_(?:test|live)_[A-Za-z0-9_]+$/.test(secret)) {
    issues.push(configIssue('invalid', secretKey, 'must be a Stripe restricted API key'))
  }

  const webhookKey = 'NUXT_STRIPE_WEBHOOK_SECRET'
  const webhookSecret = environment[webhookKey] ?? ''
  requireAlreadyTrimmed(webhookSecret, webhookKey, issues)
  if (webhookSecret && !/^whsec_[A-Za-z0-9_]+$/.test(webhookSecret)) {
    issues.push(configIssue('invalid', webhookKey, 'must be a Stripe webhook signing secret'))
  }

  const portalKey = 'NUXT_STRIPE_PORTAL_CONFIGURATION_ID'
  const portalConfigurationId = environment[portalKey] ?? ''
  requireAlreadyTrimmed(portalConfigurationId, portalKey, issues)
  if (portalConfigurationId && !portalConfigurationId.startsWith('bpc_')) {
    issues.push(configIssue('invalid', portalKey, 'must be a Stripe Billing Portal configuration ID'))
  }

  const priceRequirements = moduleManifest.billing.requiredConfig.filter((requirement) =>
    requirement.environmentKey.endsWith('_PRICE_ID')
  )
  const keysByPriceId = new Map<string, string[]>()

  for (const requirement of priceRequirements) {
    const rawPriceId = environment[requirement.environmentKey] ?? ''
    const priceId = scalarStringValue(configValueAtPath(config, requirement.configPath))
    requireAlreadyTrimmed(rawPriceId, requirement.environmentKey, issues)
    if (priceId && !priceId.startsWith('price_')) {
      issues.push(configIssue('invalid', requirement.environmentKey, 'must be a Stripe Price ID'))
    }
    if (priceId) {
      const keys = keysByPriceId.get(priceId) ?? []
      keys.push(requirement.environmentKey)
      keysByPriceId.set(priceId, keys)
    }
  }

  for (const keys of keysByPriceId.values()) {
    if (keys.length < 2) continue
    for (const key of keys) {
      issues.push(configIssue('invalid', key, 'must be distinct from every other configured Stripe Price ID'))
    }
  }
}

function validateOpenAIConfiguration(
  config: NormalizedRuntimeConfig,
  environment: RuntimeEnvironment,
  issues: RuntimeConfigIssue[]
) {
  for (const key of ['NUXT_OPENAI_API_KEY', 'NUXT_OPENAI_PROJECT_ID', 'NUXT_OPENAI_MODEL'] as const) {
    requireAlreadyTrimmed(environment[key] ?? '', key, issues)
  }

  if (!config.openai.fileSearch.enabled) return
  const key = 'NUXT_OPENAI_FILE_SEARCH_VECTOR_STORE_ID'
  const value = environment[key] ?? ''
  requireAlreadyTrimmed(value, key, issues)
  if (value.length > 512) {
    issues.push(configIssue('invalid', key, 'must contain at most 512 characters'))
  }
}

function validateTurnstileTestKeyContainment(
  config: NormalizedRuntimeConfig,
  environment: RuntimeEnvironment,
  issues: RuntimeConfigIssue[]
) {
  const secretIsTestKey = officialTurnstileTestSecretKeys.has(config.cloudflare.turnstile.secretKey)
  const siteIsTestKey = officialTurnstileTestSiteKeys.has(config.public.turnstileSiteKey)

  if (secretIsTestKey !== siteIsTestKey) {
    for (const key of ['NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY', 'NUXT_PUBLIC_TURNSTILE_SITE_KEY']) {
      issues.push(configIssue('invalid', key, 'must not mix official Turnstile test credentials with live credentials'))
    }
  }

  if (environment.NODE_ENV !== 'production') return

  if (secretIsTestKey) {
    issues.push(
      configIssue(
        'invalid',
        'NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY',
        'must not use an official Turnstile test key in production or staging'
      )
    )
  }
  if (siteIsTestKey) {
    issues.push(
      configIssue(
        'invalid',
        'NUXT_PUBLIC_TURNSTILE_SITE_KEY',
        'must not use an official Turnstile test key in production or staging'
      )
    )
  }
}

function validateModuleRequirement(
  config: NormalizedRuntimeConfig,
  environment: RuntimeEnvironment,
  requirement: ModuleRequirement,
  issues: RuntimeConfigIssue[]
) {
  const resolvedValue = scalarStringValue(configValueAtPath(config, requirement.configPath))

  if (requirement.kind === 'sample-rate') {
    validateRuntimeSampleRate(environment, requirement.environmentKey, resolvedValue, issues)
    return
  }

  if (requirement.kind === 'domain-list') {
    validateWebSearchAllowedDomains(
      environment,
      requirement.environmentKey,
      config.openai.webSearch.allowedDomains,
      issues
    )
    return
  }

  if (requirement.kind === 'http-url') {
    requireRuntimeHttpUrl(environment, requirement.environmentKey, resolvedValue, issues, requirement.preserveBytes)
    return
  }

  if (requirement.kind === 'value-enum') {
    const rawRuntimeValue = environment[requirement.environmentKey] ?? ''
    const rawValue = rawRuntimeValue.trim()
    requireMatch(resolvedValue, rawValue, requirement.environmentKey, issues)
    if (requirement.preserveBytes) {
      requireAlreadyTrimmed(rawRuntimeValue, requirement.environmentKey, issues)
    }
    if (!requirement.allowedValues?.includes(rawValue)) {
      issues.push(
        configIssue(
          'invalid',
          requirement.environmentKey,
          `must be exactly one of ${requirement.allowedValues?.join(', ') ?? ''} when the module is enabled`
        )
      )
    }
    return
  }

  requireRuntimeValue(environment, requirement.environmentKey, resolvedValue, issues, requirement.preserveBytes)
}

function requirementApplies(config: NormalizedRuntimeConfig, requirement: ModuleRequirement): boolean {
  return !requirement.when || configValueAtPath(config, requirement.when.configPath) === requirement.when.equals
}

function configValueAtPath(config: NormalizedRuntimeConfig, path: string): unknown {
  return path.split('.').reduce<unknown>((value, part) => recordValue(value)[part], config)
}

function requireValue(value: string, key: string, issues: RuntimeConfigIssue[]) {
  if (!value.trim()) issues.push(configIssue('missing', key, 'is required'))
}

function requireAlreadyTrimmed(value: string, key: string, issues: RuntimeConfigIssue[]) {
  if (value && value !== value.trim()) {
    issues.push(configIssue('invalid', key, 'must be already trimmed'))
  }
}

function requirePreservedRuntimeValue(
  environment: RuntimeEnvironment,
  resolvedValue: string,
  key: string,
  issues: RuntimeConfigIssue[]
) {
  const rawValue = environment[key] ?? ''
  requireValue(rawValue, key, issues)
  requireMatch(resolvedValue, rawValue, key, issues)
}

function requireRuntimeValue(
  environment: RuntimeEnvironment,
  key: string,
  resolvedValue: string,
  issues: RuntimeConfigIssue[],
  preserveBytes = false
) {
  const rawValue = environment[key] ?? ''
  requireValue(rawValue, key, issues)
  requireMatch(resolvedValue, preserveBytes ? rawValue : rawValue.trim(), key, issues)
}

function requireRuntimeHttpUrl(
  environment: RuntimeEnvironment,
  key: string,
  resolvedValue: string,
  issues: RuntimeConfigIssue[],
  requireAlreadyTrimmed = false
) {
  const rawValue = environment[key] ?? ''
  const trimmedValue = rawValue.trim()
  requireHttpUrl(trimmedValue, key, issues)
  requireMatch(resolvedValue, trimmedValue, key, issues)
  if (requireAlreadyTrimmed && rawValue !== trimmedValue) {
    issues.push(configIssue('invalid', key, 'must be already trimmed'))
  }
}

function requireMatch(resolvedValue: string, runtimeValue: string, key: string, issues: RuntimeConfigIssue[]) {
  if (runtimeValue && resolvedValue !== runtimeValue) {
    issues.push(configIssue('mismatch', key, 'did not resolve from the runtime environment'))
  }
}

function requireHttpUrl(value: string, key: string, issues: RuntimeConfigIssue[]) {
  const trimmedValue = value.trim()
  if (!trimmedValue) {
    issues.push(configIssue('missing', key, 'is required'))
    return
  }
  try {
    const url = new URL(trimmedValue)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol')
  } catch {
    issues.push(configIssue('invalid', key, 'must be an absolute http(s) URL'))
  }
}

function validateSampleRate(value: string, key: string, issues: RuntimeConfigIssue[]) {
  if (!value.trim()) return
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    issues.push(configIssue('invalid', key, 'must be a finite number between 0 and 1'))
  }
}

function validateRuntimeSampleRate(
  environment: RuntimeEnvironment,
  key: string,
  resolvedValue: string,
  issues: RuntimeConfigIssue[]
) {
  const rawValue = environment[key]
  if (rawValue !== undefined) {
    if (!rawValue.trim()) {
      issues.push(configIssue('invalid', key, 'must be omitted or a finite number between 0 and 1'))
      return
    }
    requireMatch(resolvedValue, scalarStringValue(destr(rawValue)), key, issues)
    validateSampleRate(rawValue, key, issues)
    return
  }
  validateSampleRate(resolvedValue, key, issues)
}

function emptyModuleIssues(): Record<RuntimeModuleId, RuntimeConfigIssue[]> {
  return runtimeModuleIds.reduce<Record<RuntimeModuleId, RuntimeConfigIssue[]>>(
    (issues, id) => {
      issues[id] = []
      return issues
    },
    {} as Record<RuntimeModuleId, RuntimeConfigIssue[]>
  )
}

function normalizeFilesDriver(value: unknown): NormalizedRuntimeConfig['files']['driver'] {
  const driver = trimmedStringValue(value)
  return driver === 'local' || driver === 'r2' ? driver : ''
}

function normalizeOpenAIModel(value: unknown): NormalizedRuntimeConfig['openai']['model'] {
  return trimmedStringValue(value) === 'gpt-5.6-luna' ? 'gpt-5.6-luna' : ''
}

function parseWebSearchAllowedDomains(value: unknown): string[] {
  return typeof value === 'string' && value ? value.split(',') : []
}

function validateWebSearchAllowedDomains(
  environment: RuntimeEnvironment,
  key: string,
  resolvedDomains: readonly string[],
  issues: RuntimeConfigIssue[]
) {
  const rawValue = environment[key] ?? ''
  requireValue(rawValue, key, issues)
  requireMatch(resolvedDomains.join(','), rawValue, key, issues)
  if (!rawValue) return

  const domains = rawValue.split(',')
  const canonicalHostname =
    /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
  const invalidDomain = domains.some((domain) => {
    if (!canonicalHostname.test(domain) || domainToASCII(domain) !== domain || isIP(domain) !== 0) return true
    try {
      return new URL(`https://${domain}`).hostname !== domain
    } catch {
      return true
    }
  })
  const uniqueDomains = new Set(domains)
  const hasRedundantCoverage = domains.some((domain, index) =>
    domains.some((candidate, candidateIndex) => index !== candidateIndex && domain.endsWith(`.${candidate}`))
  )

  if (domains.length > 100) {
    issues.push(configIssue('invalid', key, 'must contain at most 100 domains'))
  }
  if (invalidDomain) {
    issues.push(
      configIssue(
        'invalid',
        key,
        'must contain only comma-separated canonical lowercase ASCII or punycode DNS hostnames with at least one dot'
      )
    )
  }
  if (uniqueDomains.size !== domains.length) {
    issues.push(configIssue('invalid', key, 'must not contain duplicate domains'))
  }
  if (hasRedundantCoverage) {
    issues.push(configIssue('invalid', key, 'must not contain both a parent domain and one of its subdomains'))
  }
}

function normalizeEmailTransport(value: unknown): NormalizedRuntimeConfig['email']['transport'] {
  const transport = trimmedStringValue(value)
  return transport === 'capture' || transport === 'smtp' ? transport : ''
}

function normalizeEmailSmtpSecurity(value: unknown): NormalizedRuntimeConfig['email']['smtp']['security'] {
  const security = trimmedStringValue(value)
  return security === 'tls' || security === 'starttls' ? security : ''
}

function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function trimmedStringValue(value: unknown): string {
  return stringValue(value).trim()
}

function scalarStringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''
}

function moduleIdsForConfigPath(path: PropertyKey[]): RuntimeModuleId[] {
  const [root = '', nested = ''] = path.map(String)
  if (root === 'modules' && runtimeModuleIds.includes(nested as RuntimeModuleId)) {
    return [nested as RuntimeModuleId]
  }
  return []
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

function freezeEvaluation(
  config: NormalizedRuntimeConfig | undefined,
  coreIssues: RuntimeConfigIssue[],
  moduleIssues: Record<RuntimeModuleId, RuntimeConfigIssue[]>
): RuntimeConfigEvaluation {
  return deepFreeze({
    config: config ? deepFreeze(config) : undefined,
    coreIssues: deduplicateIssues(coreIssues),
    moduleIssues: Object.fromEntries(runtimeModuleIds.map((id) => [id, deduplicateIssues(moduleIssues[id])])) as Record<
      RuntimeModuleId,
      RuntimeConfigIssue[]
    >
  })
}

function deduplicateIssues(issues: RuntimeConfigIssue[]): RuntimeConfigIssue[] {
  return [...new Map(issues.map((issue) => [`${issue.key}\0${issue.code}\0${issue.message}`, issue])).values()]
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value)) deepFreeze(nested)
  }
  return value as DeepReadonly<T>
}
