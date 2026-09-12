import { defineNuxtConfig } from 'nuxt/config'
import { createBaseContentSecurityPolicy } from './shared/content-security-policy'

const isProduction = process.env.NODE_ENV === 'production'
const sentryUploadEnabled =
  isProduction &&
  ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'].every((key) => hasExactBuildValue(process.env[key]))

export default defineNuxtConfig({
  compatibilityDate: '2026-05-13',
  future: {
    compatibilityVersion: 5
  },
  features: {
    // Keep the global @layer declaration ahead of component styles in SSR output.
    inlineStyles: false
  },
  experimental: {
    // The application and installed modules use Nitro's supported server
    // autoimport engine; keep that explicit while adopting the other v5 defaults.
    nitroAutoImports: true
  },
  modules: ['@nuxt/eslint', '@nuxtjs/i18n', '@sentry/nuxt/module', 'nuxt-security'],
  i18n: {
    defaultLocale: 'en',
    strategy: 'prefix_except_default',
    detectBrowserLanguage: {
      alwaysRedirect: false,
      cookieCrossOrigin: false,
      cookieKey: 'wcu_locale',
      fallbackLocale: 'en',
      redirectOn: 'root',
      useCookie: true
    },
    locales: [
      {
        code: 'en',
        language: 'en-US',
        dir: 'ltr',
        name: 'English',
        files: ['en.json', 'know-your-rights/en.json']
      },
      {
        code: 'es',
        language: 'es',
        dir: 'ltr',
        name: 'Español',
        files: ['es.json', 'content/bylaws/es.json', 'content/remove-flock/es.json', 'know-your-rights/es.json']
      },
      {
        code: 'pa',
        language: 'pa',
        dir: 'ltr',
        name: 'ਪੰਜਾਬੀ',
        files: ['pa.json', 'content/bylaws/pa.json', 'content/remove-flock/pa.json', 'know-your-rights/pa.json']
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
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'theme-color', content: '#f7f9fc' }
      ],
      link: [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }]
    }
  },
  runtimeConfig: {
    databaseUrl: '',
    readinessToken: '',
    sentryDsn: '',
    sentryEnvironment: '',
    sentryRelease: '',
    sentryTracesSampleRate: '0.05',
    observability: {
      testToken: ''
    },
    public: {
      appName: 'Working Class Unity',
      appUrl: '',
      sentryDsn: '',
      sentryEnvironment: '',
      sentryRelease: '',
      sentryTracesSampleRate: '0.05'
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
    }
  },
  routeRules: {
    '/_nuxt/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
    '/api/**': { cache: false },
    '/api/live': { cache: false },
    '/api/ready': { cache: false },
    '/api/observability/**': { cache: false }
  },
  security: {
    strict: false,
    headers: {
      contentSecurityPolicy: createBaseContentSecurityPolicy(isProduction),
      crossOriginResourcePolicy: 'same-origin',
      crossOriginOpenerPolicy: 'same-origin',
      // Keep resource permissions in the CSP without requiring cross-origin isolation.
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
    // API routes own their input and operational-token boundaries.
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
