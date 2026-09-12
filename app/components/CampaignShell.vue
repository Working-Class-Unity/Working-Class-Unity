<script setup lang="ts">
import { unlocalizedPublicPath } from '#shared/public-site'
import { flockNavigation } from '~/content/navigation'

const route = useRoute()
const publicPath = computed(() => unlocalizedPublicPath(route.path))
const { t } = useI18n()

const campaignBase = flockNavigation.path
const petitionUrl = 'https://tech.workingclassunity.com/deflock-stockton'
const campaignLinks = computed(() => flockNavigation.links.map((link) => ({ path: link.path, label: t(link.label) })))

function currentPage(path: string) {
  return publicPath.value === path ? 'page' : undefined
}
</script>

<template>
  <div class="campaign-shell">
    <div class="campaign-page-slot" :class="{ 'campaign-page-slot--overview': publicPath === campaignBase }">
      <slot />
    </div>

    <footer class="campaign-footer" :aria-label="t('removeFlock.campaignLabel')">
      <div class="campaign-footer-intro">
        <NuxtLinkLocale class="campaign-footer-home" :to="campaignBase">{{
          t('removeFlock.shell.footerHome')
        }}</NuxtLinkLocale>
        <p>{{ t('removeFlock.footer.description') }}</p>
        <p class="campaign-footer-source-note">{{ t('removeFlock.footer.sourceNote') }}</p>
      </div>

      <div class="campaign-footer-column">
        <h2>{{ t('removeFlock.footer.campaign') }}</h2>
        <ul role="list">
          <li v-for="link in campaignLinks" :key="`footer-${link.path}`">
            <NuxtLinkLocale :to="link.path" :aria-current="currentPage(link.path)">{{ link.label }}</NuxtLinkLocale>
          </li>
        </ul>
      </div>

      <div class="campaign-footer-column">
        <h2>{{ t('removeFlock.footer.wcu') }}</h2>
        <ul role="list">
          <li>
            <NuxtLinkLocale to="/about">{{ t('navigation.about') }}</NuxtLinkLocale>
          </li>
          <li>
            <NuxtLinkLocale to="/calendar">{{ t('navigation.calendar') }}</NuxtLinkLocale>
          </li>
          <li>
            <NuxtLinkLocale to="/join">{{ t('navigation.join') }}</NuxtLinkLocale>
          </li>
        </ul>
      </div>

      <div class="campaign-footer-column">
        <h2>{{ t('removeFlock.footer.accountability') }}</h2>
        <ul role="list">
          <li>
            <NuxtLinkLocale to="/legal/privacy">{{ t('removeFlock.footer.privacy') }}</NuxtLinkLocale>
          </li>
          <li>
            <NuxtLinkLocale to="/legal/terms">{{ t('removeFlock.footer.terms') }}</NuxtLinkLocale>
          </li>
          <li>
            <a :href="petitionUrl">{{ t('removeFlock.petitionAction') }}</a>
          </li>
        </ul>
      </div>
    </footer>
  </div>
</template>

<style scoped>
@layer components {
  .campaign-shell {
    --campaign-border: var(--color-divider-strong);
    --campaign-content-inset: var(--home-content-inset);

    min-width: 0;
  }

  .campaign-page-slot.campaign-page-slot--overview {
    padding-inline: 0;
  }

  .campaign-page-slot {
    min-width: 0;
    padding-inline: var(--campaign-content-inset);
  }

  .campaign-footer {
    display: grid;
    grid-template-columns: minmax(16rem, 2fr) repeat(3, minmax(9rem, 1fr));
    gap: clamp(2rem, 4vw, 4rem);
    border-block-start: var(--border-width) solid var(--campaign-border);
    padding-inline: var(--campaign-content-inset);
    padding-block: clamp(2.5rem, 7vw, 5rem);
  }

  .campaign-footer p,
  .campaign-footer h2,
  .campaign-footer ul {
    margin: 0;
  }

  .campaign-footer :is(h2, p, a, span) {
    overflow-wrap: anywhere;
  }

  .campaign-footer-intro {
    display: grid;
    align-content: start;
    gap: var(--space-3);
    min-width: 0;
  }

  .campaign-footer-home {
    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    align-items: center;
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: 1.25rem;
    font-stretch: 110%;
    font-weight: 700;
    text-decoration: none;
  }

  .campaign-footer-intro p {
    max-inline-size: 42ch;
    color: var(--color-text-muted);
    font-size: 1rem;
    text-wrap: pretty;
  }

  .campaign-footer-intro .campaign-footer-source-note {
    font-size: 1rem;
  }

  .campaign-footer-column {
    min-width: 0;
  }

  .campaign-footer-column h2 {
    color: var(--color-brand-primary);
    font-family: var(--font-family-body);
    font-size: 0.875rem;
    font-weight: var(--font-weight-strong);
  }

  .campaign-footer-column ul {
    display: grid;
    gap: var(--space-2);
    padding: 0;
    margin-block-start: var(--space-3);
    list-style: none;
  }

  .campaign-footer-column a,
  .campaign-footer-column span {
    color: var(--color-text-muted);
    font-size: 1rem;
    font-weight: 400;
  }

  .campaign-footer-column a {
    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    min-inline-size: var(--control-min-inline-size);
    align-items: center;
  }

  .campaign-footer-column a:hover,
  .campaign-footer-column a:focus-visible,
  .campaign-footer-column a[aria-current='page'] {
    color: var(--color-brand-primary);
  }

  @media (width > 40rem) {
    .campaign-footer-intro p,
    .campaign-footer-column a,
    .campaign-footer-column span {
      font-size: 0.9375rem;
    }

    .campaign-footer-intro .campaign-footer-source-note {
      font-size: 0.8125rem;
    }
  }

  @media (width <= 68rem) {
    .campaign-footer {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .campaign-footer-intro {
      grid-column: 1 / -1;
    }
  }

  @media (width <= 40rem) {
    .campaign-shell {
      --campaign-content-inset: var(--content-gutter-compact);
    }

    .campaign-footer {
      grid-template-columns: minmax(0, 1fr);
    }

    .campaign-footer-intro {
      grid-column: auto;
    }
  }
}
</style>
