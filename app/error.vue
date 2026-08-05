<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{
  error: NuxtError
}>()
const config = useRuntimeConfig()
const { t } = useI18n()

const errorKind = computed(() => (props.error.statusCode === 404 ? 'notFound' : 'unexpected'))
const heading = computed(() => t(`errors.${errorKind.value}.heading`))
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
      <p class="eyebrow">{{ t('errors.status', { statusCode: props.error.statusCode }) }}</p>
      <h1 id="error-title">{{ heading }}</h1>
      <p class="error-description">{{ t(`errors.${errorKind}.description`) }}</p>
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

  .error-description {
    margin-bottom: 0;
    color: var(--color-text-muted);
  }

  .error-home-link {
    display: inline-flex;
    width: fit-content;
    align-items: center;
  }
}
</style>
