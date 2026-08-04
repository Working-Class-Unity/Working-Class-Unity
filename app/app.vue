<script setup lang="ts">
const config = useRuntimeConfig()
const { t } = useI18n()

useHead(() => ({
  title: config.public.appName,
  meta: [{ name: 'description', content: t('metadata.defaultDescription') }]
}))
</script>

<template>
  <NuxtRouteAnnouncer />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
