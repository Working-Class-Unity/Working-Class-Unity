<script setup lang="ts">
import { computed } from 'vue'

const { t } = useI18n()

const governanceProof = computed(() => [
  {
    value: t('home.governance.generalMeetings.value'),
    label: t('home.governance.generalMeetings.label'),
    context: t('home.governance.generalMeetings.context'),
    currentThrough: t('home.governance.sourceCurrentThrough'),
    sourceLabel: t('home.governance.source'),
    sourceHref: '/bylaws'
  },
  {
    value: t('home.governance.campaignVote.value'),
    label: t('home.governance.campaignVote.label'),
    context: t('home.governance.campaignVote.context'),
    currentThrough: t('home.governance.sourceCurrentThrough'),
    sourceLabel: t('home.governance.source'),
    sourceHref: '/bylaws'
  },
  {
    value: t('home.governance.campaignReview.value'),
    label: t('home.governance.campaignReview.label'),
    context: t('home.governance.campaignReview.context'),
    currentThrough: t('home.governance.sourceCurrentThrough'),
    sourceLabel: t('home.governance.source'),
    sourceHref: '/bylaws'
  }
])

useHead(() => ({
  title: t('metadata.home.title'),
  meta: [{ name: 'description', content: t('metadata.home.description') }]
}))
</script>

<template>
  <article class="home-page">
    <section class="home-hero open-split" aria-labelledby="home-hero-title">
      <div class="home-hero-copy">
        <p class="section-eyebrow">{{ t('home.eyebrow') }}</p>
        <h1 id="home-hero-title">{{ t('home.title') }}</h1>
        <p class="home-introduction">{{ t('home.introduction') }}</p>
        <div class="home-actions">
          <AppActionLink to="/calendar">{{ t('home.actions.events') }}</AppActionLink>
          <AppActionLink to="/#current-work" variant="secondary">
            {{ t('home.actions.currentWork') }}
          </AppActionLink>
        </div>
      </div>

      <DocumentaryFigure
        class="home-documentary"
        ratio="4:3"
        :caption="t('home.media.caption')"
        :placeholder-label="t('home.media.placeholder')"
      />
    </section>

    <section class="home-identity" aria-labelledby="home-identity-title">
      <header>
        <p class="section-eyebrow">{{ t('home.identity.eyebrow') }}</p>
        <h2 id="home-identity-title">{{ t('home.identity.title') }}</h2>
      </header>
      <div class="home-identity-copy">
        <p>{{ t('home.identity.description') }}</p>
        <AppActionLink to="/about" variant="secondary">{{ t('home.identity.action') }}</AppActionLink>
      </div>
    </section>

    <section id="current-work" class="home-current-work" aria-labelledby="home-current-work-title">
      <EvidenceMetaLine
        :current-through="t('home.currentWork.currentThrough')"
        :place="t('home.currentWork.place')"
        :source-href="'/campaigns/remove-flock-stockton/what-stockton-bought'"
        :source-label="t('home.currentWork.source')"
        :status="t('home.currentWork.eyebrow')"
      />

      <div class="home-current-work-grid">
        <div class="home-current-work-copy">
          <h2 id="home-current-work-title">
            <span>{{ t('home.currentWork.title') }}</span>
            {{ t('home.currentWork.titleContext') }}
          </h2>
          <p>{{ t('home.currentWork.description') }}</p>
          <div class="home-current-work-actions">
            <AppActionLink to="https://tech.workingclassunity.com/deflock-stockton" variant="campaign">
              {{ t('home.currentWork.petitionAction') }}
            </AppActionLink>
            <NuxtLink class="campaign-brief-link" to="/campaigns/remove-flock-stockton">
              {{ t('home.currentWork.campaignAction') }}
            </NuxtLink>
          </div>
        </div>

        <dl class="home-current-work-facts">
          <div>
            <dt>{{ t('home.currentWork.contractLabel') }}</dt>
            <dd>{{ t('home.currentWork.contractValue') }}</dd>
          </div>
          <div>
            <dt>{{ t('home.currentWork.termLabel') }}</dt>
            <dd>{{ t('home.currentWork.termValue') }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <section class="home-governance" aria-labelledby="home-governance-title">
      <header class="home-section-heading">
        <p class="section-eyebrow">{{ t('home.governance.eyebrow') }}</p>
        <h2 id="home-governance-title">{{ t('home.governance.title') }}</h2>
        <p class="home-section-description">{{ t('home.governance.description') }}</p>
      </header>
      <ProofStrip :items="governanceProof" />
    </section>

    <section id="get-involved" class="home-participation open-split" aria-labelledby="home-participation-title">
      <div class="home-participation-copy">
        <p class="section-eyebrow">{{ t('home.participation.eyebrow') }}</p>
        <h2 id="home-participation-title">{{ t('home.participation.title') }}</h2>
        <p>{{ t('home.participation.description') }}</p>
        <div class="home-actions">
          <AppActionLink to="/calendar">{{ t('home.participation.eventsAction') }}</AppActionLink>
        </div>
      </div>

      <div class="participation-steps">
        <h3>{{ t('home.participation.nextTitle') }}</h3>
        <ol>
          <li>{{ t('home.participation.stepOne') }}</li>
          <li>{{ t('home.participation.stepTwo') }}</li>
          <li>{{ t('home.participation.stepThree') }}</li>
        </ol>
      </div>
    </section>

    <aside class="home-updates" aria-labelledby="home-updates-title">
      <div class="home-updates-copy">
        <h2 id="home-updates-title">{{ t('home.newsletterHeading') }}</h2>
        <p id="newsletter-note" class="home-updates-note">{{ t('home.newsletterNote') }}</p>
      </div>
      <AppActionLink
        aria-describedby="newsletter-note"
        to="https://tech.workingclassunity.com/wcu-updates"
        variant="secondary"
      >
        {{ t('home.newsletterSubmit') }}
      </AppActionLink>
    </aside>

    <p class="home-accountability">{{ t('home.accountability') }}</p>
  </article>
</template>

<style scoped>
@layer components {
  .home-page {
    min-width: 0;
    background: var(--color-canvas);
  }

  .home-hero,
  .home-identity,
  .home-governance,
  .home-participation {
    padding-block: var(--space-9);
  }

  .home-hero {
    --split-align: center;
  }

  .home-hero-copy,
  .home-section-heading,
  .home-participation-copy {
    display: grid;
    justify-items: start;
    gap: var(--space-5);
  }

  .section-eyebrow,
  .home-introduction,
  .home-identity p,
  .home-current-work p,
  .home-governance p,
  .home-participation p,
  .home-updates p,
  .home-accountability {
    margin: 0;
  }

  .section-eyebrow {
    color: var(--color-accent-action);
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.08em;
    line-height: 1.35;
    text-transform: uppercase;
  }

  .home-hero h1 {
    max-inline-size: 14ch;
    margin: 0;
    color: var(--color-brand-primary);
    font-size: var(--font-size-heading-1);
    letter-spacing: -0.035em;
    text-wrap: balance;
  }

  .home-introduction,
  .home-participation-copy > p {
    max-inline-size: 56ch;
    font-size: var(--font-size-lede);
    line-height: 1.6;
    text-wrap: pretty;
  }

  .home-actions {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
    margin-block-start: var(--space-3);
  }

  .home-documentary {
    min-width: 0;
  }

  .home-identity {
    display: grid;
    grid-template-columns: minmax(12rem, 4fr) minmax(0, 8fr);
    gap: var(--space-8);
    border-block: var(--border-width) solid var(--color-border);
  }

  .home-identity header,
  .home-identity-copy {
    display: grid;
    align-content: start;
    justify-items: start;
    gap: var(--space-5);
  }

  .home-identity h2,
  .home-governance h2,
  .home-participation h2 {
    max-inline-size: 16ch;
    margin: 0;
    font-size: var(--font-size-heading-2);
    letter-spacing: -0.025em;
    text-wrap: balance;
  }

  .home-identity-copy > p {
    max-inline-size: 62ch;
    font-size: var(--font-size-lede);
    line-height: 1.6;
  }

  .home-current-work {
    --evidence-meta-color: rgb(255 255 255 / 78%);
    --evidence-meta-link-hover: var(--color-brand-highlight);

    margin-inline: calc(-1 * var(--content-gutter));
    padding: var(--space-9) var(--content-gutter);
    color: var(--color-surface);
    background: var(--color-brand-primary);
    scroll-margin-block-start: var(--space-4);
  }

  .home-current-work-grid {
    display: grid;
    grid-template-columns: minmax(0, 7fr) minmax(15rem, 5fr);
    gap: var(--space-8);
    align-items: end;
    margin-block-start: var(--space-7);
  }

  .home-current-work-copy {
    display: grid;
    justify-items: start;
    gap: var(--space-5);
  }

  .home-current-work h2 {
    display: grid;
    gap: var(--space-2);
    max-inline-size: 13ch;
    margin: 0;
    color: var(--color-surface);
    font-size: clamp(2.25rem, 1.25rem + 3.2vw, 4.25rem);
    line-height: 1.02;
  }

  .home-current-work h2 span {
    color: var(--color-brand-highlight);
    font-family: var(--font-family-statement);
    font-size: 0.92em;
    font-weight: 400;
    line-height: 0.98;
  }

  .home-current-work-copy > p {
    max-inline-size: 56ch;
    color: rgb(255 255 255 / 88%);
    font-size: var(--font-size-lede);
    line-height: 1.6;
  }

  .home-current-work-actions {
    display: flex;
    align-items: center;
    gap: var(--space-4) var(--space-5);
    flex-wrap: wrap;
    margin-block-start: var(--space-3);
  }

  .campaign-brief-link {
    min-block-size: var(--control-min-block-size);
    display: inline-flex;
    align-items: center;
    color: var(--color-surface);
    font-weight: var(--font-weight-bold);
    text-underline-offset: 0.22em;
  }

  .campaign-brief-link:hover,
  .campaign-brief-link:focus-visible {
    color: var(--color-brand-highlight);
  }

  .home-current-work-facts {
    margin: 0;
    border-block: var(--border-width) solid rgb(255 255 255 / 34%);
  }

  .home-current-work-facts > div {
    display: grid;
    gap: var(--space-2);
    padding-block: var(--space-5);
  }

  .home-current-work-facts > div + div {
    border-block-start: var(--border-width) solid rgb(255 255 255 / 34%);
  }

  .home-current-work-facts dd,
  .home-current-work-facts dt {
    margin: 0;
  }

  .home-current-work-facts dd {
    color: var(--color-brand-highlight);
    font-family: var(--font-family-statement);
    font-size: clamp(1.75rem, 1.2rem + 1.8vw, 3rem);
    line-height: 1;
  }

  .home-current-work-facts dt {
    order: 2;
    color: rgb(255 255 255 / 78%);
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .home-governance {
    display: grid;
    gap: var(--space-8);
  }

  .home-section-heading {
    max-inline-size: var(--reading-max-width);
  }

  .home-section-description {
    max-inline-size: 58ch;
    font-size: var(--font-size-lede);
  }

  .home-participation {
    --split-align: start;

    border-block-start: var(--border-width) solid var(--color-border);
    scroll-margin-block-start: var(--space-4);
  }

  .participation-steps {
    min-width: 0;
  }

  .participation-steps h3 {
    margin: 0 0 var(--space-5);
    color: var(--color-brand-primary);
    font-size: 1.25rem;
  }

  .participation-steps ol {
    padding: 0;
    margin: 0;
    border-block-start: var(--border-width) solid var(--color-border);
    counter-reset: participation;
    list-style: none;
  }

  .participation-steps li {
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr);
    gap: var(--space-3);
    padding-block: var(--space-4);
    border-block-end: var(--border-width) solid var(--color-border);
    counter-increment: participation;
  }

  .participation-steps li::before {
    color: var(--color-accent-action);
    font-weight: var(--font-weight-bold);
    content: counter(participation, decimal-leading-zero);
  }

  .home-updates {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-6);
    align-items: start;
    padding-block: var(--space-8);
    border-block: var(--border-width) solid var(--color-border);
  }

  .home-updates-copy {
    display: grid;
    gap: var(--space-3);
    max-inline-size: var(--reading-max-width);
  }

  .home-updates h2 {
    margin: 0;
    font-size: 1.5rem;
    line-height: 1.2;
  }

  .home-updates-note,
  .home-accountability {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: 1.5;
  }

  .home-accountability {
    max-inline-size: 72ch;
    padding-block: var(--space-5) 0;
  }

  @media (width <= 56rem) {
    .home-hero,
    .home-identity,
    .home-governance,
    .home-participation {
      padding-block: var(--space-8);
    }

    .home-identity,
    .home-current-work-grid {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-7);
    }

    .home-current-work {
      padding-block: var(--space-8);
    }

    .home-current-work-grid {
      align-items: start;
    }

    .home-updates {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (width <= 32rem) {
    .home-actions {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      inline-size: 100%;
    }

    .home-actions :deep(.app-action-link),
    .home-updates :deep(.app-action-link) {
      inline-size: 100%;
    }

    .home-current-work-actions {
      align-items: stretch;
      flex-direction: column;
      inline-size: 100%;
    }

    .home-current-work-actions :deep(.app-action-link),
    .campaign-brief-link {
      inline-size: 100%;
      justify-content: center;
    }
  }
}
</style>
