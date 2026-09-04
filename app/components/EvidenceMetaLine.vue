<script setup lang="ts">
import { computed } from 'vue'

const { t } = useI18n()

const props = defineProps<{
  status?: string
  place?: string
  currentThrough?: string
  sourceLabel?: string
  sourceHref?: string
}>()

const hasMetadata = computed(() => Boolean(props.status || props.place || props.currentThrough || props.sourceLabel))
</script>

<template>
  <ul v-if="hasMetadata" class="evidence-meta" role="list">
    <li v-if="props.status">{{ props.status }}</li>
    <li v-if="props.place">{{ props.place }}</li>
    <li v-if="props.currentThrough">{{ props.currentThrough }}</li>
    <li v-if="props.sourceLabel">
      <span class="visually-hidden">{{ t('common.source') }}: </span>
      <a v-if="props.sourceHref" :href="props.sourceHref">{{ props.sourceLabel }}</a>
      <span v-else>{{ props.sourceLabel }}</span>
    </li>
  </ul>
</template>

<style scoped>
@layer components {
  .evidence-meta {
    display: flex;
    gap: var(--space-2) var(--space-3);
    flex-wrap: wrap;
    padding: 0;
    margin: 0;
    color: var(--evidence-meta-color, var(--color-text-muted));
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-strong);
    line-height: 1.4;
    list-style: none;
  }

  .evidence-meta li {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
  }

  .evidence-meta li:not(:last-child)::after {
    color: var(--color-border);
    content: '·';
  }

  .evidence-meta a {
    --anchor-color: var(--evidence-meta-color, var(--color-text-muted));

    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    align-items: center;
    color: var(--anchor-color);
    text-decoration-thickness: 1px;
  }

  .evidence-meta a:hover,
  .evidence-meta a:focus-visible {
    --anchor-color: var(--evidence-meta-link-hover, var(--color-brand-primary));
  }
}
</style>
