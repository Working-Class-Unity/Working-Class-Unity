<script setup lang="ts">
import { useSlots } from 'vue'
import {
  campaignCitationOccurrences,
  campaignSourcesForOccurrences,
  type CampaignCitationEntry,
  type CampaignCitationSlotMap,
  type CampaignPageContent
} from '~/content/remove-flock-stockton'

const props = defineProps<{
  content: CampaignPageContent
  slotCitations?: CampaignCitationSlotMap
  titleId: string
}>()

const slots = useSlots()
const articleSections = computed(() => props.content.sections.filter((section) => section.id !== 'sources'))
const outlineItems = computed(() => [
  ...articleSections.value.map((section) => ({ id: section.id, label: section.title })),
  { id: `${props.titleId}-source-register-title`, label: 'Sources and notes' }
])
const citationOccurrences = computed(() => [
  ...slotCitationOccurrences('after-header'),
  ...articleSections.value.flatMap((section) => {
    const slotName = `section-${section.id}`
    if (slots[slotName]) return slotCitationOccurrences(slotName)

    return [
      ...(section.paragraphs ?? []).flatMap((paragraph, paragraphIndex) =>
        campaignCitationOccurrences(paragraph, citationIdPrefix(section.id, 'paragraph', paragraphIndex))
      ),
      ...(section.points ?? []).flatMap((point, pointIndex) =>
        campaignCitationOccurrences(point, citationIdPrefix(section.id, 'point', pointIndex))
      ),
      ...(section.closingParagraphs ?? []).flatMap((paragraph, paragraphIndex) =>
        campaignCitationOccurrences(paragraph, citationIdPrefix(section.id, 'closing-paragraph', paragraphIndex))
      )
    ]
  })
])
const citedSources = computed(() => campaignSourcesForOccurrences(props.content.sources, citationOccurrences.value))

function citationIdPrefix(sectionId: string, kind: 'paragraph' | 'point' | 'closing-paragraph', index: number) {
  return `${props.titleId}-${sectionId}-${kind}-${index + 1}`
}

function slotCitationIdPrefix(entry: CampaignCitationEntry) {
  return `${props.titleId}-${entry.id}`
}

function slotCitationOccurrences(slotName: string) {
  return (props.slotCitations?.[slotName] ?? []).flatMap((entry) =>
    campaignCitationOccurrences(entry.content, slotCitationIdPrefix(entry))
  )
}
</script>

<template>
  <article class="campaign-article" :aria-labelledby="titleId">
    <CampaignEditorialHeader
      :title-id="titleId"
      :eyebrow="content.eyebrow"
      :title="content.title"
      :description="content.description"
      :qualification="content.qualification"
      :reviewed-through="content.reviewedThrough"
    >
      <slot
        name="after-header"
        :citation-occurrences="citationOccurrences"
        :citation-sources="citedSources"
        :source-note-id-prefix="titleId"
      />
    </CampaignEditorialHeader>

    <div class="campaign-article-layout">
      <CampaignPageOutline :items="outlineItems" :label="`${content.title} sections`" :show-markers="false" />

      <div class="campaign-article-body">
        <section
          v-for="section in articleSections"
          :id="section.id"
          :key="section.id"
          class="campaign-article-section"
          :aria-labelledby="`${section.id}-title`"
        >
          <div class="campaign-article-section-heading">
            <h2 :id="`${section.id}-title`">{{ section.title }}</h2>
            <p>{{ section.summary }}</p>
          </div>

          <slot
            :name="`section-${section.id}`"
            :citation-occurrences="citationOccurrences"
            :citation-sources="citedSources"
            :section="section"
            :source-note-id-prefix="titleId"
          >
            <div v-if="section.paragraphs?.length" class="campaign-article-prose">
              <div
                v-for="(paragraph, paragraphIndex) in section.paragraphs"
                :key="citationIdPrefix(section.id, 'paragraph', paragraphIndex)"
                class="campaign-cited-paragraph"
              >
                <p>
                  <CampaignCitedText
                    :citation-id-prefix="citationIdPrefix(section.id, 'paragraph', paragraphIndex)"
                    :content="paragraph"
                    :occurrences="citationOccurrences"
                    :source-note-id-prefix="titleId"
                    :sources="citedSources"
                  />
                </p>
              </div>
            </div>

            <component
              :is="section.orderedPoints ? 'ol' : 'ul'"
              v-if="section.points?.length"
              class="campaign-article-points"
              :class="{ 'campaign-article-points--ordered': section.orderedPoints }"
              role="list"
            >
              <li
                v-for="(point, pointIndex) in section.points"
                :key="citationIdPrefix(section.id, 'point', pointIndex)"
              >
                <p>
                  <CampaignCitedText
                    :citation-id-prefix="citationIdPrefix(section.id, 'point', pointIndex)"
                    :content="point"
                    :occurrences="citationOccurrences"
                    :source-note-id-prefix="titleId"
                    :sources="citedSources"
                  />
                </p>
              </li>
            </component>

            <div v-if="section.closingParagraphs?.length" class="campaign-article-prose">
              <div
                v-for="(paragraph, paragraphIndex) in section.closingParagraphs"
                :key="citationIdPrefix(section.id, 'closing-paragraph', paragraphIndex)"
                class="campaign-cited-paragraph"
              >
                <p>
                  <CampaignCitedText
                    :citation-id-prefix="citationIdPrefix(section.id, 'closing-paragraph', paragraphIndex)"
                    :content="paragraph"
                    :occurrences="citationOccurrences"
                    :source-note-id-prefix="titleId"
                    :sources="citedSources"
                  />
                </p>
              </div>
            </div>
          </slot>
        </section>
      </div>
    </div>

    <CampaignSourceNotes :citations="citationOccurrences" :id-prefix="titleId" :sources="citedSources" />
  </article>
</template>

<style scoped>
@layer components {
  .campaign-article {
    --article-divider: var(--color-divider-strong);

    min-width: 0;
    padding-block-end: clamp(4rem, 8vw, 7rem);
  }

  .campaign-article-section h2 {
    max-inline-size: 24ch;
    margin: 0;
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: clamp(2rem, 1.6rem + 1.5vw, 3.25rem);
    font-weight: 650;
    letter-spacing: -0.045em;
    line-height: 1.02;
    text-wrap: balance;
  }

  .campaign-article-layout {
    display: grid;
    grid-template-columns: minmax(13rem, 3fr) minmax(0, 9fr);
    gap: clamp(2.5rem, 7vw, 7rem);
    align-items: start;
  }

  .campaign-article-body {
    min-width: 0;
  }

  .campaign-article-section {
    display: grid;
    gap: clamp(2rem, 5vw, 4rem);
    scroll-margin-block-start: var(--space-5);
    border-block-end: var(--border-width) solid var(--article-divider);
    padding-block: clamp(4rem, 8vw, 7rem);
  }

  .campaign-article-section-heading {
    display: grid;
    gap: var(--space-4);
  }

  .campaign-article-section-heading > p:last-child {
    max-inline-size: 62ch;
    margin: 0;
    color: var(--color-text-muted);
    font-size: 1.125rem;
    line-height: 1.65;
    text-wrap: pretty;
  }

  .campaign-article-prose {
    display: grid;
    gap: var(--space-5);
  }

  .campaign-cited-paragraph {
    display: grid;
    gap: var(--space-2);
  }

  .campaign-cited-paragraph > p:first-child,
  .campaign-article-points > li > p:first-child {
    max-inline-size: 70ch;
    margin: 0;
    color: var(--color-text);
    font-size: 1rem;
    line-height: 1.8;
    text-wrap: pretty;
  }

  .campaign-article-points {
    display: grid;
    gap: 0;
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .campaign-article-points li {
    display: grid;
    gap: var(--space-2);
    border-block-start: var(--border-width) solid var(--article-divider);
    padding-block: var(--space-5);
  }

  .campaign-article-points--ordered {
    padding-inline-start: 2rem;
    list-style: decimal;
  }

  .campaign-article-points--ordered li {
    display: list-item;
    padding-inline-start: var(--space-2);
  }

  .campaign-article-points--ordered li::marker {
    color: var(--color-accent-action);
    font-weight: var(--font-weight-bold);
  }

  .campaign-article-points li:last-child {
    padding-block-end: 0;
  }

  @media (width <= 56rem) {
    .campaign-article-layout {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
    }
  }
}
</style>
