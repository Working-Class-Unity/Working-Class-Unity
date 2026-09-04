<script setup lang="ts">
import { unitedFrontEndorsers } from '~/content/united-front'

const individualSigningUrl = 'https://tech.workingclassunity.com/united-front-for-immigrants-workers'
const organizationSigningUrl = 'https://tech.workingclassunity.com/sign-the-united-front-as-an-organization'
type UnitedFrontLocale = 'en' | 'es' | 'pa'

const localeLanguages: Record<UnitedFrontLocale, string> = {
  en: 'en-US',
  es: 'es-ES',
  pa: 'pa-IN'
}

const { locale, setLocale, t } = useI18n()

const languageOptions = computed(() => [
  { code: 'en', label: t('unitedfront.ui.languages.en') },
  { code: 'es', label: t('unitedfront.ui.languages.es') },
  { code: 'pa', label: t('unitedfront.ui.languages.pa') }
])

const outlineItems = computed(() => [
  { id: 'united-front-what-we-face', label: t('unitedfront.whatWeFace.heading') },
  { id: 'united-front-who-we-are', label: t('unitedfront.whoWeAre.heading') },
  { id: 'united-front-principles', label: t('unitedfront.ourPrinciples.heading') },
  { id: 'united-front-declaration', label: t('unitedfront.unitedFront.heading') },
  { id: 'united-front-stand-together', label: t('unitedfront.whyStandTogether.heading') },
  { id: 'united-front-neither-party', label: t('unitedfront.whyNeitherParty.heading') },
  { id: 'united-front-not-slogans', label: t('unitedfront.notSlogans.heading') },
  { id: 'united-front-demands', label: t('unitedfront.longTermDemands.heading') },
  { id: 'united-front-pledge', label: t('unitedfront.pledge.heading') },
  { id: 'united-front-signing', label: t('unitedfront.signing.heading') },
  { id: 'united-front-endorsers', label: t('unitedfront.endorsers.heading') }
])

const principles = computed(() => [
  t('unitedfront.ourPrinciples.content1'),
  t('unitedfront.ourPrinciples.content2'),
  t('unitedfront.ourPrinciples.content3')
])

const demands = computed(() => [
  t('unitedfront.longTermDemands.demand1'),
  t('unitedfront.longTermDemands.demand2'),
  t('unitedfront.longTermDemands.demand3'),
  t('unitedfront.longTermDemands.demand4')
])

async function changeLanguage(event: Event) {
  const nextLocale = (event.target as HTMLSelectElement | null)?.value
  if (!nextLocale || nextLocale === locale.value) return
  await setLocale(nextLocale as UnitedFrontLocale)
}

useHead(() => ({
  htmlAttrs: {
    lang: localeLanguages[locale.value as UnitedFrontLocale] ?? localeLanguages.en,
    dir: 'ltr'
  },
  title: `${t('unitedfront.pageTitle')} | ${t('unitedfront.ui.org_name')}`,
  meta: [{ name: 'description', content: t('unitedfront.subtitle') }]
}))
</script>

<template>
  <article class="united-front-page" aria-labelledby="united-front-title">
    <header class="united-front-page-meta">
      <p class="united-front-region">{{ t('unitedfront.ui.region_label') }}</p>
      <label class="united-front-language">
        <span>{{ t('unitedfront.ui.languageLabel') }}</span>
        <select :value="locale" @change="changeLanguage">
          <option v-for="option in languageOptions" :key="option.code" :value="option.code">
            {{ option.label }}
          </option>
        </select>
      </label>
    </header>

    <CampaignEditorialHeader
      class="united-front-editorial-header"
      title-id="united-front-title"
      :eyebrow="t('unitedfront.ui.org_name')"
      :title="t('unitedfront.title')"
      :description="t('unitedfront.subtitle')"
      :qualification="t('unitedfront.ui.published_read_time')"
    >
      <AppActionLink class="united-front-header-action" to="#united-front-signing" variant="secondary">
        {{ t('unitedfront.ui.sign_pledge') }}
      </AppActionLink>
    </CampaignEditorialHeader>

    <div class="united-front-record">
      <PageOutline
        class="united-front-outline"
        :items="outlineItems"
        :label="t('unitedfront.ui.outline.label')"
        :title="t('unitedfront.ui.outline.title')"
        :description="t('unitedfront.ui.outline.description')"
        :trigger-label="t('unitedfront.ui.outline.trigger')"
        :close-label="t('unitedfront.ui.outline.close')"
        trigger-variant="secondary"
        show-trigger-indicator
      />

      <div class="united-front-sections">
        <section id="united-front-what-we-face" class="united-front-section" aria-labelledby="what-we-face-title">
          <div class="united-front-section-grid">
            <header class="united-front-section-heading">
              <h2 id="what-we-face-title">{{ t('unitedfront.whatWeFace.heading') }}</h2>
            </header>
            <div class="united-front-copy">
              <p>{{ t('unitedfront.whatWeFace.content') }}</p>
            </div>
          </div>
        </section>

        <section id="united-front-who-we-are" class="united-front-section" aria-labelledby="who-we-are-title">
          <div class="united-front-section-grid">
            <header class="united-front-section-heading">
              <h2 id="who-we-are-title">{{ t('unitedfront.whoWeAre.heading') }}</h2>
            </header>
            <div class="united-front-copy">
              <p>{{ t('unitedfront.whoWeAre.content') }}</p>
            </div>
          </div>
        </section>

        <section id="united-front-principles" class="united-front-section" aria-labelledby="principles-title">
          <div class="united-front-section-grid">
            <header class="united-front-section-heading">
              <h2 id="principles-title">{{ t('unitedfront.ourPrinciples.heading') }}</h2>
            </header>
            <div class="united-front-copy united-front-copy--stack">
              <p v-for="principle in principles" :key="principle">{{ principle }}</p>
            </div>
          </div>
        </section>

        <section id="united-front-declaration" class="united-front-section" aria-labelledby="declaration-title">
          <div class="united-front-section-grid">
            <header class="united-front-section-heading">
              <h2 id="declaration-title">{{ t('unitedfront.unitedFront.heading') }}</h2>
            </header>
            <div class="united-front-copy">
              <p>{{ t('unitedfront.unitedFront.content') }}</p>
            </div>
          </div>
        </section>

        <section id="united-front-stand-together" class="united-front-section" aria-labelledby="stand-together-title">
          <div class="united-front-section-grid">
            <header class="united-front-section-heading">
              <h2 id="stand-together-title">{{ t('unitedfront.whyStandTogether.heading') }}</h2>
            </header>
            <div class="united-front-copy">
              <p>{{ t('unitedfront.whyStandTogether.content') }}</p>
            </div>
          </div>
        </section>

        <section id="united-front-neither-party" class="united-front-section" aria-labelledby="neither-party-title">
          <div class="united-front-section-grid">
            <header class="united-front-section-heading">
              <h2 id="neither-party-title">{{ t('unitedfront.whyNeitherParty.heading') }}</h2>
            </header>
            <div class="united-front-copy">
              <p>{{ t('unitedfront.whyNeitherParty.content') }}</p>
            </div>
          </div>
        </section>

        <section id="united-front-not-slogans" class="united-front-section" aria-labelledby="not-slogans-title">
          <div class="united-front-section-grid">
            <header class="united-front-section-heading">
              <h2 id="not-slogans-title">{{ t('unitedfront.notSlogans.heading') }}</h2>
            </header>
            <div class="united-front-copy">
              <p>{{ t('unitedfront.notSlogans.content') }}</p>
            </div>
          </div>
        </section>

        <section id="united-front-demands" class="united-front-section" aria-labelledby="demands-title">
          <div class="united-front-section-grid">
            <header class="united-front-section-heading">
              <h2 id="demands-title">{{ t('unitedfront.longTermDemands.heading') }}</h2>
            </header>
            <div class="united-front-copy">
              <p>{{ t('unitedfront.longTermDemands.intro') }}</p>
              <ul class="united-front-demand-list" role="list">
                <li v-for="demand in demands" :key="demand">{{ demand }}</li>
              </ul>
            </div>
          </div>
        </section>

        <section
          id="united-front-pledge"
          class="united-front-section united-front-pledge"
          aria-labelledby="pledge-title"
        >
          <div class="united-front-section-grid">
            <header class="united-front-section-heading">
              <h2 id="pledge-title">{{ t('unitedfront.pledge.heading') }}</h2>
            </header>
            <blockquote>
              <p>{{ t('unitedfront.pledge.content') }}</p>
            </blockquote>
          </div>
        </section>

        <section id="united-front-signing" class="united-front-section" aria-labelledby="signing-title">
          <div class="united-front-section-grid">
            <header class="united-front-section-heading">
              <h2 id="signing-title">{{ t('unitedfront.signing.heading') }}</h2>
            </header>
            <div class="united-front-signing-content">
              <p class="united-front-signing-description">{{ t('unitedfront.signing.description') }}</p>
              <div class="united-front-signing-paths">
                <article class="united-front-signing-path">
                  <h3>{{ t('unitedfront.signing.individual.title') }}</h3>
                  <p>{{ t('unitedfront.signing.individual.description') }}</p>
                  <AppActionLink :to="individualSigningUrl" variant="primary">
                    {{ t('unitedfront.signing.individual.action') }}
                  </AppActionLink>
                </article>
                <article class="united-front-signing-path">
                  <h3>{{ t('unitedfront.signing.organization.title') }}</h3>
                  <p>{{ t('unitedfront.signing.organization.description') }}</p>
                  <AppActionLink :to="organizationSigningUrl" variant="secondary">
                    {{ t('unitedfront.signing.organization.action') }}
                  </AppActionLink>
                </article>
              </div>
            </div>
          </div>
        </section>

        <UnitedFrontEndorsers
          :heading="t('unitedfront.endorsers.heading')"
          :description="t('unitedfront.endorsers.description')"
          :endorsers="unitedFrontEndorsers"
        />
      </div>
    </div>
  </article>
</template>

<style scoped>
@layer components {
  .united-front-page {
    min-width: 0;
    padding-block-end: var(--space-9);
  }

  .united-front-page-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-5);
    min-width: 0;
    padding-block: var(--space-5) var(--space-3);
  }

  .united-front-region,
  .united-front-language {
    margin: 0;
    color: var(--color-accent-action);
    font-family: var(--font-family-mono);
    font-size: 0.8125rem;
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.08em;
    line-height: 1.4;
    text-transform: uppercase;
  }

  .united-front-region {
    min-width: 0;
    text-wrap: pretty;
  }

  .united-front-language {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex: 0 0 auto;
    color: var(--color-text-muted);
    letter-spacing: 0.04em;
  }

  .united-front-language select {
    inline-size: auto;
    min-inline-size: 7rem;
    padding-inline: var(--space-2) var(--space-6);
    color: var(--color-brand-primary);
    background: var(--color-surface);
    font: inherit;
    letter-spacing: normal;
    text-transform: none;
  }

  .united-front-editorial-header {
    margin-block-end: clamp(3rem, 6vw, 5rem);
  }

  .united-front-header-action {
    max-inline-size: 100%;
  }

  .united-front-record {
    display: grid;
    grid-template-columns: minmax(12rem, 3fr) minmax(0, 9fr);
    gap: clamp(2rem, 5vw, 5rem);
    align-items: start;
    min-width: 0;
  }

  .united-front-outline,
  .united-front-sections {
    min-width: 0;
  }

  .united-front-outline :deep(.page-outline-trigger) {
    display: none;
  }

  .united-front-section {
    border-block-start: var(--border-width) solid var(--color-divider-strong);
    padding-block: clamp(3.5rem, 7vw, 6rem);
  }

  .united-front-section-grid {
    display: grid;
    grid-template-columns: minmax(12rem, 4fr) minmax(0, 8fr);
    gap: clamp(2rem, 5vw, 5rem);
    align-items: start;
    min-width: 0;
  }

  .united-front-section-heading,
  .united-front-copy,
  .united-front-signing-content {
    min-width: 0;
  }

  :where(
    .united-front-section-heading h2,
    .united-front-copy p,
    .united-front-signing-path h3,
    .united-front-signing-path p,
    .united-front-pledge blockquote,
    .united-front-pledge blockquote p
  ) {
    margin: 0;
  }

  .united-front-section-heading h2 {
    color: var(--color-brand-primary);
    font-size: clamp(1.875rem, 1.5rem + 1.25vw, 2.75rem);
    text-wrap: balance;
  }

  .united-front-copy,
  .united-front-signing-content {
    max-inline-size: 68ch;
  }

  .united-front-copy p,
  .united-front-signing-content p,
  .united-front-signing-path p {
    color: var(--color-text);
    font-size: 1.125rem;
    line-height: 1.65;
    text-wrap: pretty;
  }

  .united-front-copy--stack {
    display: grid;
    gap: var(--space-5);
  }

  .united-front-signing-path h3 {
    color: var(--color-brand-primary);
    font-size: 1.25rem;
    line-height: 1.2;
  }

  .united-front-signing-path p {
    margin-block-start: var(--space-3);
  }

  .united-front-demand-list {
    display: grid;
    gap: 0;
    padding: 0;
    margin: var(--space-6) 0 0;
    list-style: none;
  }

  .united-front-demand-list li {
    border-block-start: var(--border-width) solid var(--color-divider);
    padding-block: var(--space-4);
    color: var(--color-text);
    font-size: 1.125rem;
    line-height: 1.55;
    text-wrap: pretty;
  }

  .united-front-demand-list li:last-child {
    border-block-end: var(--border-width) solid var(--color-divider);
  }

  .united-front-pledge {
    padding-inline: clamp(1.5rem, 4vw, 3rem);
    color: var(--color-surface);
    background: var(--color-brand-primary);
  }

  .united-front-pledge .united-front-section-heading h2,
  .united-front-pledge blockquote p {
    color: var(--color-surface);
  }

  .united-front-pledge blockquote {
    max-inline-size: 68ch;
  }

  .united-front-pledge blockquote p {
    font-size: clamp(1.35rem, 1.1rem + 0.9vw, 2rem);
    line-height: 1.45;
    text-wrap: pretty;
  }

  .united-front-signing-description {
    margin-block: 0 var(--space-5);
  }

  .united-front-signing-paths {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    border-block: var(--border-width) solid var(--color-divider-strong);
  }

  .united-front-signing-path {
    display: grid;
    align-content: start;
    justify-items: start;
    gap: var(--space-3);
    min-width: 0;
    padding-block: var(--space-5);
    padding-inline: var(--space-5);
  }

  .united-front-signing-path:first-child {
    padding-inline-start: 0;
  }

  .united-front-signing-path + .united-front-signing-path {
    border-inline-start: var(--border-width) solid var(--color-divider-strong);
  }

  .united-front-signing-path .app-action-link {
    max-inline-size: 100%;
  }

  @media (width <= 72rem) {
    .united-front-section-grid {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-5);
    }
  }

  @media (width <= 56rem) {
    .united-front-record {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
    }

    .united-front-outline :deep(.page-outline-trigger) {
      display: inline-flex;
    }
  }

  @media (width <= 40rem) {
    .united-front-page-meta {
      align-items: flex-start;
      flex-direction: column;
      gap: var(--space-3);
    }

    .united-front-language {
      align-items: flex-start;
      flex-wrap: wrap;
    }

    .united-front-signing-paths {
      grid-template-columns: minmax(0, 1fr);
    }

    .united-front-signing-path {
      padding-inline: 0;
    }

    .united-front-signing-path + .united-front-signing-path {
      border-block-start: var(--border-width) solid var(--color-divider-strong);
      border-inline-start: 0;
      padding-block-start: var(--space-5);
      padding-inline-start: 0;
    }
  }
}
</style>
