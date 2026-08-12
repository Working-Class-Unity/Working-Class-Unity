<script setup lang="ts">
const { t } = useI18n()

useHead(() => ({
  title: t('metadata.calendar.title'),
  meta: [{ name: 'description', content: t('metadata.calendar.description') }]
}))
</script>

<template>
  <section class="public-page flow" aria-labelledby="calendar-title">
    <p class="public-page-eyebrow">{{ t('publicPages.eyebrow') }}</p>
    <h1 id="calendar-title">{{ t('publicPages.calendar.title') }}</h1>
    <p class="public-page-description">{{ t('publicPages.calendar.description') }}</p>
  </section>
</template>

<style scoped>
@layer components {
  .public-page {
    --flow-space: var(--space-4);

    min-block-size: clamp(24rem, 62vh, 38rem);
    align-content: start;
    padding-block: clamp(4rem, 10vw, 8rem);
  }

  .public-page-eyebrow,
  .public-page-description {
    max-inline-size: 56ch;
    margin: 0;
  }

  .public-page-eyebrow {
    color: var(--color-action);
    font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
    font-weight: var(--font-weight-strong);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .public-page-description {
    color: var(--color-text-muted);
    font-size: 1.125rem;
  }
}
</style>
