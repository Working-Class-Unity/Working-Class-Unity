<script setup lang="ts">
import CampaignLandingSectionHeading from '~/components/campaign/LandingSectionHeading.vue'

defineProps<{
  demand: Readonly<{
    title: string
    introduction: string
    leadIn: string
    demands: readonly string[]
  }>
  petitionUrl: string
}>()
</script>

<template>
  <section id="removal-demand" class="campaign-demand" aria-labelledby="campaign-demand-title">
    <CampaignLandingSectionHeading
      eyebrow="04 / THE DEMAND"
      summary="The petition language below is reproduced without editorial changes."
      :title="demand.title"
      title-id="campaign-demand-title"
    />

    <div class="campaign-demand-copy">
      <p class="campaign-demand-introduction">{{ demand.introduction }}</p>
      <p class="campaign-demand-leadin">{{ demand.leadIn }}</p>
      <ol class="campaign-demand-list">
        <li v-for="item in demand.demands" :key="item">{{ item }}</li>
      </ol>
      <a class="campaign-demand-action" :href="petitionUrl">Sign the demand letter</a>
    </div>
  </section>
</template>

<style scoped>
@layer components {
  .campaign-demand {
    display: grid;
    grid-template-columns: minmax(0, 4fr) minmax(0, 7fr);
    gap: var(--campaign-grid-gap);
    border-radius: 0;
    background: var(--color-status-warning-surface);
  }

  .campaign-demand-copy {
    display: grid;
    align-content: start;
    gap: var(--space-5);
  }

  .campaign-demand-copy p {
    margin: 0;
  }

  .campaign-demand-introduction {
    color: var(--color-text);
    font-size: 1.25rem;
    line-height: 1.65;
    text-wrap: pretty;
  }

  .campaign-demand-leadin {
    color: var(--color-brand-primary);
    font-weight: var(--font-weight-strong);
  }

  .campaign-demand-list {
    display: grid;
    gap: var(--space-5);
    padding: 0;
    margin: 0;
    list-style: none;
    counter-reset: demand;
  }

  .campaign-demand-list li {
    display: grid;
    grid-template-columns: 2.25rem minmax(0, 1fr);
    gap: var(--space-4);
    color: var(--color-text);
    line-height: 1.75;
    counter-increment: demand;
  }

  .campaign-demand-list li::before {
    color: var(--color-accent-action);
    font-family: var(--font-family-mono);
    font-weight: var(--font-weight-strong);
    content: counter(demand, decimal-leading-zero);
  }

  .campaign-demand-action {
    display: inline-flex;
    inline-size: 100%;
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

  .campaign-demand-action:hover,
  .campaign-demand-action:focus-visible {
    color: var(--color-brand-primary);
    background: var(--color-action-soft);
  }

  .campaign-demand-action:focus-visible {
    outline: var(--focus-outline);
    outline-offset: var(--focus-offset);
  }

  @media (width <= 46rem) {
    .campaign-demand {
      grid-template-columns: minmax(0, 1fr);
    }

    .campaign-demand-list li {
      grid-template-columns: 1.75rem minmax(0, 1fr);
      gap: var(--space-3);
    }
  }
}
</style>
