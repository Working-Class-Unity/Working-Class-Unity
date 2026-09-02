<script setup lang="ts">
const route = useRoute()
const { t } = useI18n()

const campaignBase = '/campaigns/remove-flock-stockton'
const petitionUrl = 'https://tech.workingclassunity.com/deflock-stockton'
const campaignLinks = computed(() => [
  { to: campaignBase, label: t('removeFlock.navigation.overview') },
  { to: `${campaignBase}/what-stockton-bought`, label: t('removeFlock.navigation.whatStocktonBought') },
  { to: `${campaignBase}/why-safeguards-are-not-enough`, label: t('removeFlock.navigation.whySafeguards') },
  { to: `${campaignBase}/faq`, label: t('removeFlock.navigation.faq') }
])

function currentPage(path: string) {
  return route.path === path ? 'page' : undefined
}
</script>

<template>
  <div class="campaign-shell">
    <div class="campaign-bar">
      <NuxtLink class="campaign-name" :to="campaignBase" :aria-label="t('removeFlock.campaignHome')">
        <span class="campaign-name-kicker">WCU SIDE-QUEST</span>
        <span>Mass Surveillance</span>
      </NuxtLink>

      <nav class="campaign-navigation" :aria-label="t('removeFlock.navigationLabel')">
        <div class="campaign-navigation-scroll">
          <ul class="campaign-navigation-list" role="list">
            <li v-for="link in campaignLinks" :key="link.to">
              <NuxtLink class="campaign-navigation-link" :to="link.to" :aria-current="currentPage(link.to)">
                {{ link.label }}
              </NuxtLink>
            </li>
          </ul>
        </div>
      </nav>

      <a class="campaign-petition-link" :href="petitionUrl">{{ t('removeFlock.petitionAction') }}</a>
    </div>

    <div class="campaign-page-slot">
      <slot />
    </div>

    <footer class="campaign-footer" :aria-label="t('removeFlock.campaignLabel')">
      <div class="campaign-footer-intro">
        <NuxtLink class="campaign-footer-home" :to="campaignBase">Remove Mass Surveillance from Stockton</NuxtLink>
        <p>{{ t('removeFlock.footer.description') }}</p>
        <p class="campaign-footer-source-note">{{ t('removeFlock.footer.sourceNote') }}</p>
      </div>

      <div class="campaign-footer-column">
        <h2>{{ t('removeFlock.footer.campaign') }}</h2>
        <ul role="list">
          <li v-for="link in campaignLinks" :key="`footer-${link.to}`">
            <NuxtLink :to="link.to" :aria-current="currentPage(link.to)">{{ link.label }}</NuxtLink>
          </li>
        </ul>
      </div>

      <div class="campaign-footer-column">
        <h2>{{ t('removeFlock.footer.wcu') }}</h2>
        <ul role="list">
          <li>
            <NuxtLink to="/about">{{ t('navigation.about') }}</NuxtLink>
          </li>
          <li>
            <NuxtLink to="/calendar">{{ t('navigation.calendar') }}</NuxtLink>
          </li>
          <li>
            <NuxtLink to="/join">{{ t('navigation.signup') }}</NuxtLink>
          </li>
        </ul>
      </div>

      <div class="campaign-footer-column">
        <h2>{{ t('removeFlock.footer.accountability') }}</h2>
        <ul role="list">
          <li>
            <NuxtLink to="/legal/privacy">{{ t('removeFlock.footer.privacy') }}</NuxtLink>
          </li>
          <li>
            <NuxtLink to="/legal/terms">{{ t('removeFlock.footer.terms') }}</NuxtLink>
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

  .campaign-bar {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-5);
    min-width: 0;
    border-block: var(--border-width) solid var(--campaign-border);
    padding-inline: var(--campaign-content-inset);
    padding-block: var(--space-3);
  }

  .campaign-name {
    display: grid;
    gap: var(--space-1);
    min-block-size: var(--control-min-block-size);
    min-inline-size: max-content;
    align-content: center;
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: 1.125rem;
    font-stretch: 110%;
    font-weight: 700;
    line-height: 1;
    text-decoration: none;
  }

  .campaign-name-kicker {
    color: var(--color-accent-action);
    font-family: var(--font-family-mono);
    font-size: 0.6875rem;
    font-weight: var(--font-weight-strong);
    letter-spacing: 0.08em;
  }

  .campaign-navigation,
  .campaign-navigation-scroll {
    min-width: 0;
  }

  .campaign-navigation-scroll {
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    scrollbar-width: thin;
  }

  .campaign-navigation-list {
    display: flex;
    inline-size: max-content;
    min-inline-size: 100%;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .campaign-navigation-link {
    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    align-items: center;
    border-radius: var(--radius-1);
    padding: var(--space-2) var(--space-3);
    color: var(--color-brand-primary);
    font-size: 1rem;
    font-weight: 650;
    text-decoration: none;
    white-space: nowrap;
  }

  .campaign-navigation-link:hover,
  .campaign-navigation-link:focus-visible,
  .campaign-navigation-link[aria-current='page'] {
    color: var(--color-brand-primary);
    background: var(--color-action-soft);
  }

  .campaign-petition-link {
    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    align-items: center;
    border: 2px solid var(--color-accent-action);
    border-radius: var(--radius-1);
    padding: var(--space-2) var(--space-3);
    color: var(--color-accent-action);
    background: transparent;
    font-size: 1rem;
    font-weight: 650;
    line-height: 1.2;
    text-align: center;
    text-decoration: none;
  }

  .campaign-petition-link:hover,
  .campaign-petition-link:focus-visible {
    border-color: var(--color-brand-primary);
    color: var(--color-brand-primary);
    background: var(--color-action-soft);
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
    .campaign-navigation-link,
    .campaign-footer-intro p,
    .campaign-footer-column a,
    .campaign-footer-column span {
      font-size: 0.9375rem;
    }

    .campaign-petition-link {
      font-size: 0.875rem;
    }

    .campaign-footer-intro .campaign-footer-source-note {
      font-size: 0.8125rem;
    }
  }

  @media (width <= 68rem) {
    .campaign-bar {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-3);
    }

    .campaign-navigation {
      grid-column: 1 / -1;
      grid-row: 2;
      margin-inline: calc(-1 * var(--campaign-content-inset));
    }

    .campaign-navigation-list {
      justify-content: flex-start;
      padding-inline: var(--campaign-content-inset);
    }

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

    .campaign-name {
      font-size: 1rem;
    }

    .campaign-petition-link {
      max-inline-size: 8.5rem;
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
