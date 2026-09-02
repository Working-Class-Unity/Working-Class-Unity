<script setup lang="ts">
type DocumentaryRatio = '16:9' | '4:3' | '3:2' | '3:4' | '9:16'
type DocumentaryVariant = 'standard' | 'assembly-home'

const props = withDefaults(
  defineProps<{
    src?: string
    alt?: string
    ratio?: DocumentaryRatio
    variant?: DocumentaryVariant
    caption?: string
    context?: string
    sourceLabel?: string
    sourceHref?: string
    currentThrough?: string
    loading?: 'eager' | 'lazy'
    placeholderLabel?: string
    mobilePlaceholderLabel?: string
    endLabel?: string
  }>(),
  {
    src: undefined,
    alt: undefined,
    ratio: '4:3',
    variant: 'standard',
    caption: undefined,
    context: undefined,
    sourceLabel: undefined,
    sourceHref: undefined,
    currentThrough: undefined,
    loading: 'lazy',
    placeholderLabel: 'Documentary image pending final approval.',
    mobilePlaceholderLabel: undefined,
    endLabel: undefined
  }
)

if (props.src && props.alt === undefined) {
  throw new Error('DocumentaryFigure requires alt text or an explicit empty alt when src is provided.')
}
</script>

<template>
  <figure class="documentary-figure" :data-ratio="props.ratio" :data-variant="props.variant">
    <div class="documentary-media">
      <!-- eslint-disable-next-line vue/html-self-closing -->
      <img v-if="props.src" :src="props.src" :alt="props.alt" :loading="props.loading" />
      <div v-else class="documentary-placeholder" aria-hidden="true">
        <span class="documentary-placeholder-default">{{ props.placeholderLabel }}</span>
        <span v-if="props.mobilePlaceholderLabel" class="documentary-placeholder-mobile">
          {{ props.mobilePlaceholderLabel }}
        </span>
      </div>
    </div>
    <figcaption>
      <p>{{ props.caption || props.placeholderLabel }}</p>
      <p v-if="props.endLabel" class="documentary-end-label">{{ props.endLabel }}</p>
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

  .documentary-placeholder-mobile {
    display: none;
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

  .documentary-end-label {
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .documentary-figure[data-variant='assembly-home'] {
    position: relative;
    block-size: 31.25rem;
    overflow: visible;
    background: var(--color-canvas);
  }

  .documentary-figure[data-variant='assembly-home']::before {
    position: absolute;
    z-index: 0;
    inset-block-start: 6rem;
    inset-inline-start: -6rem;
    inline-size: 11.5rem;
    block-size: 18.25rem;
    background: var(--color-brand-highlight);
    content: '';
  }

  .documentary-figure[data-variant='assembly-home'] .documentary-media {
    position: absolute;
    z-index: 1;
    inset-block-start: 0;
    inset-inline-start: 4.5rem;
    inline-size: calc(100% - 4.5rem);
    block-size: 28.5rem;
    border: 0;
    border-radius: 0;
  }

  .documentary-figure[data-variant='assembly-home'] .documentary-placeholder {
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .documentary-figure[data-variant='assembly-home'] figcaption {
    position: absolute;
    z-index: 2;
    inset-block-end: 0;
    inset-inline-start: 4.5rem;
    inline-size: calc(100% - 4.5rem);
    block-size: 2.75rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: 0 var(--space-4);
    color: var(--color-surface);
    background: var(--color-brand-highlight);
    line-height: 1.4;
  }

  @media (width <= 64rem) {
    .documentary-figure[data-variant='assembly-home'] {
      block-size: 19rem;
    }

    .documentary-figure[data-variant='assembly-home']::before {
      inset-block-start: 3.375rem;
      inset-inline-start: -1.5rem;
      inline-size: 4.625rem;
      block-size: 11.5rem;
    }

    .documentary-figure[data-variant='assembly-home'] .documentary-media {
      inset-inline-start: 1.375rem;
      inline-size: calc(100% - 1.375rem);
      block-size: 16.75rem;
    }

    .documentary-figure[data-variant='assembly-home'] figcaption {
      inset-inline-start: 1.375rem;
      inline-size: calc(100% - 1.375rem);
      block-size: 2.25rem;
      padding-inline: 0.625rem;
      background: var(--color-brand-primary);
      font-size: 0.6875rem;
    }

    .documentary-figure[data-variant='assembly-home'] .documentary-end-label {
      display: none;
    }

    .documentary-figure[data-variant='assembly-home']
      .documentary-placeholder-default:has(+ .documentary-placeholder-mobile) {
      display: none;
    }

    .documentary-figure[data-variant='assembly-home'] .documentary-placeholder-mobile {
      display: inline;
    }
  }
}
</style>
