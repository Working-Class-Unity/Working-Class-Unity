<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <div class="app-frame">
    <a class="skip-link" href="#main-content">{{ t('navigation.skipToMain') }}</a>
    <div class="container"><AppTopbar /></div>
    <main id="main-content" class="container page-shell flow" tabindex="-1">
      <slot />
    </main>
  </div>
</template>
