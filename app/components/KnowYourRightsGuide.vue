<script setup lang="ts">
import { knowYourRightsBasePath, knowYourRightsGuides, type KnowYourRightsGuideSlug } from '~/content/know-your-rights'

const props = defineProps<{
  slug: KnowYourRightsGuideSlug
  titleId: string
  title: string
  description: string
  outlineItems: readonly Readonly<{
    id: string
    label: string
  }>[]
}>()

const { t } = useI18n()
const relatedGuides = computed(() => knowYourRightsGuides.filter((guide) => guide.slug !== props.slug))
const relatedTitleId = computed(() => props.titleId + '-related-title')
</script>

<template>
  <article class="kyr-guide" :aria-labelledby="titleId">
    <CampaignEditorialHeader
      :title-id="titleId"
      :eyebrow="t('kyr_nav.section_label')"
      :title="title"
      :description="description"
    />

    <div class="kyr-guide-layout">
      <PageOutline
        class="kyr-guide-outline"
        :items="outlineItems"
        :label="t('knowYourRights.interface.outline.label')"
        :title="t('knowYourRights.interface.outline.title')"
        :description="t('knowYourRights.interface.outline.description')"
        :trigger-label="t('knowYourRights.interface.outline.trigger')"
        :close-label="t('knowYourRights.interface.outline.close')"
        trigger-variant="secondary"
        :show-markers="false"
        show-trigger-indicator
      />

      <div class="kyr-guide-body">
        <slot />
      </div>
    </div>

    <nav class="kyr-related-guides" :aria-labelledby="relatedTitleId">
      <div class="kyr-related-heading">
        <div>
          <p>{{ t('kyr_nav.section_label') }}</p>
          <h2 :id="relatedTitleId">{{ t('kyr.otherResources') }}</h2>
        </div>
        <AppActionLink :to="knowYourRightsBasePath" variant="text">
          <span aria-hidden="true">←</span>
          {{ t('knowYourRights.interface.backToHub') }}
        </AppActionLink>
      </div>

      <ul role="list">
        <li v-for="guide in relatedGuides" :key="guide.slug">
          <NuxtLink :to="guide.path">
            <span>{{ t(guide.titleKey) }}</span>
            <span>{{ t(guide.descriptionKey) }}</span>
            <span aria-hidden="true">→</span>
          </NuxtLink>
        </li>
      </ul>
    </nav>
  </article>
</template>

<style scoped>
@layer components {
  .kyr-guide {
    min-width: 0;
    padding-block-end: clamp(5rem, 10vw, 8rem);
  }

  .kyr-guide :deep(.campaign-editorial-header h1) {
    font-size: var(--font-size-heading-1);
  }

  .kyr-guide-layout {
    display: grid;
    grid-template-columns: minmax(13rem, 3fr) minmax(0, 9fr);
    gap: clamp(2.5rem, 7vw, 7rem);
    align-items: start;
  }

  .kyr-guide-outline {
    position: sticky;
    inset-block-start: var(--space-5);
    padding-block: clamp(4rem, 8vw, 7rem);
  }

  .kyr-guide .kyr-guide-outline :deep(.page-outline-trigger) {
    display: none;
  }

  .kyr-guide-body {
    min-width: 0;
  }

  .kyr-guide-body :deep(.kyr-section) {
    display: grid;
    gap: var(--space-6);
    min-width: 0;
    scroll-margin-block-start: var(--space-5);
    border-block-end: var(--border-width) solid var(--color-divider-strong);
    padding-block: clamp(3.5rem, 7vw, 6rem);
  }

  .kyr-guide-body :deep(.kyr-section-heading),
  .kyr-guide-body :deep(.kyr-section-copy),
  .kyr-guide-body :deep(.kyr-subsection),
  .kyr-guide-body :deep(.kyr-detail),
  .kyr-guide-body :deep(.kyr-warning),
  .kyr-guide-body :deep(.kyr-note) {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }

  .kyr-guide-body :deep(.kyr-section-heading h2) {
    max-inline-size: 24ch;
    min-width: 0;
    margin: 0;
    color: var(--color-brand-primary);
    font-family: var(--font-family-heading);
    font-size: clamp(2rem, 1.65rem + 1.1vw, 3rem);
    font-weight: var(--font-weight-bold);
    letter-spacing: -0.035em;
    line-height: 1.08;
    overflow-wrap: anywhere;
    text-wrap: balance;
  }

  .kyr-guide-body :deep(.kyr-section-heading > p),
  .kyr-guide-body :deep(.kyr-section-copy > p),
  .kyr-guide-body :deep(.kyr-subsection > p),
  .kyr-guide-body :deep(.kyr-warning > p),
  .kyr-guide-body :deep(.kyr-note > p) {
    max-inline-size: 70ch;
    margin: 0;
    color: var(--color-text);
    font-size: 1rem;
    line-height: 1.75;
    overflow-wrap: anywhere;
    text-wrap: pretty;
  }

  .kyr-guide-body :deep(.kyr-section-heading > p) {
    color: var(--color-text-muted);
    font-size: clamp(1.0625rem, 1rem + 0.25vw, 1.2rem);
  }

  .kyr-guide-body :deep(.kyr-subsection h3),
  .kyr-guide-body :deep(.kyr-detail h4),
  .kyr-guide-body :deep(.kyr-warning h3),
  .kyr-guide-body :deep(.kyr-note h3),
  .kyr-guide-body :deep(.kyr-topic-list dt),
  .kyr-guide-body :deep(.kyr-definition-list dt) {
    margin: 0;
    color: var(--color-brand-primary);
    font-family: var(--font-family-heading);
    font-size: 1.125rem;
    font-weight: var(--font-weight-bold);
    line-height: 1.35;
    overflow-wrap: anywhere;
    text-wrap: balance;
  }

  .kyr-guide-body :deep(.kyr-detail h4) {
    font-size: 1rem;
  }

  .kyr-guide-body :deep(.kyr-list-label) {
    color: var(--color-brand-primary);
    font-weight: var(--font-weight-bold);
  }

  .kyr-guide-body :deep(.kyr-list) {
    display: grid;
    gap: var(--space-2);
    max-inline-size: 70ch;
    padding-inline-start: 1.35rem;
    margin: 0;
  }

  .kyr-guide-body :deep(.kyr-list li) {
    padding-inline-start: var(--space-1);
    color: var(--color-text);
    font-size: 1rem;
    line-height: 1.7;
    overflow-wrap: anywhere;
  }

  .kyr-guide-body :deep(.kyr-procedure) {
    padding-inline-start: 1.75rem;
    margin: 0;
  }

  .kyr-guide-body :deep(.kyr-procedure > li) {
    padding-inline-start: var(--space-3);
  }

  .kyr-guide-body :deep(.kyr-procedure > li::marker) {
    color: var(--color-brand-primary);
    font-size: 1rem;
    font-weight: var(--font-weight-bold);
  }

  .kyr-guide-body :deep(.kyr-topic-list),
  .kyr-guide-body :deep(.kyr-definition-list) {
    display: grid;
    padding: 0;
    margin: 0;
  }

  .kyr-guide-body :deep(.kyr-topic-list > div) {
    display: grid;
    grid-template-columns: minmax(10rem, 4fr) minmax(0, 8fr);
    gap: clamp(1.5rem, 4vw, 4rem);
    border-block-start: var(--border-width) solid var(--color-divider);
    padding-block: var(--space-5);
  }

  .kyr-guide-body :deep(.kyr-topic-list > div:last-child) {
    border-block-end: var(--border-width) solid var(--color-divider);
  }

  .kyr-guide-body :deep(.kyr-topic-list dd),
  .kyr-guide-body :deep(.kyr-definition-list dd) {
    max-inline-size: 70ch;
    margin: 0;
    color: var(--color-text);
    font-size: 1rem;
    line-height: 1.7;
    overflow-wrap: anywhere;
    text-wrap: pretty;
  }

  .kyr-guide-body :deep(.kyr-examples) {
    display: block;
    margin-block-start: var(--space-2);
    color: var(--color-text-muted);
    font-weight: var(--font-weight-bold);
  }

  .kyr-guide-body :deep(.kyr-pair),
  .kyr-guide-body :deep(.kyr-comparison),
  .kyr-guide-body :deep(.kyr-status-grid) {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0;
    min-width: 0;
  }

  .kyr-guide-body :deep(.kyr-pair > *),
  .kyr-guide-body :deep(.kyr-comparison > *) {
    min-width: 0;
    padding: var(--space-5);
    border-block: var(--border-width) solid var(--color-divider);
  }

  .kyr-guide-body :deep(.kyr-pair > *:first-child),
  .kyr-guide-body :deep(.kyr-comparison > *:first-child) {
    padding-inline-start: 0;
  }

  .kyr-guide-body :deep(.kyr-pair > *:last-child),
  .kyr-guide-body :deep(.kyr-comparison > *:last-child) {
    border-inline-start: var(--border-width) solid var(--color-divider);
    padding-inline-end: 0;
  }

  .kyr-guide-body :deep(.kyr-comparison-item) {
    display: grid;
    align-content: start;
    gap: var(--space-3);
  }

  .kyr-guide-body :deep(.kyr-comparison-item > p) {
    margin: 0;
    color: var(--color-brand-primary);
    font-size: 1.125rem;
    font-weight: var(--font-weight-bold);
  }

  .kyr-guide-body :deep(.kyr-comparison-item[data-kind='avoid'] > p) {
    color: var(--color-accent-action);
  }

  .kyr-guide-body :deep(.kyr-warning),
  .kyr-guide-body :deep(.kyr-note) {
    border-inline-start: var(--border-width-accent) solid var(--color-brand-highlight);
    padding: var(--space-3) 0 var(--space-3) var(--space-5);
  }

  .kyr-guide-body :deep(.kyr-warning[data-tone='critical']) {
    border-inline-start-color: var(--color-accent-action);
  }

  .kyr-guide-body :deep(.kyr-note) {
    border-inline-start-color: var(--color-brand-primary);
  }

  .kyr-guide-body :deep(.kyr-status-grid) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .kyr-guide-body :deep(.kyr-status) {
    display: grid;
    align-content: start;
    gap: var(--space-5);
    min-width: 0;
    padding-inline: var(--space-5);
  }

  .kyr-guide-body :deep(.kyr-status:first-child) {
    padding-inline-start: 0;
  }

  .kyr-guide-body :deep(.kyr-status:last-child) {
    padding-inline-end: 0;
  }

  .kyr-guide-body :deep(.kyr-status + .kyr-status) {
    border-inline-start: var(--border-width) solid var(--color-divider);
  }

  .kyr-guide-body :deep(.kyr-status h3) {
    margin: 0;
    color: var(--color-brand-primary);
    font-size: 1.35rem;
    line-height: 1.25;
    text-wrap: balance;
  }

  .kyr-guide-body :deep(.kyr-status > div:first-child) {
    display: grid;
    gap: var(--space-2);
  }

  .kyr-guide-body :deep(.kyr-status-label) {
    margin: 0;
    color: var(--color-accent-action);
    font-size: 0.875rem;
    font-weight: var(--font-weight-bold);
  }

  .kyr-guide-body :deep(.kyr-definition-list) {
    gap: var(--space-5);
  }

  .kyr-guide-body :deep(.kyr-definition-list > div) {
    display: grid;
    gap: var(--space-2);
  }

  .kyr-guide-body :deep(.kyr-definition-list dt) {
    color: var(--color-text-muted);
    font-size: 0.875rem;
  }

  .kyr-guide-body :deep(.kyr-table-scroll) {
    max-inline-size: 100%;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
  }

  .kyr-guide-body :deep(.kyr-table-scroll:focus-visible) {
    outline: var(--focus-outline);
    outline-offset: var(--focus-offset);
  }

  .kyr-guide-body :deep(.kyr-table) {
    min-inline-size: 42rem;
    border-block: var(--border-width) solid var(--color-divider-strong);
  }

  .kyr-guide-body :deep(.kyr-table th),
  .kyr-guide-body :deep(.kyr-table td) {
    border-block-end: var(--border-width) solid var(--color-divider);
    padding: var(--space-3);
    color: var(--color-text);
    font-size: 1rem;
    line-height: 1.55;
    overflow-wrap: anywhere;
  }

  .kyr-guide-body :deep(.kyr-table th) {
    color: var(--color-brand-primary);
    font-weight: var(--font-weight-bold);
    white-space: nowrap;
  }

  .kyr-related-guides {
    display: grid;
    gap: var(--space-6);
    border-block-start: var(--border-width) solid var(--color-divider-strong);
    padding-block-start: clamp(3.5rem, 7vw, 6rem);
  }

  .kyr-related-heading {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-5);
    align-items: end;
  }

  .kyr-related-heading > div {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }

  .kyr-related-heading p,
  .kyr-related-heading h2 {
    margin: 0;
  }

  .kyr-related-heading p {
    color: var(--color-text-muted);
    font-size: 0.875rem;
    font-weight: var(--font-weight-bold);
  }

  .kyr-related-heading h2 {
    max-inline-size: 28ch;
    font-size: clamp(1.75rem, 1.5rem + 0.8vw, 2.4rem);
    text-wrap: balance;
  }

  .kyr-related-guides ul {
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .kyr-related-guides li {
    border-block-start: var(--border-width) solid var(--color-divider);
  }

  .kyr-related-guides li:last-child {
    border-block-end: var(--border-width) solid var(--color-divider);
  }

  .kyr-related-guides li a {
    display: grid;
    grid-template-columns: minmax(12rem, 4fr) minmax(0, 7fr) auto;
    gap: clamp(1rem, 3vw, 3rem);
    align-items: center;
    min-block-size: var(--control-min-block-size);
    padding-block: var(--space-4);
    color: var(--color-text);
    text-decoration: none;
  }

  .kyr-related-guides li a > span:first-child {
    color: var(--color-brand-primary);
    font-weight: var(--font-weight-bold);
  }

  .kyr-related-guides li a > span:nth-child(2) {
    color: var(--color-text-muted);
  }

  .kyr-related-guides li a > span:last-child {
    color: var(--color-accent-action);
    font-size: 1.25rem;
  }

  .kyr-related-guides li a:hover,
  .kyr-related-guides li a:focus-visible {
    background: var(--color-action-soft);
  }

  @media (width <= 64rem) {
    .kyr-guide-body :deep(.kyr-status-grid) {
      grid-template-columns: minmax(0, 1fr);
    }

    .kyr-guide-body :deep(.kyr-status) {
      padding: var(--space-5) 0;
    }

    .kyr-guide-body :deep(.kyr-status + .kyr-status) {
      border-block-start: var(--border-width) solid var(--color-divider);
      border-inline-start: 0;
    }
  }

  @media (width <= 56rem) {
    .kyr-guide-layout {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
    }

    .kyr-guide-outline {
      position: static;
      block-size: auto;
      padding: var(--space-5) 0 0;
    }

    .kyr-guide .kyr-guide-outline :deep(.page-outline-trigger) {
      position: static;
      z-index: auto;
      display: inline-flex;
      border-radius: var(--radius-1);
      box-shadow: none;
    }
  }

  @media (width <= 44rem) {
    .kyr-guide-body :deep(.kyr-topic-list > div),
    .kyr-guide-body :deep(.kyr-pair),
    .kyr-guide-body :deep(.kyr-comparison),
    .kyr-related-heading,
    .kyr-related-guides li a {
      grid-template-columns: minmax(0, 1fr);
    }

    .kyr-guide-body :deep(.kyr-pair > *),
    .kyr-guide-body :deep(.kyr-comparison > *) {
      border-block: 0;
      padding: var(--space-5) 0;
    }

    .kyr-guide-body :deep(.kyr-pair > *:first-child),
    .kyr-guide-body :deep(.kyr-comparison > *:first-child) {
      border-block-start: var(--border-width) solid var(--color-divider);
    }

    .kyr-guide-body :deep(.kyr-pair > *:last-child),
    .kyr-guide-body :deep(.kyr-comparison > *:last-child) {
      border-block: var(--border-width) solid var(--color-divider);
      border-inline-start: 0;
    }

    .kyr-related-heading {
      align-items: start;
    }

    .kyr-related-guides li a {
      gap: var(--space-2);
    }

    .kyr-related-guides li a > span:last-child {
      display: none;
    }
  }
}
</style>
