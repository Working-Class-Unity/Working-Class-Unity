<script setup lang="ts">
import heroAssets from '~/generated/hero-assets.json'

type ImageVariant = Readonly<{
  src: string
  width: number
  height: number
}>

type HeroPhoto = Readonly<{
  id: string
  width: number
  height: number
  aspectRatio: number
  variants: Readonly<{
    avif: readonly ImageVariant[]
    webp: readonly ImageVariant[]
  }>
}>

type PhotoLane = Readonly<{
  items: readonly HeroPhoto[]
  weight: number
}>

const { t } = useI18n()
const availablePhotos = heroAssets.photos as HeroPhoto[]
const photoOrder = useState<readonly string[]>('hero-photo-order', () =>
  shuffledPhotos(availablePhotos).map((photo) => photo.id)
)
const photosById = new Map(availablePhotos.map((photo) => [photo.id, photo]))
const orderedPhotos = computed(() =>
  photoOrder.value.map((photoId) => photosById.get(photoId)).filter((photo): photo is HeroPhoto => Boolean(photo))
)
const lanes = computed<readonly PhotoLane[]>(() => {
  const nextLanes = Array.from({ length: 2 }, () => ({ items: [] as HeroPhoto[], weight: 0 }))

  for (const photo of orderedPhotos.value) {
    const shortest = nextLanes.reduce((current, lane) => (lane.weight < current.weight ? lane : current))
    shortest.items.push(photo)
    shortest.weight += photo.height / photo.width + 0.08
  }

  return nextLanes
})

function shuffledPhotos(photos: readonly HeroPhoto[]): HeroPhoto[] {
  const shuffled = [...photos]
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

function fallbackVariant(photo: HeroPhoto) {
  return photo.variants.webp.at(-1)!
}

function laneStyle(lane: PhotoLane, index: number) {
  return {
    '--photo-lane-duration': `${Math.round(Math.max(52, lane.weight * 7.5))}s`,
    '--photo-lane-delay': `${index * -17}s`
  }
}
</script>

<template>
  <!-- eslint-disable vue/html-self-closing -->
  <div class="hero-photo-feature">
    <p class="visually-hidden">{{ t('home.photoCaption') }}</p>
    <div class="photo-wall" aria-hidden="true">
      <div v-for="(lane, laneIndex) in lanes" :key="laneIndex" class="photo-lane">
        <div class="photo-lane-track" :style="laneStyle(lane, laneIndex)">
          <div v-for="copyIndex in 2" :key="copyIndex" class="photo-lane-sequence">
            <figure v-for="(photo, photoIndex) in lane.items" :key="photo.id" class="photo-card">
              <picture>
                <source
                  type="image/avif"
                  :srcset="sourceSet(photo.variants.avif)"
                  sizes="(max-width: 37.5rem) 46vw, (max-width: 60rem) 44vw, 18vw"
                />
                <source
                  type="image/webp"
                  :srcset="sourceSet(photo.variants.webp)"
                  sizes="(max-width: 37.5rem) 46vw, (max-width: 60rem) 44vw, 18vw"
                />
                <img
                  :src="fallbackVariant(photo).src"
                  alt=""
                  :width="fallbackVariant(photo).width"
                  :height="fallbackVariant(photo).height"
                  :loading="copyIndex === 1 && photoIndex < 3 ? 'eager' : 'lazy'"
                  decoding="async"
                />
              </picture>
            </figure>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@layer components {
  .hero-photo-feature {
    position: relative;
    align-self: stretch;
    min-block-size: 0;
    overflow: hidden;
  }

  .photo-wall {
    position: absolute;
    inset: clamp(5rem, 11svh, 7.5rem) 0 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: clamp(0.35rem, 0.75vw, 0.75rem);
    overflow: hidden;
    mask-image: linear-gradient(
      to bottom,
      transparent 0%,
      rgb(0 0 0 / 32%) 8%,
      #000 22%,
      #000 57%,
      rgb(0 0 0 / 68%) 70%,
      transparent 94%
    );
  }

  .photo-lane {
    min-width: 0;
    overflow: hidden;
  }

  .photo-lane-track {
    animation: photo-lane-rise var(--photo-lane-duration) linear var(--photo-lane-delay) infinite;
    will-change: transform;
  }

  .photo-lane-sequence {
    display: grid;
    gap: clamp(0.35rem, 0.75vw, 0.75rem);
    padding-block-end: clamp(0.35rem, 0.75vw, 0.75rem);
  }

  .photo-card {
    min-width: 0;
    overflow: hidden;
    border-radius: var(--radius-2);
    margin: 0;
    background: var(--color-surface);
    box-shadow: 0 0.5rem 1.75rem rgb(4 51 79 / 14%);
    outline: 1px solid rgb(4 51 79 / 10%);
    outline-offset: -1px;
  }

  .photo-card img {
    display: block;
    inline-size: 100%;
    block-size: auto;
  }

  @keyframes photo-lane-rise {
    to {
      transform: translateY(-50%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .photo-lane-track {
      animation: none;
      will-change: auto;
    }
  }

  @media (width <= 60rem) {
    .photo-wall {
      inset-block-start: clamp(2rem, 8vw, 4rem);
    }
  }
}
</style>
