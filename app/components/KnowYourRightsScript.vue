<script setup lang="ts">
defineProps<{
  label: string
}>()
</script>

<template>
  <div class="kyr-script">
    <p class="kyr-script-label">{{ label }}</p>
    <blockquote>
      <p><slot /></p>
    </blockquote>
  </div>
</template>

<style scoped>
@layer components {
  .kyr-script {
    display: grid;
    gap: var(--space-2);
    border-inline-start: var(--border-width-accent) solid var(--color-brand-highlight);
    padding: var(--space-4) var(--space-5);
    color: var(--color-brand-primary);
    background: var(--color-surface-subtle);
  }

  .kyr-script-label,
  .kyr-script blockquote,
  .kyr-script blockquote p {
    margin: 0;
  }

  .kyr-script-label {
    color: var(--color-brand-primary);
    font-size: 0.875rem;
    font-weight: var(--font-weight-bold);
  }

  .kyr-script blockquote p {
    max-inline-size: 62ch;
    font-size: clamp(1.125rem, 1.05rem + 0.3vw, 1.3rem);
    font-weight: var(--font-weight-bold);
    line-height: 1.55;
    overflow-wrap: anywhere;
    text-wrap: pretty;
  }
}
</style>
