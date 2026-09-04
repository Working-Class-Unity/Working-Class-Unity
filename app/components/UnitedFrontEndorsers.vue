<script setup lang="ts">
import type { UnitedFrontEndorser } from '~/content/united-front'

defineProps<{
  heading: string
  description: string
  endorsers: readonly UnitedFrontEndorser[]
}>()
</script>

<template>
  <section id="united-front-endorsers" class="united-front-endorsers" aria-labelledby="united-front-endorsers-title">
    <div class="united-front-endorsers-inner">
      <header class="united-front-endorsers-heading">
        <h2 id="united-front-endorsers-title">{{ heading }}</h2>
        <p>{{ description }}</p>
      </header>

      <ul class="united-front-endorsers-list">
        <li v-for="endorser in endorsers" :key="endorser.name">
          <div class="united-front-endorser-logo">
            <!-- eslint-disable-next-line vue/html-self-closing -->
            <img :src="endorser.logoSrc" alt="" loading="lazy" decoding="async" />
          </div>
          <p>{{ endorser.name }}</p>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
@layer components {
  .united-front-endorsers {
    border-block-start: var(--border-width) solid var(--color-divider-strong);
    padding-block: clamp(3.5rem, 7vw, 6rem);
  }

  .united-front-endorsers-inner {
    display: grid;
    grid-template-columns: minmax(12rem, 4fr) minmax(0, 8fr);
    gap: clamp(2rem, 5vw, 5rem);
    align-items: start;
  }

  .united-front-endorsers-heading {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }

  .united-front-endorsers-heading h2,
  .united-front-endorsers-heading p,
  .united-front-endorsers-list,
  .united-front-endorsers-list p {
    margin: 0;
  }

  .united-front-endorsers-heading h2 {
    color: var(--color-brand-primary);
    font-size: clamp(1.75rem, 1.45rem + 1.2vw, 2.5rem);
    text-wrap: balance;
  }

  .united-front-endorsers-heading p {
    max-inline-size: 40ch;
    color: var(--color-text-muted);
    font-size: 1rem;
    text-wrap: pretty;
  }

  .united-front-endorsers-list {
    display: grid;
    padding: 0;
    border-block-start: var(--border-width) solid var(--color-divider);
    list-style: none;
  }

  .united-front-endorsers-list li {
    display: grid;
    grid-template-columns: minmax(6rem, 9rem) minmax(0, 1fr);
    gap: var(--space-5);
    align-items: center;
    min-block-size: 7rem;
    border-block-end: var(--border-width) solid var(--color-divider);
    padding-block: var(--space-4);
  }

  .united-front-endorser-logo {
    display: grid;
    inline-size: 100%;
    block-size: 5.5rem;
    place-items: center;
  }

  .united-front-endorser-logo img {
    display: block;
    max-inline-size: 100%;
    max-block-size: 100%;
    object-fit: contain;
  }

  .united-front-endorsers-list p {
    color: var(--color-brand-primary);
    font-size: 1.125rem;
    font-weight: var(--font-weight-bold);
    text-wrap: pretty;
  }

  @media (width <= 56rem) {
    .united-front-endorsers-inner {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-7);
    }

    .united-front-endorsers-heading p {
      max-inline-size: 60ch;
    }
  }

  @media (width <= 22rem) {
    .united-front-endorsers-list li {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-3);
      align-items: start;
      min-block-size: 0;
    }

    .united-front-endorser-logo {
      inline-size: 5.5rem;
    }
  }
}
</style>
