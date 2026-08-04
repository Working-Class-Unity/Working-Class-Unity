<script setup lang="ts">
const props = defineProps<{
  tone: 'error' | 'success' | 'warning' | 'info'
}>()

const liveRole = computed(() => (props.tone === 'error' ? 'alert' : 'status'))
</script>

<template>
  <p class="status-message" :data-tone="props.tone" :role="liveRole">
    <slot />
  </p>
</template>

<style scoped>
@layer components {
  .status-message {
    border: var(--border-width) solid var(--color-border);
    border-inline-start-width: var(--border-width-accent);
    border-radius: var(--radius-2);
    padding: var(--space-3);
    margin: 0;
    color: var(--color-text);
    background: var(--color-surface);
    font-weight: var(--font-weight-strong);
  }

  .status-message[data-tone='info'] {
    border-inline-start-color: var(--color-action);
    background: var(--color-action-soft);
  }

  .status-message[data-tone='success'] {
    border-inline-start-color: var(--color-status-success-text);
    color: var(--color-status-success-text);
    background: var(--color-status-success-surface);
  }

  .status-message[data-tone='warning'] {
    border-inline-start-color: var(--color-status-warning-text);
    color: var(--color-status-warning-text);
    background: var(--color-status-warning-surface);
  }

  .status-message[data-tone='error'] {
    border-inline-start-color: var(--color-status-error-text);
    color: var(--color-status-error-text);
    background: var(--color-status-error-surface);
  }
}
</style>
