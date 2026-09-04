<script setup lang="ts">
type TestStatus = 'idle' | 'validating' | 'captured' | 'missing-token' | 'failed'

const { t } = useI18n()

const status = ref<TestStatus>('idle')
const detailKey = ref('observability.preparing')
const detailParameters = ref<Record<string, string>>({})
const noticeTone = computed(() => {
  if (status.value === 'captured') return 'success'
  if (status.value === 'missing-token') return 'warning'
  if (status.value === 'failed') return 'error'
  return 'info'
})
const noticeAnnouncement = computed(() => {
  if (status.value === 'idle') return undefined
  return status.value === 'failed' ? 'assertive' : 'polite'
})

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
    detailKey.value = 'observability.missingToken'
    return
  }

  status.value = 'validating'
  detailKey.value = 'observability.validating'

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
    detailKey.value = eventId ? 'observability.sentWithId' : 'observability.sent'
    detailParameters.value = eventId ? { eventId } : {}
  } catch {
    status.value = 'failed'
    detailKey.value = 'observability.failed'
  }
}
</script>

<template>
  <div class="observability-test-page">
    <section class="observability-test-panel" aria-labelledby="observability-test-title">
      <div class="panel-heading">
        <p class="eyebrow">{{ t('observability.eyebrow') }}</p>
        <h1 id="observability-test-title">{{ t('observability.title') }}</h1>
      </div>

      <AppNotice :tone="noticeTone" :announce="noticeAnnouncement">
        {{ t(detailKey, detailParameters) }}
      </AppNotice>
    </section>
  </div>
</template>

<style scoped>
@layer components {
  .observability-test-page {
    padding-top: var(--space-5);
  }

  .observability-test-panel {
    display: grid;
    gap: var(--space-4);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-2);
    padding: var(--space-5);
    background: var(--color-surface-subtle);
    box-shadow: var(--shadow-panel);
  }

  .panel-heading {
    display: grid;
    gap: var(--space-1);
    margin-block-end: var(--space-4);
  }

  .eyebrow {
    margin: 0;
    color: var(--color-action);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-heavy);
    text-transform: uppercase;
  }

  .observability-test-panel h1 {
    font-size: 2.4rem;
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
