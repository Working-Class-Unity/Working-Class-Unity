import { knowYourRightsBasePath, knowYourRightsGuides } from '../app/content/know-your-rights'

export type FlockPageKey = 'campaignLandingPage' | 'whatStocktonBoughtPage' | 'whySafeguardsPage' | 'campaignFaqPage'
export type PageMetadata = { title: string; description: string }

export const publicLocales = [
  { code: 'en', language: 'en-US', name: 'English', ogLocale: 'en_US' },
  { code: 'es', language: 'es', name: 'Español', ogLocale: 'es_US' },
  { code: 'pa', language: 'pa', name: 'ਪੰਜਾਬੀ', ogLocale: 'pa_IN' }
] as const
export type PublicLocale = (typeof publicLocales)[number]['code']

export type PublicPage = {
  path: string
  section: string
  schemaType?: 'AboutPage' | 'CollectionPage' | 'Article'
} & ({ titleKey: string; descriptionKey: string; organizationTitleKey?: string } | { flockPage: FlockPageKey })

// Only these public landing/content pages may enter discovery files. Account,
// API, checkout-completion, redirect, and unlisted routes are deliberately absent.
export const publicPages: readonly PublicPage[] = [
  { path: '/', section: 'Organization', titleKey: 'metadata.home.title', descriptionKey: 'metadata.home.description' },
  {
    path: '/about',
    section: 'Organization',
    schemaType: 'AboutPage',
    titleKey: 'metadata.about.title',
    descriptionKey: 'metadata.about.description'
  },
  {
    path: '/bylaws',
    section: 'Organization',
    titleKey: 'metadata.bylaws.title',
    descriptionKey: 'metadata.bylaws.description'
  },
  { path: '/join', section: 'Participation', titleKey: 'join.title', descriptionKey: 'join.tierExplanation' },
  {
    path: '/calendar',
    section: 'Participation',
    schemaType: 'CollectionPage',
    titleKey: 'metadata.calendar.title',
    descriptionKey: 'metadata.calendar.description'
  },
  {
    path: '/links',
    section: 'Participation',
    titleKey: 'metadata.links.title',
    descriptionKey: 'metadata.links.description'
  },
  { path: '/campaigns/remove-flock-stockton', section: 'Remove Flock from Stockton', flockPage: 'campaignLandingPage' },
  {
    path: '/campaigns/remove-flock-stockton/what-stockton-bought',
    section: 'Remove Flock from Stockton',
    schemaType: 'Article',
    flockPage: 'whatStocktonBoughtPage'
  },
  {
    path: '/campaigns/remove-flock-stockton/why-safeguards-are-not-enough',
    section: 'Remove Flock from Stockton',
    schemaType: 'Article',
    flockPage: 'whySafeguardsPage'
  },
  { path: '/campaigns/remove-flock-stockton/faq', section: 'Remove Flock from Stockton', flockPage: 'campaignFaqPage' },
  {
    path: '/campaigns/united-front',
    section: 'Campaigns',
    titleKey: 'unitedfront.pageTitle',
    descriptionKey: 'unitedfront.subtitle',
    organizationTitleKey: 'unitedfront.ui.org_name'
  },
  {
    path: knowYourRightsBasePath,
    section: 'Know your rights',
    titleKey: 'kyr_home.hero.title',
    descriptionKey: 'kyr_home.hero.description'
  },
  ...knowYourRightsGuides.map(({ path, titleKey, descriptionKey }) => ({
    path,
    titleKey,
    descriptionKey,
    section: 'Know your rights'
  })),
  {
    path: '/legal/privacy',
    section: 'Policies',
    titleKey: 'metadata.privacy.title',
    descriptionKey: 'metadata.privacy.description'
  },
  {
    path: '/legal/terms',
    section: 'Policies',
    titleKey: 'metadata.terms.title',
    descriptionKey: 'metadata.terms.description'
  }
]

export const siteSocialImage = {
  path: '/images/wcu-social-card-v1.png',
  width: 1730,
  height: 909,
  alt: 'Working Class Unity'
} as const

export function unlocalizedPublicPath(pathname: string): string {
  return pathname.replace(/^\/(es|pa)(?=\/|$)/, '').replace(/\/+$/, '') || '/'
}

export function localizedPublicPath(path: string, locale: PublicLocale): string {
  return locale === 'en' ? path : `/${locale}${path === '/' ? '' : path}`
}

export function findPublicPage(pathname: string): PublicPage | undefined {
  const path = unlocalizedPublicPath(pathname)
  return publicPages.find((page) => page.path === path)
}

export function resolvePageMetadata(
  page: PublicPage,
  message: (key: string) => string,
  campaign: (key: FlockPageKey) => PageMetadata
): PageMetadata {
  if ('flockPage' in page) return campaign(page.flockPage)
  const title = message(page.titleKey)
  return {
    title: page.organizationTitleKey ? `${title} | ${message(page.organizationTitleKey)}` : title,
    description: message(page.descriptionKey)
  }
}

export function absoluteSiteUrl(origin: string, path: string): string {
  return new URL(path, origin).href
}

export function pageStructuredData(page: PublicPage, metadata: PageMetadata, origin: string, locale: PublicLocale) {
  const siteUrl = absoluteSiteUrl(origin, '/')
  const url = absoluteSiteUrl(origin, localizedPublicPath(page.path, locale))
  const organizationId = `${siteUrl}#organization`
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': organizationId,
        name: 'Working Class Unity',
        url: siteUrl,
        logo: absoluteSiteUrl(origin, '/images/wcu-logo-dark.png')
      },
      {
        '@type': page.schemaType ?? 'WebPage',
        '@id': `${url}#page`,
        url,
        name: metadata.title,
        description: metadata.description,
        inLanguage: publicLocales.find((entry) => entry.code === locale)!.language,
        publisher: { '@id': organizationId },
        ...(page.schemaType === 'Article' ? { headline: metadata.title } : {})
      }
    ]
  }
}

export function serializeStructuredData(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}
