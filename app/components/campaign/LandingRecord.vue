<script setup lang="ts">
import type { CampaignFact } from '~/content/remove-flock-stockton'

defineProps<{
  facts: readonly CampaignFact[]
}>()
</script>

<template>
  <aside class="campaign-record" aria-labelledby="campaign-record-title">
    <div class="campaign-record-heading">
      <p>THE PUBLIC RECORD</p>
      <h2 id="campaign-record-title">This is not one camera.</h2>
    </div>

    <dl class="campaign-facts">
      <div v-for="fact in facts" :key="fact.label" class="campaign-fact">
        <dt>{{ fact.label }}</dt>
        <dd class="campaign-fact-value">{{ fact.value }}</dd>
        <dd>{{ fact.detail }}</dd>
      </div>
    </dl>

    <NuxtLink class="campaign-record-action" to="/campaigns/remove-flock-stockton/what-stockton-bought">
      Read what Stockton bought in detail
    </NuxtLink>
  </aside>
</template>

<style scoped>
@layer components {
  .campaign-record {
    display: grid;
    align-content: start;
    gap: var(--space-6);
    min-width: 0;
    border: var(--border-width) solid var(--color-divider-strong);
    border-radius: min(1vw, var(--radius-2));
    padding: clamp(1.5rem, 3vw, 2.5rem);
    background: var(--color-surface);
    box-shadow: var(--shadow-panel);
  }

  .campaign-record-heading {
    display: grid;
    gap: var(--space-3);
  }

  .campaign-record-heading > p {
    margin: 0;
    color: var(--color-accent-action);
    font-family: var(--font-family-mono);
    font-size: 0.8125rem;
    font-weight: var(--font-weight-strong);
    letter-spacing: 0.08em;
  }

  .campaign-record-heading h2 {
    max-inline-size: none;
    margin: 0;
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: clamp(1.75rem, 1.5rem + 0.8vw, 2.25rem);
    font-weight: 650;
    letter-spacing: -0.045em;
    line-height: 1;
    text-wrap: balance;
    white-space: nowrap;
  }

  .campaign-facts {
    display: grid;
    margin: 0;
  }

  .campaign-fact {
    display: grid;
    gap: var(--space-2);
    border-block-start: var(--border-width) solid var(--campaign-divider);
    padding-block: var(--space-5);
  }

  .campaign-fact:last-child {
    padding-block-end: 0;
  }

  .campaign-fact dt {
    color: var(--color-text-muted);
    font-size: 0.875rem;
    font-weight: 600;
  }

  .campaign-fact dd {
    margin: 0;
    color: var(--color-text-muted);
    line-height: 1.6;
  }

  .campaign-fact .campaign-fact-value {
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: clamp(1.75rem, 1.4rem + 1vw, 2.5rem);
    font-stretch: 110%;
    font-weight: 650;
    line-height: 1;
  }

  .campaign-record-action {
    display: inline-flex;
    min-block-size: 3.25rem;
    align-items: center;
    justify-content: center;
    border: 2px solid var(--color-brand-primary);
    border-radius: var(--radius-2);
    padding-inline: var(--space-4);
    color: var(--color-brand-primary);
    background: transparent;
    font-weight: var(--font-weight-bold);
    text-align: center;
    text-decoration: none;
  }

  .campaign-record-action:hover,
  .campaign-record-action:focus-visible {
    color: var(--color-brand-primary);
    background: var(--color-action-soft);
  }

  .campaign-record-action:focus-visible {
    outline: var(--focus-outline);
    outline-offset: var(--focus-offset);
  }

  @media (width <= 68rem) {
    .campaign-record {
      box-shadow: none;
    }

    .campaign-facts {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .campaign-fact {
      border-block-start: 0;
      border-inline-start: var(--border-width) solid var(--campaign-divider);
      padding: 0 var(--space-5);
    }

    .campaign-fact:first-child {
      border-inline-start: 0;
      padding-inline-start: 0;
    }

    .campaign-fact:last-child {
      padding-inline-end: 0;
    }
  }

  @media (width <= 46rem) {
    .campaign-record-heading h2 {
      white-space: normal;
    }

    .campaign-facts {
      grid-template-columns: minmax(0, 1fr);
    }

    .campaign-fact {
      border-block-start: var(--border-width) solid var(--campaign-divider);
      border-inline-start: 0;
      padding-inline: 0;
      padding-block: var(--space-5);
    }

    .campaign-fact:first-child {
      border-block-start: 0;
      padding-block-start: 0;
    }

    .campaign-fact:last-child {
      padding-block-end: 0;
    }

    .campaign-record-heading > p,
    .campaign-fact dt {
      font-size: 1rem;
    }
  }
}
</style>
