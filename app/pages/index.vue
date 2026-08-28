<script setup lang="ts">
import heroAssets from '~/generated/hero-assets.json'

type ImageVariant = Readonly<{
  src: string
  width: number
}>

type HeroBackground = Readonly<{
  id: string
  variants: Readonly<{
    avif: readonly ImageVariant[]
    webp: readonly ImageVariant[]
  }>
}>

const { t } = useI18n()
const backgrounds = heroAssets.backgrounds as HeroBackground[]

function background(id: string) {
  const asset = backgrounds.find((item) => item.id === id)
  if (!asset) throw new Error(`Missing generated hero background: ${id}`)
  return asset
}

function sourceSet(variants: readonly ImageVariant[]) {
  return variants.map((variant) => `${variant.src} ${variant.width}w`).join(', ')
}

function fallbackSource(asset: HeroBackground) {
  return asset.variants.webp.at(-1)!.src
}

const landscape = background('landscape')
const portrait = background('portrait')
const portraitTall = background('portrait-tall')

useHead(() => ({
  title: t('metadata.home.title'),
  meta: [{ name: 'description', content: t('metadata.home.description') }]
}))
</script>

<template>
  <!-- eslint-disable vue/html-self-closing -->
  <section class="home-hero" aria-labelledby="home-hero-title">
    <picture class="hero-landscape" aria-hidden="true">
      <source
        media="(max-width: 37.5rem)"
        type="image/avif"
        :srcset="sourceSet(portraitTall.variants.avif)"
        sizes="100vw"
      />
      <source
        media="(max-width: 37.5rem)"
        type="image/webp"
        :srcset="sourceSet(portraitTall.variants.webp)"
        sizes="100vw"
      />
      <source media="(max-width: 60rem)" type="image/avif" :srcset="sourceSet(portrait.variants.avif)" sizes="100vw" />
      <source media="(max-width: 60rem)" type="image/webp" :srcset="sourceSet(portrait.variants.webp)" sizes="100vw" />
      <source type="image/avif" :srcset="sourceSet(landscape.variants.avif)" sizes="100vw" />
      <source type="image/webp" :srcset="sourceSet(landscape.variants.webp)" sizes="100vw" />
      <img :src="fallbackSource(landscape)" alt="" width="1672" height="941" fetchpriority="high" />
    </picture>

    <div class="hero-layout">
      <div class="hero-copy">
        <div class="hero-heading-group">
          <p class="hero-eyebrow">{{ t('home.eyebrow') }}</p>
          <h1 id="home-hero-title" class="hero-title">{{ t('home.title') }}</h1>
          <p class="hero-introduction">{{ t('home.introduction') }}</p>
        </div>

        <div class="hero-actions">
          <NuxtLink class="hero-action hero-action--primary" to="/join">{{ t('home.join') }}</NuxtLink>
          <NuxtLink class="hero-action hero-action--secondary" to="/calendar">
            {{ t('home.nextEvent') }}
          </NuxtLink>
        </div>

        <section class="newsletter" aria-labelledby="newsletter-heading">
          <h2 id="newsletter-heading" class="newsletter-heading">{{ t('home.newsletterHeading') }}</h2>
          <a
            class="newsletter-action"
            href="https://tech.workingclassunity.com/wcu-updates"
            aria-describedby="newsletter-note"
          >
            {{ t('home.newsletterSubmit') }}
          </a>
          <p id="newsletter-note" class="newsletter-note">{{ t('home.newsletterNote') }}</p>
        </section>
      </div>

      <HeroPhotoWall class="hero-photos" />
    </div>
  </section>
</template>

<style scoped>
@layer components {
  .home-hero {
    --hero-header-block-size: clamp(5.75rem, 8vw, 6.75rem);

    position: relative;
    isolation: isolate;
    block-size: calc(100svh - var(--hero-header-block-size));
    min-block-size: 37rem;
    max-block-size: 52rem;
    overflow: hidden;
    border-radius: 0 0 var(--radius-2) var(--radius-2);
    background: var(--color-canvas);
  }

  .hero-landscape,
  .hero-landscape img {
    position: absolute;
    z-index: -2;
    inset: 0;
    inline-size: 100%;
    block-size: 100%;
  }

  .hero-landscape img {
    object-fit: cover;
    object-position: bottom center;
  }

  .home-hero::after {
    position: absolute;
    z-index: -1;
    inset: 0;
    background: linear-gradient(90deg, rgb(247 249 252 / 97%) 0%, rgb(247 249 252 / 86%) 47%, transparent 70%);
    content: '';
    pointer-events: none;
  }

  .hero-layout {
    display: grid;
    grid-template-columns: minmax(22rem, 1fr) 40%;
    grid-template-rows: minmax(0, 1fr);
    gap: clamp(1rem, 2.5vw, 2.75rem);
    block-size: 100%;
    min-block-size: 0;
    overflow: hidden;
  }

  .hero-copy {
    z-index: 1;
    align-self: center;
    max-inline-size: 43rem;
    padding: clamp(2.5rem, 6vh, 4.75rem) clamp(1rem, 2vw, 2.25rem) clamp(4.5rem, 10vh, 7rem) var(--home-content-inset);
  }

  .hero-heading-group {
    display: grid;
    gap: var(--space-5);
  }

  .hero-eyebrow,
  .hero-title,
  .hero-introduction,
  .newsletter-note {
    margin: 0;
  }

  .hero-eyebrow {
    color: var(--color-accent-action);
    font-family: var(--font-family-body);
    font-size: clamp(0.875rem, 0.78rem + 0.2vw, 1rem);
    font-weight: 750;
    letter-spacing: 0.08em;
    line-height: 1.35;
    text-transform: uppercase;
  }

  .hero-title {
    max-inline-size: 12ch;
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: clamp(3rem, 2rem + 3.1vw, 5rem);
    font-stretch: 115%;
    font-weight: 650;
    letter-spacing: -0.055em;
    line-height: 0.94;
    text-wrap: balance;
  }

  .hero-introduction {
    max-inline-size: 46ch;
    color: var(--color-text);
    font-size: clamp(1.05rem, 0.95rem + 0.3vw, 1.25rem);
    line-height: 1.55;
    text-wrap: pretty;
  }

  .hero-actions {
    display: flex;
    gap: var(--space-4);
    flex-wrap: wrap;
    margin-block-start: var(--space-7);
  }

  .hero-action {
    --color-action: var(--color-brand-primary);

    display: inline-flex;
    min-block-size: 3.5rem;
    min-inline-size: min(11.5rem, 100%);
    align-items: center;
    justify-content: center;
    border: 2px solid var(--color-brand-primary);
    border-radius: var(--radius-2);
    padding: var(--space-3) var(--space-4);
    font-family: var(--font-family-body);
    font-size: 0.9375rem;
    font-weight: 750;
    letter-spacing: 0.01em;
    text-align: center;
    text-decoration: none;
  }

  .hero-action--primary {
    --color-action: var(--color-accent-action-contrast);

    border-color: var(--color-accent-action);
    color: var(--color-accent-action-contrast);
    background: var(--color-accent-action);
  }

  .hero-action--secondary {
    color: var(--color-brand-primary);
    background: rgb(247 249 252 / 72%);
  }

  .hero-action--primary:hover,
  .hero-action--primary:focus-visible,
  .hero-action--secondary:hover,
  .hero-action--secondary:focus-visible {
    --color-action: var(--color-action-contrast);

    border-color: var(--color-brand-primary);
    color: var(--color-action-contrast);
    background: var(--color-brand-primary);
  }

  .newsletter {
    max-inline-size: 34rem;
    border-block-start: var(--border-width) solid rgb(4 51 79 / 38%);
    padding-block-start: var(--space-5);
    margin-block-start: var(--space-7);
  }

  .newsletter-heading {
    margin-block-end: var(--space-4);
    color: var(--color-text);
    font-size: 1rem;
    font-weight: 600;
  }

  .newsletter-action {
    --anchor-color: var(--color-brand-primary);

    display: inline-flex;
    min-block-size: 3.25rem;
    align-items: center;
    justify-content: center;
    border: 2px solid var(--color-brand-primary);
    border-radius: var(--radius-2);
    padding-inline: var(--space-4);
    color: var(--color-brand-primary);
    background: rgb(247 249 252 / 72%);
    font-family: var(--font-family-body);
    font-size: 1rem;
    font-weight: 700;
    text-align: center;
    text-decoration: none;
  }

  .newsletter-action:hover,
  .newsletter-action:focus-visible {
    --anchor-color: var(--color-action-contrast);

    color: var(--color-action-contrast);
    background: var(--color-brand-primary);
  }

  .newsletter-note {
    max-inline-size: 55ch;
    margin-block-start: var(--space-3);
    color: var(--color-text-muted);
    font-size: 0.875rem;
    line-height: 1.45;
  }

  .hero-photos {
    align-self: stretch;
    block-size: auto;
    margin-inline-end: var(--home-content-inset);
    min-width: 0;
    min-block-size: 0;
    overflow: hidden;
  }

  @media (width <= 60rem) {
    .home-hero {
      block-size: auto;
      max-block-size: none;
      min-block-size: 0;
    }

    .home-hero::after {
      background: linear-gradient(180deg, rgb(247 249 252 / 95%) 0%, rgb(247 249 252 / 72%) 52%, transparent 78%);
    }

    .hero-layout {
      block-size: auto;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto auto;
      overflow: visible;
    }

    .hero-copy {
      padding: clamp(2.5rem, 8vw, 4.5rem) clamp(1rem, 5vw, 2.5rem) clamp(5rem, 13vw, 8rem);
    }

    .hero-title {
      max-inline-size: 13ch;
      font-size: clamp(2.25rem, 8.5vw, 4.75rem);
    }

    .hero-photos {
      block-size: clamp(30rem, 78vw, 45rem);
      margin-inline-end: 0;
      max-block-size: none;
      min-block-size: clamp(30rem, 78vw, 45rem);
    }
  }

  @media (width <= 37.5rem) {
    .home-hero {
      border-radius: 0;
    }

    .hero-copy {
      padding-inline: var(--space-4);
      padding-block-end: 4rem;
    }

    .hero-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-2);
    }

    .hero-action {
      min-inline-size: 0;
      padding-inline: var(--space-3);
      font-size: 0.875rem;
    }

    .newsletter-action {
      inline-size: 100%;
      min-block-size: 3rem;
    }

    .newsletter-note {
      font-size: 1rem;
    }

    .hero-photos {
      block-size: 34rem;
      min-block-size: 34rem;
    }
  }
}
</style>
