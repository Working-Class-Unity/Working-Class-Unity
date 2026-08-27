<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    idPrefix: string
    tone?: 'light' | 'inverse'
  }>(),
  { tone: 'inverse' }
)

const noteId = computed(() => `${props.idPrefix}-note`)
</script>

<template>
  <div class="campaign-newsletter" :data-tone="props.tone">
    <h2>Get Deflock Stockton updates by email or text.</h2>
    <a
      class="campaign-newsletter-action"
      href="https://tech.workingclassunity.com/deflock-stockton-updates"
      :aria-describedby="noteId"
    >
      Stay informed
    </a>
    <p :id="noteId">Sign up for updates about this campaign and other WCU updates.</p>
  </div>
</template>

<style scoped>
@layer components {
  .campaign-newsletter {
    display: grid;
    gap: var(--space-3);
    inline-size: 100%;
    max-inline-size: 34rem;
    border-block-start: var(--border-width) solid rgb(255 255 255 / 28%);
    padding-block-start: var(--space-5);
  }

  .campaign-newsletter h2 {
    margin: 0;
    color: var(--color-action-contrast);
    font-size: 1rem;
    font-weight: var(--font-weight-strong);
  }

  .campaign-newsletter-action {
    --anchor-color: var(--color-highlight-contrast);

    display: inline-flex;
    min-block-size: 3.25rem;
    align-items: center;
    justify-content: center;
    justify-self: start;
    border: 0;
    border-radius: var(--radius-2);
    padding-inline: var(--space-4);
    color: var(--color-highlight-contrast);
    background: var(--color-brand-highlight);
    font-size: 1rem;
    font-weight: var(--font-weight-bold);
    text-align: center;
    text-decoration: none;
  }

  .campaign-newsletter-action:hover,
  .campaign-newsletter-action:focus-visible {
    --anchor-color: var(--color-brand-primary);

    color: var(--color-brand-primary);
    background: var(--color-action-contrast);
  }

  .campaign-newsletter > p {
    margin: 0;
    color: rgb(255 255 255 / 68%);
    font-size: 0.875rem;
  }

  .campaign-newsletter[data-tone='light'] {
    max-inline-size: 40rem;
    border-block-start-color: var(--color-divider-strong);
  }

  .campaign-newsletter[data-tone='light'] h2 {
    color: var(--color-brand-primary);
  }

  .campaign-newsletter[data-tone='light'] .campaign-newsletter-action {
    --anchor-color: var(--color-action-contrast);

    border: 2px solid var(--color-brand-primary);
    color: var(--color-action-contrast);
    background: var(--color-brand-primary);
  }

  .campaign-newsletter[data-tone='light'] .campaign-newsletter-action:hover,
  .campaign-newsletter[data-tone='light'] .campaign-newsletter-action:focus-visible {
    --anchor-color: var(--color-accent-action-contrast);

    border-color: var(--color-accent-action);
    color: var(--color-accent-action-contrast);
    background: var(--color-accent-action);
  }

  .campaign-newsletter[data-tone='light'] > p {
    color: var(--color-text-muted);
  }

  @media (width <= 46rem) {
    .campaign-newsletter-action {
      inline-size: 100%;
    }

    .campaign-newsletter > p {
      font-size: 1rem;
    }
  }
}
</style>
