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
  modules: ['@nuxtjs/i18n', '@nuxt/image', '@nuxt/fonts', '@nuxt/scripts', 'nuxt-schema-org', '@nuxt/eslint'],

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
    baseUrl: 'https://workingclassunity.com',
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
    pocketbaseUrl: process.env.POCKETBASE_URL || '',
    pocketbaseServiceEmail: process.env.POCKETBASE_SERVICE_EMAIL || '',
    pocketbaseServicePassword: process.env.POCKETBASE_SERVICE_PASSWORD || '',
    pocketbaseAuthCollection: process.env.POCKETBASE_AUTH_COLLECTION || 'users',
    pocketbaseMagicLinkCollection: process.env.POCKETBASE_MAGIC_LINK_COLLECTION || 'auth_magic_links',
    pocketbaseMagicLinkTtlMinutes: Number.parseInt(process.env.POCKETBASE_MAGIC_LINK_TTL_MINUTES || '20', 10),
    pocketbaseMemberProfileCollection: process.env.POCKETBASE_MEMBER_PROFILE_COLLECTION || 'member_profiles',
    pocketbaseDuesRecordCollection: process.env.POCKETBASE_DUES_RECORD_COLLECTION || 'dues_records',
    pocketbaseMemberProfileUserField: process.env.POCKETBASE_MEMBER_PROFILE_USER_FIELD || 'userId',
    pocketbaseDuesRecordUserField: process.env.POCKETBASE_DUES_RECORD_USER_FIELD || 'userId',
    pocketbaseBuildingsCollection: process.env.POCKETBASE_BUILDINGS_COLLECTION || 'buildings',
    pocketbaseOutreachCollection: process.env.POCKETBASE_OUTREACH_COLLECTION || 'outreach_interactions',
    pocketbaseOutreachDateField: process.env.POCKETBASE_OUTREACH_DATE_FIELD || 'occurredAt',
    pocketbaseOutreachBuildingField: process.env.POCKETBASE_OUTREACH_BUILDING_FIELD || 'buildingId',
    pocketbaseFinanceIncomeCollection: process.env.POCKETBASE_FINANCE_INCOME_COLLECTION || 'dues_records',
    pocketbaseFinanceExpenseCollection: process.env.POCKETBASE_FINANCE_EXPENSE_COLLECTION || 'expense_records',
    pocketbaseFinanceIncomeAmountField: process.env.POCKETBASE_FINANCE_INCOME_AMOUNT_FIELD || 'amountCents',
    pocketbaseFinanceExpenseAmountField: process.env.POCKETBASE_FINANCE_EXPENSE_AMOUNT_FIELD || 'amountCents',
    pocketbaseFinanceIncomeDateField: process.env.POCKETBASE_FINANCE_INCOME_DATE_FIELD || 'paidAt',
    pocketbaseFinanceExpenseDateField: process.env.POCKETBASE_FINANCE_EXPENSE_DATE_FIELD || 'spentAt',
    pocketbaseUserRoleField: process.env.POCKETBASE_USER_ROLE_FIELD || 'role',
    pocketbaseUserDuesPaidThroughField: process.env.POCKETBASE_USER_DUES_PAID_THROUGH_FIELD || 'duesPaidThrough',
    authSessionSecret: process.env.AUTH_SESSION_SECRET || '',
    authSessionTtlSeconds: Number.parseInt(process.env.AUTH_SESSION_TTL_SECONDS || `${60 * 60 * 24 * 14}`, 10),
    resendApiKey: process.env.RESEND_API_KEY || '',
    resendFromEmail: process.env.RESEND_FROM_EMAIL || '',
    authMagicLinkOrigin: process.env.AUTH_MAGIC_LINK_ORIGIN || 'http://localhost:3000',
    // Public keys (exposed to client) - Formbricks needs client-side access
    public: {
      formbricksEnvironmentId: process.env.NUXT_PUBLIC_FORMBRICKS_ENVIRONMENT_ID || 'cminsehli0009o8015hjuzkuz',
      formbricksAppUrl: process.env.NUXT_PUBLIC_FORMBRICKS_APP_URL || 'https://form.workingclassunity.com',
    },
  },
  
  // Nitro configuration for security headers and CSP
  nitro: {
    routeRules: {
      '/kyr': {
        redirect: {
          to: '/know-your-rights',
          statusCode: 301,
        },
      },
      '/es/kyr': {
        redirect: {
          to: '/es/know-your-rights',
          statusCode: 301,
        },
      },
      '/pa/kyr': {
        redirect: {
          to: '/pa/know-your-rights',
          statusCode: 301,
        },
      },
      '/member/**': {
        headers: {
          'X-Robots-Tag': 'noindex, nofollow, noarchive',
        },
      },
      '/organizing/**': {
        headers: {
          'X-Robots-Tag': 'noindex, nofollow, noarchive',
        },
      },
      '/finance/**': {
        headers: {
          'X-Robots-Tag': 'noindex, nofollow, noarchive',
        },
      },
      '/es/member/**': {
        headers: {
          'X-Robots-Tag': 'noindex, nofollow, noarchive',
        },
      },
      '/es/organizing/**': {
        headers: {
          'X-Robots-Tag': 'noindex, nofollow, noarchive',
        },
      },
      '/es/finance/**': {
        headers: {
          'X-Robots-Tag': 'noindex, nofollow, noarchive',
        },
      },
      '/pa/member/**': {
        headers: {
          'X-Robots-Tag': 'noindex, nofollow, noarchive',
        },
      },
      '/pa/organizing/**': {
        headers: {
          'X-Robots-Tag': 'noindex, nofollow, noarchive',
        },
      },
      '/pa/finance/**': {
        headers: {
          'X-Robots-Tag': 'noindex, nofollow, noarchive',
        },
      },
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
