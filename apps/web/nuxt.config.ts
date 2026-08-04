import { defineNuxtConfig } from 'nuxt/config'
import { runtimeModuleIds } from './shared/modules'
import { createBaseContentSecurityPolicy } from './shared/content-security-policy'
import { assertSafeBetterAuthBuildEnvironment } from './server/utils/runtime'

const isProduction = process.env.NODE_ENV === 'production'
const observabilityEnabled = process.env.NUXT_MODULES_OBSERVABILITY_ENABLED === 'true'
const sentryUploadEnabled =
  isProduction &&
  observabilityEnabled &&
  ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'].every((key) => hasExactBuildValue(process.env[key]))
const forbiddenPublicModuleStateBuildKeys = [
  'NUXT_PUBLIC_MODULE_STATES',
  'NITRO_PUBLIC_MODULE_STATES',
  ...runtimeModuleIds.flatMap((moduleId) => {
    const suffix = moduleId.toUpperCase()
    return [`NUXT_PUBLIC_MODULE_STATES_${suffix}`, `NITRO_PUBLIC_MODULE_STATES_${suffix}`]
  })
]
const presentPublicModuleStateBuildKeys = forbiddenPublicModuleStateBuildKeys.filter(
  (key) => process.env[key] !== undefined
)

if (presentPublicModuleStateBuildKeys.length) {
  throw new Error(
    `Public module states are server-derived and cannot be supplied at build time: ${presentPublicModuleStateBuildKeys.join(', ')}`
  )
}

assertSafeBetterAuthBuildEnvironment(process.env)

export default defineNuxtConfig({
  compatibilityDate: '2026-05-13',
  future: {
    compatibilityVersion: 5
  },
  experimental: {
    // The application and installed modules use Nitro's supported server
    // autoimport engine; keep that explicit while adopting the other v5 defaults.
    nitroAutoImports: true
  },
  modules: ['@nuxt/eslint', '@nuxtjs/i18n', '@sentry/nuxt/module', 'nuxt-security'],
  i18n: {
    defaultLocale: 'en',
    strategy: 'no_prefix',
    detectBrowserLanguage: false,
    locales: [
      {
        code: 'en',
        language: 'en-US',
        dir: 'ltr',
        file: 'en.json'
      }
    ],
    compilation: {
      strictMessage: true
    }
  },
  devtools: {
    enabled: !isProduction
  },
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      htmlAttrs: {
        lang: 'en-US',
        dir: 'ltr'
      },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'theme-color', content: '#f7f3ea' }
      ],
      link: [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }]
    }
  },
  runtimeConfig: {
    databaseUrl: '',
    readinessToken: '',
    betterAuth: {
      secret: '',
      url: ''
    },
    socialProviders: {
      google: {
        enabled: '',
        clientId: '',
        clientSecret: ''
      }
    },
    email: {
      transport: '',
      from: '',
      captureDirectory: '',
      smtp: {
        host: '',
        port: '',
        security: '',
        username: '',
        password: ''
      }
    },
    modules: {
      billing: { enabled: '' },
      files: { enabled: '' },
      ai: { enabled: '' },
      turnstile: { enabled: '' },
      observability: { enabled: '' },
      jobs: { enabled: '' }
    },
    stripe: {
      secretKey: '',
      webhookSecret: '',
      portalConfigurationId: '',
      personalWeeklyPriceId: '',
      personalMonthlyPriceId: '',
      personalAnnualPriceId: '',
      familyMonthlyPriceId: '',
      familyAnnualPriceId: ''
    },
    files: {
      driver: ''
    },
    openai: {
      apiKey: '',
      projectId: '',
      model: '',
      fileSearch: {
        enabled: '',
        vectorStoreId: ''
      },
      webSearch: {
        enabled: '',
        allowedDomains: ''
      }
    },
    sentryDsn: '',
    sentryEnvironment: '',
    sentryRelease: '',
    sentryTracesSampleRate: '0.05',
    observability: {
      testToken: ''
    },
    cloudflare: {
      accountId: '',
      r2: {
        bucket: '',
        endpoint: '',
        accessKeyId: '',
        secretAccessKey: ''
      },
      turnstile: {
        secretKey: ''
      }
    },
    public: {
      appName: 'SmallWiseLabs Base App',
      appUrl: '',
      sentryDsn: '',
      sentryEnvironment: '',
      sentryRelease: '',
      sentryTracesSampleRate: '0.05',
      turnstileSiteKey: '',
      moduleStates: {
        billing: 'disabled',
        files: 'disabled',
        ai: 'disabled',
        turnstile: 'disabled',
        observability: 'disabled',
        jobs: 'disabled'
      }
    }
  },
  nitro: {
    preset: process.env.NITRO_PRESET ?? 'node-server',
    externals: {
      // Keep the official Nuxt SDK outside Nitro's shared application chunk so
      // Node can initialize it before any application module is evaluated.
      external: ['@sentry/nuxt'],
      // nuxt-security imports its optional XSS middleware dependency at module
      // initialization even when the middleware is disabled. Bundle it so the
      // standalone Nitro output does not depend on a workspace node_modules.
      inline: ['xss']
    },
    experimental: {
      envExpansion: false
    },
    storage: {
      local: {
        driver: 'fs',
        base: '../../data/nitro'
      }
    }
  },
  routeRules: {
    '/_nuxt/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
    '/invite/**': {
      headers: {
        'cache-control': 'private, no-store'
      },
      security: {
        headers: {
          referrerPolicy: 'no-referrer'
        }
      }
    },
    '/app': {
      headers: {
        'cache-control': 'private, no-store'
      }
    },
    '/app/**': {
      headers: {
        'cache-control': 'private, no-store'
      }
    },
    '/account': {
      headers: {
        'cache-control': 'private, no-store'
      }
    },
    '/account/billing': {
      headers: {
        'cache-control': 'private, no-store'
      }
    },
    '/login': {
      headers: {
        'cache-control': 'private, no-store'
      }
    },
    '/signup': {
      headers: {
        'cache-control': 'private, no-store'
      }
    },
    '/api/**': { cache: false },
    '/api/live': { cache: false },
    '/api/ready': { cache: false },
    '/api/baseline': { cache: { maxAge: 60 } },
    '/api/auth/**': { cache: false },
    '/api/ai/**': { cache: false },
    '/api/account/billing/**': { cache: false },
    '/api/webhooks/stripe': { cache: false },
    '/api/files/**': { cache: false },
    '/api/observability/**': { cache: false }
  },
  security: {
    strict: false,
    headers: {
      contentSecurityPolicy: createBaseContentSecurityPolicy(isProduction),
      crossOriginResourcePolicy: 'same-origin',
      crossOriginOpenerPolicy: 'same-origin',
      // Stripe does not support cross-origin isolation. Provider-specific
      // resource permissions belong in the CSP instead of a blanket COEP.
      crossOriginEmbedderPolicy: false,
      originAgentCluster: '?1',
      referrerPolicy: 'strict-origin-when-cross-origin',
      strictTransportSecurity: isProduction
        ? {
            maxAge: 15_552_000,
            includeSubdomains: true
          }
        : false,
      xContentTypeOptions: 'nosniff',
      xDNSPrefetchControl: 'off',
      xDownloadOptions: 'noopen',
      xFrameOptions: 'DENY',
      xPermittedCrossDomainPolicies: 'none',
      xXSSProtection: '0',
      permissionsPolicy: {
        camera: [],
        'display-capture': [],
        fullscreen: [],
        geolocation: [],
        microphone: [],
        payment: [],
        usb: []
      }
    },
    // Better Auth and application routes own stricter, route-aware security
    // boundaries. These generic middlewares cannot replace those guarantees.
    requestSizeLimiter: false,
    rateLimiter: false,
    xssValidator: false,
    corsHandler: false,
    allowedMethodsRestricter: false,
    hidePoweredBy: true,
    basicAuth: false,
    enabled: true,
    csrf: false,
    nonce: true,
    removeLoggers: false,
    ssg: false,
    sri: true,
    contentSecurityPolicyReportOnly: false
  },
  sourcemap: {
    server: false,
    client: sentryUploadEnabled ? 'hidden' : false
  },
  sentry: {
    telemetry: false,
    errorHandler(error) {
      throw error
    },
    sourcemaps: {
      disable: !sentryUploadEnabled,
      ignore: ['**/.nuxt/dist/server/**', '**/.output/server/**']
    }
  },
  typescript: {
    typeCheck: false
  }
})

function hasExactBuildValue(value: string | undefined): boolean {
  return Boolean(value && value === value.trim())
}
