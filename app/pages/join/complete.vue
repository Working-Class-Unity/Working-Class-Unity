<script setup lang="ts">
const route = useRoute()
const state = ref<'pending' | 'sent' | 'error'>('pending')

useHead({ title: 'Check your email' })

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
    <h1 id="join-complete-title">Check your email</h1>
    <AppNotice v-if="state === 'pending'" tone="info">Validating your Stripe enrollment…</AppNotice>
    <AppNotice v-else-if="state === 'sent'" tone="success" announce="polite">
      We sent an account link to the email used in Stripe Checkout. Use it within five minutes to finish.
    </AppNotice>
    <AppNotice v-else tone="error" announce="assertive">
      We could not validate this Checkout. <NuxtLink to="/join">Return to Join</NuxtLink>.
    </AppNotice>
  </section>
</template>
