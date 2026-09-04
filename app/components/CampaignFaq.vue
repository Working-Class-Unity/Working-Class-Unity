<script setup lang="ts">
import { campaignCitationOccurrences, campaignSourcesForOccurrences } from '~/content/remove-flock-stockton'

const { t } = useI18n()
const { campaignFaqPage, faqGroups } = useRemoveFlockContent()
const petitionUrl = 'https://tech.workingclassunity.com/deflock-stockton'
const outlineItems = computed(() => faqGroups.value.map((group) => ({ id: group.id, label: group.title })))
const citationOccurrences = computed(() =>
  faqGroups.value.flatMap((group) =>
    group.items.flatMap((item) => [
      ...item.answer.flatMap((paragraph, paragraphIndex) =>
        campaignCitationOccurrences(paragraph, citationIdPrefix(group.id, item.id, 'answer', paragraphIndex))
      ),
      ...(item.points ?? []).flatMap((point, pointIndex) =>
        campaignCitationOccurrences(point, citationIdPrefix(group.id, item.id, 'point', pointIndex))
      )
    ])
  )
)
const citedSources = computed(() =>
  campaignSourcesForOccurrences(campaignFaqPage.value.sources, citationOccurrences.value)
)

function citationIdPrefix(groupId: string, itemId: string, kind: 'answer' | 'point', index: number) {
  return `stockton-flock-faq-title-${groupId}-${itemId}-${kind}-${index + 1}`
}
</script>

<template>
  <article class="campaign-faq" aria-labelledby="stockton-flock-faq-title">
    <header class="campaign-faq-opening">
      <div class="campaign-faq-opening-inner">
        <div class="campaign-faq-context">
          <p v-if="campaignFaqPage.eyebrow">{{ campaignFaqPage.eyebrow }}</p>
          <p>{{ t('removeFlock.reviewedThrough', { date: campaignFaqPage.reviewedThrough }) }}</p>
        </div>

        <div class="campaign-faq-claim">
          <h1 id="stockton-flock-faq-title">{{ campaignFaqPage.title }}</h1>
          <div class="campaign-faq-introduction">
            <p class="campaign-faq-description">{{ campaignFaqPage.description }}</p>
            <p v-if="campaignFaqPage.qualification" class="campaign-faq-qualification">
              {{ campaignFaqPage.qualification }}
            </p>
            <AppActionLink :to="petitionUrl" variant="campaign">
              {{ t('removeFlock.petitionAction') }}
            </AppActionLink>
          </div>
        </div>
      </div>
    </header>

    <div class="campaign-faq-layout">
      <CampaignPageOutline :items="outlineItems" :label="t('removeFlock.faq.groupsLabel')" />

      <div class="campaign-faq-groups">
        <section
          v-for="group in faqGroups"
          :id="group.id"
          :key="group.id"
          class="campaign-faq-group"
          :aria-labelledby="`${group.id}-title`"
        >
          <div class="campaign-faq-group-heading">
            <h2 :id="`${group.id}-title`">{{ group.title }}</h2>
            <p>{{ group.summary }}</p>
          </div>

          <div class="campaign-faq-items">
            <details v-for="item in group.items" :key="item.id" :name="`faq-${group.id}`">
              <summary>
                <span>{{ item.question }}</span>
              </summary>
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

    <div class="campaign-faq-sources">
      <CampaignSourceNotes
        :citations="citationOccurrences"
        id-prefix="stockton-flock-faq-title"
        :sources="citedSources"
      />
    </div>
  </article>
</template>

<style scoped>
/* stylelint-disable no-descending-specificity -- FAQ heading and answer typography share nested paragraph rules. */
@layer components {
  .campaign-faq {
    --faq-divider: var(--color-divider-strong);

    min-width: 0;
    margin-inline: calc(-1 * var(--campaign-content-inset));
    overflow: clip;
    background: var(--color-surface);
  }

  .campaign-faq-opening {
    color: var(--color-surface);
    background: var(--color-brand-primary);
  }

  .campaign-faq-opening-inner,
  .campaign-faq-layout,
  .campaign-faq-sources {
    padding-inline: var(--campaign-content-inset);
  }

  .campaign-faq-opening-inner {
    display: grid;
    gap: clamp(2.5rem, 6vw, 5rem);
    padding-block: clamp(4rem, 9vw, 7.5rem);
  }

  .campaign-faq-context {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-3) var(--space-6);
    padding-block-end: var(--space-4);
    border-block-end: var(--border-width) solid rgb(255 255 255 / 35%);
  }

  .campaign-faq-context p,
  .campaign-faq-description,
  .campaign-faq-qualification {
    margin: 0;
  }

  .campaign-faq-context p {
    color: var(--color-surface);
    font-family: var(--font-family-mono);
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.1em;
    line-height: 1.4;
    text-transform: uppercase;
  }

  .campaign-faq-claim {
    display: grid;
    grid-template-columns: minmax(0, 7fr) minmax(18rem, 5fr);
    gap: clamp(2.5rem, 7vw, 6rem);
    align-items: end;
  }

  .campaign-faq h1 {
    --color-brand-primary: var(--color-surface);
    --font-size-heading-1: clamp(3.5rem, 5.7vw, 5.25rem);
    --line-height-heading: 0.98;

    max-inline-size: 11ch;
    margin: 0;
    color: var(--color-brand-primary);
    font-family: var(--font-family-heading);
    font-size: var(--font-size-heading-1);
    font-weight: var(--font-weight-bold);
    letter-spacing: -0.04em;
    line-height: var(--line-height-heading);
    text-wrap: balance;
  }

  .campaign-faq-introduction {
    display: grid;
    justify-items: start;
    gap: var(--space-5);
    min-width: 0;
  }

  .campaign-faq-description {
    max-inline-size: 42ch;
    color: var(--color-surface);
    font-size: var(--font-size-lede);
    line-height: 1.55;
    text-wrap: pretty;
  }

  .campaign-faq-qualification {
    max-inline-size: 46ch;
    border-inline-start: var(--border-width-accent) solid var(--color-brand-highlight);
    padding-inline-start: var(--space-4);
    color: rgb(255 255 255 / 82%);
    font-size: 1rem;
    line-height: 1.65;
    text-wrap: pretty;
  }

  .campaign-faq-layout {
    display: grid;
    grid-template-columns: minmax(13rem, 3fr) minmax(0, 9fr);
    gap: clamp(2.5rem, 7vw, 7rem);
    align-items: start;
    min-width: 0;
  }

  .campaign-faq h2 {
    --font-size-heading-2: clamp(2rem, 1.6rem + 1.5vw, 3.25rem);
    --line-height-heading: 1.02;

    max-inline-size: 24ch;
    margin: 0;
    color: var(--color-brand-primary);
    font-family: var(--font-family-heading);
    font-size: var(--font-size-heading-2);
    font-weight: var(--font-weight-bold);
    letter-spacing: -0.035em;
    line-height: var(--line-height-heading);
    text-wrap: balance;
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
    gap: var(--space-3);
    align-items: start;
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
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-block-size: 3rem;
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

  .campaign-faq summary > span {
    min-width: 0;
    overflow-wrap: anywhere;
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
    padding: 0 var(--space-7) var(--space-6) 0;
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

  .campaign-faq-answer p {
    font-size: 1rem;
  }

  .campaign-faq-answer ol {
    display: grid;
    gap: var(--space-4);
    padding-inline-start: 1.5rem;
  }

  .campaign-faq-sources {
    min-width: 0;
    border-block-start: var(--border-width) solid var(--faq-divider);
  }

  @media (width <= 56rem) {
    .campaign-faq-claim {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-7);
    }

    .campaign-faq h1 {
      max-inline-size: 14ch;
    }

    .campaign-faq-layout {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
    }
  }

  @media (width <= 40rem) {
    .campaign-faq-opening-inner {
      gap: var(--space-7);
      padding-block: var(--space-8);
    }

    .campaign-faq-context {
      display: grid;
    }

    .campaign-faq-context p {
      font-size: 1rem;
    }

    .campaign-faq h1 {
      --font-size-heading-1: clamp(2.75rem, 13vw, 3.5rem);
    }

    .campaign-faq summary {
      padding-inline-end: 2.5rem;
      font-size: 1rem;
    }

    .campaign-faq-answer {
      padding-inline: 0;
    }

    .campaign-faq-answer p,
    .campaign-faq-answer ol,
    .campaign-faq-group-heading > p:last-child {
      font-size: 1rem;
    }
  }
}
</style>
