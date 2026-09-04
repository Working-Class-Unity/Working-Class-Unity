<script setup lang="ts">
withDefaults(
  defineProps<{
    items: readonly Readonly<{
      id: string
      label: string
    }>[]
    label: string
    showMarkers?: boolean
  }>(),
  {
    showMarkers: false
  }
)
const { t } = useI18n()
</script>

<template>
  <PageOutline
    class="campaign-page-outline"
    :items="items"
    :label="label"
    :title="t('removeFlock.outline.title')"
    :description="t('removeFlock.outline.description')"
    :trigger-label="t('removeFlock.outline.trigger')"
    :close-label="t('removeFlock.outline.close')"
    trigger-variant="primary"
    :show-markers="showMarkers"
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
