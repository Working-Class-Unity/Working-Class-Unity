<script setup lang="ts">
const { t } = useI18n()
useHead(() => ({ title: t('metadata.activate.title') }))
</script>

<template>
  <div class="auth-entry-page">
    <AuthEntryForm intent="activate" />
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
