import type { CampaignCitationReference, CampaignSource, CitedText, CitedTextPart } from './types'

export type CampaignCitationOccurrence = Readonly<
  CampaignCitationReference & {
    id: string
  }
>

export function citedTextParts(content: CitedText): readonly CitedTextPart[] {
  if (content.parts) return content.parts

  return [
    {
      text: content.text,
      citations: content.sourceIds?.map((sourceId) => ({ sourceId }))
    }
  ]
}

export function citedTextPlainText(content: CitedText) {
  return citedTextParts(content)
    .map((part) => part.text)
    .join('')
}

export function campaignCitationOccurrenceId(prefix: string, partIndex: number, citationIndex: number) {
  return `${prefix}-citation-${partIndex + 1}-${citationIndex + 1}`
}

export function campaignCitationOccurrences(content: CitedText, prefix: string): readonly CampaignCitationOccurrence[] {
  return citedTextParts(content).flatMap((part, partIndex) =>
    (part.citations ?? []).map((citation, citationIndex) => ({
      ...citation,
      id: campaignCitationOccurrenceId(prefix, partIndex, citationIndex)
    }))
  )
}

export function campaignCitationOccurrenceLabel(
  sourceNumber: number,
  occurrence: Pick<CampaignCitationOccurrence, 'id' | 'sourceId'>,
  occurrences: readonly CampaignCitationOccurrence[]
) {
  const sourceOccurrences = occurrences.filter((candidate) => candidate.sourceId === occurrence.sourceId)
  const occurrenceIndex = sourceOccurrences.findIndex((candidate) => candidate.id === occurrence.id)

  if (occurrenceIndex === -1) throw new Error(`Unknown campaign citation occurrence: ${occurrence.id}`)

  return sourceOccurrences.length === 1 ? String(sourceNumber) : `${sourceNumber}.${occurrenceIndex + 1}`
}

export function campaignSourcesForOccurrences(
  sources: readonly CampaignSource[],
  occurrences: readonly CampaignCitationOccurrence[]
): readonly CampaignSource[] {
  const sourceById = new Map(sources.map((source) => [source.id, source]))
  const includedSourceIds = new Set<string>()

  return occurrences.flatMap((occurrence) => {
    if (includedSourceIds.has(occurrence.sourceId)) return []

    const source = sourceById.get(occurrence.sourceId)
    if (!source) throw new Error(`Unknown campaign source: ${occurrence.sourceId}`)

    includedSourceIds.add(occurrence.sourceId)
    return [source]
  })
}
