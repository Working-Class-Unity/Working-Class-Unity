<script setup lang="ts">
import { campaignFaqPage, faqGroups as campaignFaqGroups } from '~/content/remove-flock-stockton'
import type { CampaignFaqGroup, CampaignSource } from '~/content/remove-flock-stockton'

const faqGroups: readonly CampaignFaqGroup[] = campaignFaqGroups
const faqSources: readonly CampaignSource[] = campaignFaqPage.sources
const sourceById = new Map(faqSources.map((source) => [source.id, source]))
const sourceNumberById = new Map(faqSources.map((source, index) => [source.id, index + 1]))
const outlineItems = faqGroups.map((group) => ({ id: group.id, label: group.title }))

function sourcesFor(sourceIds: readonly string[] | undefined) {
  return (sourceIds ?? []).map((id) => sourceById.get(id)).filter((source) => source !== undefined)
}

function noteId(sourceId: string) {
  return `stockton-flock-faq-title-note-${sourceId}`
}
</script>

<template>
  <article class="campaign-faq" aria-labelledby="stockton-flock-faq-title">
    <header class="campaign-faq-header">
      <p class="campaign-faq-eyebrow">{{ campaignFaqPage.eyebrow }}</p>
      <h1 id="stockton-flock-faq-title">{{ campaignFaqPage.title }}</h1>
      <p class="campaign-faq-description">{{ campaignFaqPage.description }}</p>
      <p class="campaign-faq-qualification">{{ campaignFaqPage.qualification }}</p>
      <p v-if="campaignFaqPage.reviewedThrough" class="campaign-faq-reviewed">
        Last materially updated: {{ campaignFaqPage.reviewedThrough }}.
      </p>
    </header>

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
                <div v-for="paragraph in item.answer" :key="paragraph.text" class="campaign-faq-paragraph">
                  <p>
                    {{ paragraph.text }}
                    <CampaignCitation
                      v-for="source in sourcesFor(paragraph.sourceIds)"
                      :key="source.id"
                      :number="sourceNumberById.get(source.id)!"
                      :note-id="noteId(source.id)"
                      :source="source"
                    />
                  </p>
                </div>
                <ol v-if="item.points?.length">
                  <li v-for="point in item.points" :key="point.text">
                    {{ point.text }}
                    <CampaignCitation
                      v-for="source in sourcesFor(point.sourceIds)"
                      :key="source.id"
                      :number="sourceNumberById.get(source.id)!"
                      :note-id="noteId(source.id)"
                      :source="source"
                    />
                  </li>
                </ol>
              </div>
            </details>
          </div>
        </section>
      </div>
    </div>

    <CampaignSourceNotes id-prefix="stockton-flock-faq-title" :sources="faqSources" />
  </article>
</template>

<style scoped>
/* stylelint-disable no-descending-specificity -- FAQ index and answer links intentionally share element-level rules. */
@layer components {
  .campaign-faq {
    --faq-divider: rgb(4 51 79 / 18%);

    min-width: 0;
    padding-block-end: clamp(4rem, 8vw, 7rem);
  }

  .campaign-faq-header {
    display: grid;
    justify-items: start;
    gap: var(--space-5);
    border-block-end: var(--border-width) solid var(--faq-divider);
    padding-block: clamp(4rem, 9vw, 8rem);
  }

  .campaign-faq-eyebrow,
  .campaign-faq-group-heading > p:first-child {
    margin: 0;
    color: var(--color-accent-action);
    font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
    font-size: 0.8125rem;
    font-weight: var(--font-weight-strong);
    letter-spacing: 0.08em;
  }

  .campaign-faq h1,
  .campaign-faq h2 {
    margin: 0;
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-weight: 650;
    letter-spacing: -0.045em;
    text-wrap: balance;
  }

  .campaign-faq h1 {
    max-inline-size: 18ch;
    font-size: clamp(3rem, 2.1rem + 3.5vw, 6rem);
    line-height: 0.98;
  }

  .campaign-faq-description {
    max-inline-size: 62ch;
    margin: 0;
    color: var(--color-text);
    font-size: clamp(1.25rem, 1.1rem + 0.45vw, 1.5rem);
    line-height: 1.55;
    text-wrap: pretty;
  }

  .campaign-faq-qualification {
    max-inline-size: 72ch;
    margin: var(--space-2) 0 0;
    border-inline-start: var(--border-width-accent) solid var(--color-brand-highlight);
    padding-inline-start: var(--space-4);
    color: var(--color-text-muted);
    line-height: 1.75;
    text-wrap: pretty;
  }

  .campaign-faq-reviewed {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 0.875rem;
    font-weight: var(--font-weight-strong);
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

  .campaign-faq h2 {
    max-inline-size: 24ch;
    font-size: clamp(2rem, 1.6rem + 1.5vw, 3.25rem);
    line-height: 1.02;
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
    font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
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
    .campaign-faq h1 {
      font-size: clamp(2.75rem, 14vw, 4.25rem);
    }

    .campaign-faq-eyebrow,
    .campaign-faq-group-heading > p:first-child {
      font-size: 1rem;
    }
  }
}
</style>
