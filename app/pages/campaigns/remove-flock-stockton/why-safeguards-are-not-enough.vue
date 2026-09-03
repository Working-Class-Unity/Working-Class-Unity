<script setup lang="ts">
import { whySafeguardsPage } from '~/content/remove-flock-stockton'

useHead({
  title: whySafeguardsPage.title,
  meta: [{ name: 'description', content: whySafeguardsPage.description }]
})
</script>

<template>
  <CampaignArticle class="safeguards-article" :content="whySafeguardsPage" title-id="why-safeguards-title" />
</template>

<style scoped>
@layer components {
  .safeguards-article {
    --safeguards-rule: var(--color-divider-strong);

    min-width: 0;
    overflow: clip;
  }

  .safeguards-article :deep(.campaign-editorial-header) {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: var(--space-5) clamp(1.5rem, 3vw, 3rem);
    border-block-end: var(--border-width-accent) solid var(--color-accent-action);
    padding-block: clamp(4.5rem, 9vw, 8rem) clamp(4rem, 8vw, 7rem);
  }

  .safeguards-article :deep(.campaign-editorial-eyebrow) {
    grid-column: 1 / -1;
    color: var(--color-accent-action);
    font-family: var(--font-family-statement);
    font-size: clamp(1rem, 0.9rem + 0.35vw, 1.25rem);
    font-weight: 400;
    letter-spacing: 0;
    line-height: 1.1;
  }

  .safeguards-article :deep(.campaign-editorial-header h1) {
    --font-size-heading-1: clamp(3.25rem, 2rem + 4vw, 5.75rem);
    --line-height-heading: 0.98;

    grid-column: 1 / 11;
    max-inline-size: 17ch;
    color: var(--color-brand-primary);
    font-family: var(--font-family-heading);
    font-size: var(--font-size-heading-1);
    font-weight: var(--font-weight-bold);
    letter-spacing: -0.04em;
    line-height: var(--line-height-heading);
    text-wrap: pretty;
  }

  .safeguards-article :deep(.campaign-editorial-description) {
    grid-column: 1 / 8;
    max-inline-size: 52ch;
  }

  .safeguards-article :deep(.campaign-editorial-qualification) {
    grid-column: 8 / -1;
    align-self: start;
    margin-block-start: 0;
  }

  .safeguards-article :deep(.campaign-editorial-reviewed) {
    grid-column: 1 / -1;
    padding-block-start: var(--space-2);
    border-block-start: var(--border-width) solid var(--safeguards-rule);
    font-family: var(--font-family-mono);
  }

  .safeguards-article :deep(.campaign-article-layout) {
    grid-template-columns: minmax(12rem, 3fr) minmax(0, 9fr);
    gap: clamp(2.5rem, 6vw, 6rem);
  }

  .safeguards-article :deep(.campaign-page-outline) {
    padding-block-start: clamp(4rem, 8vw, 6rem);
  }

  .safeguards-article :deep(.page-outline-desktop) {
    border-block-start: var(--border-width) solid var(--safeguards-rule);
    padding-block-start: var(--space-4);
  }

  .safeguards-article :deep(.page-outline-link) {
    min-block-size: 2.75rem;
    align-items: start;
    border-radius: 0;
  }

  .safeguards-article :deep(.page-outline-trigger) {
    border-radius: var(--radius-1);
    box-shadow: none;
  }

  .safeguards-article :deep(.campaign-article-section) {
    gap: clamp(2rem, 4vw, 3.5rem);
    padding-block: clamp(4rem, 8vw, 6rem);
  }

  .safeguards-article :deep(.campaign-article-section-heading) {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-3);
  }

  .safeguards-article :deep(.campaign-article-section h2) {
    --font-size-heading-2: clamp(2rem, 1.65rem + 1.2vw, 2.875rem);
    --line-height-heading: 1.06;

    grid-column: 1;
    max-inline-size: 24ch;
    color: var(--color-brand-primary);
    font-family: var(--font-family-heading);
    font-size: var(--font-size-heading-2);
    font-weight: var(--font-weight-bold);
    letter-spacing: -0.035em;
    line-height: var(--line-height-heading);
  }

  .safeguards-article :deep(.campaign-article-section-heading > p:last-child) {
    grid-column: 1;
    max-inline-size: 60ch;
    color: var(--color-text);
    font-size: 1.125rem;
    line-height: 1.65;
  }

  .safeguards-article :deep(.campaign-article-prose),
  .safeguards-article :deep(.campaign-article-points) {
    padding-inline-start: 0;
  }

  .safeguards-article :deep(.campaign-cited-paragraph > p:first-child),
  .safeguards-article :deep(.campaign-article-points > li > p:first-child) {
    max-inline-size: 68ch;
    font-size: 1.0625rem;
    line-height: 1.75;
  }

  .safeguards-article :deep(.campaign-source-register) {
    grid-template-columns: minmax(12rem, 3fr) minmax(0, 9fr);
    border-block-start: var(--border-width-accent) solid var(--color-brand-primary);
  }

  .safeguards-article :deep(.campaign-source-register h2) {
    --font-size-heading-2: clamp(2rem, 1.65rem + 1.2vw, 2.75rem);
    --line-height-heading: 1.06;

    font-family: var(--font-family-heading);
    font-size: var(--font-size-heading-2);
    font-weight: var(--font-weight-bold);
    line-height: var(--line-height-heading);
  }

  .safeguards-article :deep(.campaign-source-register li) {
    border-radius: 0;
    padding-inline: 0;
  }

  @media (width <= 56rem) {
    .safeguards-article :deep(.campaign-editorial-header),
    .safeguards-article :deep(.campaign-article-layout),
    .safeguards-article :deep(.campaign-source-register) {
      grid-template-columns: minmax(0, 1fr);
    }

    .safeguards-article :deep(.campaign-article-layout) {
      gap: 0;
    }

    .safeguards-article :deep(.campaign-editorial-eyebrow),
    .safeguards-article :deep(.campaign-editorial-header h1),
    .safeguards-article :deep(.campaign-editorial-description),
    .safeguards-article :deep(.campaign-editorial-qualification),
    .safeguards-article :deep(.campaign-editorial-reviewed) {
      grid-column: 1;
    }

    .safeguards-article :deep(.campaign-editorial-qualification) {
      margin-block-start: var(--space-2);
    }

    .safeguards-article :deep(.campaign-page-outline) {
      padding: 0;
    }
  }

  @media (width <= 40rem) {
    .safeguards-article :deep(.campaign-editorial-header h1) {
      --font-size-heading-1: clamp(2.75rem, 13vw, 3.75rem);
      --line-height-heading: 1.02;

      max-inline-size: none;
    }

    .safeguards-article :deep(.campaign-editorial-description),
    .safeguards-article :deep(.campaign-article-section-heading > p:last-child),
    .safeguards-article :deep(.campaign-cited-paragraph > p:first-child),
    .safeguards-article :deep(.campaign-article-points > li > p:first-child) {
      font-size: 1rem;
    }

    .safeguards-article :deep(.campaign-article-section h2) {
      --font-size-heading-2: 2rem;
      --line-height-heading: 1.1;
    }

    .safeguards-article :deep(.campaign-article-prose),
    .safeguards-article :deep(.campaign-article-points) {
      padding-inline-start: 0;
    }
  }
}
</style>
