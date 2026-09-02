<script setup lang="ts">
type DocumentaryRatio = '16:9' | '4:3' | '3:2' | '3:4' | '9:16'

const props = withDefaults(
  defineProps<{
    src?: string
    alt?: string
    ratio?: DocumentaryRatio
    caption?: string
    context?: string
    sourceLabel?: string
    sourceHref?: string
    currentThrough?: string
    loading?: 'eager' | 'lazy'
    placeholderLabel?: string
  }>(),
  {
    src: undefined,
    alt: undefined,
    ratio: '4:3',
    caption: undefined,
    context: undefined,
    sourceLabel: undefined,
    sourceHref: undefined,
    currentThrough: undefined,
    loading: 'lazy',
    placeholderLabel: 'Documentary image pending final approval.'
  }
)

if (props.src && props.alt === undefined) {
  throw new Error('DocumentaryFigure requires alt text or an explicit empty alt when src is provided.')
}
</script>

<template>
  <figure class="documentary-figure" :data-ratio="props.ratio">
    <div class="documentary-media">
      <!-- eslint-disable-next-line vue/html-self-closing -->
      <img v-if="props.src" :src="props.src" :alt="props.alt" :loading="props.loading" />
      <div v-else class="documentary-placeholder" aria-hidden="true">
        <span>{{ props.placeholderLabel }}</span>
      </div>
    </div>
    <figcaption>
      <p>{{ props.caption || props.placeholderLabel }}</p>
      <p v-if="props.context" class="documentary-context">{{ props.context }}</p>
      <EvidenceMetaLine
        :current-through="props.currentThrough"
        :source-href="props.sourceHref"
        :source-label="props.sourceLabel"
      />
    </figcaption>
  </figure>
</template>

<style scoped>
@layer components {
  .documentary-figure {
    margin: 0;
  }

  .documentary-media {
    overflow: hidden;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-1);
    background: var(--color-placeholder);
  }

  .documentary-figure[data-ratio='16:9'] .documentary-media {
    aspect-ratio: 16 / 9;
  }

  .documentary-figure[data-ratio='4:3'] .documentary-media {
    aspect-ratio: 4 / 3;
  }

  .documentary-figure[data-ratio='3:2'] .documentary-media {
    aspect-ratio: 3 / 2;
  }

  .documentary-figure[data-ratio='3:4'] .documentary-media {
    aspect-ratio: 3 / 4;
  }

  .documentary-figure[data-ratio='9:16'] .documentary-media {
    aspect-ratio: 9 / 16;
  }

  .documentary-media img,
  .documentary-placeholder {
    inline-size: 100%;
    block-size: 100%;
  }

  .documentary-media img {
    object-fit: cover;
  }

  .documentary-placeholder {
    display: grid;
    place-items: center;
    padding: var(--space-5);
    color: var(--color-text-muted);
    background: var(--color-placeholder);
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-strong);
    text-align: center;
  }

  .documentary-figure figcaption {
    display: grid;
    gap: var(--space-2);
    padding-block-start: var(--space-3);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
  }

  .documentary-figure figcaption p {
    margin: 0;
  }

  .documentary-context {
    max-inline-size: 60ch;
  }
}
</style>
