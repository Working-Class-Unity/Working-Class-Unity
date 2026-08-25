<script setup lang="ts">
import CampaignLandingSectionHeading from '~/components/campaign/LandingSectionHeading.vue'
import { citedTextPlainText, type CampaignSection } from '~/content/remove-flock-stockton'

defineProps<{
  section: CampaignSection
}>()
</script>

<template>
  <section class="campaign-participation" aria-labelledby="campaign-participate-title">
    <CampaignLandingSectionHeading
      eyebrow="06 / ORGANIZE"
      inverse
      :summary="section.summary"
      :title="section.title"
      title-id="campaign-participate-title"
    />

    <div class="campaign-participate-content">
      <ol class="campaign-participate-list" role="list">
        <li v-for="point in section.points" :key="citedTextPlainText(point)">{{ citedTextPlainText(point) }}</li>
      </ol>

      <NuxtLink class="campaign-participate-action" to="/signup">Join Working Class Unity</NuxtLink>

      <CampaignNewsletterSignup id-prefix="campaign-newsletter" />
    </div>
  </section>
</template>

<style scoped>
@layer components {
  .campaign-participation {
    --campaign-inverse-body-text: rgb(255 255 255 / 82%);

    display: grid;
    grid-template-columns: minmax(0, 4fr) minmax(0, 7fr);
    gap: var(--campaign-grid-gap);
    align-items: start;
    color: var(--color-action-contrast);
    background: var(--color-brand-primary);
  }

  .campaign-participate-content {
    display: grid;
    justify-items: start;
    gap: var(--space-6);
    min-width: 0;
  }

  .campaign-participate-list {
    display: grid;
    gap: var(--space-4);
    padding-inline-start: 1.25rem;
    margin: 0;
    color: var(--campaign-inverse-body-text);
    line-height: 1.7;
  }

  .campaign-participate-action {
    --anchor-color: var(--color-action-contrast);

    display: inline-flex;
    min-block-size: 3.25rem;
    align-items: center;
    justify-content: center;
    justify-self: start;
    border: 2px solid var(--color-action-contrast);
    border-radius: var(--radius-2);
    padding-inline: var(--space-4);
    color: var(--color-action-contrast);
    font-weight: var(--font-weight-bold);
    text-align: center;
    text-decoration: none;
    white-space: nowrap;
  }

  .campaign-participate-action:hover,
  .campaign-participate-action:focus-visible {
    --anchor-color: var(--color-brand-primary);

    color: var(--color-brand-primary);
    background: var(--color-action-contrast);
  }

  .campaign-participate-action:focus-visible {
    outline: var(--focus-outline);
    outline-offset: var(--focus-offset);
  }

  @media (width <= 46rem) {
    .campaign-participation {
      grid-template-columns: minmax(0, 1fr);
    }

    .campaign-participate-action {
      inline-size: 100%;
    }
  }
}
</style>
