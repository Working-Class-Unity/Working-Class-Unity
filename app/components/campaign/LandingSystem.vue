<script setup lang="ts">
import CampaignLandingSectionHeading from '~/components/campaign/LandingSectionHeading.vue'
import type { CampaignSection } from '~/content/remove-flock-stockton'

defineProps<{
  section: CampaignSection
}>()

const systemLabels = ['Collect', 'Connect', 'Observe', 'Depend'] as const

function pointDetail(text: string) {
  const separator = text.indexOf(':')
  return separator === -1 ? text : text.slice(separator + 1).trim()
}
</script>

<template>
  <section class="campaign-system" aria-labelledby="campaign-system-title">
    <div class="campaign-system-header">
      <CampaignLandingSectionHeading
        eyebrow="02 / THE SYSTEM"
        inverse
        :summary="section.summary"
        :title="section.title"
        title-id="campaign-system-title"
      />

      <NuxtLink class="campaign-system-action" to="/campaigns/remove-flock-stockton/what-stockton-bought">
        Explore the full system
      </NuxtLink>
    </div>

    <dl class="campaign-system-map">
      <div v-for="(point, index) in section.points" :key="point.text" class="campaign-system-node">
        <dt>
          <span class="campaign-system-node-index" aria-hidden="true">0{{ index + 1 }}</span>
          {{ systemLabels[index] }}
        </dt>
        <dd>{{ pointDetail(point.text) }}</dd>
        <div :class="`campaign-system-visual campaign-system-visual--${index + 1}`" aria-hidden="true">
          <template v-if="index === 0">
            <span class="campaign-system-visual-item">PLATE</span>
            <span class="campaign-system-visual-item">TIME</span>
            <span class="campaign-system-visual-item">PLACE</span>
          </template>
          <template v-else-if="index === 1">
            <span class="campaign-system-visual-item campaign-system-visual-item--left">ALPR</span>
            <strong class="campaign-system-visual-item campaign-system-visual-item--center">FLOCK OS</strong>
            <span class="campaign-system-visual-item campaign-system-visual-item--top">911</span>
            <span class="campaign-system-visual-item campaign-system-visual-item--right">VIDEO</span>
          </template>
          <template v-else-if="index === 2">
            <span class="campaign-system-visual-dot" />
            <span class="campaign-system-visual-dot" />
            <span class="campaign-system-visual-dot" />
          </template>
          <template v-else>
            <span class="campaign-system-dependency">SOFTWARE</span>
            <span class="campaign-system-dependency">ACCESS</span>
            <span class="campaign-system-dependency">RENEWAL</span>
          </template>
        </div>
      </div>
    </dl>
  </section>
</template>

<style scoped>
@layer components {
  .campaign-system {
    --campaign-inverse-border: rgb(255 255 255 / 14%);
    --campaign-inverse-surface: rgb(255 255 255 / 5%);
    --campaign-inverse-text: rgb(255 255 255 / 78%);
    --campaign-inverse-control-border: rgb(255 255 255 / 26%);
    --campaign-inverse-connection: rgb(255 159 72 / 48%);
    --campaign-inverse-grid-line: rgb(255 255 255 / 16%);
    --campaign-inverse-detail-surface: rgb(255 255 255 / 7%);

    display: grid;
    gap: clamp(3rem, 6vw, 5rem);
    min-width: 0;
    color: var(--color-action-contrast);
    background: var(--color-brand-primary);
  }

  .campaign-system-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--campaign-grid-gap);
    align-items: end;
  }

  .campaign-system-action {
    --anchor-color: var(--color-action-contrast);

    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    align-items: center;
    justify-self: end;
    border-block-end: 2px solid var(--color-brand-highlight);
    color: var(--color-action-contrast);
    font-weight: var(--font-weight-bold);
    text-decoration: none;
    white-space: nowrap;
  }

  .campaign-system-action:hover,
  .campaign-system-action:focus-visible {
    color: var(--color-brand-highlight);
  }

  .campaign-system-action:focus-visible {
    outline: var(--focus-outline);
    outline-offset: var(--focus-offset);
  }

  .campaign-system-map {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--campaign-grid-gap);
    margin: 0;
  }

  .campaign-system-node {
    position: relative;
    display: grid;
    grid-template-rows: auto auto 1fr;
    gap: var(--space-4);
    min-width: 0;
    min-block-size: 25rem;
    border: var(--border-width) solid var(--campaign-inverse-border);
    border-radius: min(1vw, var(--radius-2));
    padding: clamp(1.25rem, 2.5vw, 2rem);
    background: var(--campaign-inverse-surface);
  }

  .campaign-system-node::before {
    position: absolute;
    inset-block-start: -1px;
    inset-inline: 1.25rem;
    border-block-start: 3px solid var(--color-brand-highlight);
    content: '';
  }

  .campaign-system-node dt {
    display: grid;
    gap: var(--space-2);
    color: var(--color-action-contrast);
    font-family: var(--font-family-display);
    font-size: 1.5rem;
    font-weight: 650;
  }

  .campaign-system-node-index {
    color: var(--color-brand-highlight);
    font-family: var(--font-family-mono);
    font-size: 0.8125rem;
    letter-spacing: 0.08em;
  }

  .campaign-system-node dd {
    margin: 0;
    color: var(--campaign-inverse-text);
    line-height: 1.7;
    text-wrap: pretty;
  }

  .campaign-system-visual {
    position: relative;
    display: grid;
    align-self: end;
    min-block-size: 8rem;
    overflow: hidden;
    border-block-start: var(--border-width) solid var(--campaign-inverse-border);
    padding-block-start: var(--space-4);
    color: var(--color-action-contrast);
    font-family: var(--font-family-mono);
    font-size: 0.6875rem;
    letter-spacing: 0.06em;
  }

  .campaign-system-visual--1 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
    align-items: center;
  }

  .campaign-system-visual--1 .campaign-system-visual-item {
    border: var(--border-width) solid var(--campaign-inverse-control-border);
    border-radius: var(--radius-1);
    padding: var(--space-3) var(--space-1);
    color: var(--color-brand-highlight);
    text-align: center;
  }

  .campaign-system-visual--2 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-template-rows: repeat(3, 1fr);
    place-items: center;
  }

  .campaign-system-visual--2::before,
  .campaign-system-visual--2::after {
    position: absolute;
    inset-block: 34%;
    inset-inline: 12%;
    border-block: var(--border-width) solid var(--campaign-inverse-connection);
    content: '';
  }

  .campaign-system-visual--2::after {
    inset-block: 12%;
    inset-inline: 34%;
    border: 0;
    border-inline: var(--border-width) solid var(--campaign-inverse-connection);
  }

  .campaign-system-visual--2 .campaign-system-visual-item {
    z-index: 1;
    padding: var(--space-1);
    background: var(--color-brand-primary);
  }

  .campaign-system-visual-item--left {
    grid-column: 1;
    grid-row: 2;
  }

  .campaign-system-visual-item--center {
    grid-column: 2;
    grid-row: 2;
    color: var(--color-brand-highlight);
  }

  .campaign-system-visual-item--top {
    grid-column: 2;
    grid-row: 1;
  }

  .campaign-system-visual-item--right {
    grid-column: 3;
    grid-row: 2;
  }

  .campaign-system-visual--3 {
    place-items: end center;
    background: repeating-radial-gradient(
      circle at 50% 100%,
      transparent 0 1.15rem,
      var(--campaign-inverse-grid-line) 1.2rem 1.25rem
    );
  }

  .campaign-system-visual--3::before {
    position: absolute;
    inset-block-end: 0;
    inline-size: 45%;
    border-block-start: 2px solid var(--color-brand-highlight);
    content: '';
    transform: rotate(-38deg);
    transform-origin: bottom center;
  }

  .campaign-system-visual-dot {
    position: absolute;
    inline-size: 0.5rem;
    aspect-ratio: 1;
    border-radius: 50%;
    background: var(--color-brand-highlight);
  }

  .campaign-system-visual-dot:nth-child(1) {
    inset-block-start: 38%;
    inset-inline-start: 20%;
  }

  .campaign-system-visual-dot:nth-child(2) {
    inset-block-start: 22%;
    inset-inline-start: 62%;
  }

  .campaign-system-visual-dot:nth-child(3) {
    inset-block-start: 62%;
    inset-inline-start: 78%;
  }

  .campaign-system-visual--4 {
    align-content: center;
    gap: var(--space-2);
  }

  .campaign-system-dependency {
    border-inline-start: 3px solid var(--color-brand-highlight);
    padding: var(--space-2) var(--space-3);
    background: var(--campaign-inverse-detail-surface);
  }

  .campaign-system-dependency:nth-child(2) {
    margin-inline-start: var(--space-3);
  }

  .campaign-system-dependency:nth-child(3) {
    margin-inline-start: var(--space-6);
  }

  @media (width <= 68rem) {
    .campaign-system-header {
      align-items: start;
    }

    .campaign-system-map {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (width <= 46rem) {
    .campaign-system-header,
    .campaign-system-map {
      grid-template-columns: minmax(0, 1fr);
    }

    .campaign-system-action {
      justify-self: start;
    }

    .campaign-system-node {
      min-block-size: 22rem;
    }
  }
}
</style>
