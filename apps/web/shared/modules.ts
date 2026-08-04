import type { LiveModuleState, ModuleState, PublicModuleStates as StateRecord } from './module-states'

export type ModuleRequirement = Readonly<{
  environmentKey: string
  configPath: string
  kind: 'domain-list' | 'http-url' | 'sample-rate' | 'value' | 'value-enum'
  allowedValues?: readonly string[]
  preserveBytes?: boolean
  required?: boolean
  when?: Readonly<{
    configPath: string
    equals: string | boolean
  }>
}>

type ModuleManifestEntry = Readonly<{
  flagEnvironmentKey: string
  label: string
  requiredConfig: readonly ModuleRequirement[]
  exclusiveRoutePrefixes: readonly string[]
  uiRoutes: readonly string[]
  health: Readonly<{
    disabled: 'healthy'
    incomplete: 'unready'
    ready: 'healthy'
  }>
}>

/**
 * The authoritative optional-module runtime policy. Runtime validation,
 * request gating, readiness policy, and focused tests consume this object.
 */
export const moduleManifest = {
  billing: {
    flagEnvironmentKey: 'NUXT_MODULES_BILLING_ENABLED',
    label: 'Billing',
    requiredConfig: [
      {
        environmentKey: 'NUXT_STRIPE_SECRET_KEY',
        configPath: 'stripe.secretKey',
        kind: 'value',
        preserveBytes: true
      },
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
        environmentKey: 'NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID',
        configPath: 'stripe.personalWeeklyPriceId',
        kind: 'value'
      },
      {
        environmentKey: 'NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID',
        configPath: 'stripe.personalMonthlyPriceId',
        kind: 'value'
      },
      {
        environmentKey: 'NUXT_STRIPE_PERSONAL_ANNUAL_PRICE_ID',
        configPath: 'stripe.personalAnnualPriceId',
        kind: 'value'
      },
      {
        environmentKey: 'NUXT_STRIPE_FAMILY_MONTHLY_PRICE_ID',
        configPath: 'stripe.familyMonthlyPriceId',
        kind: 'value'
      },
      {
        environmentKey: 'NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID',
        configPath: 'stripe.familyAnnualPriceId',
        kind: 'value'
      }
    ],
    exclusiveRoutePrefixes: ['/api/account/billing', '/api/webhooks/stripe'],
    uiRoutes: ['/account/billing'],
    health: { disabled: 'healthy', incomplete: 'unready', ready: 'healthy' }
  },
  files: {
    flagEnvironmentKey: 'NUXT_MODULES_FILES_ENABLED',
    label: 'Files',
    requiredConfig: [
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
      }
    ],
    exclusiveRoutePrefixes: ['/api/files'],
    uiRoutes: [],
    health: { disabled: 'healthy', incomplete: 'unready', ready: 'healthy' }
  },
  ai: {
    flagEnvironmentKey: 'NUXT_MODULES_AI_ENABLED',
    label: 'AI',
    requiredConfig: [
      {
        environmentKey: 'NUXT_OPENAI_API_KEY',
        configPath: 'openai.apiKey',
        kind: 'value',
        preserveBytes: true
      },
      {
        environmentKey: 'NUXT_OPENAI_PROJECT_ID',
        configPath: 'openai.projectId',
        kind: 'value'
      },
      {
        environmentKey: 'NUXT_OPENAI_MODEL',
        configPath: 'openai.model',
        kind: 'value-enum',
        allowedValues: ['gpt-5.6-luna']
      },
      {
        environmentKey: 'NUXT_OPENAI_FILE_SEARCH_ENABLED',
        configPath: 'openai.fileSearch.enabled',
        kind: 'value-enum',
        allowedValues: ['true', 'false'],
        preserveBytes: true
      },
      {
        environmentKey: 'NUXT_OPENAI_FILE_SEARCH_VECTOR_STORE_ID',
        configPath: 'openai.fileSearch.vectorStoreId',
        kind: 'value',
        preserveBytes: true,
        when: { configPath: 'openai.fileSearch.enabled', equals: true }
      },
      {
        environmentKey: 'NUXT_OPENAI_WEB_SEARCH_ENABLED',
        configPath: 'openai.webSearch.enabled',
        kind: 'value-enum',
        allowedValues: ['true', 'false'],
        preserveBytes: true
      },
      {
        environmentKey: 'NUXT_OPENAI_WEB_SEARCH_ALLOWED_DOMAINS',
        configPath: 'openai.webSearch.allowedDomains',
        kind: 'domain-list',
        preserveBytes: true,
        when: { configPath: 'openai.webSearch.enabled', equals: true }
      }
    ],
    exclusiveRoutePrefixes: ['/api/ai'],
    uiRoutes: [],
    health: { disabled: 'healthy', incomplete: 'unready', ready: 'healthy' }
  },
  turnstile: {
    flagEnvironmentKey: 'NUXT_MODULES_TURNSTILE_ENABLED',
    label: 'Turnstile',
    requiredConfig: [
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
    ],
    exclusiveRoutePrefixes: [],
    uiRoutes: [],
    health: { disabled: 'healthy', incomplete: 'unready', ready: 'healthy' }
  },
  observability: {
    flagEnvironmentKey: 'NUXT_MODULES_OBSERVABILITY_ENABLED',
    label: 'Observability',
    requiredConfig: [
      {
        environmentKey: 'NUXT_SENTRY_DSN',
        configPath: 'sentryDsn',
        kind: 'http-url',
        preserveBytes: true
      },
      {
        environmentKey: 'NUXT_PUBLIC_SENTRY_DSN',
        configPath: 'public.sentryDsn',
        kind: 'http-url',
        preserveBytes: true
      },
      {
        environmentKey: 'NUXT_SENTRY_TRACES_SAMPLE_RATE',
        configPath: 'sentryTracesSampleRate',
        kind: 'sample-rate',
        required: false
      },
      {
        environmentKey: 'NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE',
        configPath: 'public.sentryTracesSampleRate',
        kind: 'sample-rate',
        required: false
      }
    ],
    exclusiveRoutePrefixes: ['/api/observability'],
    uiRoutes: ['/observability-client-test'],
    health: { disabled: 'healthy', incomplete: 'unready', ready: 'healthy' }
  },
  jobs: {
    flagEnvironmentKey: 'NUXT_MODULES_JOBS_ENABLED',
    label: 'Jobs',
    requiredConfig: [],
    exclusiveRoutePrefixes: [],
    uiRoutes: [],
    health: { disabled: 'healthy', incomplete: 'unready', ready: 'healthy' }
  }
} as const satisfies Record<string, ModuleManifestEntry>

export type RuntimeModuleId = keyof typeof moduleManifest
export type PublicModuleStates = StateRecord<RuntimeModuleId>
export type { LiveModuleState, ModuleState }

export const runtimeModuleIds = Object.freeze(Object.keys(moduleManifest)) as readonly RuntimeModuleId[]
