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
    <section class="error-panel" aria-labelledby="error-title">
      <p class="eyebrow">{{ t('errors.status', { statusCode: props.error.statusCode }) }}</p>
      <h1 id="error-title">{{ heading }}</h1>
      <p class="error-description">{{ t(`errors.${errorKind}.description`) }}</p>
      <AppNotice v-if="recoveryError" tone="error" announce="assertive">{{ recoveryError }}</AppNotice>
      <AppButton class="error-home-link" variant="secondary" :pending="isRecovering" @click="recover">
        {{ isRecovering ? t('errors.returningHome') : t('errors.returnHome') }}
      </AppButton>
    </section>
  </main>
</template>

<style scoped>
@layer components {
  .error-page {
    display: grid;
    min-height: 100vh;
    place-items: center;
    padding: var(--space-6) 0;
  }

  .error-panel {
    display: grid;
    width: min(100%, 680px);
    gap: var(--space-4);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-2);
    padding: var(--space-6);
    background: var(--color-surface-subtle);
    box-shadow: var(--shadow-panel);
  }

  .eyebrow {
    margin: 0;
    color: var(--color-action);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-heavy);
    text-transform: uppercase;
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
