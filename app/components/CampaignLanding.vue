<script setup lang="ts">
import type { CampaignSection } from '~/content/remove-flock-stockton'

const { campaignFacts, campaignLandingPage } = useRemoveFlockContent()

function section(id: string): CampaignSection {
  const content = campaignLandingPage.value.sections.find((item) => item.id === id)
  if (!content) throw new Error(`Missing campaign section: ${id}`)
  return content
}
</script>

<template>
  <article class="campaign-landing" aria-labelledby="remove-flock-title">
    <CampaignLandingHero :page="campaignLandingPage" />
    <CampaignLandingEvents />
    <CampaignLandingCouncil :section="section('verified-facts')" :facts="campaignFacts" />
    <CampaignLandingSystem :section="section('system')" />
    <CampaignLandingCase
      :why-remove="section('why-remove')"
      :safeguards="section('safeguards')"
      :safety="section('real-safety')"
    />
    <CampaignLandingActions :participate="section('participate')" />
  </article>
</template>

<style scoped>
@layer components {
  .campaign-landing {
    min-width: 0;
    color: var(--color-text);
    background: var(--color-surface);
    overflow-wrap: anywhere;
  }

  /* Shared presentation contract for the overview's feature-owned sections. */
  .campaign-landing :deep(section[id]) {
    scroll-margin-block-start: var(--space-5);
  }

  .campaign-landing :deep(.flock-field) {
    inline-size: 100%;
    max-inline-size: var(--home-content-max-width);
    padding-inline: clamp(1.5rem, 3vw, 3.25rem);
    margin-inline: auto;
  }

  .campaign-landing :deep(.flock-section) {
    padding-block: clamp(3rem, 6vw, 5.5rem);
  }

  .campaign-landing :deep(.flock-section-head) {
    display: grid;
    gap: var(--space-5);
    justify-items: start;
  }

  .campaign-landing :deep(.flock-kicker) {
    margin: 0;
    color: var(--flock-kicker-color, var(--color-accent-action));
    font-family: var(--font-family-mono);
    font-size: 1rem;
    font-weight: 650;
    line-height: 1.4;
    letter-spacing: 0.055em;
  }

  .campaign-landing :deep(.flock-heading) {
    max-inline-size: 25ch;
    margin: 0;
    color: var(--flock-heading-color, var(--color-brand-primary));
    font-size: clamp(2rem, 3.5vw, 3.5rem);
    font-weight: 700;
    line-height: 1.08;
    letter-spacing: -0.035em;
    text-wrap: balance;
  }

  .campaign-landing :deep(.flock-copy) {
    max-inline-size: 64ch;
    margin: 0;
    font-size: 1.1875rem;
    line-height: 1.55;
    text-wrap: pretty;
  }
}
</style>
