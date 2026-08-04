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
  <AppPage class="auth-entry-page">
    <AuthEntryForm intent="login" :session-error="sessionError?.message" />
  </AppPage>
</template>

<style scoped>
@layer components {
  .auth-entry-page {
    place-items: start center;
    padding-bottom: var(--space-6);
  }
}
</style>
