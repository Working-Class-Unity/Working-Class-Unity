import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  campaignCitationOccurrenceLabel,
  campaignCitationOccurrences,
  campaignSourcesForOccurrences,
  citedTextParts,
  citedTextPlainText
} from '../app/content/remove-flock-stockton/citations.ts'
import { petitionDemand, petitionDemandCanonicalText } from '../app/content/remove-flock-stockton/petition.ts'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const contentRoot = resolve(repositoryRoot, 'app/content/remove-flock-stockton')

const publicContentFiles = ['faq.ts', 'landing.ts', 'what-stockton-bought.ts', 'why-safeguards.ts']

async function readContentFile(fileName) {
  return readFile(resolve(contentRoot, fileName), 'utf8')
}

test('petition demand matches the approved copy byte for byte', () => {
  const approvedPetitionSha256 = 'f9d2bc4599d39ff3d55f335cfa6a282e977956a6ee1035a63d1466aeeaf8590a'
  const actualSha256 = createHash('sha256').update(petitionDemandCanonicalText).digest('hex')

  assert.equal(actualSha256, approvedPetitionSha256)
  assert.equal(petitionDemand.demands.length, 5)
})

test('public claims retain the campaign qualifications', async () => {
  const [faq, whatStocktonBought, whySafeguards] = await Promise.all([
    readContentFile('faq.ts'),
    readContentFile('what-stockton-bought.ts'),
    readContentFile('why-safeguards.ts')
  ])

  assert.match(faq, /Right now, we are not claiming that Stockton has shared Flock data with ICE\./)
  assert.match(faq, /We have not shared any information related to immigration with our federal partners/)
  assert.match(faq, /A listed recipient is a sharing configuration, not proof of an actual search or disclosure\./)
  assert.match(faq, /it does not prove UOP accessed data\./)
  assert.match(faq, /Some grant funds may be restricted\./)
  assert.match(faq, /We will not promise that every Flock dollar can move directly to another program\./)

  assert.match(whatStocktonBought, /Right now, we are not claiming that every contracted product is deployed/)
  assert.match(whatStocktonBought, /They do not show that Stockton conducted searches or shared data at that scale\./)
  assert.match(whatStocktonBought, /Right now, we are not claiming any of the following:/)
  assert.match(whatStocktonBought, /Stockton shared data with ICE or any other federal immigration agency\./)
  assert.match(whatStocktonBought, /Flock’s public Stockton portal reported 147 cameras on August 8, 2026/)
  assert.match(
    whatStocktonBought,
    /A listed recipient is a sharing configuration, not proof of a search or disclosure\./
  )
  assert.match(
    whatStocktonBought,
    /The available records do not establish whether the competitive-bidding exception was lawful or unlawful\./
  )

  assert.match(whySafeguards, /We support firm interim protections\./)
  assert.match(whySafeguards, /Written policy and actual platform access did not always match\./)
  assert.match(whySafeguards, /An agency listed as a recipient and a search-reason label do not prove that ICE/)
})

test('campaign source links are clean and unique', async () => {
  const sourceModule = await readContentFile('sources.ts')
  const urls = [...sourceModule.matchAll(/\burl:\s*'([^']+)'/g)].map((match) => match[1])
  const trackingParameters = /^(?:fbclid|gclid|mc_cid|mc_eid|utm_.+)$/i

  assert.ok(urls.length > 20, 'expected the campaign source register')
  assert.equal(new Set(urls).size, urls.length, 'source URLs must not be duplicated')

  for (const sourceUrl of urls) {
    const url = new URL(sourceUrl)

    assert.equal(url.protocol, 'https:', `${sourceUrl} must use HTTPS`)
    assert.equal(url.username, '', `${sourceUrl} must not contain a username`)
    assert.equal(url.password, '', `${sourceUrl} must not contain a password`)

    for (const parameter of url.searchParams.keys()) {
      assert.doesNotMatch(parameter, trackingParameters, `${sourceUrl} contains a tracking parameter`)
    }
  }
})

test('campaign citation references resolve to unique source records', async () => {
  const [sourceModule, ...contentModules] = await Promise.all([
    readContentFile('sources.ts'),
    ...publicContentFiles.map(readContentFile)
  ])
  const sourceIds = [...sourceModule.matchAll(/\bid:\s*'([^']+)'/g)].map((match) => match[1])
  const content = contentModules.join('\n')
  const legacyReferenceIds = [...content.matchAll(/\bsourceIds:\s*\[([\s\S]*?)\]/g)].flatMap((match) =>
    [...match[1].matchAll(/'([^']+)'/g)].map((sourceMatch) => sourceMatch[1])
  )
  const claimReferenceIds = [...content.matchAll(/\bsourceId:\s*'([^']+)'/g)].map((match) => match[1])
  const claimLocators = [...content.matchAll(/\blocator:\s*'([^']+)'/g)].map((match) => match[1])
  const knownSourceIds = new Set(sourceIds)

  assert.ok(sourceIds.length > 40, 'expected the complete campaign source inventory')
  assert.equal(knownSourceIds.size, sourceIds.length, 'campaign source IDs must be unique')
  assert.ok(legacyReferenceIds.length + claimReferenceIds.length > 80, 'expected the campaign citation inventory')
  assert.ok(claimLocators.length > 0, 'expected at least one production claim locator')

  for (const locator of claimLocators) {
    assert.equal(locator, locator.trim(), 'campaign locators must not contain outer whitespace')
    assert.ok(locator.length >= 5, 'campaign locators must identify a useful page or section')
  }

  for (const sourceId of [...legacyReferenceIds, ...claimReferenceIds]) {
    assert.ok(knownSourceIds.has(sourceId), `campaign content references unknown source ${sourceId}`)
  }
})

test('claim-level citations preserve prose and create stable source occurrences', () => {
  const citedText = {
    parts: [
      { text: 'First claim.', citations: [{ sourceId: 'first-source', locator: 'p. 14' }] },
      { text: ' Second claim.', citations: [{ sourceId: 'second-source' }] }
    ]
  }
  const occurrences = campaignCitationOccurrences(citedText, 'faq-basics-what-is-flock-answer-1')
  const sources = [
    { id: 'second-source', publisher: 'Second publisher', title: 'Second source', url: 'https://example.com/2' },
    { id: 'first-source', publisher: 'First publisher', title: 'First source', url: 'https://example.com/1' }
  ]

  assert.equal(citedTextPlainText(citedText), 'First claim. Second claim.')
  assert.equal(citedTextParts(citedText)[0].citations[0].locator, 'p. 14')
  assert.deepEqual(
    occurrences.map((occurrence) => occurrence.id),
    ['faq-basics-what-is-flock-answer-1-citation-1-1', 'faq-basics-what-is-flock-answer-1-citation-2-1']
  )
  assert.deepEqual(
    campaignSourcesForOccurrences(sources, occurrences).map((source) => source.id),
    ['first-source', 'second-source']
  )
  const repeatedOccurrences = [
    { id: 'citation-1', sourceId: 'first-source' },
    { id: 'citation-2', sourceId: 'first-source' },
    { id: 'citation-3', sourceId: 'second-source' }
  ]

  assert.equal(campaignCitationOccurrenceLabel(1, repeatedOccurrences[0], repeatedOccurrences), '1.1')
  assert.equal(campaignCitationOccurrenceLabel(1, repeatedOccurrences[1], repeatedOccurrences), '1.2')
  assert.equal(campaignCitationOccurrenceLabel(2, repeatedOccurrences[2], repeatedOccurrences), '2')
  assert.throws(
    () => campaignCitationOccurrenceLabel(1, { id: 'missing-citation', sourceId: 'first-source' }, repeatedOccurrences),
    /Unknown campaign citation occurrence: missing-citation/
  )
  assert.throws(
    () => campaignSourcesForOccurrences(sources, [{ id: 'missing-citation', sourceId: 'missing-source' }]),
    /Unknown campaign source: missing-source/
  )
})

test('campaign prose avoids the writing SOP banned terms outside approved copy', async () => {
  const publicContent = (await Promise.all(publicContentFiles.map(readContentFile))).join('\n').toLowerCase()
  const content = publicContent
  const bannedTerms = [
    'firstly',
    'moreover',
    'furthermore',
    'however',
    'therefore',
    'additionally',
    'specifically',
    'generally',
    'consequently',
    'importantly',
    'similarly',
    'nonetheless',
    'as a result',
    'indeed',
    'thus',
    'alternatively',
    'notably',
    'as well as',
    'despite',
    'essentially',
    'while',
    'unless',
    'also',
    'even though',
    'because',
    'in contrast',
    'although',
    'in order to',
    'due to',
    'even if',
    'given that',
    'arguably',
    'to consider',
    'ensure',
    'vibrant',
    'bustling',
    'essential',
    'vital',
    'out of the box',
    'underscores',
    'landscape',
    'tapestry',
    'soul',
    'crucible',
    'it depends on',
    'that being said',
    'you may want to',
    "it's important to note",
    'this is not an exhaustive list',
    'you could consider',
    'in summary',
    'on the other hand',
    'as previously mentioned',
    "it's worth noting that",
    'in conclusion',
    'to summarize',
    'ultimately',
    'to put it simply',
    'pesky',
    'promptly',
    'dive into',
    "in today's digital era",
    'reverberate',
    'enhance',
    'emphasise',
    'enable',
    'delve',
    'hustle and bustle',
    'revolutionize',
    'folks',
    'foster',
    'sure',
    'labyrinthine',
    'moist',
    'remnant',
    'as a professional',
    'subsequently',
    'nested',
    'game changer',
    'symphony',
    'labyrinth',
    'gossamer',
    'enigma',
    'whispering',
    'sights unseen',
    'sounds unheard',
    'a testament to',
    'dance',
    'metamorphosis',
    'indelible',
    'intricate',
    'commendable',
    'meticulous',
    'notable',
    'pivotal',
    'invaluable',
    'noteworthy',
    'meticulously',
    'methodically',
    'innovatively',
    'innovative',
    'versatile',
    'strategically',
    'groundbreaking',
    'outwith',
    'delving into',
    'spearheading',
    'unwavering commitment',
    'adept at'
  ]

  for (const term of bannedTerms) {
    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const termPattern = new RegExp(`(?:^|[^a-z])${escapedTerm}(?=$|[^a-z])`, 'i')

    assert.doesNotMatch(content, termPattern, `campaign prose contains banned term: ${term}`)
  }
})
