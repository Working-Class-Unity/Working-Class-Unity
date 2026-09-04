import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bylawsArticles } from '../app/content/bylaws'
import {
  campaignFacts,
  campaignFaqPage,
  campaignLandingPage,
  faqGroups,
  petitionDemand,
  stocktonContractFacts,
  stocktonCostStack,
  stocktonTimeline,
  whatStocktonBoughtPage,
  whySafeguardsPage
} from '../app/content/remove-flock-stockton'

const localeCodes = ['en', 'es', 'pa'] as const
const translatedContentLocales = ['es', 'pa'] as const
const translatableContentKeys = new Set([
  'action',
  'amount',
  'answer',
  'blocks',
  'citations',
  'closingParagraphs',
  'date',
  'demands',
  'description',
  'detail',
  'eyebrow',
  'introduction',
  'items',
  'label',
  'leadIn',
  'note',
  'paragraphs',
  'parts',
  'points',
  'qualification',
  'question',
  'reviewedThrough',
  'sections',
  'sources',
  'summary',
  'text',
  'title',
  'unavailableLabel',
  'value'
])
const structuralContentKeys = new Set([
  'href',
  'id',
  'kind',
  'locator',
  'number',
  'path',
  'publisher',
  'sourceId',
  'sourceIds',
  'sourceType',
  'status',
  'url'
])

type Messages = Record<string, unknown>

function readJson(path: URL): Messages {
  return JSON.parse(readFileSync(path, 'utf8')) as Messages
}

function rootMessages(locale: (typeof localeCodes)[number]): Messages {
  return readJson(new URL(`../i18n/locales/${locale}.json`, import.meta.url))
}

function contentMessages(feature: 'bylaws' | 'remove-flock', locale: 'es' | 'pa'): Messages {
  return readJson(new URL(`../i18n/locales/content/${feature}/${locale}.json`, import.meta.url))
}

function valueShape(value: unknown, prefix = '$'): string[] {
  if (Array.isArray(value)) {
    return [`${prefix}:array`, ...value.flatMap((item, index) => valueShape(item, `${prefix}.${index}`))]
  }
  if (value && typeof value === 'object') {
    return [`${prefix}:object`, ...Object.entries(value).flatMap(([key, item]) => valueShape(item, `${prefix}.${key}`))]
  }
  return [`${prefix}:${value === null ? 'null' : typeof value}`]
}

function stringEntries(value: unknown, prefix = '$'): Array<readonly [string, string]> {
  if (typeof value === 'string') return [[prefix, value]]
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => stringEntries(item, `${prefix}.${index}`))
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => stringEntries(item, `${prefix}.${key}`))
  }
  return []
}

function interpolationTokens(message: string): string[] {
  return [...message.matchAll(/\{[^{}]+\}/g)].map(([token]) => token).sort()
}

function extractTranslatableContent(value: unknown, parentKey = ''): unknown {
  if (typeof value === 'string') return translatableContentKeys.has(parentKey) && value.trim() ? value : undefined
  if (Array.isArray(value)) {
    if (parentKey && !translatableContentKeys.has(parentKey)) return undefined
    return value.map((item) => extractTranslatableContent(item, parentKey) ?? {})
  }
  if (!value || typeof value !== 'object') return undefined

  const record = value as Record<string, unknown>
  if (typeof record.url === 'string' && typeof record.publisher === 'string') {
    return Object.fromEntries(
      ['published', 'reviewed', 'note']
        .filter((key) => typeof record[key] === 'string')
        .map((key) => [key, record[key]])
    )
  }

  return Object.fromEntries(
    Object.entries(record)
      .map(([key, item]) => [key, extractTranslatableContent(item, key)] as const)
      .filter(([, item]) => item !== undefined)
  )
}

function expectCompleteTranslation(expected: unknown, actual: unknown, label: string) {
  expect(valueShape(actual), `${label} structure`).toEqual(valueShape(expected))
  for (const [path, message] of stringEntries(actual)) {
    expect(message.trim(), `${label}:${path}`).not.toBe('')
  }
}

function contentKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(contentKeys)
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, item]) => [key, ...contentKeys(item)])
}

const expectedBylaws = {
  localizedBylaws: {
    articles: extractTranslatableContent(bylawsArticles)
  }
}
const expectedRemoveFlock = {
  localizedRemoveFlock: {
    campaignFacts: extractTranslatableContent(campaignFacts),
    campaignFaqPage: extractTranslatableContent(campaignFaqPage),
    campaignLandingPage: extractTranslatableContent(campaignLandingPage),
    faqGroups: extractTranslatableContent(faqGroups),
    petitionDemand: extractTranslatableContent(petitionDemand),
    stocktonContractFacts: extractTranslatableContent(stocktonContractFacts),
    stocktonCostStack: extractTranslatableContent(stocktonCostStack),
    stocktonTimeline: extractTranslatableContent(stocktonTimeline),
    whatStocktonBoughtPage: extractTranslatableContent(whatStocktonBoughtPage),
    whySafeguardsPage: extractTranslatableContent(whySafeguardsPage)
  }
}

describe('site localization contract', () => {
  it('keeps every shared interface message complete across supported locales', () => {
    const english = rootMessages('en')
    const englishStrings = new Map(stringEntries(english))

    for (const locale of localeCodes) {
      const messages = rootMessages(locale)
      expectCompleteTranslation(english, messages, locale)

      for (const [path, message] of stringEntries(messages)) {
        expect(interpolationTokens(message), `${locale}:${path} interpolation`).toEqual(
          interpolationTokens(englishStrings.get(path) ?? '')
        )
      }
    }
  })

  it('keeps the long-form translations complete without translating stable structure', () => {
    for (const locale of translatedContentLocales) {
      const bylaws = contentMessages('bylaws', locale)
      const removeFlock = contentMessages('remove-flock', locale)

      expectCompleteTranslation(expectedBylaws, bylaws, `${locale}:bylaws`)
      expectCompleteTranslation(expectedRemoveFlock, removeFlock, `${locale}:remove-flock`)

      for (const key of [...contentKeys(bylaws), ...contentKeys(removeFlock)]) {
        expect(structuralContentKeys.has(key), `${locale}:unexpected structural key ${key}`).toBe(false)
      }
    }
  })
})
