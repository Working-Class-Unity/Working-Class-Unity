<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    tone: 'loading' | 'empty' | 'error' | 'success'
    title: string
    description?: string
    actionLabel?: string
    busy?: boolean
  }>(),
  {
    description: '',
    actionLabel: '',
    busy: false
  }
)

const emit = defineEmits<{
  action: []
}>()

const { t } = useI18n()
</script>

<template>
  <section class="state-block" :data-tone="props.tone" :aria-live="props.tone === 'error' ? 'assertive' : 'polite'">
    <div class="state-copy">
      <strong>{{ props.title }}</strong>
      <p v-if="props.description">{{ props.description }}</p>
    </div>
    <button
      v-if="props.actionLabel"
      class="secondary-button"
      type="button"
      :disabled="props.busy"
      @click="emit('action')"
    >
      {{ props.busy ? t('common.working') : props.actionLabel }}
    </button>
  </section>
</template>

<style scoped>
@layer components {
  .state-block {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    border: var(--border-width) solid var(--color-border);
    border-inline-start-width: var(--border-width-accent);
    border-radius: var(--radius-2);
    padding: var(--space-3);
    background: var(--color-surface);
  }

  .state-block[data-tone='loading'] {
    border-inline-start-color: var(--color-action);
  }

  .state-block[data-tone='empty'] {
    border-inline-start-color: var(--color-text-muted);
  }

  .state-block[data-tone='error'] {
    border-inline-start-color: var(--color-status-error-text);
  }

  .state-block[data-tone='success'] {
    border-inline-start-color: var(--color-status-success-text);
  }

  .state-copy {
    min-width: 0;
  }

  .state-copy strong,
  .state-copy p {
    display: block;
  }

  .state-copy p {
    margin: 3px 0 0;
    color: var(--color-text-muted);
  }

  @media (width <= 620px) {
    .state-block {
      align-items: flex-start;
      flex-direction: column;
    }
  }
}
</style>
