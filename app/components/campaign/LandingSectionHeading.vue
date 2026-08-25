<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    eyebrow: string
    inverse?: boolean
    summary?: string
    title: string
    titleId: string
  }>(),
  {
    inverse: false,
    summary: ''
  }
)
</script>

<template>
  <div class="campaign-section-heading" :data-inverse="props.inverse || undefined">
    <p class="campaign-section-index">{{ props.eyebrow }}</p>
    <h2 :id="props.titleId">{{ props.title }}</h2>
    <p v-if="props.summary" class="campaign-section-summary">{{ props.summary }}</p>
  </div>
</template>

<style scoped>
@layer components {
  .campaign-section-heading {
    display: grid;
    align-content: start;
    gap: var(--space-4);
  }

  .campaign-section-index {
    margin: 0;
    color: var(--color-accent-action);
    font-family: var(--font-family-mono);
    font-size: 0.8125rem;
    font-weight: var(--font-weight-strong);
    letter-spacing: 0.08em;
  }

  .campaign-section-heading h2 {
    max-inline-size: 22ch;
    margin: 0;
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: clamp(2.25rem, 1.7rem + 2vw, 4rem);
    font-weight: 650;
    letter-spacing: -0.045em;
    line-height: 1;
    text-wrap: balance;
  }

  .campaign-section-summary {
    max-inline-size: 62ch;
    margin: 0;
    color: var(--color-text-muted);
    font-size: 1.125rem;
    line-height: 1.65;
    text-wrap: pretty;
  }

  .campaign-section-heading[data-inverse] .campaign-section-index {
    color: var(--color-brand-highlight);
  }

  .campaign-section-heading[data-inverse] h2,
  .campaign-section-heading[data-inverse] .campaign-section-summary {
    color: var(--color-action-contrast);
  }

  @media (width <= 46rem) {
    .campaign-section-index {
      font-size: 0.875rem;
    }
  }
}
</style>
