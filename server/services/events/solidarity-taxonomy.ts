export const solidarityAudienceTags = ['audience-members', 'audience-public'] as const

export const solidarityCategoryTags = [
  'category-action',
  'category-learning',
  'category-meeting',
  'category-social'
] as const

export const solidarityMeetingTags = ['meeting-general', 'meeting-steering'] as const

const eventTags = new Set<string>([...solidarityAudienceTags, ...solidarityCategoryTags, ...solidarityMeetingTags])
const campaignTagPattern = /^(?:focus|sidequest)-[a-z0-9]+(?:-[a-z0-9]+)*$/

export function normalizeSolidarityTaxonomyTags(
  sourceEventTags: readonly string[],
  sourceCampaignTags: readonly string[]
): Readonly<{ campaignTags: readonly string[]; eventTags: readonly string[] }> {
  const normalizedEventTags: string[] = []
  const normalizedCampaignTags: string[] = []

  for (const sourceTag of sourceEventTags) {
    const tag = sourceTag.trim()
    if (eventTags.has(tag)) normalizedEventTags.push(tag)
    else throw new TypeError(`Solidarity event tag is not governed: ${tag}`)
  }

  for (const sourceTag of sourceCampaignTags) {
    const tag = sourceTag.trim()
    if (!campaignTagPattern.test(tag)) {
      throw new TypeError(`Solidarity campaign tag does not follow the governed naming convention: ${tag}`)
    }
    normalizedCampaignTags.push(tag)
  }

  return Object.freeze({
    campaignTags: Object.freeze([...new Set(normalizedCampaignTags)].sort()),
    eventTags: Object.freeze([...new Set(normalizedEventTags)].sort())
  })
}
