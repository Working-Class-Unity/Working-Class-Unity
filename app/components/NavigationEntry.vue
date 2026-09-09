<script setup lang="ts">
import type { NavigationDestination } from '~/content/navigation'

defineProps<{ entry: NavigationDestination; current?: boolean }>()
const titleId = useId()
const descriptionId = useId()
</script>

<template>
  <NuxtLinkLocale
    class="navigation-entry"
    :to="entry.path"
    :aria-current="current ? 'page' : undefined"
    :aria-labelledby="titleId"
    :aria-describedby="entry.description ? descriptionId : undefined"
  >
    <span :id="titleId" class="navigation-entry-title">{{ entry.label }}</span>
    <time v-if="entry.datetime" :id="descriptionId" class="navigation-entry-description" :datetime="entry.datetime">{{
      entry.description
    }}</time>
    <span v-else-if="entry.description" :id="descriptionId" class="navigation-entry-description">{{
      entry.description
    }}</span>
  </NuxtLinkLocale>
</template>

<style scoped>
@layer components {
  .navigation-entry {
    display: grid;
    align-content: start;
    gap: var(--space-1);
    min-inline-size: 0;
    min-block-size: var(--control-min-block-size);
    border-radius: var(--radius-1);
    padding: var(--space-3);
    color: var(--color-brand-primary);
    font-size: 1rem;
    line-height: 1.45;
    text-decoration: none;
    overflow-wrap: anywhere;
  }

  .navigation-entry:hover,
  .navigation-entry:focus-visible,
  .navigation-entry[aria-current='page'] {
    background: var(--color-action-soft);
  }

  .navigation-entry-title {
    font-weight: var(--font-weight-bold);
  }

  .navigation-entry[aria-current='page'] .navigation-entry-title {
    text-decoration: underline;
    text-underline-offset: 0.25em;
  }

  .navigation-entry-description {
    color: var(--color-text-muted);
    font-weight: 400;
  }
}
</style>
