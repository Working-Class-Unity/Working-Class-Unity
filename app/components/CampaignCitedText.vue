<script setup lang="ts">
import {
  campaignCitationOccurrenceLabel,
  campaignCitationOccurrenceId,
  citedTextParts,
  type CampaignCitationOccurrence,
  type CampaignSource,
  type CitedText
} from '~/content/remove-flock-stockton'

const props = defineProps<{
  citationIdPrefix: string
  content: CitedText
  occurrences: readonly CampaignCitationOccurrence[]
  sourceNoteIdPrefix: string
  sources: readonly CampaignSource[]
}>()

const parts = computed(() => citedTextParts(props.content))
const sourceById = computed(() => new Map(props.sources.map((source) => [source.id, source])))
const sourceNumberById = computed(() => new Map(props.sources.map((source, index) => [source.id, index + 1])))

function sourceFor(sourceId: string) {
  const source = sourceById.value.get(sourceId)
  if (!source) throw new Error(`Unknown campaign source: ${sourceId}`)
  return source
}

function sourceNumberFor(sourceId: string) {
  const number = sourceNumberById.value.get(sourceId)
  if (!number) throw new Error(`Campaign source has no number: ${sourceId}`)
  return number
}

function citationId(partIndex: number, citationIndex: number) {
  return campaignCitationOccurrenceId(props.citationIdPrefix, partIndex, citationIndex)
}

function occurrenceLabel(sourceId: string, partIndex: number, citationIndex: number) {
  return campaignCitationOccurrenceLabel(
    sourceNumberFor(sourceId),
    { id: citationId(partIndex, citationIndex), sourceId },
    props.occurrences
  )
}
</script>

<template>
  <span class="campaign-cited-text">
    <template v-for="(part, partIndex) in parts" :key="partIndex">
      {{ part.text
      }}<span v-if="part.citations?.length" class="campaign-citation-cluster">
        <CampaignCitation
          v-for="(citation, citationIndex) in part.citations"
          :key="`${citation.sourceId}-${citationIndex}`"
          :citation-id="citationId(partIndex, citationIndex)"
          :number="sourceNumberFor(citation.sourceId)"
          :note-id="`${sourceNoteIdPrefix}-note-${citation.sourceId}`"
          :occurrence-label="occurrenceLabel(citation.sourceId, partIndex, citationIndex)"
          :reference="citation"
          :source="sourceFor(citation.sourceId)"
        />
      </span>
    </template>
  </span>
</template>

<style scoped>
@layer components {
  .campaign-cited-text {
    display: inline;
  }

  .campaign-citation-cluster {
    white-space: nowrap;
  }

  @media (width <= 56rem), (pointer: coarse) {
    .campaign-citation-cluster {
      --citation-visual-size: 1.35rem;
      --citation-touch-size: 3rem;
      --citation-target-gap: 1.65rem;
      --citation-target-gutter: 0.825rem;

      display: inline-flex;
      gap: var(--citation-target-gap);
      align-items: center;
      min-block-size: var(--citation-touch-size);
      padding-inline: var(--citation-target-gutter);
      vertical-align: middle;
    }
  }
}
</style>
