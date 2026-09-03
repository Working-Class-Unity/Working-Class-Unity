<script setup lang="ts">
import {
  campaignCitationOccurrenceLabel,
  type CampaignCitationOccurrence,
  type CampaignSource
} from '~/content/remove-flock-stockton'

const props = defineProps<{
  citations: readonly CampaignCitationOccurrence[]
  idPrefix: string
  sources: readonly CampaignSource[]
}>()

const citationsBySource = computed(() => {
  const grouped = new Map<string, CampaignCitationOccurrence[]>()

  for (const citation of props.citations) {
    const citations = grouped.get(citation.sourceId) ?? []
    citations.push(citation)
    grouped.set(citation.sourceId, citations)
  }

  return grouped
})

function noteId(source: CampaignSource) {
  return `${props.idPrefix}-note-${source.id}`
}

function sourceTypeFor(source: CampaignSource) {
  if (source.sourceType) return source.sourceType
  if (source.publisher === 'City of Stockton') return 'Stockton record'
  if (source.publisher === 'Flock Safety') return 'Vendor source'
  if (source.publisher === 'Stocktonia' || source.publisher === '404 Media') return 'Press report'
  return 'Official legal/policy source'
}

function citationsFor(sourceId: string) {
  return citationsBySource.value.get(sourceId) ?? []
}

function occurrenceLabel(sourceNumber: number, occurrence: CampaignCitationOccurrence) {
  return campaignCitationOccurrenceLabel(sourceNumber, occurrence, props.citations)
}

function backlinkAccessibleName(sourceNumber: number, occurrence: CampaignCitationOccurrence) {
  const citationLabel = `Return to citation ${occurrenceLabel(sourceNumber, occurrence)}`

  return occurrence.locator ? `${citationLabel}, ${occurrence.locator}` : citationLabel
}

function focusCitation(citationId: string) {
  requestAnimationFrame(() => {
    document.getElementById(citationId)?.focus({ preventScroll: true })
  })
}
</script>

<template>
  <section
    class="campaign-source-register"
    :aria-labelledby="`${idPrefix}-source-register-title`"
    role="doc-bibliography"
  >
    <div class="campaign-source-register-heading">
      <p>SOURCE REGISTER</p>
      <h2 :id="`${idPrefix}-source-register-title`">Sources and notes</h2>
      <p>Sources are numbered by first appearance. Return links lead back to the exact cited claim.</p>
    </div>
    <ol role="list">
      <li v-for="(source, sourceIndex) in sources" :id="noteId(source)" :key="source.id" tabindex="-1">
        <span class="campaign-source-type">{{ sourceTypeFor(source) }}</span>
        <cite>
          <a class="campaign-source-title" :href="source.url" target="_blank" rel="noopener noreferrer">
            {{ source.title }}
          </a>
        </cite>
        <p class="campaign-source-metadata">
          {{ source.publisher }}<template v-if="source.published"> · Published {{ source.published }}</template
          ><template v-if="source.reviewed"> · Reviewed {{ source.reviewed }}</template>
        </p>
        <p v-if="source.note" class="campaign-source-note">{{ source.note }}</p>
        <nav
          v-if="citationsFor(source.id).length"
          class="campaign-source-backlinks"
          :aria-label="`Return to citations for source ${sourceIndex + 1}`"
        >
          <span>Cited in this page</span>
          <span class="campaign-source-backlink-list">
            <a
              v-for="citation in citationsFor(source.id)"
              :key="citation.id"
              :href="`#${citation.id}`"
              :aria-label="backlinkAccessibleName(sourceIndex + 1, citation)"
              role="doc-backlink"
              @click="focusCitation(citation.id)"
            >
              ↑ {{ occurrenceLabel(sourceIndex + 1, citation)
              }}<template v-if="citation.locator"> · {{ citation.locator }}</template>
            </a>
          </span>
        </nav>
      </li>
    </ol>
  </section>
</template>

<style scoped>
@layer components {
  .campaign-source-register {
    display: grid;
    grid-template-columns: minmax(14rem, 4fr) minmax(0, 8fr);
    gap: clamp(2.5rem, 7vw, 7rem);
    padding-block: clamp(4rem, 8vw, 7rem);
  }

  .campaign-source-register-heading {
    display: grid;
    align-content: start;
    gap: var(--space-3);
  }

  .campaign-source-register-heading > p:first-child {
    margin: 0;
    color: var(--color-accent-action);
    font-family: var(--font-family-mono);
    font-size: 0.8125rem;
    font-weight: var(--font-weight-strong);
    letter-spacing: 0.08em;
  }

  .campaign-source-register-heading > p:last-child {
    max-inline-size: 32ch;
    margin: 0;
    color: var(--color-text-muted);
    font-size: 0.875rem;
    line-height: 1.6;
    text-wrap: pretty;
  }

  .campaign-source-register h2 {
    max-inline-size: 15ch;
    margin: 0;
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: clamp(1.75rem, 1.5rem + 0.8vw, 2.5rem);
    font-weight: 650;
    letter-spacing: -0.045em;
    line-height: 1.05;
    text-wrap: balance;
  }

  .campaign-source-register ol {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
    padding-inline-start: 1.5rem;
    margin: 0;
  }

  .campaign-source-register li {
    min-width: 0;
    scroll-margin-block-start: var(--space-6);
    border-block-start: var(--border-width) solid var(--color-divider-strong);
    border-radius: var(--radius-1);
    padding: var(--space-4) var(--space-3) var(--space-3);
    color: var(--color-text-muted);
  }

  .campaign-source-register li:target {
    background: var(--color-action-soft);
  }

  .campaign-source-register li:focus-visible {
    outline: var(--focus-outline);
    outline-offset: var(--focus-offset);
  }

  .campaign-source-register li::marker {
    color: var(--color-brand-primary);
    font-weight: var(--font-weight-strong);
  }

  .campaign-source-type {
    display: block;
    margin-block-end: var(--space-1);
    color: var(--color-accent-action);
    font-family: var(--font-family-mono);
    font-size: 0.8125rem;
    font-weight: var(--font-weight-strong);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .campaign-source-register cite {
    font-style: normal;
  }

  .campaign-source-title {
    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    min-inline-size: var(--control-min-inline-size);
    align-items: center;
    max-inline-size: 100%;
    overflow-wrap: anywhere;
    color: var(--color-brand-primary);
    font-weight: 650;
    text-underline-offset: 0.2em;
  }

  .campaign-source-metadata,
  .campaign-source-note {
    max-inline-size: 70ch;
    margin: var(--space-1) 0 0;
    color: var(--color-text-muted);
    font-size: 0.875rem;
    line-height: 1.6;
  }

  .campaign-source-metadata {
    font-family: var(--font-family-mono);
  }

  .campaign-source-note {
    font-style: italic;
  }

  .campaign-source-backlinks {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-3);
    align-items: center;
    margin-block-start: var(--space-3);
  }

  .campaign-source-backlinks > span:first-child {
    color: var(--color-text-muted);
    font-family: var(--font-family-mono);
    font-size: 0.8125rem;
    font-weight: var(--font-weight-strong);
  }

  .campaign-source-backlink-list {
    display: flex;
    flex: 1 1 auto;
    flex-wrap: wrap;
    gap: var(--space-2);
    min-width: 0;
  }

  .campaign-source-backlink-list a {
    --anchor-color: var(--color-brand-primary);

    display: inline-flex;
    align-items: center;
    min-block-size: var(--control-min-block-size);
    min-inline-size: var(--control-min-inline-size);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-1);
    padding-inline: var(--space-3);
    color: var(--color-brand-primary);
    background: var(--color-surface);
    font-family: var(--font-family-mono);
    font-size: 0.8125rem;
    font-weight: var(--font-weight-strong);
    text-decoration: none;
  }

  .campaign-source-backlink-list a:hover,
  .campaign-source-backlink-list a:focus-visible {
    --anchor-color: var(--color-action-contrast);

    color: var(--color-action-contrast);
    background: var(--color-brand-primary);
  }

  .campaign-source-backlink-list a:focus-visible {
    outline: var(--focus-outline);
    outline-offset: var(--focus-offset);
  }

  @media (width <= 56rem) {
    .campaign-source-register {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-6);
    }
  }

  @media (width <= 40rem) {
    .campaign-source-register-heading > p:first-child,
    .campaign-source-register-heading > p:last-child,
    .campaign-source-type,
    .campaign-source-metadata,
    .campaign-source-note,
    .campaign-source-backlinks > span:first-child {
      font-size: 1rem;
    }

    .campaign-source-backlink-list {
      flex-basis: 100%;
    }

    .campaign-source-backlink-list a {
      min-block-size: 3rem;
      font-size: 1rem;
    }
  }
}
</style>
