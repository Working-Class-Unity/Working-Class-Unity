<script setup lang="ts">
import type { CampaignCitationEntry } from '~/content/remove-flock-stockton'

const { t } = useI18n()
const { stocktonContractFacts, stocktonCostStack, stocktonTimeline, whatStocktonBoughtPage } = useRemoveFlockContent()

const citationLocators: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'contract-fact-1': {
    'stockton-mar-2026-staff-report': 'Financial Summary, PDF p. 3',
    'stockton-mar-2026-amendment': 'Standard Agreement Amendment No. 4, §§ 1–2.1, PDF p. 1'
  },
  'contract-fact-4': {
    'stockton-mar-2026-staff-report': 'Discussion — Present Situation, PDF p. 2',
    'stockton-mar-2026-amendment': 'Attachment A, Order Form, PDF p. 4'
  },
  'timeline-7': {
    'stockton-mar-2026-staff-report': 'Financial Summary, PDF p. 3',
    'stockton-mar-2026-amendment': 'Standard Agreement Amendment No. 4, §§ 1–2.1, PDF p. 1'
  },
  'cost-5': {
    'stockton-mar-2026-amendment': 'Attachment A, Order Form, PDF p. 4'
  }
}

function citationEntry(id: string, text: string, sourceIds: readonly string[]): CampaignCitationEntry {
  const locators = citationLocators[id] ?? {}

  return {
    id,
    content: {
      parts: [
        {
          text,
          citations: sourceIds.map((sourceId) => {
            const locator = locators[sourceId]
            return locator ? { sourceId, locator } : { sourceId }
          })
        }
      ]
    }
  }
}

const contractFacts = computed(() =>
  stocktonContractFacts.value.map((fact, index) => ({
    ...fact,
    citation: citationEntry(`contract-fact-${index + 1}`, fact.detail, fact.sourceIds)
  }))
)
const timeline = computed(() =>
  stocktonTimeline.value.map((entry, index) => ({
    ...entry,
    citation: citationEntry(`timeline-${index + 1}`, entry.description, entry.sourceIds)
  }))
)
const costs = computed(() =>
  stocktonCostStack.value.map((cost, index) => ({
    ...cost,
    citation: citationEntry(`cost-${index + 1}`, cost.detail, cost.sourceIds)
  }))
)
const costSummary = computed<CampaignCitationEntry>(() => {
  const costSection = whatStocktonBoughtPage.value.sections.find((section) => section.id === 'costs')
  const content = costSection?.paragraphs?.[0]
  if (!content) throw new Error('The campaign cost summary is required')
  return { id: 'cost-summary', content }
})
const slotCitations = computed(() => ({
  'after-header': contractFacts.value.map((fact) => fact.citation),
  'section-timeline': timeline.value.map((entry) => entry.citation),
  'section-costs': [...costs.value.map((cost) => cost.citation), costSummary.value]
}))

useHead(() => ({
  title: whatStocktonBoughtPage.value.title,
  meta: [{ name: 'description', content: whatStocktonBoughtPage.value.description }]
}))
</script>

<template>
  <div class="stockton-record-page">
    <CampaignArticle
      class="stockton-record"
      :content="whatStocktonBoughtPage"
      :slot-citations="slotCitations"
      title-id="what-stockton-bought-title"
    >
      <template #after-header="{ citationOccurrences, citationSources, sourceNoteIdPrefix }">
        <dl class="record-facts">
          <div v-for="fact in contractFacts" :key="fact.label">
            <dt>{{ fact.label }}</dt>
            <dd>{{ fact.value }}</dd>
            <dd>
              <CampaignCitedText
                :citation-id-prefix="`${sourceNoteIdPrefix}-${fact.citation.id}`"
                :content="fact.citation.content"
                :occurrences="citationOccurrences"
                :source-note-id-prefix="sourceNoteIdPrefix"
                :sources="citationSources"
              />
            </dd>
          </div>
        </dl>
      </template>

      <template #section-timeline="{ citationOccurrences, citationSources, sourceNoteIdPrefix }">
        <ol class="record-timeline">
          <li v-for="entry in timeline" :key="`${entry.date}-${entry.action}`">
            <p>{{ entry.date }}</p>
            <div>
              <h3>{{ entry.action }}</h3>
              <p>
                <CampaignCitedText
                  :citation-id-prefix="`${sourceNoteIdPrefix}-${entry.citation.id}`"
                  :content="entry.citation.content"
                  :occurrences="citationOccurrences"
                  :source-note-id-prefix="sourceNoteIdPrefix"
                  :sources="citationSources"
                />
              </p>
              <p v-if="entry.status === 'reported-with-gap'" class="record-gap">
                {{ t('removeFlock.record.missingAmendment') }}
              </p>
            </div>
          </li>
        </ol>
      </template>

      <template #section-costs="{ citationOccurrences, citationSources, sourceNoteIdPrefix }">
        <div class="record-costs-layout">
          <dl class="record-costs">
            <div v-for="cost in costs" :key="cost.label">
              <dt>{{ cost.label }}</dt>
              <dd>{{ cost.amount }}</dd>
              <dd>
                <CampaignCitedText
                  :citation-id-prefix="`${sourceNoteIdPrefix}-${cost.citation.id}`"
                  :content="cost.citation.content"
                  :occurrences="citationOccurrences"
                  :source-note-id-prefix="sourceNoteIdPrefix"
                  :sources="citationSources"
                />
              </dd>
            </div>
          </dl>
          <p class="record-cost-note">
            <CampaignCitedText
              :citation-id-prefix="`${sourceNoteIdPrefix}-${costSummary.id}`"
              :content="costSummary.content"
              :occurrences="citationOccurrences"
              :source-note-id-prefix="sourceNoteIdPrefix"
              :sources="citationSources"
            />
          </p>
        </div>
      </template>
    </CampaignArticle>

    <nav class="record-next" :aria-label="t('removeFlock.record.continueLabel')">
      <p>{{ t('removeFlock.record.continue') }}</p>
      <AppActionLink to="/campaigns/remove-flock-stockton" variant="text">
        {{ t('removeFlock.record.overview') }} <span aria-hidden="true">→</span>
      </AppActionLink>
    </nav>
  </div>
</template>

<style scoped>
/* stylelint-disable no-descending-specificity -- dossier modules share responsive structural resets. */
@layer components {
  .stockton-record-page {
    min-width: 0;
  }

  .stockton-record :deep(.campaign-editorial-header) {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: var(--space-5) var(--space-6);
    padding-block: clamp(4.5rem, 9vw, 8rem) clamp(5rem, 10vw, 9rem);
  }

  .stockton-record :deep(.campaign-editorial-eyebrow) {
    grid-column: 1 / -1;
    color: var(--color-accent-action);
    font-family: var(--font-family-body);
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .stockton-record :deep(.campaign-editorial-header h1) {
    --font-size-heading-1: clamp(4rem, 7vw, 6.75rem);
    --line-height-heading: 0.94;

    grid-column: 1 / span 8;
    max-inline-size: 10ch;
    color: var(--color-brand-primary);
    font-family: var(--font-family-heading);
    font-size: var(--font-size-heading-1);
    font-weight: var(--font-weight-bold);
    letter-spacing: -0.045em;
    line-height: var(--line-height-heading);
  }

  .stockton-record :deep(.campaign-editorial-description) {
    grid-column: 9 / -1;
    align-self: center;
    max-inline-size: 36ch;
    font-size: clamp(1.125rem, 1rem + 0.4vw, 1.25rem);
    line-height: 1.55;
  }

  .stockton-record :deep(.campaign-editorial-reviewed) {
    grid-column: 1 / span 4;
    grid-row: 3;
    align-self: start;
    padding-block-start: var(--space-4);
    border-block-start: var(--border-width) solid var(--article-divider);
    color: var(--color-brand-primary);
    font-weight: var(--font-weight-bold);
  }

  .stockton-record :deep(.campaign-editorial-qualification) {
    grid-column: 5 / -1;
    grid-row: 3;
    max-inline-size: 62ch;
    padding-block-start: var(--space-4);
    padding-inline-start: 0;
    margin: 0;
    border-block-start: var(--border-width) solid var(--article-divider);
    border-inline-start: 0;
    line-height: 1.65;
  }

  .record-facts {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    column-gap: var(--space-6);
    inline-size: 100%;
    margin: var(--space-7) 0 0;
  }

  .record-facts > div {
    display: grid;
    align-content: start;
    gap: var(--space-2);
    min-width: 0;
    border-block-start: var(--border-width) solid var(--article-divider);
    padding-block-start: var(--space-4);
  }

  .record-facts > div:first-child {
    grid-column: 1 / -1;
    grid-template-columns: minmax(0, 7fr) minmax(18rem, 5fr);
    column-gap: var(--space-6);
    padding-block: var(--space-5) var(--space-7);
    border-block-start: var(--border-width-accent) solid var(--color-brand-highlight);
  }

  .record-facts dt,
  .record-costs dt {
    color: var(--color-brand-primary);
    font-size: 0.875rem;
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.04em;
  }

  .record-facts dd,
  .record-costs dd {
    margin: 0;
    color: var(--color-text-muted);
    line-height: 1.65;
    text-wrap: pretty;
  }

  .record-facts dd:first-of-type,
  .record-costs dd:first-of-type {
    color: var(--color-brand-primary);
    font-family: var(--font-family-statement);
    font-size: clamp(2rem, 1.5rem + 1.3vw, 3rem);
    font-weight: 400;
    letter-spacing: -0.035em;
    line-height: 0.95;
  }

  .record-facts > div:first-child dt,
  .record-facts > div:first-child dd:first-of-type {
    grid-column: 1;
  }

  .record-facts > div:first-child dd:first-of-type {
    font-size: clamp(4rem, 7.5vw, 7rem);
  }

  .record-facts > div:first-child dd:last-child {
    grid-column: 2;
    grid-row: 1 / span 2;
    align-self: center;
    max-inline-size: 48ch;
    color: var(--color-text);
    font-size: 1.125rem;
  }

  .record-timeline {
    display: grid;
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .record-timeline li {
    display: grid;
    grid-template-columns: minmax(8.5rem, 2fr) minmax(0, 10fr);
    gap: var(--space-6);
    border-block-start: var(--border-width) solid var(--article-divider);
    padding-block: var(--space-6);
  }

  .record-timeline li > p {
    margin: 0;
    color: var(--color-accent-action);
    font-family: var(--font-family-body);
    font-weight: var(--font-weight-bold);
    line-height: 1.3;
  }

  .record-timeline li > div {
    display: grid;
    grid-template-columns: minmax(10rem, 4fr) minmax(0, 8fr);
    gap: var(--space-3) var(--space-6);
    min-width: 0;
  }

  .record-timeline h3,
  .record-timeline li > div > p {
    margin: 0;
  }

  .record-timeline h3 {
    --font-size-heading-3: clamp(1.25rem, 1.1rem + 0.45vw, 1.5rem);

    color: var(--color-brand-primary);
    font-family: var(--font-family-heading);
    font-size: var(--font-size-heading-3);
    font-weight: var(--font-weight-bold);
    letter-spacing: -0.015em;
    line-height: 1.15;
  }

  .record-timeline li > div > p {
    max-inline-size: 68ch;
    color: var(--color-text-muted);
    line-height: 1.65;
    text-wrap: pretty;
  }

  .record-timeline li > div > .record-gap {
    grid-column: 2;
    color: var(--color-status-warning-text);
    font-weight: var(--font-weight-bold);
  }

  .record-costs-layout {
    min-width: 0;
  }

  .record-costs {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    margin: 0;
  }

  .record-costs > div {
    display: grid;
    grid-template-columns: minmax(9rem, 3fr) minmax(12rem, 4fr) minmax(0, 5fr);
    gap: var(--space-3) var(--space-6);
    align-items: baseline;
    min-width: 0;
    border-block-start: var(--border-width) solid var(--article-divider);
    padding-block: var(--space-5);
  }

  .record-costs > div:first-child {
    border-block-start: var(--border-width-accent) solid var(--color-brand-highlight);
  }

  .record-costs dd:first-of-type {
    font-size: clamp(2.25rem, 1.8rem + 1.5vw, 3.5rem);
  }

  .record-cost-note {
    max-inline-size: 62ch;
    padding-block-start: var(--space-5);
    padding-inline-start: var(--space-5);
    margin: var(--space-5) 0 0;
    border-block-start: var(--border-width) solid var(--article-divider);
    border-inline-start: var(--border-width-accent) solid var(--color-brand-primary);
    color: var(--color-text);
    font-size: 1.125rem;
    line-height: 1.65;
  }

  .stockton-record :deep(.campaign-article-section-heading) {
    grid-template-columns: minmax(0, 4fr) minmax(0, 7fr);
    gap: var(--space-4) var(--space-6);
    align-items: start;
  }

  .stockton-record :deep(.campaign-article-section h2) {
    --font-size-heading-2: clamp(2rem, 1.55rem + 1.4vw, 2.75rem);
    --line-height-heading: 1.04;

    max-inline-size: 16ch;
    color: var(--color-brand-primary);
    font-family: var(--font-family-heading);
    font-size: var(--font-size-heading-2);
    font-weight: var(--font-weight-bold);
    line-height: var(--line-height-heading);
  }

  .stockton-record :deep(.campaign-article-section-heading > p:last-child) {
    max-inline-size: 46ch;
    font-size: 1.125rem;
    line-height: 1.55;
  }

  .stockton-record :deep(.campaign-article-prose),
  .stockton-record :deep(.campaign-article-points) {
    inline-size: min(46rem, 100%);
    margin-inline-start: auto;
  }

  .stockton-record :deep(.campaign-cited-paragraph > p:first-child),
  .stockton-record :deep(.campaign-article-points > li > p:first-child) {
    max-inline-size: 68ch;
    font-size: 1.0625rem;
    line-height: 1.7;
  }

  .stockton-record :deep(.campaign-article-points li) {
    border-color: var(--article-divider);
    padding-block: var(--space-5);
  }

  .stockton-record :deep(.campaign-source-register) {
    border-block-start: var(--border-width-accent) solid var(--color-brand-primary);
  }

  .stockton-record :deep(.campaign-source-register h2) {
    --font-size-heading-2: clamp(2rem, 1.55rem + 1.4vw, 2.75rem);
    --line-height-heading: 1.04;

    color: var(--color-brand-primary);
    font-family: var(--font-family-heading);
    font-size: var(--font-size-heading-2);
    font-weight: var(--font-weight-bold);
    line-height: var(--line-height-heading);
  }

  .record-next {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-6);
    align-items: center;
    justify-content: space-between;
    min-width: 0;
    border-block-start: var(--border-width) solid var(--color-divider-strong);
    padding-block: var(--space-7) clamp(4rem, 8vw, 7rem);
  }

  .record-next p {
    margin: 0;
    color: var(--color-brand-primary);
    font-size: 1.125rem;
    font-weight: var(--font-weight-bold);
  }

  .record-next :deep(.app-action-link) {
    gap: var(--space-3);
    min-block-size: 3rem;
    font-size: 1rem;
  }

  .record-next :deep(.app-action-link > span) {
    font-size: 1.35em;
  }

  @media (width <= 68rem) {
    .stockton-record :deep(.campaign-editorial-header h1) {
      grid-column: 1 / span 7;
    }

    .stockton-record :deep(.campaign-editorial-description) {
      grid-column: 8 / -1;
    }

    .stockton-record :deep(.campaign-article-section-heading) {
      grid-template-columns: minmax(0, 4fr) minmax(0, 6fr);
    }

    .stockton-record :deep(.campaign-article-prose),
    .stockton-record :deep(.campaign-article-points) {
      margin-inline-start: 0;
    }
  }

  @media (width <= 56rem) {
    .stockton-record :deep(.campaign-editorial-header) {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-5);
      padding-block: var(--space-8) var(--space-9);
    }

    .stockton-record :deep(.campaign-editorial-eyebrow),
    .stockton-record :deep(.campaign-editorial-header h1),
    .stockton-record :deep(.campaign-editorial-description),
    .stockton-record :deep(.campaign-editorial-reviewed),
    .stockton-record :deep(.campaign-editorial-qualification),
    .record-facts {
      grid-column: 1;
    }

    .stockton-record :deep(.campaign-editorial-reviewed),
    .stockton-record :deep(.campaign-editorial-qualification) {
      grid-row: auto;
    }

    .stockton-record :deep(.campaign-editorial-header h1) {
      --font-size-heading-1: clamp(3.75rem, 12vw, 5.75rem);
    }

    .stockton-record :deep(.campaign-editorial-description) {
      max-inline-size: 42ch;
    }

    .stockton-record :deep(.campaign-editorial-reviewed) {
      margin-block-start: var(--space-4);
    }

    .record-facts {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
      margin-block-start: var(--space-7);
    }

    .record-facts > div,
    .record-facts > div:first-child {
      grid-column: 1;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-2);
      padding-block: var(--space-5);
    }

    .record-facts > div:first-child dd:last-child {
      grid-column: 1;
      grid-row: auto;
      margin-block-start: var(--space-3);
    }

    .record-facts > div:first-child dd:first-of-type {
      font-size: clamp(2.75rem, 13vw, 5.5rem);
    }

    .stockton-record :deep(.campaign-article-section-heading) {
      grid-template-columns: minmax(0, 1fr);
    }

    .stockton-record :deep(.campaign-article-section h2) {
      max-inline-size: 20ch;
    }

    .stockton-record :deep(.campaign-article-section-heading > p:last-child) {
      max-inline-size: 58ch;
    }

    .record-timeline li {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-3);
      padding-block: var(--space-5);
    }

    .record-timeline li > div {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-2);
    }

    .record-timeline li > div > .record-gap {
      grid-column: 1;
    }

    .record-costs > div {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-2);
      padding-block: var(--space-5);
    }

    .record-costs dd:last-child {
      margin-block-start: var(--space-2);
    }

    .record-cost-note {
      padding-inline-start: var(--space-4);
    }

    .record-next {
      display: grid;
      justify-content: stretch;
      padding-block: var(--space-7) var(--space-9);
    }

    .record-next :deep(.app-action-link) {
      justify-content: flex-start;
      inline-size: fit-content;
    }
  }

  @media (width <= 40rem) {
    .stockton-record :deep(.campaign-editorial-header) {
      padding-block: var(--space-8);
    }

    .stockton-record :deep(.campaign-editorial-header h1) {
      --font-size-heading-1: clamp(3rem, 15vw, 4.5rem);
    }

    .stockton-record :deep(.campaign-editorial-eyebrow),
    .stockton-record :deep(.campaign-editorial-reviewed),
    .record-facts dt,
    .record-costs dt {
      font-size: 1rem;
    }

    .record-facts dd,
    .record-costs dd,
    .record-timeline li > p,
    .record-timeline li > div > p,
    .stockton-record :deep(.campaign-cited-paragraph > p:first-child),
    .stockton-record :deep(.campaign-article-points > li > p:first-child) {
      font-size: 1rem;
    }

    .record-next {
      padding-block: var(--space-7) var(--space-8);
    }
  }
}
/* stylelint-enable no-descending-specificity */
</style>
