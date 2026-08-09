<script setup lang="ts">
const { t } = useI18n()
const { data: session, error: sessionError } = await useAppSession()

if (!sessionError.value && session.value?.user) {
  await navigateTo('/app', { redirectCode: 302 })
}

useHead(() => ({
  title: t('metadata.login.title')
}))
</script>

<template>
  <div class="auth-entry-page">
    <AuthEntryForm intent="login" :session-error="sessionError?.message" />
  </div>
</template>

<style scoped>
@layer components {
  .auth-entry-page {
    display: grid;
    place-items: start center;
    padding-bottom: var(--space-6);
  }
}
</style>
