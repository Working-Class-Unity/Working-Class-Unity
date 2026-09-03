<script setup lang="ts">
import { motion, useDomRef, useMotionValue, useReducedMotion } from 'motion-v'
import heroAssets from '~/generated/hero-assets.json'

type CarouselVariant = 'home' | 'about'

type ImageVariant = Readonly<{
  src: string
  width: number
  height: number
}>

type DocumentaryPhoto = Readonly<{
  id: string
  width: number
  height: number
  variants: Readonly<{
    avif: readonly ImageVariant[]
    webp: readonly ImageVariant[]
  }>
}>

const props = withDefaults(
  defineProps<{
    variant?: CarouselVariant
    maxPhotos?: number
    caption?: string
  }>(),
  {
    variant: 'about',
    maxPhotos: undefined,
    caption: undefined
  }
)

const { t } = useI18n()
const prefersReducedMotion = useReducedMotion()
const viewportRef = useDomRef()
const trackRef = useDomRef()
const trackX = useMotionValue(0)
const availablePhotos = heroAssets.photos as readonly DocumentaryPhoto[]
const photoOrder = useState<readonly string[]>('documentary-photo-order', () => shuffledIds(availablePhotos))
const photosById = new Map(availablePhotos.map((photo) => [photo.id, photo]))
const photos = computed(() => {
  const ordered = photoOrder.value
    .map((photoId) => photosById.get(photoId))
    .filter((photo): photo is DocumentaryPhoto => Boolean(photo))
  return props.maxPhotos === undefined ? ordered : ordered.slice(0, props.maxPhotos)
})
const minimumX = ref(0)
const dragConstraints = computed(() => ({ left: minimumX.value, right: 0 }))

if (availablePhotos.length === 0) throw new Error('DocumentaryCarousel requires at least one approved photo')

let resizeObserver: ResizeObserver | undefined

function shuffledIds(photoSet: readonly DocumentaryPhoto[]) {
  const shuffled = photoSet.map((photo) => photo.id)
  const randomValues = new Uint32Array(shuffled.length)
  globalThis.crypto.getRandomValues(randomValues)

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = randomValues[index]! % (index + 1)
    const current = shuffled[index]!
    shuffled[index] = shuffled[randomIndex]!
    shuffled[randomIndex] = current
  }

  return shuffled
}

function sourceSet(variants: readonly ImageVariant[]) {
  return variants.map((variant) => `${variant.src} ${variant.width}w`).join(', ')
}

function number(value: number) {
  return Number(value.toFixed(3))
}

function photoStyle(photo: DocumentaryPhoto) {
  return {
    '--photo-aspect-ratio': `${photo.width} / ${photo.height}`,
    '--photo-ratio': number(photo.width / photo.height)
  }
}

function sizedPhotoLength(
  photo: DocumentaryPhoto,
  minHeightRem: number,
  preferredHeightVw: number,
  maxHeightRem: number,
  maxWidth: string
) {
  const ratio = photo.width / photo.height
  return `min(clamp(${number(minHeightRem * ratio)}rem, ${number(preferredHeightVw * ratio)}vw, ${number(maxHeightRem * ratio)}rem), ${maxWidth})`
}

function responsiveSizes(photo: DocumentaryPhoto) {
  if (props.variant === 'home') {
    return `(max-width: 64rem) ${sizedPhotoLength(photo, 14, 55, 18, 'calc(72vw - 3.25rem)')}, ${sizedPhotoLength(photo, 17, 28, 22, '52rem')}`
  }

  return `(max-width: 47.5rem) ${sizedPhotoLength(photo, 13, 62, 17, 'calc(72vw - 2.75rem)')}, (max-width: 60rem) ${sizedPhotoLength(photo, 15, 22, 20, 'calc(72vw - 3.25rem)')}, ${sizedPhotoLength(photo, 15, 22, 20, '19rem')}`
}

function handleDragStart() {
  trackX.stop()
}

function measureTrack() {
  if (!viewportRef.value || !trackRef.value) return
  minimumX.value = Math.min(0, viewportRef.value.clientWidth - trackRef.value.scrollWidth)
  trackX.set(Math.min(0, Math.max(minimumX.value, trackX.get())))
}

onMounted(async () => {
  await nextTick()
  measureTrack()
  if (!viewportRef.value || !trackRef.value) return
  resizeObserver = new ResizeObserver(measureTrack)
  resizeObserver.observe(viewportRef.value)
  resizeObserver.observe(trackRef.value)
})

onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<template>
  <!-- eslint-disable vue/html-self-closing -->
  <figure
    class="documentary-carousel"
    :data-photo-count="photos.length"
    :data-variant="props.variant"
    :aria-label="t('common.carousel.label')"
  >
    <div ref="viewportRef" class="documentary-carousel-viewport" aria-hidden="true">
      <motion.div
        ref="trackRef"
        class="documentary-carousel-track"
        :style="{ x: trackX }"
        drag="x"
        :drag-constraints="dragConstraints"
        :drag-elastic="prefersReducedMotion ? 0 : 0.08"
        :drag-momentum="!prefersReducedMotion"
        :drag-transition="{
          power: 0.2,
          timeConstant: 280,
          bounceStiffness: 240,
          bounceDamping: 32
        }"
        :on-drag-start="handleDragStart"
      >
        <picture
          v-for="(photo, photoIndex) in photos"
          :key="photo.id"
          class="documentary-carousel-item"
          :style="photoStyle(photo)"
        >
          <source type="image/avif" :srcset="sourceSet(photo.variants.avif)" :sizes="responsiveSizes(photo)" />
          <source type="image/webp" :srcset="sourceSet(photo.variants.webp)" :sizes="responsiveSizes(photo)" />
          <img
            :src="photo.variants.webp.at(-1)!.src"
            :width="photo.width"
            :height="photo.height"
            alt=""
            :loading="photoIndex < 3 ? 'eager' : 'lazy'"
            :fetchpriority="photoIndex === 0 ? 'high' : 'auto'"
            decoding="async"
            draggable="false"
          />
        </picture>
      </motion.div>
    </div>

    <figcaption v-if="props.caption">{{ props.caption }}</figcaption>
  </figure>
</template>

<style scoped>
@layer components {
  .documentary-carousel {
    --documentary-carousel-height: clamp(15rem, 22vw, 20rem);
    --documentary-carousel-gap: var(--space-4);

    min-width: 0;
    margin: 0;
  }

  .documentary-carousel-viewport {
    position: relative;
    z-index: 1;
    block-size: var(--documentary-carousel-height);
    overflow: hidden;
    container-type: inline-size;
    touch-action: pan-y;
  }

  .documentary-carousel-track {
    display: flex;
    inline-size: max-content;
    block-size: 100%;
    align-items: center;
    gap: var(--documentary-carousel-gap);
    cursor: grab;
    user-select: none;
    will-change: transform;
  }

  .documentary-carousel-track:active {
    cursor: grabbing;
  }

  .documentary-carousel-item {
    flex: 0 0 auto;
    inline-size: min(calc(var(--documentary-carousel-height) * var(--photo-ratio)), 72cqi);
    aspect-ratio: var(--photo-aspect-ratio);
    block-size: auto;
    overflow: hidden;
    border-radius: var(--radius-1);
  }

  .documentary-carousel-item img {
    display: block;
    inline-size: 100%;
    block-size: 100%;
    object-fit: cover;
  }

  .documentary-carousel figcaption {
    max-inline-size: 58ch;
    margin: 0;
    padding-block-start: var(--space-3);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: 1.5;
  }

  .documentary-carousel[data-variant='home'] {
    --documentary-carousel-height: clamp(17rem, 28vw, 22rem);

    position: relative;
    padding-inline-start: 4.5rem;
  }

  .documentary-carousel[data-variant='home']::before {
    position: absolute;
    z-index: 0;
    inset-block-start: 4rem;
    inset-inline-start: -2rem;
    inline-size: 9rem;
    block-size: 13rem;
    background: var(--color-brand-highlight);
    content: '';
  }

  @media (prefers-reduced-motion: reduce) {
    .documentary-carousel-track {
      will-change: auto;
    }
  }

  @media (width <= 64rem) {
    .documentary-carousel[data-variant='home'] {
      --documentary-carousel-height: clamp(14rem, 55vw, 18rem);

      padding-inline-start: 1.375rem;
    }

    .documentary-carousel[data-variant='home']::before {
      inset-block-start: 3.25rem;
      inset-inline-start: -1.5rem;
      inline-size: 4.625rem;
      block-size: 11.5rem;
    }
  }

  @media (width <= 47.5rem) {
    .documentary-carousel {
      --documentary-carousel-height: clamp(13rem, 62vw, 17rem);
      --documentary-carousel-gap: var(--space-3);
    }
  }

  @media (width <= 37.5rem) {
    .documentary-carousel figcaption {
      font-size: 1rem;
    }
  }
}
</style>
