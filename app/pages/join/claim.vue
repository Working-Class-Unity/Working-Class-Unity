<script setup lang="ts">
import { isPublicJoinAttemptId, isPublicJoinClaimToken, publicJoinCompletionCallback } from '#shared/join'

const route = useRoute()
const { t } = useI18n()
const rawAttemptId = Array.isArray(route.query.id) ? route.query.id[0] : route.query.id
const rawToken = Array.isArray(route.query.token) ? route.query.token[0] : route.query.token
const attemptId = isPublicJoinAttemptId(rawAttemptId) ? rawAttemptId : null
const token = isPublicJoinClaimToken(rawToken) ? rawToken : null
const responseCacheControl = useResponseHeader('cache-control')
const referrerPolicy = useResponseHeader('referrer-policy')
responseCacheControl.value = 'private, no-store'
referrerPolicy.value = 'no-referrer'

useHead(() => ({
  title: t('join.claim.pageTitle'),
  meta: [{ name: 'referrer', content: 'no-referrer' }]
}))

onMounted(async () => {
  if (!attemptId || !token) {
    await navigateTo('/join/complete?status=link-error', { replace: true })
    return
  }
  const completion = publicJoinCompletionCallback(attemptId)
  window.history.replaceState({}, '', completion)
  try {
    await $fetch('/api/join/claim', {
      method: 'POST',
      body: { attemptId, token }
    })
    await navigateTo(completion, { replace: true })
  } catch {
    await navigateTo(`${completion}&status=link-error`, { replace: true })
  }
})
</script>

<template>
  <section class="claim-panel" aria-labelledby="claim-title">
    <h1 id="claim-title">{{ t('join.claim.title') }}</h1>
    <p>{{ t('join.claim.description') }}</p>
  </section>
</template>

<style scoped>
@layer components {
  .claim-panel {
    display: grid;
    gap: var(--space-3);
    justify-items: center;
    max-inline-size: 40rem;
    margin-inline: auto;
    padding: var(--space-7) var(--space-4);
    text-align: center;
  }

  .claim-panel h1,
  .claim-panel p {
    margin: 0;
  }

  .claim-panel h1 {
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
  }

  .claim-panel p {
    color: var(--color-text-muted);
  }
}
</style>
