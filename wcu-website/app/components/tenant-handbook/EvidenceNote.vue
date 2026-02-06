<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    title: string
    tone?: 'info' | 'warning' | 'source'
  }>(),
  {
    tone: 'info',
  }
)

const toneClasses = computed(() => {
  if (props.tone === 'warning') {
    return {
      root: 'border-accent/45 bg-accent/10',
      chip: 'bg-accent/20 border-accent/55 text-base-content',
      role: 'alert',
    }
  }

  if (props.tone === 'source') {
    return {
      root: 'border-secondary/35 bg-secondary/10',
      chip: 'bg-secondary/15 border-secondary/45 text-secondary',
      role: 'note',
    }
  }

  return {
    root: 'border-primary/45 bg-primary/10',
    chip: 'bg-primary/20 border-primary/55 text-base-content',
    role: 'note',
  }
})
</script>

<template>
  <aside :class="['mt-4 rounded-lg border p-4', toneClasses.root]" :role="toneClasses.role" :aria-label="title">
    <p class="inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide" :class="toneClasses.chip">
      {{ title }}
    </p>
    <div class="mt-2 text-sm text-base-content/90">
      <slot />
    </div>
  </aside>
</template>
