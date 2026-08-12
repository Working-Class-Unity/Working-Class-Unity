<script setup lang="ts">
const { t } = useI18n()
const route = useRoute()
const homeContainerClass = computed(() => ({ 'container--home': route.path === '/' }))
</script>

<template>
  <div class="app-frame">
    <a class="skip-link" href="#main-content">{{ t('navigation.skipToMain') }}</a>
    <div class="container" :class="homeContainerClass"><AppTopbar /></div>
    <main id="main-content" class="container page-shell flow" :class="homeContainerClass" tabindex="-1">
      <slot />
    </main>
  </div>
</template>
