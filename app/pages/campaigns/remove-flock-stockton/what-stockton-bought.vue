<script setup lang="ts">
import {
  stocktonContractFacts,
  stocktonCostStack,
  stocktonTimeline,
  whatStocktonBoughtPage,
  type CampaignCitationEntry,
  type CampaignCitationSlotMap
} from '~/content/remove-flock-stockton'

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

const contractFacts = stocktonContractFacts.map((fact, index) => ({
  ...fact,
  citation: citationEntry(`contract-fact-${index + 1}`, fact.detail, fact.sourceIds)
}))
const timeline = stocktonTimeline.map((entry, index) => ({
  ...entry,
  citation: citationEntry(`timeline-${index + 1}`, entry.description, entry.sourceIds)
}))
const costs = stocktonCostStack.map((cost, index) => ({
  ...cost,
  citation: citationEntry(`cost-${index + 1}`, cost.detail, cost.sourceIds)
}))
const costSection = whatStocktonBoughtPage.sections.find((section) => section.id === 'costs')
const costSummaryContent = costSection?.paragraphs?.[0]

if (!costSummaryContent) throw new Error('The campaign cost summary is required')

const costSummary = {
  id: 'cost-summary',
  content: costSummaryContent
} satisfies CampaignCitationEntry
const slotCitations = {
  'after-header': contractFacts.map((fact) => fact.citation),
  'section-timeline': timeline.map((entry) => entry.citation),
  'section-costs': [...costs.map((cost) => cost.citation), costSummary]
} satisfies CampaignCitationSlotMap

useHead({
  title: whatStocktonBoughtPage.title,
  meta: [{ name: 'description', content: whatStocktonBoughtPage.description }]
})
</script>

<template>
  <CampaignArticle
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
              The underlying amendment remains missing.
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
</template>

<style scoped>
/* stylelint-disable no-descending-specificity -- record modules share responsive structural resets. */
@layer components {
  .record-facts {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0;
    inline-size: 100%;
    margin: clamp(2rem, 5vw, 4rem) 0 0;
  }

  .record-facts > div {
    display: grid;
    align-content: start;
    gap: var(--space-2);
    border-inline-start: var(--border-width) solid var(--color-divider-strong);
    padding-inline: var(--space-5);
  }

  .record-facts > div:first-child {
    border-inline-start: 0;
    padding-inline-start: 0;
  }

  .record-facts > div:last-child {
    padding-inline-end: 0;
  }

  .record-facts dt,
  .record-costs dt {
    color: var(--color-text-muted);
    font-size: 0.875rem;
    font-weight: 600;
  }

  .record-facts dd,
  .record-costs dd {
    margin: 0;
    color: var(--color-text-muted);
    line-height: 1.6;
  }

  .record-facts dd:first-of-type,
  .record-costs dd:first-of-type {
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: clamp(1.5rem, 1.25rem + 0.8vw, 2.125rem);
    font-stretch: 110%;
    font-weight: 650;
    line-height: 1;
  }

  .record-timeline {
    display: grid;
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .record-timeline li {
    display: grid;
    grid-template-columns: minmax(8rem, 2fr) minmax(0, 7fr);
    gap: var(--space-5);
    border-block-start: var(--border-width) solid var(--color-divider-strong);
    padding-block: var(--space-5);
  }

  .record-timeline li > p {
    margin: 0;
    color: var(--color-accent-action);
    font-family: var(--font-family-mono);
    font-weight: var(--font-weight-strong);
  }

  .record-timeline li > div {
    display: grid;
    gap: var(--space-2);
  }

  .record-timeline h3,
  .record-timeline li > div > p {
    margin: 0;
  }

  .record-timeline h3 {
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: 1.25rem;
    font-weight: 650;
  }

  .record-timeline li > div > p {
    max-inline-size: 68ch;
    color: var(--color-text-muted);
    line-height: 1.75;
    text-wrap: pretty;
  }

  .record-timeline li > div > .record-gap {
    color: var(--color-status-warning-text);
    font-weight: 650;
  }

  .record-costs-layout {
    container-type: inline-size;
  }

  .record-costs {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: var(--space-3);
    margin: 0;
  }

  .record-costs > div {
    display: grid;
    align-content: start;
    gap: var(--space-2);
    border-block-start: 3px solid var(--color-brand-highlight);
    padding-block-start: var(--space-4);
  }

  .record-cost-note {
    max-inline-size: 68ch;
    margin: var(--space-6) 0 0;
    color: var(--color-text-muted);
    line-height: 1.75;
  }

  @container (width <= 56rem) {
    .record-costs {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-5);
    }
  }

  @container (width <= 36rem) {
    .record-costs {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (width <= 56rem) {
    .record-costs {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (width <= 68rem) {
    .record-facts {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-5);
    }

    .record-facts > div,
    .record-facts > div:first-child,
    .record-facts > div:last-child {
      border-inline-start: 0;
      border-block-start: var(--border-width) solid var(--color-divider-strong);
      padding: var(--space-4) 0 0;
    }
  }

  @media (width <= 40rem) {
    .record-facts,
    .record-timeline li {
      grid-template-columns: minmax(0, 1fr);
    }

    .record-facts dt,
    .record-costs dt {
      font-size: 1rem;
    }
  }
}
</style>
