<script setup lang="ts">
import CampaignLandingRecord from '~/components/campaign/LandingRecord.vue'
import type { CampaignFact, CampaignPageContent } from '~/content/remove-flock-stockton'

defineProps<{
  facts: readonly CampaignFact[]
  page: CampaignPageContent
  petitionUrl: string
}>()
</script>

<template>
  <section class="campaign-hero">
    <div class="campaign-hero-copy">
      <h1 id="remove-flock-title">{{ page.title }}</h1>
      <p class="campaign-hero-description">{{ page.description }}</p>

      <div class="campaign-actions">
        <a class="campaign-primary-action" :href="petitionUrl">Sign the demand letter</a>
      </div>

      <CampaignNewsletterSignup id-prefix="campaign-hero-newsletter" tone="light" />

      <p class="campaign-qualification">{{ page.qualification }}</p>
    </div>

    <CampaignLandingRecord :facts="facts" />
  </section>
</template>

<style scoped>
@layer components {
  .campaign-hero {
    display: grid;
    grid-template-columns: minmax(0, 7fr) minmax(20rem, 5fr);
    gap: var(--campaign-grid-gap);
    align-items: start;
  }

  .campaign-hero-copy {
    display: grid;
    align-content: start;
    justify-items: start;
    gap: var(--space-5);
    min-width: 0;
  }

  .campaign-hero h1 {
    max-inline-size: 16ch;
    margin: 0;
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: clamp(3.25rem, 2.2rem + 4vw, 6.25rem);
    font-weight: 650;
    letter-spacing: -0.045em;
    line-height: 0.94;
    text-wrap: balance;
  }

  .campaign-hero-description {
    max-inline-size: 42ch;
    margin: 0;
    color: var(--color-text);
    font-size: clamp(1.25rem, 1.1rem + 0.45vw, 1.5rem);
    line-height: 1.5;
    text-wrap: pretty;
  }

  .campaign-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
  }

  .campaign-primary-action {
    --anchor-color: var(--color-accent-action-contrast);

    display: inline-flex;
    min-block-size: 3.25rem;
    align-items: center;
    justify-content: center;
    border: 2px solid var(--color-accent-action);
    border-radius: var(--radius-2);
    padding-inline: var(--space-4);
    color: var(--color-accent-action-contrast);
    background: var(--color-accent-action);
    font-weight: var(--font-weight-bold);
    text-align: center;
    text-decoration: none;
  }

  .campaign-primary-action:hover,
  .campaign-primary-action:focus-visible {
    border-color: var(--color-brand-primary);
    color: var(--color-accent-action-contrast);
    background: var(--color-brand-primary);
  }

  .campaign-primary-action:focus-visible {
    outline: var(--focus-outline);
    outline-offset: var(--focus-offset);
  }

  .campaign-qualification {
    max-inline-size: 66ch;
    margin: var(--space-2) 0 0;
    border-inline-start: var(--border-width-accent) solid var(--color-brand-highlight);
    padding-inline-start: var(--space-4);
    color: var(--color-text-muted);
    font-size: 1rem;
    line-height: 1.7;
    text-wrap: pretty;
  }

  @media (width <= 68rem) {
    .campaign-hero {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (width <= 46rem) {
    .campaign-hero h1 {
      font-size: clamp(3rem, 14vw, 4.5rem);
    }

    .campaign-actions {
      align-items: stretch;
      flex-direction: column;
      inline-size: 100%;
    }

    .campaign-primary-action {
      inline-size: 100%;
    }
  }
}
</style>
