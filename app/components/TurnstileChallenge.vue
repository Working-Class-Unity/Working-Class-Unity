<script setup lang="ts">
import { turnstileTokenSchema, type TurnstileAction } from '#shared/turnstile'

type ChallengeState = 'loading' | 'verified' | 'failure'

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string
      action: TurnstileAction
      callback: (token: string) => void
      'error-callback': () => true
      'expired-callback': () => void
      'timeout-callback': () => void
      'unsupported-callback': () => void
      retry: 'never'
      'refresh-expired': 'auto'
      'refresh-timeout': 'auto'
      'response-field': false
      'feedback-enabled': false
      size: 'compact'
    }
  ) => string
  reset: (widgetId?: string) => void
  remove: (widgetId?: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
    __swlTurnstileScriptPromise?: Promise<void>
  }
}

const props = defineProps<{
  action: TurnstileAction
  modelValue?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [token: string]
}>()
const config = useRuntimeConfig()
const { t } = useI18n()
const siteKey = computed(() => config.public.turnstileSiteKey)
const container = ref<HTMLElement | null>(null)
const challengeState = ref<ChallengeState>('loading')
const statusMessage = computed(() => {
  if (challengeState.value === 'verified') return t('security.check.complete')
  if (challengeState.value === 'failure') return t('security.check.failure')
  return t('security.check.progress')
})
let widgetId: string | undefined
let unmounted = false

onMounted(prepareWidget)

onBeforeUnmount(() => {
  unmounted = true

  if (widgetId !== undefined && window.turnstile) {
    window.turnstile.remove(widgetId)
    widgetId = undefined
  }
})

async function prepareWidget() {
  setLoading()

  if (!siteKey.value) {
    setFailure()
    return
  }

  try {
    await loadTurnstileScript()
    if (!unmounted) renderWidget()
  } catch {
    if (!unmounted) setFailure()
  }
}

function renderWidget() {
  if (!container.value || !window.turnstile || widgetId !== undefined) return

  widgetId = window.turnstile.render(container.value, {
    sitekey: siteKey.value,
    action: props.action,
    callback: acceptToken,
    'error-callback': handleError,
    'expired-callback': setFailure,
    'timeout-callback': setFailure,
    'unsupported-callback': setFailure,
    retry: 'never',
    'refresh-expired': 'auto',
    'refresh-timeout': 'auto',
    'response-field': false,
    'feedback-enabled': false,
    size: 'compact'
  })
}

function acceptToken(token: string) {
  const result = turnstileTokenSchema.safeParse(token)
  if (!result.success) {
    setFailure()
    return
  }

  challengeState.value = 'verified'
  emit('update:modelValue', result.data)
}

function setLoading() {
  challengeState.value = 'loading'
  emit('update:modelValue', '')
}

function setFailure() {
  challengeState.value = 'failure'
  emit('update:modelValue', '')
}

function handleError(): true {
  setFailure()
  return true
}

function reset() {
  setLoading()

  if (widgetId !== undefined && window.turnstile) {
    window.turnstile.reset(widgetId)
  }
}

async function retry() {
  setLoading()

  if (widgetId !== undefined && window.turnstile) {
    window.turnstile.reset(widgetId)
    return
  }

  await prepareWidget()
}

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve()
  if (window.__swlTurnstileScriptPromise) return window.__swlTurnstileScriptPromise

  const script = document.createElement('script')
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
  script.async = true
  script.defer = true

  const loader = new Promise<void>((resolve, reject) => {
    script.onload = () => (window.turnstile ? resolve() : reject(new Error('Turnstile unavailable')))
    script.onerror = () => reject(new Error('Turnstile unavailable'))
    document.head.appendChild(script)
  })
  const retryableLoader = loader.catch((error: unknown) => {
    script.remove()
    if (window.__swlTurnstileScriptPromise === retryableLoader) {
      window.__swlTurnstileScriptPromise = undefined
    }
    throw error
  })

  window.__swlTurnstileScriptPromise = retryableLoader
  return retryableLoader
}

defineExpose({ reset })
</script>

<template>
  <div class="turnstile-challenge" :aria-label="t('security.check.label')">
    <div ref="container" class="turnstile-widget" />
    <p class="turnstile-status" :data-state="challengeState" :role="challengeState === 'failure' ? 'alert' : 'status'">
      {{ statusMessage }}
    </p>
    <AppButton v-if="challengeState === 'failure'" class="turnstile-retry" variant="secondary" @click="retry">
      {{ t('security.check.retry') }}
    </AppButton>
  </div>
</template>

<style scoped>
@layer components {
  .turnstile-challenge {
    display: grid;
    gap: var(--space-2);
  }

  .turnstile-widget {
    min-height: 140px;
  }

  .turnstile-status {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 0.9rem;
  }

  .turnstile-status[data-state='verified'] {
    color: var(--color-status-success-text);
  }

  .turnstile-status[data-state='failure'] {
    color: var(--color-status-error-text);
  }

  .turnstile-retry {
    width: fit-content;
  }
}
</style>
