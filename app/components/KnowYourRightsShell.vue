<script setup lang="ts">
import { knowYourRightsBasePath, knowYourRightsGuides } from '~/content/know-your-rights'

const route = useRoute()
const { t } = useI18n()
const familyLinks = computed(() => [
  { path: knowYourRightsBasePath, label: t('kyr.overview.title') },
  ...knowYourRightsGuides.map((guide) => ({ path: guide.path, label: t(guide.titleKey) }))
])
</script>

<template>
  <div class="kyr-shell">
    <header class="kyr-family-header">
      <div class="kyr-family-controls">
        <p class="kyr-family-name">{{ t('kyr_nav.section_label') }}</p>
      </div>

      <nav class="kyr-family-navigation" :aria-label="t('knowYourRights.interface.navigationLabel')">
        <div class="kyr-family-navigation-scroll">
          <ul role="list">
            <li v-for="link in familyLinks" :key="link.path">
              <NuxtLink :to="link.path" :aria-current="route.path === link.path ? 'page' : undefined">
                {{ link.label }}
              </NuxtLink>
            </li>
          </ul>
        </div>
      </nav>
    </header>

    <slot />
  </div>
</template>

<style scoped>
@layer components {
  .kyr-shell {
    min-width: 0;
    background: var(--color-surface);
  }

  .kyr-family-header {
    min-width: 0;
    border-block: var(--border-width) solid var(--color-divider-strong);
  }

  .kyr-family-controls {
    min-width: 0;
    padding: var(--space-4) var(--space-5);
  }

  .kyr-family-name {
    margin: 0;
    color: var(--color-brand-primary);
    font-size: 1.125rem;
    font-weight: var(--font-weight-bold);
    line-height: 1.25;
  }

  .kyr-family-navigation,
  .kyr-family-navigation-scroll {
    min-width: 0;
  }

  .kyr-family-navigation ul {
    display: flex;
    flex-wrap: wrap;
    inline-size: 100%;
    min-inline-size: 100%;
    padding: 0 var(--space-3);
    margin: 0;
    list-style: none;
  }

  .kyr-family-navigation a {
    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    align-items: center;
    border-block-start: 2px solid transparent;
    border-block-end: 2px solid transparent;
    padding: var(--space-2);
    color: var(--color-text-muted);
    font-size: 0.9375rem;
    line-height: 1.35;
    text-decoration: none;
    white-space: normal;
  }

  .kyr-family-navigation a:hover,
  .kyr-family-navigation a:focus-visible {
    color: var(--color-brand-primary);
    background: var(--color-action-soft);
  }

  .kyr-family-navigation a[aria-current='page'] {
    border-block-end-color: var(--color-brand-primary);
    color: var(--color-brand-primary);
    background: var(--color-action-soft);
  }

  @media (width <= 40rem) {
    .kyr-family-controls {
      padding-inline: var(--space-4);
    }

    .kyr-family-navigation-scroll {
      overflow-x: auto;
      overscroll-behavior-inline: contain;
      scrollbar-width: thin;
    }

    .kyr-family-navigation ul {
      flex-wrap: nowrap;
      inline-size: max-content;
    }

    .kyr-family-navigation a {
      white-space: nowrap;
    }
  }
}
</style>
