<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    type?: 'button' | 'submit' | 'reset'
    variant?: 'primary' | 'secondary' | 'danger'
    size?: 'default' | 'compact'
    disabled?: boolean
    pending?: boolean
  }>(),
  {
    type: 'button',
    variant: 'primary',
    size: 'default',
    disabled: false,
    pending: false
  }
)
</script>

<template>
  <button
    class="app-button"
    :data-variant="props.variant"
    :data-size="props.size"
    :type="props.type"
    :disabled="props.disabled || props.pending"
    :aria-busy="props.pending ? 'true' : undefined"
  >
    <slot />
  </button>
</template>

<style scoped>
@layer components {
  .app-button {
    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    min-inline-size: var(--control-min-inline-size);
    align-items: center;
    justify-content: center;
    border: var(--border-width) solid var(--color-action);
    border-radius: var(--radius-1);
    padding-inline: var(--space-4);
    color: var(--color-action-contrast);
    background: var(--color-action);
    font-weight: var(--font-weight-bold);
    line-height: 1.2;
    text-align: center;
  }

  .app-button[data-size='compact'] {
    padding-inline: var(--space-3);
  }

  .app-button[data-variant='secondary'] {
    border-color: var(--color-control-border);
    color: var(--color-text);
    background: var(--color-surface);
  }

  .app-button[data-variant='danger'] {
    border-color: var(--color-status-error-text);
    color: var(--color-surface);
    background: var(--color-status-error-text);
  }

  .app-button:disabled {
    cursor: not-allowed;
  }

  .app-button[aria-busy='true'] {
    cursor: progress;
  }

  .app-button:focus-visible,
  .app-button:hover:not(:disabled) {
    border-color: var(--color-text);
    background: var(--color-text);
  }

  .app-button[data-variant='secondary']:focus-visible,
  .app-button[data-variant='secondary']:hover:not(:disabled) {
    border-color: var(--color-action);
    background: var(--color-action-soft);
  }
}
</style>
