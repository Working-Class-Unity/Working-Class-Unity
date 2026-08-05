<script setup lang="ts">
type TestStatus = 'idle' | 'validating' | 'captured' | 'missing-token' | 'failed'

const { t } = useI18n()

const status = ref<TestStatus>('idle')
const detail = ref(t('observability.preparing'))

useHead(() => ({
  title: t('metadata.observability.title')
}))

onMounted(() => {
  void runClientTest()
})

async function runClientTest() {
  const token = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token') ?? ''

  if (!token) {
    status.value = 'missing-token'
    detail.value = t('observability.missingToken')
    return
  }

  status.value = 'validating'
  detail.value = t('observability.validating')

  try {
    await $fetch('/api/observability/client-test', {
      method: 'POST',
      headers: {
        'x-observability-test-token': token
      }
    })

    window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`)

    const Sentry = await import('@sentry/nuxt')
    const eventId = Sentry.captureException(new Error('Sentry client test error'), {
      tags: {
        component: 'observability',
        test: 'client'
      },
      extra: {
        route: '/observability-client-test'
      }
    })

    status.value = 'captured'
    detail.value = eventId ? t('observability.sentWithId', { eventId }) : t('observability.sent')
  } catch {
    status.value = 'failed'
    detail.value = t('observability.failed')
  }
}
</script>

<template>
  <AppPage class="observability-test-page">
    <section class="panel observability-test-panel" aria-labelledby="observability-test-title">
      <div class="panel-heading">
        <p class="eyebrow">{{ t('observability.eyebrow') }}</p>
        <h1 id="observability-test-title">{{ t('observability.title') }}</h1>
      </div>

      <p class="test-status" :data-status="status" :role="status === 'failed' ? 'alert' : 'status'">
        {{ detail }}
      </p>
    </section>
  </AppPage>
</template>

<style scoped>
@layer components {
  .observability-test-page {
    padding-top: var(--space-5);
  }

  .observability-test-panel {
    display: grid;
    gap: var(--space-4);
    padding: var(--space-5);
  }

  .observability-test-panel h1 {
    font-size: 2.4rem;
  }

  .test-status {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-2);
    padding: var(--space-4);
    margin: 0;
    background: var(--color-surface);
    font-weight: var(--font-weight-strong);
  }

  .test-status[data-status='captured'] {
    border-color: var(--color-status-success-text);
    color: var(--color-status-success-text);
    background: var(--color-status-success-surface);
  }

  .test-status[data-status='missing-token'] {
    border-color: var(--color-status-warning-text);
    color: var(--color-status-warning-text);
    background: var(--color-status-warning-surface);
  }

  .test-status[data-status='failed'] {
    border-color: var(--color-status-error-text);
    color: var(--color-status-error-text);
    background: var(--color-status-error-surface);
  }

  @media (width <= 620px) {
    .observability-test-panel {
      padding: var(--space-4);
    }

    .observability-test-panel h1 {
      font-size: 1.8rem;
    }
  }
}
</style>
