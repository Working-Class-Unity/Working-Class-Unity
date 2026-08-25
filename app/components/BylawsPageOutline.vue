<script setup lang="ts">
defineProps<{
  items: readonly Readonly<{
    id: string
    label: string
    children: readonly Readonly<{
      id: string
      label: string
      marker: string
    }>[]
  }>[]
  label: string
  title: string
  description: string
  triggerLabel: string
  closeLabel: string
}>()
</script>

<template>
  <PageOutline
    :items="items"
    :label="label"
    :title="title"
    :description="description"
    :trigger-label="triggerLabel"
    :close-label="closeLabel"
  />
</template>
