import messages from '../../i18n/locales/en.json'
import rightsMessages from '../../i18n/locales/know-your-rights/en.json'
import { campaignLandingPage } from '../../app/content/remove-flock-stockton/landing'
import { campaignFaqPage } from '../../app/content/remove-flock-stockton/faq'
import { whatStocktonBoughtPage } from '../../app/content/remove-flock-stockton/what-stockton-bought'
import { whySafeguardsPage } from '../../app/content/remove-flock-stockton/why-safeguards'
import {
  absoluteSiteUrl,
  localizedPublicPath,
  publicLocales,
  publicPages,
  resolvePageMetadata
} from '../../shared/public-site'

const englishMessages = { ...messages, ...rightsMessages }
const campaignPages = { campaignLandingPage, campaignFaqPage, whatStocktonBoughtPage, whySafeguardsPage }

function englishMessage(key: string): string {
  const value = key.split('.').reduce<unknown>((part, name) => (part as Record<string, unknown>)[name], englishMessages)
  if (typeof value !== 'string') throw new Error(`Missing public page metadata: ${key}`)
  return value
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!
  )
}

function markdownLabel(value: string): string {
  return value
    .replace(/[\\[\]]/g, '\\$&')
    .replace(/\s+/g, ' ')
    .trim()
}

export function renderSitemap(origin: string): string {
  const urls = publicPages.flatMap((page) => {
    const alternates = [
      ...publicLocales.map(({ code }) => ({ code, path: localizedPublicPath(page.path, code) })),
      { code: 'x-default', path: page.path }
    ]
      .map(
        ({ code, path }) =>
          `    <xhtml:link rel="alternate" hreflang="${code}" href="${escapeXml(absoluteSiteUrl(origin, path))}" />`
      )
      .join('\n')
    return publicLocales.map(
      ({ code }) =>
        `  <url>\n    <loc>${escapeXml(absoluteSiteUrl(origin, localizedPublicPath(page.path, code)))}</loc>\n${alternates}\n  </url>`
    )
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`
}

export function renderLlmsText(origin: string): string {
  const lines = ['# Working Class Unity', '', `> ${messages.metadata.home.description}`, '']
  for (const section of new Set(publicPages.map((page) => page.section))) {
    lines.push(`## ${section}`, '')
    for (const page of publicPages.filter((entry) => entry.section === section)) {
      const metadata = resolvePageMetadata(page, englishMessage, (key) => campaignPages[key])
      lines.push(
        `- [${markdownLabel(metadata.title)}](${absoluteSiteUrl(origin, page.path)}): ${metadata.description.replace(/\s+/g, ' ').trim()}`
      )
      for (const { code, name } of publicLocales.filter((entry) => entry.code !== 'en')) {
        lines.push(`  - [${name}](${absoluteSiteUrl(origin, localizedPublicPath(page.path, code))})`)
      }
    }
    lines.push('')
  }
  return lines.join('\n')
}

export function renderRobotsText(origin: string): string {
  return `User-agent: *\nDisallow: /api/\n\nSitemap: ${absoluteSiteUrl(origin, '/sitemap.xml')}\n`
}
