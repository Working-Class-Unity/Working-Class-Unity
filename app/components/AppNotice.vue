<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    tone: 'error' | 'success' | 'warning' | 'info'
    announce?: 'polite' | 'assertive'
    title?: string
  }>(),
  {
    announce: undefined,
    title: ''
  }
)

const liveRole = computed(() => {
  if (props.announce === 'assertive') return 'alert'
  if (props.announce === 'polite') return 'status'
  return undefined
})
</script>

<template>
  <div
    class="app-notice"
    :data-tone="props.tone"
    :role="liveRole"
    :aria-live="props.announce"
    :aria-atomic="props.announce ? 'true' : undefined"
  >
    <strong v-if="props.title" class="notice-title">{{ props.title }}</strong>
    <div class="notice-content"><slot /></div>
  </div>
</template>

<style scoped>
@layer components {
  .app-notice {
    border: var(--border-width) solid var(--color-border);
    border-inline-start-width: var(--border-width-accent);
    border-radius: var(--radius-2);
    padding: var(--space-3);
    color: var(--color-text);
    background: var(--color-surface);
  }

  .app-notice[data-tone='info'] {
    border-inline-start-color: var(--color-action);
    background: var(--color-action-soft);
  }

  .app-notice[data-tone='success'] {
    border-inline-start-color: var(--color-status-success-text);
    color: var(--color-status-success-text);
    background: var(--color-status-success-surface);
  }

  .app-notice[data-tone='warning'] {
    border-inline-start-color: var(--color-status-warning-text);
    color: var(--color-status-warning-text);
    background: var(--color-status-warning-surface);
  }

  .app-notice[data-tone='error'] {
    border-inline-start-color: var(--color-status-error-text);
    color: var(--color-status-error-text);
    background: var(--color-status-error-surface);
  }

  .notice-title,
  .notice-content {
    display: block;
  }

  .notice-content {
    display: grid;
    gap: var(--space-2);
    font-weight: var(--font-weight-strong);
  }

  .notice-title + .notice-content {
    margin-block-start: var(--space-1);
  }

  .notice-content :deep(> :first-child) {
    margin-block-start: 0;
  }

  .notice-content :deep(> :last-child) {
    margin-block-end: 0;
  }
}
</style>
