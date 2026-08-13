<script setup lang="ts">
defineProps<{
  items: readonly Readonly<{
    id: string
    label: string
  }>[]
  label: string
}>()
</script>

<template>
  <PageOutline
    class="campaign-page-outline"
    :items="items"
    :label="label"
    title="On this page"
    description="Jump to a section of this page."
    trigger-label="On this page"
    close-label="Close page outline"
    trigger-variant="primary"
    show-trigger-indicator
  />
</template>

<style scoped>
@layer components {
  .campaign-page-outline {
    position: sticky;
    inset-block-start: var(--space-5);
    padding-block: clamp(4rem, 8vw, 7rem);
  }

  @media (width <= 56rem) {
    .campaign-page-outline {
      position: static;
      padding: 0;
    }
  }
}
</style>
