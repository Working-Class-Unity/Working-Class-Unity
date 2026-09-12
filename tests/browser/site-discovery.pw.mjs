import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { localizedPublicPath, publicLocales, publicPages, siteSocialImage } from '../../shared/public-site.ts'

const spanishMessages = JSON.parse(readFileSync(new URL('../../i18n/locales/es.json', import.meta.url), 'utf8'))
const punjabiCampaign = JSON.parse(
  readFileSync(new URL('../../i18n/locales/content/remove-flock/pa.json', import.meta.url), 'utf8')
).localizedRemoveFlock

test('every published language URL exposes its own metadata in initial HTML', async ({ request, page, baseURL }) => {
  for (const { code, language } of publicLocales) {
    for (const publicPage of publicPages) {
      const path = localizedPublicPath(publicPage.path, code)
      const response = await request.get(`${path}?utm_source=metadata-check`, {
        headers: { 'accept-language': 'en-US' }
      })
      expect(response.status(), path).toBe(200)
      const head = await readInitialHead(page, await response.text())
      const canonical = new URL(path, baseURL).href
      expect(head.language, path).toBe(language)
      expect(head.title, path).toBeTruthy()
      expect(head.description, path).toBeTruthy()
      expect(head.canonical, path).toEqual([canonical])
      expect(head.ogTitle, path).toBe(head.title)
      expect(head.ogDescription, path).toBe(head.description)
      expect(head.ogUrl, path).toBe(canonical)
      expect(head.ogImage, path).toBe(new URL(siteSocialImage.path, baseURL).href)
      expect(head.twitterCard, path).toBe('summary_large_image')
      expect(head.twitterImage, path).toBe(head.ogImage)
      expect(head.robots, path).toBe('index, follow, max-image-preview:large')
      expect(head.alternates, path).toEqual([
        ...publicLocales.map(({ code: alternate }) => ({
          language: alternate,
          href: new URL(localizedPublicPath(publicPage.path, alternate), baseURL).href
        })),
        { language: 'x-default', href: new URL(publicPage.path, baseURL).href }
      ])
      expect(head.schemas, path).toHaveLength(1)
      expect(head.schemas[0]['@graph'][1], path).toMatchObject({ url: canonical, inLanguage: language })
      if (path === '/es/about') expect(head.title).toBe(spanishMessages.metadata.about.title)
      if (path === '/pa/campaigns/remove-flock-stockton/what-stockton-bought') {
        expect(head.title).toBe(punjabiCampaign.whatStocktonBoughtPage.title)
        expect(head.description).toBe(punjabiCampaign.whatStocktonBoughtPage.description)
      }
    }
  }
})

test('discovery endpoints and the social image are publicly fetchable without account data', async ({
  request,
  baseURL
}) => {
  for (const [path, type] of [
    ['/robots.txt', 'text/plain'],
    ['/llms.txt', 'text/plain'],
    ['/sitemap.xml', 'application/xml']
  ]) {
    const response = await request.get(path)
    expect(response.status(), path).toBe(200)
    expect(response.headers()['content-type'], path).toContain(type)
    const body = await response.text()
    expect(body).toContain(baseURL)
    expect(body).not.toMatch(/build-sentinel|session_id|attendees|\/account|\/join\/complete/)
    if (path === '/robots.txt') {
      expect(body).toBe(`User-agent: *\nDisallow: /api/\n\nSitemap: ${baseURL}/sitemap.xml\n`)
    }
    if (path === '/sitemap.xml') expect([...body.matchAll(/<loc>/g)].length).toBe(publicPages.length * 3)
  }
  const image = await request.get(siteSocialImage.path)
  expect(image.status()).toBe(200)
  expect(image.headers()['content-type']).toContain('image/png')
  const bytes = await image.body()
  expect(bytes.readUInt32BE(16)).toBe(siteSocialImage.width)
  expect(bytes.readUInt32BE(20)).toBe(siteSocialImage.height)
})

test('metadata follows client navigation and missing pages stay out of discovery', async ({
  page,
  request,
  baseURL
}) => {
  await page.goto('/es/about')
  await page.locator('.bylaws-link').click()
  await expect(page).toHaveURL(/\/es\/bylaws$/)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${baseURL}/es/bylaws`)
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', `${baseURL}/es/bylaws`)
  await expect(page).toHaveTitle(spanishMessages.metadata.bylaws.title)

  for (const path of ['/es/login', '/pa/account', '/unknown-discovery-page']) {
    const response = await request.get(path)
    expect(response.status(), path).toBe(404)
    const head = await readInitialHead(page, await response.text())
    expect(head.robots, path).toBe('noindex, nofollow')
    expect(head.canonical, path).toEqual([])
    expect(head.alternates, path).toEqual([])
    expect(head.schemas, path).toEqual([])
    expect(head.ogUrl, path).toBeNull()
  }
})

test('retired website account URLs lead to public dues options without forwarding private query data', async ({
  request
}) => {
  for (const path of ['/login', '/signup', '/activate', '/account', '/app', '/join/complete']) {
    const response = await request.get(`${path}?token=retired-link&session_id=retired-checkout`, {
      maxRedirects: 0
    })
    expect(response.status(), path).toBe(302)
    expect(response.headers().location, path).toBe('/join')
  }
})

test('an explicit English public URL overrides a saved language', async ({ request, page, baseURL }) => {
  const headers = { cookie: 'wcu_locale=pa', 'accept-language': 'en-US' }
  const about = await request.get('/about', { headers, maxRedirects: 0 })
  expect(about.status()).toBe(200)
  const aboutHead = await readInitialHead(page, await about.text())
  expect(aboutHead.language).toBe('en-US')
  expect(aboutHead.canonical).toEqual([`${baseURL}/about`])
})

async function readInitialHead(page, html) {
  return page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, 'text/html')
    const meta = (selector) => document.querySelector(`meta[${selector}]`)?.getAttribute('content') ?? null
    return {
      language: document.documentElement.lang,
      title: document.title,
      description: meta('name="description"'),
      canonical: [...document.querySelectorAll('link[rel="canonical"]')].map((link) => link.getAttribute('href')),
      alternates: [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((link) => ({
        language: link.getAttribute('hreflang'),
        href: link.getAttribute('href')
      })),
      ogTitle: meta('property="og:title"'),
      ogDescription: meta('property="og:description"'),
      ogUrl: meta('property="og:url"'),
      ogImage: meta('property="og:image"'),
      twitterCard: meta('name="twitter:card"'),
      twitterImage: meta('name="twitter:image"'),
      robots: meta('name="robots"'),
      schemas: [...document.querySelectorAll('script[type="application/ld+json"]')].map((script) =>
        JSON.parse(script.textContent)
      )
    }
  }, html)
}
