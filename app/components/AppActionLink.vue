<script setup lang="ts">
import { computed, useAttrs } from 'vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    to: string
    variant?: 'primary' | 'secondary' | 'campaign'
    size?: 'default' | 'compact'
  }>(),
  {
    variant: 'primary',
    size: 'default'
  }
)

const attrs = useAttrs()
const external = computed(() => /^(?:https?:|mailto:|tel:)/.test(props.to))
const opensNewContext = computed(() => attrs.target === '_blank')
</script>

<template>
  <a
    v-if="external"
    v-bind="$attrs"
    class="app-action-link"
    :data-size="props.size"
    :data-variant="props.variant"
    :href="props.to"
  >
    <slot />
    <span v-if="opensNewContext" class="visually-hidden"> (opens in a new tab)</span>
  </a>
  <NuxtLink
    v-else
    v-bind="$attrs"
    class="app-action-link"
    :data-size="props.size"
    :data-variant="props.variant"
    :to="props.to"
  >
    <slot />
  </NuxtLink>
</template>

<style scoped>
@layer components {
  .app-action-link {
    --anchor-color: var(--action-link-foreground);

    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    min-inline-size: var(--control-min-inline-size);
    max-inline-size: 100%;
    align-items: center;
    justify-content: center;
    border: var(--border-width) solid var(--action-link-border);
    border-radius: var(--radius-1);
    padding: var(--space-3) var(--space-5);
    color: var(--anchor-color);
    background: var(--action-link-background);
    font-weight: var(--font-weight-bold);
    line-height: 1.2;
    text-align: center;
    text-decoration: none;
  }

  .app-action-link[data-size='compact'] {
    padding-inline: var(--space-4);
  }

  .app-action-link[data-variant='primary'] {
    --action-link-border: var(--color-brand-primary);
    --action-link-foreground: var(--color-action-contrast);
    --action-link-background: var(--color-brand-primary);
  }

  .app-action-link[data-variant='secondary'] {
    --action-link-border: var(--color-brand-primary);
    --action-link-foreground: var(--color-brand-primary);
    --action-link-background: transparent;
  }

  .app-action-link[data-variant='campaign'] {
    --action-link-border: var(--color-accent-action);
    --action-link-foreground: var(--color-accent-action-contrast);
    --action-link-background: var(--color-accent-action);
  }

  .app-action-link[data-variant='primary']:hover,
  .app-action-link[data-variant='primary']:focus-visible,
  .app-action-link[data-variant='campaign']:hover,
  .app-action-link[data-variant='campaign']:focus-visible {
    --action-link-border: var(--color-text);
    --action-link-background: var(--color-text);
  }

  .app-action-link[data-variant='secondary']:hover,
  .app-action-link[data-variant='secondary']:focus-visible {
    --action-link-background: var(--color-action-soft);
  }
}
</style>
