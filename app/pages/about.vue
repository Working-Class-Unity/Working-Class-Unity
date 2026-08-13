<script setup lang="ts">
import heroAssets from '~/generated/hero-assets.json'

type ImageVariant = Readonly<{
  src: string
  width: number
}>

type AboutPhoto = Readonly<{
  id: string
  width: number
  height: number
  variants: Readonly<{
    avif: readonly ImageVariant[]
    webp: readonly ImageVariant[]
  }>
}>

const { t } = useI18n()
const photos = heroAssets.photos as readonly AboutPhoto[]
const aboutPhoto = photos.find((photo) => photo.id === 'photo-cd117022ba57b0c0')

if (!aboutPhoto) throw new Error('Missing generated About page photo')

function sourceSet(variants: readonly ImageVariant[]) {
  return variants.map((variant) => `${variant.src} ${variant.width}w`).join(', ')
}

useHead(() => ({
  title: t('metadata.about.title'),
  meta: [{ name: 'description', content: t('metadata.about.description') }]
}))
</script>

<template>
  <!-- eslint-disable vue/html-self-closing -->
  <article class="about-page" aria-labelledby="about-title">
    <section class="about-hero">
      <div class="about-hero-copy">
        <p class="about-eyebrow">{{ t('publicPages.about.eyebrow') }}</p>
        <h1 id="about-title">{{ t('publicPages.about.title') }}</h1>
        <p class="about-introduction">{{ t('publicPages.about.introduction') }}</p>
      </div>

      <figure class="about-photo">
        <picture>
          <source
            type="image/avif"
            :srcset="sourceSet(aboutPhoto.variants.avif)"
            sizes="(max-width: 60rem) calc(100vw - 4rem), 38vw"
          />
          <source
            type="image/webp"
            :srcset="sourceSet(aboutPhoto.variants.webp)"
            sizes="(max-width: 60rem) calc(100vw - 4rem), 38vw"
          />
          <img
            :src="aboutPhoto.variants.webp.at(-1)!.src"
            :width="aboutPhoto.width"
            :height="aboutPhoto.height"
            :alt="t('publicPages.about.photoAlt')"
            fetchpriority="high"
          />
        </picture>
        <figcaption>{{ t('publicPages.about.photoCaption') }}</figcaption>
      </figure>
    </section>

    <div class="about-story">
      <section class="story-section" aria-labelledby="problem-title">
        <header class="story-heading">
          <p class="story-number" aria-hidden="true">01</p>
          <h2 id="problem-title">{{ t('publicPages.about.problem.title') }}</h2>
        </header>
        <div class="story-copy">
          <p>{{ t('publicPages.about.problem.bodyOne') }}</p>
          <p>{{ t('publicPages.about.problem.bodyTwo') }}</p>
        </div>
      </section>

      <section class="story-section" aria-labelledby="solution-title">
        <header class="story-heading">
          <p class="story-number" aria-hidden="true">02</p>
          <h2 id="solution-title">{{ t('publicPages.about.solution.title') }}</h2>
        </header>
        <div class="story-copy">
          <p>{{ t('publicPages.about.solution.bodyOne') }}</p>
          <p class="mission-statement">{{ t('publicPages.about.solution.bodyTwo') }}</p>
          <p>{{ t('publicPages.about.solution.bodyThree') }}</p>
        </div>
      </section>
    </div>

    <section class="governance" aria-labelledby="governance-title">
      <div class="governance-copy">
        <p class="about-eyebrow">{{ t('publicPages.about.governance.eyebrow') }}</p>
        <h2 id="governance-title">{{ t('publicPages.about.governance.title') }}</h2>
        <p>{{ t('publicPages.about.governance.description') }}</p>
      </div>
      <NuxtLink class="bylaws-link" to="/bylaws">{{ t('publicPages.about.governance.action') }}</NuxtLink>
    </section>

    <section class="about-cta" aria-labelledby="about-cta-title">
      <div class="about-cta-copy">
        <p class="about-eyebrow">{{ t('publicPages.about.cta.eyebrow') }}</p>
        <h2 id="about-cta-title">{{ t('publicPages.about.cta.title') }}</h2>
        <p>{{ t('publicPages.about.cta.description') }}</p>
      </div>
      <NuxtLink class="about-cta-action" to="/signup">{{ t('publicPages.about.cta.action') }}</NuxtLink>
    </section>
  </article>
</template>

<style scoped>
@layer components {
  .about-page {
    position: relative;
    overflow: hidden;
    border-radius: 0 0 var(--radius-2) var(--radius-2);
    background: var(--color-surface);
  }

  .about-page::before {
    position: absolute;
    z-index: 1;
    inset: 0 0 auto;
    block-size: var(--border-width-accent);
    background: linear-gradient(
      90deg,
      var(--color-brand-highlight) 0 33.333%,
      var(--color-brand-primary) 33.333% 66.666%,
      var(--color-brand-accent) 66.666% 100%
    );
    content: '';
  }

  .about-hero,
  .story-section,
  .governance,
  .about-cta {
    padding-inline: clamp(1.5rem, 5vw, 5rem);
  }

  .about-hero {
    display: grid;
    grid-template-columns: minmax(0, 7fr) minmax(20rem, 5fr);
    gap: clamp(2.5rem, 5vw, 6rem);
    align-items: center;
    padding-block: clamp(4.5rem, 9vw, 8rem);
    background:
      linear-gradient(115deg, rgb(247 249 252 / 0%) 0 58%, rgb(225 235 242 / 58%) 58% 100%), var(--color-canvas);
  }

  .about-hero-copy {
    display: grid;
    gap: var(--space-5);
  }

  .about-eyebrow,
  .about-introduction,
  .story-number,
  .story-copy p,
  .governance p,
  .about-cta p,
  .about-photo figcaption {
    margin: 0;
  }

  .about-eyebrow {
    color: var(--color-accent-action);
    font-family: var(--font-family-mono);
    font-size: 0.9375rem;
    font-weight: var(--font-weight-strong);
    letter-spacing: 0.1em;
    line-height: 1.4;
    text-transform: uppercase;
  }

  .about-hero h1 {
    max-inline-size: 17ch;
    margin: 0;
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: clamp(3rem, 2rem + 3vw, 5.25rem);
    font-stretch: 112%;
    font-weight: 650;
    letter-spacing: -0.055em;
    line-height: 0.96;
    text-wrap: pretty;
  }

  .about-introduction {
    max-inline-size: 50ch;
    color: var(--color-text);
    font-size: clamp(1.125rem, 1.02rem + 0.35vw, 1.375rem);
    line-height: 1.6;
    text-wrap: pretty;
  }

  .about-photo {
    min-width: 0;
    margin: 0;
  }

  .about-photo picture,
  .about-photo img {
    display: block;
    inline-size: 100%;
  }

  .about-photo picture {
    overflow: hidden;
    border-radius: min(1vw, 0.75rem);
    outline: var(--border-width) solid var(--color-divider);
    outline-offset: -1px;
  }

  .about-photo img {
    aspect-ratio: 4 / 3;
    block-size: auto;
    object-fit: cover;
  }

  .about-photo figcaption {
    padding-block-start: var(--space-3);
    color: var(--color-text-muted);
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .about-story {
    padding-inline: clamp(1.5rem, 5vw, 5rem);
    background: var(--color-surface);
  }

  .story-section {
    display: grid;
    grid-template-columns: minmax(12rem, 4fr) minmax(0, 8fr);
    gap: clamp(2.5rem, 5vw, 6rem);
    padding-inline: 0;
    padding-block: clamp(4rem, 8vw, 7rem);
    border-block-start: var(--border-width) solid var(--color-divider-strong);
  }

  .story-heading {
    display: grid;
    gap: var(--space-4);
    align-content: start;
  }

  .story-number {
    color: var(--color-brand-highlight);
    font-family: var(--font-family-display);
    font-size: clamp(2.75rem, 2rem + 2vw, 4.25rem);
    font-stretch: 112%;
    font-weight: 650;
    letter-spacing: -0.045em;
    line-height: 1;
  }

  .story-heading h2,
  .governance h2,
  .about-cta h2 {
    margin: 0;
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-stretch: 110%;
    font-weight: 650;
    letter-spacing: -0.04em;
    text-wrap: balance;
  }

  .story-heading h2 {
    max-inline-size: 12ch;
    font-size: clamp(2rem, 1.6rem + 1.25vw, 3rem);
  }

  .story-copy {
    display: grid;
    gap: var(--space-6);
    max-inline-size: 70ch;
    color: var(--color-text);
    font-size: 1.0625rem;
    line-height: 1.8;
  }

  .story-copy p {
    text-wrap: pretty;
  }

  .mission-statement {
    border-inline-start: var(--border-width-accent) solid var(--color-brand-highlight);
    padding: var(--space-2) 0 var(--space-2) var(--space-5);
    color: var(--color-brand-primary);
    font-size: clamp(1.2rem, 1.08rem + 0.35vw, 1.45rem);
    font-weight: 600;
    line-height: 1.62;
  }

  .governance {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: clamp(2rem, 5vw, 5rem);
    align-items: end;
    padding-block: clamp(3.5rem, 7vw, 5.5rem);
    border-block: var(--border-width) solid var(--color-divider);
    box-shadow: inset var(--border-width-accent) 0 var(--color-brand-highlight);
    background: var(--color-surface-subtle);
  }

  .governance-copy {
    display: grid;
    gap: var(--space-4);
  }

  .governance h2 {
    max-inline-size: 24ch;
    font-size: clamp(2rem, 1.65rem + 1.15vw, 3rem);
  }

  .governance-copy > p:last-child {
    max-inline-size: 62ch;
    color: var(--color-text-muted);
    font-size: 1.0625rem;
    line-height: 1.7;
    text-wrap: pretty;
  }

  .bylaws-link {
    display: inline-flex;
    min-block-size: 3rem;
    align-items: center;
    border-block-end: 2px solid currentcolor;
    padding-inline: var(--space-1);
    color: var(--color-brand-primary);
    font-weight: var(--font-weight-strong);
    text-decoration: none;
  }

  .bylaws-link:hover,
  .bylaws-link:focus-visible {
    color: var(--color-accent-action);
  }

  .about-cta {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: clamp(2.5rem, 6vw, 7rem);
    align-items: center;
    padding-block: clamp(4rem, 8vw, 7rem);
    background: linear-gradient(115deg, rgb(225 235 242 / 75%), rgb(247 249 252 / 92%)), var(--color-canvas);
  }

  .about-cta-copy {
    display: grid;
    gap: var(--space-4);
  }

  .about-cta h2 {
    max-inline-size: 18ch;
    font-size: clamp(2.25rem, 1.75rem + 1.8vw, 3.75rem);
  }

  .about-cta-copy > p:last-child {
    max-inline-size: 65ch;
    color: var(--color-text);
    font-size: 1.125rem;
    line-height: 1.7;
    text-wrap: pretty;
  }

  .about-cta-action {
    --color-action: var(--color-accent-action-contrast);

    display: inline-flex;
    min-block-size: 3.5rem;
    min-inline-size: min(11.5rem, 100%);
    align-items: center;
    justify-content: center;
    border: 2px solid var(--color-accent-action);
    border-radius: var(--radius-2);
    padding: var(--space-3) var(--space-4);
    color: var(--color-accent-action-contrast);
    background: var(--color-accent-action);
    font-size: 0.9375rem;
    font-weight: var(--font-weight-strong);
    letter-spacing: 0.01em;
    text-align: center;
    text-decoration: none;
  }

  .about-cta-action:hover,
  .about-cta-action:focus-visible {
    --color-action: var(--color-action-contrast);

    border-color: var(--color-brand-primary);
    color: var(--color-action-contrast);
    background: var(--color-brand-primary);
  }

  @media (width <= 60rem) {
    .about-hero {
      grid-template-columns: minmax(0, 1fr);
      background: var(--color-canvas);
    }

    .about-hero h1 {
      max-inline-size: 16ch;
    }

    .about-photo {
      max-inline-size: 48rem;
    }

    .story-section {
      grid-template-columns: minmax(10rem, 3fr) minmax(0, 7fr);
    }
  }

  @media (width <= 47.5rem) {
    .about-hero,
    .story-section,
    .governance,
    .about-cta {
      padding-inline: var(--space-5);
    }

    .about-story {
      padding-inline: var(--space-5);
    }

    .about-hero {
      gap: var(--space-7);
      padding-block: clamp(3.5rem, 12vw, 5rem);
    }

    .about-hero h1 {
      font-size: clamp(2.6rem, 12vw, 4.25rem);
    }

    .story-section {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-7);
      padding-inline: 0;
      padding-block: clamp(3.5rem, 12vw, 5rem);
    }

    .story-heading {
      grid-template-columns: auto minmax(0, 1fr);
      align-items: end;
    }

    .story-number {
      font-size: 2.5rem;
    }

    .story-copy {
      font-size: 1.0625rem;
      line-height: 1.75;
    }

    .governance,
    .about-cta {
      grid-template-columns: minmax(0, 1fr);
      align-items: start;
    }

    .governance {
      box-shadow: inset 0 var(--border-width-accent) var(--color-brand-highlight);
    }

    .bylaws-link {
      justify-self: start;
    }

    .about-cta-action {
      justify-self: start;
    }
  }

  @media (width <= 37.5rem) {
    .about-hero,
    .story-section,
    .governance,
    .about-cta {
      padding-inline: var(--space-4);
    }

    .about-story {
      padding-inline: var(--space-4);
    }

    .about-page {
      border-radius: 0;
    }

    .about-photo picture {
      border-radius: min(2vw, 0.75rem);
    }

    .mission-statement {
      padding-inline-start: var(--space-4);
    }

    .about-cta-action {
      inline-size: 100%;
    }
  }
}
</style>
