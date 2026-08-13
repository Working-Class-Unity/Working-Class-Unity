<script setup lang="ts">
import {
  stocktonContractFacts,
  stocktonCostStack,
  stocktonTimeline,
  whatStocktonBoughtPage
} from '~/content/remove-flock-stockton'

useHead({
  title: whatStocktonBoughtPage.title,
  meta: [{ name: 'description', content: whatStocktonBoughtPage.description }]
})
</script>

<template>
  <CampaignArticle :content="whatStocktonBoughtPage" title-id="what-stockton-bought-title">
    <template #after-header>
      <dl class="record-facts">
        <div v-for="fact in stocktonContractFacts" :key="fact.label">
          <dt>{{ fact.label }}</dt>
          <dd>{{ fact.value }}</dd>
          <dd>{{ fact.detail }}</dd>
        </div>
      </dl>
    </template>

    <template #section-timeline>
      <ol class="record-timeline">
        <li v-for="entry in stocktonTimeline" :key="`${entry.date}-${entry.action}`">
          <p>{{ entry.date }}</p>
          <div>
            <h3>{{ entry.action }}</h3>
            <p>{{ entry.description }}</p>
            <p v-if="entry.status === 'reported-with-gap'" class="record-gap">
              The underlying amendment remains missing.
            </p>
          </div>
        </li>
      </ol>
    </template>

    <template #section-costs>
      <dl class="record-costs">
        <div v-for="cost in stocktonCostStack" :key="cost.label">
          <dt>{{ cost.label }}</dt>
          <dd>{{ cost.amount }}</dd>
          <dd>{{ cost.detail }}</dd>
        </div>
      </dl>
      <p class="record-cost-note">
        The amendment amounts show how the agreement grew. They should not be added to the stated maximum as a second
        total.
      </p>
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
    border-inline-start: var(--border-width) solid rgb(4 51 79 / 18%);
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
    border-block-start: var(--border-width) solid rgb(4 51 79 / 18%);
    padding-block: var(--space-5);
  }

  .record-timeline li > p {
    margin: 0;
    color: var(--color-accent-action);
    font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
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

  @media (width <= 68rem) {
    .record-facts,
    .record-costs {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-5);
    }

    .record-facts > div,
    .record-facts > div:first-child,
    .record-facts > div:last-child {
      border-inline-start: 0;
      border-block-start: var(--border-width) solid rgb(4 51 79 / 18%);
      padding: var(--space-4) 0 0;
    }
  }

  @media (width <= 40rem) {
    .record-facts,
    .record-costs,
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
