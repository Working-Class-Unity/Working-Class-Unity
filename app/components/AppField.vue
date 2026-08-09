<script setup lang="ts">
import { computed, useId } from 'vue'

const props = withDefaults(
  defineProps<{
    label: string
    hint?: string
    error?: string
    required?: boolean
    requiredLabel?: string
    id?: string
  }>(),
  {
    hint: '',
    error: '',
    required: false,
    requiredLabel: '',
    id: undefined
  }
)

const generatedId = useId()
const controlId = computed(() => props.id || generatedId)
const hintId = computed(() => `${controlId.value}-hint`)
const errorId = computed(() => `${controlId.value}-error`)
const describedBy = computed(
  () => [props.hint ? hintId.value : '', props.error ? errorId.value : ''].filter(Boolean).join(' ') || undefined
)
</script>

<template>
  <div class="app-field">
    <label :for="controlId">
      {{ props.label }}
      <span v-if="props.required && props.requiredLabel" class="required-label" aria-hidden="true">
        ({{ props.requiredLabel }})
      </span>
    </label>
    <slot :id="controlId" :described-by="describedBy" :invalid="Boolean(props.error)" :required="props.required" />
    <small v-if="props.hint" :id="hintId" class="field-hint">{{ props.hint }}</small>
    <small v-if="props.error" :id="errorId" class="field-error">{{ props.error }}</small>
  </div>
</template>

<style scoped>
@layer components {
  .app-field {
    display: grid;
    gap: var(--space-1);
  }

  .app-field > label {
    color: var(--color-text);
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-bold);
  }

  .required-label,
  .field-hint {
    color: var(--color-text-muted);
    font-weight: normal;
  }

  .field-error {
    color: var(--color-status-error-text);
    font-weight: var(--font-weight-strong);
  }
}
</style>
