<script setup lang="ts">
import type { CampaignSource } from '~/content/remove-flock-stockton'

const props = defineProps<{
  idPrefix: string
  sources: readonly CampaignSource[]
}>()

function noteId(source: CampaignSource) {
  return `${props.idPrefix}-note-${source.id}`
}

function sourceTypeFor(source: CampaignSource) {
  if (source.sourceType) return source.sourceType
  if (source.publisher === 'City of Stockton') return 'Stockton record'
  if (source.publisher === 'Stocktonia' || source.publisher === '404 Media') return 'Press report'
  return 'Official legal/policy source'
}
</script>

<template>
  <section class="campaign-source-register" :aria-labelledby="`${idPrefix}-source-register-title`">
    <div>
      <p>SOURCE REGISTER</p>
      <h2 :id="`${idPrefix}-source-register-title`">Sources and notes</h2>
      <p>Numbered sources match the citations in the text.</p>
    </div>
    <ol>
      <li v-for="source in sources" :id="noteId(source)" :key="source.id" tabindex="-1">
        <span class="campaign-source-type">{{ sourceTypeFor(source) }}</span>
        <a :href="source.url" target="_blank" rel="noreferrer">{{ source.title }}</a>
        <span
          >{{ source.publisher }}<template v-if="source.published"> · {{ source.published }}</template></span
        >
        <span v-if="source.note" class="campaign-source-note">{{ source.note }}</span>
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

  .campaign-source-register > div {
    display: grid;
    align-content: start;
    gap: var(--space-3);
  }

  .campaign-source-register > div > p:first-child {
    margin: 0;
    color: var(--color-accent-action);
    font-family: var(--font-family-mono);
    font-size: 0.8125rem;
    font-weight: var(--font-weight-strong);
    letter-spacing: 0.08em;
  }

  .campaign-source-register > div > p:last-child {
    max-inline-size: 28ch;
    margin: 0;
    color: var(--color-text-muted);
    font-size: 0.875rem;
    line-height: 1.6;
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
    gap: var(--space-4);
    padding-inline-start: 1.5rem;
    margin: 0;
  }

  .campaign-source-register li {
    scroll-margin-block-start: var(--space-6);
    padding-inline-start: var(--space-2);
    color: var(--color-text-muted);
  }

  .campaign-source-register li:focus {
    outline: none;
  }

  .campaign-source-register li::marker {
    color: var(--color-brand-primary);
    font-weight: var(--font-weight-strong);
  }

  .campaign-source-register li span {
    display: block;
    margin-block-start: var(--space-1);
    font-size: 0.875rem;
  }

  .campaign-source-register li .campaign-source-type {
    margin-block: 0 var(--space-1);
    color: var(--color-accent-action);
    font-family: var(--font-family-mono);
    font-size: 0.6875rem;
    font-weight: var(--font-weight-strong);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .campaign-source-register a {
    color: var(--color-brand-primary);
    font-weight: 650;
    text-underline-offset: 0.2em;
  }

  .campaign-source-register li .campaign-source-note {
    max-inline-size: 70ch;
    color: var(--color-text-muted);
    font-style: italic;
  }

  @media (width <= 56rem) {
    .campaign-source-register {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-6);
    }
  }

  @media (width <= 40rem) {
    .campaign-source-register > div > p:first-child,
    .campaign-source-register li span {
      font-size: 1rem;
    }
  }
}
</style>
