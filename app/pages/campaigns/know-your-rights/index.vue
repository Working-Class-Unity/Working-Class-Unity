<script setup lang="ts">
import { knowYourRightsBasePath, knowYourRightsGuides } from '~/content/know-your-rights'

const { t } = useI18n()
const guides = computed(() =>
  knowYourRightsGuides.map((guide) => ({
    ...guide,
    title: t(guide.titleKey),
    description: t(guide.descriptionKey)
  }))
)

useHead(() => ({
  title: t('kyr_home.hero.title'),
  meta: [{ name: 'description', content: t('kyr_home.hero.description') }],
  link: [{ rel: 'canonical', href: 'https://workingclassunity.com' + knowYourRightsBasePath }]
}))
</script>

<template>
  <article class="kyr-hub" aria-labelledby="kyr-hub-title">
    <header class="kyr-hub-hero">
      <div class="kyr-hub-heading">
        <p class="kyr-hub-eyebrow">{{ t('kyr.overview.title') }}</p>
        <h1 id="kyr-hub-title">{{ t('kyr_home.hero.title') }}</h1>
      </div>

      <div class="kyr-hub-introduction">
        <p>{{ t('kyr_home.hero.description') }}</p>
        <aside class="kyr-hub-disclaimer" :aria-label="t('knowYourRights.interface.disclaimerLabel')">
          <p>{{ t('kyr_home.disclaimer') }}</p>
        </aside>
      </div>
    </header>

    <section class="kyr-hub-guides" aria-labelledby="kyr-guide-list-title">
      <header>
        <p class="kyr-hub-eyebrow">{{ t('kyr_home.buttons.emergency.title') }}</p>
        <h2 id="kyr-guide-list-title">{{ t('kyr_home.sections.rights_prep_title') }}</h2>
        <div class="kyr-hub-guide-introduction">
          <p class="kyr-hub-emergency-copy">{{ t('kyr_home.buttons.emergency.subtitle') }}</p>
          <p>{{ t('kyr_home.sections.rights_prep_intro') }}</p>
        </div>
      </header>

      <nav aria-labelledby="kyr-guide-list-title">
        <ul role="list">
          <li v-for="guide in guides" :key="guide.slug">
            <h3>
              <NuxtLink class="kyr-hub-guide-link" :to="guide.path">
                {{ guide.title }}
                <span aria-hidden="true">→</span>
              </NuxtLink>
            </h3>
            <p>{{ guide.description }}</p>
          </li>
        </ul>
      </nav>
    </section>
  </article>
</template>

<style scoped>
@layer components {
  .kyr-hub {
    min-width: 0;
    padding-block-end: clamp(5rem, 10vw, 8rem);
  }

  .kyr-hub-hero {
    display: grid;
    grid-template-columns: minmax(0, 7fr) minmax(18rem, 5fr);
    gap: clamp(2.5rem, 7vw, 7rem);
    align-items: start;
    border-block-end: var(--border-width) solid var(--color-divider-strong);
    padding: clamp(4rem, 9vw, 8rem) var(--space-5);
  }

  .kyr-hub-heading,
  .kyr-hub-introduction,
  .kyr-hub-guides > header,
  .kyr-hub-guide-introduction {
    display: grid;
    justify-items: start;
    gap: var(--space-5);
    min-width: 0;
  }

  .kyr-hub :where(p, h1, h2, h3) {
    margin: 0;
  }

  .kyr-hub-eyebrow {
    color: var(--color-accent-action);
    font-size: 0.875rem;
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.08em;
  }

  .kyr-hub-heading h1 {
    max-inline-size: 17ch;
    color: var(--color-brand-primary);
    font-family: var(--font-family-heading);
    font-size: var(--font-size-heading-1);
    font-weight: var(--font-weight-bold);
    letter-spacing: -0.04em;
    line-height: 1.02;
    text-wrap: balance;
  }

  .kyr-hub-introduction > p {
    max-inline-size: 62ch;
    color: var(--color-text);
    font-size: var(--font-size-lede);
    line-height: 1.65;
    text-wrap: pretty;
  }

  .kyr-hub-disclaimer {
    border-inline-start: var(--border-width-accent) solid var(--color-brand-highlight);
    padding: var(--space-3) 0 var(--space-3) var(--space-4);
  }

  .kyr-hub-disclaimer p {
    max-inline-size: 66ch;
    color: var(--color-text-muted);
    font-size: 1rem;
    line-height: 1.7;
    text-wrap: pretty;
  }

  .kyr-hub-guides {
    display: grid;
    gap: clamp(2.5rem, 6vw, 5rem);
    padding: clamp(4rem, 8vw, 7rem) var(--space-5) 0;
  }

  .kyr-hub-guides > header {
    grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
    column-gap: clamp(2.5rem, 7vw, 7rem);
  }

  .kyr-hub-guides > header > .kyr-hub-eyebrow {
    grid-column: 1 / -1;
  }

  .kyr-hub-guides h2 {
    max-inline-size: 17ch;
    color: var(--color-brand-primary);
    font-family: var(--font-family-heading);
    font-size: var(--font-size-heading-2);
    letter-spacing: -0.035em;
    line-height: 1.08;
    text-wrap: balance;
  }

  .kyr-hub-guide-introduction {
    gap: var(--space-3);
  }

  .kyr-hub-guide-introduction p {
    max-inline-size: 68ch;
    color: var(--color-text);
    font-size: 1rem;
    line-height: 1.7;
    text-wrap: pretty;
  }

  .kyr-hub-emergency-copy {
    color: var(--color-brand-primary);
    font-weight: var(--font-weight-bold);
  }

  .kyr-hub-guides ul {
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .kyr-hub-guides li {
    display: grid;
    grid-template-columns: minmax(12rem, 5fr) minmax(0, 7fr);
    gap: clamp(1.5rem, 5vw, 5rem);
    align-items: center;
    min-width: 0;
    border-block-start: var(--border-width) solid var(--color-divider);
    padding-block: var(--space-5);
  }

  .kyr-hub-guides li:last-child {
    border-block-end: var(--border-width) solid var(--color-divider);
  }

  .kyr-hub-guides h3 {
    font-size: 1.35rem;
    line-height: 1.3;
  }

  .kyr-hub-guide-link {
    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    max-inline-size: 100%;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-brand-primary);
    font-weight: var(--font-weight-bold);
    text-decoration: none;
  }

  .kyr-hub-guide-link > span {
    flex: 0 0 auto;
    color: var(--color-accent-action);
  }

  .kyr-hub-guide-link:hover,
  .kyr-hub-guide-link:focus-visible {
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 0.22em;
  }

  .kyr-hub-guides li > p {
    max-inline-size: 62ch;
    color: var(--color-text-muted);
    font-size: 1rem;
    line-height: 1.65;
    overflow-wrap: anywhere;
    text-wrap: pretty;
  }

  @media (width <= 56rem) {
    .kyr-hub-hero {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (width <= 44rem) {
    .kyr-hub-hero,
    .kyr-hub-guides {
      padding-inline: var(--space-4);
    }

    .kyr-hub-guides > header,
    .kyr-hub-guides li {
      grid-template-columns: minmax(0, 1fr);
    }

    .kyr-hub-guide-introduction {
      gap: var(--space-4);
    }
  }
}
</style>
