<script setup lang="ts">
import { citedTextPlainText, type CampaignSection } from '~/content/remove-flock-stockton'

defineProps<{ whyRemove: CampaignSection; safeguards: CampaignSection; safety: CampaignSection }>()
const { t } = useI18n()
const caseLabels = ['safety', 'risk']
const safetyLabels = ['homes', 'work', 'care']
</script>

<template>
  <div class="landing-case">
    <section id="why-remove" class="landing-power flock-section" aria-labelledby="power-title">
      <div class="flock-field landing-power-inner">
        <header class="flock-section-head">
          <p class="flock-kicker">{{ t('removeFlock.landing.whyRemoval') }}</p>
          <h2 id="power-title" class="flock-heading">{{ whyRemove.title }}</h2>
          <p class="flock-copy">{{ whyRemove.summary }}</p>
        </header>
        <div class="landing-power-points">
          <div v-for="(point, index) in whyRemove.points" :key="caseLabels[index]" class="landing-case-point">
            <h3>{{ t(`removeFlock.landing.caseLabels.${caseLabels[index]}`) }}</h3>
            <p>{{ citedTextPlainText(point) }}</p>
          </div>
          <div class="landing-case-point">
            <h3>{{ safeguards.title }}</h3>
            <p>{{ safeguards.summary }}</p>
            <AppActionLink to="/campaigns/remove-flock-stockton/why-safeguards-are-not-enough" variant="text-inverse"
              >{{ t('removeFlock.landing.readRemovalCase') }} <span aria-hidden="true">&nbsp;→</span></AppActionLink
            >
          </div>
        </div>
      </div>
    </section>

    <section id="real-safety" class="flock-section flock-field landing-safety" aria-labelledby="safety-title">
      <header class="flock-section-head">
        <p class="flock-kicker">{{ t('removeFlock.landing.safetyEyebrow') }}</p>
        <h2 id="safety-title" class="flock-heading">{{ safety.title }}</h2>
        <p class="flock-copy">{{ safety.summary }}</p>
      </header>
      <ul class="landing-safety-list" role="list">
        <li v-for="(point, index) in safety.points" :key="safetyLabels[index]" class="landing-case-point">
          <h3>{{ t(`removeFlock.landing.safetyLabels.${safetyLabels[index]}`) }}</h3>
          <p>{{ citedTextPlainText(point) }}</p>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
@layer components {
  .landing-power {
    --flock-heading-color: var(--color-surface);
    --flock-kicker-color: var(--color-surface);

    color: var(--color-surface);
    background: var(--color-brand-primary);
  }

  .landing-power-inner,
  .landing-safety {
    display: grid;
    gap: var(--space-7);
  }

  .landing-power :is(.flock-kicker, .flock-heading, h3) {
    color: inherit;
  }

  .landing-power .flock-heading {
    max-inline-size: 18ch;
  }

  .landing-power-points,
  .landing-safety-list {
    display: grid;
    gap: var(--space-6);
  }

  .landing-case-point {
    display: grid;
    gap: var(--space-3);
    align-content: start;
    justify-items: start;
  }

  .landing-case-point h3 {
    margin: 0;
    font-size: 1.375rem;
    font-weight: 650;
    line-height: 1.2;
    text-wrap: balance;
  }

  .landing-case-point p {
    margin: 0;
    max-inline-size: 58ch;
    font-size: 1.125rem;
    line-height: 1.5;
    text-wrap: pretty;
  }

  .landing-safety-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  @media (width >= 58rem) {
    .landing-power-points,
    .landing-safety-list {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--space-7);
    }
  }
}
</style>
