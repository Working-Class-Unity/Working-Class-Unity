<script setup lang="ts">
import {
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHandle,
  DrawerOverlay,
  DrawerPortal,
  DrawerRoot,
  DrawerTitle,
  DrawerTrigger
} from 'reka-ui'

defineProps<{
  items: readonly Readonly<{
    id: string
    label: string
    children: readonly Readonly<{
      id: string
      label: string
      marker: string
    }>[]
  }>[]
  label: string
  title: string
  description: string
  triggerLabel: string
  closeLabel: string
}>()
</script>

<template>
  <div class="bylaws-page-outline">
    <aside class="bylaws-page-outline-desktop">
      <p>{{ title }}</p>
      <nav :aria-label="label">
        <ol class="outline-articles" role="list">
          <li v-for="(item, index) in items" :key="item.id">
            <a class="outline-article-link" :href="`#${item.id}`">
              <span aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
              {{ item.label }}
            </a>
            <ol v-if="item.children.length" class="outline-sections" role="list">
              <li v-for="child in item.children" :key="child.id">
                <a :href="`#${child.id}`">
                  <span aria-hidden="true">{{ child.marker }}</span>
                  {{ child.label }}
                </a>
              </li>
            </ol>
          </li>
        </ol>
      </nav>
    </aside>

    <DrawerRoot>
      <DrawerTrigger as-child>
        <button class="bylaws-page-outline-trigger" type="button">{{ triggerLabel }}</button>
      </DrawerTrigger>
      <DrawerPortal>
        <DrawerOverlay class="bylaws-page-outline-overlay" />
        <DrawerContent class="bylaws-page-outline-drawer">
          <DrawerHandle class="bylaws-page-outline-handle" />
          <div class="bylaws-page-outline-content">
            <div class="bylaws-page-outline-heading">
              <div>
                <DrawerTitle>{{ title }}</DrawerTitle>
                <DrawerDescription>{{ description }}</DrawerDescription>
              </div>
              <DrawerClose class="bylaws-page-outline-close" :aria-label="closeLabel">
                <span aria-hidden="true">×</span>
              </DrawerClose>
            </div>

            <nav :aria-label="label">
              <ol class="drawer-articles" role="list">
                <li v-for="(item, index) in items" :key="item.id">
                  <DrawerClose as-child>
                    <a class="drawer-article-link" :href="`#${item.id}`">
                      <span aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
                      {{ item.label }}
                    </a>
                  </DrawerClose>
                  <ol v-if="item.children.length" class="drawer-sections" role="list">
                    <li v-for="child in item.children" :key="child.id">
                      <DrawerClose as-child>
                        <a :href="`#${child.id}`">
                          <span aria-hidden="true">{{ child.marker }}</span>
                          {{ child.label }}
                        </a>
                      </DrawerClose>
                    </li>
                  </ol>
                </li>
              </ol>
            </nav>
          </div>
        </DrawerContent>
      </DrawerPortal>
    </DrawerRoot>
  </div>
</template>

<style scoped>
@layer components {
  .bylaws-page-outline {
    min-width: 0;
  }

  .bylaws-page-outline-desktop {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
    padding-inline-end: var(--space-3);
  }

  .bylaws-page-outline-desktop > p {
    margin: 0;
    color: var(--color-accent-action);
    font-family: var(--font-family-mono);
    font-size: 0.8125rem;
    font-weight: var(--font-weight-strong);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .bylaws-page-outline-desktop nav {
    min-width: 0;
  }

  .outline-articles,
  .outline-sections,
  .drawer-articles,
  .drawer-sections {
    display: grid;
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .outline-articles {
    gap: var(--space-3);
  }

  .outline-article-link,
  .outline-sections a {
    display: grid;
    gap: var(--space-2);
    border-radius: var(--radius-1);
    color: var(--color-text-muted);
    line-height: 1.4;
    text-decoration: none;
  }

  .outline-article-link {
    grid-template-columns: 1.75rem minmax(0, 1fr);
    padding: var(--space-2);
    font-size: 0.875rem;
    font-weight: var(--font-weight-strong);
  }

  .outline-sections {
    gap: var(--space-1);
    border-inline-start: var(--border-width) solid rgb(4 51 79 / 14%);
    padding-inline-start: var(--space-3);
    margin-inline-start: 1.35rem;
    margin-block-start: var(--space-1);
  }

  .outline-sections a {
    grid-template-columns: 1.25rem minmax(0, 1fr);
    padding: var(--space-1) var(--space-2);
    font-size: 0.8125rem;
  }

  .outline-article-link span,
  .drawer-article-link span,
  .outline-sections a span,
  .drawer-sections a span {
    color: var(--color-accent-action);
    font-family: var(--font-family-mono);
    font-variant-numeric: tabular-nums;
  }

  .bylaws-page-outline-trigger {
    position: fixed;
    z-index: calc(var(--z-menu) + 1);
    inset-inline-end: max(var(--space-4), env(safe-area-inset-right, 0px));
    inset-block-end: max(var(--space-4), env(safe-area-inset-bottom, 0px));
    display: none;
    min-block-size: var(--control-min-block-size);
    border: var(--border-width) solid var(--color-brand-primary);
    border-radius: var(--radius-round);
    padding-inline: var(--space-4);
    color: var(--color-brand-primary);
    background: var(--color-surface);
    box-shadow: var(--shadow-panel);
    font: inherit;
    font-size: 1rem;
    font-weight: var(--font-weight-strong);
  }

  .bylaws-page-outline-trigger:hover,
  .bylaws-page-outline-trigger:focus-visible,
  .bylaws-page-outline-trigger[data-state='open'] {
    color: var(--color-brand-primary);
    background: var(--color-brand-highlight);
  }

  .bylaws-page-outline-overlay {
    position: fixed;
    z-index: 80;
    inset: 0;
    background: rgb(4 51 79 / 58%);
  }

  .bylaws-page-outline-drawer {
    --outline-drawer-bleed: 3rem;

    position: fixed;
    z-index: 81;
    inset-inline: 0;
    inset-block-end: 0;
    max-block-size: min(86dvh, 44rem);
    overflow-y: auto;
    overscroll-behavior: contain;
    border-start-start-radius: var(--radius-2);
    border-start-end-radius: var(--radius-2);
    padding-block-end: calc(env(safe-area-inset-bottom, 0px) + var(--outline-drawer-bleed));
    margin-block-end: calc(-1 * var(--outline-drawer-bleed));
    color: var(--color-text);
    background: var(--color-surface);
    box-shadow: 0 -1.25rem 3rem rgb(4 20 31 / 18%);
    transform: translateY(var(--drawer-swipe-movement-y, 0));
    transition: transform 360ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .bylaws-page-outline-drawer[data-state='open'] {
    animation: bylaws-outline-in 360ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .bylaws-page-outline-drawer[data-state='closed'] {
    animation: bylaws-outline-out 280ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .bylaws-page-outline-drawer[data-swiping] {
    transition-duration: 0s;
  }

  .bylaws-page-outline-handle {
    inline-size: 3rem;
    block-size: 0.3rem;
    border-radius: var(--radius-round);
    margin: var(--space-3) auto 0;
    background: var(--color-border);
  }

  .bylaws-page-outline-content {
    display: grid;
    gap: var(--space-5);
    padding: var(--space-5) var(--content-gutter) var(--space-6);
  }

  .bylaws-page-outline-heading {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-4);
    align-items: start;
  }

  .bylaws-page-outline-heading > div {
    display: grid;
    gap: var(--space-1);
  }

  .bylaws-page-outline-heading h2,
  .bylaws-page-outline-heading p {
    margin: 0;
  }

  .bylaws-page-outline-heading h2 {
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: 1.5rem;
    font-weight: 650;
    letter-spacing: -0.03em;
  }

  .bylaws-page-outline-heading p {
    color: var(--color-text-muted);
    font-size: 1rem;
  }

  .bylaws-page-outline-close {
    display: grid;
    place-items: center;
    inline-size: var(--control-min-inline-size);
    block-size: var(--control-min-block-size);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-1);
    padding: 0;
    color: var(--color-brand-primary);
    background: transparent;
    font: inherit;
    font-size: 1.5rem;
  }

  .bylaws-page-outline-close:hover,
  .bylaws-page-outline-close:focus-visible {
    background: var(--color-action-soft);
  }

  .drawer-articles {
    gap: var(--space-4);
  }

  .drawer-article-link,
  .drawer-sections a {
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr);
    gap: var(--space-3);
    align-items: start;
    color: var(--color-brand-primary);
    text-decoration: none;
  }

  .drawer-article-link {
    min-block-size: var(--control-min-block-size);
    border-block-start: var(--border-width) solid var(--color-border);
    padding-block: var(--space-4);
    font-size: 1rem;
    font-weight: var(--font-weight-strong);
    line-height: 1.4;
  }

  .drawer-sections {
    gap: var(--space-1);
    border-inline-start: var(--border-width) solid rgb(4 51 79 / 14%);
    padding-inline-start: var(--space-4);
    margin-inline-start: var(--space-4);
  }

  .drawer-sections a {
    min-block-size: var(--control-min-block-size);
    padding-block: var(--space-2);
    font-size: 1rem;
    line-height: 1.5;
  }

  .outline-article-link:hover,
  .outline-article-link:focus-visible,
  .drawer-article-link:hover,
  .drawer-article-link:focus-visible {
    color: var(--color-brand-primary);
    background: var(--color-action-soft);
  }

  .outline-sections a:hover,
  .outline-sections a:focus-visible,
  .drawer-sections a:hover,
  .drawer-sections a:focus-visible {
    color: var(--color-accent-action);
    background: var(--color-action-soft);
  }

  @keyframes bylaws-outline-in {
    from {
      translate: 0 calc(100% - var(--outline-drawer-bleed));
    }
  }

  @keyframes bylaws-outline-out {
    to {
      translate: 0 calc(100% - var(--outline-drawer-bleed));
    }
  }

  @media (width <= 56rem) {
    .bylaws-page-outline {
      block-size: 0;
    }

    .bylaws-page-outline-desktop {
      display: none;
    }

    .bylaws-page-outline-trigger {
      display: block;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .bylaws-page-outline-drawer {
      animation-duration: 1ms;
      transition-duration: 1ms;
    }
  }
}
</style>
