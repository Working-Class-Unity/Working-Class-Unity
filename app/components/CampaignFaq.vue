<script setup lang="ts">
import {
  campaignCitationOccurrences,
  campaignFaqPage,
  campaignSourcesForOccurrences,
  faqGroups as campaignFaqGroups,
  type CampaignFaqGroup,
  type CampaignSource
} from '~/content/remove-flock-stockton'

const faqGroups: readonly CampaignFaqGroup[] = campaignFaqGroups
const faqSources: readonly CampaignSource[] = campaignFaqPage.sources
const outlineItems = faqGroups.map((group) => ({ id: group.id, label: group.title }))
const citationOccurrences = faqGroups.flatMap((group) =>
  group.items.flatMap((item) => [
    ...item.answer.flatMap((paragraph, paragraphIndex) =>
      campaignCitationOccurrences(paragraph, citationIdPrefix(group.id, item.id, 'answer', paragraphIndex))
    ),
    ...(item.points ?? []).flatMap((point, pointIndex) =>
      campaignCitationOccurrences(point, citationIdPrefix(group.id, item.id, 'point', pointIndex))
    )
  ])
)
const citedSources = campaignSourcesForOccurrences(faqSources, citationOccurrences)

function citationIdPrefix(groupId: string, itemId: string, kind: 'answer' | 'point', index: number) {
  return `stockton-flock-faq-title-${groupId}-${itemId}-${kind}-${index + 1}`
}
</script>

<template>
  <article class="campaign-faq" aria-labelledby="stockton-flock-faq-title">
    <CampaignEditorialHeader
      title-id="stockton-flock-faq-title"
      :eyebrow="campaignFaqPage.eyebrow"
      :title="campaignFaqPage.title"
      :description="campaignFaqPage.description"
      :qualification="campaignFaqPage.qualification"
      :reviewed-through="campaignFaqPage.reviewedThrough"
    />

    <div class="campaign-faq-layout">
      <CampaignPageOutline :items="outlineItems" label="FAQ groups" />

      <div class="campaign-faq-groups">
        <section
          v-for="(group, groupIndex) in faqGroups"
          :id="group.id"
          :key="group.id"
          class="campaign-faq-group"
          :aria-labelledby="`${group.id}-title`"
        >
          <div class="campaign-faq-group-heading">
            <p>{{ String(groupIndex + 1).padStart(2, '0') }}</p>
            <h2 :id="`${group.id}-title`">{{ group.title }}</h2>
            <p>{{ group.summary }}</p>
          </div>

          <div class="campaign-faq-items">
            <details v-for="item in group.items" :key="item.id" :name="`faq-${group.id}`">
              <summary>{{ item.question }}</summary>
              <div class="campaign-faq-answer">
                <div
                  v-for="(paragraph, paragraphIndex) in item.answer"
                  :key="citationIdPrefix(group.id, item.id, 'answer', paragraphIndex)"
                  class="campaign-faq-paragraph"
                >
                  <p>
                    <CampaignCitedText
                      :citation-id-prefix="citationIdPrefix(group.id, item.id, 'answer', paragraphIndex)"
                      :content="paragraph"
                      :occurrences="citationOccurrences"
                      source-note-id-prefix="stockton-flock-faq-title"
                      :sources="citedSources"
                    />
                  </p>
                </div>
                <ol v-if="item.points?.length" role="list">
                  <li
                    v-for="(point, pointIndex) in item.points"
                    :key="citationIdPrefix(group.id, item.id, 'point', pointIndex)"
                  >
                    <CampaignCitedText
                      :citation-id-prefix="citationIdPrefix(group.id, item.id, 'point', pointIndex)"
                      :content="point"
                      :occurrences="citationOccurrences"
                      source-note-id-prefix="stockton-flock-faq-title"
                      :sources="citedSources"
                    />
                  </li>
                </ol>
              </div>
            </details>
          </div>
        </section>
      </div>
    </div>

    <CampaignSourceNotes
      :citations="citationOccurrences"
      id-prefix="stockton-flock-faq-title"
      :sources="citedSources"
    />
  </article>
</template>

<style scoped>
/* stylelint-disable no-descending-specificity -- FAQ index and answer links intentionally share element-level rules. */
@layer components {
  .campaign-faq {
    --faq-divider: var(--color-divider-strong);

    min-width: 0;
    padding-block-end: clamp(4rem, 8vw, 7rem);
  }

  .campaign-faq-group-heading > p:first-child {
    margin: 0;
    color: var(--color-accent-action);
    font-family: var(--font-family-mono);
    font-size: 0.8125rem;
    font-weight: var(--font-weight-strong);
    letter-spacing: 0.08em;
  }

  .campaign-faq h2 {
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

  .campaign-faq-layout {
    display: grid;
    grid-template-columns: minmax(13rem, 3fr) minmax(0, 9fr);
    gap: clamp(2.5rem, 7vw, 7rem);
    align-items: start;
  }

  .campaign-faq-group {
    display: grid;
    gap: clamp(2rem, 5vw, 4rem);
    scroll-margin-block-start: var(--space-5);
    border-block-end: var(--border-width) solid var(--faq-divider);
    padding-block: clamp(4rem, 8vw, 7rem);
  }

  .campaign-faq-group-heading {
    display: grid;
    gap: var(--space-4);
  }

  .campaign-faq-group-heading > p:last-child {
    max-inline-size: 62ch;
    margin: 0;
    color: var(--color-text-muted);
    font-size: 1.125rem;
    line-height: 1.65;
    text-wrap: pretty;
  }

  .campaign-faq-items {
    border-block-start: var(--border-width) solid var(--faq-divider);
  }

  .campaign-faq details {
    border-block-end: var(--border-width) solid var(--faq-divider);
  }

  .campaign-faq summary {
    position: relative;
    padding: var(--space-5) 3rem var(--space-5) 0;
    color: var(--color-brand-primary);
    font-size: 1.125rem;
    font-weight: var(--font-weight-strong);
    cursor: pointer;
    list-style: none;
  }

  .campaign-faq summary::-webkit-details-marker {
    display: none;
  }

  .campaign-faq summary::after {
    position: absolute;
    inset-block-start: 50%;
    inset-inline-end: var(--space-2);
    color: var(--color-accent-action);
    font-family: var(--font-family-mono);
    font-size: 1.5rem;
    content: '+';
    transform: translateY(-50%);
  }

  .campaign-faq details[open] summary::after {
    content: '−';
  }

  .campaign-faq summary:hover,
  .campaign-faq summary:focus-visible {
    color: var(--color-accent-action);
  }

  .campaign-faq summary:focus-visible {
    outline: var(--focus-outline);
    outline-offset: var(--focus-offset);
  }

  .campaign-faq-answer {
    display: grid;
    gap: var(--space-5);
    padding-block: 0 var(--space-6);
  }

  .campaign-faq-paragraph {
    display: grid;
    gap: var(--space-2);
  }

  .campaign-faq-answer p,
  .campaign-faq-answer ol {
    max-inline-size: 70ch;
    margin: 0;
    color: var(--color-text);
    line-height: 1.8;
    text-wrap: pretty;
  }

  .campaign-faq-answer ol {
    display: grid;
    gap: var(--space-4);
    padding-inline-start: 1.5rem;
  }

  @media (width <= 56rem) {
    .campaign-faq-layout {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
    }
  }

  @media (width <= 40rem) {
    .campaign-faq-group-heading > p:first-child {
      font-size: 1rem;
    }
  }
}
</style>
