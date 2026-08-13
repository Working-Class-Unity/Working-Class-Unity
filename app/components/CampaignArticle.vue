<script setup lang="ts">
import type { CampaignPageContent } from '~/content/remove-flock-stockton'

const props = defineProps<{
  content: CampaignPageContent
  titleId: string
}>()

const sourceById = computed(() => new Map(props.content.sources.map((source) => [source.id, source])))
const articleSections = computed(() => props.content.sections.filter((section) => section.id !== 'sources'))
const outlineItems = computed(() => [
  ...articleSections.value.map((section) => ({ id: section.id, label: section.title })),
  { id: `${props.titleId}-source-register-title`, label: 'Sources and notes' }
])
const sourceNumberById = computed(() => new Map(props.content.sources.map((source, index) => [source.id, index + 1])))

function sourcesFor(sourceIds: readonly string[] | undefined) {
  return (sourceIds ?? []).map((id) => sourceById.value.get(id)).filter((source) => source !== undefined)
}

function noteId(sourceId: string) {
  return `${props.titleId}-note-${sourceId}`
}
</script>

<template>
  <article class="campaign-article" :aria-labelledby="titleId">
    <header class="campaign-article-header">
      <p class="campaign-article-eyebrow">{{ content.eyebrow }}</p>
      <h1 :id="titleId">{{ content.title }}</h1>
      <p class="campaign-article-description">{{ content.description }}</p>
      <p v-if="content.qualification" class="campaign-article-qualification">{{ content.qualification }}</p>
      <p v-if="content.reviewedThrough" class="campaign-article-reviewed">
        Last materially updated: {{ content.reviewedThrough }}.
      </p>
      <slot name="after-header" />
    </header>

    <div class="campaign-article-layout">
      <CampaignPageOutline :items="outlineItems" :label="`${content.title} sections`" />

      <div class="campaign-article-body">
        <section
          v-for="(section, index) in articleSections"
          :id="section.id"
          :key="section.id"
          class="campaign-article-section"
          :aria-labelledby="`${section.id}-title`"
        >
          <div class="campaign-article-section-heading">
            <p>{{ String(index + 1).padStart(2, '0') }}</p>
            <h2 :id="`${section.id}-title`">{{ section.title }}</h2>
            <p>{{ section.summary }}</p>
          </div>

          <slot :name="`section-${section.id}`" :section="section">
            <div v-if="section.paragraphs?.length" class="campaign-article-prose">
              <div v-for="paragraph in section.paragraphs" :key="paragraph.text" class="campaign-cited-paragraph">
                <p>
                  {{ paragraph.text }}
                  <CampaignCitation
                    v-for="source in sourcesFor(paragraph.sourceIds)"
                    :key="source.id"
                    :number="sourceNumberById.get(source.id)!"
                    :note-id="noteId(source.id)"
                    :source="source"
                  />
                </p>
              </div>
            </div>

            <ul v-if="section.points?.length" class="campaign-article-points" role="list">
              <li v-for="point in section.points" :key="point.text">
                <p>
                  {{ point.text }}
                  <CampaignCitation
                    v-for="source in sourcesFor(point.sourceIds)"
                    :key="source.id"
                    :number="sourceNumberById.get(source.id)!"
                    :note-id="noteId(source.id)"
                    :source="source"
                  />
                </p>
              </li>
            </ul>
          </slot>
        </section>
      </div>
    </div>

    <CampaignSourceNotes :id-prefix="titleId" :sources="content.sources" />
  </article>
</template>

<style scoped>
@layer components {
  .campaign-article {
    --article-divider: rgb(4 51 79 / 18%);

    min-width: 0;
    padding-block-end: clamp(4rem, 8vw, 7rem);
  }

  .campaign-article-header {
    display: grid;
    justify-items: start;
    gap: var(--space-5);
    border-block-end: var(--border-width) solid var(--article-divider);
    padding-block: clamp(4rem, 9vw, 8rem);
  }

  .campaign-article-eyebrow,
  .campaign-article-section-heading > p:first-child {
    margin: 0;
    color: var(--color-accent-action);
    font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
    font-size: 0.8125rem;
    font-weight: var(--font-weight-strong);
    letter-spacing: 0.08em;
  }

  .campaign-article-header h1,
  .campaign-article-section h2 {
    margin: 0;
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-weight: 650;
    letter-spacing: -0.045em;
    text-wrap: balance;
  }

  .campaign-article-header h1 {
    max-inline-size: 18ch;
    font-size: clamp(3rem, 2.1rem + 3.5vw, 6rem);
    line-height: 0.98;
  }

  .campaign-article-description {
    max-inline-size: 62ch;
    margin: 0;
    color: var(--color-text);
    font-size: clamp(1.25rem, 1.1rem + 0.45vw, 1.5rem);
    line-height: 1.55;
    text-wrap: pretty;
  }

  .campaign-article-qualification {
    max-inline-size: 72ch;
    margin: var(--space-2) 0 0;
    border-inline-start: var(--border-width-accent) solid var(--color-brand-highlight);
    padding-inline-start: var(--space-4);
    color: var(--color-text-muted);
    font-size: 1rem;
    line-height: 1.75;
    text-wrap: pretty;
  }

  .campaign-article-reviewed {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 1rem;
  }

  .campaign-article-layout {
    display: grid;
    grid-template-columns: minmax(13rem, 3fr) minmax(0, 9fr);
    gap: clamp(2.5rem, 7vw, 7rem);
    align-items: start;
  }

  .campaign-article-body {
    min-width: 0;
  }

  .campaign-article-section {
    display: grid;
    gap: clamp(2rem, 5vw, 4rem);
    scroll-margin-block-start: var(--space-5);
    border-block-end: var(--border-width) solid var(--article-divider);
    padding-block: clamp(4rem, 8vw, 7rem);
  }

  .campaign-article-section-heading {
    display: grid;
    gap: var(--space-4);
  }

  .campaign-article-section h2 {
    max-inline-size: 24ch;
    font-size: clamp(2rem, 1.6rem + 1.5vw, 3.25rem);
    line-height: 1.02;
  }

  .campaign-article-section-heading > p:last-child {
    max-inline-size: 62ch;
    margin: 0;
    color: var(--color-text-muted);
    font-size: 1.125rem;
    line-height: 1.65;
    text-wrap: pretty;
  }

  .campaign-article-prose {
    display: grid;
    gap: var(--space-5);
  }

  .campaign-cited-paragraph {
    display: grid;
    gap: var(--space-2);
  }

  .campaign-cited-paragraph > p:first-child,
  .campaign-article-points > li > p:first-child {
    max-inline-size: 70ch;
    margin: 0;
    color: var(--color-text);
    font-size: 1rem;
    line-height: 1.8;
    text-wrap: pretty;
  }

  .campaign-article-points {
    display: grid;
    gap: 0;
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .campaign-article-points li {
    display: grid;
    gap: var(--space-2);
    border-block-start: var(--border-width) solid var(--article-divider);
    padding-block: var(--space-5);
  }

  .campaign-article-points li:last-child {
    padding-block-end: 0;
  }

  @media (width <= 56rem) {
    .campaign-article-layout {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
    }
  }

  @media (width <= 40rem) {
    .campaign-article-header h1 {
      font-size: clamp(2.75rem, 14vw, 4.25rem);
    }

    .campaign-article-eyebrow,
    .campaign-article-section-heading > p:first-child {
      font-size: 1rem;
    }
  }
}
</style>
