<script setup lang="ts">
import CampaignLandingSectionHeading from '~/components/campaign/LandingSectionHeading.vue'
import { citedTextPlainText, type CampaignSection } from '~/content/remove-flock-stockton'

type ImageVariant = Readonly<{
  src: string
  width: number
  height: number
}>

type CampaignImage = Readonly<{
  width: number
  height: number
  variants: Readonly<{
    avif: readonly ImageVariant[]
    webp: readonly ImageVariant[]
  }>
}>

defineProps<{
  image?: CampaignImage
  imageAlt: string
  section: CampaignSection
}>()

const argumentLabels = ['Safety is a public good', 'The risk is unequal', 'The public should hold power'] as const

function sourceSet(variants: readonly ImageVariant[]) {
  return variants.map((variant) => `${variant.src} ${variant.width}w`).join(', ')
}

function fallbackVariant(image: CampaignImage) {
  return image.variants.webp.at(-1)!
}
</script>

<template>
  <section
    class="campaign-argument"
    :class="{ 'campaign-argument--without-image': !image }"
    aria-labelledby="why-remove-title"
  >
    <div class="campaign-argument-content">
      <CampaignLandingSectionHeading
        eyebrow="01 / THE CASE"
        :summary="section.summary"
        :title="section.title"
        title-id="why-remove-title"
      />

      <dl class="campaign-argument-list">
        <div v-for="(point, index) in section.points" :key="citedTextPlainText(point)" class="campaign-argument-item">
          <dt>
            <span aria-hidden="true">0{{ index + 1 }}</span>
            {{ argumentLabels[index] }}
          </dt>
          <dd>{{ citedTextPlainText(point) }}</dd>
        </div>
      </dl>

      <NuxtLink class="campaign-argument-action" to="/campaigns/remove-flock-stockton/why-safeguards-are-not-enough">
        Read the full case for removal
      </NuxtLink>
    </div>

    <!-- eslint-disable vue/html-self-closing -->
    <figure v-if="image" class="campaign-argument-image">
      <picture>
        <source
          type="image/avif"
          :srcset="sourceSet(image.variants.avif)"
          sizes="(max-width: 68rem) calc(100vw - 3rem), 42vw"
        />
        <source
          type="image/webp"
          :srcset="sourceSet(image.variants.webp)"
          sizes="(max-width: 68rem) calc(100vw - 3rem), 42vw"
        />
        <img
          :src="fallbackVariant(image).src"
          :alt="imageAlt"
          :width="fallbackVariant(image).width"
          :height="fallbackVariant(image).height"
          loading="lazy"
          decoding="async"
        />
      </picture>
    </figure>
    <!-- eslint-enable vue/html-self-closing -->
  </section>
</template>

<style scoped>
@layer components {
  .campaign-argument {
    display: grid;
    grid-template-columns: minmax(0, 6fr) minmax(19rem, 5fr);
    gap: var(--campaign-grid-gap);
    align-items: stretch;
  }

  .campaign-argument--without-image {
    grid-template-columns: minmax(0, 1fr);
  }

  .campaign-argument-content {
    display: grid;
    align-content: start;
    justify-items: start;
    gap: clamp(2rem, 4vw, 3.5rem);
    min-width: 0;
  }

  .campaign-argument-list {
    display: grid;
    inline-size: 100%;
    margin: 0;
  }

  .campaign-argument-item {
    display: grid;
    gap: var(--space-3);
    border-block-start: var(--border-width) solid var(--campaign-divider);
    padding-block: var(--space-5);
  }

  .campaign-argument-item:last-child {
    padding-block-end: 0;
  }

  .campaign-argument-item dt {
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr);
    gap: var(--space-3);
    color: var(--color-brand-primary);
    font-size: 1.125rem;
    font-weight: var(--font-weight-strong);
  }

  .campaign-argument-item dt span {
    color: var(--color-accent-action);
    font-family: var(--font-family-mono);
    font-size: 0.8125rem;
    letter-spacing: 0.08em;
  }

  .campaign-argument-item dd {
    max-inline-size: 62ch;
    margin: 0 0 0 calc(2rem + var(--space-3));
    color: var(--color-text-muted);
    line-height: 1.7;
    text-wrap: pretty;
  }

  .campaign-argument-action {
    display: inline-flex;
    min-block-size: 3.25rem;
    align-items: center;
    justify-content: center;
    justify-self: start;
    border: 2px solid var(--color-brand-primary);
    border-radius: var(--radius-2);
    padding-inline: var(--space-4);
    color: var(--color-brand-primary);
    background: transparent;
    font-weight: var(--font-weight-bold);
    text-align: center;
    text-decoration: none;
  }

  .campaign-argument-action:hover,
  .campaign-argument-action:focus-visible {
    color: var(--color-brand-primary);
    background: var(--color-action-soft);
  }

  .campaign-argument-action:focus-visible {
    outline: var(--focus-outline);
    outline-offset: var(--focus-offset);
  }

  .campaign-argument-image {
    min-block-size: 42rem;
    overflow: hidden;
    border: var(--border-width) solid var(--color-divider-strong);
    border-radius: min(1vw, var(--radius-2));
    margin: 0;
    background: var(--color-action-soft);
  }

  .campaign-argument-image picture,
  .campaign-argument-image img {
    display: block;
    inline-size: 100%;
    block-size: 100%;
  }

  .campaign-argument-image img {
    object-fit: cover;
  }

  @media (width <= 68rem) {
    .campaign-argument {
      grid-template-columns: minmax(0, 1fr);
    }

    .campaign-argument-image {
      min-block-size: 30rem;
    }
  }

  @media (width <= 46rem) {
    .campaign-argument-image {
      min-block-size: 24rem;
    }

    .campaign-argument-action {
      inline-size: 100%;
    }
  }
}
</style>
