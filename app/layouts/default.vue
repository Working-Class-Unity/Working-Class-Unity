<script setup lang="ts">
import { unlocalizedPublicPath } from '#shared/public-site'

const { t } = useI18n()
const route = useRoute()
const usesWideSurface = useWideSurfaceRoute()
const wideContainerClass = computed(() => ({
  'container--wide': usesWideSurface.value,
  'page-shell--campaign-overview': unlocalizedPublicPath(route.path) === '/campaigns/remove-flock-stockton'
}))
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

<style scoped>
@layer components {
  .page-shell--campaign-overview {
    inline-size: 100%;
  }
}
</style>
