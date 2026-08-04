<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <div class="app-frame">
    <a class="skip-link" href="#main-content">{{ t('navigation.skipToMain') }}</a>
    <AppTopbar />
    <slot />
  </div>
</template>
