<script setup lang="ts">
const { t } = useI18n()
const usesWideSurface = useWideSurfaceRoute()
const wideContainerClass = computed(() => ({ 'container--wide': usesWideSurface.value }))
</script>

<template>
  <div class="app-frame">
    <a class="skip-link" href="#main-content">{{ t('navigation.skipToMain') }}</a>
    <AppTopbar />
    <main id="main-content" class="container page-shell flow" :class="wideContainerClass" tabindex="-1">
      <slot />
    </main>
  </div>
</template>
