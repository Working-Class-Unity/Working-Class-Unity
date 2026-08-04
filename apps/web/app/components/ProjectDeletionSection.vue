<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    projectName: string
    busy?: boolean
    error?: string
  }>(),
  {
    busy: false,
    error: ''
  }
)

const emit = defineEmits<{
  delete: []
}>()

const { t } = useI18n()
const confirming = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)

watch(
  () => props.error,
  async (error) => {
    if (!error) return
    await nextTick()
    document.getElementById('project-delete-status')?.focus()
  }
)

async function reveal() {
  confirming.value = true
  await nextTick()
  document.getElementById('project-delete-confirmation')?.focus()
}

async function cancel() {
  if (props.busy) return
  confirming.value = false
  await nextTick()
  trigger.value?.focus()
}
</script>

<template>
  <section class="project-deletion" aria-labelledby="delete-project-title">
    <div>
      <h2 id="delete-project-title">{{ t('projects.deletion.title') }}</h2>
      <p>{{ t('projects.deletion.description') }}</p>
    </div>

    <button v-if="!confirming" ref="trigger" class="secondary-button destructive-button" type="button" @click="reveal">
      {{ t('projects.deletion.title') }}
    </button>

    <div v-else class="delete-confirmation">
      <i18n-t id="project-delete-confirmation" keypath="projects.deletion.confirmation" tag="p" tabindex="-1">
        <template #project>
          <strong>{{ props.projectName }}</strong>
        </template>
      </i18n-t>
      <AppStatusMessage v-if="props.error" id="project-delete-status" tabindex="-1" tone="error">
        {{ props.error }}
      </AppStatusMessage>
      <div class="delete-actions">
        <button
          class="primary-button destructive-primary-button"
          type="button"
          :disabled="props.busy"
          @click="emit('delete')"
        >
          {{ props.busy ? t('projects.deletion.deleting') : t('projects.deletion.submit') }}
        </button>
        <button class="secondary-button" type="button" :disabled="props.busy" @click="cancel">
          {{ t('common.cancel') }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
@layer components {
  .project-deletion,
  .delete-confirmation {
    display: grid;
    min-width: 0;
    gap: var(--space-4);
  }

  .project-deletion h2,
  .project-deletion p {
    margin: 0;
  }

  .project-deletion > div:first-child p {
    margin-top: var(--space-1);
    color: var(--color-text-muted);
  }

  .project-deletion > .secondary-button {
    width: fit-content;
  }

  .destructive-button {
    border-color: var(--color-status-error-text);
    color: var(--color-status-error-text);
  }

  .delete-confirmation {
    border: var(--border-width) solid var(--color-status-error-text);
    border-radius: var(--radius-2);
    padding: var(--space-4);
    background: var(--color-status-error-surface);
  }

  .delete-confirmation strong {
    overflow-wrap: anywhere;
  }

  .delete-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .destructive-primary-button {
    border-color: var(--color-status-error-text);
    background: var(--color-status-error-text);
  }

  @media (width <= 520px) {
    .project-deletion > .secondary-button,
    .delete-actions > * {
      width: 100%;
    }
  }
}
</style>
