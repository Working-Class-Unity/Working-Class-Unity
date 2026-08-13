<script setup lang="ts">
import { ref } from 'vue'

defineOptions({ inheritAttrs: false })

const model = defineModel<string | number | boolean | null>()
const inputElement = ref<HTMLInputElement | null>(null)

defineExpose({
  focus: () => inputElement.value?.focus(),
  isValid: () => inputElement.value?.validity.valid ?? false
})
</script>

<template>
  <!-- eslint-disable-next-line vue/html-self-closing -->
  <input ref="inputElement" v-model="model" class="app-input" v-bind="$attrs" />
</template>

<style scoped>
@layer components {
  .app-input {
    min-width: 0;
  }
}
</style>
