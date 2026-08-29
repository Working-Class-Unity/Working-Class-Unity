<script setup lang="ts">
import CampaignLandingArgument from '~/components/campaign/LandingArgument.vue'
import CampaignLandingDemand from '~/components/campaign/LandingDemand.vue'
import CampaignLandingHero from '~/components/campaign/LandingHero.vue'
import CampaignLandingParticipation from '~/components/campaign/LandingParticipation.vue'
import CampaignLandingSafeguards from '~/components/campaign/LandingSafeguards.vue'
import CampaignLandingSafety from '~/components/campaign/LandingSafety.vue'
import CampaignLandingSystem from '~/components/campaign/LandingSystem.vue'
import { campaignFacts, campaignLandingPage, petitionDemand } from '~/content/remove-flock-stockton'
import type { CampaignSection } from '~/content/remove-flock-stockton'

const landingSections: readonly CampaignSection[] = campaignLandingPage.sections
const sectionById = new Map(landingSections.map((section) => [section.id, section]))

const whyRemove = sectionById.get('why-remove')!
const system = sectionById.get('system')!
const safeguards = sectionById.get('safeguards')!
const realSafety = sectionById.get('real-safety')!
const participate = sectionById.get('participate')!
const petitionUrl = 'https://tech.workingclassunity.com/deflock-stockton'
</script>

<template>
  <article class="campaign-landing" aria-labelledby="remove-flock-title">
    <CampaignLandingHero
      class="campaign-landing-divider campaign-landing-section--hero"
      :facts="campaignFacts"
      :page="campaignLandingPage"
      :petition-url="petitionUrl"
    />
    <CampaignLandingArgument
      class="campaign-landing-divider campaign-landing-section"
      image-alt="Working Class Unity members meeting around a table."
      :section="whyRemove"
    />
    <CampaignLandingSystem class="campaign-landing-section campaign-landing-section--full-bleed" :section="system" />
    <CampaignLandingSafeguards
      class="campaign-landing-divider campaign-landing-section"
      :section="safeguards"
      :sources="campaignLandingPage.sources"
    />
    <CampaignLandingDemand
      class="campaign-landing-divider campaign-landing-section campaign-landing-section--demand"
      :demand="petitionDemand"
      :petition-url="petitionUrl"
    />
    <CampaignLandingSafety class="campaign-landing-divider campaign-landing-section" :section="realSafety" />
    <CampaignLandingParticipation
      class="campaign-landing-divider campaign-landing-section campaign-landing-section--full-bleed"
      :section="participate"
    />
  </article>
</template>

<style scoped>
@layer components {
  .campaign-landing {
    --campaign-divider: var(--color-divider-strong);
    --campaign-grid-gap: clamp(1.5rem, 3.5vw, 3.5rem);

    min-width: 0;
    padding-block-end: clamp(4rem, 8vw, 7rem);
  }

  .campaign-landing-divider {
    border-block-end: var(--border-width) solid var(--campaign-divider);
  }

  .campaign-landing-section {
    padding-block: clamp(4rem, 8vw, 7rem);
  }

  .campaign-landing-section--hero {
    padding-block: clamp(3.75rem, 8vw, 7.5rem);
  }

  .campaign-landing-section--full-bleed {
    margin-inline: calc(-1 * var(--campaign-content-inset));
    padding-inline: var(--campaign-content-inset);
  }

  .campaign-landing-section--demand {
    padding-inline: clamp(1.5rem, 4vw, 4rem);
  }

  @media (width <= 46rem) {
    .campaign-landing-section--demand {
      margin-inline: calc(-1 * var(--content-gutter-compact));
      padding-inline: var(--content-gutter-compact);
    }
  }
}
</style>
