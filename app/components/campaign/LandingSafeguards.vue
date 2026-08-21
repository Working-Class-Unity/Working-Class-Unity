<script setup lang="ts">
import CampaignLandingSectionHeading from '~/components/campaign/LandingSectionHeading.vue'
import {
  citedTextParts,
  citedTextPlainText,
  type CampaignSection,
  type CampaignSource,
  type CitedText
} from '~/content/remove-flock-stockton'

const props = defineProps<{
  section: CampaignSection
  sources: readonly CampaignSource[]
}>()

const sourcesById = new Map(props.sources.map((source) => [source.id, source]))

function sourcesFor(content: CitedText) {
  const sourceIds = new Set(
    citedTextParts(content).flatMap((part) => (part.citations ?? []).map((citation) => citation.sourceId))
  )

  return [...sourceIds].map((sourceId) => {
    const source = sourcesById.get(sourceId)
    if (!source) throw new Error(`Unknown campaign source: ${sourceId}`)
    return source
  })
}
</script>

<template>
  <section class="campaign-safeguards" aria-labelledby="campaign-safeguards-title">
    <CampaignLandingSectionHeading
      eyebrow="03 / WHY REMOVAL"
      :title="section.title"
      title-id="campaign-safeguards-title"
    />

    <div class="campaign-safeguards-copy">
      <p class="campaign-safeguards-lead">{{ section.summary }}</p>
      <div v-for="paragraph in section.paragraphs" :key="citedTextPlainText(paragraph)" class="campaign-cited-copy">
        <p>{{ citedTextPlainText(paragraph) }}</p>
        <p v-if="sourcesFor(paragraph).length" class="campaign-source-links">
          <a
            v-for="source in sourcesFor(paragraph)"
            :key="source.id"
            :href="source.url"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ source.title }}
          </a>
        </p>
      </div>
      <NuxtLink class="campaign-safeguards-action" to="/campaigns/remove-flock-stockton/why-safeguards-are-not-enough">
        Read the full case for removal
      </NuxtLink>
    </div>
  </section>
</template>

<style scoped>
@layer components {
  .campaign-safeguards {
    display: grid;
    grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
    gap: var(--campaign-grid-gap);
  }

  .campaign-safeguards-copy {
    display: grid;
    align-content: start;
    gap: var(--space-5);
  }

  .campaign-safeguards-copy p {
    max-inline-size: 64ch;
    margin: 0;
    color: var(--color-text-muted);
    font-size: 1rem;
    line-height: 1.7;
    text-wrap: pretty;
  }

  .campaign-safeguards-copy .campaign-safeguards-lead {
    color: var(--color-text);
    font-size: 1.25rem;
    font-weight: 600;
    line-height: 1.55;
  }

  .campaign-cited-copy {
    display: grid;
    gap: var(--space-2);
  }

  .campaign-cited-copy .campaign-source-links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-3);
    border-inline-start: var(--border-width) solid var(--campaign-divider);
    padding-inline-start: var(--space-3);
    font-size: 0.8125rem;
  }

  .campaign-source-links a {
    color: var(--color-brand-primary);
    font-weight: 650;
    text-underline-offset: 0.2em;
  }

  .campaign-source-links a:focus-visible {
    outline: var(--focus-outline);
    outline-offset: var(--focus-offset);
  }

  .campaign-safeguards-action {
    display: inline-flex;
    min-block-size: 3.25rem;
    align-items: center;
    justify-content: center;
    border: 2px solid var(--color-brand-primary);
    border-radius: var(--radius-2);
    padding-inline: var(--space-4);
    color: var(--color-brand-primary);
    background: transparent;
    font-weight: var(--font-weight-bold);
    text-align: center;
    text-decoration: none;
  }

  .campaign-safeguards-action:hover,
  .campaign-safeguards-action:focus-visible {
    color: var(--color-brand-primary);
    background: var(--color-action-soft);
  }

  .campaign-safeguards-action:focus-visible {
    outline: var(--focus-outline);
    outline-offset: var(--focus-offset);
  }

  @media (width <= 46rem) {
    .campaign-safeguards {
      grid-template-columns: minmax(0, 1fr);
    }

    .campaign-safeguards-action {
      inline-size: 100%;
    }

    .campaign-cited-copy .campaign-source-links {
      font-size: 1rem;
    }
  }
}
</style>
