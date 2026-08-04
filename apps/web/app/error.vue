<script setup lang="ts">
import type { NuxtError } from '#app'
import { resolvePublicErrorPresentation } from '#shared/error-presentation'
import { moduleDisabledCode } from '#shared/module-states'

const props = defineProps<{
  error: NuxtError
}>()
const config = useRuntimeConfig()
const { t } = useI18n()

const presentation = computed(() => resolvePublicErrorPresentation(props.error))
const heading = computed(() => t(`errors.${presentation.value.kind}.heading`))
const isRecovering = ref(false)
const recoveryError = ref('')

useHead(() => ({
  title: t('metadata.errorTitle', { heading: heading.value, appName: config.public.appName })
}))

async function recover() {
  if (isRecovering.value) return

  isRecovering.value = true
  recoveryError.value = ''

  try {
    await clearError({ redirect: '/' })
  } catch {
    recoveryError.value = t('errors.recoveryFailed')
  } finally {
    isRecovering.value = false
  }
}
</script>

<template>
  <main id="main-content" class="page-shell error-page" tabindex="-1">
    <section class="panel error-panel" aria-labelledby="error-title">
      <p class="eyebrow">{{ t('errors.status', { statusCode: presentation.statusCode }) }}</p>
      <h1 id="error-title">{{ heading }}</h1>
      <p class="error-description">{{ t(`errors.${presentation.kind}.description`) }}</p>
      <i18n-t v-if="presentation.showModuleCode" keypath="errors.code" tag="p" class="error-code">
        <template #code>
          <code>{{ moduleDisabledCode }}</code>
        </template>
      </i18n-t>
      <AppStatusMessage v-if="recoveryError" tone="error">{{ recoveryError }}</AppStatusMessage>
      <button class="secondary-button error-home-link" type="button" :disabled="isRecovering" @click="recover">
        {{ isRecovering ? t('errors.returningHome') : t('errors.returnHome') }}
      </button>
    </section>
  </main>
</template>

<style scoped>
@layer components {
  .error-page {
    min-height: 100vh;
    place-items: center;
    padding: var(--space-6) 0;
  }

  .error-panel {
    display: grid;
    width: min(100%, 680px);
    gap: var(--space-4);
    padding: var(--space-6);
  }

  .error-description,
  .error-code {
    margin-bottom: 0;
    color: var(--color-text-muted);
  }

  .error-code code {
    color: var(--color-text);
    font-weight: var(--font-weight-bold);
  }

  .error-home-link {
    display: inline-flex;
    width: fit-content;
    align-items: center;
  }
}
</style>
