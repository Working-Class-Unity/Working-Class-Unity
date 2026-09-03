<script setup lang="ts">
import { computed } from 'vue'

const { t } = useI18n()

const governanceProof = computed(() => [
  {
    value: t('home.governance.generalMeetings.value'),
    label: t('home.governance.generalMeetings.label'),
    currentThrough: t('home.governance.sourceCurrentThrough'),
    sourceLabel: t('home.governance.source'),
    sourceHref: '/bylaws'
  },
  {
    value: t('home.governance.campaignVote.value'),
    label: t('home.governance.campaignVote.label'),
    currentThrough: t('home.governance.sourceCurrentThrough'),
    sourceLabel: t('home.governance.source'),
    sourceHref: '/bylaws'
  },
  {
    value: t('home.governance.campaignReview.value'),
    label: t('home.governance.campaignReview.label'),
    currentThrough: t('home.governance.sourceCurrentThrough'),
    sourceLabel: t('home.governance.source'),
    sourceHref: '/bylaws'
  }
])

const campaignPages = computed(() => [
  {
    label: t('home.currentWork.pages.overview'),
    to: '/campaigns/remove-flock-stockton'
  },
  {
    label: t('home.currentWork.pages.whatStocktonBought'),
    to: '/campaigns/remove-flock-stockton/what-stockton-bought'
  },
  {
    label: t('home.currentWork.pages.removalNotReform'),
    to: '/campaigns/remove-flock-stockton/why-safeguards-are-not-enough'
  },
  {
    label: t('home.currentWork.pages.faq'),
    to: '/campaigns/remove-flock-stockton/faq'
  }
])

const participationRoutes = computed(() => [
  {
    number: '01',
    title: t('home.participation.routes.events.title'),
    description: t('home.participation.routes.events.description'),
    action: t('home.participation.routes.events.action'),
    to: '/calendar'
  },
  {
    number: '02',
    title: t('home.participation.routes.campaign.title'),
    description: t('home.participation.routes.campaign.description'),
    action: t('home.participation.routes.campaign.action'),
    to: '/#current-work'
  },
  {
    number: '03',
    title: t('home.participation.routes.updates.title'),
    description: t('home.participation.routes.updates.description'),
    action: t('home.participation.routes.updates.action'),
    to: 'https://tech.workingclassunity.com/wcu-updates'
  }
])

useHead(() => ({
  title: t('metadata.home.title'),
  meta: [{ name: 'description', content: t('metadata.home.description') }]
}))
</script>

<template>
  <article class="home-page">
    <section class="home-hero" aria-labelledby="home-hero-title">
      <div class="home-section-inner home-hero-inner">
        <div class="home-hero-statement">
          <header class="home-hero-headline">
            <p class="section-eyebrow">{{ t('home.eyebrow') }}</p>
            <h1 id="home-hero-title">{{ t('home.title') }}</h1>
          </header>

          <div class="home-hero-invitation">
            <p>{{ t('home.introduction') }}</p>
            <AppActionLink class="home-hero-primary" to="/calendar">
              {{ t('home.actions.events') }}
            </AppActionLink>
          </div>
        </div>

        <DocumentaryCarousel class="home-documentary" variant="home" :max-photos="10" />
      </div>
    </section>

    <section id="current-work" class="home-campaign" aria-labelledby="home-current-work-title">
      <div class="home-section-inner home-campaign-inner">
        <p class="home-campaign-meta">{{ t('home.currentWork.meta') }}</p>
        <h2 id="home-current-work-title">{{ t('home.currentWork.title') }}</h2>
        <p class="home-campaign-description">{{ t('home.currentWork.description') }}</p>
        <nav class="home-campaign-pages" :aria-label="t('home.currentWork.navigationLabel')">
          <ul role="list">
            <li v-for="page in campaignPages" :key="page.to">
              <AppActionLink :to="page.to" variant="text-inverse" size="compact">
                <span>{{ page.label }}</span>
                <span aria-hidden="true">→</span>
              </AppActionLink>
            </li>
          </ul>
        </nav>
        <AppActionLink
          class="home-rule-action home-campaign-petition"
          to="https://tech.workingclassunity.com/deflock-stockton"
          variant="text-inverse"
        >
          <span aria-hidden="true" />
          {{ t('home.currentWork.petitionAction') }}
        </AppActionLink>
      </div>
    </section>

    <section class="home-governance" aria-labelledby="home-governance-title">
      <div class="home-section-inner home-governance-inner">
        <header class="home-governance-heading">
          <p class="section-eyebrow">{{ t('home.governance.eyebrow') }}</p>
          <h2 id="home-governance-title">{{ t('home.governance.title') }}</h2>
        </header>

        <div class="home-governance-detail">
          <p>{{ t('home.governance.description') }}</p>
          <AppActionLink class="home-governance-rule" to="/about" variant="text">
            {{ t('home.governance.action') }}
            <span aria-hidden="true">→</span>
          </AppActionLink>
          <AppActionLink to="/bylaws" variant="text">
            {{ t('home.governance.source') }} <span aria-hidden="true">→</span>
          </AppActionLink>
        </div>
      </div>
    </section>

    <section class="home-proof" :aria-label="t('home.proofLabel')">
      <div class="home-section-inner home-proof-inner">
        <p class="home-proof-label">{{ t('home.proofLabel') }}</p>
        <ProofStrip :items="governanceProof" :show-details="false" />
      </div>
    </section>

    <section id="get-involved" class="home-participation" aria-labelledby="home-participation-title">
      <div class="home-section-inner home-participation-inner">
        <header class="home-participation-heading">
          <h2 id="home-participation-title">{{ t('home.participation.title') }}</h2>
          <p>{{ t('home.participation.description') }}</p>
        </header>

        <ol class="home-participation-routes">
          <li v-for="route in participationRoutes" :key="route.number">
            <span class="home-route-number" aria-hidden="true">{{ route.number }}</span>
            <h3>{{ route.title }}</h3>
            <p>{{ route.description }}</p>
            <AppActionLink :to="route.to" variant="text">
              {{ route.action }} <span aria-hidden="true">→</span>
            </AppActionLink>
          </li>
        </ol>
      </div>
    </section>

    <section class="home-close" aria-labelledby="home-close-title">
      <div class="home-section-inner home-close-inner">
        <div class="home-close-copy">
          <h2 id="home-close-title">{{ t('home.participation.closingTitle') }}</h2>
          <p>{{ t('home.participation.closingDescription') }}</p>
        </div>
        <AppActionLink class="home-rule-action home-close-action" to="/#get-involved" variant="text-inverse">
          <span aria-hidden="true" />
          {{ t('home.participation.closingAction') }} <span aria-hidden="true">→</span>
        </AppActionLink>
      </div>
    </section>

    <footer class="home-footer">
      <div class="home-section-inner home-footer-inner">
        <NuxtLink
          class="home-footer-brand"
          to="/"
          :aria-label="t('navigation.brandHome', { appName: 'Working Class Unity' })"
        >
          <!-- eslint-disable-next-line vue/html-self-closing -->
          <img src="/images/wcu-logo-light.png" alt="" width="2000" height="2000" />
        </NuxtLink>
        <p>{{ t('home.footer.boundary') }}</p>
        <nav :aria-label="t('home.footer.navigationLabel')">
          <ul role="list">
            <li>
              <NuxtLink to="/#get-involved">{{ t('navigation.getInvolved') }}</NuxtLink>
            </li>
            <li>
              <NuxtLink to="/legal/privacy">{{ t('home.footer.privacy') }}</NuxtLink>
            </li>
            <li>
              <NuxtLink to="/login">{{ t('navigation.login') }}</NuxtLink>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  </article>
</template>

<style scoped>
@layer components {
  .home-page {
    position: relative;
    inset-inline-start: 50%;
    inline-size: 100vw;
    min-width: 0;
    margin-block-end: calc(-1 * var(--space-8));
    margin-inline-start: -50vw;
    overflow: clip;
    background: var(--color-surface);
  }

  .home-section-inner {
    inline-size: min(var(--content-max-width), calc(100% - (2 * var(--content-gutter))));
    margin-inline: auto;
  }

  .section-eyebrow,
  .home-hero p,
  .home-campaign p,
  .home-governance p,
  .home-proof p,
  .home-participation p,
  .home-close p,
  .home-footer p {
    margin: 0;
  }

  .section-eyebrow,
  .home-campaign-meta,
  .home-proof-label {
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.12em;
    line-height: 1.4;
    text-transform: uppercase;
  }

  .section-eyebrow {
    color: var(--color-accent-action);
  }

  .home-hero {
    overflow: visible;
    background: var(--color-surface);
  }

  .home-hero-inner {
    display: grid;
    gap: 3.5rem;
    padding-block-start: 4.5rem;
  }

  .home-hero-statement {
    display: grid;
    grid-template-columns: minmax(0, 51.25rem) minmax(0, 22.25rem);
    gap: 4.5rem;
    align-items: start;
  }

  .home-hero-headline,
  .home-hero-invitation,
  .home-governance-heading,
  .home-governance-detail,
  .home-close-copy {
    display: grid;
    justify-items: start;
  }

  .home-hero-headline {
    gap: 1.375rem;
  }

  .home-hero h1 {
    --font-size-heading-1: clamp(4.25rem, 5.42vw, 4.875rem);
    --line-height-heading: 1.025;

    max-inline-size: 51.25rem;
    margin: 0;
    color: var(--color-brand-primary);
    font-family: var(--font-family-heading);
    font-size: var(--font-size-heading-1);
    font-weight: var(--font-weight-bold);
    letter-spacing: -0.035em;
    line-height: var(--line-height-heading);
    text-wrap: balance;
  }

  .home-hero-invitation {
    gap: var(--space-5);
    padding-block-end: var(--space-2);
  }

  .home-hero-invitation > p {
    font-size: 1.25rem;
    line-height: 1.55;
    text-wrap: pretty;
  }

  .home-hero-primary {
    min-block-size: 3.25rem;
    padding-inline: var(--space-4);
  }

  .home-documentary {
    min-width: 0;
  }

  .home-campaign {
    color: var(--color-surface);
    background: var(--color-accent-action);
    scroll-margin-block-start: var(--space-4);
  }

  .home-campaign-inner {
    display: grid;
    grid-template-columns: minmax(0, 45.75rem) minmax(0, 26.25rem);
    column-gap: 6rem;
    padding-block: 8rem 7.5rem;
  }

  .home-campaign-meta {
    grid-column: 1;
    grid-row: 1;
    color: var(--color-surface);
  }

  .home-campaign h2 {
    --color-brand-primary: var(--color-surface);
    --font-size-heading-2: 3.75rem;
    --line-height-heading: 1.035;

    grid-column: 1;
    grid-row: 2;
    max-inline-size: 12ch;
    margin: 1.75rem 0 0;
    color: var(--color-brand-primary);
    font-size: var(--font-size-heading-2);
    letter-spacing: -0.03em;
    line-height: var(--line-height-heading);
    text-wrap: balance;
  }

  .home-campaign-description {
    grid-column: 2;
    grid-row: 1 / span 2;
    padding-block-start: 3.5rem;
    font-size: 1.25rem;
    line-height: 1.55;
  }

  .home-campaign-pages,
  .home-campaign-petition {
    grid-row: 3;
    margin-block-start: 1.75rem;
  }

  .home-campaign-pages {
    grid-column: 1;
  }

  .home-campaign-pages ul {
    display: grid;
    padding: 0;
    margin: 0;
    border-block-start: var(--border-width) solid rgb(255 255 255 / 32%);
    list-style: none;
  }

  .home-campaign-pages li {
    border-block-end: var(--border-width) solid rgb(255 255 255 / 32%);
  }

  .home-campaign-pages :deep(.app-action-link) {
    gap: var(--space-4);
    inline-size: 100%;
    justify-content: space-between;
    border-radius: 0;
    padding-block: var(--space-3);
    color: var(--color-surface);
    text-align: start;
  }

  .home-campaign-pages :deep(.app-action-link > span:first-child) {
    min-width: 0;
  }

  .home-campaign-pages :deep(.app-action-link > span:last-child) {
    flex: 0 0 auto;
  }

  .home-campaign-petition {
    grid-column: 2;
  }

  .home-rule-action {
    gap: 0.875rem;
  }

  .home-rule-action > span:first-child {
    inline-size: 4rem;
    block-size: 2px;
    flex: 0 0 auto;
    background: currentcolor;
  }

  .home-governance {
    background: var(--color-surface);
  }

  .home-governance-inner {
    display: grid;
    grid-template-columns: minmax(0, 35rem) minmax(0, 35.5rem);
    gap: 7.5rem;
    padding-block: 9rem 8.25rem;
  }

  .home-governance-heading {
    gap: var(--space-5);
  }

  .home-governance h2,
  .home-close h2 {
    --font-size-heading-2: 3.625rem;
    --line-height-heading: 1.05;

    margin: 0;
    font-size: var(--font-size-heading-2);
    letter-spacing: -0.03em;
    line-height: var(--line-height-heading);
    text-wrap: balance;
  }

  .home-governance-detail {
    gap: var(--space-6);
    padding-block-start: 2.875rem;
  }

  .home-governance-detail > p {
    color: var(--color-text);
    font-size: 1.25rem;
    line-height: 1.55;
  }

  .home-governance-rule {
    inline-size: 100%;
    justify-content: space-between;
    border-block: var(--border-width) solid rgb(4 51 79 / 24%);
    border-inline: 0;
    padding-block: 1.125rem;
  }

  .home-governance-rule > span:last-child {
    color: var(--color-accent-action);
    font-size: 1.125rem;
  }

  .home-proof {
    background: var(--color-canvas);
  }

  .home-proof-inner {
    display: grid;
    gap: 2.25rem;
    padding-block: 4.5rem 4.75rem;
  }

  .home-proof-label {
    color: var(--color-brand-primary);
  }

  .home-participation {
    background: var(--color-surface);
    scroll-margin-block-start: var(--space-4);
  }

  .home-participation-inner {
    display: grid;
    gap: 3.375rem;
    padding-block: 8.25rem 7.25rem;
  }

  .home-participation-heading {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 29.375rem);
    gap: var(--space-8);
    align-items: end;
  }

  .home-participation h2 {
    --font-size-heading-2: 3.875rem;
    --line-height-heading: 1.035;

    margin: 0;
    color: var(--color-brand-primary);
    font-size: var(--font-size-heading-2);
    letter-spacing: -0.03em;
    line-height: var(--line-height-heading);
  }

  .home-participation-heading > p {
    font-size: 1.125rem;
    line-height: 1.55;
  }

  .home-participation-routes {
    padding: 0;
    margin: 0;
    border-block-start: var(--border-width) solid rgb(4 51 79 / 24%);
    list-style: none;
  }

  .home-participation-routes > li {
    display: grid;
    grid-template-columns: 7.5rem 22.5rem minmax(0, 1fr) 11rem;
    gap: 1.75rem;
    align-items: center;
    min-width: 0;
    padding-block: 1.875rem;
    border-block-end: var(--border-width) solid rgb(4 51 79 / 24%);
  }

  .home-route-number {
    color: var(--color-brand-primary);
    font-family: var(--font-family-statement);
    font-size: 2.625rem;
    line-height: 1.05;
  }

  .home-participation-routes > li:nth-child(1) .home-route-number {
    color: var(--color-brand-highlight);
  }

  .home-participation-routes > li:nth-child(2) .home-route-number {
    color: var(--color-brand-accent);
  }

  .home-participation-routes h3,
  .home-participation-routes p {
    min-width: 0;
    margin: 0;
  }

  .home-participation-routes h3 {
    color: var(--color-brand-primary);
    font-size: 1.75rem;
    line-height: 1.2;
  }

  .home-participation-routes p {
    font-size: 1rem;
    line-height: 1.55;
  }

  .home-participation-routes :deep(.app-action-link) {
    inline-size: 100%;
    justify-content: flex-end;
    text-align: end;
  }

  .home-close {
    color: var(--color-surface);
    background: var(--color-brand-primary);
  }

  .home-close-inner {
    display: grid;
    grid-template-columns: minmax(0, 47.5rem) auto;
    gap: 6rem;
    align-items: end;
    justify-content: space-between;
    padding-block: 7rem 6.5rem;
  }

  .home-close-copy {
    gap: 1.375rem;
  }

  .home-close h2 {
    --color-brand-primary: var(--color-surface);

    color: var(--color-brand-primary);
  }

  .home-close-copy > p {
    max-inline-size: 38.75rem;
    font-size: 1.125rem;
    line-height: 1.55;
  }

  .home-close-action {
    padding-block-end: var(--space-2);
    font-size: 1.25rem;
  }

  .home-close-action > span:first-child {
    background: var(--color-brand-highlight);
  }

  .home-footer {
    color: var(--color-surface);
    background: var(--color-brand-primary);
    border-block-start: var(--border-width) solid rgb(255 255 255 / 18%);
  }

  .home-footer-inner {
    display: grid;
    grid-template-columns: 10.625rem minmax(0, 35rem) auto;
    gap: var(--space-7);
    align-items: center;
    justify-content: space-between;
    padding-block: 2.125rem;
  }

  .home-footer-brand {
    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    min-inline-size: var(--control-min-inline-size);
    align-items: center;
    justify-content: flex-start;
  }

  .home-footer-brand img {
    inline-size: 2.625rem;
    block-size: 2.625rem;
  }

  .home-footer p {
    color: rgb(255 255 255 / 76%);
    font-size: 0.8125rem;
    line-height: 1.55;
  }

  .home-footer ul {
    display: flex;
    gap: var(--space-5);
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .home-footer a {
    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    align-items: center;
    color: var(--color-surface);
    font-size: 0.8125rem;
  }

  @media (width <= 64rem) {
    .home-hero-inner {
      gap: 2.125rem;
      padding-block-start: 3.25rem;
    }

    .home-hero-statement,
    .home-campaign-inner,
    .home-governance-inner,
    .home-participation-heading,
    .home-close-inner,
    .home-footer-inner {
      grid-template-columns: minmax(0, 1fr);
    }

    .home-hero-statement,
    .home-hero-headline,
    .home-hero-invitation {
      gap: 1.125rem;
    }

    .home-hero h1 {
      --font-size-heading-1: 2.75rem;
      --line-height-heading: 1.045;

      max-inline-size: none;
      font-size: var(--font-size-heading-1);
      line-height: var(--line-height-heading);
    }

    .home-hero-invitation {
      padding-block-end: 0;
    }

    .home-hero-invitation > p {
      font-size: 1.125rem;
      line-height: 1.55;
    }

    .home-campaign-inner {
      gap: 0;
      padding-block: 4.5rem 4.25rem;
    }

    .home-campaign h2,
    .home-governance h2,
    .home-participation h2,
    .home-close h2 {
      --font-size-heading-2: 2.375rem;
      --line-height-heading: 1.08;

      max-inline-size: none;
      font-size: var(--font-size-heading-2);
      line-height: var(--line-height-heading);
    }

    .home-governance-detail {
      padding-block-start: 0;
    }

    .home-campaign-description,
    .home-governance-detail > p,
    .home-participation-heading > p,
    .home-close-copy > p {
      font-size: 1.0625rem;
      line-height: 1.6;
    }

    .home-campaign-meta,
    .home-campaign h2,
    .home-campaign-description,
    .home-campaign-pages,
    .home-campaign-petition {
      grid-column: 1;
      grid-row: auto;
    }

    .home-campaign h2,
    .home-campaign-description,
    .home-campaign-pages,
    .home-campaign-petition {
      margin-block-start: 1.375rem;
    }

    .home-campaign-description {
      padding-block-start: 0;
    }

    .home-governance-inner {
      gap: 1.375rem;
      padding-block: 4.875rem 4.5rem;
    }

    .home-governance-heading,
    .home-governance-detail {
      gap: 1.375rem;
    }

    .home-proof-inner {
      gap: var(--space-5);
      padding-block: var(--space-8) 4.125rem;
    }

    .home-participation-inner {
      gap: 1.75rem;
      padding-block: 4.75rem 4.5rem;
    }

    .home-participation-heading {
      gap: 0.875rem;
    }

    .home-participation-routes > li {
      grid-template-columns: 3rem minmax(0, 1fr);
      gap: 0.625rem 1.125rem;
      padding-block: 1.375rem 1.5rem;
    }

    .home-route-number {
      grid-column: 1;
      grid-row: 1;
      font-size: 1.75rem;
      line-height: 1.15;
    }

    .home-participation-routes h3 {
      grid-column: 2;
      grid-row: 1;
      align-self: baseline;
      font-size: 1.375rem;
      line-height: 1.27;
    }

    .home-participation-routes p,
    .home-participation-routes :deep(.app-action-link) {
      grid-column: 2;
    }

    .home-participation-routes :deep(.app-action-link) {
      inline-size: auto;
      justify-content: flex-start;
      text-align: start;
    }

    .home-close-inner {
      gap: 1.375rem;
      padding-block: 4.5rem 4.25rem;
    }

    .home-close-copy {
      gap: 1.375rem;
    }

    .home-rule-action > span:first-child {
      inline-size: 2.625rem;
    }

    .home-close-action {
      font-size: 1.0625rem;
    }

    .home-footer-inner {
      gap: 1.375rem;
      padding-block: 1.75rem 2rem;
    }

    .home-footer-brand img {
      inline-size: 2.125rem;
      block-size: 2.125rem;
    }

    .home-footer ul {
      gap: 1.375rem;
      flex-wrap: wrap;
    }

    .home-footer p,
    .home-footer a {
      font-size: 0.875rem;
    }
  }
}
</style>
