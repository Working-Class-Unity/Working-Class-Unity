<script setup lang="ts">
import { flockNavigation } from '~/content/navigation'
import type { CampaignPageContent } from '~/content/remove-flock-stockton'

defineProps<{ page: CampaignPageContent }>()
const { t } = useI18n()
const detailLinks = flockNavigation.links.filter((link) => link.path !== flockNavigation.path)
</script>

<template>
  <section class="landing-hero flock-field" aria-labelledby="remove-flock-title">
    <div class="landing-hero-copy">
      <p class="flock-kicker">{{ page.eyebrow }}</p>
      <h1 id="remove-flock-title" class="landing-title">{{ page.title }}</h1>
      <p class="flock-copy">{{ page.description }}</p>
      <div>
        <AppActionLink
          to="https://tech.workingclassunity.com/deflock-stockton"
          variant="campaign"
          class="landing-sign-action"
        >
          {{ t('removeFlock.landing.signDemand') }}
        </AppActionLink>
      </div>
      <nav class="landing-hero-links" :aria-label="t('removeFlock.navigationLabel')">
        <ul role="list">
          <li v-for="link in detailLinks" :key="link.path">
            <NuxtLinkLocale :to="link.path">{{ t(link.label) }}</NuxtLinkLocale>
          </li>
        </ul>
      </nav>
    </div>
    <figure class="landing-hero-photo">
      <!-- eslint-disable-next-line vue/html-self-closing -->
      <img
        src="/images/flock-overview/camera-illustration-768.webp"
        srcset="
          /images/flock-overview/camera-illustration-480.webp   480w,
          /images/flock-overview/camera-illustration-768.webp   768w,
          /images/flock-overview/camera-illustration-1280.webp 1280w,
          /images/flock-overview/camera-illustration-1572.webp 1572w
        "
        sizes="(min-width: 78rem) 33rem, (min-width: 52rem) 44vw, (min-width: 50rem) 94vw, calc(100vw - 3rem)"
        :alt="t('removeFlock.landing.cameraAlt')"
        width="1572"
        height="1001"
        fetchpriority="high"
      />
    </figure>
  </section>
</template>

<style scoped>
@layer components {
  .landing-hero {
    display: grid;
    align-items: center;
    gap: var(--space-7);
    padding-block: clamp(2.5rem, 5vw, 5rem);
  }

  .landing-hero-copy {
    display: grid;
    min-width: 0;
    gap: var(--space-5);
    justify-items: start;
  }

  .landing-title {
    max-inline-size: 15ch;
    margin: 0;
    color: var(--color-brand-primary);
    font-size: clamp(2.7rem, 5.4vw, 5.25rem);
    font-weight: 750;
    line-height: 0.99;
    letter-spacing: -0.045em;
    text-wrap: balance;
  }

  .landing-sign-action {
    min-block-size: 3.25rem;
  }

  .landing-hero-links ul {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-5);
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .landing-hero-links a {
    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    align-items: center;
    color: var(--color-brand-primary);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .landing-hero-photo {
    min-width: 0;
    margin: 0;
  }

  .landing-hero-photo img {
    inline-size: 100%;
    block-size: auto;
  }

  @media (width >= 52rem) {
    .landing-hero {
      grid-template-columns: 11fr 10fr;
      gap: var(--space-8);
    }
  }
}
</style>
