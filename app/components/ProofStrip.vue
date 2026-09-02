<script setup lang="ts">
import { computed } from 'vue'

type ProofStripItem = Readonly<{
  value: string
  label: string
  currentThrough: string
  sourceLabel: string
  sourceHref: string
  context?: string
}>

const props = defineProps<{
  items: readonly ProofStripItem[]
}>()

const completeItems = computed(() =>
  props.items.filter((item) => item.value && item.label && item.currentThrough && item.sourceLabel && item.sourceHref)
)
</script>

<template>
  <ul class="proof-strip" role="list">
    <li v-for="item in completeItems" :key="`${item.value}-${item.label}`">
      <p class="proof-value">{{ item.value }}</p>
      <p class="proof-label">{{ item.label }}</p>
      <p v-if="item.context" class="proof-context">{{ item.context }}</p>
      <EvidenceMetaLine
        :current-through="item.currentThrough"
        :source-href="item.sourceHref"
        :source-label="item.sourceLabel"
      />
    </li>
  </ul>
</template>

<style scoped>
@layer components {
  .proof-strip {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    padding: 0;
    margin: 0;
    border-block: var(--border-width) solid var(--color-border);
    list-style: none;
  }

  .proof-strip > li {
    display: grid;
    align-content: start;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-6);
  }

  .proof-strip > li + li {
    border-inline-start: var(--border-width) solid var(--color-border);
  }

  .proof-value,
  .proof-label,
  .proof-context {
    margin: 0;
  }

  .proof-value {
    color: var(--color-brand-primary);
    font-family: var(--font-family-statement);
    font-size: clamp(1.75rem, 1.35rem + 1.1vw, 2.5rem);
    line-height: 1;
  }

  .proof-label {
    color: var(--color-text);
    font-size: 1.125rem;
    font-weight: var(--font-weight-bold);
    line-height: 1.25;
  }

  .proof-context {
    color: var(--color-text-muted);
    line-height: 1.45;
  }

  @media (width <= 48rem) {
    .proof-strip {
      grid-template-columns: minmax(0, 1fr);
    }

    .proof-strip > li {
      padding-inline: 0;
    }

    .proof-strip > li + li {
      border-block-start: var(--border-width) solid var(--color-border);
      border-inline-start: 0;
    }
  }
}
</style>
