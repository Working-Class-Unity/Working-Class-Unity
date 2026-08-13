<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    idPrefix: string
    tone?: 'light' | 'inverse'
  }>(),
  { tone: 'inverse' }
)

const headingId = computed(() => `${props.idPrefix}-heading`)
const inputId = computed(() => `${props.idPrefix}-email`)
const noteId = computed(() => `${props.idPrefix}-note`)
</script>

<template>
  <form class="campaign-newsletter" :data-tone="props.tone" :aria-labelledby="headingId" @submit.prevent>
    <fieldset disabled>
      <legend :id="headingId">Get updates by email.</legend>
      <div class="campaign-newsletter-controls">
        <label class="visually-hidden" :for="inputId">Email address</label>
        <AppInput
          :id="inputId"
          class="campaign-newsletter-input"
          type="email"
          :name="inputId"
          autocomplete="email"
          inputmode="email"
          placeholder="Email address"
          :aria-describedby="noteId"
        />
        <AppButton class="campaign-newsletter-button" type="submit" disabled>Stay informed</AppButton>
      </div>
    </fieldset>
    <p :id="noteId">Newsletter signup is coming soon.</p>
  </form>
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

  .campaign-newsletter fieldset {
    min-width: 0;
    border: 0;
    padding: 0;
    margin: 0;
  }

  .campaign-newsletter legend {
    padding: 0;
    margin-block-end: var(--space-4);
    color: var(--color-action-contrast);
    font-weight: var(--font-weight-strong);
  }

  .campaign-newsletter-controls {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-3);
  }

  .campaign-newsletter-input,
  .campaign-newsletter-button {
    min-block-size: 3.25rem;
    border-radius: var(--radius-2);
    font-size: 1rem;
  }

  .campaign-newsletter-input {
    border: 0;
    padding-inline: var(--space-3);
    color: var(--color-text);
    background: var(--color-surface);
  }

  .campaign-newsletter-button {
    border: 0;
    color: var(--color-highlight-contrast);
    background: var(--color-brand-highlight);
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

  .campaign-newsletter[data-tone='light'] legend {
    color: var(--color-brand-primary);
  }

  .campaign-newsletter[data-tone='light'] .campaign-newsletter-input {
    border: var(--border-width) solid rgb(4 51 79 / 38%);
  }

  .campaign-newsletter[data-tone='light'] .campaign-newsletter-button {
    color: var(--color-action-contrast);
    background: var(--color-brand-primary);
  }

  .campaign-newsletter[data-tone='light'] > p {
    color: var(--color-text-muted);
  }

  @media (width <= 46rem) {
    .campaign-newsletter-controls {
      grid-template-columns: minmax(0, 1fr);
    }
  }
}
</style>
