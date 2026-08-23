<script setup lang="ts">
import type { BylawsBlock } from '~/content/bylaws'

defineProps<{
  blocks: readonly BylawsBlock[]
}>()
</script>

<template>
  <div class="bylaws-content-blocks">
    <template v-for="(block, blockIndex) in blocks" :key="blockIndex">
      <p v-if="block.kind === 'paragraph'">
        <template v-for="(part, partIndex) in block.parts" :key="partIndex">
          <strong v-if="part.kind === 'strong'">{{ part.text }}</strong>
          <a v-else-if="part.kind === 'link'" :href="part.href">{{ part.text }}</a>
          <template v-else>{{ part.text }}</template>
        </template>
      </p>

      <ol v-else-if="block.kind === 'ordered-list'" role="list">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
          <template v-for="(part, partIndex) in item" :key="partIndex">
            <strong v-if="part.kind === 'strong'">{{ part.text }}</strong>
            <a v-else-if="part.kind === 'link'" :href="part.href">{{ part.text }}</a>
            <template v-else>{{ part.text }}</template>
          </template>
        </li>
      </ol>

      <ul v-else role="list">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
          <template v-for="(part, partIndex) in item" :key="partIndex">
            <strong v-if="part.kind === 'strong'">{{ part.text }}</strong>
            <a v-else-if="part.kind === 'link'" :href="part.href">{{ part.text }}</a>
            <template v-else>{{ part.text }}</template>
          </template>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
@layer components {
  .bylaws-content-blocks {
    display: grid;
    gap: var(--space-4);
    color: var(--color-text);
    font-size: 1.0625rem;
    line-height: 1.8;
  }

  .bylaws-content-blocks p,
  .bylaws-content-blocks ol,
  .bylaws-content-blocks ul {
    margin: 0;
  }

  .bylaws-content-blocks p {
    text-wrap: pretty;
  }

  .bylaws-content-blocks ol,
  .bylaws-content-blocks ul {
    display: grid;
    gap: var(--space-2);
    padding-inline-start: 1.6rem;
  }

  .bylaws-content-blocks ol {
    list-style: decimal;
  }

  .bylaws-content-blocks ul {
    list-style: disc;
  }

  .bylaws-content-blocks li {
    padding-inline-start: var(--space-2);
    text-wrap: pretty;
  }

  .bylaws-content-blocks strong {
    color: var(--color-brand-primary);
    font-weight: var(--font-weight-strong);
  }

  .bylaws-content-blocks a {
    font-weight: var(--font-weight-strong);
  }

  .bylaws-content-blocks a:hover,
  .bylaws-content-blocks a:focus-visible {
    color: var(--color-accent-action);
  }
}
</style>
