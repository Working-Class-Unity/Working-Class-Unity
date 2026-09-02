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
      <p class="proof-meta">
        <span>{{ item.label }}</span>
        <span aria-hidden="true"> · </span>
        <span>{{ item.currentThrough }}</span>
        <span aria-hidden="true"> · </span>
        <a :href="item.sourceHref"><span class="visually-hidden">Source: </span>{{ item.sourceLabel }}</a>
      </p>
      <p v-if="item.context" class="proof-context">{{ item.context }}</p>
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
    border-block: var(--border-width) solid rgb(4 51 79 / 24%);
    list-style: none;
  }

  .proof-strip > li {
    display: grid;
    align-content: start;
    gap: 0.625rem;
    min-width: 0;
    padding: 2.125rem 2rem;
  }

  .proof-strip > li + li {
    border-inline-start: var(--border-width) solid rgb(4 51 79 / 24%);
  }

  .proof-value,
  .proof-meta,
  .proof-context {
    margin: 0;
  }

  .proof-value {
    color: var(--color-brand-primary);
    font-family: var(--font-family-statement);
    font-size: clamp(1.875rem, 1.45rem + 1.2vw, 2.5rem);
    line-height: 1.1;
  }

  .proof-meta,
  .proof-meta a {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: 1.5;
  }

  .proof-meta a:hover,
  .proof-meta a:focus-visible {
    color: var(--color-brand-primary);
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
      padding: 1.375rem 0;
    }

    .proof-strip > li + li {
      border-block-start: var(--border-width) solid rgb(4 51 79 / 24%);
      border-inline-start: 0;
    }
  }
}
</style>
