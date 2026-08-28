<script setup lang="ts">
import { isAllowedAuthReturnPath } from '#shared/auth-routes'
import { isPublicJoinCompletionCallback } from '#shared/join'

const { t } = useI18n()
const route = useRoute()
const { data: session, error: sessionError } = await useAppSession()
const returnTo = isAllowedAuthReturnPath(route.query.returnTo) ? route.query.returnTo : '/app'
const isJoinRecovery = isPublicJoinCompletionCallback(returnTo)

if (!sessionError.value && session.value?.user && !isJoinRecovery) {
  await navigateTo(returnTo, { redirectCode: 302 })
}

useHead(() => ({
  title: t('metadata.login.title')
}))
</script>

<template>
  <div class="auth-entry-page">
    <AuthEntryForm
      intent="login"
      :return-to="returnTo"
      :email-only="isJoinRecovery"
      :session-error="sessionError?.message"
    />
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
