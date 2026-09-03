import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { knowYourRightsBasePath, knowYourRightsGuides } from '../app/content/know-your-rights'

const localeCodes = ['en', 'es', 'pa'] as const
const translatedNamespaces = [
  'kyr',
  'kyr_home',
  'kyr_nav',
  'kyr_ice_in_public',
  'kyr_ice_pulls_you_over',
  'kyr_ice_at_home',
  'kyr_ice_at_work',
  'kyr_documents_to_keep',
  'knowYourRights'
] as const

type Messages = Record<string, unknown>

function localeMessages(locale: (typeof localeCodes)[number]): Messages {
  return JSON.parse(
    readFileSync(new URL(`../i18n/locales/know-your-rights/${locale}.json`, import.meta.url), 'utf8')
  ) as Messages
}

function leafPaths(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') return [prefix]
  if (Array.isArray(value)) return value.flatMap((item, index) => leafPaths(item, `${prefix}.${index}`))
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => leafPaths(item, prefix ? `${prefix}.${key}` : key))
  }
  return []
}

function messageAt(messages: Messages, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object') return undefined
    return (value as Record<string, unknown>)[key]
  }, messages)
}

describe('Know Your Rights content contract', () => {
  it('keeps the page family on the approved campaign routes', () => {
    expect(knowYourRightsBasePath).toBe('/campaigns/know-your-rights')
    expect(knowYourRightsGuides.map(({ path }) => path)).toEqual([
      '/campaigns/know-your-rights/ice-in-public',
      '/campaigns/know-your-rights/ice-pulls-you-over',
      '/campaigns/know-your-rights/ice-at-home',
      '/campaigns/know-your-rights/ice-at-work',
      '/campaigns/know-your-rights/documents-to-keep'
    ])
  })

  it('keeps every English family message translated in Spanish and Punjabi', () => {
    const messages = Object.fromEntries(localeCodes.map((locale) => [locale, localeMessages(locale)]))
    const requiredPaths = translatedNamespaces.flatMap((namespace) => {
      expect(messages.en).toHaveProperty(namespace)
      return leafPaths(messages.en[namespace], namespace)
    })

    expect(requiredPaths).toHaveLength(256)
    for (const locale of localeCodes) {
      for (const path of requiredPaths) {
        expect(messageAt(messages[locale], path), `${locale}:${path}`).toEqual(expect.any(String))
        expect((messageAt(messages[locale], path) as string).trim(), `${locale}:${path}`).not.toBe('')
      }
    }

    expect(messageAt(messages.es, 'kyr_ice_at_home.if_enters.invalid_warrant.list.1')).toEqual(expect.any(String))
  })

  it('keeps excluded historical service and volunteer namespaces out of the family', () => {
    for (const locale of localeCodes) {
      const messages = localeMessages(locale)
      const home = messages.kyr_home as Messages

      expect(Object.keys(home).sort()).toEqual(['buttons', 'disclaimer', 'hero', 'sections'])
      expect(Object.keys(home.buttons as Messages)).toEqual(['emergency'])
      expect(Object.keys(home.sections as Messages).sort()).toEqual(['rights_prep_intro', 'rights_prep_title'])
      expect(Object.keys(messages.kyr_nav as Messages)).toEqual(['section_label'])
      expect(messages).not.toHaveProperty('check_in_coverage')
      expect(messages).not.toHaveProperty('volunteer_guide')
    }
  })
})
