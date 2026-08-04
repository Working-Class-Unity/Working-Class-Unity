<template>
  <main id="main-content" class="page-shell" tabindex="-1">
    <slot />
  </main>
</template>

<style scoped>
@layer components {
  .page-shell:focus-visible {
    outline: var(--focus-outline);
    outline-offset: var(--focus-offset);
  }
}
</style>
