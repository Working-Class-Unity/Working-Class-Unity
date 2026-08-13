<script setup lang="ts">
defineOptions({ inheritAttrs: false })
</script>

<template>
  <!-- eslint-disable-next-line vue/html-self-closing -->
  <input class="app-input" v-bind="$attrs" />
</template>

<style scoped>
@layer components {
  .app-input {
    min-width: 0;
  }
}
</style>
