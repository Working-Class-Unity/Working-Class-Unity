import { isIP } from 'node:net'
import { isAbsolute } from 'node:path'
import { domainToASCII } from 'node:url'
import destr from 'destr'
import { z } from 'zod'

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

export const retiredCapabilitySwitchEnvironmentKeys = [
  'NUXT_MODULES_BILLING_ENABLED',
  'NUXT_MODULES_FILES_ENABLED',
  'NUXT_MODULES_AI_ENABLED',
  'NUXT_MODULES_TURNSTILE_ENABLED',
  'NUXT_MODULES_OBSERVABILITY_ENABLED',
  'NUXT_MODULES_JOBS_ENABLED',
  'NUXT_OPENAI_FILE_SEARCH_ENABLED',
  'NUXT_OPENAI_WEB_SEARCH_ENABLED'
] as const

const retiredCapabilitySwitchEnvironmentKeySet = new Set<string>(retiredCapabilitySwitchEnvironmentKeys)

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
  ['EMAIL', 'object'],
  ['EMAIL_RESEND', 'object'],
  ['TWILIO_VERIFY', 'object'],
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
  ['DATABASE_URL', 'leaf'],
  ['READINESS_TOKEN', 'leaf'],
  ['BETTER_AUTH_SECRET', 'leaf'],
  ['BETTER_AUTH_URL', 'leaf'],
  ['EMAIL_TRANSPORT', 'leaf'],
  ['EMAIL_FROM', 'leaf'],
  ['EMAIL_CAPTURE_DIRECTORY', 'leaf'],
  ['EMAIL_RESEND_API_KEY', 'leaf'],
  ['TWILIO_VERIFY_API_KEY_SID', 'leaf'],
  ['TWILIO_VERIFY_API_KEY_SECRET', 'leaf'],
  ['TWILIO_VERIFY_SERVICE_SID', 'leaf'],
  ['STRIPE_SECRET_KEY', 'leaf'],
  ['STRIPE_WEBHOOK_SECRET', 'leaf'],
  ['STRIPE_PORTAL_CONFIGURATION_ID', 'leaf'],
  ['STRIPE_MEMBERSHIP_DUES10_PRICE_ID', 'leaf'],
  ['STRIPE_SOLIDARITY_DUES27_PRICE_ID', 'leaf'],
  ['FILES_DRIVER', 'leaf'],
  ['OPENAI_API_KEY', 'leaf'],
  ['OPENAI_PROJECT_ID', 'leaf'],
  ['OPENAI_MODEL', 'leaf'],
  ['OPENAI_FILE_SEARCH_VECTOR_STORE_ID', 'leaf'],
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
  ['PUBLIC_TURNSTILE_SITE_KEY', 'leaf']
] as const

const forbiddenNuxtObjectEnvironmentKeys = new Set(
  canonicalAppRuntimePaths.filter(([, kind]) => kind === 'object').map(([path]) => `NUXT_${path}`)
)

const forbiddenNitroRuntimeConfigEnvironmentKeys = new Set(canonicalAppRuntimePaths.map(([path]) => `NITRO_${path}`))

type RuntimeEnvironment = Record<string, string | undefined>

type RuntimeRequirement = Readonly<{
  environmentKey: string
  configPath: string
  kind: 'domain-list' | 'http-url' | 'value' | 'value-enum'
  allowedValues?: readonly string[]
  preserveBytes?: boolean
  when?: Readonly<{
    configPath: string
    equals: string
  }>
}>

const runtimeRequirements = [
  {
    environmentKey: 'NUXT_TWILIO_VERIFY_API_KEY_SID',
    configPath: 'twilioVerify.apiKeySid',
    kind: 'value'
  },
  {
    environmentKey: 'NUXT_TWILIO_VERIFY_API_KEY_SECRET',
    configPath: 'twilioVerify.apiKeySecret',
    kind: 'value',
    preserveBytes: true
  },
  {
    environmentKey: 'NUXT_TWILIO_VERIFY_SERVICE_SID',
    configPath: 'twilioVerify.serviceSid',
    kind: 'value'
  },
  { environmentKey: 'NUXT_STRIPE_SECRET_KEY', configPath: 'stripe.secretKey', kind: 'value', preserveBytes: true },
  {
    environmentKey: 'NUXT_STRIPE_WEBHOOK_SECRET',
    configPath: 'stripe.webhookSecret',
    kind: 'value',
    preserveBytes: true
  },
  {
    environmentKey: 'NUXT_STRIPE_PORTAL_CONFIGURATION_ID',
    configPath: 'stripe.portalConfigurationId',
    kind: 'value'
  },
  {
    environmentKey: 'NUXT_STRIPE_MEMBERSHIP_DUES10_PRICE_ID',
    configPath: 'stripe.membershipDues10PriceId',
    kind: 'value'
  },
  {
    environmentKey: 'NUXT_STRIPE_SOLIDARITY_DUES27_PRICE_ID',
    configPath: 'stripe.solidarityDues27PriceId',
    kind: 'value'
  },
  {
    environmentKey: 'NUXT_FILES_DRIVER',
    configPath: 'files.driver',
    kind: 'value-enum',
    allowedValues: ['local', 'r2']
  },
  {
    environmentKey: 'NUXT_CLOUDFLARE_ACCOUNT_ID',
    configPath: 'cloudflare.accountId',
    kind: 'value',
    when: { configPath: 'files.driver', equals: 'r2' }
  },
  {
    environmentKey: 'NUXT_CLOUDFLARE_R2_BUCKET',
    configPath: 'cloudflare.r2.bucket',
    kind: 'value',
    when: { configPath: 'files.driver', equals: 'r2' }
  },
  {
    environmentKey: 'NUXT_CLOUDFLARE_R2_ENDPOINT',
    configPath: 'cloudflare.r2.endpoint',
    kind: 'http-url',
    when: { configPath: 'files.driver', equals: 'r2' }
  },
  {
    environmentKey: 'NUXT_CLOUDFLARE_R2_ACCESS_KEY_ID',
    configPath: 'cloudflare.r2.accessKeyId',
    kind: 'value',
    preserveBytes: true,
    when: { configPath: 'files.driver', equals: 'r2' }
  },
  {
    environmentKey: 'NUXT_CLOUDFLARE_R2_SECRET_ACCESS_KEY',
    configPath: 'cloudflare.r2.secretAccessKey',
    kind: 'value',
    preserveBytes: true,
    when: { configPath: 'files.driver', equals: 'r2' }
  },
  { environmentKey: 'NUXT_OPENAI_API_KEY', configPath: 'openai.apiKey', kind: 'value', preserveBytes: true },
  { environmentKey: 'NUXT_OPENAI_PROJECT_ID', configPath: 'openai.projectId', kind: 'value' },
  {
    environmentKey: 'NUXT_OPENAI_MODEL',
    configPath: 'openai.model',
    kind: 'value-enum',
    allowedValues: ['gpt-5.6-luna']
  },
  {
    environmentKey: 'NUXT_OPENAI_FILE_SEARCH_VECTOR_STORE_ID',
    configPath: 'openai.fileSearch.vectorStoreId',
    kind: 'value',
    preserveBytes: true
  },
  {
    environmentKey: 'NUXT_OPENAI_WEB_SEARCH_ALLOWED_DOMAINS',
    configPath: 'openai.webSearch.allowedDomains',
    kind: 'domain-list',
    preserveBytes: true
  },
  {
    environmentKey: 'NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY',
    configPath: 'cloudflare.turnstile.secretKey',
    kind: 'value',
    preserveBytes: true
  },
  {
    environmentKey: 'NUXT_PUBLIC_TURNSTILE_SITE_KEY',
    configPath: 'public.turnstileSiteKey',
    kind: 'value',
    preserveBytes: true
  }
] as const satisfies readonly RuntimeRequirement[]

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
  email: z.object({
    transport: z.unknown(),
    from: z.unknown(),
    captureDirectory: z.unknown(),
    resend: z.object({
      apiKey: z.unknown()
    })
  }),
  twilioVerify: z.unknown(),
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
  email: {
    transport: '' | 'capture' | 'resend'
    from: string
    captureDirectory: string
    resend: {
      apiKey: string
    }
  }
  twilioVerify: {
    apiKeySid: string
    apiKeySecret: string
    serviceSid: string
  }
  files: {
    driver: '' | 'local' | 'r2'
  }
  openai: {
    apiKey: string
    projectId: string
    model: 'gpt-5.6-luna' | ''
    fileSearch: {
      vectorStoreId: string
    }
    webSearch: {
      allowedDomains: string[]
    }
  }
  stripe: {
    secretKey: string
    webhookSecret: string
    portalConfigurationId: string
    membershipDues10PriceId: string
    solidarityDues27PriceId: string
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
  issues: RuntimeConfigIssue[]
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
  const issues: RuntimeConfigIssue[] = []
  validateRuntimeEnvironmentKeyContract(environment, issues)
  const parsed = runtimeConfigSchema.safeParse(input)

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push(
        configIssue('shape', environmentKeyForPath(issue.path), 'must use the documented runtime configuration shape')
      )
    }
    return freezeEvaluation(undefined, issues)
  }

  const config = normalizeRuntimeConfig(parsed.data)
  validateCore(config, environment, issues)
  validateCapabilities(config, environment, issues)
  validateR2Endpoint(config, issues)

  return freezeEvaluation(config, issues)
}

function validateR2Endpoint(config: NormalizedRuntimeConfig, issues: RuntimeConfigIssue[]) {
  if (config.files.driver !== 'r2') return
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
    email: {
      transport: nitroEnvironmentValue(environment, 'NUXT_EMAIL_TRANSPORT'),
      from: nitroEnvironmentValue(environment, 'NUXT_EMAIL_FROM'),
      captureDirectory: nitroEnvironmentValue(environment, 'NUXT_EMAIL_CAPTURE_DIRECTORY'),
      resend: {
        apiKey: nitroEnvironmentValue(environment, 'NUXT_EMAIL_RESEND_API_KEY')
      }
    },
    twilioVerify: {
      apiKeySid: nitroEnvironmentValue(environment, 'NUXT_TWILIO_VERIFY_API_KEY_SID'),
      apiKeySecret: nitroEnvironmentValue(environment, 'NUXT_TWILIO_VERIFY_API_KEY_SECRET'),
      serviceSid: nitroEnvironmentValue(environment, 'NUXT_TWILIO_VERIFY_SERVICE_SID')
    },
    stripe: {
      secretKey: nitroEnvironmentValue(environment, 'NUXT_STRIPE_SECRET_KEY'),
      webhookSecret: nitroEnvironmentValue(environment, 'NUXT_STRIPE_WEBHOOK_SECRET'),
      portalConfigurationId: nitroEnvironmentValue(environment, 'NUXT_STRIPE_PORTAL_CONFIGURATION_ID'),
      membershipDues10PriceId: nitroEnvironmentValue(environment, 'NUXT_STRIPE_MEMBERSHIP_DUES10_PRICE_ID'),
      solidarityDues27PriceId: nitroEnvironmentValue(environment, 'NUXT_STRIPE_SOLIDARITY_DUES27_PRICE_ID')
    },
    files: {
      driver: nitroEnvironmentValue(environment, 'NUXT_FILES_DRIVER')
    },
    openai: {
      apiKey: nitroEnvironmentValue(environment, 'NUXT_OPENAI_API_KEY'),
      projectId: nitroEnvironmentValue(environment, 'NUXT_OPENAI_PROJECT_ID'),
      model: nitroEnvironmentValue(environment, 'NUXT_OPENAI_MODEL'),
      fileSearch: {
        vectorStoreId: nitroEnvironmentValue(environment, 'NUXT_OPENAI_FILE_SEARCH_VECTOR_STORE_ID')
      },
      webSearch: {
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
      appName: nitroEnvironmentValue(environment, 'NUXT_PUBLIC_APP_NAME', 'Working Class Unity'),
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
  const emailResend = recordValue(email.resend)
  const twilioVerify = recordValue(config.twilioVerify)
  const stripe = recordValue(config.stripe)
  const files = recordValue(config.files)
  const openai = recordValue(config.openai)
  const openaiFileSearch = recordValue(openai.fileSearch)
  const openaiWebSearch = recordValue(openai.webSearch)
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
    email: {
      transport: normalizeEmailTransport(email.transport),
      from: trimmedStringValue(email.from),
      captureDirectory: trimmedStringValue(email.captureDirectory),
      resend: {
        apiKey: stringValue(emailResend.apiKey)
      }
    },
    twilioVerify: {
      apiKeySid: trimmedStringValue(twilioVerify.apiKeySid),
      apiKeySecret: stringValue(twilioVerify.apiKeySecret),
      serviceSid: trimmedStringValue(twilioVerify.serviceSid)
    },
    stripe: {
      secretKey: stringValue(stripe.secretKey),
      webhookSecret: stringValue(stripe.webhookSecret),
      portalConfigurationId: trimmedStringValue(stripe.portalConfigurationId),
      membershipDues10PriceId: trimmedStringValue(stripe.membershipDues10PriceId),
      solidarityDues27PriceId: trimmedStringValue(stripe.solidarityDues27PriceId)
    },
    files: {
      driver: normalizeFilesDriver(files.driver)
    },
    openai: {
      apiKey: stringValue(openai.apiKey),
      projectId: trimmedStringValue(openai.projectId),
      model: normalizeOpenAIModel(openai.model),
      fileSearch: {
        vectorStoreId: trimmedStringValue(openaiFileSearch.vectorStoreId)
      },
      webSearch: {
        allowedDomains: parseWebSearchAllowedDomains(openaiWebSearch.allowedDomains)
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
      appName: config.public.appName.trim() || 'Working Class Unity',
      appUrl: config.public.appUrl.trim(),
      sentryDsn: trimmedStringValue(config.public.sentryDsn),
      sentryEnvironment: trimmedStringValue(config.public.sentryEnvironment),
      sentryRelease: trimmedStringValue(config.public.sentryRelease),
      sentryTracesSampleRate: scalarStringValue(config.public.sentryTracesSampleRate),
      turnstileSiteKey: stringValue(config.public.turnstileSiteKey)
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
    } else if (retiredCapabilitySwitchEnvironmentKeySet.has(key)) {
      issues.push(configIssue('invalid', key, 'is unsupported because basic-release availability is source-controlled'))
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
  if (transport !== 'capture' && transport !== 'resend') {
    issues.push(configIssue('invalid', 'NUXT_EMAIL_TRANSPORT', 'must be exactly capture or resend'))
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

    const productionTestCaptureAllowed =
      environment.CI === 'true' &&
      isLoopbackRuntimeOrigin(environment.NUXT_PUBLIC_APP_URL) &&
      isLoopbackRuntimeOrigin(environment.NUXT_BETTER_AUTH_URL)
    if (environment.NODE_ENV === 'production' && !productionTestCaptureAllowed) {
      issues.push(
        configIssue(
          'invalid',
          'NUXT_EMAIL_TRANSPORT',
          'capture is test-only in production mode and requires CI=true with loopback app and auth origins'
        )
      )
    }
    return
  }

  if (transport !== 'resend') return
  requirePreservedRuntimeValue(environment, config.resend.apiKey, 'NUXT_EMAIL_RESEND_API_KEY', issues)
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '::1') return true
  return isIP(normalized) === 4 && normalized.split('.')[0] === '127'
}

function isLoopbackRuntimeOrigin(value: string | undefined): boolean {
  try {
    const origin = value?.trim() ?? ''
    const parsed = new URL(origin)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.origin === origin &&
      isLoopbackHostname(parsed.hostname)
    )
  } catch {
    return false
  }
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

function validateCapabilities(
  config: NormalizedRuntimeConfig,
  environment: RuntimeEnvironment,
  issues: RuntimeConfigIssue[]
) {
  for (const requirement of runtimeRequirements) {
    if (!requirementApplies(config, environment, requirement)) continue
    validateRuntimeRequirement(config, environment, requirement, issues)
  }

  validateStripeConfiguration(config, environment, issues)
  validateTwilioVerifyConfiguration(config, environment, issues)
  validateFilesConfiguration(config, environment, issues)
  validateOpenAIConfiguration(config, environment, issues)
  validateTurnstileTestKeyContainment(config, environment, issues)
  validateSentryConfiguration(config, environment, issues)
}

function validateTwilioVerifyConfiguration(
  config: NormalizedRuntimeConfig,
  environment: RuntimeEnvironment,
  issues: RuntimeConfigIssue[]
) {
  const apiKeySidKey = 'NUXT_TWILIO_VERIFY_API_KEY_SID'
  const apiKeySid = environment[apiKeySidKey] ?? ''
  requireAlreadyTrimmed(apiKeySid, apiKeySidKey, issues)
  if (config.twilioVerify.apiKeySid && !/^SK[0-9a-fA-F]{32}$/.test(config.twilioVerify.apiKeySid)) {
    issues.push(configIssue('invalid', apiKeySidKey, 'must be a Twilio API key SID'))
  }

  const apiKeySecretKey = 'NUXT_TWILIO_VERIFY_API_KEY_SECRET'
  const apiKeySecret = environment[apiKeySecretKey] ?? ''
  requireAlreadyTrimmed(apiKeySecret, apiKeySecretKey, issues)
  if (config.twilioVerify.apiKeySecret && config.twilioVerify.apiKeySecret.length < 32) {
    issues.push(configIssue('invalid', apiKeySecretKey, 'must contain at least 32 characters'))
  }

  const serviceSidKey = 'NUXT_TWILIO_VERIFY_SERVICE_SID'
  const serviceSid = environment[serviceSidKey] ?? ''
  requireAlreadyTrimmed(serviceSid, serviceSidKey, issues)
  if (config.twilioVerify.serviceSid && !/^VA[0-9a-fA-F]{32}$/.test(config.twilioVerify.serviceSid)) {
    issues.push(configIssue('invalid', serviceSidKey, 'must be a Twilio Verify Service SID'))
  }
}

function validateFilesConfiguration(
  config: NormalizedRuntimeConfig,
  environment: RuntimeEnvironment,
  issues: RuntimeConfigIssue[]
) {
  const productionTestLocalAllowed =
    environment.CI === 'true' &&
    isLoopbackRuntimeOrigin(environment.NUXT_PUBLIC_APP_URL) &&
    isLoopbackRuntimeOrigin(environment.NUXT_BETTER_AUTH_URL)
  if (environment.NODE_ENV === 'production' && config.files.driver === 'local' && !productionTestLocalAllowed) {
    issues.push(
      configIssue(
        'invalid',
        'NUXT_FILES_DRIVER',
        'local is test-only in production mode and requires CI=true with loopback app and auth origins'
      )
    )
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

  const priceRequirements = runtimeRequirements.filter(
    (requirement) =>
      requirement.environmentKey.startsWith('NUXT_STRIPE_') && requirement.environmentKey.endsWith('_PRICE_ID')
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

  const key = 'NUXT_OPENAI_FILE_SEARCH_VECTOR_STORE_ID'
  const value = environment[key] ?? ''
  requireAlreadyTrimmed(value, key, issues)
  if (value.length > 512) {
    issues.push(configIssue('invalid', key, 'must contain at most 512 characters'))
  }
}

function validateSentryConfiguration(
  config: NormalizedRuntimeConfig,
  environment: RuntimeEnvironment,
  issues: RuntimeConfigIssue[]
) {
  const values = [
    ['NUXT_SENTRY_DSN', config.sentryDsn],
    ['NUXT_PUBLIC_SENTRY_DSN', config.public.sentryDsn]
  ] as const
  const production = environment.NODE_ENV === 'production'

  for (const [key, resolvedValue] of values) {
    const rawValue = environment[key] ?? ''
    if (production) {
      requireRuntimeHttpUrl(environment, key, resolvedValue, issues, true)
    } else if (rawValue) {
      requireRuntimeHttpUrl(environment, key, resolvedValue, issues, true)
    } else {
      requireMatch(resolvedValue, rawValue, key, issues)
    }
  }

  for (const [key, resolvedValue] of [
    ['NUXT_SENTRY_TRACES_SAMPLE_RATE', config.sentryTracesSampleRate],
    ['NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE', config.public.sentryTracesSampleRate]
  ] as const) {
    validateRuntimeSampleRate(environment, key, resolvedValue, issues)
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

function validateRuntimeRequirement(
  config: NormalizedRuntimeConfig,
  environment: RuntimeEnvironment,
  requirement: RuntimeRequirement,
  issues: RuntimeConfigIssue[]
) {
  const resolvedValue = scalarStringValue(configValueAtPath(config, requirement.configPath))

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
          `must be exactly one of ${requirement.allowedValues?.join(', ') ?? ''}`
        )
      )
    }
    return
  }

  requireRuntimeValue(environment, requirement.environmentKey, resolvedValue, issues, requirement.preserveBytes)
}

function requirementApplies(
  config: NormalizedRuntimeConfig,
  environment: RuntimeEnvironment,
  requirement: RuntimeRequirement
): boolean {
  if (requirement.when && configValueAtPath(config, requirement.when.configPath) !== requirement.when.equals) {
    return false
  }
  if (requirement.environmentKey === 'NUXT_FILES_DRIVER') return Boolean(environment.NUXT_FILES_DRIVER)
  if (requirement.environmentKey.startsWith('NUXT_OPENAI_')) {
    return [
      'NUXT_OPENAI_API_KEY',
      'NUXT_OPENAI_PROJECT_ID',
      'NUXT_OPENAI_MODEL',
      'NUXT_OPENAI_FILE_SEARCH_VECTOR_STORE_ID',
      'NUXT_OPENAI_WEB_SEARCH_ALLOWED_DOMAINS'
    ].some((key) => Boolean(environment[key]))
  }
  return true
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
  return transport === 'capture' || transport === 'resend' ? transport : ''
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
  issues: RuntimeConfigIssue[]
): RuntimeConfigEvaluation {
  return deepFreeze({
    config: config ? deepFreeze(config) : undefined,
    issues: deduplicateIssues(issues)
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
