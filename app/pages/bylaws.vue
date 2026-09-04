<script setup lang="ts">
import { bylawsArticles, bylawsSource } from '~/content/bylaws'

const { t } = useI18n()
const localizedArticles = useLocalizedContent(bylawsArticles, 'localizedBylaws.articles')

const outlineItems = computed(() =>
  localizedArticles.value.map((article) => ({
    id: article.id,
    label: article.title,
    marker: article.number,
    children: article.sections.map((section) => ({
      id: section.id,
      label: section.title,
      marker: section.number
    }))
  }))
)

useHead(() => ({
  title: t('metadata.bylaws.title'),
  meta: [{ name: 'description', content: t('metadata.bylaws.description') }]
}))
</script>

<template>
  <div class="bylaws-page">
    <header class="bylaws-header-grid">
      <div class="bylaws-header">
        <p class="bylaws-eyebrow">{{ t('publicPages.bylaws.eyebrow') }}</p>
        <h1>{{ t('publicPages.bylaws.title') }}</h1>
        <p class="bylaws-introduction">{{ t('publicPages.bylaws.introduction') }}</p>
        <div class="bylaws-source">
          <a :href="bylawsSource.url">{{ t('publicPages.bylaws.sourceAction') }}</a>
          <span>{{ t('publicPages.bylaws.sourceUpdated') }}</span>
        </div>
      </div>
    </header>

    <div class="bylaws-layout">
      <BylawsPageOutline
        :items="outlineItems"
        :label="t('publicPages.bylaws.outline.label')"
        :title="t('publicPages.bylaws.outline.title')"
        :description="t('publicPages.bylaws.outline.description')"
        :trigger-label="t('publicPages.bylaws.outline.trigger')"
        :close-label="t('publicPages.bylaws.outline.close')"
      />

      <article class="bylaws-document" :aria-label="t('publicPages.bylaws.documentLabel')">
        <section
          v-for="article in localizedArticles"
          :id="article.id"
          :key="article.id"
          class="bylaws-article"
          :aria-labelledby="`${article.id}-title`"
        >
          <header class="bylaws-article-heading">
            <p>{{ t('publicPages.bylaws.articleLabel', { number: article.number }) }}</p>
            <h2 :id="`${article.id}-title`">{{ article.title }}</h2>
          </header>

          <BylawsContentBlocks v-if="article.blocks.length" :blocks="article.blocks" />

          <div v-if="article.sections.length" class="bylaws-sections">
            <section
              v-for="section in article.sections"
              :id="section.id"
              :key="section.id"
              class="bylaws-section"
              :aria-labelledby="`${section.id}-title`"
            >
              <header class="bylaws-section-heading">
                <p>{{ t('publicPages.bylaws.sectionLabel', { number: section.number }) }}</p>
                <h3 :id="`${section.id}-title`">{{ section.title }}</h3>
              </header>
              <BylawsContentBlocks :blocks="section.blocks" />
            </section>
          </div>
        </section>
      </article>
    </div>
  </div>
</template>

<style scoped>
@layer components {
  .bylaws-page {
    --bylaws-sidebar-width: minmax(13rem, 16rem);
    --bylaws-reading-width: minmax(0, 48rem);
    --bylaws-column-gap: clamp(3rem, 7vw, 7rem);

    min-width: 0;
  }

  .bylaws-header-grid,
  .bylaws-layout {
    display: grid;
    grid-template-columns: var(--bylaws-sidebar-width) var(--bylaws-reading-width);
    column-gap: var(--bylaws-column-gap);
    justify-content: center;
    min-width: 0;
  }

  .bylaws-header-grid {
    padding-block: clamp(4rem, 8vw, 7rem);
  }

  .bylaws-header {
    grid-column: 2;
    display: grid;
    gap: var(--space-5);
    min-width: 0;
  }

  .bylaws-eyebrow,
  .bylaws-article-heading p,
  .bylaws-section-heading p {
    margin: 0;
    color: var(--color-accent-action);
    font-family: var(--font-family-mono);
    font-size: 0.8125rem;
    font-weight: var(--font-weight-strong);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .bylaws-header h1 {
    max-inline-size: 13ch;
    margin: 0;
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: clamp(3rem, 2rem + 4vw, 5.75rem);
    font-stretch: 112%;
    font-weight: 650;
    letter-spacing: -0.055em;
    text-wrap: pretty;
  }

  .bylaws-introduction {
    max-inline-size: 63ch;
    margin: 0;
    color: var(--color-text);
    font-size: clamp(1.125rem, 1rem + 0.4vw, 1.35rem);
    line-height: 1.65;
    text-wrap: pretty;
  }

  .bylaws-source {
    display: flex;
    align-items: baseline;
    gap: var(--space-3) var(--space-5);
    flex-wrap: wrap;
    border-block-start: var(--border-width) solid var(--color-divider-strong);
    padding-block-start: var(--space-4);
    color: var(--color-text-muted);
    font-size: 0.875rem;
  }

  .bylaws-source a {
    color: var(--color-brand-primary);
    font-weight: var(--font-weight-strong);
  }

  .bylaws-source a:hover,
  .bylaws-source a:focus-visible {
    color: var(--color-accent-action);
  }

  .bylaws-layout {
    align-items: start;
    padding-block-end: clamp(5rem, 10vw, 9rem);
  }

  .bylaws-document {
    min-width: 0;
  }

  .bylaws-article {
    display: grid;
    gap: var(--space-6);
    border-block-start: var(--border-width) solid var(--color-divider-strong);
    padding-block: clamp(3.5rem, 7vw, 6rem);
    scroll-margin-block-start: var(--space-5);
  }

  .bylaws-article:first-child {
    border-block-start-color: var(--color-brand-highlight);
  }

  .bylaws-article-heading,
  .bylaws-section-heading {
    display: grid;
    gap: var(--space-2);
  }

  .bylaws-article-heading h2,
  .bylaws-section-heading h3 {
    margin: 0;
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-stretch: 110%;
    font-weight: 650;
    letter-spacing: -0.04em;
    text-wrap: balance;
  }

  .bylaws-article-heading h2 {
    font-size: clamp(2.25rem, 1.8rem + 1.5vw, 3.35rem);
  }

  .bylaws-sections {
    display: grid;
    gap: clamp(3rem, 6vw, 5rem);
  }

  .bylaws-section {
    display: grid;
    gap: var(--space-5);
    scroll-margin-block-start: var(--space-5);
  }

  .bylaws-section-heading {
    border-inline-start: var(--border-width-accent) solid var(--color-brand-highlight);
    padding-inline-start: var(--space-4);
  }

  .bylaws-section-heading h3 {
    font-size: clamp(1.45rem, 1.25rem + 0.65vw, 2rem);
  }

  @media (width <= 56rem) {
    .bylaws-page {
      --bylaws-column-gap: 0;
    }

    .bylaws-header-grid,
    .bylaws-layout {
      grid-template-columns: minmax(0, 1fr);
    }

    .bylaws-header {
      grid-column: 1;
    }

    .bylaws-header h1 {
      font-size: clamp(2.75rem, 13vw, 4.75rem);
    }

    .bylaws-layout {
      display: block;
    }
  }

  @media (width <= 32rem) {
    .bylaws-header-grid {
      padding-block: var(--space-7) clamp(3.5rem, 14vw, 5rem);
    }

    .bylaws-source {
      display: grid;
    }

    .bylaws-article {
      padding-block: var(--space-7) clamp(3.5rem, 14vw, 5rem);
    }
  }
}
</style>
