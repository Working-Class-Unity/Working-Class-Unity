<script setup lang="ts">
const route = useRoute()
const { t } = useI18n()
const state = ref<'pending' | 'sent' | 'error'>('pending')

useHead(() => ({ title: t('join.complete.title') }))

onMounted(async () => {
  const sessionId = typeof route.query.session_id === 'string' ? route.query.session_id : ''
  try {
    await $fetch('/api/join/complete', { method: 'POST', body: { sessionId } })
    state.value = 'sent'
  } catch {
    state.value = 'error'
  }
})
</script>

<template>
  <section class="flow" aria-labelledby="join-complete-title">
    <h1 id="join-complete-title">{{ t('join.complete.title') }}</h1>
    <AppNotice v-if="state === 'pending'" tone="info">{{ t('join.complete.pending') }}</AppNotice>
    <AppNotice v-else-if="state === 'sent'" tone="success" announce="polite">
      {{ t('join.complete.sent') }}
    </AppNotice>
    <AppNotice v-else tone="error" announce="assertive">
      {{ t('join.complete.error') }} <NuxtLink to="/join">{{ t('join.complete.return') }}</NuxtLink
      >.
    </AppNotice>
  </section>
</template>
