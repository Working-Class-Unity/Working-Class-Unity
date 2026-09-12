import { describe, expect, it } from 'vitest'
import { campaignLandingPage } from '../app/content/remove-flock-stockton/landing'
import {
  findPublicPage,
  localizedPublicPath,
  pageStructuredData,
  publicLocales,
  publicPages,
  serializeStructuredData,
  unlocalizedPublicPath
} from '../shared/public-site'
import { renderLlmsText, renderRobotsText, renderSitemap } from '../server/utils/site-discovery'

const origin = 'https://workingclassunity.com'

describe('public website discovery', () => {
  it('includes the public campaigns and excludes account, API, redirect, and unknown routes', () => {
    expect(findPublicPage('/')).toBeDefined()
    expect(findPublicPage(campaignLandingPage.path)).toBeDefined()
    expect(findPublicPage('/campaigns/know-your-rights/ice-at-home')).toBeDefined()
    expect(findPublicPage('/es/campaigns/remove-flock-stockton/')?.path).toBe(campaignLandingPage.path)
    expect(findPublicPage('/pa')?.path).toBe('/')
    for (const path of [
      '/account',
      '/app',
      '/login',
      '/activate',
      '/join/complete',
      '/api/events',
      '/forum',
      '/draft'
    ]) {
      expect(findPublicPage(path), path).toBeUndefined()
      expect(findPublicPage(`/es${path}`), path).toBeUndefined()
    }
    expect(new Set(publicPages.map((page) => page.path)).size).toBe(publicPages.length)
  })

  it('generates the sitemap from canonical public paths, without private records or tracking URLs', () => {
    const xml = renderSitemap(origin)
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('<loc>https://workingclassunity.com/campaigns/remove-flock-stockton</loc>')
    expect(xml).toContain('<loc>https://workingclassunity.com/calendar</loc>')
    expect(xml).not.toMatch(/\/api\/|\/account|\/app<|\/join\/complete|<loc>[^<]*\?|<lastmod>/)
    const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
    expect(new Set(locations).size).toBe(publicPages.length * publicLocales.length)
    for (const { path } of publicPages) {
      for (const { code } of publicLocales) {
        expect(locations).toContain(`${origin}${localizedPublicPath(path, code)}`)
      }
    }
    for (const block of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
      for (const code of ['en', 'es', 'pa', 'x-default']) expect(block[1]).toContain(`hreflang="${code}"`)
    }
  })

  it('generates a readable llms.txt from the existing public content rather than a second copy', () => {
    const markdown = renderLlmsText(origin)
    expect(markdown).toMatch(/^# Working Class Unity\n/)
    expect(markdown).toContain(`[${campaignLandingPage.title}](${origin}${campaignLandingPage.path})`)
    expect(markdown).toContain(campaignLandingPage.description)
    expect(markdown).toContain(`${origin}/calendar`)
    expect(markdown).toContain(`${origin}/es/campaigns/remove-flock-stockton`)
    expect(markdown).toContain(`${origin}/pa/campaigns/remove-flock-stockton`)
    expect(markdown).not.toMatch(/\/api\/|\/account|\/join\/complete|session_id|attendees|memberOnly/)
  })

  it('opts out of training while preserving public search and user-requested AI access', () => {
    const robots = renderRobotsText(origin)
    const groups = new Map(
      robots
        .trim()
        .split('\n\n')
        .filter((group) => group.startsWith('User-agent: '))
        .map((group) => {
          const [agent, ...rules] = group.split('\n')
          return [agent!.slice('User-agent: '.length), rules]
        })
    )

    for (const agent of ['GPTBot', 'ClaudeBot', 'Applebot-Extended']) {
      expect(groups.get(agent), agent).toEqual(['Disallow: /'])
    }
    for (const agent of [
      'Googlebot',
      'bingbot',
      'OAI-SearchBot',
      'ChatGPT-User',
      'Claude-SearchBot',
      'Claude-User',
      'Applebot',
      'Google-Extended',
      'Amazonbot',
      'meta-externalagent'
    ]) {
      expect(groups.get(agent) ?? groups.get('*'), agent).toEqual(['Disallow: /api/'])
    }
    expect(robots).toContain(`Sitemap: ${origin}/sitemap.xml`)
  })

  it('uses stable localized canonicals in structured data and safely embeds public copy', () => {
    expect(localizedPublicPath('/', 'en')).toBe('/')
    expect(localizedPublicPath('/', 'es')).toBe('/es')
    expect(unlocalizedPublicPath('/pa/about/')).toBe('/about')
    expect(unlocalizedPublicPath('/partners')).toBe('/partners')
    const page = findPublicPage('/campaigns/remove-flock-stockton/what-stockton-bought')!
    const metadata = { title: 'Public </script> title', description: 'Published research' }
    const schema = pageStructuredData(page, metadata, origin, 'pa')
    expect(schema['@graph'][1]).toMatchObject({
      '@type': 'Article',
      url: `${origin}/pa${page.path}`,
      headline: metadata.title,
      inLanguage: 'pa'
    })
    const serialized = serializeStructuredData(schema)
    expect(serialized).not.toContain('</script>')
    expect(JSON.parse(serialized)).toEqual(schema)
    expect(serialized).not.toMatch(/datePublished|dateModified/)
  })
})
