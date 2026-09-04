<script setup lang="ts">
const { t } = useI18n()

defineProps<{
  titleId: string
  eyebrow: string
  title: string
  description: string
  qualification?: string
  reviewedThrough?: string
}>()
</script>

<template>
  <header class="campaign-editorial-header">
    <p class="campaign-editorial-eyebrow">{{ eyebrow }}</p>
    <h1 :id="titleId">{{ title }}</h1>
    <p class="campaign-editorial-description">{{ description }}</p>
    <p v-if="qualification" class="campaign-editorial-qualification">{{ qualification }}</p>
    <p v-if="reviewedThrough" class="campaign-editorial-reviewed">
      {{ t('removeFlock.reviewedThrough', { date: reviewedThrough }) }}
    </p>
    <slot />
  </header>
</template>

<style scoped>
@layer components {
  .campaign-editorial-header {
    display: grid;
    justify-items: start;
    gap: var(--space-5);
    border-block-end: var(--border-width) solid var(--color-divider-strong);
    padding-block: clamp(4rem, 9vw, 8rem);
  }

  .campaign-editorial-eyebrow {
    margin: 0;
    color: var(--color-accent-action);
    font-family: var(--font-family-mono);
    font-size: 0.8125rem;
    font-weight: var(--font-weight-strong);
    letter-spacing: 0.08em;
  }

  .campaign-editorial-header h1 {
    max-inline-size: 18ch;
    margin: 0;
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: clamp(3rem, 2.1rem + 3.5vw, 6rem);
    font-weight: 650;
    letter-spacing: -0.045em;
    line-height: 0.98;
    text-wrap: balance;
  }

  .campaign-editorial-description {
    max-inline-size: 62ch;
    margin: 0;
    color: var(--color-text);
    font-size: clamp(1.25rem, 1.1rem + 0.45vw, 1.5rem);
    line-height: 1.55;
    text-wrap: pretty;
  }

  .campaign-editorial-qualification {
    max-inline-size: 72ch;
    margin: var(--space-2) 0 0;
    border-inline-start: var(--border-width-accent) solid var(--color-brand-highlight);
    padding-inline-start: var(--space-4);
    color: var(--color-text-muted);
    font-size: 1rem;
    line-height: 1.75;
    text-wrap: pretty;
  }

  .campaign-editorial-reviewed {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 1rem;
  }

  @media (width <= 40rem) {
    .campaign-editorial-header h1 {
      font-size: clamp(2.75rem, 14vw, 4.25rem);
    }

    .campaign-editorial-eyebrow {
      font-size: 1rem;
    }
  }
}
</style>
