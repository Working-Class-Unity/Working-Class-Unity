<script setup lang="ts">
import { PROJECT_NAME_MAX_LENGTH } from '#shared/projects'

const props = withDefaults(
  defineProps<{
    inputId: string
    label: string
    modelValue: string
    submitLabel: string
    pendingLabel: string
    busy?: boolean
    error?: string
  }>(),
  {
    busy: false,
    error: ''
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
}>()

const input = ref<HTMLInputElement | null>(null)
const errorId = computed(() => `${props.inputId}-error`)

defineExpose({
  focus() {
    input.value?.focus()
  }
})
</script>

<template>
  <form class="project-name-form" novalidate @submit.prevent="emit('submit')">
    <div class="form-field">
      <label :for="props.inputId">{{ props.label }}</label>
      <input
        :id="props.inputId"
        ref="input"
        :value="props.modelValue"
        type="text"
        autocomplete="off"
        required
        :maxlength="PROJECT_NAME_MAX_LENGTH"
        :aria-invalid="Boolean(props.error)"
        :aria-describedby="props.error ? errorId : undefined"
        :disabled="props.busy"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
      <p v-if="props.error" :id="errorId" class="field-error">{{ props.error }}</p>
    </div>
    <button class="primary-button" type="submit" :disabled="props.busy">
      {{ props.busy ? props.pendingLabel : props.submitLabel }}
    </button>
  </form>
</template>

<style scoped>
@layer components {
  .project-name-form {
    display: grid;
    gap: var(--space-3);
  }

  .project-name-form .primary-button {
    width: fit-content;
  }

  .field-error {
    margin: 0;
  }

  @media (width <= 520px) {
    .project-name-form .primary-button {
      width: 100%;
    }
  }
}
</style>
