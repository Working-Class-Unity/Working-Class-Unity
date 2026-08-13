import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { petitionDemand, petitionDemandCanonicalText } from '../app/content/remove-flock-stockton/petition.ts'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const contentRoot = resolve(repositoryRoot, 'app/content/remove-flock-stockton')

const publicContentFiles = ['faq.ts', 'landing.ts', 'what-stockton-bought.ts', 'why-safeguards.ts']

async function readContentFile(fileName) {
  return readFile(resolve(contentRoot, fileName), 'utf8')
}

test('petition demand matches the approved copy byte for byte', () => {
  const approvedPetitionSha256 = '9938db255e81bd3c205b2de13ea810e3c05c0eb375441fad4cdb1fe3b2ecf4b9'
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

  assert.match(faq, /WCU is not claiming that Stockton has shared Flock data with ICE\./)
  assert.match(faq, /We have not shared any information related to immigration with our federal partners/)
  assert.match(faq, /A listed recipient is a sharing configuration, not proof of an actual search or disclosure\./)
  assert.match(faq, /it does not prove UOP accessed data\./)
  assert.match(faq, /Some grant funds may be restricted\./)
  assert.match(faq, /WCU will not promise that every Flock dollar can move directly to another program\./)

  assert.match(whatStocktonBought, /They do not establish that every contracted product has been deployed/)
  assert.match(whatStocktonBought, /They are not evidence of Stockton searches or sharing events\./)
  assert.match(whatStocktonBought, /does not prove that Stockton shared data with ICE/)
  assert.match(whatStocktonBought, /Flock’s public Stockton portal reported 147 cameras on August 8, 2026/)
  assert.match(
    whatStocktonBought,
    /A listed recipient is a sharing configuration, not proof of a search or disclosure\./
  )
  assert.match(whatStocktonBought, /does not establish that the competitive-bidding exception was unlawful/)

  assert.match(whySafeguards, /Interim protection is not the same as dismantling the system\./)
  assert.match(whySafeguards, /Written policy and actual platform access did not always match\./)
  assert.match(whySafeguards, /A configured recipient and a search-reason label do not prove that ICE/)
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

test('campaign prose avoids the writing SOP banned terms', async () => {
  const content = (await Promise.all(publicContentFiles.map(readContentFile))).join('\n').toLowerCase()
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
