<script setup lang="ts">
import CampaignLandingSectionHeading from '~/components/campaign/LandingSectionHeading.vue'
import { citedTextPlainText, type CampaignSection } from '~/content/remove-flock-stockton'

defineProps<{
  section: CampaignSection
}>()

const safetyLabels = ['Stable homes', 'Safe work and public space', 'Care and prevention', 'Public control'] as const

function pointDetail(text: string) {
  const separator = text.indexOf(':')
  return separator === -1 ? text : text.slice(separator + 1).trim()
}
</script>

<template>
  <section class="campaign-safety" aria-labelledby="real-safety-title">
    <CampaignLandingSectionHeading
      eyebrow="05 / WHAT WE BUILD"
      :summary="section.summary"
      :title="section.title"
      title-id="real-safety-title"
    />

    <dl class="campaign-safety-list">
      <div v-for="(point, index) in section.points" :key="citedTextPlainText(point)">
        <dt>{{ safetyLabels[index] }}</dt>
        <dd>{{ pointDetail(citedTextPlainText(point)) }}</dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
@layer components {
  .campaign-safety {
    display: grid;
    gap: clamp(3rem, 6vw, 6rem);
  }

  .campaign-safety-list {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0;
    margin: 0;
  }

  .campaign-safety-list > div {
    display: grid;
    align-content: start;
    gap: var(--space-3);
    min-width: 0;
    border-inline-start: var(--border-width) solid var(--campaign-divider);
    padding-inline: var(--space-5);
  }

  .campaign-safety-list > div:first-child {
    border-inline-start: 0;
    padding-inline-start: 0;
  }

  .campaign-safety-list > div:last-child {
    padding-inline-end: 0;
  }

  .campaign-safety-list dt {
    color: var(--color-brand-primary);
    font-weight: var(--font-weight-strong);
  }

  .campaign-safety-list dd {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 1rem;
    line-height: 1.7;
    text-wrap: pretty;
  }

  @media (width <= 68rem) {
    .campaign-safety-list {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .campaign-safety-list > div:nth-child(3) {
      border-inline-start: 0;
      padding-inline-start: 0;
    }

    .campaign-safety-list > div:nth-child(n + 3) {
      border-block-start: var(--border-width) solid var(--campaign-divider);
      padding-block-start: var(--space-5);
    }
  }

  @media (width <= 46rem) {
    .campaign-safety-list {
      grid-template-columns: minmax(0, 1fr);
    }

    .campaign-safety-list > div {
      border-block-start: var(--border-width) solid var(--campaign-divider);
      border-inline-start: 0;
      padding-inline: 0;
      padding-block: var(--space-5);
    }

    .campaign-safety-list > div:first-child {
      border-block-start: 0;
      padding-block-start: 0;
    }

    .campaign-safety-list > div:last-child {
      padding-block-end: 0;
    }
  }
}
</style>
