import tailwindcss from "@tailwindcss/vite";

const isDevelopment = process.env.NODE_ENV === 'development'
const isProduction = process.env.NODE_ENV === 'production'

export default defineNuxtConfig({
  compatibilityDate: "2024-11-01",
  devtools: { enabled: isDevelopment },

  // Site configuration for SEO and Schema.org
  site: {
    url: 'https://workingclassunity.com',
    name: 'Working Class Unity',
  },

  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/png', href: '/favicon-96x96.png', sizes: '96x96' },
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'shortcut icon', href: '/favicon.ico' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
        { rel: 'manifest', href: '/site.webmanifest' },
      ],
      meta: [
        { name: 'apple-mobile-web-app-title', content: 'WCU' },
      ],
    },
  },
  css: ['~/assets/css/main.css'],
  modules: ['@nuxtjs/i18n', '@nuxt/image', '@nuxt/fonts', '@nuxt/scripts', 'nuxt-schema-org'],

  // Schema.org configuration
  schemaOrg: {
    identity: {
      type: 'Organization',
      name: 'Working Class Unity',
      logo: 'https://workingclassunity.com/logo_dark.svg',
      sameAs: [
        'https://x.com/workclassunity',
        'https://www.facebook.com/WorkClassUnity/',
      ],
    },
  },
  i18n: {
    lazy: true,
    langDir: 'locales',
    defaultLocale: 'en',
    strategy: 'prefix_except_default',
    locales: [
      { code: 'en', file: 'en.json', name: 'English' },
      { code: 'es', file: 'es.json', name: 'Español' },
      { code: 'pa', file: 'pa.json', name: 'ਪੰਜਾਬੀ' },
    ],
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'i18n_redirected',
      redirectOn: 'root',
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
  
  // Runtime configuration for environment variables
  runtimeConfig: {
    // Public keys (exposed to client) - Formbricks needs client-side access
    public: {
      formbricksEnvironmentId: process.env.NUXT_PUBLIC_FORMBRICKS_ENVIRONMENT_ID || 'cminsehli0009o8015hjuzkuz',
      formbricksAppUrl: process.env.NUXT_PUBLIC_FORMBRICKS_APP_URL || 'https://form.workingclassunity.com',
    },
  },
  
  // Nitro configuration for security headers and CSP
  nitro: {
    routeRules: {
      '/**': {
        headers: {
          'X-Frame-Options': 'SAMEORIGIN',
          'X-Content-Type-Options': 'nosniff',
          'X-XSS-Protection': '1; mode=block',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
          'Content-Security-Policy': [
            "default-src 'self'",
            `script-src 'self' 'unsafe-inline'${isProduction ? '' : " 'unsafe-eval'"} https://app.cal.com https://form.workingclassunity.com`,
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' data: https://fonts.gstatic.com",
            "img-src 'self' data: blob: https:",
            "connect-src 'self' https://app.cal.com https://form.workingclassunity.com https://api.formbricks.com",
            "frame-src 'self' https://app.cal.com https://cal.com",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'self'",
            "upgrade-insecure-requests",
          ].join('; '),
        },
      },
    },
  },
  
});
