const SITE_URL = 'https://workingclassunity.com'
const LOCALES = ['en', 'es', 'pa'] as const
const DEFAULT_LOCALE = 'en'

const PUBLIC_ROUTES = [
  '/',
  '/about',
  '/join',
  '/calendar',
  '/campaigns',
  '/know-your-rights',
  '/know-your-rights/documents-to-keep',
  '/know-your-rights/ice-at-home',
  '/know-your-rights/ice-at-work',
  '/know-your-rights/ice-in-public',
  '/know-your-rights/ice-pulls-you-over',
  '/tenant-union-handbook',
  '/check-in-coverage',
  '/check-in-coverage-volunteer-guide',
  '/checkinsupport',
  '/links',
  '/unitedfront',
] as const

const toLocalizedPath = (routePath: string, locale: (typeof LOCALES)[number]): string => {
  if (locale === DEFAULT_LOCALE) {
    return routePath
  }

  return routePath === '/' ? `/${locale}` : `/${locale}${routePath}`
}

const toAbsoluteUrl = (routePath: string, locale: (typeof LOCALES)[number]): string => {
  return `${SITE_URL}${toLocalizedPath(routePath, locale)}`
}

const escapeXml = (value: string): string => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export default defineEventHandler((event) => {
  setHeader(event, 'Content-Type', 'application/xml; charset=UTF-8')

  const lastmod = new Date().toISOString()

  const urlEntries: string[] = []

  for (const routePath of PUBLIC_ROUTES) {
    const alternates = LOCALES.map((locale) => ({
      locale,
      href: toAbsoluteUrl(routePath, locale),
    }))

    for (const locale of LOCALES) {
      const loc = toAbsoluteUrl(routePath, locale)

      const alternateLinks = [
        ...alternates.map(({ locale: altLocale, href }) => {
          return `<xhtml:link rel="alternate" hreflang="${altLocale}" href="${escapeXml(href)}" />`
        }),
        `<xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(toAbsoluteUrl(routePath, DEFAULT_LOCALE))}" />`,
      ].join('')

      urlEntries.push(
        `<url><loc>${escapeXml(loc)}</loc><lastmod>${lastmod}</lastmod>${alternateLinks}</url>`
      )
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urlEntries.join('')}</urlset>`
})
