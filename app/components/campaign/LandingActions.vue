<script setup lang="ts">
import { citedTextPlainText, type CampaignSection } from '~/content/remove-flock-stockton'

defineProps<{ participate: CampaignSection }>()
const { t } = useI18n()
const { petitionDemand } = useRemoveFlockContent()
</script>

<template>
  <div class="landing-actions">
    <section id="our-demands" class="landing-demands flock-section" aria-labelledby="demands-title">
      <div class="flock-field landing-demands-inner">
        <header class="flock-section-head">
          <p class="flock-kicker">{{ t('removeFlock.landing.demandsEyebrow') }}</p>
          <h2 id="demands-title" class="flock-heading">{{ petitionDemand.title }}</h2>
          <p class="flock-copy">{{ petitionDemand.introduction }}</p>
          <p class="landing-demands-lead">{{ petitionDemand.leadIn }}</p>
        </header>
        <ol class="landing-demands-list">
          <li v-for="demand in petitionDemand.demands" :key="demand">{{ demand }}</li>
        </ol>
        <div class="landing-demands-action">
          <p>{{ t('removeFlock.landing.demandsAction') }}</p>
          <AppActionLink
            class="landing-demand-sign-action"
            to="https://tech.workingclassunity.com/deflock-stockton"
            variant="secondary"
            >{{ t('removeFlock.landing.signDemand') }}</AppActionLink
          >
        </div>
      </div>
    </section>

    <section
      id="join-the-campaign"
      class="flock-section flock-field landing-join"
      aria-labelledby="join-campaign-title"
    >
      <header class="flock-section-head">
        <p class="flock-kicker">{{ t('removeFlock.landing.joinEyebrow') }}</p>
        <h2 id="join-campaign-title" class="flock-heading">{{ participate.title }}</h2>
        <p class="flock-copy">{{ participate.summary }}</p>
      </header>
      <div class="landing-join-action">
        <AppActionLink to="/join" variant="secondary">{{ t('removeFlock.landing.joinWcu') }}</AppActionLink>
        <p v-for="paragraph in participate.closingParagraphs" :key="citedTextPlainText(paragraph)">
          {{ citedTextPlainText(paragraph) }}
        </p>
      </div>
    </section>

    <section id="updates" class="campaign-newsletter flock-section" aria-labelledby="campaign-updates-title">
      <div class="flock-field landing-updates-inner">
        <header class="flock-section-head">
          <p class="flock-kicker">{{ t('removeFlock.landing.updatesEyebrow') }}</p>
          <h2 id="campaign-updates-title" class="flock-heading">{{ t('removeFlock.landing.updatesTitle') }}</h2>
          <p class="flock-copy">{{ t('removeFlock.landing.updatesLead') }}</p>
        </header>
        <div class="landing-updates-action">
          <AppActionLink
            to="https://tech.workingclassunity.com/deflock-stockton-updates"
            variant="text-inverse"
            aria-describedby="campaign-updates-note"
            >{{ t('removeFlock.landing.stayInformed') }} <span aria-hidden="true">&nbsp;→</span></AppActionLink
          >
          <p id="campaign-updates-note">{{ t('removeFlock.landing.updatesDescription') }}</p>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
@layer components {
  .landing-demands {
    background: var(--color-surface-subtle);
  }

  .landing-demands-inner,
  .landing-join,
  .landing-updates-inner {
    display: grid;
    gap: var(--space-6);
  }

  .landing-demands-lead {
    margin: 0;
    font-size: 1.1875rem;
    font-weight: 650;
  }

  .landing-demands-list {
    display: grid;
    gap: var(--space-5);
    max-inline-size: 68ch;
    margin: 0;
    padding-inline-start: 1.5em;
    font-size: 1.1875rem;
    line-height: 1.5;
  }

  .landing-demands-list li {
    padding-inline-start: var(--space-2);
  }

  .landing-demands-list li::marker {
    color: var(--color-brand-primary);
    font-weight: 700;
  }

  .landing-demands-action {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-5);
    padding: var(--space-5);
    color: var(--color-accent-action-contrast);
    background: var(--color-accent-action);
    font-size: 1.1875rem;
    font-weight: 650;
  }

  .landing-demands-action p {
    max-inline-size: 38ch;
    margin: 0;
  }

  .landing-demands-action .landing-demand-sign-action {
    min-block-size: 3.25rem;
    border-color: var(--color-accent-action-contrast);
    color: var(--color-accent-action);
    background: var(--color-accent-action-contrast);
  }

  .landing-demands-action .landing-demand-sign-action:hover {
    background: var(--color-surface-subtle);
  }

  .landing-demands-action .landing-demand-sign-action:focus-visible {
    outline-color: var(--color-accent-action-contrast);
  }

  .landing-join-action,
  .landing-updates-action {
    display: grid;
    justify-items: start;
    align-content: start;
    gap: var(--space-4);
  }

  .landing-join-action p,
  .landing-updates-action p {
    max-inline-size: 58ch;
    margin: 0;
    font-size: 1rem;
    line-height: 1.5;
  }

  .landing-join-action p {
    color: var(--color-text-muted);
  }

  .campaign-newsletter {
    --flock-heading-color: var(--color-surface);
    --flock-kicker-color: var(--color-surface);

    color: var(--color-surface);
    background: var(--color-brand-primary);
  }

  .campaign-newsletter :is(.flock-kicker, .flock-heading) {
    color: inherit;
  }

  @media (width >= 58rem) {
    .landing-join,
    .landing-updates-inner {
      grid-template-columns: 3fr 2fr;
      align-items: center;
      gap: var(--space-8);
    }
  }
}
</style>
